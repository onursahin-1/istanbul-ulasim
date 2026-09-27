# Turyol ve Dentur Avrasya'nın güncel tarifesini (ozel-vapur-indir.mjs çıktısı) raylı-vapur
# GTFS'ine işler.
#
# Beslemedeki iki işletmecinin seferleri İBB'nin yıllardır güncellenmeyen verisinden: Dentur'un
# "Üsküdar–Kabataş" seferleri Beşiktaş'a gidiyor, kalkmış hatlar (Eminönü–Bebek, Avcılar–Adalar,
# Sirkeci–Adalar, Kabataş–Kadıköy) duruyor, Turyol'un Beşiktaş–Kadıköy hattı artık yok. Bu betik
# iki işletmecinin bütün hatlarını ve seferlerini silip sitelerin tarifesinden yeniden kurar.
# Şehir Hatları'na (vapur-tarife-uygula.py) ve İDO'ya dokunmaz.
#
# Turyol: site yalnız "şu iskeleden şu iskeleye kalkış saatleri"ni veriyor. Aynı vapur birkaç
# iskeleye uğruyor: Üsküdar 06:55'te kalkan vapur hem Karaköy'ün hem Eminönü'nün listesinde;
# Karaköy'den 07:15'te Kadıköy'e binen yolcu vapurla önce Eminönü'ne uğruyor (Eminönü kalkışı
# 07:25). Seferler bu yüzden aşağıdaki güzergâhlar üzerinde kuruluyor: güzergâhın her iskelesinin
# kalkış saati, önceki iskeleden kalkan seferin beklenen varışına en yakın olanla eşleniyor.
# Kalkışı olmayan iskelelerin (Adalar'da inilen iskeleler, Eminönü dönüşü) saati yol süresinden.
# Satılmayan biniş/iniş (Karaköy'den Eminönü'ne bilet yok) GTFS'te pickup/drop_off 1.
#
# Dentur: "Arası sürekli sefer" yazan saat aralıkları SUREKLI_DK dakikada bir sefer sayılıyor
# (site sıklık vermiyor; tahmin, temkinli). Yalova iskelesi grafiğin dışında: Yalova–Adalar
# seferinin yalnız İstanbul kısmı (Büyükada–Heybeliada–Kabataş–Beşiktaş) alınıyor.
#
# Kullanım (vapur-tarife-uygula.py'den sonra, durak-birlestir.py'den önce):
#   python ozel-vapur-uygula.py C:\otp\ozel-vapur-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import collections, csv, datetime, io, json, math, re, shutil, sys, zipfile

csv.field_size_limit(10 ** 7)

SUREKLI_DK = 10  # "sürekli sefer" aralıklarında varsayılan sıklık

# Sitedeki iskele adı (sade) → beslemedeki durak adı.
TURYOL_ISKELE = {
    'eminonu': 'Eminönü Turyol', 'karakoy': 'Karaköy Turyol', 'uskudar': 'Üsküdar Turyol',
    'kadikoymetro': 'Kadıköy Turyol', 'kadikoyyeni': 'Kadıköy2(Çayırbaşı)Turyol',
    'kinaliada': 'Kınalıada ŞH.', 'burgazada': 'Burgazada ŞH.', 'heybeliada': 'Heybeliada ŞH.',
    'buyukada': 'Büyükada Turyol', 'besiktas': 'Beşiktaş Turyol', 'bakirkoy': 'Bakırköy Turyol',
}
DENTUR_ISKELE = {
    'uskudar': 'Üsküdar Dentur', 'besiktas': 'Beşiktaş Dentur', 'kabatas': 'Kabataş Dentur',
    'sirkeci': 'Eminönü Dentur', 'eminonu': 'Eminönü Dentur', 'kadikoy': 'Kadıköy-Beşiktaş-Adalar ŞH.',
    'kinaliada': 'Kınalıada ŞH.', 'heybeliada': 'Heybeliada ŞH.', 'buyukada': 'Büyükada ŞH.',
}
DISARIDA = {'yalova'}  # grafiğin dışındaki iskeleler: seferden çıkarılır

