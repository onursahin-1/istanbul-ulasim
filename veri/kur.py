# ham.jsonl (+ adres.jsonl, sinirlar.json) -> istanbul-poi.db
# Türkçe aramaya uygun sözcük dizini, mahalle ve ilçe etiketi ve kategori tablosu üretir.
#
#   ham.jsonl      cikar.py: ilgi noktaları, semt ve mahalle noktaları
#   adres.jsonl    adres-cikar.py: yol parçaları, kapı numaraları, bina ve siteler (isteğe bağlı)
#   sinirlar.json  adres-cikar.py: mahalle ve ilçe sınırları (isteğe bağlı)
#
# Sınırlar varsa her kayda içinde bulunduğu mahalle ve ilçe yazılır ("Caferağa Mah., Kadıköy");
# yoksa eskisi gibi en yakın semt noktası. Sokaklar mahalle mahalle tek kayıt olur: Bağdat
# Caddesi 14 km, tek bir nokta işe yaramaz; geçtiği her mahallede o mahalledeki en uzun
# parçasının ortası.
#
# Kullanım:
#   python kur.py ham.jsonl istanbul-poi.db [adres.jsonl sinirlar.json]
import json, math, os, sqlite3, sys, collections
from cikar import KATEGORILER, YERLER

TUR_ADLARI = {}
for (_, _), (anahtar, ad, agirlik) in KATEGORILER.items():
    TUR_ADLARI[anahtar] = (ad, agirlik)
for _, (anahtar, ad, agirlik) in YERLER.items():
    TUR_ADLARI[anahtar] = (ad, agirlik)
TUR_ADLARI.setdefault('dukkan', ('Dükkân', 35))
TUR_ADLARI.setdefault('saglik', ('Sağlık merkezi', 65))
# Adres araması türleri (adres-cikar.py). Kategori aramasına girmezler (poi.ts).
ADRES_TURLERI = {
    'adres': ('Adres', 45), 'sokak': ('Sokak', 50), 'bina': ('Bina', 42),
    'apartman': ('Apartman', 42), 'ishani': ('İş yeri', 42), 'site': ('Site', 55),
}
TUR_ADLARI.update(ADRES_TURLERI)

AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c',
         'â': 'a', 'î': 'i', 'û': 'u', 'ê': 'e', 'ô': 'o', 'é': 'e', 'ñ': 'n'}

def normalize(metin):
    """'Şişli Etfal Hastanesi' -> 'sisli etfal hastanesi'. Arama iki tarafta da bunu kullanır."""
    metin = metin.replace('I', 'ı').replace('İ', 'i').lower()
    cikan = []
    for h in metin:
        h = AKSAN.get(h, h)
        cikan.append(h if h.isalnum() else ' ')
    return ' '.join(''.join(cikan).split())

# Semt ve mahalle sayılan türler: POI'lere "nerede" etiketi vermek için kullanılır.
YER_TURLERI = {'sehir': 1, 'ilce': 2, 'semt': 3, 'mahalle': 4, 'koy': 4}
# Batısında ilçe sınırı olmayan nokta İstanbul dışı (Kapaklı, Çerkezköy). Çatalca'nın sınırı
# veride yok; onun noktaları bu boylamın doğusunda.
BATI_SINIRI = 28.05

def mesafe2(a, b):
    dx = (a[1] - b[1]) * 0.75  # İstanbul enleminde boylam derecesi daha kısa
    dy = a[0] - b[0]
    return dx * dx + dy * dy

def mahalle_kisa(ad):
    """'Caferağa Mahallesi' -> 'Caferağa Mah.'"""
    for ek in (' Mahallesi', ' Mah.', ' Mh.'):
        if ad.endswith(ek):
            return ad[: -len(ek)] + ' Mah.'
    return ad

class Sinirlar:
    """Mahalle ve ilçe sınırları; bir noktanın içinde olduğu ikisini verir."""

    def __init__(self, yol):
        from shapely.geometry import Point, shape
        from shapely.strtree import STRtree
        self.Point = Point
        veri = json.load(open(yol, encoding='utf-8'))
        self.kume = {}
        for tur in ('mahalle', 'ilce'):
            ogeler = [v for v in veri if v['tur'] == tur]
            geo = [shape(v['geo']) for v in ogeler]
            self.kume[tur] = (STRtree(geo), geo, [v['ad'] for v in ogeler])

    def bul(self, tur, lat, lon):
        agac, geo, adlar = self.kume[tur]
        p = self.Point(lon, lat)
        for i in agac.query(p):
            if geo[i].contains(p):
                return adlar[i]
        return ''

