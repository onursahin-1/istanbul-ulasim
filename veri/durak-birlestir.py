# Aynı yeri anlatan durakları tek istasyon altında toplar (GTFS parent_station).
#
# Sorun: "Üsküdar" araması 6 sonuç veriyor — Marmaray Üsküdar, M5 Üsküdar,
# Üsküdar ŞH., Üsküdar Turyol, Üsküdar Dentur, Beşiktaş-Üsküdar ŞH. Hepsi aynı
# meydan. Otobüste durum daha kötü: yolun iki yakası ayrı durak olduğu için
# "Mecidiyeköy" yazan yolcuya art arda aynı ad altı kez çıkıyor. İki beslemede de
# parent_station alanı baştan sona boş.
#
# Kural iki parçalı:
#   1) Sadeleştirilmiş ad aynı VE aralarındaki mesafe eşiğin altında. Eşik raylı
#      duraklar arasında 350 m (istasyonlar uzun, Yenikapı'nın uçları 600 m),
#      diğerlerinde 200 m. Ad tek başına yetmiyor: "FATİH MAHALLESİ" şehirde 17
#      yerde geçiyor, aralarında 64 km var.
#   2) Adı tutmayan ama gerçekte tek aktarma olan istasyonlar için elle yazılmış
#      liste (EL_ILE). Her satırın yanında ölçülen mesafe duruyor.
#
# Sadeleştirmede işletmeci ve araç ekleri atılıyor: "Üsküdar ŞH.", "Üsküdar Turyol",
# "ÜSKÜDAR MARMARAY" hepsi "uskudar" oluyor.
#
# parent_station OTP'de bedava aktarma açmıyor: yürüme süreleri yine sokak ağından
# hesaplanıyor. Kazanç aramada ve aktarma modelinde.
#
# Kullanım:
#   python durak-birlestir.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
#   python durak-birlestir.py C:\otp\istanbul\istanbul-iett-gtfs.zip

import csv, io, math, re, shutil, sys, zipfile, collections

ESIK = 200               # metre, genel
ESIK_RAYLI = 350         # metre, iki uç da raylı/vapur olduğunda
EL_ESIK = 400            # metre, elle eşlenen çiftler için üst sınır
RAYLI_TURLER = {'0', '1', '2', '4', '5', '6', '7'}

# Adı tutmayan gerçek aktarmalar. Sağdaki sayı ölçülen mesafe.
EL_ILE = [
    ('Ayrılıkçeşme', 'Ayrılık Çeşmesi'),          #  16 m — Marmaray / M4
    ('Kadıköy', 'İskele Cami'),                   #  56 m — M4 / T3
    ('Topkapı', 'Topkapı - Ulubatlı'),            #  80 m — T1 / M1
    ('Beyoğlu', 'Şişhane'),                       # 102 m — F2 / M2
    ('Bakırköy - İncirli', 'İncirli'),            # 115 m — M1A / M3
    ('Vatan', 'Topkapı - Ulubatlı'),              # 161 m — T4 / M1
    ('Mecidiyeköy', 'Şişli - Mecidiyeköy'),       # 183 m — M7 / M2
    ('Kayaşehir Merkez', 'Kayaşehir'),            # 194 m — M3 / M11
    ('Aksaray', 'Yusufpaşa'),                     # 217 m — M1 / T1
    ('Bakırköy', 'Özgürlük Meydanı'),             # 238 m — Marmaray / M3
]
# Bilerek dışarıda bırakılanlar — mesafe ya da aktarma olup olmadığı tartışmalı:
#   Olimpiyat (M3A/M9) – Olimpiyatköy (M11)      281 m
#   Karadeniz Mah. (M7) – KİPTAŞ Venezia (T4)     84 m
#   Bağcılar Meydan (M1B) – Bağcılar (T1)        415 m
#   Laleli (T1) – Vezneciler (M2)                297 m
#   Altıyol (T3) – Kadıköy (M4)                  583 m

AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}
# Aynı yeri anlatan ama işletmeciyi ya da peronu ada yapıştıran ekler.
EKLER = [r'\bşh\.?', r'\bşehir ?hatları\b', r'\bturyol\b', r'\bdentur( avrasya)?\b',
         r'\bi̇do\b', r'\bido\b', r'\bferibot\b', r'\bvapur\b', r'\bi̇skele(si)?\b',
         r'\biskele(si)?\b', r'\bmotor\b', r'\bdurağı\b', r'\bduragi\b', r'\bperon(lar)?\b',
         r'\(.*?\)', r'\bmetro\b', r'\bmarmaray\b', r'\btramvay\b']
