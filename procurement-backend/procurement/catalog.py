import json
from pathlib import Path


class Catalog:
    """Read-only projection of existing canonical identities and vendor relationships."""
    def __init__(self, root=None, demo=False):
        self.root = Path(root).resolve() if root else None
        self.demo = demo
        self.products = {}
        self.by_shopify = {}
        if demo:
            for key, title, stock in [('DEMO-A', 'Antique Dual Wall Light', 3), ('DEMO-B', 'Opal Glass Pendant', 0)]:
                self.products[key+'::DEFAULT'] = dict(id=key+'::DEFAULT', product_id=key, title=title,
                    sku='BB-'+key, image='', shopify_variant_id=key, opening=stock,
                    vendors=[dict(id='Demo Artistica', supplier_sku='TEST-'+key, price=1250, source='DEMO ONLY')])
        else:
            if not self.root:
                raise ValueError('CATALOG_ROOT is required; no independent product master is created.')
            master = self.read('data/master_catalog/master_catalog_data.json')
            mappings = self.read('data/master_catalog/catalog_growth_draft_state.json')['records']
            offers = master.get('vendor_offers_current', [])
            clusters = {p['cluster_id']: p for p in master.get('matched_clusters', []) if p.get('cluster_id')}
            for cid, mapping in mappings.items():
                vid = mapping.get('shopify_variant_id')
                if not vid:
                    continue
                rows = [o for o in offers if o.get('cluster_id') == cid]
                cluster = clusters.get(cid, {})
                vendors = []
                for row in rows:
                    vendor = str(row.get('vendor', '')).strip()
                    if vendor and not any(v['id'] == vendor and v['supplier_sku'] == row.get('model','') for v in vendors):
                        vendors.append(dict(id=vendor, supplier_sku=row.get('model',''), price=row.get('net_vendor_price'),
                            source=row.get('offer_key'), cycle=row.get('cycle'), lead_time_days=None))
                self.products[cid+'::DEFAULT'] = dict(id=cid+'::DEFAULT', product_id=cid,
                    title=mapping.get('shopify_title') or cid, sku='BB-'+cid,
                    shopify_product_id=mapping.get('shopify_product_id'), shopify_variant_id=vid,
                    image=(rows[0].get('image_path','') if rows else cluster.get('representative_image_path','')),
                    vendors=vendors, opening=0)
        for key, product in self.products.items():
            sid = str(product['shopify_variant_id']).split('/')[-1]
            if sid in self.by_shopify:
                raise ValueError('Ambiguous Shopify variant mapping: '+sid)
            self.by_shopify[sid] = key

    def read(self, name):
        return json.loads((self.root / name).read_text(encoding='utf-8-sig'))

    def get(self, key):
        if key not in self.products:
            raise ValueError('Unknown canonical variant: '+str(key))
        return self.products[key]

    def vendor(self, key, vendor):
        matches = [v for v in self.get(key)['vendors'] if v['id'] == vendor]
        if not matches:
            raise ValueError('Vendor must come from the current Catalog Intelligence relationship.')
        return matches[0]

    def image_path(self, key):
        raw = self.get(key)['image']
        if not raw or not self.root:
            return None
        path = Path(raw)
        path = (path if path.is_absolute() else self.root/path).resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            return None
        return path
