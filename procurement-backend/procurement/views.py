import json
from datetime import datetime, timezone
from .engine import now


def age(stamp):
    if not stamp: return 0
    return max(0,round((datetime.now(timezone.utc)-datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds()/3600,1))


def state(engine, user):
    with engine.connect() as db:
        db.execute('BEGIN')
        settings={r['key']:int(r['value']) for r in db.execute('SELECT * FROM settings')}
        inv={r['variant']:dict(r) for r in db.execute('SELECT * FROM inventory')}
        reservations=engine.rows(db,"SELECT * FROM reservations WHERE status='ACTIVE'")
        batches=engine.rows(db,'SELECT * FROM batches ORDER BY created_at DESC')
        assets=engine.rows(db,'SELECT * FROM assets ORDER BY uploaded_at DESC')
        latest_prices={r['variant']:r for r in engine.rows(db,"""
            SELECT variant,unit_paise,created_at FROM (
                SELECT variant,unit_paise,created_at,
                    ROW_NUMBER() OVER (PARTITION BY variant ORDER BY created_at DESC,id DESC) AS row_number
                FROM price_history
            ) latest WHERE row_number=1
        """)}
        products=[]
        for variant, p in engine.catalog.products.items():
            i=inv.get(variant,dict(physical=0,damaged=0,availability='AMBER',fresh_photos=0,updated_at=None))
            reserved=sum(r['quantity'] for r in reservations if r['variant']==variant)
            incoming=sum(b['quantity']-b['received'] for b in batches if b['variant']==variant and b['status']!='RECEIVED' and not b['short_closed'])
            approved={a['view_type'] for a in assets if a['variant']==variant and a['approval']=='APPROVED'}
            last=latest_prices.get(variant)
            products.append(dict(p,**i,reserved=reserved,available=i['physical']-reserved,incoming=incoming,
                real_images_sufficient=len(approved)>=3 and not i['fresh_photos'],
                image_url='/api/product-image/'+variant if p['image'] else None,
                last_purchase_price=last['unit_paise']/100 if last else None))
        byid={p['id']:p for p in products}
        orders=engine.rows(db,'SELECT * FROM orders ORDER BY created_at')
        requirements=engine.rows(db,'SELECT * FROM requirements WHERE outstanding>0 ORDER BY priority DESC,created_at')
        lines=engine.rows(db,'SELECT * FROM order_lines')
        incoming_budget={b['id']:b['quantity']-b['received'] for b in batches if b['status']!='RECEIVED' and not b['short_closed']}
        for order in orders:
            order['age_hours']=age(order['created_at']); order['stage_age_hours']=age(order['updated_at'])
            order['lines']=[]
            for l in [l for l in lines if l['order_id']==order['id']]:
                l.pop('snapshot',None)
                p=byid.get(l['variant'],{})
                l.update(title=p.get('title',l['variant']),sku=p.get('sku',''),product_id=p.get('product_id',''),image_url=p.get('image_url'))
                l['reserved']=sum(r['quantity'] for r in reservations if r['line_id']==l['id'])
                left=l['quantity']-l['reserved']; l['in_transit_quantity']=0; l['purchased_quantity']=0
                if order['status'] not in {'CANCELLED','SHIPPED','PACKED'}:
                    for b in sorted(batches,key=lambda b:(b['status']!='IN_TRANSIT',b['created_at'])):
                        if b['variant']!=l['variant'] or b['id'] not in incoming_budget: continue
                        take=min(left,incoming_budget[b['id']]); incoming_budget[b['id']]-=take; left-=take
                        l['in_transit_quantity' if b['status']=='IN_TRANSIT' else 'purchased_quantity']+=take
                l['to_procure_quantity']=left if order['status'] not in {'CANCELLED','SHIPPED','PACKED'} else 0
                l['status']=order['status'] if order['status'] in {'CANCELLED','SHIPPED','PACKED'} else 'ALLOCATED' if l['reserved']==l['quantity'] else 'TO_PROCURE' if left else 'PURCHASED' if l['purchased_quantity'] else 'IN_TRANSIT'
                order['lines'].append(l)
        queue=[]
        for variant in dict.fromkeys(r['variant'] for r in requirements):
            rows=[r for r in requirements if r['variant']==variant]; p=byid[variant]; need=sum(r['outstanding'] for r in rows)
            affected=[o for o in orders if any(l['variant']==variant and l['reserved']<l['quantity'] for l in o['lines']) and o['status'] not in {'CANCELLED','SHIPPED'}]
            queue.append(dict(variant=variant,product=p,required=need,incoming=p['incoming'],to_buy=max(0,need-p['incoming']),
                orders=[{'id':o['id'],'number':o['number'],'customer':o['customer']} for o in affected],requirements=rows,
                age_hours=max((o['age_hours'] for o in affected),default=0),priority=max(r['priority'] for r in rows)))
        queue.sort(key=lambda r:(-r['priority'],-r['age_hours']))
        for b in batches:
            b['product']=byid.get(b['variant'],{}); b['age_hours']=age(b['transit_at'] if b['status']=='IN_TRANSIT' else b['created_at'])
            b['total_paise']=b['quantity']*b['unit_paise']; b['expected_excess']=max(0,b['quantity']-b['required_for_orders'])
            b['overdue']=b['status']=='PURCHASED' and b['age_hours']>settings['purchased_hours'] or b['status']=='IN_TRANSIT' and (age(b['expected_at'])>0 if b['expected_at'] else b['age_hours']>settings['transit_hours'])
        for a in assets:
            a['url']='/api/assets/'+a['id']; a['title']=byid.get(a['variant'],{}).get('title',a['product_id']); a.pop('filename',None)
        issues=engine.rows(db,'SELECT * FROM issues ORDER BY created_at DESC')
        result=dict(user={k:user[k] for k in ['id','name','role']},demo=engine.catalog.demo,products=products,orders=orders,queue=queue,batches=batches,
            issues=issues,assets=assets,settings=settings,generated_at=now(),catalog_count=len(products),
            summary=dict(waiting=sum(o['status']=='WAITING_FOR_PROCUREMENT' for o in orders),to_procure=sum(q['to_buy']>0 for q in queue),
                purchased=sum(b['status']=='PURCHASED' for b in batches),transit=sum(b['status']=='IN_TRANSIT' for b in batches),
                received_today=db.execute('SELECT COALESCE(SUM(good),0) FROM goods_receipts WHERE substr(created_at,1,10)=?',(now()[:10],)).fetchone()[0],
                ready=sum(o['status']=='READY_FOR_PACKING' for o in orders),payment_pending=sum(b['payment'] in {'PAYMENT_REQUESTED','PAYMENT_PENDING','PAYMENT_FAILED'} for b in batches),
                issues=sum(not i['resolved_at'] for i in issues)))
        result['intake_attention']=[]
        if user['role'] in {'ADMIN','PROCUREMENT'}:
            # Expose operational exceptions, never raw customer/payment payloads.
            seen=set()
            for event in engine.rows(db,"SELECT id,payload,error,created_at FROM webhook_inbox WHERE status='ERROR' ORDER BY created_at DESC"):
                payload=json.loads(event['payload']); oid=str(payload.get('id',''))
                if oid in seen: continue
                seen.add(oid)
                existing=next((o for o in orders if o['id']==oid),None)
                if existing and existing['status'] in {'CANCELLED','SHIPPED'}: continue
                result['intake_attention'].append(dict(order_id=oid,number=payload.get('name') or oid,error=event['error'],
                    created_at=event['created_at'],items=[dict(title=l.get('title') or l.get('name') or 'Product',
                    quantity=l.get('current_quantity',l.get('quantity',0)),shopify_variant_id=str(l.get('variant_id') or ''))
                    for l in payload.get('line_items',[]) if l.get('requires_shipping') is not False]))
        if user['role']=='ADMIN':
            result['audit']=engine.rows(db,'SELECT * FROM audit_events ORDER BY seq DESC LIMIT 200')
            result['movements']=engine.rows(db,'SELECT * FROM inventory_movements ORDER BY created_at DESC LIMIT 200')
            result['users']=engine.rows(db,'SELECT id,name,role,active,created_at FROM users ORDER BY name')
            result['inbox']=engine.rows(db,'SELECT id,topic,status,error,created_at FROM webhook_inbox ORDER BY created_at DESC LIMIT 100')
            result['outbox_count']=db.execute('SELECT COUNT(*) FROM catalog_outbox').fetchone()[0]
        if user['role'] in {'SALES','PACKING'}:
            # Price data is removed from every nested object, not merely hidden by CSS.
            def redact(value):
                if isinstance(value,dict): return {k:redact(v) for k,v in value.items() if k not in {'price','last_purchase_price','unit_paise','total_paise','invoice'}}
                if isinstance(value,list): return [redact(v) for v in value]
                return value
            result=redact(result)
        return result
