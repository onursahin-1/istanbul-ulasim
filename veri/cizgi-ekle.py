# Çizgisi olmayan raylı hatlara OSM'den gelen gerçek ray geometrisini verir.
#
# Sorun: İBB'nin shapes.txt'si uzattığımız hatları kapsamıyor. istasyon-tamamla.py
# ve marmaray-duzelt.py, sefer dizisini uzatınca eski çizgi artık uymadığı için
# shape_id'yi boşaltmak zorunda kalıyor. Sonuç: uygulama M4'ü Kadıköy'den Sabiha
# Gökçen'e, Marmaray1'i Ataköy'den Pendik'e düz bir çizgi olarak çiziyor —
# yolculuk ekranındaki harita Boğaz'ın üstünden geçiyor.
#
# Rayın kendi çizgisi OSM'de zaten var (osm-cikar.py artık bağıntının yol
# üyelerinin geometrisini de çıkarıyor). Burada o çizgi hatta bağlanıyor.
#
# Güvenlik ağı: çizgi ancak seferin BÜTÜN durakları ona yeterince yakınsa ve
# duraklar çizgi boyunca sırayla ilerliyorsa kullanılıyor. Marmaray2 banliyö
# şubesi gibi OSM çizgisinin kapsamadığı hatlar böyle elenir.
#
# Çizgisi zaten olan seferlere dokunulmuyor.
#
# Kullanım:
#   python osm-cikar.py C:\otp\istanbul\Istanbul.osm.pbf C:\otp\osm-hatlar.json
#   python cizgi-ekle.py C:\otp\osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import csv, io, json, math, shutil, sys, zipfile, collections

CIZGI_BIRLESIM = 150     # metre, iki ray parçasının aynı hat sayılması için uç mesafesi
CIZGI_KATLAMA = 1.6      # bağlanan çizgi en uzun parçanın bu katını geçerse bağlama yanlıştır
TOLERANS = 300           # metre, durağın çizgiye en fazla uzaklığı
RAYLI_TURLER = {'0', '1', '2', '5', '6', '7'}

# GTFS kısa adı ile OSM'deki ref aynı değilse burada eşlenir.
REF_ESLEME = {'MARMARAY': 'B1', 'MARMARAY1': 'B1', 'MARMARAY2': 'B1'}

AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}


def sade(metin):
    k = (metin or '').replace('I', 'ı').replace('İ', 'i').lower()
    return ''.join(AKSAN.get(h, h) for h in k if AKSAN.get(h, h).isalnum())


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def cizgi_uzunlugu(c):
    return sum(mesafe(a, b) for a, b in zip(c, c[1:]))


def en_yakin_nokta(cizgi, konum):
    """Bir noktaya en yakın çizgi noktasının sırası ve uzaklığı."""
    i = min(range(len(cizgi)), key=lambda k: mesafe(cizgi[k], konum))
    return i, mesafe(cizgi[i], konum)


def ayni_cizgi(a, b):
    """İki parça aynı hattın iki yönü mü? Uçları (sırasız) tutuyorsa öyle."""
    for x, y in ((b[0], b[-1]), (b[-1], b[0])):
        if mesafe(a[0], x) <= CIZGI_BIRLESIM and mesafe(a[-1], y) <= CIZGI_BIRLESIM:
            return True
    return False


def cizgi_kur(cizgiler):
    """Bir hattın ray parçalarını tek çizgiye indirir.

    Aynı hat OSM'de hem gidiş hem dönüş bağıntısı olarak duruyor: aynı ray, ters
    yön, biraz farklı düğüm sayısı. Bunlar önce eleniyor — elenmezlerse uç uca
    eklenip hattı iki katı uzunlukta, gidip geri gelen bir çizgi yapıyorlar.
    Kalanlar (M7 gibi gerçekten parçalı hatlar) uçlarından bağlanıyor."""
    adaylar = sorted((list(c) for c in cizgiler if len(c) >= 2), key=cizgi_uzunlugu, reverse=True)
    benzersiz = []
    for c in adaylar:
        if not any(ayni_cizgi(c, v) for v in benzersiz):
            benzersiz.append(c)
    if not benzersiz:
        return []

    kollar = [list(c) for c in benzersiz]
    degisti = True
    while degisti and len(kollar) > 1:
        degisti = False
        for i in range(len(kollar)):
            for j in range(len(kollar)):
                if i == j:
                    continue
                for x in (kollar[i], kollar[i][::-1]):
                    for y in (kollar[j], kollar[j][::-1]):
                        if mesafe(x[-1], y[0]) > CIZGI_BIRLESIM:
                            continue
                        kollar = [k for n, k in enumerate(kollar) if n not in (i, j)] + [x + y]
                        degisti = True
                        break
                    if degisti:
                        break
                if degisti:
                    break
            if degisti:
                break

    en_uzun_kol = max(kollar, key=cizgi_uzunlugu)
    # Bağlama yanlış gittiyse (çizgi kendi üstüne katlandıysa) tek parçaya dön.
    if cizgi_uzunlugu(en_uzun_kol) > CIZGI_KATLAMA * cizgi_uzunlugu(benzersiz[0]):
        return benzersiz[0]
    return en_uzun_kol


