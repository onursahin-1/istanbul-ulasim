# OSM'deki İstanbul raylı sistem hatlarını sıralı istasyon listeleriyle JSON'a çıkarır.
import sys, json, collections, osmium

ILGI = {'subway', 'light_rail', 'tram', 'funicular', 'monorail', 'train'}
DURAK_ROL = ('stop', 'stop_entry_only', 'stop_exit_only')
PERON_ROL = ('platform', 'platform_entry_only', 'platform_exit_only')

class Toplayici(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.hatlar = []
        self.dugum = {}

    def node(self, n):
        t = dict(n.tags)
        if t.get('name') and (t.get('railway') in ('station', 'halt', 'stop')
                              or t.get('public_transport') in ('station', 'stop_position', 'platform')):
            self.dugum[n.id] = {'ad': t['name'], 'lat': round(n.location.lat, 6), 'lon': round(n.location.lon, 6)}

    def relation(self, r):
        t = dict(r.tags)
        if t.get('type') != 'route' or t.get('route') not in ILGI:
            return
        sirali = [m.ref for m in r.members if m.type == 'n' and m.role in DURAK_ROL]
        if not sirali:
            sirali = [m.ref for m in r.members if m.type == 'n' and m.role in PERON_ROL]
        self.hatlar.append({
            'id': r.id, 'tur': t['route'], 'ref': t.get('ref', ''), 'ad': t.get('name', ''),
            'from': t.get('from', ''), 'to': t.get('to', ''),
            'isletmeci': t.get('operator', ''), 'ag': t.get('network', ''),
            'renk': t.get('colour', '') or t.get('color', ''),
            'dugumler': sirali,
        })

h = Toplayici()
h.apply_file(sys.argv[1])
cikti = {'hatlar': h.hatlar, 'dugumler': {str(k): v for k, v in h.dugum.items()}}
json.dump(cikti, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(f"{len(h.hatlar)} hat, {len(h.dugum)} düğüm -> {sys.argv[2]}")
print("işletmeciler:", collections.Counter(x['isletmeci'] or '(boş)' for x in h.hatlar).most_common(8))
