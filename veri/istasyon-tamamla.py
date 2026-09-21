# İBB'nin donmuş raylı sistem verisindeki eksik istasyonları OpenStreetMap'ten tamamlar.
#
# Sorun: İBB bu beslemeyi 2023'ten beri güncellemiyor. M3 Kayaşehir'e, M5 Sultanbeyli'ye,
# M9 Olimpiyat'a, M4 Sabiha Gökçen'e uzadı; M11 beslemede hiç yok. Toplam ~50 istasyon eksik.
#
# Yöntem:
#   1) OSM'deki hat bağıntıları birleştirilir. Bazı hatlar OSM'de parçalı duruyor
#      (M7 = "Yıldız–Mecidiyeköy" + "Mecidiyeköy–Mahmutbey"); uç istasyon adları
#      tutuyorsa ve birleşimde tekrar eden istasyon oluşmuyorsa birleştirilir.
#   2) Eksikler hep hatların UCUNDA olduğu için İBB'nin gerçek tarifesi korunur,
#      sefer dizisi iki uçtan uzatılır. Hizalama HER SEFER İÇİN AYRI yapılır:
#      seferin kendi durak dizisi OSM dizisinin içinde (ya da tersinde) aranır,
#      böylece gidiş ve dönüş yönleri kendiliğinden doğru tarafa uzar.
#   3) Beslemede hiç bulunmayan hatlar (M11) OSM'den sıfırdan üretilir; saatleri
#      istasyonlar arası mesafeye göre dağıtılmış tahminlerdir.
#   4) Son olarak süre onarımı: aralarında yüz metrelerce mesafe olmasına rağmen
#      aynı saniyeye yazılmış istasyon çiftleri (İBB'nin M7 Fulya–Yıldız hatası gibi)
#      mesafeye göre açılır.
#
# Kullanım:
#   python osm-cikar.py C:\otp\istanbul\Istanbul.osm.pbf osm-hatlar.json
#   python istasyon-tamamla.py osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import csv, io, json, math, shutil, sys, zipfile, collections

csv.field_size_limit(10 ** 7)

ISLETMECILER = ('Metro İstanbul', 'İBB', 'TCDD Taşımacılık', 'TCDD Taşımacılık A.Ş.')
# Sadece bu hatlar tamamlanır: kod eşleşmesi güvenilir olsun diye açıkça sayıldılar.
HATLAR = ['M1A', 'M1B', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M11']

# Beslemede hiç olmayan, OSM'den sıfırdan üretilecek hatlar.
SIFIRDAN = {
    'M11': {
        'uzun': 'GAYRETTEPE - İSTANBUL HAVALİMANI - HALKALI',
        'ajans': ('tcdd-tasimacilik', 'TCDD Taşımacılık', 'https://www.tcddtasimacilik.gov.tr/'),
        'tur': '1',
        # Aşağıdaki değerler tahmin değil, iki bağımsız kaynaktan okundu:
        # uçtan uca 57 dk, ilk sefer 06:00, son sefer 00:40, sıklık zirvede 20 dk,
        # diğer saatlerde 20-30 dk. (marmaray.istanbul ve gokyuzuhaberci.com, 2026)
        'sure_dk': 57,          # Gayrettepe-Halkalı uçtan uca, duraklamalar dâhil
        'pencereler': [('06:00:00', '22:00:00', 1200),
                       ('22:00:00', '24:40:00', 1800)],
    },
}

# Süre onarımı: bu mesafeden uzak iki istasyon arasında bu süreden kısa geçiş olamaz.
DURAKLAMA = 20           # saniye, istasyonda bekleme
ONARIM_MESAFE = 400      # metre
ONARIM_ESIK = 30         # saniye
ONARIM_HIZ = 9.0         # m/sn (~32 km/sa, duraklama dâhil)

AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}
RAYLI_TURLER = ('0', '1', '2', '5', '6', '7')


def sade(metin):
    kucuk = (metin or '').replace('I', 'ı').replace('İ', 'i').lower()
    return ''.join(AKSAN.get(h, h) for h in kucuk if AKSAN.get(h, h).isalnum())


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def sn(t):
    p = [int(x) for x in (t or '0:0:0').split(':')]
    return p[0] * 3600 + p[1] * 60 + p[2]


