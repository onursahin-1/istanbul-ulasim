# Istanbul.osm.pbf içinden adı olan ilgi noktalarını çıkarır.
# Çıktı: JSONL (ad, tur, lat, lon) — ikinci adımda veritabanına çevrilir.
import json, sys, osmium

# OSM etiketi -> (iç anahtar, Türkçe ad, önem ağırlığı)
KATEGORILER = {
    ('amenity', 'hospital'):        ('hastane', 'Hastane', 95),
    ('amenity', 'clinic'):          ('klinik', 'Klinik', 70),
    ('amenity', 'doctors'):         ('doktor', 'Muayenehane', 55),
    ('amenity', 'dentist'):         ('dis', 'Diş hekimi', 55),
    ('amenity', 'pharmacy'):        ('eczane', 'Eczane', 75),
    ('amenity', 'veterinary'):      ('veteriner', 'Veteriner', 55),
    ('amenity', 'school'):          ('okul', 'Okul', 85),
    ('amenity', 'kindergarten'):    ('anaokulu', 'Anaokulu', 60),
    ('amenity', 'college'):         ('yuksekokul', 'Yüksekokul', 80),
    ('amenity', 'university'):      ('universite', 'Üniversite', 92),
    ('amenity', 'library'):         ('kutuphane', 'Kütüphane', 70),
    ('amenity', 'bank'):            ('banka', 'Banka', 65),
    ('amenity', 'atm'):             ('atm', 'ATM', 40),
    ('amenity', 'fuel'):            ('benzinlik', 'Benzin istasyonu', 70),
    ('amenity', 'charging_station'):('sarj', 'Şarj istasyonu', 50),
    ('amenity', 'police'):          ('polis', 'Polis', 80),
    ('amenity', 'fire_station'):    ('itfaiye', 'İtfaiye', 75),
    ('amenity', 'post_office'):     ('postane', 'Postane', 70),
    ('amenity', 'townhall'):        ('belediye', 'Belediye', 85),
    ('amenity', 'courthouse'):      ('adliye', 'Adliye', 85),
    ('amenity', 'place_of_worship'):('ibadet', 'İbadethane', 60),
    ('amenity', 'restaurant'):      ('restoran', 'Restoran', 50),
    ('amenity', 'cafe'):            ('kafe', 'Kafe', 45),
    ('amenity', 'fast_food'):       ('bufe', 'Büfe', 40),
    ('amenity', 'bar'):             ('bar', 'Bar', 40),
    ('amenity', 'cinema'):          ('sinema', 'Sinema', 70),
    ('amenity', 'theatre'):         ('tiyatro', 'Tiyatro', 70),
    ('amenity', 'marketplace'):     ('pazar', 'Pazar yeri', 65),
    ('amenity', 'community_centre'):('kultur', 'Kültür merkezi', 65),
    ('amenity', 'social_facility'): ('sosyal', 'Sosyal tesis', 55),
    ('amenity', 'bus_station'):     ('otogar', 'Otogar', 88),
    ('amenity', 'ferry_terminal'):  ('iskele', 'İskele', 85),
    ('amenity', 'parking'):         ('otopark', 'Otopark', 35),
    ('shop', 'supermarket'):        ('market', 'Market', 60),
    ('shop', 'convenience'):        ('bakkal', 'Bakkal', 40),
    ('shop', 'stationery'):         ('kirtasiye', 'Kırtasiye', 55),
    ('shop', 'bakery'):             ('firin', 'Fırın', 45),
    ('shop', 'mall'):               ('avm', 'AVM', 90),
    ('shop', 'department_store'):   ('magaza', 'Mağaza', 60),
    ('shop', 'books'):              ('kitapci', 'Kitapçı', 50),
    ('shop', 'clothes'):            ('giyim', 'Giyim', 40),
    ('shop', 'hairdresser'):        ('kuafor', 'Kuaför', 35),
    ('shop', 'car_repair'):         ('tamirci', 'Oto tamir', 40),
    ('shop', 'hardware'):           ('hirdavat', 'Hırdavat', 40),
    ('shop', 'furniture'):          ('mobilya', 'Mobilya', 40),
    ('shop', 'electronics'):        ('elektronik', 'Elektronik', 45),
    ('tourism', 'hotel'):           ('otel', 'Otel', 70),
    ('tourism', 'hostel'):          ('hostel', 'Hostel', 50),
    ('tourism', 'museum'):          ('muze', 'Müze', 85),
    ('tourism', 'attraction'):      ('gezi', 'Gezilecek yer', 75),
    ('tourism', 'viewpoint'):       ('manzara', 'Seyir noktası', 55),
    ('leisure', 'park'):            ('park', 'Park', 70),
    ('leisure', 'stadium'):         ('stadyum', 'Stadyum', 85),
    ('leisure', 'sports_centre'):   ('spor', 'Spor tesisi', 60),
    ('leisure', 'fitness_centre'):  ('spor_salonu', 'Spor salonu', 50),
    ('leisure', 'garden'):          ('bahce', 'Bahçe', 50),
    ('leisure', 'marina'):          ('marina', 'Marina', 60),
    ('historic', 'monument'):       ('anit', 'Anıt', 70),
    ('historic', 'castle'):         ('kale', 'Kale', 80),
    ('historic', 'ruins'):          ('harabe', 'Tarihî kalıntı', 60),
    ('aeroway', 'aerodrome'):       ('havalimani', 'Havalimanı', 100),
    ('office', 'government'):       ('resmi', 'Resmî kurum', 70),
    ('healthcare', 'centre'):       ('saglik', 'Sağlık merkezi', 70),
    ('healthcare', 'laboratory'):   ('laboratuvar', 'Laboratuvar', 55),
}

