"""Publish an authenticated Shopify CLI catalog export to Procurement."""
import argparse
import json
import os

from procurement.cloud_catalog import CloudCatalog
from procurement.engine import Engine
from procurement.shopify_catalog import graphql_records, sync_records
from procurement.storage import SupabaseStorage


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    args = parser.parse_args()
    document = json.loads(open(args.input, encoding='utf-8-sig').read())
    dsn = os.environ['PROCUREMENT_DATABASE_URL']
    engine = Engine(dsn, CloudCatalog(dsn))
    storage = SupabaseStorage(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])
    result = sync_records(engine, graphql_records(document), storage, actor='deployment')
    print(f"Synced {result['variants']} Shopify variants; {len(result['image_errors'])} image errors.")
    if result['image_errors']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