def oku_jsonl(yol):
    for satir in open(yol, encoding='utf-8'):
        if satir.strip():
            yield json.loads(satir)

def sokaklari_birlestir(parcalar, sinir):
    """Aynı adlı yol parçaları mahalle başına tek kayıt; nokta o mahalledeki en uzun parçanın ortası."""
    gruplar = {}
    for k in parcalar:
        duz = normalize(k['ad'])
        if not duz:
            continue
        mah = k.get('mah') or ''
        # Mahallesi bilinmeyen parça ~2 km'lik gözlerle gruplanır (uzak iki parça birleşmesin).
        yer = mah or k.get('ilce') or f"{round(k['lat'] * 50)},{round(k['lon'] * 40)}"
        g = gruplar.get((duz, yer))
        if not g:
            gruplar[(duz, yer)] = {**k, 'toplam': k.get('uz', 0), 'enUzun': k.get('uz', 0)}
            continue
        g['toplam'] += k.get('uz', 0)
        g['a'] = max(g['a'], k['a'])
        if k.get('uz', 0) > g['enUzun']:
            g.update(lat=k['lat'], lon=k['lon'], enUzun=k['uz'], ad=k['ad'])
    sonuc = []
    for g in gruplar.values():
        # Uzun cadde biraz öne: 2 km ve üstü +8.
        g['a'] = g['a'] + min(8, round(g['toplam'] / 250))
        sonuc.append(g)
    return sonuc

