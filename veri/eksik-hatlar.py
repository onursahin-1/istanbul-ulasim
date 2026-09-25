# İBB'nin donmuş raylı sistem beslemesinde hiç bulunmayan hatları ekler, kapanmış
# hattı çıkarır, İETT beslemesinde otobüs sanılan raylı hatların türünü düzeltir.
#
# Eksikler (2026-09 denetimi; OSM'de var, beslemede yok):
#   T5  Eminönü – Alibeyköy Cep Otogarı tramvayı (Metro İstanbul, 14 istasyon)
#   T6  Sirkeci – Kazlıçeşme raylı sistemi (TCDD Taşımacılık, 8 istasyon)
#   F4  Boğaziçi Üniversitesi/Hisarüstü – Aşiyan füniküleri (Metro İstanbul)
# Kapanan:
#   M3A İkitelli Sanayi – Olimpiyat: 2021'de M9'un parçası oldu. M9 aynı üç istasyonu
#       kapsıyor; M3A kalınca aramada hayalet bir hat ve çift sefer görünüyordu.
# Tür düzeltmesi (İETT beslemesi):
#   T2  Taksim – Tünel nostaljik tramvayı, F2 Tünel füniküleri: İETT işletiyor ve
#       beslemede route_type=3 (otobüs) duruyorlar. Tarifeleri gerçek; yalnız tür yanlış.
#
# Sıklık düzeltmesi (yalnız sıklıkla tanımlı gündüz seferleri; gece metrosuna dokunulmaz):
#   M8  beslemede yalnız hafta içi ve 4 dk; resmî: her gün 06:00–00:00, 7 dk.
#   M7  zirvede 4 dk (beslemede gün boyu 6 dk). M9 zirvede 9 dk (beslemede 10 dk).
#       Zirve pencereleri 07–10 ve 17–20 varsayıldı; zirve dışı beslemedeki değer.
#
# Saatler (resmî sayfalardan, 2026-09):
#   T5: 06:00–00:00, zirvede 5 dk, uçtan uca 32 dk (metro.istanbul hat sayfası).
#       Zirve dışı sıklık yayımlanmamış; 10 dk varsayıldı (TAHMİNİ).
#   T6: ilk tren iki uçtan 06:00; son Sirkeci 23:05, Kazlıçeşme 22:40; 25 dk arayla;
#       uçtan uca 18 dk (TCDD Taşımacılık tarifesi, marmaray.istanbul aktarımı).
#   F4: 06:00–00:00, zirvede 8 dk, 2,5 dk (marmaray.istanbul füniküler sayfası).
#       Gün boyu 8 dk alındı.
# İstasyonlar arası süre mesafeye göre dağıtılıyor (M11'deki gibi); uçtan uca süre tutar.
#
# Betik yeniden çalıştırılabilir: kendi eklediklerini ("ek-" kimlikli) önce siler.
# Sonra cizgi-ekle.py (ray çizgisi) ve durak-birlestir.py (aktarma istasyonları)
# yeniden çalıştırılmalı; ikisi de tekrar çalıştırılabilir. Bkz. README.
#
# Kullanım:
#   python eksik-hatlar.py C:\otp\osm-hatlar.json C:\otp\istanbul

import csv, io, json, math, os, shutil, sys, zipfile, collections

csv.field_size_limit(10 ** 7)

DURAKLAMA = 20  # saniye, istasyonda bekleme