def saat(s):
    s = int(s)
    return f'{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}'


# ---------- OSM ----------

def birlestir(diziler):
    """Uç istasyonları tutan parçalı hat bağıntılarını tek diziye bağlar.

    Gidiş ve dönüş bağıntıları da uçlarından tutuyor ama birleşimlerinde her istasyon
    iki kez geçtiği için elenirler; asıl istenen M7 gibi gerçekten parçalı hatlardır."""
    diziler = [list(d) for d in diziler]
    while True:
        for i in range(len(diziler)):
            for j in range(len(diziler)):
                if i == j:
                    continue
                for a in (diziler[i], diziler[i][::-1]):
                    for b in (diziler[j], diziler[j][::-1]):
                        if sade(a[-1]['ad']) != sade(b[0]['ad']):
                            continue
                        yeni = a + b[1:]
                        adlar = [sade(x['ad']) for x in yeni]
                        if len(set(adlar)) != len(adlar) or len(yeni) <= max(len(a), len(b)):
                            continue
                        diziler = [d for k, d in enumerate(diziler) if k not in (i, j)] + [yeni]
                        break
                    else:
                        continue
                    break
                else:
                    continue
                break
            else:
                continue
            break
        else:
            return diziler


def osm_hatlari(yol):
    d = json.load(io.open(yol, encoding='utf-8'))
    dug = d['dugumler']
    ham = collections.defaultdict(list)
    renk = {}
    for h in d['hatlar']:
        if h.get('isletmeci') not in ISLETMECILER or h.get('ref') not in HATLAR:
            continue
        duraklar = []
        for k in h['dugumler']:
            bilgi = dug.get(str(k))
            if bilgi and (not duraklar or duraklar[-1]['id'] != str(k)):
                duraklar.append({'id': str(k), **bilgi})
        if len(duraklar) >= 2:
            ham[h['ref']].append(duraklar)
        if h.get('renk') and h['ref'] not in renk:
            renk[h['ref']] = h['renk']
    sonuc = {}
    for kod, diziler in ham.items():
        en_uzun = max(birlestir(diziler), key=len)
        sonuc[kod] = {'dizi': en_uzun, 'renk': renk.get(kod, '')}
    return sonuc


# ---------- GTFS zip ----------

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


# ---------- hizalama ----------

def hizala(ibb, osm_adlar):
    """İBB adlarını OSM dizisinin içinde arar. (eslesme, baslangic) döner."""
    if not ibb or len(ibb) > len(osm_adlar):
        return None
    en_iyi = None
    for bas in range(len(osm_adlar) - len(ibb) + 1):
        e = sum(1 for a, b in zip(osm_adlar[bas:bas + len(ibb)], ibb) if a == b)
        if en_iyi is None or e > en_iyi[0]:
            en_iyi = (e, bas)
    if en_iyi and en_iyi[0] >= max(2, int(len(ibb) * 0.7)):
        return en_iyi
    return None


def sefer_hizala(ibb_adlar, ileri, ileri_adlar, geri, geri_adlar):
    """Seferin kendi yönüne uyan OSM dizisini seçer. (dizi, baslangic) döner."""
    a = hizala(ibb_adlar, ileri_adlar)
    b = hizala(ibb_adlar, geri_adlar)
    if a and (not b or a[0] >= b[0]):
        return ileri, a[1]
    if b:
        return geri, b[1]
    return None, None


# ---------- sıfırdan hat üretimi ----------

