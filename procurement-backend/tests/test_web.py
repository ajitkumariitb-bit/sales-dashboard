import base64
import hashlib
import hmac
import io
import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from procurement.app import create_app
from procurement.catalog import Catalog
from procurement.engine import Engine, uid
from procurement.webhooks import enqueue, process_pending, process_one


class WebTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=Path(self.tmp.name)
        self.e=Engine(self.root/'test.db',Catalog(demo=True)); self.e.bootstrap('Admin','long-test-password')
        self.app=create_app(self.e,self.root,testing=True); self.client=self.app.test_client()
        self.csrf=self.client.get('/api/session').json['csrf']
        r=self.client.post('/api/login',json=dict(id='admin',password='long-test-password'),headers={'X-CSRF-Token':self.csrf})
        self.csrf=r.json['csrf']; self.headers={'X-CSRF-Token':self.csrf,'Idempotency-Key':uid('http')}

    def tearDown(self): self.tmp.cleanup()
    def payload(self,quantity=1,**extra):
        return dict(id=1001,name='#1001',financial_status='paid',created_at='2026-09-20T09:00:00Z',updated_at='2026-09-20T09:00:00Z',
            line_items=[dict(id=10,variant_id='DEMO-B',quantity=quantity,requires_shipping=True)],**extra)
    def event(self,id,topic='orders/paid',payload=None):
        enqueue(self.e,id,topic,'test.myshopify.com',payload or self.payload()); process_pending(self.e)
    def state(self): return self.client.get('/api/state').json

    def test_session_and_csrf(self):
        self.assertEqual(self.client.post('/api/actions/adjust',json={}).status_code,403)
        self.assertEqual(self.app.test_client().get('/api/state').status_code,401)
        with self.client.get('/') as response: self.assertEqual(response.status_code,200)

    def test_state_query_count_does_not_grow_with_catalog(self):
        template=next(iter(self.e.catalog.products.values()))
        for number in range(100):
            variant=f'EXTRA-{number}::DEFAULT'; product=deepcopy(template)
            product.update(id=variant,product_id=f'EXTRA-{number}',shopify_variant_id=f'EXTRA-{number}')
            self.e.catalog.products[variant]=product
        original_connect=self.e.connect; query_count=0
        class CountingConnection:
            def __init__(self,connection): self.connection=connection
            def __enter__(self): return self
            def __exit__(self,*args): self.connection.close()
            def execute(inner,*args,**kwargs):
                nonlocal query_count
                query_count+=1
                return inner.connection.execute(*args,**kwargs)
        with patch.object(self.e,'connect',side_effect=lambda:CountingConnection(original_connect())):
            self.assertEqual(self.client.get('/api/state').status_code,200)
        self.assertLess(query_count,25)

    def test_role_data_redaction_and_denial(self):
        self.e.perform('admin','user',dict(id='packing',name='Packer',password='long-test-password',role='PACKING'),uid('u'))
        r=self.client.post('/api/login',json=dict(id='packing',password='long-test-password'),headers=self.headers)
        headers={'X-CSRF-Token':r.json['csrf'],'Idempotency-Key':uid('test')}
        data=self.state(); self.assertNotIn('price',data['products'][0]['vendors'][0]); self.assertNotIn('users',data)
        self.assertEqual(self.client.post('/api/actions/purchase',json={},headers=headers).status_code,403)
        self.assertEqual(self.client.get('/api/catalog-outbox').status_code,403)

    def test_webhook_signature_and_duplicate(self):
        self.e.catalog.demo=False; body=json.dumps(self.payload()).encode(); secret='test-secret'
        headers={'X-Shopify-Hmac-SHA256':base64.b64encode(hmac.new(secret.encode(),body,hashlib.sha256).digest()).decode(),
            'X-Shopify-Shop-Domain':'test.myshopify.com','X-Shopify-Topic':'orders/paid','X-Shopify-Webhook-Id':'delivery-1'}
        with patch.dict(os.environ,SHOPIFY_WEBHOOK_SECRET=secret,SHOPIFY_SHOP_DOMAIN='test.myshopify.com'):
            self.assertEqual(self.client.post('/webhooks/shopify',data=body,headers=headers).status_code,200)
            self.assertEqual(self.client.post('/webhooks/shopify',data=body,headers=headers).status_code,200)
            headers['X-Shopify-Hmac-SHA256']='bad'
            self.assertEqual(self.client.post('/webhooks/shopify',data=body,headers=headers).status_code,401)
        process_pending(self.e)
        self.assertEqual(len(self.state()['orders']),1)
        with self.e.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM webhook_inbox').fetchone()[0],1)

    def test_duplicate_paid_different_delivery(self):
        self.event('1');self.event('2');self.assertEqual(len(self.state()['orders']),1)
        self.assertEqual(self.state()['queue'][0]['required'],1)

    def test_unpaid_cod_creates_demand(self):
        p=self.payload();p['financial_status']='pending';p['payment_gateway_names']=['Cash on Delivery (COD)']
        self.event('cod','orders/create',p)
        self.assertEqual(self.state()['queue'][0]['required'],1)

    def test_failed_mapping_retries_after_backoff(self):
        p=self.payload();p['line_items'][0]['variant_id']='new-variant'
        self.event('mapping',payload=p)
        self.e.catalog.by_shopify['new-variant']='DEMO-B::DEFAULT'
        self.assertEqual(process_pending(self.e),0)
        with self.e.connect() as db:
            db.execute("UPDATE webhook_inbox SET processed_at='2020-01-01T00:00:00+00:00' WHERE id='mapping'")
        self.assertEqual(process_pending(self.e),1)
        self.assertEqual(self.state()['queue'][0]['required'],1)

    def test_worker_requires_server_credential(self):
        enqueue(self.e,'worker','orders/create','test.myshopify.com',self.payload())
        with patch.dict(os.environ,PROCUREMENT_WORKER_SECRET='w'*64):
            self.assertEqual(self.client.post('/internal/process-inbox').status_code,401)
            self.assertEqual(self.client.post('/internal/process-inbox',headers={'Authorization':'Bearer '+'w'*64}).status_code,200)
        self.assertEqual(len(self.state()['orders']),1)

    def test_webhook_ack_only_persists_without_processing(self):
        self.e.catalog.demo=False;body=json.dumps(self.payload()).encode();secret='test-secret'
        headers={'X-Shopify-Hmac-SHA256':base64.b64encode(hmac.new(secret.encode(),body,hashlib.sha256).digest()).decode(),
                 'X-Shopify-Shop-Domain':'test.myshopify.com','X-Shopify-Topic':'orders/create','X-Shopify-Webhook-Id':'queued'}
        with patch.dict(os.environ,SHOPIFY_WEBHOOK_SECRET=secret,SHOPIFY_SHOP_DOMAIN='test.myshopify.com'):
            self.assertEqual(self.client.post('/webhooks/shopify',data=body,headers=headers).status_code,200)
        self.assertEqual(self.state()['orders'],[])
        process_pending(self.e)
        self.assertEqual(len(self.state()['orders']),1)

    def test_cancel_before_paid_tombstone(self):
        self.event('cancel','orders/cancelled');self.event('paid')
        self.assertEqual(self.state()['orders'][0]['status'],'CANCELLED');self.assertEqual(self.state()['queue'],[])

    def test_unmapped_variant_retryable(self):
        p=self.payload();p['line_items'][0]['variant_id']='missing';self.event('bad',payload=p)
        data=self.state();self.assertEqual(data['orders'],[]);self.assertEqual(data['inbox'][0]['status'],'ERROR')

    def test_procurement_sees_unmapped_order_without_raw_payload(self):
        p=self.payload();p['line_items'][0].update(variant_id='unmapped',title='Unmapped lamp')
        p['email']='private@example.test';self.event('unmapped',payload=p)
        self.e.perform('admin','user',dict(id='buyer',name='Buyer',password='long-test-password',role='PROCUREMENT'),uid('u'))
        self.client.post('/api/login',json=dict(id='buyer',password='long-test-password'),headers=self.headers)
        data=self.state()
        self.assertEqual(data['intake_attention'][0]['number'],'#1001')
        self.assertEqual(data['intake_attention'][0]['items'][0]['title'],'Unmapped lamp')
        self.assertNotIn('private@example.test',json.dumps(data))
        self.assertNotIn('inbox',data)

    def test_quantity_edit_and_stale_event(self):
        self.event('paid');p=self.payload(3);p['updated_at']='2026-09-20T10:00:00Z';self.event('edit','orders/updated',p)
        self.event('stale','orders/updated',self.payload(1))
        self.assertEqual(self.state()['queue'][0]['required'],3)

    def test_external_fulfillment_never_silently_deducts(self):
        self.event('paid');p=self.payload(fulfillment_status='fulfilled');p['updated_at']='2026-09-20T10:00:00Z';self.event('fulfillment','orders/fulfilled',p)
        self.assertEqual(self.state()['issues'][0]['issue_type'],'External fulfillment')
        self.assertEqual(self.state()['orders'][0]['status'],'WAITING_FOR_PROCUREMENT')

    def test_image_validation_and_review_outbox(self):
        b=self.e.perform('admin','purchase',dict(variant='DEMO-B::DEFAULT',vendor='Demo Artistica',quantity=1,price=10),uid('buy'))
        self.e.perform('admin','receive',dict(id=b['id'],good=1),uid('receipt'))
        photo=io.BytesIO();Image.new('RGB',(100,100),'white').save(photo,'PNG');raw=photo.getvalue()
        fields=dict(batch_id=b['id'],view_type='Full product',photo=(io.BytesIO(raw),'product.png'))
        result=self.client.post('/api/upload',data=fields,headers=self.headers)
        self.assertEqual(result.status_code,200,result.json);self.assertEqual(result.json['approval'],'PENDING_REVIEW')
        with self.client.get('/api/assets/'+result.json['id']) as response: self.assertEqual(response.status_code,200)
        out=self.client.get('/api/catalog-outbox').json['events'];self.assertEqual(out[-1]['event_type'],'REAL_PROCUREMENT_PHOTO')
        self.assertEqual(out[-1]['payload']['customer_visible_approved'],0)
        bad=self.client.post('/api/upload',data=dict(batch_id=b['id'],view_type='Full product',photo=(io.BytesIO(b'not an image'),'fake.jpg')),headers=self.headers)
        self.assertEqual(bad.status_code,400)

    def test_password_change_revokes_session(self):
        self.e.perform('admin','user',dict(id='admin',name='Admin',role='ADMIN',password='another-long-password'),uid('pw'))
        self.assertEqual(self.client.get('/api/state').status_code,401)

if __name__=='__main__': unittest.main()
