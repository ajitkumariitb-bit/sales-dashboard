PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('ADMIN','PROCUREMENT','SALES','PACKING')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory(variant TEXT PRIMARY KEY, physical INTEGER NOT NULL DEFAULT 0 CHECK(physical>=0),
 damaged INTEGER NOT NULL DEFAULT 0 CHECK(damaged>=0), availability TEXT NOT NULL DEFAULT 'AMBER' CHECK(availability IN ('GREEN','AMBER','RED')),
 fresh_photos INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, number TEXT NOT NULL, customer TEXT NOT NULL, source TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'WAITING_FOR_PROCUREMENT', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 source_updated_at TEXT, fulfillment_state TEXT, note TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS order_lines(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), variant TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0), picked INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id),
 line_id TEXT NOT NULL REFERENCES order_lines(id), variant TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0),
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','RELEASED','SHIPPED')), created_at TEXT NOT NULL, released_at TEXT);
CREATE INDEX IF NOT EXISTS reserved_variant ON reservations(variant,status);
CREATE TABLE IF NOT EXISTS requirements(id TEXT PRIMARY KEY, line_id TEXT NOT NULL UNIQUE REFERENCES order_lines(id), variant TEXT NOT NULL,
 shortage INTEGER NOT NULL, outstanding INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
 assigned_vendor TEXT, required_by TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, variant TEXT NOT NULL, vendor TEXT NOT NULL, supplier_sku TEXT NOT NULL,
 quantity INTEGER NOT NULL CHECK(quantity>0), required_for_orders INTEGER NOT NULL, unit_paise INTEGER NOT NULL CHECK(unit_paise>=0),
 status TEXT NOT NULL CHECK(status IN ('PURCHASED','IN_TRANSIT','RECEIVED')), payment TEXT NOT NULL,
 received INTEGER NOT NULL DEFAULT 0 CHECK(received>=0), short_closed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, transit_at TEXT, received_at TEXT, expected_at TEXT,
 invoice TEXT, notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS goods_receipts(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id),
 good INTEGER NOT NULL, damaged INTEGER NOT NULL, wrong INTEGER NOT NULL, condition TEXT NOT NULL, note TEXT,
 user_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_movements(id TEXT PRIMARY KEY, variant TEXT NOT NULL, quantity_delta INTEGER NOT NULL,
 damaged_delta INTEGER NOT NULL DEFAULT 0, movement_type TEXT NOT NULL, reference_id TEXT NOT NULL, user_id TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS price_history(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), variant TEXT NOT NULL,
 vendor TEXT NOT NULL, unit_paise INTEGER NOT NULL, quantity INTEGER NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_events(id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES batches(id), previous TEXT, current TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issues(id TEXT PRIMARY KEY, entity TEXT NOT NULL, entity_id TEXT NOT NULL, issue_type TEXT NOT NULL,
 note TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT);
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, product_id TEXT NOT NULL, variant TEXT NOT NULL, batch_id TEXT NOT NULL REFERENCES batches(id),
 vendor TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL, filename TEXT NOT NULL, view_type TEXT NOT NULL,
 source_type TEXT NOT NULL DEFAULT 'REAL_PROCUREMENT_PHOTO', approval TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
 customer_visible_approved INTEGER NOT NULL DEFAULT 0, is_primary INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS verification_tasks(id TEXT PRIMARY KEY, product_id TEXT NOT NULL, prompt TEXT NOT NULL,
 answer TEXT, created_at TEXT NOT NULL, completed_at TEXT, completed_by TEXT);
CREATE TABLE IF NOT EXISTS audit_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, timestamp TEXT NOT NULL,
 entity TEXT NOT NULL, entity_id TEXT NOT NULL, previous TEXT, current TEXT, action TEXT NOT NULL, reason TEXT);
CREATE TABLE IF NOT EXISTS catalog_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_inbox(id TEXT PRIMARY KEY, topic TEXT NOT NULL, shop TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', error TEXT, created_at TEXT NOT NULL, processed_at TEXT);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES('purchased_hours','48');
INSERT OR IGNORE INTO settings VALUES('transit_hours','72');
INSERT OR IGNORE INTO settings VALUES('ready_hours','24');
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS movement_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS movement_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'Ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS price_no_update BEFORE UPDATE ON price_history BEGIN SELECT RAISE(ABORT,'Prices are immutable'); END;
CREATE TRIGGER IF NOT EXISTS price_no_delete BEFORE DELETE ON price_history BEGIN SELECT RAISE(ABORT,'Prices are immutable'); END;
CREATE TRIGGER IF NOT EXISTS payment_no_update BEFORE UPDATE ON payment_events BEGIN SELECT RAISE(ABORT,'Payments are immutable'); END;
CREATE TRIGGER IF NOT EXISTS payment_no_delete BEFORE DELETE ON payment_events BEGIN SELECT RAISE(ABORT,'Payments are immutable'); END;
