-- Prepared only: requires approval before creating application access.
-- NOLOGIN prevents use until the owner assigns a password and enables LOGIN.
-- Does not reset or alter the existing postgres/CRM credentials.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='procurement_app') THEN
    RAISE EXCEPTION 'procurement_app already exists; inspect its access before continuing';
  END IF;
END $$;
CREATE ROLE procurement_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE postgres TO procurement_app;
GRANT USAGE ON SCHEMA procurement TO procurement_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA procurement TO procurement_app;
REVOKE UPDATE ON procurement.audit_events, procurement.inventory_movements,
  procurement.price_history, procurement.payment_events FROM procurement_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA procurement TO procurement_app;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='procurement' LOOP
    EXECUTE format('CREATE POLICY procurement_backend ON procurement.%I FOR ALL TO procurement_app USING (true) WITH CHECK (true)',t);
  END LOOP;
END $$;
COMMIT;
