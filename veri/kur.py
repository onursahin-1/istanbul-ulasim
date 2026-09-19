# ham.jsonl -> istanbul-poi.db
# Türkçe aramaya uygun sözcük dizini, semt etiketi ve kategori tablosu üretir.
import json, math, os, sqlite3, sys, collections
from cikar import KATEGORILER, YERLER

TUR_ADLARI = {}
for (_, _), (anahtar, ad, agirlik) in KATEGORILER.items():
    TUR_ADLARI[anahtar] = (ad, agirlik)
for _, (anahtar, ad, agirlik) in YERLER.items():
    TUR_ADLARI[anahtar] = (ad, agirlik)
TUR_ADLARI.setdefault('dukkan', ('Dükkân', 35))
TUR_ADLARI.setdefault('saglik', ('Sağlık merkezi', 65))

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

def mesafe2(a, b):
    dx = (a[1] - b[1]) * 0.75  # İstanbul enleminde boylam derecesi daha kısa
    dy = a[0] - b[0]
    return dx * dx + dy * dy

def main(girdi, cikti):
    kayitlar = []
    gorulen = {}
    for satir in open(girdi, encoding='utf-8'):
        k = json.loads(satir)
        duz = normalize(k['ad'])
        if not duz:
            continue
        # Aynı yer hem nokta hem alan olarak çizilmiş olabilir: ~100 m ızgarada tekilleştir.
        anahtar = (duz, round(k['lat'], 3), round(k['lon'], 3))
        onceki = gorulen.get(anahtar)
        if onceki is not None:
            if k['a'] > kayitlar[onceki]['a']:
                kayitlar[onceki] = k | {'duz': duz}
            continue
        gorulen[anahtar] = len(kayitlar)
        kayitlar.append(k | {'duz': duz})

    # Semt etiketi: her noktaya en yakın yer adı. Izgara ile aranır.
    yerler = [k for k in kayitlar if k['tur'] in YER_TURLERI]
    izgara = collections.defaultdict(list)
    for y in yerler:
        izgara[(round(y['lat'], 2), round(y['lon'], 2))].append(y)

    for k in kayitlar:
        if k['tur'] in YER_TURLERI:
            k['semt'] = ''
            continue
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
        k['semt'] = enIyi['ad'] if enIyi else ''

    if os.path.exists(cikti):
        os.remove(cikti)
    db = sqlite3.connect(cikti)
    db.executescript("""
      PRAGMA journal_mode = OFF;
      CREATE TABLE poi (
        id INTEGER PRIMARY KEY,
        ad TEXT NOT NULL,
        duz TEXT NOT NULL,
        tur TEXT NOT NULL,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        agirlik INTEGER NOT NULL,
        semt TEXT
      );
      CREATE TABLE sozcuk (sozcuk TEXT NOT NULL, poi INTEGER NOT NULL);
      CREATE TABLE tur (anahtar TEXT PRIMARY KEY, ad TEXT NOT NULL, duz TEXT NOT NULL, agirlik INTEGER NOT NULL);
      CREATE TABLE bilgi (anahtar TEXT PRIMARY KEY, deger TEXT);
    """)
    db.executemany(
        'INSERT INTO poi (id, ad, duz, tur, lat, lon, agirlik, semt) VALUES (?,?,?,?,?,?,?,?)',
        [(i, k['ad'], k['duz'], k['tur'], k['lat'], k['lon'], k['a'], k['semt']) for i, k in enumerate(kayitlar)],
    )
    sozcukler = []
    for i, k in enumerate(kayitlar):
        for s in dict.fromkeys(k['duz'].split()):
            if len(s) >= 2:
                sozcukler.append((s, i))
    db.executemany('INSERT INTO sozcuk (sozcuk, poi) VALUES (?,?)', sozcukler)
    db.executemany(
        'INSERT INTO tur (anahtar, ad, duz, agirlik) VALUES (?,?,?,?)',
        [(a, ad, normalize(ad), ag) for a, (ad, ag) in sorted(TUR_ADLARI.items())],
    )
    db.executemany('INSERT INTO bilgi (anahtar, deger) VALUES (?,?)', [
        ('kaynak', 'OpenStreetMap — BBBike Istanbul özeti'),
        ('nokta', str(len(kayitlar))),
        ('sozcuk', str(len(sozcukler))),
    ])
    db.executescript("""
      CREATE INDEX i_sozcuk ON sozcuk (sozcuk, poi);
      CREATE INDEX i_poi_tur ON poi (tur);
      CREATE INDEX i_poi_konum ON poi (lat, lon);
    """)
    db.commit()
    db.execute('VACUUM')
    db.close()
    print(f'{len(kayitlar)} nokta, {len(sozcukler)} sözcük -> {cikti} ({os.path.getsize(cikti)/1048576:.1f} MB)')

main(sys.argv[1], sys.argv[2])