YENI_HATLAR = {
    'T5': {
        'uzun': 'EMİNÖNÜ - ALİBEYKÖY CEP OTOGARI',
        'ajans': 'Metro İstanbul',
        'tur': '0',
        'renk': '7C72B3',
        'sure_dk': 32,
        # (başlangıç, bitiş, aralık sn) — iki yöne de
        'pencereler': [('06:00:00', '07:00:00', 600), ('07:00:00', '10:00:00', 300),
                       ('10:00:00', '16:00:00', 600), ('16:00:00', '20:00:00', 300),
                       ('20:00:00', '24:00:00', 600)],
    },
    'T6': {
        'uzun': 'SİRKECİ - KAZLIÇEŞME',
        'ajans': 'TCDD Taşımacılık',
        'tur': '0',
        'renk': 'E47A7B',
        'sure_dk': 18,
        'kesin': True,  # yayımlanmış tarife: seferler tam bu saatlerde
        # Yöne göre: ilk durağın adına göre seçiliyor.
        'pencereler_yon': {'Kazlıçeşme': [('06:00:00', '22:40:30', 1500)],
                           'Sirkeci': [('06:00:00', '23:05:30', 1500)]},
    },
    'F4': {
        'uzun': 'BOĞAZİÇİ ÜNİVERSİTESİ/HİSARÜSTÜ - AŞİYAN',
        'ajans': 'Metro İstanbul',
        'tur': '7',
        'renk': '7C7358',
        'sure_dk': 2.5,
        'pencereler': [('06:00:00', '24:00:00', 480)],
    },
}
KALDIRILAN = ['M3A']
# Sıklık tabanlı hatların gündüz pencereleri (her gün). Kaynak: metro.istanbul hat sayfaları.
SIKLIK_DUZELT = {
    'M7': [('06:00:00', '07:00:00', 480), ('07:00:00', '10:00:00', 240), ('10:00:00', '17:00:00', 360),
           ('17:00:00', '20:00:00', 240), ('20:00:00', '22:00:00', 360), ('22:00:00', '24:00:00', 480)],
    'M8': [('06:00:00', '24:00:00', 420)],
    'M9': [('06:00:00', '07:00:00', 600), ('07:00:00', '10:00:00', 540), ('10:00:00', '17:00:00', 600),
           ('17:00:00', '20:00:00', 540), ('20:00:00', '24:00:00', 600)],
}
# İETT beslemesinde türü yanlış hatlar: kısa ad → doğru route_type
IETT_TUR = {'T2': '0', 'F2': '7'}
# OSM'de aynı ref'i kullanan başka şehir hatları (İzmit tramvayı T1/T2) elensin.
OSM_ELE = {'Ulaşım Park'}


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def saat(s):
    s = int(round(s))
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


def osm_dizisi(osm, ref):
    """Hattın en uzun istasyon dizisi (bir yön). [{id, ad, lat, lon}]"""
    dug = osm['dugumler']
    en_iyi = []
    for h in osm['hatlar']:
        if h.get('ref') != ref or (h.get('isletmeci') or '').strip() in OSM_ELE:
            continue
        dizi = []
        for k in h['dugumler']:
            b = dug.get(str(k))
            if b and (not dizi or dizi[-1]['id'] != str(k)):
                dizi.append({'id': str(k), **b})
        if len(dizi) > len(en_iyi):
            en_iyi = dizi
    return en_iyi


def hatlari_sil(t, rota_idleri):
    """Rotaları seferleri, saatleri, sıklıkları ve artık kullanılmayan duraklarıyla siler."""
    rota_idleri = set(rota_idleri)
    seferler = {x['trip_id'] for x in t['trips.txt'] if x['route_id'] in rota_idleri}
    cizgiler = {x['shape_id'] for x in t['trips.txt'] if x['route_id'] in rota_idleri and x.get('shape_id')}
    t['routes.txt'] = [x for x in t['routes.txt'] if x['route_id'] not in rota_idleri]
    t['trips.txt'] = [x for x in t['trips.txt'] if x['trip_id'] not in seferler]
    once = {x['stop_id'] for x in t['stop_times.txt'] if x['trip_id'] in seferler}
    t['stop_times.txt'] = [x for x in t['stop_times.txt'] if x['trip_id'] not in seferler]
    if 'frequencies.txt' in t:
        t['frequencies.txt'] = [x for x in t['frequencies.txt'] if x['trip_id'] not in seferler]
    if 'shapes.txt' in t and cizgiler:
        kalan = {x['shape_id'] for x in t['trips.txt'] if x.get('shape_id')}
        sil = cizgiler - kalan
        t['shapes.txt'] = [x for x in t['shapes.txt'] if x['shape_id'] not in sil]
    kullanilan = {x['stop_id'] for x in t['stop_times.txt']}
    bosalan = {s for s in once if s not in kullanilan}
    t['stops.txt'] = [x for x in t['stops.txt'] if x['stop_id'] not in bosalan]
    return len(seferler), len(bosalan)


