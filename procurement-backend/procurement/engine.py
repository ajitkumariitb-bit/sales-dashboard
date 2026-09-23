import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from werkzeug.security import generate_password_hash


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix+'-'+uuid.uuid4().hex[:16]


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def integer(value, minimum=0):
    if isinstance(value, bool) or str(value).strip() != str(int(value)) or int(value) < minimum:
        raise ValueError('Quantity must be a whole number at least '+str(minimum))
    return int(value)


def money(value):
    try:
        d = Decimal(str(value))
        if not d.is_finite() or d < 0 or d.as_tuple().exponent < -2:
            raise ValueError('Price must be non-negative with at most two decimal places.')
        return int(d*100)
    except InvalidOperation:
        raise ValueError('Invalid price')


PAYMENTS = {'NOT_REQUIRED','PAYMENT_REQUESTED','PAYMENT_PENDING','PAID','PAYMENT_FAILED'}
PERMISSIONS = {
    'PROCUREMENT': {'purchase','transit','payment','receive','issue','asset','requirement'},
    'PACKING': {'pick','pack','ship','issue'}, 'SALES': set(),
}


class Connection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


class Engine:
    def __init__(self, path, catalog):
        self.path = str(path)
        self.catalog = catalog
        self.postgres = self.path.startswith(('postgres://', 'postgresql://'))
        if self.postgres:
            # Production migrations are explicitly applied, never on a request.
            return
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(Path(__file__).with_name('schema.sql').read_text())

    def connect(self):
        if self.postgres:
            from .postgres import PostgresConnection
            return PostgresConnection(self.path)
        db = sqlite3.connect(self.path, timeout=20, isolation_level=None, factory=Connection)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            self.check(db)
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def rows(self, db, sql, args=()):
        return [dict(r) for r in db.execute(sql,args)]

    def one(self, db, table, key):
        # Table names are internal constants, never supplied by HTTP callers.
        row = db.execute(f'SELECT * FROM {table} WHERE id=?',(key,)).fetchone()
        if row is None:
            raise ValueError('Record not found')
        return dict(row)

    def audit(self, db, actor, entity, key, before, after, action, reason=''):
        db.execute('INSERT INTO audit_events(user_id,timestamp,entity,entity_id,previous,current,action,reason) VALUES(?,?,?,?,?,?,?,?)',
            (actor,now(),entity,key,encode(before),encode(after),action,reason))

    def outbox(self, db, event, payload):
        db.execute('INSERT INTO catalog_outbox(event_type,payload,created_at) VALUES(?,?,?)',(event,encode(payload),now()))

    def vendor_offer(self, db, variant, data):
        """Use a catalog vendor, a previously purchased vendor, or an explicitly entered new source."""
        name=str(data.get('vendor','')).strip()
        if not name or len(name)>120 or any(ord(char)<32 for char in name):
            raise ValueError('Enter a vendor name up to 120 characters.')
        try:
            return dict(self.catalog.vendor(variant,name),new=False)
        except ValueError:
            prior=db.execute('SELECT vendor,supplier_sku,unit_paise FROM batches WHERE variant=? AND vendor=? ORDER BY created_at DESC LIMIT 1',(variant,name)).fetchone()
            if prior:
                return dict(id=prior['vendor'],supplier_sku=prior['supplier_sku'],price=prior['unit_paise']/100,
                    source='PROCUREMENT_HISTORY',new=False)
            if not data.get('new_vendor'):
                raise ValueError('This vendor is not in Catalog Intelligence or prior procurement history.')
            supplier_sku=str(data.get('supplier_sku','')).strip()
            if len(supplier_sku)>120 or any(ord(char)<32 for char in supplier_sku):
                raise ValueError('Supplier SKU must be no more than 120 characters.')
            return dict(id=name,supplier_sku=supplier_sku,source='PROCUREMENT_ENTRY',new=True)

    def stock(self, db, variant):
        self.catalog.get(variant)
        db.execute('INSERT OR IGNORE INTO inventory(variant,updated_at) VALUES(?,?)',(variant,now()))
        row = dict(db.execute('SELECT * FROM inventory WHERE variant=?',(variant,)).fetchone())
        row['reserved'] = db.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE variant=? AND status='ACTIVE'",(variant,)).fetchone()[0]
        row['available'] = row['physical']-row['reserved']
        row['incoming'] = db.execute("SELECT COALESCE(SUM(quantity-received),0) FROM batches WHERE variant=? AND status!='RECEIVED' AND short_closed=0",(variant,)).fetchone()[0]
        return row

    def move(self, db, actor, variant, delta, damaged, kind, ref, note):
        before = self.stock(db,variant)
        if before['physical']+delta < before['reserved'] or before['damaged']+damaged < 0:
            raise ValueError('Adjustment would consume reserved stock or make stock negative. Correct allocations first.')
        db.execute('UPDATE inventory SET physical=physical+?, damaged=damaged+?,updated_at=? WHERE variant=?',(delta,damaged,now(),variant))
        db.execute('INSERT INTO inventory_movements VALUES(?,?,?,?,?,?,?,?,?)',(uid('MOV'),variant,delta,damaged,kind,ref,actor,note,now()))
        self.audit(db,actor,'inventory',variant,before,self.stock(db,variant),kind,note)

    def check(self, db):
        for row in db.execute('SELECT * FROM inventory'):
            reserved = db.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE variant=? AND status='ACTIVE'",(row['variant'],)).fetchone()[0]
            ledger = db.execute('SELECT COALESCE(SUM(quantity_delta),0),COALESCE(SUM(damaged_delta),0) FROM inventory_movements WHERE variant=?',(row['variant'],)).fetchone()
            if not (0 <= reserved <= row['physical']) or tuple(ledger)!=(row['physical'],row['damaged']):
                raise ValueError('Inventory invariant failed; transaction rolled back')
        for line in db.execute('SELECT * FROM order_lines'):
            reserved = db.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE line_id=? AND status='ACTIVE'",(line['id'],)).fetchone()[0]
            if reserved > line['quantity'] or not 0 <= line['picked'] <= line['quantity']:
                raise ValueError('Order allocation invariant failed')
        if db.execute('SELECT 1 FROM batches WHERE received>quantity LIMIT 1').fetchone():
            raise ValueError('Over-receipt invariant failed')

    def refresh(self, db, actor='system'):
        for order in self.rows(db,"SELECT * FROM orders WHERE status NOT IN ('SHIPPED','CANCELLED') ORDER BY created_at,id"):
            shortage = 0
            for line in self.rows(db,'SELECT * FROM order_lines WHERE order_id=?',(order['id'],)):
                reserved = db.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE line_id=? AND status='ACTIVE'",(line['id'],)).fetchone()[0]
                left = line['quantity']-reserved
                shortage += left
                existing = db.execute('SELECT * FROM requirements WHERE line_id=?',(line['id'],)).fetchone()
                if existing:
                    if existing['outstanding'] != left:
                        db.execute('UPDATE requirements SET outstanding=?,updated_at=? WHERE id=?',(left,now(),existing['id']))
                        self.audit(db,actor,'requirement',existing['id'],dict(existing),{'outstanding':left},'RECALCULATE')
                elif left:
                    requirement_id=uid('REQ')
                    db.execute('INSERT INTO requirements(id,line_id,variant,shortage,outstanding,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
                        (requirement_id,line['id'],line['variant'],left,left,now(),now()))
                    self.audit(db,actor,'requirement',requirement_id,None,{'line_id':line['id'],'outstanding':left},'SHORTAGE_CREATED')
            target = 'WAITING_FOR_PROCUREMENT' if shortage else ('PACKED' if order['status']=='PACKED' else 'READY_FOR_PACKING')
            if target != order['status']:
                db.execute('UPDATE orders SET status=?,updated_at=? WHERE id=?',(target,now(),order['id']))
                self.audit(db,actor,'order',order['id'],order['status'],target,'READINESS')

    def allocate(self, db, actor):
        lines = self.rows(db,"SELECT l.* FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.status NOT IN ('CANCELLED','SHIPPED') ORDER BY o.created_at,o.id,l.id")
        for line in lines:
            have = db.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE line_id=? AND status='ACTIVE'",(line['id'],)).fetchone()[0]
            take = min(line['quantity']-have,self.stock(db,line['variant'])['available'])
            if take:
                rid=uid('RES')
                db.execute('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,NULL)',(rid,line['order_id'],line['id'],line['variant'],take,'ACTIVE',now()))
                db.execute('UPDATE inventory SET updated_at=? WHERE variant=?',(now(),line['variant']))
                self.audit(db,actor,'reservation',rid,None,{'line':line['id'],'quantity':take},'RESERVE')
        self.refresh(db,actor)

    def release(self, db, actor, order_id):
        for row in self.rows(db,"SELECT * FROM reservations WHERE order_id=? AND status='ACTIVE'",(order_id,)):
            db.execute("UPDATE reservations SET status='RELEASED',released_at=? WHERE id=?",(now(),row['id']))
            db.execute('UPDATE inventory SET updated_at=? WHERE variant=?',(now(),row['variant']))
            self.audit(db,actor,'reservation',row['id'],row,{'status':'RELEASED'},'RELEASE')
        db.execute('UPDATE order_lines SET picked=0 WHERE order_id=?',(order_id,))

    def ingest(self, db, actor, payload, source='SHOPIFY'):
        order_id = str(payload['id'])
        old = db.execute('SELECT * FROM orders WHERE id=?',(order_id,)).fetchone()
        if old:
            # Distinct webhook delivery IDs must not create duplicate demand.
            return {'order_id':order_id,'duplicate':True}
        lines = payload.get('lines',[])
        if not lines:
            raise ValueError('An accepted order must contain at least one mapped line.')
        if len({str(x['id']) for x in lines})!=len(lines):
            raise ValueError('Duplicate order line IDs')
        for line in lines:
            self.catalog.get(line['variant'])
            integer(line['quantity'],1)
        stamp=payload.get('created_at') or now()
        db.execute('INSERT INTO orders(id,number,customer,source,created_at,updated_at,source_updated_at,fulfillment_state,note) VALUES(?,?,?,?,?,?,?,?,?)',
            (order_id,str(payload['number']),payload.get('customer','Customer'),source,stamp,now(),payload.get('updated_at'),payload.get('fulfillment_state'),payload.get('note','')))
        for line in lines:
            db.execute('INSERT INTO order_lines(id,order_id,variant,quantity,snapshot) VALUES(?,?,?,?,?)',
                (order_id+':'+str(line['id']),order_id,line['variant'],int(line['quantity']),encode(self.catalog.get(line['variant']))))
        self.audit(db,actor,'order',order_id,None,payload,'ORDER_ACCEPTED')
        self.allocate(db,actor)
        return {'order_id':order_id}

    def cancel(self, db, actor, order_id, reason):
        old=self.one(db,'orders',order_id)
        if old['status']=='CANCELLED': return {'order_id':order_id}
        if old['status']=='SHIPPED': raise ValueError('Shipped order requires a return, not cancellation.')
        self.release(db,actor,order_id)
        db.execute("UPDATE orders SET status='CANCELLED',updated_at=? WHERE id=?",(now(),order_id))
        db.execute('UPDATE requirements SET outstanding=0,updated_at=? WHERE line_id IN (SELECT id FROM order_lines WHERE order_id=?)',(now(),order_id))
        self.audit(db,actor,'order',order_id,old,'CANCELLED','CANCEL',reason)
        self.allocate(db,actor)
        return {'order_id':order_id}

    def bootstrap(self, name, password):
        if len(password)<12: raise ValueError('Use a password of at least 12 characters.')
        with self.transaction() as db:
            if db.execute('SELECT 1 FROM users').fetchone(): raise ValueError('Users already exist; bootstrap disabled.')
            db.execute('INSERT INTO users VALUES(?,?,?,?,1,?)',('admin',name,generate_password_hash(password),'ADMIN',now()))
            self.audit(db,'setup','user','admin',None,{'name':name,'role':'ADMIN'},'CREATE')

    def perform(self, actor, action, data, key):
        if not key or len(key)>200: raise ValueError('An idempotency key is required.')
        fingerprint=hashlib.sha256(encode([actor,action,data]).encode()).hexdigest()
        with self.transaction() as db:
            user=self.one(db,'users',actor)
            if not user['active'] or (user['role']!='ADMIN' and action not in PERMISSIONS.get(user['role'],set())):
                raise PermissionError('This role cannot perform that action.')
            saved=db.execute('SELECT * FROM idempotency WHERE key=?',(key,)).fetchone()
            if saved:
                if saved['fingerprint']!=fingerprint: raise ValueError('Idempotency key reused with different data.')
                return json.loads(saved['result'])
            result=self._action(db,actor,user['role'],action,data)
            db.execute('INSERT INTO idempotency VALUES(?,?,?,?)',(key,fingerprint,encode(result),now()))
            return result

    def _action(self, db, actor, role, action, d):
        if action=='order':
            return self.ingest(db,actor,d,'MANUAL')
        if action=='cancel':
            return self.cancel(db,actor,d['id'],d.get('reason',''))
        if action=='order_quantity':
            line=self.one(db,'order_lines',d['line_id']); order=self.one(db,'orders',line['order_id'])
            if not d.get('reason') or order['status'] in {'PACKED','SHIPPED','CANCELLED'}:
                raise ValueError('Quantity corrections require a reason and an unshipped, unpacked active order.')
            quantity=integer(d['quantity'],1)
            self.release(db,actor,order['id'])
            db.execute('UPDATE order_lines SET quantity=? WHERE id=?',(quantity,line['id']))
            self.audit(db,actor,'order_line',line['id'],line,{'quantity':quantity},'ADMIN_QUANTITY_CORRECTION',d['reason'])
            self.allocate(db,actor)
            return {'ok':True}
        if action=='allocation_problem':
            line=self.one(db,'order_lines',d['line_id']); order=self.one(db,'orders',line['order_id'])
            if order['status'] in {'SHIPPED','CANCELLED'} or not d.get('reason'):
                raise ValueError('Use an active order and provide a reason.')
            q=integer(d['quantity'],1); kind=d.get('kind')
            if kind not in {'Damaged','Missing'}: raise ValueError('Choose Damaged or Missing.')
            active=self.rows(db,"SELECT * FROM reservations WHERE line_id=? AND status='ACTIVE'",(line['id'],))
            if sum(r['quantity'] for r in active)<q: raise ValueError('Cannot remove more than the reserved quantity.')
            left=q
            for r in active:
                take=min(left,r['quantity'])
                if not take: break
                db.execute("UPDATE reservations SET status='RELEASED',released_at=? WHERE id=?",(now(),r['id']))
                if take<r['quantity']:
                    db.execute('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,NULL)',(uid('RES'),line['order_id'],line['id'],line['variant'],r['quantity']-take,'ACTIVE',now()))
                self.audit(db,actor,'reservation',r['id'],r,{'released_quantity':take},'PHYSICAL_EXCEPTION',d['reason'])
                left-=take
            db.execute('UPDATE order_lines SET picked=0 WHERE order_id=?',(line['order_id'],))
            db.execute("UPDATE orders SET status='WAITING_FOR_PROCUREMENT',updated_at=? WHERE id=?",(now(),line['order_id']))
            self.move(db,actor,line['variant'],-q,q if kind=='Damaged' else 0,'DAMAGE' if kind=='Damaged' else 'STOCK_CORRECTION',line['id'],d['reason'])
            self.issue(db,actor,'order',line['order_id'],kind,d['reason'])
            self.allocate(db,actor)
            return {'ok':True}
        if action=='adjust':
            if not d.get('reason','').strip(): raise ValueError('An inventory adjustment reason is required.')
            delta=int(d['delta'])
            if str(delta)!=str(d['delta']): raise ValueError('Use whole units.')
            kind=d.get('kind','MANUAL_ADJUSTMENT')
            if kind not in {'OPENING_STOCK','MANUAL_ADJUSTMENT','STOCK_CORRECTION','RETURN','RTO','DAMAGE'}: raise ValueError('Invalid movement type')
            if kind in {'RETURN','RTO','OPENING_STOCK'} and delta<0: raise ValueError('This movement must add stock.')
            if kind=='DAMAGE' and delta>=0: raise ValueError('Damage must remove usable stock.')
            self.move(db,actor,d['variant'],delta,-delta if kind=='DAMAGE' else 0,kind,uid('ADJ'),d['reason'])
            self.allocate(db,actor)
            return self.stock(db,d['variant'])
        if action=='purchase':
            p=self.catalog.get(d['variant']); quantity=integer(d['quantity'],1); price=money(d['price'])
            v=self.vendor_offer(db,d['variant'],d); payment=d.get('payment','PAYMENT_PENDING')
            if payment not in PAYMENTS: raise ValueError('Invalid payment state')
            needed=db.execute('SELECT COALESCE(SUM(outstanding),0) FROM requirements WHERE variant=?',(d['variant'],)).fetchone()[0]
            uncovered=max(0,needed-self.stock(db,d['variant'])['incoming'])
            if not needed and role!='ADMIN': raise PermissionError('Only Admin can create procurement without customer demand.')
            bid=uid('PB'); stamp=now()
            db.execute('INSERT INTO batches(id,variant,vendor,supplier_sku,quantity,required_for_orders,unit_paise,status,payment,created_at,updated_at,invoice,notes,expected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (bid,d['variant'],v['id'],v['supplier_sku'],quantity,min(uncovered,quantity),price,'PURCHASED',payment,stamp,stamp,d.get('invoice'),d.get('notes',''),d.get('expected_at')))
            db.execute('INSERT INTO price_history VALUES(?,?,?,?,?,?,?,?)',(uid('PRICE'),bid,d['variant'],v['id'],price,quantity,actor,stamp))
            db.execute('INSERT INTO payment_events VALUES(?,?,?,?,?,?)',(uid('PAY'),bid,None,payment,actor,stamp))
            after=self.one(db,'batches',bid)
            self.audit(db,actor,'batch',bid,None,after,'PURCHASE')
            if v['new']:
                self.outbox(db,'VENDOR_RELATIONSHIP_CAPTURED',dict(product_id=p['product_id'],variant=d['variant'],
                    vendor=v['id'],supplier_sku=v['supplier_sku'],unit_paise=price,batch_id=bid,
                    verification_status='PENDING_CATALOG_REVIEW'))
            self.outbox(db,'PURCHASE_RECORDED',dict(after,product_id=p['product_id']))
            return after
        if action in {'transit','payment','short_close','batch_edit'}:
            b=self.one(db,'batches',d['id'])
            if action=='transit':
                if b['status']=='RECEIVED': raise ValueError('Received goods cannot move back to transit.')
                if b['status']!='IN_TRANSIT': db.execute("UPDATE batches SET status='IN_TRANSIT',transit_at=?,updated_at=? WHERE id=?",(now(),now(),b['id']))
            elif action=='payment':
                if d['payment'] not in PAYMENTS: raise ValueError('Invalid payment state')
                if b['payment']!=d['payment']:
                    db.execute('UPDATE batches SET payment=?,updated_at=? WHERE id=?',(d['payment'],now(),b['id']))
                    db.execute('INSERT INTO payment_events VALUES(?,?,?,?,?,?)',(uid('PAY'),b['id'],b['payment'],d['payment'],actor,now()))
            elif action=='short_close':
                if not d.get('reason'): raise ValueError('Short-close reason is required.')
                db.execute("UPDATE batches SET short_closed=1,status='RECEIVED',received_at=?,updated_at=? WHERE id=?",(now(),now(),b['id']))
            else:
                if b['received'] or b['short_closed']: raise ValueError('Received purchase facts cannot be overwritten.')
                if not d.get('reason'): raise ValueError('Correction reason is required.')
                v=self.vendor_offer(db,b['variant'],d); q=integer(d['quantity'],1); price=money(d['price'])
                db.execute('UPDATE batches SET vendor=?,supplier_sku=?,quantity=?,unit_paise=?,updated_at=? WHERE id=?',(v['id'],v['supplier_sku'],q,price,now(),b['id']))
                db.execute('INSERT INTO price_history VALUES(?,?,?,?,?,?,?,?)',(uid('PRICE'),b['id'],b['variant'],v['id'],price,q,actor,now()))
            after=self.one(db,'batches',b['id'])
            if b!=after:
                self.audit(db,actor,'batch',b['id'],b,after,action.upper(),d.get('reason',''))
                self.outbox(db,'PURCHASE_UPDATED',after)
            return after
        if action=='receive':
            b=self.one(db,'batches',d['id'])
            if b['status']=='RECEIVED': raise ValueError('Batch already received or closed.')
            good=integer(d.get('good',0)); damaged=integer(d.get('damaged',0)); wrong=integer(d.get('wrong',0)); total=good+damaged+wrong
            if total<1 or total>b['quantity']-b['received']: raise ValueError('Receipt must be positive and cannot exceed remaining expected quantity.')
            condition=d.get('condition','Good')
            if condition not in {'Good','Partial Damage','Wrong Product','Quantity Mismatch','Other Issue'}: raise ValueError('Invalid condition')
            rid=uid('GR'); stamp=now()
            db.execute('INSERT INTO goods_receipts VALUES(?,?,?,?,?,?,?,?,?)',(rid,b['id'],good,damaged,wrong,condition,d.get('note',''),actor,stamp))
            self.move(db,actor,b['variant'],good,0,'PROCUREMENT_RECEIPT',rid,d.get('note',''))
            if damaged: self.move(db,actor,b['variant'],0,damaged,'DAMAGE',rid,'Quarantined on receipt')
            received=b['received']+total; status='RECEIVED' if received==b['quantity'] else b['status']
            db.execute('UPDATE batches SET received=?,status=?,received_at=?,updated_at=? WHERE id=?',(received,status,stamp if status=='RECEIVED' else b['received_at'],stamp,b['id']))
            if damaged or wrong or condition!='Good' or received<b['quantity']:
                self.issue(db,actor,'batch',b['id'], 'Damaged' if damaged else 'Wrong item' if wrong else 'Quantity mismatch' if received<b['quantity'] else condition,d.get('note') or f'Good {good}; damaged {damaged}; wrong {wrong}; {b["quantity"]-received} still expected.')
            self.allocate(db,actor)
            self.audit(db,actor,'receipt',rid,None,{'batch':b['id'],'good':good,'damaged':damaged,'wrong':wrong},'RECEIVE')
            self.audit(db,actor,'batch',b['id'],b,self.one(db,'batches',b['id']),'RECEIPT_STATUS')
            return {'receipt_id':rid,'batch':self.one(db,'batches',b['id']),'inventory':self.stock(db,b['variant'])}
        if action in {'pick','pack','ship','reopen'}:
            order=self.one(db,'orders',d['id'])
            if action in {'pick','pack','ship'} and order['status']!='SHIPPED':
                blocked=db.execute("SELECT 1 FROM issues WHERE entity='order' AND entity_id=? AND resolved_at IS NULL LIMIT 1",(order['id'],)).fetchone()
                if blocked: raise ValueError('Resolve this order’s open issue before physical packing or shipping.')
            if action=='reopen':
                if order['status'] not in {'PACKED','READY_FOR_PACKING'} or not d.get('reason'): raise ValueError('Only packed/ready orders can be reopened with a reason.')
                db.execute('UPDATE order_lines SET picked=0 WHERE order_id=?',(order['id'],))
                db.execute("UPDATE orders SET status='READY_FOR_PACKING',updated_at=? WHERE id=?",(now(),order['id']))
            elif action=='pick':
                if order['status']!='READY_FOR_PACKING': raise ValueError('All items must be reserved before picking.')
                line=self.one(db,'order_lines',d['line_id'])
                if line['order_id']!=order['id']: raise ValueError('Line does not belong to order')
                db.execute('UPDATE order_lines SET picked=quantity WHERE id=?',(line['id'],))
            elif action=='pack':
                if order['status']=='PACKED': return order
                if order['status']!='READY_FOR_PACKING': raise ValueError('Order is not ready.')
                if db.execute('SELECT 1 FROM order_lines WHERE order_id=? AND picked!=quantity',(order['id'],)).fetchone(): raise ValueError('Confirm each item physically picked first.')
                db.execute("UPDATE orders SET status='PACKED',updated_at=? WHERE id=?",(now(),order['id']))
            else:
                if order['status']=='SHIPPED': return order
                if order['status']!='PACKED': raise ValueError('Pack before shipping.')
                for r in self.rows(db,"SELECT * FROM reservations WHERE order_id=? AND status='ACTIVE'",(order['id'],)):
                    db.execute("UPDATE reservations SET status='SHIPPED',released_at=? WHERE id=?",(now(),r['id']))
                    self.move(db,actor,r['variant'],-r['quantity'],0,'ORDER_SHIPMENT',order['id'],'Handed over')
                    self.audit(db,actor,'reservation',r['id'],r,{'status':'SHIPPED'},'SHIP')
                db.execute("UPDATE orders SET status='SHIPPED',updated_at=? WHERE id=?",(now(),order['id']))
            after=self.one(db,'orders',order['id'])
            self.audit(db,actor,'order',order['id'],order,dict(after,line_id=d.get('line_id')),action.upper(),d.get('reason',''))
            return after
        if action=='reallocate':
            if not d.get('reason'): raise ValueError('Allocation correction requires a reason.')
            source=self.one(db,'order_lines',d['source_line']); target=self.one(db,'order_lines',d['target_line']); q=integer(d['quantity'],1)
            if source['id']==target['id'] or source['variant']!=target['variant']: raise ValueError('Choose different lines for the same variant.')
            for l in [source,target]:
                if self.one(db,'orders',l['order_id'])['status'] in {'PACKED','SHIPPED','CANCELLED'}: raise ValueError('Reopen packed orders before correcting allocation.')
            active=self.rows(db,"SELECT * FROM reservations WHERE line_id=? AND status='ACTIVE'",(source['id'],))
            target_reserved=db.execute("SELECT COALESCE(SUM(quantity),0) FROM reservations WHERE line_id=? AND status='ACTIVE'",(target['id'],)).fetchone()[0]
            if sum(r['quantity'] for r in active)<q or target_reserved+q>target['quantity']: raise ValueError('Invalid allocation quantity')
            left=q
            for r in active:
                take=min(left,r['quantity'])
                if not take: break
                db.execute("UPDATE reservations SET status='RELEASED',released_at=? WHERE id=?",(now(),r['id']))
                if r['quantity']>take:
                    db.execute('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,NULL)',(uid('RES'),source['order_id'],source['id'],source['variant'],r['quantity']-take,'ACTIVE',now()))
                left-=take
            db.execute('INSERT INTO reservations VALUES(?,?,?,?,?,?,?,NULL)',(uid('RES'),target['order_id'],target['id'],target['variant'],q,'ACTIVE',now()))
            db.execute('UPDATE order_lines SET picked=0 WHERE id IN (?,?)',(source['id'],target['id']))
            self.audit(db,actor,'allocation',target['id'],active,d,'REALLOCATE',d['reason']); self.refresh(db,actor)
            return {'ok':True}
        if action=='requirement':
            old=self.one(db,'requirements',d['id']); vendor=d.get('vendor')
            if vendor: self.vendor_offer(db,old['variant'],d)
            if role!='ADMIN' and any(k in d for k in ['priority','required_by']): raise PermissionError('Only Admin changes priority/due dates.')
            db.execute('UPDATE requirements SET assigned_vendor=?,priority=?,required_by=?,notes=?,updated_at=? WHERE id=?',
                (vendor or old['assigned_vendor'],integer(d.get('priority',old['priority'])),d.get('required_by',old['required_by']),d.get('notes',old['notes']),now(),old['id']))
            after=self.one(db,'requirements',old['id']); self.audit(db,actor,'requirement',old['id'],old,after,'EDIT'); return after
        if action=='availability':
            if d['value'] not in {'GREEN','AMBER','RED'}: raise ValueError('Invalid availability')
            before=self.stock(db,d['variant'])
            db.execute('UPDATE inventory SET availability=?,fresh_photos=?,updated_at=? WHERE variant=?',(d['value'],int(bool(d.get('fresh_photos'))),now(),d['variant']))
            after=self.stock(db,d['variant']); self.audit(db,actor,'inventory',d['variant'],before,after,'AVAILABILITY',d.get('reason','')); self.outbox(db,'PROCUREMENT_AVAILABILITY',after); return after
        if action=='issue':
            if d['entity'] not in {'order','batch','inventory'}: raise ValueError('Invalid issue entity')
            if d['entity']=='inventory': self.catalog.get(d['id'])
            else: self.one(db,'orders' if d['entity']=='order' else 'batches',d['id'])
            return self.issue(db,actor,d['entity'],d['id'],d['type'],d['note'])
        if action=='resolve':
            old=self.one(db,'issues',d['id'])
            if not d.get('resolution','').strip(): raise ValueError('Resolution is required.')
            if old['resolved_at']: return old
            db.execute('UPDATE issues SET resolved_at=?,resolution=? WHERE id=?',(now(),d['resolution'],old['id']))
            self.audit(db,actor,'issue',old['id'],old,d,'RESOLVE'); return {'ok':True}
        if action=='asset':
            b=self.one(db,'batches',d['batch_id']); p=self.catalog.get(b['variant'])
            if not b['received']: raise ValueError('Record receipt before attaching physical evidence.')
            if d['view_type'] not in {'Full product','Side / angle','Detail / finish'}: raise ValueError('Invalid photo view')
            aid=uid('ASSET')
            db.execute('INSERT INTO assets(id,product_id,variant,batch_id,vendor,uploaded_by,uploaded_at,filename,view_type,notes) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (aid,p['product_id'],b['variant'],b['id'],b['vendor'],actor,now(),d['filename'],d['view_type'],d.get('notes','')))
            after=self.one(db,'assets',aid); self.audit(db,actor,'asset',aid,None,after,'UPLOAD'); self.outbox(db,'REAL_PROCUREMENT_PHOTO',after); return after
        if action=='review':
            old=self.one(db,'assets',d['id']); status=d['approval']
            if status not in {'APPROVED','INTERNAL_ONLY','REJECTED'}: raise ValueError('Invalid review decision')
            primary=int(bool(d.get('primary')) and status=='APPROVED')
            if primary:
                for prior in self.rows(db,'SELECT * FROM assets WHERE product_id=? AND is_primary=1',(old['product_id'],)):
                    db.execute('UPDATE assets SET is_primary=0 WHERE id=?',(prior['id'],))
                    changed=self.one(db,'assets',prior['id']); self.audit(db,actor,'asset',prior['id'],prior,changed,'UNSET_PRIMARY'); self.outbox(db,'ASSET_REVIEW',changed)
            db.execute('UPDATE assets SET approval=?,customer_visible_approved=?,is_primary=?,notes=? WHERE id=?',(status,int(status=='APPROVED'),primary,d.get('notes',''),old['id']))
            after=self.one(db,'assets',old['id']); self.audit(db,actor,'asset',old['id'],old,after,'REVIEW'); self.outbox(db,'ASSET_REVIEW',after); return after
        if action=='user':
            if d['role'] not in {'ADMIN','PROCUREMENT','SALES','PACKING'}: raise ValueError('Invalid role')
            old=db.execute('SELECT * FROM users WHERE id=?',(d['id'],)).fetchone()
            active=int(bool(d.get('active',True)))
            if old and old['role']=='ADMIN' and old['active'] and (d['role']!='ADMIN' or not active):
                if db.execute("SELECT COUNT(*) FROM users WHERE role='ADMIN' AND active=1").fetchone()[0]<=1: raise ValueError('Keep at least one active Admin.')
            password=d.get('password','')
            if not old or password:
                if len(password)<12: raise ValueError('Password must contain at least 12 characters.')
                hashed=generate_password_hash(password)
            else: hashed=old['password']
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,password=excluded.password,role=excluded.role,active=excluded.active',
                (d['id'],d['name'],hashed,d['role'],active,now()))
            safe={k:v for k,v in d.items() if k!='password'}
            self.audit(db,actor,'user',d['id'],{k:old[k] for k in ['name','role','active']} if old else None,safe,'SAVE_USER'); return safe
        if action=='settings':
            for k in ['purchased_hours','transit_hours','ready_hours']:
                if k in d:
                    value=str(integer(d[k],1)); old=db.execute('SELECT value FROM settings WHERE key=?',(k,)).fetchone()[0]
                    db.execute('UPDATE settings SET value=? WHERE key=?',(value,k)); self.audit(db,actor,'settings',k,old,value,'SET')
            return {'ok':True}
        if action=='verification':
            p=self.catalog.get(d['variant']); vid=uid('VERIFY')
            db.execute('INSERT INTO verification_tasks(id,product_id,prompt,created_at) VALUES(?,?,?,?)',(vid,p['product_id'],d['prompt'],now()))
            self.audit(db,actor,'verification',vid,None,d,'REQUEST'); return {'id':vid}
        raise ValueError('Unknown action')

    def issue(self, db, actor, entity, key, kind, note):
        if not note.strip(): raise ValueError('Describe the issue.')
        iid=uid('ISSUE')
        db.execute('INSERT INTO issues(id,entity,entity_id,issue_type,note,created_by,created_at) VALUES(?,?,?,?,?,?,?)',(iid,entity,key,kind,note,actor,now()))
        self.audit(db,actor,'issue',iid,None,{'entity':entity,'entity_id':key,'type':kind,'note':note},'REPORT')
        return {'id':iid}
