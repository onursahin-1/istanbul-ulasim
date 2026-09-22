# Raylı hatların uzun adını gerçek uç istasyonlarından yeniler.
#
# Sorun: istasyon-tamamla.py hatları uzatıyor ama route_long_name'e dokunmuyordu.
# Sonuç: M4 "KADIKÖY - TAVŞANTEPE" yazıyor, oysa Sabiha Gökçen'e kadar gidiyor;
# M3 "KİRAZLI - OLİMPİYAT - BAŞAKŞEHİR" yazıyor, oysa Bakırköy Sahil–Kayaşehir
# Merkez arasında. Ad hat listesinde ve hat ekranında görünüyor.
#
# Kural: ad ancak uç istasyonlardan **en az biri** adın içinde geçmiyorsa
# değiştiriliyor. Böylece İBB'nin daha bilgilendirici adları korunuyor — M11'in
# "GAYRETTEPE - İSTANBUL HAVALİMANI - HALKALI"sı iki ucu da içeriyor ve aradaki
# havalimanını da söylüyor, onu "Gayrettepe - Halkalı"ya indirmek kayıp olurdu.
#
# Halka hatlara dokunulmuyor: T3'ün iki ucu da Kadıköy iskelesinde ("İskele Cami"
# ve "Kadıköy İDO"), o yüzden uçlardan ad üretmek "KADIKÖY - MODA"yı bozuyordu.
#
# Kullanım:
#   python hat-adi-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import csv, io, math, shutil, sys, zipfile, collections

HALKA_ESIGI = 700        # metre; iki ucu bu kadar yakınsa hat halkadır, uçtan ad üretilmez
RAYLI_TURLER = {'0', '1', '2', '5', '6', '7'}
AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}


def sade(metin):
    k = (metin or '').replace('I', 'ı').replace('İ', 'i').lower()
    return ''.join(AKSAN.get(h, h) for h in k if AKSAN.get(h, h).isalnum())


def trBuyuk(metin):
    """Türkçe büyük harf: i → İ, ı → I. Python'un upper()'ı ikisini de I yapıyor."""
    return (metin or '').replace('i', 'İ').replace('ı', 'I').upper()


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


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


def main(zip_yolu):
    tablolar, alanlar = zip_oku(zip_yolu)
    durakAd = {d['stop_id']: d['stop_name'] for d in tablolar['stops.txt']}
    durakKonum = {d['stop_id']: (float(d['stop_lat']), float(d['stop_lon'])) for d in tablolar['stops.txt']}
    saatler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        saatler[r['trip_id']].append(r)
    for liste in saatler.values():
        liste.sort(key=lambda r: int(r['stop_sequence']))
    rotaSefer = collections.defaultdict(list)
    for t in tablolar['trips.txt']:
        rotaSefer[t['route_id']].append(t)

    degisen = []
    for ro in tablolar['routes.txt']:
        if ro['route_type'] not in RAYLI_TURLER:
            continue
        adaylar = rotaSefer.get(ro['route_id'], [])
        # Yön 0 varsa onu kullan: adın sırası hattın kendi gidiş yönü olsun.
        ileri = [t for t in adaylar if t.get('direction_id') == '0'] or adaylar
        if not ileri:
            continue
        temsilci = max(ileri, key=lambda t: len(saatler.get(t['trip_id'], [])))
        dizi = saatler.get(temsilci['trip_id'], [])
        if len(dizi) < 2:
            continue
        uclar = [durakAd.get(dizi[0]['stop_id'], ''), durakAd.get(dizi[-1]['stop_id'], '')]
        if not all(uclar):
            continue
        konumlar = [durakKonum.get(dizi[0]['stop_id']), durakKonum.get(dizi[-1]['stop_id'])]
        if all(konumlar) and mesafe(*konumlar) < HALKA_ESIGI:
            continue      # halka hat: uçlar aynı yerde, addan daha kötüsünü üretiriz

        eski = ro['route_long_name']
        if all(sade(u) in sade(eski) for u in uclar):
            continue
        yeni = ' - '.join(trBuyuk(u.strip()) for u in uclar)
        ro['route_long_name'] = yeni
        degisen.append((ro['route_short_name'], eski, yeni))

    zip_yaz(zip_yolu, tablolar, alanlar)
    print(f'{len(degisen)} hattın adı yenilendi.')
    for kod, eski, yeni in degisen:
        print(f'  {kod:10} {eski[:38]:40} → {yeni}')


main(sys.argv[1] if len(sys.argv) > 1 else r'C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip')