# Turyol güzergâhları (grup: sitedeki 1 şehir içi, 3 Adalar). Sıra vapurun uğrama sırası.
TURYOL_GUZERGAH = [
    ('ÜSK-KRK-EMN', '1', ['uskudar', 'karakoy', 'eminonu']),
    ('EMN-KRK-ÜSK', '1', ['eminonu', 'karakoy', 'uskudar']),
    ('KDK2-KRK-EMN', '1', ['kadikoyyeni', 'karakoy', 'eminonu']),
    ('KRK-EMN-KDK2', '1', ['karakoy', 'eminonu', 'kadikoyyeni']),
    ('KDK-KRK', '1', ['kadikoymetro', 'karakoy']),
    ('KRK-KDK', '1', ['karakoy', 'kadikoymetro']),
    ('EMN-ADALAR', '3', ['eminonu', 'karakoy', 'kadikoymetro', 'kinaliada', 'burgazada', 'heybeliada', 'buyukada']),
    ('ADALAR-EMN', '3', ['buyukada', 'heybeliada', 'burgazada', 'kinaliada', 'kadikoymetro', 'eminonu']),
]

# İki iskele arası yol süresi (dk, yanaşma dahil). Yoksa mesafeden.
SURE = {
    ('uskudar', 'karakoy'): 15, ('karakoy', 'eminonu'): 5, ('kadikoyyeni', 'karakoy'): 18,
    ('eminonu', 'kadikoyyeni'): 20, ('kadikoymetro', 'karakoy'): 20, ('kadikoymetro', 'eminonu'): 22,
    ('kadikoymetro', 'kinaliada'): 25, ('kinaliada', 'burgazada'): 12, ('burgazada', 'heybeliada'): 12,
    ('heybeliada', 'buyukada'): 13,
    ('uskudar', 'kabatas'): 12, ('uskudar', 'besiktas'): 12, ('besiktas', 'kadikoy'): 25,
}

AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}
GUNLER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
GUN_ADLARI = {'1111111': 'her gün', '1111100': 'hafta içi', '1111110': 'hafta içi+cmt', '0000010': 'cumartesi',
              '0000001': 'pazar', '0000011': 'hafta sonu', '1111101': 'cmt hariç'}


def sade(metin):
    k = (metin or '').replace('I', 'ı').replace('İ', 'i').lower()
    return ''.join(AKSAN.get(h, h) for h in k if AKSAN.get(h, h).isalnum())


def tr_buyuk(metin):
    return (metin or '').replace('i', 'İ').replace('ı', 'I').upper()


def dk(saat):
    h, m = saat.split(':')[:2]
    return int(h) * 60 + int(m)


def saat_yaz(d):
    return f'{d // 60:02d}:{d % 60:02d}:00'


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def veya(a, b):
    return ''.join('1' if x == '1' or y == '1' else '0' for x, y in zip(a, b))


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


