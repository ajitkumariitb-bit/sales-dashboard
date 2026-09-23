import concurrent.futures
import sqlite3
import tempfile
import unittest
from pathlib import Path
from procurement.catalog import Catalog
from procurement.engine import Engine, uid
from procurement.views import state

A='DEMO-A::DEFAULT'; B='DEMO-B::DEFAULT'


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.e=Engine(Path(self.tmp.name)/'test.db',Catalog(demo=True))
        self.e.bootstrap('Test Admin','test-password-long')

    def tearDown(self): self.tmp.cleanup()
    def act(self,action,data,key=None,actor='admin'): return self.e.perform(actor,action,data,key or uid('TEST'))
    def stock(self,v):
        with self.e.transaction() as db: return self.e.stock(db,v)
    def order(self,id='1001',lines=None):
        return self.act('order',dict(id=id,number='#'+id,customer='Test customer',lines=lines or [dict(id='1',variant=B,quantity=1)]))
    def buy(self,q=10,v=B): return self.act('purchase',dict(variant=v,vendor='Demo Artistica',quantity=q,price='1250.25',payment='PAYMENT_REQUESTED'))
    def receive(self,b,good,damaged=0,wrong=0,key=None): return self.act('receive',dict(id=b['id'],good=good,damaged=damaged,wrong=wrong),key)
    def adjust(self,q,v=A): return self.act('adjust',dict(variant=v,delta=q,reason='Count verified'))

    def test_success_scenario(self):
        self.adjust(3)
        self.order(lines=[dict(id='1',variant=A,quantity=2),dict(id='2',variant=B,quantity=1)])
        self.assertEqual(self.stock(A)['available'],1)
        b=self.buy(); self.assertEqual(b['required_for_orders'],1)
        self.act('transit',{'id':b['id']})
        self.assertEqual(self.stock(B)['available'],0)
        self.receive(b,10)
        self.assertEqual((self.stock(B)['physical'],self.stock(B)['reserved'],self.stock(B)['available']),(10,1,9))
        with self.e.connect() as db:
            self.assertEqual(self.e.one(db,'orders','1001')['status'],'READY_FOR_PACKING')
        for id in ['1001:1','1001:2']: self.act('pick',dict(id='1001',line_id=id))
        self.act('pack',{'id':'1001'}); self.act('ship',{'id':'1001'}); self.act('ship',{'id':'1001'})
        self.assertEqual((self.stock(A)['physical'],self.stock(B)['physical']),(1,9))

    def test_partial_stock(self):
        self.adjust(3); self.order('first',[dict(id='1',variant=A,quantity=1)])
        self.order('second',[dict(id='1',variant=A,quantity=4)])
        with self.e.connect() as db:
            self.assertEqual(db.execute('SELECT outstanding FROM requirements').fetchone()[0],2)
        self.assertEqual(self.stock(A)['reserved'],3)

    def test_concurrent_orders_cannot_double_reserve(self):
        self.adjust(3)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda n:self.order(str(n),[dict(id='1',variant=A,quantity=1)]),range(12)))
        self.assertEqual(self.stock(A)['reserved'],3)
        with self.e.connect() as db:
            self.assertEqual(db.execute('SELECT SUM(outstanding) FROM requirements').fetchone()[0],9)

    def test_partial_receipts_and_excess(self):
        self.order(lines=[dict(id='1',variant=B,quantity=4)])
        b=self.buy(12); self.receive(b,2)
        self.assertEqual((self.stock(B)['reserved'],self.stock(B)['incoming']),(2,10))
        self.receive(b,8)
        self.assertEqual((self.stock(B)['reserved'],self.stock(B)['available'],self.stock(B)['incoming']),(4,6,2))
        self.act('short_close',dict(id=b['id'],reason='Vendor confirmed 2 will not arrive'))
        self.assertEqual(self.stock(B)['incoming'],0)

    def test_damage_wrong_item_not_allocated(self):
        self.order(lines=[dict(id='1',variant=B,quantity=3)]); b=self.buy(4)
        self.receive(b,1,2,1)
        self.assertEqual((self.stock(B)['physical'],self.stock(B)['damaged'],self.stock(B)['reserved'],self.stock(B)['incoming']),(1,2,1,0))
        with self.e.connect() as db: self.assertEqual(db.execute('SELECT outstanding FROM requirements').fetchone()[0],2)

    def test_cancel_releases_and_reallocates(self):
        self.adjust(1); self.order('first',[dict(id='1',variant=A,quantity=1)]); self.order('second',[dict(id='1',variant=A,quantity=1)])
        self.act('cancel',dict(id='first',reason='Customer cancelled'))
        self.act('cancel',dict(id='first',reason='Retry'))
        self.assertEqual(self.stock(A)['reserved'],1)
        with self.e.connect() as db: self.assertEqual(self.e.one(db,'orders','second')['status'],'READY_FOR_PACKING')

    def test_cancel_does_not_erase_incoming(self):
        self.order(); b=self.buy(); self.act('cancel',dict(id='1001'))
        self.assertEqual(self.stock(B)['incoming'],10)
        self.receive(b,10); self.assertEqual(self.stock(B)['available'],10)

    def test_duplicate_order_different_event(self):
        self.order(); self.order()
        with self.e.connect() as db: self.assertEqual(db.execute('SELECT SUM(outstanding) FROM requirements').fetchone()[0],1)

    def test_receipt_idempotency(self):
        b=self.buy(); first=self.receive(b,3,key='receipt-1'); second=self.receive(b,3,key='receipt-1')
        self.assertEqual(first,second); self.assertEqual(self.stock(B)['physical'],3)
        with self.assertRaises(ValueError): self.receive(b,4,key='receipt-1')

    def test_concurrent_receipt_duplicate(self):
        b=self.buy()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda n:self.receive(b,10,key='same-receipt'),range(4)))
        self.assertEqual(self.stock(B)['physical'],10)

    def test_overreceipt_atomic_rollback(self):
        b=self.buy(2)
        with self.assertRaises(ValueError): self.receive(b,3)
        self.assertEqual(self.stock(B)['physical'],0)
        with self.e.connect() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM goods_receipts').fetchone()[0],0)

    def test_adjustment_cannot_consume_reservations(self):
        self.adjust(2); self.order(lines=[dict(id='1',variant=A,quantity=2)])
        with self.assertRaises(ValueError): self.adjust(-1)
        self.assertEqual(self.stock(A)['physical'],2)

    def test_packing_cannot_ship_unpicked(self):
        self.adjust(2); self.order(lines=[dict(id='1',variant=A,quantity=2)])
        with self.assertRaises(ValueError): self.act('pack',{'id':'1001'})
        with self.assertRaises(ValueError): self.act('ship',{'id':'1001'})

    def test_roles_enforced(self):
        for role in ['SALES','PACKING','PROCUREMENT']:
            self.act('user',dict(id=role,name=role,role=role,password='long-test-password'))
            with self.assertRaises(PermissionError): self.act('adjust',dict(variant=A,delta=3,reason='No'),actor=role)
        with self.assertRaises(PermissionError): self.act('purchase',dict(variant=B,vendor='Demo Artistica',quantity=1,price=10),actor='PACKING')

    def test_audit_and_ledger_immutable(self):
        self.adjust(3)
        with self.e.connect() as db:
            for table in ['audit_events','inventory_movements']:
                with self.assertRaises(sqlite3.IntegrityError): db.execute('DELETE FROM '+table)

    def test_price_history_keeps_original(self):
        b=self.buy(10)
        self.act('batch_edit',dict(id=b['id'],vendor='Demo Artistica',quantity=12,price='1200',reason='Invoice correction'))
        with self.e.connect() as db:
            self.assertEqual([r[0] for r in db.execute('SELECT unit_paise FROM price_history ORDER BY created_at')],[125025,120000])

    def test_purchase_captures_missing_vendor_and_reuses_it(self):
        self.e.catalog.products[B]['vendors']=[]; self.order()
        purchase=dict(variant=B,vendor='New Glassworks',supplier_sku='NG-42',quantity=1,price='900',new_vendor=True)
        first=self.act('purchase',purchase)
        self.assertEqual((first['vendor'],first['supplier_sku']),('New Glassworks','NG-42'))
        second=self.act('purchase',dict(variant=B,vendor='New Glassworks',quantity=1,price='925'))
        self.assertEqual(second['supplier_sku'],'NG-42')
        screen=state(self.e,dict(id='admin',name='Test Admin',role='ADMIN'))
        vendor=next(v for v in next(p for p in screen['products'] if p['id']==B)['vendors'] if v['id']=='New Glassworks')
        self.assertEqual(vendor['relationship'],'PENDING_CATALOG_REVIEW')
        with self.e.connect() as db:
            events=[r[0] for r in db.execute('SELECT event_type FROM catalog_outbox ORDER BY seq')]
        self.assertEqual(events.count('VENDOR_RELATIONSHIP_CAPTURED'),1)

    def test_photos_private_until_review(self):
        b=self.buy(); self.receive(b,10)
        a=self.act('asset',dict(batch_id=b['id'],filename='test.jpg',view_type='Full product'))
        self.assertEqual(a['customer_visible_approved'],0)
        a=self.act('review',dict(id=a['id'],approval='INTERNAL_ONLY',primary=True))
        self.assertEqual((a['customer_visible_approved'],a['is_primary']),(0,0))

    def test_reallocation(self):
        self.adjust(1); self.order('first',[dict(id='1',variant=A,quantity=1)]); self.order('second',[dict(id='1',variant=A,quantity=1)])
        self.act('reallocate',dict(source_line='first:1',target_line='second:1',quantity=1,reason='Urgent dispatch'))
        with self.e.connect() as db:
            self.assertEqual(self.e.one(db,'orders','second')['status'],'READY_FOR_PACKING')
            self.assertEqual(self.e.one(db,'orders','first')['status'],'WAITING_FOR_PROCUREMENT')

    def test_reserved_damage_reopens_shortage(self):
        self.adjust(2); self.order(lines=[dict(id='1',variant=A,quantity=2)])
        self.act('pick',dict(id='1001',line_id='1001:1')); self.act('pack',dict(id='1001'))
        self.act('allocation_problem',dict(line_id='1001:1',quantity=1,kind='Damaged',reason='Broken glass during pick'))
        s=self.stock(A); self.assertEqual((s['physical'],s['reserved'],s['damaged']),(1,1,1))
        with self.e.connect() as db:
            self.assertEqual(self.e.one(db,'orders','1001')['status'],'WAITING_FOR_PROCUREMENT')
            self.assertEqual(db.execute('SELECT outstanding FROM requirements').fetchone()[0],1)

    def test_open_issue_blocks_shipping(self):
        self.adjust(1);self.order(lines=[dict(id='1',variant=A,quantity=1)])
        self.act('pick',dict(id='1001',line_id='1001:1'));self.act('pack',dict(id='1001'))
        issue=self.act('issue',dict(entity='order',id='1001',type='Wrong item',note='Verify finish'))
        with self.assertRaises(ValueError): self.act('ship',dict(id='1001'))
        self.act('resolve',dict(id=issue['id'],resolution='Finish verified with order'))
        self.act('ship',dict(id='1001'));self.assertEqual(self.stock(A)['physical'],0)

    def test_admin_demand_correction(self):
        self.adjust(3);self.order(lines=[dict(id='1',variant=A,quantity=4)])
        self.act('order_quantity',dict(line_id='1001:1',quantity=2,reason='Corrected offline order'))
        self.assertEqual((self.stock(A)['reserved'],self.stock(A)['available']),(2,1))
        with self.e.connect() as db: self.assertEqual(db.execute('SELECT outstanding FROM requirements').fetchone()[0],0)

if __name__=='__main__': unittest.main()