def hat_ekle(kod, tarif, dizi, t, servis, ajans_id):
    rota_id = 'ek-' + kod.lower()
    t['routes.txt'].append({
        'route_id': rota_id, 'agency_id': ajans_id, 'route_short_name': kod,
        'route_long_name': tarif['uzun'], 'route_desc': '', 'route_type': tarif['tur'],
        'route_url': '', 'route_color': tarif.get('renk', ''), 'route_text_color': 'FFFFFF',
    })
    mevcut = {x['stop_id'] for x in t['stops.txt']}
    for d in dizi:
        did = 'ek-' + d['id']
        if did in mevcut:
            continue
        mevcut.add(did)
        t['stops.txt'].append({
            'stop_id': did, 'stop_code': '', 'stop_name': d['ad'], 'stop_desc': '',
            'stop_lat': f"{d['lat']:.7f}", 'stop_lon': f"{d['lon']:.7f}", 'zone_id': '', 'stop_url': '',
            'location_type': '0', 'parent_station': '', 'stop_timezone': '', 'wheelchair_boarding': '1',
        })

    araliklar = [mesafe((a['lat'], a['lon']), (b['lat'], b['lon'])) for a, b in zip(dizi, dizi[1:])]
    toplam_m = sum(araliklar) or 1.0
    # Uçtan uca süre ara istasyonlardaki duraklamaları da içeriyor.
    hareket = max(30 * len(araliklar), tarif['sure_dk'] * 60 - DURAKLAMA * (len(dizi) - 2))
    sureler = [hareket * m / toplam_m for m in araliklar]

    satir = 0
    for yon, sira in ((0, dizi), (1, dizi[::-1])):
        sefer_id = f'{rota_id}-{yon}'
        adimlar = sureler if yon == 0 else sureler[::-1]
        pencereler = tarif.get('pencereler') or tarif['pencereler_yon'][sira[0]['ad']]
        t['trips.txt'].append({
            'route_id': rota_id, 'service_id': servis, 'trip_id': sefer_id,
            'trip_headsign': sira[-1]['ad'], 'trip_short_name': '', 'direction_id': str(yon),
            'block_id': '', 'shape_id': '', 'wheelchair_accessible': '1', 'bikes_allowed': '0',
        })
        # Şablon seferin saatleri bir başlangıca göre; frequencies.txt çoğaltıyor.
        an = 6 * 3600.0
        for i, d in enumerate(sira):
            if i:
                an += adimlar[i - 1]
            kalkis = an + (DURAKLAMA if 0 < i < len(sira) - 1 else 0)
            t['stop_times.txt'].append({
                'trip_id': sefer_id, 'arrival_time': saat(an), 'departure_time': saat(kalkis),
                'stop_id': 'ek-' + d['id'], 'stop_sequence': str(i + 1), 'stop_headsign': '',
                'pickup_type': '0', 'drop_off_type': '0', 'shape_dist_traveled': '', 'timepoint': '0',
            })
            an = kalkis
            satir += 1
        for bas, bit, ara in pencereler:
            t['frequencies.txt'].append({
                'trip_id': sefer_id, 'start_time': bas, 'end_time': bit,
                'headway_secs': str(ara), 'exact_times': '1' if tarif.get('kesin') else '0',
            })
    return rota_id, satir, round(sum(sureler) / 60 + DURAKLAMA * (len(dizi) - 2) / 60, 1)


