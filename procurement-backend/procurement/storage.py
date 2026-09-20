"""Private Supabase objects; credentials never leave the server."""
import re
import urllib.request


class SupabaseStorage:
    def __init__(self, url, key):
        if not url.startswith('https://') or not key:
            raise ValueError('Supabase HTTPS URL and server key are required')
        self.url = url.rstrip('/') + '/storage/v1/object/procurement-private/'
        self.key = key

    def request(self, name, data=None):
        if not re.fullmatch(r'(?:catalog/)?[a-f0-9]{64}\.jpg', name):
            raise ValueError('Invalid storage object name')
        headers = {'Authorization': 'Bearer ' + self.key, 'apikey': self.key}
        if data is not None:
            headers.update({'Content-Type': 'image/jpeg', 'x-upsert': 'true'})
        request = urllib.request.Request(self.url + name, data=data, headers=headers,
                                         method='POST' if data is not None else 'GET')
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read()

    def put(self, name, data):
        self.request(name, data)

    def get(self, name):
        return self.request(name)