# Ad tek başına ayırt edici değil.
GENEL = {'minibusduragi', 'minibus', 'duragi', 'iskele', 'sahil', 'meydan', 'merkez', ''}


def sade(metin):
    k = (metin or '').replace('I', 'ı').replace('İ', 'i').lower()
    return ''.join(AKSAN.get(h, h) for h in k if AKSAN.get(h, h).isalnum())


def ad_sadele(ad):
    d = (ad or '').replace('I', 'ı').replace('İ', 'i').lower()
    for e in EKLER:
        d = re.sub(e, ' ', d)
    d = re.sub(r'^\s*yeni(?=\s)', ' ', d)
    return sade(d)


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def tablo_oku(z, ad):
    """Tek bir GTFS tablosunu sözlük listesi olarak okur."""
    with z.open(ad) as ham:
        okuyucu = csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig'))
        return list(okuyucu), (okuyucu.fieldnames or [])


def sutun_akit(z, ad, sutunlar):
    """Büyük tabloyu belleğe almadan, yalnız istenen sütunları satır satır verir.

    İETT'nin stop_times.txt'si 6 milyon satır; sözlüğe çevirince birkaç gigabayt
    ediyor. Durak-araç eşlemesi için iki sütun yetiyor."""
    with z.open(ad) as ham:
        okuyucu = csv.reader(io.TextIOWrapper(ham, encoding='utf-8-sig'))
        basliklar = next(okuyucu)
        yer = [basliklar.index(s) for s in sutunlar]
        for satir in okuyucu:
            yield [satir[i] for i in yer]


def stops_yaz(zip_yolu, satirlar, alanlar):
    """stops.txt'yi değiştirip zip'in geri kalanını olduğu gibi kopyalar."""
    gecici = zip_yolu + '.yeni'
    tampon = io.StringIO()
    w = csv.DictWriter(tampon, fieldnames=alanlar, lineterminator='\n', extrasaction='ignore')
    w.writeheader()
    w.writerows(satirlar)
    with zipfile.ZipFile(zip_yolu) as eski, zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as yeni:
        for bilgi in eski.infolist():
            if bilgi.filename == 'stops.txt':
                yeni.writestr('stops.txt', tampon.getvalue())
            else:
                yeni.writestr(bilgi, eski.read(bilgi.filename))
    shutil.move(gecici, zip_yolu)


class Baglar:
    """Birleşim-bulma: hangi durakların aynı istasyona düştüğünü tutar."""

    def __init__(self):
        self.ust = {}

    def bul(self, x):
        self.ust.setdefault(x, x)
        while self.ust[x] != x:
            self.ust[x] = self.ust[self.ust[x]]
            x = self.ust[x]
        return x

    def birlestir(self, a, b):
        a, b = self.bul(a), self.bul(b)
        if a != b:
            self.ust[a] = b


def kumele(duraklar, rayli_mi):
    """Ad + yakınlık ile durakları kümeler. {kok: [durak]} döner (tek kişilikler yok)."""
    bag = Baglar()
    adli = collections.defaultdict(list)
    for s in duraklar:
        a = ad_sadele(s['stop_name'])
        if a and a not in GENEL:
            adli[a].append(s)

    def yakin_mi(a, b):
        esik = ESIK_RAYLI if (rayli_mi(a['stop_id']) and rayli_mi(b['stop_id'])) else ESIK
        return mesafe((float(a['stop_lat']), float(a['stop_lon'])),
                      (float(b['stop_lat']), float(b['stop_lon']))) <= esik

    # Aynı adlılar içinde ızgarayla eşleştir: ad başına O(n²) olmasın.
    derece = ESIK_RAYLI / 111000.0
    for v in adli.values():
        if len(v) < 2:
            continue
        izgara = collections.defaultdict(list)
        for s in v:
            izgara[(int(float(s['stop_lat']) / derece), int(float(s['stop_lon']) / derece))].append(s)
        for (gi, gj), hucre in izgara.items():
            komsu = [t for di in (-1, 0, 1) for dj in (-1, 0, 1) for t in izgara.get((gi + di, gj + dj), [])]
            for s in hucre:
                for t in komsu:
                    if s['stop_id'] != t['stop_id'] and yakin_mi(s, t):
                        bag.birlestir(s['stop_id'], t['stop_id'])

    # Elle eşlenen çiftler.
    elle = collections.defaultdict(list)
    for s in duraklar:
        elle[ad_sadele(s['stop_name'])].append(s)
    for x, y in EL_ILE:
        for a in elle.get(ad_sadele(x), []):
            for b in elle.get(ad_sadele(y), []):
                if mesafe((float(a['stop_lat']), float(a['stop_lon'])),
                          (float(b['stop_lat']), float(b['stop_lon']))) <= EL_ESIK:
                    bag.birlestir(a['stop_id'], b['stop_id'])

    kume = collections.defaultdict(list)
    for s in duraklar:
        if s['stop_id'] in bag.ust:
            kume[bag.bul(s['stop_id'])].append(s)
    return {k: v for k, v in kume.items() if len(v) > 1}


