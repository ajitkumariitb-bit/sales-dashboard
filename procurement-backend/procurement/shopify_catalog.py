"""Shopify catalog projection without inventing supplier relationships."""
import hashlib
import io
import json
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from PIL import Image, ImageOps, UnidentifiedImageError

from .engine import now


MAX_IMAGE_BYTES = 12 * 1024 * 1024


def numeric_id(value):
    return str(value or '').split('/')[-1]


def display_title(product_title, variant_title):
    variant = str(variant_title or '').strip()
    return str(product_title or 'Shopify product').strip() + (f' · {variant}' if variant and variant != 'Default Title' else '')


def graphql_records(document):
    variants = (document.get('productVariants') or document.get('data', {}).get('productVariants') or {}).get('nodes', [])
    records = []
    for variant in variants:
        product = variant.get('product') or {}
        media = ((variant.get('media') or {}).get('nodes') or [])
        variant_image = (((media[0] if media else {}).get('preview') or {}).get('image') or {})
        product_image = ((((product.get('featuredMedia') or {}).get('preview') or {}).get('image')) or {})
        image = variant_image or product_image
        records.append(dict(
            variant_id=numeric_id(variant.get('id')), product_id=numeric_id(product.get('id')),
            variant_gid=variant.get('id'), product_gid=product.get('id'), title=product.get('title'),
            variant_title=variant.get('title'), sku=variant.get('sku'), handle=product.get('handle'),
            image_url=image.get('url'), image_alt=image.get('altText')))
    return [record for record in records if record['variant_id'] and record['product_id']]


def webhook_records(payload):
    images = payload.get('images') or []
    by_id = {numeric_id(image.get('id')): image for image in images}
    featured = payload.get('image') or (images[0] if images else {})
    records = []
    for variant in payload.get('variants') or []:
        image = by_id.get(numeric_id(variant.get('image_id'))) or next(
            (candidate for candidate in images if numeric_id(variant.get('id')) in {numeric_id(v) for v in candidate.get('variant_ids') or []}),
            featured)
        records.append(dict(
            variant_id=numeric_id(variant.get('id')), product_id=numeric_id(payload.get('id')),
            variant_gid=f"gid://shopify/ProductVariant/{numeric_id(variant.get('id'))}",
            product_gid=f"gid://shopify/Product/{numeric_id(payload.get('id'))}", title=payload.get('title'),
            variant_title=variant.get('title'), sku=variant.get('sku'), handle=payload.get('handle'),
            image_url=image.get('src') or image.get('url'), image_alt=image.get('alt')))
    return [record for record in records if record['variant_id'] and record['product_id']]


def merge_product(existing, record, storage_image=None):
    """Keep canonical IDs/vendors while refreshing Shopify-facing details."""
    product = dict(existing or {})
    canonical = bool(product.get('vendors')) or bool(existing and not str(existing.get('id', '')).startswith('SHOPIFY-'))
    product.update(
        id=product.get('id') or f"SHOPIFY-{record['variant_id']}",
        product_id=product.get('product_id') or f"SHOPIFY-{record['product_id']}",
        title=display_title(record.get('title'), record.get('variant_title')),
        sku=record.get('sku') or product.get('sku') or f"SHOPIFY-{record['variant_id']}",
        shopify_product_id=record.get('product_gid'), shopify_variant_id=record.get('variant_gid'),
        shopify_handle=record.get('handle'), shopify_image_url=record.get('image_url'),
        shopify_image_alt=record.get('image_alt'), vendors=product.get('vendors') or [],
        opening=product.get('opening', 0), catalog_source='CATALOG_INTELLIGENCE' if canonical else 'SHOPIFY')
    if storage_image:
        product.update(image=storage_image, storage_image=storage_image)
    else:
        product.setdefault('image', '')
    return product


def fetch_image(url, opener=urllib.request.urlopen):
    parsed = urllib.parse.urlparse(str(url or ''))
    if parsed.scheme != 'https' or parsed.hostname != 'cdn.shopify.com':
        raise ValueError('Shopify catalog image must use cdn.shopify.com over HTTPS.')
    request = urllib.request.Request(url, headers={'User-Agent': 'Bliss-Birch-Procurement/1.0'})
    with opener(request, timeout=20) as response:
        content = response.read(MAX_IMAGE_BYTES + 1)
    if len(content) > MAX_IMAGE_BYTES:
        raise ValueError('Shopify catalog image exceeds 12 MB.')
    try:
        with Image.open(io.BytesIO(content)) as source:
            if source.width * source.height > 24_000_000:
                raise ValueError('Shopify catalog image exceeds 24 megapixels.')
            picture = ImageOps.exif_transpose(source).convert('RGB')
            picture.thumbnail((1600, 1600))
            output = io.BytesIO(); picture.save(output, 'JPEG', quality=85)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError('Shopify catalog image is invalid.') from exc


def sync_records(engine, records, storage, actor='shopify-catalog'):
    with engine.connect() as db:
        existing_rows = db.execute('SELECT payload FROM catalog_projection').fetchall()
    existing = {}
    for row in existing_rows:
        product = json.loads(row['payload'])
        existing[numeric_id(product.get('shopify_variant_id'))] = product
    prepared = []
    image_errors = []
    urls = {}
    for record in records:
        current = existing.get(record['variant_id'])
        if record.get('image_url') and (not current or current.get('shopify_image_url') != record['image_url'] or not current.get('storage_image')):
            urls.setdefault(record['image_url'], []).append(record['variant_id'])

    def copy_image(url):
        content = fetch_image(url)
        name = 'catalog/' + hashlib.sha256(content).hexdigest() + '.jpg'
        storage.put(name, content)
        return name

    uploaded = {}
    with ThreadPoolExecutor(max_workers=min(8, max(1, len(urls)))) as pool:
        futures = {pool.submit(copy_image, url): url for url in urls}
        for future in as_completed(futures):
            url = futures[future]
            try:
                uploaded[url] = future.result()
            except Exception as exc:
                for variant_id in urls[url]:
                    image_errors.append({'variant_id': variant_id, 'error': str(exc)})

    for record in records:
        current = existing.get(record['variant_id'])
        storage_name = uploaded.get(record.get('image_url')) or (current.get('storage_image') if current else None)
        product = merge_product(current, record, storage_name)
        prepared.append((product['id'], json.dumps(product), now()))
    for start in range(0, len(prepared), 100):
        with engine.transaction() as db:
            for row in prepared[start:start + 100]:
                db.execute('INSERT INTO catalog_projection VALUES(?,?,?) ON CONFLICT(variant) DO UPDATE SET payload=excluded.payload,synced_at=excluded.synced_at', row)
    with engine.transaction() as db:
        engine.audit(db, actor, 'catalog', 'shopify', None,
                     {'variants': len(prepared), 'image_errors': len(image_errors)}, 'SYNC_SHOPIFY_CATALOG')
    return {'variants': len(prepared), 'image_errors': image_errors}