class Duraklar:
    """Sitedeki iskele adı → beslemedeki durak. Aynı adlı birkaç durak varsa işletmecinin eski
    seferlerinde kullanılan, yoksa en çok kullanılan seçiliyor."""

    def __init__(self, tablolar):
        self.duraklar = {d['stop_id']: d for d in tablolar['stops.txt']}
        rota_ajans = {r['route_id']: r['agency_id'] for r in tablolar['routes.txt']}
        sefer_ajans = {t['trip_id']: rota_ajans.get(t['route_id']) for t in tablolar['trips.txt']}
        self.kullanim = collections.defaultdict(collections.Counter)
        for r in tablolar['stop_times.txt']:
            self.kullanim[r['stop_id']][sefer_ajans.get(r['trip_id'])] += 1
        self.adla = collections.defaultdict(list)
        for sid, d in self.duraklar.items():
            if d.get('location_type', '0') in ('', '0'):
                self.adla[d['stop_name'].strip()].append(sid)
        self.bulunamayan = set()

    def bul(self, sozluk, ad, ajans_id):
        anahtar = sade(ad)
        if anahtar in DISARIDA:
            return None
        durak_adi = sozluk.get(anahtar)
        adaylar = self.adla.get(durak_adi or '', [])
        if not adaylar:
            self.bulunamayan.add(f'{ad} ({durak_adi or "eşlemesi yok"})')
            return None
        return max(adaylar, key=lambda s: (self.kullanim[s][ajans_id], sum(self.kullanim[s].values())))

    def konum(self, sid):
        d = self.duraklar[sid]
        return float(d['stop_lat']), float(d['stop_lon'])


def yol_suresi(a_ad, b_ad, a_sid=None, b_sid=None, duraklar=None):
    a, b = sade(a_ad), sade(b_ad)
    if (a, b) in SURE:
        return SURE[(a, b)]
    if (b, a) in SURE:
        return SURE[(b, a)]
    if duraklar and a_sid and b_sid:
        return max(5, round(4 + mesafe(duraklar.konum(a_sid), duraklar.konum(b_sid)) / 1000 * 2.6))
    return 15


# ---------- Turyol ----------

def turyol_seferleri(ciftler, uyarilar):
    """Kalkış listelerinden güzergâh seferleri: {kod: [(maske, [(anahtar, dk, biner, iner)…])…]}."""
    guzergahlar = {kod: (grup, dizi) for kod, grup, dizi in TURYOL_GUZERGAH}
    adlar = {}
    kalkis = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(set)))
    for c in ciftler:
        k, v = sade(c['kalkis']), sade(c['varis'])
        adlar.setdefault(k, c['kalkis'])
        adlar.setdefault(v, c['varis'])
        kod = next((kod for kod, (grup, dizi) in guzergahlar.items()
                    if grup == c['grup'] and k in dizi and v in dizi and dizi.index(k) < dizi.index(v)), None)
        if kod is None:
            kod = f"{k}-{v}".upper()
            guzergahlar[kod] = (c['grup'], [k, v])
            uyarilar.append(f"Turyol {c['kalkis']} → {c['varis']} bilinen bir güzergâha oturmadı; doğrudan sefer sayıldı")
        dizi = guzergahlar[kod][1]
        for maske, saatler in c['gunler'].items():
            for s in saatler:
                kalkis[kod][maske][(dizi.index(k), dk(s))].add(dizi.index(v))

    sonuc = {}
    for kod, maskeler in kalkis.items():
        dizi = guzergahlar[kod][1]
        seferler = []
        for maske, olaylar in maskeler.items():
            acik = []  # {'bin': {i: dk}, 'hedef': {i: set}}
            for i in range(len(dizi)):
                buradan = sorted((t, h) for (j, t), h in olaylar.items() if j == i)
                adaylar = []
                for t, _ in buradan:
                    for n, s in enumerate(acik):
                        son = max(s['bin'])
                        if son >= i or max(max(h) for h in s['hedef'].values()) <= i:
                            continue
                        beklenen = s['bin'][son] + sum(yol_suresi(dizi[x], dizi[x + 1]) for x in range(son, i))
                        if beklenen - 5 <= t <= beklenen + 15:
                            adaylar.append((abs(t - beklenen), t, n))
                adaylar.sort()
                eslesen_t, eslesen_s = set(), set()
                for _, t, n in adaylar:
                    if t in eslesen_t or n in eslesen_s:
                        continue
                    acik[n]['bin'][i] = t
                    acik[n]['hedef'][i] = olaylar[(i, t)]
                    eslesen_t.add(t)
                    eslesen_s.add(n)
                for t, h in buradan:
                    if t not in eslesen_t:
                        acik.append({'bin': {i: t}, 'hedef': {i: h}})
            for s in acik:
                ilk = min(s['bin'])
                son = max(max(h) for h in s['hedef'].values())
                duraklar, zaman = [], None
                for i in range(ilk, son + 1):
                    if i in s['bin']:
                        zaman = s['bin'][i]
                    else:
                        zaman += yol_suresi(dizi[i - 1], dizi[i])
                    biner = i in s['bin'] and i < son
                    iner = i > ilk and any(p < i and i in h for p, h in s['hedef'].items())
                    duraklar.append((dizi[i], zaman, biner, iner))
                seferler.append((maske, duraklar))
        sonuc[kod] = seferler
    return sonuc, adlar, guzergahlar