def hat_uret(kod, dizi, tablolar, servis, yeniDurak):
    tarif = SIFIRDAN[kod]
    ajans_id, ajans_ad, ajans_url = tarif['ajans']
    if not any(a.get('agency_id') == ajans_id for a in tablolar['agency.txt']):
        tablolar['agency.txt'].append({
            'agency_id': ajans_id, 'agency_name': ajans_ad, 'agency_url': ajans_url,
            'agency_timezone': 'Europe/Istanbul', 'agency_lang': 'tr',
            'agency_phone': '', 'agency_fare_url': '', 'agency_email': '',
        })

    rota_id = 'osm-' + kod.lower()
    tablolar['routes.txt'].append({
        'route_id': rota_id, 'agency_id': ajans_id, 'route_short_name': kod,
        'route_long_name': tarif['uzun'], 'route_desc': '', 'route_type': tarif['tur'],
        'route_url': '', 'route_color': (tarif.get('renk') or '').lstrip('#').upper(),
        'route_text_color': '',
    })

    for d in dizi:
        did = 'osm-' + d['id']
        yeniDurak.setdefault(did, {'stop_id': did, 'stop_code': '', 'stop_name': d['ad'],
                                   'stop_desc': '', 'stop_lat': d['lat'], 'stop_lon': d['lon'],
                                   'zone_id': '', 'stop_url': '', 'location_type': '0',
                                   'parent_station': '', 'stop_timezone': '', 'wheelchair_boarding': '0'})

    # Uçtan uca süreyi istasyonlar arası mesafeye göre dağıt.
    araliklar = [mesafe((float(a['lat']), float(a['lon'])), (float(b['lat']), float(b['lon'])))
                 for a, b in zip(dizi, dizi[1:])]
    toplam_m = sum(araliklar) or 1.0
    # sure_dk uçtan uca geçen süre; istasyonlardaki 20 sn'lik duraklamalar onun içinde.
    hedef = max(60, tarif['sure_dk'] * 60 - DURAKLAMA * (len(dizi) - 1))
    sureler = [max(70, round(hedef * m / toplam_m)) for m in araliklar]

    eklenen = 0
    for yon, sira in ((0, dizi), (1, dizi[::-1])):
        sefer_id = f'{rota_id}-{yon}'
        adimlar = sureler if yon == 0 else sureler[::-1]
        tablolar['trips.txt'].append({
            'route_id': rota_id, 'service_id': servis, 'trip_id': sefer_id,
            'trip_headsign': sira[-1]['ad'], 'trip_short_name': '06:00',
            'direction_id': str(yon), 'block_id': '', 'shape_id': '',
            'wheelchair_accessible': '1', 'bikes_allowed': '1',
        })
        t = sn('06:00:00')
        for i, d in enumerate(sira):
            if i:
                t += adimlar[i - 1]
            tablolar['stop_times.txt'].append({
                'trip_id': sefer_id, 'arrival_time': saat(t), 'departure_time': saat(t + DURAKLAMA),
                'stop_id': 'osm-' + d['id'], 'stop_sequence': str(i + 1),
                'stop_headsign': d['ad'], 'pickup_type': '0', 'drop_off_type': '0',
                'shape_dist_traveled': '', 'timepoint': '0',
            })
            t += DURAKLAMA
            eklenen += 1
        for bas, bit, ara in tarif['pencereler']:
            tablolar['frequencies.txt'].append({
                'trip_id': sefer_id, 'start_time': bas, 'end_time': bit,
                'headway_secs': str(ara), 'exact_times': '0',
            })
    return eklenen


# ---------- süre onarımı ----------

def sureleri_onar(seferSaat, seferRota, rotaTur, konum):
    """Mesafeye göre imkânsız olan sıfır süreli geçişleri açar."""
    onarilan = collections.Counter()
    for tid, satirlar in seferSaat.items():
        if rotaTur.get(seferRota.get(tid, ''), '') not in RAYLI_TURLER:
            continue
        kaydir = 0
        degisti = False
        for i in range(1, len(satirlar)):
            onceki, simdiki = satirlar[i - 1], satirlar[i]
            if kaydir:
                simdiki['arrival_time'] = saat(sn(simdiki['arrival_time']) + kaydir)
                simdiki['departure_time'] = saat(sn(simdiki['departure_time']) + kaydir)
            a, b = konum.get(onceki['stop_id']), konum.get(simdiki['stop_id'])
            if not a or not b:
                continue
            m = mesafe(a, b)
            gecis = sn(simdiki['arrival_time']) - sn(onceki['departure_time'])
            if m > ONARIM_MESAFE and gecis < ONARIM_ESIK:
                gerekli = max(ONARIM_ESIK, round(m / ONARIM_HIZ))
                fark = gerekli - gecis
                kaydir += fark
                simdiki['arrival_time'] = saat(sn(simdiki['arrival_time']) + fark)
                simdiki['departure_time'] = saat(sn(simdiki['departure_time']) + fark)
                degisti = True
        if degisti:
            onarilan[seferRota.get(tid, '')] += 1
    return onarilan