def osm_cizgileri(yol):
    """OSM ref'i başına tek bir ray çizgisi."""
    d = json.load(io.open(yol, encoding='utf-8'))
    ham = collections.defaultdict(list)
    for h in d['hatlar']:
        if len(h.get('cizgi') or []) >= 2 and h.get('ref'):
            ham[h['ref']].append([(float(p[0]), float(p[1])) for p in h['cizgi']])
    return {ref: cizgi_kur(c) for ref, c in ham.items()}


def zip_oku(yol):
    tablolar, alanlar = {}, {}
    with zipfile.ZipFile(yol) as z:
        for ad in z.namelist():
            with z.open(ad) as ham:
                okuyucu = csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig'))
                tablolar[ad] = list(okuyucu)
                alanlar[ad] = okuyucu.fieldnames or []
    return tablolar, alanlar


def zip_yaz(yol, tablolar, alanlar):
    gecici = yol + '.yeni'
    with zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as z:
        for ad, satirlar in tablolar.items():
            tampon = io.StringIO()
            w = csv.DictWriter(tampon, fieldnames=alanlar[ad], lineterminator='\n', extrasaction='ignore')
            w.writeheader()
            w.writerows(satirlar)
            z.writestr(ad, tampon.getvalue())
    shutil.move(gecici, yol)


def sefer_cizgisi(cizgi, konumlar):
    """Seferin bu çizgiyi kullanıp kullanamayacağı.

    (yon, en_buyuk_sapma) döner; yon None ise çizgi bu sefere uymuyor."""
    yerler, sapmalar = [], []
    for k in konumlar:
        i, s = en_yakin_nokta(cizgi, k)
        yerler.append(i)
        sapmalar.append(s)
    sapma = max(sapmalar)
    if sapma > TOLERANS:
        return None, sapma
    if all(a < b for a, b in zip(yerler, yerler[1:])):
        return 0, sapma
    if all(a > b for a, b in zip(yerler, yerler[1:])):
        return 1, sapma
    return None, sapma


def main(json_yolu, zip_yolu):
    cizgiler = osm_cizgileri(json_yolu)
    tablolar, alanlar = zip_oku(zip_yolu)

    konum = {d['stop_id']: (float(d['stop_lat']), float(d['stop_lon'])) for d in tablolar['stops.txt']}
    rota = {r['route_id']: r for r in tablolar['routes.txt']}
    saatler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        saatler[r['trip_id']].append(r)
    for liste in saatler.values():
        liste.sort(key=lambda r: int(r['stop_sequence']))

    yeniCizgi = {}
    yazilan = collections.Counter()
    elenen = {}

    for sefer in tablolar['trips.txt']:
        if sefer.get('shape_id'):
            continue
        ro = rota.get(sefer['route_id'])
        if not ro or ro['route_type'] not in RAYLI_TURLER:
            continue
        kod = (ro['route_short_name'] or '').strip()
        ref = REF_ESLEME.get(kod.upper(), kod)
        cizgi = cizgiler.get(ref) or []
        if len(cizgi) < 2:
            continue
        durak = [konum[r['stop_id']] for r in saatler[sefer['trip_id']] if r['stop_id'] in konum]
        if len(durak) < 2:
            continue

        yon, sapma = sefer_cizgisi(cizgi, durak)
        if yon is None:
            elenen.setdefault(kod, f'{sapma:.0f} m sapma ya da sıra tutmadı')
            continue
        cizgi_id = f'osm-{sade(kod)}-{yon}'
        if cizgi_id not in yeniCizgi:
            yeniCizgi[cizgi_id] = cizgi if yon == 0 else cizgi[::-1]
        sefer['shape_id'] = cizgi_id
        yazilan[kod] += 1

    for cizgi_id, noktalar in yeniCizgi.items():
        for i, (enlem, boylam) in enumerate(noktalar, start=1):
            tablolar['shapes.txt'].append({
                'shape_id': cizgi_id, 'shape_pt_lat': f'{enlem:.6f}', 'shape_pt_lon': f'{boylam:.6f}',
                'shape_pt_sequence': str(i), 'shape_dist_traveled': '',
            })

    zip_yaz(zip_yolu, tablolar, alanlar)

    print(f'{len(cizgiler)} OSM hattı okundu, {len(yeniCizgi)} çizgi yazıldı.')
    for cid, nk in sorted(yeniCizgi.items()):
        print(f'  {cid:16} {len(nk):5} nokta  {cizgi_uzunlugu(nk) / 1000:6.1f} km')
    print('çizgi verilen sefer:', dict(yazilan) or 'yok')
    if elenen:
        print('uymadığı için atlanan hat:', elenen)


main(sys.argv[1], sys.argv[2])