# ---------- Dentur ----------

def sirali_saatler(saatler):
    """Belge sırasındaki saatler; gece yarısından sonrakiler (23:40, 00:00) ertesi güne taşınır."""
    sonuc, ek, onceki = [], 0, None
    for s in saatler:
        d = dk(s)
        if onceki is not None and d + ek < onceki - 6 * 60:
            ek += 1440
        sonuc.append(d + ek)
        onceki = d + ek
    return sonuc


def kalkis_saatleri(kalkis):
    acik = sirali_saatler(kalkis['saatler'])
    uretilen = []
    for bas, bit in kalkis.get('araliklar', []):
        b, e = dk(bas), dk(bit)
        if e < b:
            e += 1440
        uretilen.extend(range(b, e + 1, SUREKLI_DK))
    hepsi = sorted(set(acik))
    for t in uretilen:
        if all(abs(t - x) >= 4 for x in hepsi):
            hepsi.append(t)
            hepsi.sort()
    return hepsi


def dentur_seferleri(hat):
    """[(maske, [(ad, dk, biner, iner)…])…]"""
    seferler = []
    if hat.get('kalkislar'):
        a, b = hat['uclar']
        for k in hat['kalkislar']:
            karsi = b if sade(k['iskele']) == sade(a) else a
            sure = yol_suresi(k['iskele'], karsi)
            for t in kalkis_saatleri(k):
                seferler.append((k['gunler'], [(k['iskele'], t, True, False), (karsi, t + sure, False, True)]))
    for s in hat.get('seferler') or []:
        saatler = sirali_saatler([x[1] for x in s['duraklar']])
        n = len(s['duraklar'])
        seferler.append((s['gunler'], [(ad, t, i < n - 1, i > 0) for i, ((ad, _), t) in enumerate(zip(s['duraklar'], saatler))]))
    return seferler


# ---------- GTFS ----------

