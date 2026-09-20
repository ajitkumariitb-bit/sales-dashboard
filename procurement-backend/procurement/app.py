import base64
import hashlib
import hmac
import io
import json
import os
import secrets
import threading
import time
from datetime import timedelta
from pathlib import Path
from flask import Flask, jsonify, request, session, send_file, abort
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash
from .engine import Engine, uid
from .views import state
from .webhooks import enqueue, process_pending, TOPICS


def create_app(engine, runtime, testing=False, storage=None, serverless=False):
    runtime=Path(runtime); runtime.mkdir(parents=True,exist_ok=True)
    uploads=runtime/'uploads'; uploads.mkdir(exist_ok=True)
    secret_file=runtime/'session.key'
    configured_secret=os.getenv('PROCUREMENT_SESSION_SECRET')
    if serverless and (not configured_secret or len(configured_secret)<48):
        raise ValueError('A persistent PROCUREMENT_SESSION_SECRET of at least 48 characters is required')
    if not configured_secret and not secret_file.exists(): secret_file.write_text(secrets.token_hex(48))
    app=Flask(__name__,static_folder='static',static_url_path='/static')
    app.config.update(SECRET_KEY=configured_secret or secret_file.read_text().strip(),MAX_CONTENT_LENGTH=12*1024*1024,
        SESSION_COOKIE_NAME='bb_procurement_session',
        SESSION_COOKIE_HTTPONLY=True,SESSION_COOKIE_SAMESITE='Strict',SESSION_COOKIE_SECURE=os.getenv('HTTPS_ONLY')=='1',
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),TESTING=testing)
    app.extensions['engine']=engine
    attempts={}; attempts_lock=threading.Lock()

    def current_user(admin=False):
        with engine.connect() as db:
            row=db.execute('SELECT * FROM users WHERE id=?',(session.get('user_id',''),)).fetchone()
        if not row or not row['active']: abort(401)
        # Password changes revoke previously issued sessions.
        tag=hashlib.sha256(row['password'].encode()).hexdigest()
        if session.get('auth_tag')!=tag: abort(401)
        if admin and row['role']!='ADMIN': abort(403)
        return dict(row)

    @app.before_request
    def protection():
        if request.method=='POST' and request.path!='/webhooks/shopify':
            if not session.get('csrf') or not hmac.compare_digest(request.headers.get('X-CSRF-Token',''),session['csrf']): abort(403)

    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['X-Frame-Options']='DENY'
        response.headers['Referrer-Policy']='same-origin'
        response.headers['Content-Security-Policy']="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        return response

    @app.errorhandler(Exception)
    def errors(exc):
        if isinstance(exc,HTTPException): return jsonify(error=exc.description),exc.code
        if isinstance(exc,PermissionError): return jsonify(error=str(exc)),403
        if isinstance(exc,(ValueError,KeyError,TypeError,OverflowError)): return jsonify(error=str(exc)),400
        app.logger.exception('Request failed')
        return jsonify(error='Request failed. No incomplete inventory changes were saved.'),500

    @app.get('/')
    def index(): return app.send_static_file('index.html')

    @app.get('/api/session')
    def session_info():
        session.setdefault('csrf',secrets.token_hex(24))
        result=dict(csrf=session['csrf'],demo=engine.catalog.demo,authenticated=False)
        if session.get('user_id'):
            try:
                user=current_user(); result.update(authenticated=True,user={k:user[k] for k in ['id','name','role']})
            except HTTPException: session.pop('user_id',None)
        return jsonify(result)

    @app.post('/api/login')
    def login():
        data=request.get_json(); ip=request.remote_addr
        if engine.postgres:
            # Persist the account limit across serverless instances. Unknown accounts
            # use the same path and response as known accounts.
            account=hashlib.sha256(str(data.get('id','')).encode()).hexdigest()
            with engine.transaction() as db:
                row=db.execute('SELECT * FROM login_attempts WHERE key=?',(account,)).fetchone()
                stamp=time.time()
                if row and stamp-row['started_at']<300 and row['count']>=10:
                    abort(429,description='Too many attempts. Try again in five minutes.')
                count=row['count']+1 if row and stamp-row['started_at']<300 else 1
                started=row['started_at'] if row and stamp-row['started_at']<300 else stamp
                db.execute('INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,started_at=excluded.started_at',(account,count,started))
        with attempts_lock:
            previous=[t for t in attempts.get(ip,[]) if time.time()-t<300]
            if len(previous)>=10: abort(429,description='Too many attempts. Try again in five minutes.')
            attempts[ip]=previous+[time.time()]
        with engine.connect() as db: user=db.execute('SELECT * FROM users WHERE id=?',(data.get('id',''),)).fetchone()
        if not user or not user['active'] or not check_password_hash(user['password'],data.get('password','')): abort(401,description='Incorrect username or password.')
        session.clear(); session.permanent=True; session['user_id']=user['id']; session['csrf']=secrets.token_hex(24)
        session['auth_tag']=hashlib.sha256(user['password'].encode()).hexdigest()
        with attempts_lock: attempts.pop(ip,None)
        return jsonify(csrf=session['csrf'])

    @app.post('/api/logout')
    def logout(): session.clear(); return jsonify(ok=True)

    @app.get('/api/state')
    def get_state(): return jsonify(state(engine,current_user()))

    @app.post('/api/actions/<action>')
    def action(action):
        user=current_user()
        if action=='asset': abort(400,description='Upload photos through the image endpoint.')
        return jsonify(engine.perform(user['id'],action,request.get_json(),request.headers.get('Idempotency-Key')))

    @app.get('/api/product-image/<path:variant>')
    def product_image(variant):
        current_user()
        if storage:
            name=engine.catalog.get(variant).get('storage_image')
            if not name: abort(404)
            return send_file(io.BytesIO(storage.get(name)),mimetype='image/jpeg')
        path=engine.catalog.image_path(variant)
        if not path: abort(404)
        return send_file(path)

    @app.post('/api/upload')
    def upload():
        user=current_user()
        if user['role'] not in {'ADMIN','PROCUREMENT'}: abort(403)
        key=request.headers.get('Idempotency-Key','')
        if not key: abort(400,description='Idempotency key required')
        f=request.files.get('photo')
        if not f: abort(400,description='Choose an image.')
        content=f.read()
        try:
            pic=Image.open(io.BytesIO(content))
            if pic.format not in {'JPEG','PNG','WEBP'} or pic.width*pic.height>24_000_000: raise ValueError('Use JPEG, PNG or WebP up to 24 megapixels.')
            pic=ImageOps.exif_transpose(pic).convert('RGB'); pic.thumbnail((2400,2400))
            cleaned=io.BytesIO(); pic.save(cleaned,'JPEG',quality=90)
        except (UnidentifiedImageError,OSError,Image.DecompressionBombError):
            raise ValueError('Invalid or unsupported image. Use JPEG, PNG or WebP.')
        digest=hashlib.sha256(cleaned.getvalue()).hexdigest(); name=digest+'.jpg'; path=uploads/name
        # Content-addressed assets make network retries safe. Metadata and GPS are stripped.
        if storage: storage.put(name,cleaned.getvalue())
        elif not path.exists(): path.write_bytes(cleaned.getvalue())
        data=dict(batch_id=request.form['batch_id'],filename=name,view_type=request.form['view_type'],notes=request.form.get('notes',''))
        return jsonify(engine.perform(user['id'],'asset',data,key))

    @app.get('/api/assets/<asset_id>')
    def asset(asset_id):
        current_user()
        with engine.connect() as db: row=engine.one(db,'assets',asset_id)
        if storage: return send_file(io.BytesIO(storage.get(row['filename'])),mimetype='image/jpeg')
        return send_file(uploads/row['filename'],mimetype='image/jpeg')

    @app.get('/api/catalog-outbox')
    def outbox():
        current_user(admin=True)
        after=int(request.args.get('after','0'))
        with engine.connect() as db: rows=engine.rows(db,'SELECT * FROM catalog_outbox WHERE seq>? ORDER BY seq LIMIT 500',(after,))
        for row in rows: row['payload']=json.loads(row['payload'])
        return jsonify(events=rows,next_cursor=rows[-1]['seq'] if rows else after)

    @app.get('/api/audit')
    def audit():
        current_user(admin=True); before=int(request.args.get('before',str(2**62)))
        with engine.connect() as db: rows=engine.rows(db,'SELECT * FROM audit_events WHERE seq<? ORDER BY seq DESC LIMIT 200',(before,))
        return jsonify(events=rows,next_cursor=rows[-1]['seq'] if rows else None)

    @app.post('/api/inbox/<event_id>/retry')
    def retry(event_id):
        user=current_user(admin=True)
        with engine.transaction() as db:
            old=engine.one(db,'webhook_inbox',event_id)
            if old['status']!='DONE':
                db.execute("UPDATE webhook_inbox SET status='PENDING',error=NULL WHERE id=?",(event_id,))
                engine.audit(db,user['id'],'webhook',event_id,old['status'],'PENDING','RETRY')
        if serverless:
            from .webhooks import process_one
            process_one(engine,event_id)
        return jsonify(ok=True)

    @app.post('/webhooks/shopify')
    def webhook():
        secret=os.getenv('SHOPIFY_WEBHOOK_SECRET',''); shop=os.getenv('SHOPIFY_SHOP_DOMAIN','')
        if engine.catalog.demo or not secret or not shop: abort(503,description='Live Shopify intake is not configured.')
        raw=request.get_data(); signature=base64.b64encode(hmac.new(secret.encode(),raw,hashlib.sha256).digest()).decode()
        if not hmac.compare_digest(signature,request.headers.get('X-Shopify-Hmac-SHA256','')): abort(401)
        if request.headers.get('X-Shopify-Shop-Domain','')!=shop: abort(403)
        topic=request.headers.get('X-Shopify-Topic',''); event=request.headers.get('X-Shopify-Webhook-Id','')
        if topic not in TOPICS or not event: abort(400,description='Unsupported topic or missing delivery ID')
        payload=json.loads(raw)
        if not isinstance(payload,dict) or 'id' not in payload: abort(400)
        enqueue(engine,shop+':'+event,topic,shop,payload)
        if serverless:
            # Finish inside the invocation; never rely on a daemon after response.
            # Failed processing remains durably queued/error-visible for reconciliation.
            from .webhooks import process_one
            process_one(engine,shop+':'+event)
        return jsonify(accepted=True)

    return app


def start_worker(engine):
    stop=threading.Event()
    def run():
        while not stop.is_set():
            try: process_pending(engine)
            except Exception:
                import logging
                logging.exception('Inbox worker failed; durable events remain retryable')
            stop.wait(2)
    threading.Thread(target=run,daemon=True,name='shopify-inbox').start()
    return stop
