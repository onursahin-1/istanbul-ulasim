# Marmaray, Marmaray banliyösü (Halkalı–Bahçeşehir), M11 ve T6'nın gerçek tarifesini
# raylı GTFS'e işler.
#
# Sorun: bu hatlar beslemede yalnız sıklıkla tanımlı (frequencies.txt: "06:00–24:00
# her 15 dk"). OTP rota kurarken bunları kullanıyor ama durak kalkışlarında döndürmüyor;
# uygulamanın Tarife ekranı bu yüzden "bu duraktan bu yöne sefer yok" diyordu. Saatler de
# tahmindi: Marmaray'ın iki yönü de 06:00'da başlıyordu, gerçekte Halkalı'dan 05:58,
# Gebze'den 06:05.
#
# Kaynak: TCDD Taşımacılık'ın Marmaray "Sefer Saatleri" sayfası
# (https://www.tcddtasimacilik.gov.tr/marmaray/tr/sefersaatleri). Sayfa her trenin her
# istasyondaki saatini gösteriyor; M11 (Gayrettepe–Halkalı) ve T6 (Sirkeci–Kazlıçeşme)
# da TCDD'nin işlettiği hatlar ve aynı sayfada. Veriyi marmaray-tarife-indir.mjs alıyor (elle
# yedek yol: marmaray-tarife-al.js).
#
# Girdi biçimi (marmaray-tarife.json):
#   istasyonlar  ["Ad|İl", …]
#   desenler     [{s: [istasyon sırası], o: [ilk kalkıştan dakika ya da [varış, kalkış]]}]
#   kosular      [[desen, günler, ilk kalkış dk, aralık dk, adet]]
#                günler: TCDD'nin gun01..gun06 işaretleri (Pzt..Cmt). Hepsi işaretliyse
#                her gün; "000011" cuma ve cumartesi (hafta sonu gecesine uzanan ek trenler).
#
# Eşleme: istasyon adları beslemedeki duraklara hat hat bağlanır (Marmaray'ın "Pendik MR",
# "Marmaray Üsküdar" gibi adları sadeleştirilerek). "Makas" noktaları istasyon değil, atlanır.
# Bir desen hangi hatta düşer:
#   M11 istasyonları          → osm-m11
#   T6 istasyonları           → ek-t6
#   Bahçeşehir kolu           → Marmaray2
#   iki ucu Ataköy–Pendik içi → Marmaray1 (kısa dönüş)
#   geri kalanı               → Marmaray (Gebze–Halkalı ve kısmi seferler)
#
# Bu hatların eski seferleri (sıklık tanımlıları dahil) silinir. Yeniden çalıştırılabilir.
#
# Kullanım (metro-tarife-uygula.py'den SONRA; ardından cizgi-ekle.py ve durak-birlestir.py):
#   python marmaray-tarife-uygula.py C:\otp\marmaray-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import collections, csv, datetime, io, json, re, shutil, sys, zipfile

csv.field_size_limit(10 ** 7)

ONEK = 'tcdd-'
SERVISLER = {
    # TCDD işareti → (service_id, pazartesiden pazara maske)
    'hergun': (ONEK + 'hergun', '1111111'),
    'cumacmt': (ONEK + 'cumacmt', '0000110'),
}
# TCDD adı → beslemedeki ad (sadeleştirmeden sonra hâlâ tutmayanlar).
AD_ESLE = {
    'ayrilikcesmesi': 'ayrilikcesme',
    'surayyaplaji': 'sureyyaplaji',
    'ibnihaldununiv': 'ibnhaldununiversitesi',
    'istanbul': 'sirkeci',          # T6'nın Sirkeci ucu TCDD'de "İstanbul"
}
# Rota seçimi için beslemedeki rota kimlikleri; yoksa kısa addan bulunur.
ROTA_KISA = {'MARMARAY': 'marmaray', 'MARMARAY1': 'kisa', 'MARMARAY2': 'banliyo', 'M11': 'm11', 'T6': 't6'}


