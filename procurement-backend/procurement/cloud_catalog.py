"""Read-only, published projection of Catalog Intelligence canonical records."""
import json
from .catalog import Catalog
from .postgres import PostgresConnection


class CloudCatalog(Catalog):
    def __init__(self, dsn):
        self.root = None
        self.demo = False
        self.products = {}
        self.by_shopify = {}
        with PostgresConnection(dsn) as db:
            records = db.execute('SELECT payload FROM catalog_projection').fetchall()
        for record in records:
            product = json.loads(record['payload'])
            key = product['id']
            sid = str(product['shopify_variant_id']).split('/')[-1]
            if sid in self.by_shopify:
                raise ValueError('Ambiguous canonical Shopify mapping')
            self.products[key] = product
            self.by_shopify[sid] = key
        if not self.products:
            raise ValueError('Publish the authoritative catalog projection before starting production')