def main(girdi, cikti, adres_yolu=None, sinir_yolu=None):
    sinir = Sinirlar(sinir_yolu) if sinir_yolu else None
    ham = list(oku_jsonl(girdi))
    adresler = list(oku_jsonl(adres_yolu)) if adres_yolu else []

    # Mahalle ve ilçe etiketi; ilçesi olmayan adres kaydı İstanbul dışıysa atılır.
    def etiketle(k):
        if not sinir:
            return
        k['mah'] = mahalle_kisa(sinir.bul('mahalle', k['lat'], k['lon']))
        k['ilce'] = sinir.bul('ilce', k['lat'], k['lon'])
    for k in ham:
        etiketle(k)
    tutulan = []
    for k in adresler:
        etiketle(k)
        if sinir and not k['ilce'] and k['lon'] < BATI_SINIRI:
            continue
        tutulan.append(k)
    sokaklar = sokaklari_birlestir([k for k in tutulan if k['tur'] == 'sokak'], sinir)
    obur = [k for k in tutulan if k['tur'] != 'sokak']

    kayitlar = []
    gorulen = {}
    for k in ham + obur + sokaklar:
        duz = normalize(k['ad'])
        if not duz:
            continue
        # Aynı yer hem nokta hem alan olarak çizilmiş olabilir (ya da hem bina hem ilgi noktası):
        # ~100 m ızgarada tekilleştir, önemi yüksek olan kalır. Sokak, aynı adlı başka bir
        # şeyle tekilleşmesin diye türüyle.
        anahtar = (duz, round(k['lat'], 3), round(k['lon'], 3), k['tur'] if k['tur'] in ('sokak', 'adres') else '')
        onceki = gorulen.get(anahtar)
        if onceki is not None:
            if k['a'] > kayitlar[onceki]['a']:
                kayitlar[onceki] = k | {'duz': duz}
            continue
        gorulen[anahtar] = len(kayitlar)
        kayitlar.append(k | {'duz': duz})

    # Sınır yoksa (eski kurulum) semt etiketi: her noktaya en yakın yer adı. Izgara ile aranır.
    yerler = [k for k in kayitlar if k['tur'] in YER_TURLERI]
    izgara = collections.defaultdict(list)
    for y in yerler:
        izgara[(round(y['lat'], 2), round(y['lon'], 2))].append(y)

    def en_yakin_yer(k):
        enIyi, enKisa = None, 0.02 ** 2  # ~2 km
        gl, go = round(k['lat'], 2), round(k['lon'], 2)
        for dl in (-0.01, 0, 0.01):
            for do in (-0.01, 0, 0.01):
                for y in izgara.get((round(gl + dl, 2), round(go + do, 2)), ()):
                    d = mesafe2((k['lat'], k['lon']), (y['lat'], y['lon']))
                    # Mahalle, ilçeye tercih edilir: daha ayrıntılı olanı daha yakın sayarız.
                    d *= 0.6 if YER_TURLERI[y['tur']] >= 3 else 1.0
                    if d < enKisa:
                        enKisa, enIyi = d, y
        return enIyi['ad'] if enIyi else ''

    for k in kayitlar:
        mah, ilce = k.get('mah', ''), k.get('ilce', '')
        if k['tur'] in YER_TURLERI:
            # Semt ve mahalle noktası: yalnız ilçesi (kendi adını tekrar yazma).
            k['semt'] = ilce if ilce and normalize(ilce) != k['duz'] else ''
        elif mah or ilce:
            k['semt'] = ', '.join(p for p in (mah, ilce) if p)
        else:
            k['semt'] = en_yakin_yer(k)

    # Yer etiketleri ("Caferağa Mah., Kadıköy") ayrı tabloda: 180 bin kayıtta aynı birkaç bin
    # etiket tekrar ediyor. Yerin sözcükleri de ayrı dizinde: "1543 sk bağcılar", "kadıköy
    # eczane" yazılabilsin. Yalnız yer sözcükleriyle eşleşen kayıt sonuca girmez (poi.ts):
    # "kadıköy" Kadıköy'deki her dükkânı getirmesin.
    etiketler = {}
    for k in kayitlar:
        if k['semt']:
            k['yer'] = etiketler.setdefault(k['semt'], len(etiketler) + 1)
        else:
            k['yer'] = None

    if os.path.exists(cikti):
        os.remove(cikti)
    db = sqlite3.connect(cikti)
    db.executescript("""
      PRAGMA journal_mode = OFF;
      PRAGMA page_size = 4096;
      CREATE TABLE poi (
        id INTEGER PRIMARY KEY,
        ad TEXT NOT NULL,
        tur TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        agirlik INTEGER NOT NULL,
        yer INTEGER
      );
      CREATE TABLE yer (id INTEGER PRIMARY KEY, ad TEXT NOT NULL);
      CREATE TABLE sozcuk (sozcuk TEXT NOT NULL, poi INTEGER NOT NULL, PRIMARY KEY (sozcuk, poi)) WITHOUT ROWID;
      CREATE TABLE yersozcuk (sozcuk TEXT NOT NULL, yer INTEGER NOT NULL, PRIMARY KEY (sozcuk, yer)) WITHOUT ROWID;
      CREATE TABLE tur (anahtar TEXT PRIMARY KEY, ad TEXT NOT NULL, duz TEXT NOT NULL, agirlik INTEGER NOT NULL);
      CREATE TABLE bilgi (anahtar TEXT PRIMARY KEY, deger TEXT);
    """)
    db.executemany(
        'INSERT INTO poi (id, ad, tur, lat, lon, agirlik, yer) VALUES (?,?,?,?,?,?,?)',
        [(i, k['ad'], k['tur'], k['lat'], k['lon'], k['a'], k['yer']) for i, k in enumerate(kayitlar)],
    )
    db.executemany('INSERT INTO yer (id, ad) VALUES (?,?)', [(i, ad) for ad, i in etiketler.items()])
    sozcukler = set()
    for i, k in enumerate(kayitlar):
        for s in set(k['duz'].split()):
            if len(s) >= 2:
                sozcukler.add((s, i))
    db.executemany('INSERT INTO sozcuk (sozcuk, poi) VALUES (?,?)', sorted(sozcukler))
    yer_sozcukleri = set()
    for ad, i in etiketler.items():
        for s in set(normalize(ad.replace(' Mah.', '')).split()):
            if len(s) >= 2:
                yer_sozcukleri.add((s, i))
    db.executemany('INSERT INTO yersozcuk (sozcuk, yer) VALUES (?,?)', sorted(yer_sozcukleri))
    db.executemany(
        'INSERT INTO tur (anahtar, ad, duz, agirlik) VALUES (?,?,?,?)',
        [(a, ad, normalize(ad), ag) for a, (ad, ag) in sorted(TUR_ADLARI.items())],
    )
    sayilar = collections.Counter(k['tur'] for k in kayitlar)
    db.executemany('INSERT INTO bilgi (anahtar, deger) VALUES (?,?)', [
        ('kaynak', 'OpenStreetMap — BBBike Istanbul özeti'),
        ('nokta', str(len(kayitlar))),
        ('sozcuk', str(len(sozcukler))),
        ('adres', str(sayilar['adres'])),
        ('sokak', str(sayilar['sokak'])),
    ])
    db.executescript("""
      CREATE INDEX i_poi_tur ON poi (tur, lat, lon);
      CREATE INDEX i_poi_yer ON poi (yer);
    """)
    db.commit()
    db.execute('VACUUM')
    db.close()
    print(f'{len(kayitlar)} nokta, {len(sozcukler)} sözcük -> {cikti} ({os.path.getsize(cikti)/1048576:.1f} MB)')
    print(' ', dict(sayilar.most_common(12)))

main(*sys.argv[1:5])
