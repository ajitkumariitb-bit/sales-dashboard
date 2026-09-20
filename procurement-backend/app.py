"""Vercel Flask entry point. No filesystem database, daemon, or demo fallback."""
import os
from procurement.app import create_app
from procurement.cloud_catalog import CloudCatalog
from procurement.engine import Engine
from procurement.storage import SupabaseStorage

dsn = os.environ['PROCUREMENT_DATABASE_URL']
engine = Engine(dsn, CloudCatalog(dsn))
storage = SupabaseStorage(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
app = create_app(engine, '/tmp/bb-procurement', storage=storage, serverless=True)
