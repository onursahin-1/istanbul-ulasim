# OSM'deki İstanbul raylı sistem hatlarını sıralı istasyon listeleri ve ray
# geometrisiyle JSON'a çıkarır.
#
# Geometri neden gerekiyor: İBB'nin beslemesindeki shapes.txt uzattığımız hatları
# kapsamıyor (istasyon-tamamla.py o seferlerin shape_id'sini boşaltmak zorunda
# kalıyordu), o yüzden uygulama M4'ü Kadıköy'den Sabiha Gökçen'e düz bir çizgi
# olarak çiziyordu. Rayın kendi çizgisi OSM'de zaten var.
import sys, json, collections, osmium

ILGI = {'subway', 'light_rail', 'tram', 'funicular', 'monorail', 'train'}
# Bağıntıların üstünde durduğu ray parçaları.
RAY_YOLU = {'subway', 'light_rail', 'tram', 'funicular', 'monorail', 'rail', 'narrow_gauge'}
DURAK_ROL = ('stop', 'stop_entry_only', 'stop_exit_only')
PERON_ROL = ('platform', 'platform_entry_only', 'platform_exit_only')

class Toplayici(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.hatlar = []
        self.dugum = {}
        self.yol = {}

    def node(self, n):
        t = dict(n.tags)
        if t.get('name') and (t.get('railway') in ('station', 'halt', 'stop')
                              or t.get('public_transport') in ('station', 'stop_position', 'platform')):
            self.dugum[n.id] = {'ad': t['name'], 'lat': round(n.location.lat, 6), 'lon': round(n.location.lon, 6)}

    def way(self, w):
        if w.tags.get('railway') not in RAY_YOLU:
            return
        try:
            self.yol[w.id] = [(round(n.lat, 6), round(n.lon, 6)) for n in w.nodes if n.location.valid()]
        except osmium.InvalidLocationError:
            pass

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
            'yollar': [m.ref for m in r.members if m.type == 'w'],
        })

def cizgi_bagla(parcalar):
    """Bağıntının ray parçalarını uç uca ekleyerek tek çizgi yapar.

    Parçalar bağıntıda sıralı ama yönleri karışık; her birinin hangi ucunun
    öncekine değdiğine bakılıp gerektiğinde ters çevriliyor. Değmiyorsa yeni bir
    kol başlıyor: bazı hatlar OSM'de kopuk duruyor."""
    kollar = []
    for p in parcalar:
        if len(p) < 2:
            continue
        if not kollar:
            kollar.append(list(p))
            continue
        son = kollar[-1]
        if son[-1] == p[0]:
            son.extend(p[1:])
        elif son[-1] == p[-1]:
            son.extend(reversed(p[:-1]))
        elif son[0] == p[-1]:
            kollar[-1] = list(p[:-1]) + son
        elif son[0] == p[0]:
            kollar[-1] = list(reversed(p[1:])) + son
        else:
            kollar.append(list(p))
    return max(kollar, key=len) if kollar else []


h = Toplayici()
h.apply_file(sys.argv[1], locations=True)

for hat in h.hatlar:
    parcalar = [h.yol[w] for w in hat.pop('yollar') if w in h.yol]
    hat['cizgi'] = [[a, b] for a, b in cizgi_bagla(parcalar)]

cizgili = sum(1 for x in h.hatlar if len(x['cizgi']) > 1)
cikti = {'hatlar': h.hatlar, 'dugumler': {str(k): v for k, v in h.dugum.items()}}
json.dump(cikti, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(f"{len(h.hatlar)} hat ({cizgili} tanesinin çizgisi çıktı), {len(h.dugum)} düğüm -> {sys.argv[2]}")
print("işletmeciler:", collections.Counter(x['isletmeci'] or '(boş)' for x in h.hatlar).most_common(8))