# ---------- ana akış ----------

def main(osm_json, zip_yolu):
    osm = osm_hatlari(osm_json)
    tablolar, alanlar = zip_oku(zip_yolu)

    rotalar = tablolar['routes.txt']
    seferler = tablolar['trips.txt']
    duraklar = tablolar['stops.txt']
    saatler = tablolar['stop_times.txt']

    kodRota = {r['route_short_name']: r for r in rotalar if r.get('route_type') in RAYLI_TURLER}
    durakAd = {d['stop_id']: d['stop_name'] for d in duraklar}
    konum = {}
    for d in duraklar:
        try:
            konum[d['stop_id']] = (float(d['stop_lat']), float(d['stop_lon']))
        except (TypeError, ValueError):
            pass
    rotaSefer = collections.defaultdict(list)
    for t in seferler:
        rotaSefer[t['route_id']].append(t['trip_id'])
    seferSaat = collections.defaultdict(list)
    for r in saatler:
        seferSaat[r['trip_id']].append(r)
    for liste in seferSaat.values():
        liste.sort(key=lambda r: int(r['stop_sequence']))

    # Sıfırdan üretilecek hatlar için her gün geçerli bir servis takvimi seç.
    bugun = '20260920'
    herGun = [c for c in tablolar['calendar.txt']
              if all(c.get(g) == '1' for g in ('monday', 'tuesday', 'wednesday', 'thursday',
                                               'friday', 'saturday', 'sunday'))
              and c.get('start_date', '') <= bugun <= c.get('end_date', '')]
    servisSayac = collections.Counter(t['service_id'] for t in seferler)
    servis = max((c['service_id'] for c in herGun), key=lambda s: servisSayac[s], default='')

    yeniDurak = {}
    eklenen = collections.Counter()
    atlanan = collections.Counter()
    rapor = []

    for kod in HATLAR:
        if kod not in osm:
            rapor.append((kod, "OSM'de yok", 0, 0))
            continue
        ileri = osm[kod]['dizi']
        geri = ileri[::-1]
        ileriAd = [sade(d['ad']) for d in ileri]
        geriAd = ileriAd[::-1]

        rota = kodRota.get(kod)
        if not rota:
            if kod in SIFIRDAN and servis:
                SIFIRDAN[kod].setdefault('renk', osm[kod]['renk'])
                eklenen[kod] += hat_uret(kod, ileri, tablolar, servis, yeniDurak)
                rapor.append((kod, 'sıfırdan üretildi', 0, len(ileri)))
            else:
                rapor.append((kod, 'İBB verisinde yok', 0, len(ileri)))
            continue

        adaylar = [seferSaat[tid] for tid in rotaSefer[rota['route_id']] if len(seferSaat[tid]) > 1]
        if not adaylar:
            rapor.append((kod, 'seferi yok', 0, 0))
            continue
        temsilci = max(adaylar, key=len)
        ibbAdlar = [sade(durakAd.get(r['stop_id'], '')) for r in temsilci]

        if sefer_hizala(ibbAdlar, ileri, ileriAd, geri, geriAd)[0] is None:
            rapor.append((kod, 'istasyon adları eşleşmedi', len(ibbAdlar), len(ileri)))
            continue
        if len(ibbAdlar) >= len(ileri):
            rapor.append((kod, 'eksik yok', len(ibbAdlar), len(ibbAdlar)))
            continue

        # Bu hattın istasyon arası ortalama süresi
        toplam = sn(temsilci[-1]['departure_time']) - sn(temsilci[0]['departure_time'])
        ortalama = max(60, toplam // max(1, len(temsilci) - 1))

        for nokta in ileri:
            did = 'osm-' + nokta['id']
            yeniDurak.setdefault(did, {'stop_id': did, 'stop_code': '', 'stop_name': nokta['ad'],
                                       'stop_desc': '', 'stop_lat': nokta['lat'], 'stop_lon': nokta['lon'],
                                       'zone_id': '', 'stop_url': '', 'location_type': '0',
                                       'parent_station': '', 'stop_timezone': '', 'wheelchair_boarding': '0'})

        uzatilan = 0
        for tid in rotaSefer[rota['route_id']]:
            liste = seferSaat[tid]
            if len(liste) < 2:
                continue
            adlar = [sade(durakAd.get(r['stop_id'], '')) for r in liste]
            dizi, bas = sefer_hizala(adlar, ileri, ileriAd, geri, geriAd)
            if dizi is None:
                atlanan[kod] += 1
                continue
            onEk, sonEk = dizi[:bas], dizi[bas + len(liste):]
            if not onEk and not sonEk:
                continue

            t0 = sn(liste[0]['arrival_time'])
            onAdim = ortalama
            if onEk and t0 - len(onEk) * ortalama < 0:
                onAdim = t0 // len(onEk)
            if onEk and onAdim < 45:
                atlanan[kod] += 1
                onEk = []

            oncekiler = []
            for i, nokta in enumerate(reversed(onEk), start=1):
                z = saat(t0 - i * onAdim)
                oncekiler.append({**liste[0], 'stop_id': 'osm-' + nokta['id'], 'arrival_time': z,
                                  'departure_time': z, 'stop_headsign': nokta['ad']})
            oncekiler.reverse()

            tn = sn(liste[-1]['departure_time'])
            sonrakiler = []
            for i, nokta in enumerate(sonEk, start=1):
                z = saat(tn + i * ortalama)
                sonrakiler.append({**liste[-1], 'stop_id': 'osm-' + nokta['id'], 'arrival_time': z,
                                   'departure_time': z, 'stop_headsign': nokta['ad']})

            tam = oncekiler + liste + sonrakiler
            for i, r in enumerate(tam, start=1):
                r['stop_sequence'] = str(i)
                r['shape_dist_traveled'] = ''
            seferSaat[tid] = tam
            eklenen[kod] += len(oncekiler) + len(sonrakiler)
            uzatilan += 1

        # Uzatılan seferlerin çizgisi artık uymuyor
        for t in seferler:
            if t['route_id'] == rota['route_id']:
                t['shape_id'] = ''
        rapor.append((kod, f'uzatıldı ({uzatilan} sefer)', len(ibbAdlar), len(ileri)))

    for d in yeniDurak.values():
        konum[d['stop_id']] = (float(d['stop_lat']), float(d['stop_lon']))

    # stop_times'ı sefer sırasına göre yeniden kur (sıfırdan üretilenler zaten eklendi)
    uretilen = [r for r in tablolar['stop_times.txt'] if r['trip_id'].startswith('osm-')]
    yeniSaatler = []
    for t in seferler:
        if t['trip_id'].startswith('osm-'):
            continue
        yeniSaatler.extend(seferSaat.get(t['trip_id'], []))
    tablolar['stop_times.txt'] = yeniSaatler + uretilen

    # Hizalama sırasında eklenip sonunda hiçbir seferde kullanılmayan istasyonları at:
    # aksi hâlde İBB'de zaten olan duraklar aramada ikinci kez görünür.
    kullanilan = {r['stop_id'] for r in tablolar['stop_times.txt']}
    yeniDurak = {k: v for k, v in yeniDurak.items() if k in kullanilan}
    duraklar.extend(yeniDurak.values())

    seferRota = {t['trip_id']: t['route_id'] for t in seferler}
    rotaTur = {r['route_id']: r['route_type'] for r in rotalar}
    yeniden = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        yeniden[r['trip_id']].append(r)
    onarilan = sureleri_onar(yeniden, seferRota, rotaTur, konum)

    zip_yaz(zip_yolu, tablolar, alanlar)

    print(f"{'Hat':6} {'durum':32} {'önce':>6} {'sonra':>6}")
    for kod, durum, once, sonra in rapor:
        print(f'{kod:6} {durum:32} {once:>6} {sonra:>6}')
    print(f'\n{len(yeniDurak)} yeni istasyon, {sum(eklenen.values())} sefer-durak satırı eklendi')
    if atlanan:
        print('hizalanamayan/atlanan sefer:', dict(atlanan))
    if onarilan:
        kodAd = {r['route_id']: r['route_short_name'] for r in rotalar}
        print('süresi onarılan sefer:', {kodAd.get(k, k): v for k, v in onarilan.items()})


main(sys.argv[1], sys.argv[2])