# Yer adları: "Kadıköy", "Şişli" gibi aramalar için ve POI'lere semt etiketi vermek için.
YERLER = {
    'city': ('sehir', 'Şehir', 100),
    'town': ('ilce', 'İlçe', 95),
    'suburb': ('semt', 'Semt', 90),
    'quarter': ('semt', 'Semt', 85),
    'neighbourhood': ('mahalle', 'Mahalle', 80),
    'village': ('koy', 'Köy', 75),
    'hamlet': ('koy', 'Köy', 60),
    'borough': ('ilce', 'İlçe', 92),
}

def kategori(etiketler):
    for (anahtar, deger), bilgi in KATEGORILER.items():
        if etiketler.get(anahtar) == deger:
            return bilgi
    # shop=* adı olan her şey genel "dükkân" sayılır
    if etiketler.get('shop'):
        return ('dukkan', 'Dükkân', 35)
    if etiketler.get('healthcare'):
        return ('saglik', 'Sağlık merkezi', 65)
    yer = etiketler.get('place')
    if yer in YERLER:
        return YERLER[yer]
    return None

class Toplayici(osmium.SimpleHandler):
    def __init__(self, cikti):
        super().__init__()
        self.cikti = cikti
        self.sayac = 0

    def kaydet(self, etiketler, lat, lon):
        ad = etiketler.get('name') or etiketler.get('name:tr')
        if not ad or len(ad) > 90:
            return
        bilgi = kategori(etiketler)
        if not bilgi:
            return
        tur, _, agirlik = bilgi
        self.cikti.write(json.dumps({
            'ad': ad.strip(), 'tur': tur, 'lat': round(lat, 6), 'lon': round(lon, 6),
            'a': agirlik,
        }, ensure_ascii=False) + '\n')
        self.sayac += 1

    def node(self, n):
        self.kaydet(dict(n.tags), n.location.lat, n.location.lon)

    def way(self, w):
        # Hastane, okul, AVM ve park gibi yerler çoğunlukla alan olarak çizilir.
        # Alanın düğümlerinin ortalaması yeterince iyi bir merkez veriyor.
        if len(w.nodes) < 3:
            return
        toplam_lat = toplam_lon = 0.0
        sayi = 0
        for d in w.nodes:
            try:
                toplam_lat += d.lat
                toplam_lon += d.lon
                sayi += 1
            except osmium.InvalidLocationError:
                continue
        if sayi < 3:
            return
        self.kaydet(dict(w.tags), toplam_lat / sayi, toplam_lon / sayi)

if __name__ == '__main__':
    girdi, cikti_yolu = sys.argv[1], sys.argv[2]
    with open(cikti_yolu, 'w', encoding='utf-8') as f:
        h = Toplayici(f)
        h.apply_file(girdi, locations=True, idx='flex_mem')
    print('toplanan nokta:', h.sayac)
