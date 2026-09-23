import unittest

from procurement.shopify_catalog import graphql_records, merge_product, webhook_records


class ShopifyCatalogTests(unittest.TestCase):
    def test_graphql_variant_uses_variant_image_then_product_image(self):
        document={'productVariants':{'nodes':[
            {'id':'gid://shopify/ProductVariant/11','title':'Brass','sku':'L-11',
             'media':{'nodes':[{'preview':{'image':{'url':'https://cdn.shopify.com/variant.jpg','altText':'Variant'}}}]},
             'product':{'id':'gid://shopify/Product/1','title':'Lamp','handle':'lamp',
                        'featuredMedia':{'preview':{'image':{'url':'https://cdn.shopify.com/product.jpg'}}}}},
            {'id':'gid://shopify/ProductVariant/12','title':'Default Title','sku':'', 'media':{'nodes':[]},
             'product':{'id':'gid://shopify/Product/2','title':'Mirror','handle':'mirror',
                        'featuredMedia':{'preview':{'image':{'url':'https://cdn.shopify.com/mirror.jpg'}}}}}]}}
        records=graphql_records(document)
        self.assertEqual(records[0]['image_url'],'https://cdn.shopify.com/variant.jpg')
        self.assertEqual(records[1]['image_url'],'https://cdn.shopify.com/mirror.jpg')

    def test_merge_preserves_verified_identity_and_vendor(self):
        existing={'id':'WC-001::DEFAULT','product_id':'WC-001','sku':'BB-WC-001','vendors':[{'id':'Verified Vendor'}],'opening':0}
        record={'variant_id':'11','product_id':'1','variant_gid':'gid://shopify/ProductVariant/11',
                'product_gid':'gid://shopify/Product/1','title':'Shopify Lamp','variant_title':'Brass',
                'sku':'SHOP-SKU','handle':'lamp','image_url':'https://cdn.shopify.com/lamp.jpg','image_alt':'Lamp'}
        product=merge_product(existing,record,'catalog/image.jpg')
        self.assertEqual(product['id'],'WC-001::DEFAULT')
        self.assertEqual(product['vendors'],[{'id':'Verified Vendor'}])
        self.assertEqual(product['sku'],'SHOP-SKU')
        self.assertEqual(product['storage_image'],'catalog/image.jpg')
        self.assertEqual(product['catalog_source'],'CATALOG_INTELLIGENCE')

    def test_unmapped_shopify_variant_has_no_invented_vendor(self):
        payload={'id':1,'title':'Pendant','handle':'pendant','image':{'src':'https://cdn.shopify.com/p.jpg'},
                 'variants':[{'id':22,'title':'Default Title','sku':'P-22'}]}
        record=webhook_records(payload)[0]
        product=merge_product(None,record,'catalog/p.jpg')
        self.assertEqual(product['id'],'SHOPIFY-22')
        self.assertEqual(product['title'],'Pendant')
        self.assertEqual(product['vendors'],[])
        self.assertEqual(product['catalog_source'],'SHOPIFY')


if __name__=='__main__': unittest.main()