def istasyon_adi(uyeler):
    """Kümenin adı: en çok tekrar eden yazım, eşitlikte en kısası."""
    sayac = collections.Counter(u['stop_name'].strip() for u in uyeler)
    return min(sayac, key=lambda a: (-sayac[a], len(a), a))


def main(zip_yolu):
    with zipfile.ZipFile(zip_yolu) as z:
        duraklarHam, alanlar = tablo_oku(z, 'stops.txt')
        rotalar, _ = tablo_oku(z, 'routes.txt')
        seferler, _ = tablo_oku(z, 'trips.txt')
        seferRota = {t['trip_id']: t['route_id'] for t in seferler}
        rotaTur = {r['route_id']: r['route_type'] for r in rotalar}
        seferTur = {tid: rotaTur.get(rid, '') for tid, rid in seferRota.items()}
        durTur = collections.defaultdict(set)
        for tid, sid in sutun_akit(z, 'stop_times.txt', ['trip_id', 'stop_id']):
            durTur[sid].add(seferTur.get(tid, ''))
    del seferler, seferRota, seferTur

    if 'parent_station' not in alanlar:
        alanlar = alanlar + ['parent_station']
    if 'location_type' not in alanlar:
        alanlar = alanlar + ['location_type']

    # Betik yeniden çalıştırılabilsin: önceki turun istasyonlarını temizle.
    onceki = sum(1 for s in duraklarHam if s['stop_id'].startswith('ana-'))
    duraklarHam = [s for s in duraklarHam if not s['stop_id'].startswith('ana-')]
    for s in duraklarHam:
        if (s.get('parent_station') or '').startswith('ana-'):
            s['parent_station'] = ''
    if onceki:
        print(f'  önceki {onceki} istasyon temizlendi, baştan kuruluyor')

    duraklar = [s for s in duraklarHam
                if s['stop_id'] in durTur and (s.get('location_type') or '0') == '0']
    kumeler = kumele(duraklar, lambda sid: bool(durTur[sid] & RAYLI_TURLER))

    istasyonlar = []
    for kok, uyeler in sorted(kumeler.items()):
        durak_id = 'ana-' + kok
        enlem = sum(float(u['stop_lat']) for u in uyeler) / len(uyeler)
        boylam = sum(float(u['stop_lon']) for u in uyeler) / len(uyeler)
        satir = {a: '' for a in alanlar}
        satir.update({'stop_id': durak_id, 'stop_name': istasyon_adi(uyeler),
                      'stop_lat': f'{enlem:.6f}', 'stop_lon': f'{boylam:.6f}',
                      'location_type': '1', 'parent_station': ''})
        istasyonlar.append(satir)
        for u in uyeler:
            u['parent_station'] = durak_id
            u['location_type'] = '0'

    caplar = sorted(max(mesafe((float(a['stop_lat']), float(a['stop_lon'])),
                               (float(b['stop_lat']), float(b['stop_lon'])))
                        for i, a in enumerate(v) for b in v[i + 1:]) for v in kumeler.values())
    stops_yaz(zip_yolu, duraklarHam + istasyonlar, alanlar)

    toplanan = sum(len(v) for v in kumeler.values())
    print(f'{zip_yolu}')
    print(f'  {len(duraklar)} kullanılan duraktan {toplanan} tanesi {len(kumeler)} istasyona toplandı')
    print(f'  aramada {toplanan - len(kumeler)} tekrar eksiliyor')
    if caplar:
        print(f'  küme çapı: ortanca {caplar[len(caplar) // 2]:.0f} m, '
              f'%95 {caplar[int(len(caplar) * 0.95)]:.0f} m, en büyük {caplar[-1]:.0f} m')
    for v in sorted(kumeler.values(), key=len, reverse=True)[:5]:
        print(f"  {len(v):3} durak · {istasyon_adi(v)}")


main(sys.argv[1])
