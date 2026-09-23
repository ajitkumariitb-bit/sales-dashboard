"""Durable Shopify inbox. No outbound Shopify mutations."""
import json
import time
from datetime import datetime, timedelta, timezone
from .engine import now, encode
from .shopify_catalog import sync_records, webhook_records

ORDER_TOPICS={'orders/paid','orders/create','orders/updated','orders/cancelled','orders/fulfilled','orders/partially_fulfilled'}
CATALOG_TOPICS={'products/create','products/update'}
TOPICS=ORDER_TOPICS|CATALOG_TOPICS


def normalize(engine, payload):
    lines=[]
    for line in payload.get('line_items',[]):
        if line.get('requires_shipping') is False:
            continue
        vid=str(line.get('variant_id','')).split('/')[-1]
        variant=engine.catalog.by_shopify.get(vid)
        if not variant:
            raise ValueError('Unmapped Shopify variant '+vid+'. Update authoritative catalog mapping, reload catalog, and retry inbox event.')
        q=line.get('current_quantity',line.get('quantity',0))
        if q:
            lines.append(dict(id=str(line['id']),variant=variant,quantity=q))
    customer=payload.get('customer') or {}
    name=' '.join(str(customer.get(k) or '') for k in ['first_name','last_name']).strip() or 'Customer'
    return dict(id=str(payload['id']),number=str(payload.get('name') or payload.get('order_number') or payload['id']),
        customer=name,lines=lines,created_at=payload.get('created_at'),updated_at=payload.get('updated_at'),
        fulfillment_state=payload.get('fulfillment_status'),note=payload.get('note') or '')


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp() if value else 0


def process_one(engine, event_id, storage=None):
    try:
        with engine.connect() as db:
            event=engine.one(db,'webhook_inbox',event_id)
        if event['topic'] in CATALOG_TOPICS:
            if storage is None:
                raise ValueError('Shopify catalog sync storage is not configured.')
            sync_records(engine,webhook_records(json.loads(event['payload'])),storage)
            with engine.connect() as db:
                db.execute("UPDATE webhook_inbox SET status='DONE',error=NULL,processed_at=? WHERE id=?",(now(),event_id))
            return
        with engine.transaction() as db:
            event=engine.one(db,'webhook_inbox',event_id)
            if event['status']=='DONE': return
            p=json.loads(event['payload']); oid=str(p['id'])
            old=db.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone()
            incoming_time=p.get('updated_at') or p.get('created_at')
            cancelled=bool(p.get('cancelled_at')) or event['topic']=='orders/cancelled'
            stale=bool(old and incoming_time and old['source_updated_at'] and timestamp(incoming_time)<timestamp(old['source_updated_at']))
            if not stale:
                if cancelled:
                    if old:
                        if old['status']=='SHIPPED':
                            engine.issue(db,'shopify','order',oid,'Cancellation after shipment','Reconcile a physical return; stock has not been restored.')
                        else: engine.cancel(db,'shopify',oid,'Shopify cancellation')
                    else:
                        # A cancellation can arrive before paid/create. Keep a tombstone.
                        db.execute("INSERT INTO orders(id,number,customer,source,status,created_at,updated_at,source_updated_at) VALUES(?,?,?,'SHOPIFY','CANCELLED',?,?,?)",
                            (oid,str(p.get('name') or oid),'Customer',p.get('created_at') or now(),now(),incoming_time))
                        engine.audit(db,'shopify','order',oid,None,'CANCELLED','CANCELLATION_TOMBSTONE')
                elif old and old['status']=='CANCELLED':
                    pass
                else:
                    # Every Shopify order is confirmed demand, including COD/unpaid.
                    data=normalize(engine,p)
                    if not old:
                        if p.get('fulfillment_status') in {'fulfilled','partial'}:
                            raise ValueError('Already fulfilled/partially fulfilled order requires opening-state reconciliation before intake.')
                        if data['lines']: engine.ingest(db,'shopify',data)
                    else:
                        current=engine.rows(db,'SELECT * FROM order_lines WHERE order_id=?',(oid,))
                        old_shape=sorted((l['id'],l['variant'],l['quantity']) for l in current)
                        new_shape=sorted((oid+':'+l['id'],l['variant'],l['quantity']) for l in data['lines'])
                        if old_shape!=new_shape:
                            if old['status'] in {'PACKED','SHIPPED'} or any(l['picked'] for l in current):
                                raise ValueError('Order edited after physical picking; Admin must reconcile and reopen before retry.')
                            engine.release(db,'shopify',oid)
                            old_ids={l['id']:l for l in current}
                            new_ids={oid+':'+l['id']:l for l in data['lines']}
                            # Preserve historic lines and reservations. Removed/changed variants cannot be silently reused.
                            if set(old_ids)!=set(new_ids) or any(old_ids[k]['variant']!=new_ids[k]['variant'] for k in old_ids):
                                raise ValueError('Line added/removed or variant changed; explicit Admin order reconciliation required.')
                            for lid,l in new_ids.items(): db.execute('UPDATE order_lines SET quantity=? WHERE id=?',(l['quantity'],lid))
                            engine.audit(db,'shopify','order',oid,old_shape,new_shape,'QUANTITY_EDIT')
                            engine.allocate(db,'shopify')
                    if p.get('fulfillment_status') in {'fulfilled','partial'} and old and old['status']!='SHIPPED':
                        exists=db.execute("SELECT 1 FROM issues WHERE entity='order' AND entity_id=? AND issue_type='External fulfillment' AND resolved_at IS NULL",(oid,)).fetchone()
                        if not exists: engine.issue(db,'shopify','order',oid,'External fulfillment','Shopify fulfillment changed. Confirm physical dispatch in Packing; no stock is silently deducted.')
                if db.execute('SELECT 1 FROM orders WHERE id=?',(oid,)).fetchone():
                    db.execute('UPDATE orders SET source_updated_at=?,fulfillment_state=? WHERE id=?',(incoming_time,p.get('fulfillment_status'),oid))
            db.execute("UPDATE webhook_inbox SET status='DONE',error=NULL,processed_at=? WHERE id=?",(now(),event_id))
    except Exception as exc:
        with engine.connect() as db:
            db.execute("UPDATE webhook_inbox SET status='ERROR',error=?,processed_at=? WHERE id=?",(str(exc)[:1000],now(),event_id))


def enqueue(engine, event_id, topic, shop, payload):
    with engine.connect() as db:
        db.execute('INSERT OR IGNORE INTO webhook_inbox(id,topic,shop,payload,created_at) VALUES(?,?,?,?,?)',(event_id,topic,shop,encode(payload),now()))


def process_pending(engine, budget_seconds=20, storage=None):
    started=time.monotonic()
    retry_before=(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat()
    with engine.connect() as db:
        ids=[r[0] for r in db.execute("SELECT id FROM webhook_inbox WHERE status='PENDING' OR (status='ERROR' AND (processed_at IS NULL OR processed_at<?)) ORDER BY CASE WHEN status='PENDING' THEN 0 ELSE 1 END,COALESCE(processed_at,created_at),created_at LIMIT 25",(retry_before,))]
    processed=0
    for event_id in ids:
        if time.monotonic()-started>=budget_seconds: break
        process_one(engine,event_id,storage)
        processed+=1
    return processed