def sade(ad):
    a = ad.split('|')[0].strip()
    a = re.sub(r'^Marmaray\s+', '', a)
    a = re.sub(r'\s+(MR|Durağı)$', '', a)
    a = a.replace('İ', 'i').replace('I', 'ı').lower()
    for k, v in {'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}.items():
        a = a.replace(k, v)
    a = re.sub(r'[^a-z0-9]', '', a)
    return AD_ESLE.get(a, a)


def saat_yaz(dk):
    return f'{dk // 60:02d}:{dk % 60:02d}:00'


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


def gun_servisi(isaret):
    return 'hergun' if set(isaret) == {'1'} else 'cumacmt' if isaret == '000011' else None


def main(json_yolu, zip_yolu):
    veri = json.load(io.open(json_yolu, encoding='utf-8'))
    tablolar, alanlar = zip_oku(zip_yolu)
    adlar = {d['stop_id']: d['stop_name'] for d in tablolar['stops.txt']}

    # Hatları bul.
    rota = {}
    for r in tablolar['routes.txt']:
        kisa = (r['route_short_name'] or '').strip().upper()
        if kisa in ROTA_KISA and r['route_type'] != '3':
            rota[ROTA_KISA[kisa]] = r['route_id']
    eksik = [k for k in ('marmaray', 'kisa', 'banliyo', 'm11', 't6') if k not in rota]
    if eksik:
        sys.exit(f'beslemede bulunamayan hat: {", ".join(eksik)}')
    hat_rotalari = set(rota.values())

    # Her hattın durakları (eski seferlerden), sade ad → stop_id; yön şablonları.
    seferler = {t['trip_id']: t for t in tablolar['trips.txt'] if t['route_id'] in hat_rotalari}
    diziler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        if r['trip_id'] in seferler:
            diziler[r['trip_id']].append((int(r['stop_sequence']), r['stop_id']))
    duraklar = collections.defaultdict(dict)      # hat → sade ad → stop_id
    sablon = collections.defaultdict(list)        # hat → [(direction_id, shape_id, [stop_id…])]
    for tid, d in diziler.items():
        t = seferler[tid]
        hat = next(k for k, v in rota.items() if v == t['route_id'])
        dizi = [s for _, s in sorted(d)]
        for s in dizi:
            duraklar[hat].setdefault(sade(adlar[s]), s)
        sablon[hat].append((t['direction_id'], t.get('shape_id', ''), dizi))

    istasyon = veri['istasyonlar']
    marmaray_adlari = set(duraklar['marmaray']) | set(duraklar['kisa'])
    # Yalnız o hatta olan istasyonlar hattı belirler (Kazlıçeşme, Yenikapı, Sirkeci, Halkalı
    # birden çok hatta var).
    m11 = set(duraklar['m11']) - marmaray_adlari
    t6 = set(duraklar['t6']) - marmaray_adlari
    banliyo = set(duraklar['banliyo']) - marmaray_adlari
    kisa_kapsam = set(duraklar['kisa'])

    def hat_sec(adlar_):
        kume = set(adlar_)
        if kume & m11:
            return 'm11'
        if kume & t6:
            return 't6'
        if kume & banliyo:
            return 'banliyo'
        if adlar_[0] in kisa_kapsam and adlar_[-1] in kisa_kapsam:
            return 'kisa'
        return 'marmaray'

    def yon_bul(hat, stoplar):
        """Şablonlardan durak sırası bu seferle aynı yönde olanın (direction, shape)."""
        en = None
        for yon, cizgi, dizi in sablon[hat]:
            sira = {s: i for i, s in enumerate(dizi)}
            ortak = [sira[s] for s in stoplar if s in sira]
            if len(ortak) < 2:
                continue
            artan = sum(1 for a, b in zip(ortak, ortak[1:]) if b > a)
            puan = (artan, len(dizi))
            if en is None or puan > en[0]:
                en = (puan, yon, cizgi)
        return (en[1], en[2]) if en else ('0', '')

    # Takvim: bugünden bir yıl.
    bugun = datetime.date.today()
    bas, bit = (bugun - datetime.timedelta(days=7)).strftime('%Y%m%d'), (bugun + datetime.timedelta(days=365)).strftime('%Y%m%d')
    tablolar['calendar.txt'] = [c for c in tablolar['calendar.txt'] if not c['service_id'].startswith(ONEK)]
    for sid, maske in SERVISLER.values():
        gunler = dict(zip(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], maske))
        tablolar['calendar.txt'].append({'service_id': sid, **gunler, 'start_date': bas, 'end_date': bit})

    yeni_seferler, yeni_saatler = [], []
    sayac = collections.Counter()
    eslesmeyen = collections.Counter()
    for no, (desen_no, isaret, ilk, aralik, adet) in enumerate(veri['kosular']):
        servis = gun_servisi(isaret)
        if servis is None:
            eslesmeyen[f'gün işareti {isaret}'] += adet
            continue
        desen = veri['desenler'][desen_no]
        noktalar = []
        for i, o in zip(desen['s'], desen['o']):
            ad = istasyon[i]
            if 'Makas' in ad:
                continue
            varis, kalkis = (o, o) if isinstance(o, int) else o
            noktalar.append((sade(ad), varis, kalkis, ad.split('|')[0]))
        hat = hat_sec([n[0] for n in noktalar])
        stoplar = []
        for sad, v, k, gercek in noktalar:
            s = duraklar[hat].get(sad)
            if s is None:
                # T6'da TCDD'nin listesinde olup beslemede olmayanlar (Samatya, Kadırga) tek
                # hatlı kesimdeki geçiş noktaları: yolcu almıyor.
                eslesmeyen[f'{hat}: {gercek}'] += adet
                continue
            stoplar.append((s, v, k))
        if len(stoplar) < 2:
            continue
        yon, cizgi = yon_bul(hat, [s for s, _, _ in stoplar])
        for k in range(adet):
            t0 = ilk + k * aralik
            tid = f'{ONEK}{hat}-{no}-{k}'
            yeni_seferler.append({
                'route_id': rota[hat], 'service_id': SERVISLER[servis][0], 'trip_id': tid,
                'trip_headsign': adlar[stoplar[-1][0]], 'trip_short_name': '', 'direction_id': yon,
                'block_id': '', 'shape_id': cizgi, 'wheelchair_accessible': '1', 'bikes_allowed': '1',
            })
            for sira, (s, v, kk) in enumerate(stoplar, start=1):
                yeni_saatler.append({
                    'trip_id': tid, 'arrival_time': saat_yaz(t0 + v), 'departure_time': saat_yaz(t0 + kk),
                    'stop_id': s, 'stop_sequence': str(sira), 'stop_headsign': '',
                    'pickup_type': '0', 'drop_off_type': '0', 'shape_dist_traveled': '', 'timepoint': '1',
                })
            sayac[(hat, servis)] += 1

    if not yeni_seferler:
        sys.exit('hiç sefer kurulamadı; besleme değişmedi')
    silinecek = {t['trip_id'] for t in tablolar['trips.txt']
                 if t['route_id'] in hat_rotalari or t['trip_id'].startswith(ONEK)}
    tablolar['trips.txt'] = [t for t in tablolar['trips.txt'] if t['trip_id'] not in silinecek] + yeni_seferler
    tablolar['stop_times.txt'] = [r for r in tablolar['stop_times.txt'] if r['trip_id'] not in silinecek] + yeni_saatler
    if 'frequencies.txt' in tablolar:
        tablolar['frequencies.txt'] = [f for f in tablolar['frequencies.txt'] if f['trip_id'] not in silinecek]
    zip_yaz(zip_yolu, tablolar, alanlar)

    print(f"TCDD tarifesi ({veri.get('alindi', '?')} alındı):")
    for (hat, servis), n in sorted(sayac.items()):
        print(f'  {hat:9} {servis:8} {n} sefer')
    for ne, n in eslesmeyen.items():
        print(f'  eşleşmedi: {ne} ({n} seferde atlandı)')
    print(f'{len(yeni_seferler)} sefer eklendi, {len(silinecek)} eski sefer kaldırıldı')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('kullanım: python marmaray-tarife-uygula.py <marmaray-tarife.json> <ray-vapur-gtfs.zip>')
    main(sys.argv[1], sys.argv[2])