def rayli(osm, zip_yolu):
    t, alanlar = zip_oku(zip_yolu)
    for ad, sutunlar in (('frequencies.txt', ['trip_id', 'start_time', 'end_time', 'headway_secs', 'exact_times']),):
        if ad not in t:
            t[ad], alanlar[ad] = [], sutunlar

    # 1) Önceki çalıştırmanın eklediklerini temizle.
    eskiler = [r['route_id'] for r in t['routes.txt'] if r['route_id'].startswith('ek-')]
    if eskiler:
        hatlari_sil(t, eskiler)

    # 2) Kapanmış hatlar.
    for kod in KALDIRILAN:
        ids = [r['route_id'] for r in t['routes.txt'] if r['route_short_name'] == kod]
        if ids:
            sefer, durak = hatlari_sil(t, ids)
            print(f'{kod}: çıkarıldı ({sefer} sefer, {durak} artık kullanılmayan durak)')

    # 3) Her gün geçerli bir servis.
    herGun = [c['service_id'] for c in t['calendar.txt']
              if all(c[g] == '1' for g in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'))]
    sayac = collections.Counter(x['service_id'] for x in t['trips.txt'])
    servis = max(herGun, key=lambda s: sayac[s])
    ajanslar = {a['agency_name']: a['agency_id'] for a in t['agency.txt']}

    # 4) Sıklık düzeltmesi: gündüz şablon seferleri (ilk penceresi 05:00'ten sonra başlayan).
    for kod, pencereler in SIKLIK_DUZELT.items():
        rids = {x['route_id'] for x in t['routes.txt'] if x['route_short_name'] == kod}
        fq = collections.defaultdict(list)
        for f in t['frequencies.txt']:
            fq[f['trip_id']].append(f)
        sablonlar = [x for x in t['trips.txt'] if x['route_id'] in rids and fq.get(x['trip_id'])
                     and min(f['start_time'] for f in fq[x['trip_id']]) >= '05:00:00']
        if not sablonlar:
            print(f'{kod}: sıklık şablon seferi yok, dokunulmadı')
            continue
        ids = {x['trip_id'] for x in sablonlar}
        for x in sablonlar:
            x['service_id'] = servis
        t['frequencies.txt'] = [f for f in t['frequencies.txt'] if f['trip_id'] not in ids] + [
            {'trip_id': i, 'start_time': b, 'end_time': e, 'headway_secs': str(h), 'exact_times': '0'}
            for i in sorted(ids) for b, e, h in pencereler]
        print(f'{kod}: sıklık güncellendi ({len(ids)} şablon sefer, her gün)')

    # 5) Eksik hatlar.
    varOlan = {r['route_short_name'] for r in t['routes.txt']}
    for kod, tarif in YENI_HATLAR.items():
        if kod in varOlan:
            print(f'{kod}: beslemede zaten var, dokunulmadı')
            continue
        dizi = osm_dizisi(osm, kod)
        if len(dizi) < 2:
            print(f'{kod}: OSM\'de istasyon dizisi yok, eklenemedi')
            continue
        ajans = ajanslar.get(tarif['ajans'])
        if not ajans:
            print(f'{kod}: işletmeci "{tarif["ajans"]}" beslemede yok, eklenemedi')
            continue
        _, satir, sure = hat_ekle(kod, tarif, dizi, t, servis, ajans)
        uzunluk = sum(mesafe((a['lat'], a['lon']), (b['lat'], b['lon'])) for a, b in zip(dizi, dizi[1:])) / 1000
        print(f'{kod}: eklendi · {len(dizi)} istasyon ({dizi[0]["ad"]} – {dizi[-1]["ad"]}) · '
              f'{uzunluk:.1f} km · uçtan uca {sure} dk')
    zip_yaz(zip_yolu, t, alanlar)


def iett(zip_yolu):
    """Yalnız routes.txt değişiyor; öbür dosyalar (150 MB'lık stop_times) olduğu gibi kopyalanır."""
    with zipfile.ZipFile(zip_yolu) as z:
        with z.open('routes.txt') as ham:
            okuyucu = csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig'))
            rotalar, sutunlar = list(okuyucu), okuyucu.fieldnames
    degisen = []
    for r in rotalar:
        dogru = IETT_TUR.get(r['route_short_name'])
        if dogru and r['route_type'] != dogru:
            degisen.append(f"{r['route_short_name']} ({r['route_type']}→{dogru})")
            r['route_type'] = dogru
    if degisen:
        tampon = io.StringIO()
        w = csv.DictWriter(tampon, fieldnames=sutunlar, lineterminator='\n')
        w.writeheader()
        w.writerows(rotalar)
        gecici = zip_yolu + '.yeni'
        with zipfile.ZipFile(zip_yolu) as kaynak, zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as hedef:
            for bilgi in kaynak.infolist():
                if bilgi.filename == 'routes.txt':
                    hedef.writestr('routes.txt', tampon.getvalue())
                else:
                    hedef.writestr(bilgi, kaynak.read(bilgi.filename))
        shutil.move(gecici, zip_yolu)
    print('İETT türü düzeltilen:', ', '.join(degisen) if degisen else 'yok (zaten doğru)')


def main(osm_json, klasor):
    osm = json.load(io.open(osm_json, encoding='utf-8'))
    rayli(osm, os.path.join(klasor, 'istanbul-ray-vapur-gtfs.zip'))
    iett(os.path.join(klasor, 'istanbul-iett-gtfs.zip'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
