# Marmaray'ın kısa dönüş hattını gerçek kapsamına ve sıklığına getirir.
#
# Sorun: İBB verisinde Marmaray üç hat olarak duruyor —
#   Marmaray   Halkalı–Gebze, 43 istasyon, 15 dakikada bir
#   Marmaray1  Zeytinburnu–Söğütlüçeşme, 7 istasyon, 8 dakikada bir
#   Marmaray2  Halkalı–Bahçeşehir banliyösü
#
# 1) Kapsam: kısa dönüş hattı gerçekte **Ataköy–Pendik** arasında çalışıyor, tünelin yedi
#    istasyonu arasında değil. Seferler tam hattın kendi istasyon sırası ve geçiş süreleriyle
#    iki uçtan uzatılıyor; saatler uydurulmuyor, tam hattın seferinden alınıyor.
#
# 2) Sıklık: TCDD'nin günlük tren saatleri sayfası "Gebze–Halkalı 15 dk, Ataköy–Pendik 8 dk"
#    diyor ama aynı sayfada günlük sefer sayıları da var: Gebze-Halkalı-Gebze 148, Pendik-
#    Ataköy-Pendik 139. 148 sefer iki yönde 15 dakikada bir ~18,5 saat demek; 139 da aynı
#    hesapla kısa dönüş trenlerinin de ~15 dakikada bir kalktığını gösteriyor (8 dakikada bir
#    olsa günde ~270 sefer olurdu). "8 dk", Ataköy–Pendik arasında iki hattın birlikte verdiği
#    aralık: kısa dönüş trenleri uzun trenlerin arasına, yarım aralık kaydırılarak giriyor.
#    İBB verisindeki 480 sn bu yüzden 900 sn'ye çekiliyor ve başlangıç saati, ortak bir
#    istasyonda (Sirkeci) uzun trenlerle yarım aralık fark olacak biçimde kaydırılıyor.
#
# Kullanım:
#   python marmaray-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import csv, io, shutil, sys, zipfile, collections

TAM_HAT = 'MARMARAY'
KISA_HAT = 'MARMARAY1'
# Kısa dönüş hattının gerçek uçları.
BATI_UC = 'Ataköy'
DOGU_UC = 'Pendik'
# Kısa dönüş trenlerinin kendi sıklığı ve uzun trenlerle hizalandığı istasyon (bkz. 2).
KISA_SIKLIK = 900
ORTAK_ISTASYON = 'Sirkeci'


def sn(t):
    p = [int(x) for x in t.split(':')]
    return p[0] * 3600 + p[1] * 60 + p[2]


def saat(s):
    s = int(s)
    return f'{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}'


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