def main(json_yolu, zip_yolu):
    veri = json.load(io.open(json_yolu, encoding='utf-8'))
    tablolar, alanlar = zip_oku(zip_yolu)

    def ajans(anahtar):
        a = next((a for a in tablolar['agency.txt'] if sade(a['agency_name']).startswith(anahtar)), None)
        if not a:
            sys.exit(f'Beslemede {anahtar} ajansı yok.')
        return a['agency_id']

    turyol_id, dentur_id = ajans('turyol'), ajans('dentur')
    if not veri.get('turyol') and not veri.get('dentur'):
        print('Turyol ve Dentur tarifesi yok (indirilemedi); zip değiştirilmedi.')
        return
    # İndirilemeyen işletmecinin (null) beslemedeki verisine dokunulmaz.
    yenilenen, onek = set(), []
    if veri.get('turyol'):
        yenilenen.add(turyol_id)
        onek.append('ty-')
    else:
        print('Turyol tarifesi yok (indirilemedi); beslemedeki Turyol verisi olduğu gibi kalıyor.')
    if veri.get('dentur'):
        yenilenen.add(dentur_id)
        onek.append('dt-')
    else:
        print('Dentur tarifesi yok (indirilemedi); beslemedeki Dentur verisi olduğu gibi kalıyor.')
    eski_rotalar = {r['route_id'] for r in tablolar['routes.txt']
                    if r['agency_id'] in yenilenen or (onek and r['route_id'].startswith(tuple(onek)))}
    duraklar = Duraklar(tablolar)
    uyarilar = []

    # (rota, maske, durak dizisi) → tek sefer; aynı saatler birden çok gün türündeyse maskeler birleşir.
    rotalar, birlesik = {}, collections.OrderedDict()

    def sefer_ekle(rota_id, yon, maske, dizi, sozluk, ajans_id):
        cozulen = []
        for ad, t, biner, iner in dizi:
            sid = duraklar.bul(sozluk, ad, ajans_id)
            if sid:
                cozulen.append((sid, ad, t, biner, iner))
        if len(cozulen) < 2:
            return
        # İlk durakta inilmez, son durakta binilmez; sıra dışı saatleri düzelt.
        for i in range(1, len(cozulen)):
            sid, ad, t, b, n = cozulen[i]
            onceki = cozulen[i - 1]
            if t <= onceki[2]:
                cozulen[i] = (sid, ad, onceki[2] + yol_suresi(onceki[1], ad, onceki[0], sid, duraklar), b, n)
        cozulen[0] = cozulen[0][:4] + (False,)
        cozulen[-1] = cozulen[-1][:3] + (False, True)
        anahtar = (rota_id, yon, tuple((sid, t, b, n) for sid, _, t, b, n in cozulen))
        if anahtar in birlesik:
            birlesik[anahtar]['maske'] = veya(birlesik[anahtar]['maske'], maske)
        else:
            birlesik[anahtar] = {'maske': maske, 'bas': cozulen[0][1], 'son': cozulen[-1][1]}

    # Turyol
    t_seferler, t_adlar, t_guzergahlar = turyol_seferleri(veri.get('turyol') or [], uyarilar)
    for kod, seferler in t_seferler.items():
        dizi = t_guzergahlar[kod][1]
        rota_id = 'ty-' + sade(kod)
        rotalar[rota_id] = {'route_id': rota_id, 'agency_id': turyol_id, 'route_short_name': kod,
                            'route_long_name': ' - '.join(tr_buyuk(t_adlar.get(k, k)) for k in dizi),
                            'route_type': '4', 'route_url': 'https://www.turyol.com/Home/Tarifeler'}
        for maske, d in seferler:
            sefer_ekle(rota_id, '0', maske, [(t_adlar.get(k, k), t, b, n) for k, t, b, n in d], TURYOL_ISKELE, turyol_id)

    # Dentur
    for hat in veri.get('dentur') or []:
        rota_id = 'dt-' + sade(hat['kod'])
        seferler = dentur_seferleri(hat)
        if not seferler:
            uyarilar.append(f"Dentur {hat['kod']}: sefer yok")
            continue
        uclar = hat.get('uclar') or [seferler[0][1][0][0], seferler[0][1][-1][0]]
        rotalar[rota_id] = {'route_id': rota_id, 'agency_id': dentur_id, 'route_short_name': hat['kod'],
                            'route_long_name': ' - '.join(tr_buyuk(u) for u in uclar),
                            'route_type': '4', 'route_url': hat.get('adres', '')}
        ilk_uc = sade(seferler[0][1][0][0]) if not hat.get('uclar') else sade(hat['uclar'][0])
        for maske, d in seferler:
            yon = '0' if sade(d[0][0]) == ilk_uc else '1'
            sefer_ekle(rota_id, yon, maske, d, DENTUR_ISKELE, dentur_id)

    # Yaz
    eski_seferler = {t['trip_id'] for t in tablolar['trips.txt'] if t['route_id'] in eski_rotalar}
    yeni_seferler, yeni_saatler, servisler = [], [], set()
    sayim = collections.defaultdict(collections.Counter)
    for n, ((rota_id, yon, dizi), bilgi) in enumerate(birlesik.items()):
        maske = bilgi['maske']
        servisler.add(maske)
        tid = f'{rota_id}-{n}'
        yeni_seferler.append({'route_id': rota_id, 'service_id': f'oz-{maske}', 'trip_id': tid,
                              'trip_headsign': bilgi['son'], 'direction_id': yon, 'shape_id': '',
                              'wheelchair_accessible': '0', 'bikes_allowed': '0'})
        for sira, (sid, t, biner, iner) in enumerate(dizi, start=1):
            yeni_saatler.append({'trip_id': tid, 'arrival_time': saat_yaz(t), 'departure_time': saat_yaz(t),
                                 'stop_id': sid, 'stop_sequence': str(sira), 'stop_headsign': '',
                                 'pickup_type': '0' if biner else '1', 'drop_off_type': '0' if iner else '1',
                                 'shape_dist_traveled': '', 'timepoint': '1'})
        sayim[rota_id][maske] += 1

    if not yeni_seferler:
        sys.exit('Hiç sefer kurulamadı; zip değiştirilmedi.')

    bugun = datetime.date.today()
    bas, bit = (bugun - datetime.timedelta(days=7)).strftime('%Y%m%d'), (bugun + datetime.timedelta(days=365)).strftime('%Y%m%d')
    tablolar['calendar.txt'] = [c for c in tablolar['calendar.txt'] if not c['service_id'].startswith('oz-')]
    for maske in sorted(servisler):
        tablolar['calendar.txt'].append({'service_id': f'oz-{maske}', **dict(zip(GUNLER, maske)), 'start_date': bas, 'end_date': bit})

    tablolar['routes.txt'] = [r for r in tablolar['routes.txt'] if r['route_id'] not in eski_rotalar] + list(rotalar.values())
    tablolar['trips.txt'] = [t for t in tablolar['trips.txt'] if t['trip_id'] not in eski_seferler] + yeni_seferler
    tablolar['stop_times.txt'] = [r for r in tablolar['stop_times.txt'] if r['trip_id'] not in eski_seferler] + yeni_saatler
    if 'frequencies.txt' in tablolar:
        tablolar['frequencies.txt'] = [f for f in tablolar['frequencies.txt'] if f['trip_id'] not in eski_seferler]
    if 'route_url' not in alanlar['routes.txt']:
        alanlar['routes.txt'].append('route_url')
    for alan in ('pickup_type', 'drop_off_type'):
        if alan not in alanlar['stop_times.txt']:
            alanlar['stop_times.txt'].append(alan)
    zip_yaz(zip_yolu, tablolar, alanlar)

    print(f"Turyol ve Dentur tarifesi ({veri.get('indirildi', '?')[:10]} indirildi):")
    for rota_id, r in rotalar.items():
        dagilim = ', '.join(f"{GUN_ADLARI.get(m, m)} {n}" for m, n in sorted(sayim[rota_id].items(), key=lambda x: -x[1]))
        isl = 'Turyol' if r['agency_id'] == turyol_id else 'Dentur'
        print(f"  {isl:6} {r['route_short_name']:13} {r['route_long_name'][:52]:52} {sum(sayim[rota_id].values()):4} sefer  ({dagilim})")
    print(f'\n{len(yeni_seferler)} sefer eklendi; eski veriden {len(eski_rotalar)} hat, {len(eski_seferler)} sefer silindi.')
    if duraklar.bulunamayan:
        print('EŞLEŞMEYEN İSKELELER (seferlerden atlandı):', ', '.join(sorted(duraklar.bulunamayan)))
    for u in uyarilar:
        print('  uyarı:', u)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('kullanım: python ozel-vapur-uygula.py <ozel-vapur-tarife.json> <ray-vapur-gtfs.zip>')
    main(sys.argv[1], sys.argv[2])
