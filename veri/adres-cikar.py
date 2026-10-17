# Istanbul.osm.pbf içinden adres araması için sokak, kapı numarası, bina ve siteleri çıkarır;
# mahalle ve ilçe sınırlarını da kaydeder (kur.py her kayda "Caferağa Mah., Kadıköy" yazsın).
#
# Çıktılar:
#   adres.jsonl     her satır bir kayıt: tur (sokak | adres | bina | site), ad, lat, lon, a (önem)
#                   sokaklar burada yol parçası olarak; kur.py onları mahalle mahalle birleştirir
#   sinirlar.json   mahalle (admin_level 8) ve ilçe (admin_level 6) sınırları, sadeleştirilmiş
#
# Kullanım (veri klasöründe; pip install osmium shapely):
#   python adres-cikar.py C:\otp\istanbul\Istanbul.osm.pbf adres.jsonl sinirlar.json

import json, re, sys
import osmium
from shapely import wkb as shapely_wkb
from shapely.geometry import mapping

# Adı olan yollar: araçla ya da yürüyerek gidilen sokak ve caddeler. Otoyol, bağlantı yolu,
# patika ve servis yolu (site içi yollar) yer araması için gürültü.
YOL_TURLERI = {
    'trunk': 75, 'primary': 72, 'secondary': 66, 'tertiary': 60, 'unclassified': 52,
    'residential': 50, 'living_street': 48, 'pedestrian': 58,
}
# "A Blok", "B-2 Blok", "Blok 3": sitelerin blok adları tek başına aranacak bir şey değil.
BLOK = re.compile(r'^(\S{1,4}[\s-]*blo[kğg]u?|blok[\s-]*\S{1,4}|\d+)$', re.I)
# Tek başına bir şey söylemeyen bina adları ("Cami", "Lojman", "K:4"): aranacak yer değil.
GENEL = {'cami', 'camii', 'lojman', 'villa', 'apartman', 'korugan', 'su deposu', 'depo', 'eski depo', 'trafo',
         'bina', 'ev', 'konut', 'yurt', 'okul', 'garaj', 'kulübe', 'baraka', 'ahır', 'müştemilat', 'site'}
HARFLER = re.compile(r'[A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]{3}')
APARTMAN_ADI = re.compile(r'apartman|\bapt\.?(\s|$)', re.I)
SITE_ADI = re.compile(r'sitesi|evleri|konutlar|residence|rezidans', re.I)
KONUT = {'apartments', 'residential', 'house', 'detached', 'semidetached_house', 'terrace', 'dormitory'}
IS = {'commercial', 'office', 'retail', 'industrial', 'warehouse'}


def ad_al(t):
    ad = (t.get('name') or t.get('name:tr') or '').strip()
    return ad if 2 < len(ad) <= 90 else ''


class Toplayici(osmium.SimpleHandler):
    def __init__(self, cikti):
        super().__init__()
        self.cikti = cikti
        self.sinirlar = []
        self.wkb = osmium.geom.WKBFactory()
        self.sayac = {}

    def yaz(self, kayit):
        self.cikti.write(json.dumps(kayit, ensure_ascii=False) + '\n')
        self.sayac[kayit['tur']] = self.sayac.get(kayit['tur'], 0) + 1

    def adres_ve_bina(self, t, lat, lon):
        no = re.sub(r'^(no|numara)\s*[:.]?\s*', '', (t.get('addr:housenumber') or '').strip(), flags=re.I)
        sokak = (t.get('addr:street') or '').strip()
        if no and sokak and len(no) <= 12:
            self.yaz({'tur': 'adres', 'ad': f'{sokak} No: {no}', 'sokak': sokak, 'no': no,
                      'lat': round(lat, 6), 'lon': round(lon, 6), 'a': 45})
        ad = ad_al(t)
        if not ad or BLOK.match(ad) or not HARFLER.search(ad) or ad.casefold() in GENEL:
            return
        if t.get('landuse') == 'residential' or t.get('residential') or t.get('place') == 'isolated_dwelling':
            self.yaz({'tur': 'site', 'ad': ad, 'lat': round(lat, 6), 'lon': round(lon, 6), 'a': 55})
        elif t.get('building'):
            b = t.get('building')
            # Adı türünü söylüyorsa ona göre ("Gül Apartmanı" building=yes olsa da apartman).
            if APARTMAN_ADI.search(ad):
                tur = 'apartman'
            elif SITE_ADI.search(ad):
                tur = 'site'
            else:
                tur = 'apartman' if b in KONUT else 'ishani' if b in IS else 'bina'
            self.yaz({'tur': tur, 'ad': ad, 'lat': round(lat, 6), 'lon': round(lon, 6), 'a': 42})

    def node(self, n):
        t = n.tags
        if 'addr:housenumber' in t or ('building' in t and 'name' in t):
            self.adres_ve_bina(t, n.location.lat, n.location.lon)

    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        if hw in YOL_TURLERI and ad_al(t):
            noktalar = []
            for d in w.nodes:
                try:
                    noktalar.append((d.lat, d.lon))
                except osmium.InvalidLocationError:
                    pass
            if len(noktalar) >= 2:
                orta = noktalar[len(noktalar) // 2]
                # Uzunluk (yaklaşık, metre): mahalle içinde en uzun parçayı seçmek için.
                uz = sum((((a[0] - b[0]) * 111_000) ** 2 + ((a[1] - b[1]) * 84_000) ** 2) ** 0.5 for a, b in zip(noktalar, noktalar[1:]))
                self.yaz({'tur': 'sokak', 'ad': ad_al(t), 'lat': round(orta[0], 6), 'lon': round(orta[1], 6),
                          'a': YOL_TURLERI[hw], 'uz': round(uz)})
            return
        if 'addr:housenumber' in t or (('building' in t or t.get('landuse') == 'residential') and 'name' in t):
            if len(w.nodes) < 3:
                return
            la = lo = 0.0
            s = 0
            for d in w.nodes:
                try:
                    la += d.lat
                    lo += d.lon
                    s += 1
                except osmium.InvalidLocationError:
                    pass
            if s >= 3:
                self.adres_ve_bina(t, la / s, lo / s)

    def area(self, a):
        t = a.tags
        if t.get('boundary') != 'administrative' or t.get('admin_level') not in ('6', '8'):
            return
        ad = (t.get('name') or t.get('name:tr') or '').strip()
        if not ad:
            return
        try:
            geo = shapely_wkb.loads(self.wkb.create_multipolygon(a), hex=True).simplify(0.0002)
        except Exception:
            return
        if geo.is_empty:
            return
        self.sinirlar.append({'tur': 'ilce' if t.get('admin_level') == '6' else 'mahalle', 'ad': ad,
                              'geo': mapping(geo)})


if __name__ == '__main__':
    girdi, cikti_yolu, sinir_yolu = sys.argv[1:4]
    with open(cikti_yolu, 'w', encoding='utf-8') as f:
        h = Toplayici(f)
        h.apply_file(girdi, locations=True, idx='flex_mem')
    with open(sinir_yolu, 'w', encoding='utf-8') as f:
        json.dump(h.sinirlar, f, ensure_ascii=False, separators=(',', ':'))
    print('kayıt:', h.sayac, '· sınır:', len(h.sinirlar))