def siklik_duzelt(tablolar, tamSeferler, kisaSeferler, saatler, durakAd, adlar):
    """Kısa dönüş trenlerini 15 dakikaya çekip uzun trenlerin arasına yerleştirir (bkz. 2)."""
    siklik = tablolar.get('frequencies.txt')
    if not siklik:
        return
    satirlar = collections.defaultdict(list)
    for f in siklik:
        satirlar[f['trip_id']].append(f)

    def yon_ve_faz(sefer, satir):
        """(doğuya mı, ORTAK_ISTASYON'dan geçişin aralığa göre fazı sn) ya da None."""
        liste = saatler.get(sefer['trip_id'], [])
        ad = [durakAd.get(r['stop_id'], '') for r in liste]
        if len(liste) < 2 or ORTAK_ISTASYON not in ad or ad[0] not in adlar or ad[-1] not in adlar:
            return None
        dogu = adlar.index(ad[0]) < adlar.index(ad[-1])
        fark = sn(liste[ad.index(ORTAK_ISTASYON)]['departure_time']) - sn(liste[0]['departure_time'])
        return dogu, (sn(satir['start_time']) + fark) % KISA_SIKLIK

    uzunFaz = {}
    for t in tamSeferler:
        for f in satirlar.get(t['trip_id'], []):
            if int(f['headway_secs']) != KISA_SIKLIK:
                continue
            sonuc = yon_ve_faz(t, f)
            if sonuc:
                uzunFaz.setdefault(sonuc[0], sonuc[1])

    for t in kisaSeferler:
        for f in satirlar.get(t['trip_id'], []):
            sonuc = yon_ve_faz(t, f)
            if not sonuc or sonuc[0] not in uzunFaz:
                continue
            hedef = (uzunFaz[sonuc[0]] + KISA_SIKLIK // 2) % KISA_SIKLIK
            kaydir = (hedef - sonuc[1]) % KISA_SIKLIK
            if kaydir > KISA_SIKLIK // 2:
                kaydir -= KISA_SIKLIK
            eski = f"{f['start_time'][:5]}–{f['end_time'][:5]} / {int(f['headway_secs']) // 60} dk"
            kaydir = round((sn(f['start_time']) + kaydir) / 60) * 60 - sn(f['start_time'])  # tam dakikaya
            f['start_time'] = saat(max(0, sn(f['start_time']) + kaydir))
            f['end_time'] = saat(sn(f['end_time']) + kaydir)
            f['headway_secs'] = str(KISA_SIKLIK)
            print(f"  {t['trip_id']} ({'doğuya' if sonuc[0] else 'batıya'}): {eski} → "
                  f"{f['start_time'][:5]}–{f['end_time'][:5]} / {KISA_SIKLIK // 60} dk "
                  f"({ORTAK_ISTASYON}'de uzun trenlerle {KISA_SIKLIK // 120} dk arayla)")


def main(zip_yolu):
    tablolar, alanlar = zip_oku(zip_yolu)
    rotalar, seferler, duraklar = tablolar['routes.txt'], tablolar['trips.txt'], tablolar['stops.txt']
    durakAd = {d['stop_id']: d['stop_name'] for d in duraklar}

    saatler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        saatler[r['trip_id']].append(r)
    for liste in saatler.values():
        liste.sort(key=lambda r: int(r['stop_sequence']))

    def rota_bul(kod):
        for r in rotalar:
            if (r['route_short_name'] or '').strip().upper() == kod:
                return r
        return None

    tam, kisa = rota_bul(TAM_HAT), rota_bul(KISA_HAT)
    if not tam or not kisa:
        print(f'{TAM_HAT} ya da {KISA_HAT} bulunamadı; dokunulmadı.')
        return

    rotaSefer = collections.defaultdict(list)
    for t in seferler:
        rotaSefer[t['route_id']].append(t)

    # Tam hattın en uzun seferi: istasyon sırası ve geçiş süreleri buradan.
    tamSeferler = [t for t in rotaSefer[tam['route_id']] if len(saatler[t['trip_id']]) > 2]
    if not tamSeferler:
        print('Tam hattın seferi yok; dokunulmadı.')
        return
    temsilci = max(tamSeferler, key=lambda t: len(saatler[t['trip_id']]))
    omurga = saatler[temsilci['trip_id']]
    # Sefer hangi yönde yazılmışsa o yönde okuyoruz; batıdan doğuya çeviriyoruz.
    adlar = [durakAd.get(r['stop_id'], '') for r in omurga]
    if adlar and adlar[0] == 'Gebze':
        omurga = list(reversed(omurga))
        adlar = list(reversed(adlar))

    # Ardışık istasyonlar arası geçiş süreleri (batıdan doğuya).
    gecis = []
    for a, b in zip(omurga, omurga[1:]):
        fark = sn(b['arrival_time']) - sn(a['departure_time'])
        gecis.append(max(60, fark))

    try:
        bati = adlar.index(BATI_UC)
        dogu = adlar.index(DOGU_UC)
    except ValueError:
        print(f'{BATI_UC} ya da {DOGU_UC} tam hatta bulunamadı; dokunulmadı.')
        return

    yeniDurak = 0
    uzatilan = 0
    for t in rotaSefer[kisa['route_id']]:
        liste = saatler[t['trip_id']]
        if len(liste) < 2:
            continue
        seferAdlar = [durakAd.get(r['stop_id'], '') for r in liste]
        try:
            basYer = adlar.index(seferAdlar[0])
            bitYer = adlar.index(seferAdlar[-1])
        except ValueError:
            print(f"  {t['trip_id']}: durakları tam hatta oturmadı, atlandı")
            continue

        dogudanBatiya = basYer > bitYer
        # Uzatılmış dizinin tam hattaki aralığı hep aynı: batı ucundan doğu ucuna.
        dilim = list(range(bati, dogu + 1))
        if dogudanBatiya:
            dilim.reverse()

        ornek = liste[0]
        # Seferin mevcut ilk istasyonunun yeni dizideki yeri: saatleri ona göre kaydırıyoruz.
        baslangic = dilim.index(basYer)

        yeni = []
        t0 = sn(liste[0]['arrival_time'])
        # Önce mevcut istasyonun öncesindeki kısım, geriye doğru.
        zaman = t0
        oncekiler = []
        for adim in range(baslangic, 0, -1):
            onceki = dilim[adim - 1]
            simdiki = dilim[adim]
            sure = gecis[min(onceki, simdiki)]
            zaman -= sure
            oncekiler.append((onceki, zaman))
        oncekiler.reverse()

        for yer, an in oncekiler:
            yeni.append({**ornek, 'stop_id': omurga[yer]['stop_id'], 'arrival_time': saat(an),
                         'departure_time': saat(an), 'stop_headsign': adlar[yer], 'shape_dist_traveled': ''})
            yeniDurak += 1

        yeni.extend(liste)

        # Sonra seferin son istasyonundan sonrası, ileriye doğru.
        sonYer = dilim.index(bitYer)
        zaman = sn(liste[-1]['departure_time'])
        for adim in range(sonYer, len(dilim) - 1):
            simdiki = dilim[adim]
            sonraki = dilim[adim + 1]
            zaman += gecis[min(simdiki, sonraki)]
            yeni.append({**liste[-1], 'stop_id': omurga[sonraki]['stop_id'], 'arrival_time': saat(zaman),
                         'departure_time': saat(zaman), 'stop_headsign': adlar[sonraki], 'shape_dist_traveled': ''})
            yeniDurak += 1

        for i, r in enumerate(yeni, start=1):
            r['stop_sequence'] = str(i)
            r['shape_dist_traveled'] = ''
        saatler[t['trip_id']] = yeni
        uzatilan += 1
        print(f"  {t['trip_id']}: {len(liste)} → {len(yeni)} istasyon "
              f"({durakAd.get(yeni[0]['stop_id'])} → {durakAd.get(yeni[-1]['stop_id'])})")

    for t in seferler:
        if t['route_id'] == kisa['route_id']:
            t['shape_id'] = ''
    kisa['route_long_name'] = f'{BATI_UC.upper()} - {DOGU_UC.upper()}'

    yeniSaatler = []
    for t in seferler:
        yeniSaatler.extend(saatler.get(t['trip_id'], []))
    tablolar['stop_times.txt'] = yeniSaatler

    siklik_duzelt(tablolar, rotaSefer[tam['route_id']], rotaSefer[kisa['route_id']], saatler, durakAd, adlar)

    zip_yaz(zip_yolu, tablolar, alanlar)
    print(f'\n{uzatilan} sefer uzatıldı, {yeniDurak} sefer-durak satırı eklendi.')
    print(f'{KISA_HAT} artık {BATI_UC}–{DOGU_UC} arasında, {KISA_SIKLIK // 60} dakikada bir çalışıyor.')


main(sys.argv[1] if len(sys.argv) > 1 else r'C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip')
