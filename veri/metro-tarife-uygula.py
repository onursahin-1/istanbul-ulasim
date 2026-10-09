# Metro İstanbul'un gerçek tarifesini (metro-tarife-indir.mjs çıktısı) raylı GTFS'e işler.
#
# İBB'nin raylı sistem beslemesi 2023'ten beri güncellenmiyor; metro, tramvay ve füniküler
# saatleri o yüzden yaklaşıktı (bazıları yalnız "her 6 dakikada" diye sıklıkla tanımlı).
# Metro İstanbul'un servisi istasyon istasyon gerçek kalkış saatlerini veriyor: hafta içi,
# cumartesi, pazar. Bu betik her hattın her yönü için o saatlerden seferler kurar ve
# beslemedeki eski seferlerin yerine koyar.
#
# Seferin kurulması: bir yönde her istasyonun kalkış listesi aynı uzunlukta geliyor (M2
# Yenikapı→Hacıosman hafta içi her istasyonda 179 kalkış); k. sefer her istasyonun k.
# saatidir. Uzunluklar tutmazsa ilk istasyonun her kalkışı, sonraki istasyonda ondan
# sonraki ilk saate zincirlenir. Liste servis günü sırasıyla geliyor; saat geriye
# düşünce (23:59 → 00:03) gece yarısı geçilmiş sayılır (24:03).
#
# Eşleme: servisin istasyonu, aynı hattın beslemedeki desenlerinden sırası en iyi tutan
# desenin 400 m içindeki durağına bağlanır. Böylece M2'nin Sanayi–Seyrantepe mekiği
# beslemedeki M2A'ya, M7'nin onarım yüzünden bölünmüş işletmesi (Nurtepe–Mahmutbey,
# Çağlayan–Nurtepe, Yıldız–Mecidiyeköy) M7'nin kendi duraklarına düşer.
#
# Yalnız yeni seferi kurulabilen (hat, yön) çiftlerinin eski seferleri silinir; servisin
# boş döndüğü yönler (ör. M2 Seyrantepe→Sanayi) eski tarifesiyle kalır.
#
# Kullanım (eksik-hatlar.py'den SONRA; ardından cizgi-ekle.py ve durak-birlestir.py):
#   python metro-tarife-uygula.py C:\otp\metro-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import collections, csv, datetime, io, json, math, shutil, sys, zipfile

csv.field_size_limit(10 ** 7)

ESLEME_M = 400
GUN_SERVIS = {
    'haftaici': ('mi-haftaici', '1111100'),
    'cumartesi': ('mi-cumartesi', '0000010'),
    'pazar': ('mi-pazar', '0000001'),
}
RAYLI_TURLER = {'0', '1', '2', '5', '6', '7'}
# Tek yönlü ring hatlar: servis istasyon listelerini gidiş yönünün tersine veriyor (T3'te
# Kadıköy İDO 07:10, Mühürdar 07:12… oysa tramvay İDO → İskele Camii → Çarşı → Altıyol →
# Bahariye → Moda → Mühürdar → Damga Sokak dönüyor; Metro İstanbul'un istasyon sırası da
# İBB'nin eski beslemesi de böyle). Bu hatlarda sıra istasyon sırasından, kalkışlar ilk
# istasyonun listesinden, aradaki süreler beslemedeki eski seferlerden alınır.
SIRAYA_GORE = {'T3'}


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def dakika(saat):
    s, d = saat.strip().split(':')[:2]
    return int(s) * 60 + int(d)


def saat_yaz(dk):
    return f'{dk // 60:02d}:{dk % 60:02d}:00'


def servis_dakikalari(liste):
    """Servis günü sırasıyla gelen "HH:MM" listesi → artan dakikalar (gece yarısı sonrası +1440).

    Servis listeyi her zaman sıralı vermiyor (M1A Cumartesi Atatürk Havalimanı yönü:
    "07:25, 07:38, 07:31, 07:46"). Sefer kurulurken her istasyonun k. saati k. sefere
    yazıldığı için sırasız bir liste o istasyonda seferleri birbirine karıştırıyordu;
    gece yarısı düzeltmesinden sonra sıralanıyor.
    """
    sonuc, ek, onceki = [], 0, None
    for s in liste:
        dk = dakika(s)
        if onceki is not None and dk + ek < onceki - 60:
            ek += 1440
        sonuc.append(dk + ek)
        onceki = max(onceki or 0, dk + ek)
    return sorted(sonuc)


def seferleri_kur(istasyon_saatleri):
    """[(istasyon, [dakika…])…] yön sırasıyla → [[(istasyon, dakika)…]…] seferler."""
    if not istasyon_saatleri:
        return []
    uzunluklar = {len(s) for _, s in istasyon_saatleri}
    seferler = []
    if len(uzunluklar) == 1:
        n = uzunluklar.pop()
        for k in range(n):
            sefer, onceki = [], None
            for ist, saatler in istasyon_saatleri:
                t = saatler[k]
                while onceki is not None and t < onceki:
                    t += 1440
                sefer.append((ist, t))
                onceki = t
            seferler.append(sefer)
        return seferler
    # Uzunluklar tutmuyor: ilk istasyondan zincirle.
    ilk_ist, ilk = istasyon_saatleri[0]
    for t0 in ilk:
        sefer, onceki = [(ilk_ist, t0)], t0
        for ist, saatler in istasyon_saatleri[1:]:
            aday = next((t for t in saatler if onceki <= t <= onceki + 30), None)
            if aday is None:
                break
            sefer.append((ist, aday))
            onceki = aday
        if len(sefer) >= 2:
            seferler.append(sefer)
    return seferler


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


def desenler(tablolar, rota_idleri):
    """Rotaların farklı durak dizileri: [(route_id, direction_id, shape_id, [stop_id…])]."""
    seferler = {t['trip_id']: t for t in tablolar['trips.txt'] if t['route_id'] in rota_idleri}
    diziler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        if r['trip_id'] in seferler:
            diziler[r['trip_id']].append((int(r['stop_sequence']), r['stop_id']))
    gorulen, sonuc = set(), []
    for tid, liste in diziler.items():
        dizi = tuple(s for _, s in sorted(liste))
        t = seferler[tid]
        anahtar = (t['route_id'], t['direction_id'], dizi)
        if anahtar in gorulen:
            continue
        gorulen.add(anahtar)
        sonuc.append((t['route_id'], t['direction_id'], t.get('shape_id', ''), list(dizi)))
    return sonuc


def ad_benzer(a, b):
    a, b = ad_kok(a), ad_kok(b)
    return bool(a and b) and (a.startswith(b) or b.startswith(a) or a[:6] == b[:6])


def eslestir(istasyonlar, desen, konum, adlar):
    """API istasyonlarını desenin duraklarına bağlar. (eşleşme sayısı, -toplam mesafe), [stop_id|None].

    Her istasyon desendeki en yakın durağa (400 m) bağlanır; adı tutan durak dört kat
    yakın sayılır (servisin bazı konumları yanlış: M7 Yeşilpınar'ınki Çırçır'ın yanında
    görünüyor). İki istasyon aynı durağa
    düşerse yakın olan kalır. Sonra sıra korunur: desen içindeki konumları artan en uzun
    dizi seçilir (ters sıralı ya da atlayan eşleşmeler düşer). Açıkta kalan istasyon,
    açıkta kalan bir desen durağına 800 m içindeyse ve sıraya uyuyorsa ona bağlanır
    (OSM'den eklenen duraklar istasyon binasından biraz uzakta olabiliyor).
    """
    yerler = [(i, konum[d]) for i, d in enumerate(desen) if d in konum]

    def en_yakin(ist, sinir, bos=None):
        en, en_m = None, sinir
        for i, k in yerler:
            if bos is not None and i not in bos:
                continue
            m = mesafe((ist['lat'], ist['lon']), k)
            if ad_benzer(ist['ad'], adlar.get(desen[i], '')):
                m /= 4
            if m < en_m:
                en, en_m = i, m
        return en, en_m

    aday = [en_yakin(ist, ESLEME_M) for ist in istasyonlar]
    # Aynı durağa düşenlerden yakın olanı.
    sahibi = {}
    for j, (i, m) in enumerate(aday):
        if i is not None and (i not in sahibi or m < aday[sahibi[i]][1]):
            sahibi[i] = j
    secili = sorted((j, aday[j][0]) for j in sahibi.values())
    # Sıra: desen konumu artan en uzun alt dizi.
    en_iyi = [1] * len(secili)
    onceki = [-1] * len(secili)
    for a in range(len(secili)):
        for b in range(a):
            if secili[b][1] < secili[a][1] and en_iyi[b] + 1 > en_iyi[a]:
                en_iyi[a], onceki[a] = en_iyi[b] + 1, b
    sonuc = [None] * len(istasyonlar)
    uzak = [0.0] * len(istasyonlar)
    if secili:
        a = max(range(len(secili)), key=lambda x: en_iyi[x])
        while a >= 0:
            j, i = secili[a]
            sonuc[j], uzak[j] = i, aday[j][1]
            a = onceki[a]
    # Açıkta kalanlar için geniş eşik.
    for j, ist in enumerate(istasyonlar):
        if sonuc[j] is not None:
            continue
        alt = max((sonuc[x] for x in range(j) if sonuc[x] is not None), default=-1)
        ust = min((sonuc[x] for x in range(j + 1, len(istasyonlar)) if sonuc[x] is not None), default=len(desen))
        kullanilan = {x for x in sonuc if x is not None}
        bos = {i for i, _ in yerler if alt < i < ust and i not in kullanilan}
        i, m = en_yakin(ist, 2 * ESLEME_M, bos)
        if i is not None:
            sonuc[j], uzak[j] = i, m
    sayi = sum(1 for x in sonuc if x is not None)
    return (sayi, -sum(uzak)), [desen[i] if i is not None else None for i in sonuc]


def ara_sureleri(tablolar, sefer_idleri):
    """Beslemedeki eski seferlerden komşu durak çiftlerinin yol süresi (dakika, ortanca)."""
    diziler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        if r['trip_id'] in sefer_idleri and r['arrival_time'] and r['departure_time']:
            diziler[r['trip_id']].append((int(r['stop_sequence']), r['stop_id'], r['arrival_time'], r['departure_time']))
    sureler = collections.defaultdict(list)
    for liste in diziler.values():
        liste.sort()
        for a, b in zip(liste, liste[1:]):
            fark = (saniye(b[2]) - saniye(a[3])) / 60
            if 0 < fark < 30:
                sureler[(a[1], b[1])].append(fark)
                sureler[(b[1], a[1])].append(fark)
    return {k: max(1, round(sorted(v)[len(v) // 2])) for k, v in sureler.items()}


def saniye(saat):
    s, d, n = (saat.strip().split(':') + ['0'])[:3]
    return int(s) * 3600 + int(d) * 60 + int(n)


def ad_kok(ad):
    """İstasyon adını karşılaştırma için sadeleştirir ("Mecidiyeköy " → "mecidiyekoy")."""
    tablo = str.maketrans('çğıöşüâîûÇĞİÖŞÜ', 'cgiosuaiucgiosu')
    return ''.join(c for c in ad.strip().translate(tablo).lower() if c.isalnum())


def yon_isareti(istasyonlar, kalkis):
    """Yön adındaki başlangıç ve bitiş istasyonundan hattın sıra yönü (+1/-1), bulunamazsa None."""
    ornek = next(iter(kalkis.values()), {})
    bas, son = ad_kok(ornek.get('ilk') or ''), ad_kok(ornek.get('son') or '')

    def bul(k):
        if not k:
            return None
        for i in istasyonlar:
            a = ad_kok(i['ad'])
            if a == k or a.startswith(k) or k.startswith(a):
                return i['sira']
        return None

    a, b = bul(bas), bul(son)
    if a is None or b is None or a == b:
        return None
    return 1 if b > a else -1


def ring_satirlari(istasyon, kalkislar, gun_adi):
    """Ring hat: istasyon sırasıyla, yön adındaki ilk istasyondan son istasyona. Kalkış listesi
    yalnız ilk istasyonda; öbürlerinde boş liste (saatleri yol sürelerinden kurulur)."""
    ornek = next(iter(kalkislar.values()), {})
    sirali = sorted(istasyon.values(), key=lambda i: i['sira'])
    bas = next((k for k, i in enumerate(sirali) if ad_benzer(i['ad'], ornek.get('ilk') or '')), 0)
    sirali = sirali[bas:] + sirali[:bas]
    son = next((k for k, i in enumerate(sirali) if k and ad_benzer(i['ad'], ornek.get('son') or '')), len(sirali) - 1)
    sirali = sirali[:son + 1]
    ilk = kalkislar.get(sirali[0]['id'], {}).get(gun_adi) if sirali else None
    if not ilk:
        return []
    return [(sirali[0], servis_dakikalari(ilk))] + [(i, []) for i in sirali[1:]]


def esit_zinciri_onar(sefer, ara, konum):
    """Üç ve daha çok ardışık istasyonun aynı dakikada göründüğü zincirleri yeniden saatler.

    Servis M5'in doğu ucunda saatleri kopyalamış: Üsküdar→Sultanbeyli yönünde Sancaktepe,
    Samandıra, Veysel Karani, Hasanpaşa ve Sultanbeyli aynı dakika (07:19); öbür yönde
    Sultanbeyli, Hasanpaşa, Veysel Karani 06:41 ve üç istasyon sonra Sarıgazi 06:45. Oysa
    Sultanbeyli–Sarıgazi ~8 km. Hattın geri kalanı tutarlı (dakikaya yuvarlı ama tek tük
    eşitlik), bu yüzden zincir dışındaki en yakın istasyon doğru sayılır ve zincir oradan
    yol süreleriyle saatlenir: zincir seferin başındaysa ilk güvenilir istasyondan geriye,
    değilse son güvenilir istasyondan ileriye. Yol süresi beslemedeki eski seferlerden
    (ara), yoksa mesafeden (~40 km/sa, duraklama dahil).
    """
    n = len(sefer)
    supheli = [False] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and sefer[j + 1][1] == sefer[i][1]:
            j += 1
        if j - i + 1 >= 3:
            for k in range(i, j + 1):
                supheli[k] = True
        i = j + 1
    if not any(supheli) or all(supheli):
        return sefer

    def sure(a, b):
        if (a, b) in ara:
            return ara[(a, b)]
        if a in konum and b in konum:
            return max(1, round(mesafe(konum[a], konum[b]) / 11 / 60 + 0.5))
        return 2

    sonuc = list(sefer)
    ilk_guvenilir = supheli.index(False)
    for k in range(ilk_guvenilir - 1, -1, -1):
        sonuc[k] = (sonuc[k][0], sonuc[k + 1][1] - sure(sonuc[k][0], sonuc[k + 1][0]))
    for k in range(ilk_guvenilir + 1, n):
        if supheli[k]:
            sonuc[k] = (sonuc[k][0], sonuc[k - 1][1] + sure(sonuc[k - 1][0], sonuc[k][0]))
    return sonuc


def saatleri_duzelt(sefer, ara):
    """Son istasyonun varış saatini düzeltir; aradaki istasyonlara dokunmaz.

    Servis son istasyona bir öncekinin saatini veriyor (Darüşşafaka 06:21, Hacıosman
    06:21; iki istasyonlu füniküler ve teleferiklerde iki uç aynı dakika). Son aralık için
    beslemedeki eski yol süresi (yoksa 2 dk) eklenir.

    Aradaki istasyonlarda aynı dakika gerçek: saatler dakikaya yuvarlanmış, iki istasyon
    arası bir dakikadan kısa olabiliyor. Eskiden ikincisine bir dakika ekleniyordu; ek
    zincirleme büyüyor ve tarife Metro İstanbul'unkinden 1-2 dakika kayıyordu (M5
    Sancaktepe Şehir Hastanesi, M2 Sanayi Mahallesi). GTFS eşit saatlere izin veriyor.
    Geriye giden bir saat (servisteki hata) bir öncekine eşitlenir.
    """
    sonuc = [sefer[0]]
    for i, (stop, t) in enumerate(sefer[1:], start=1):
        onceki_stop, onceki_t = sonuc[-1]
        if i == len(sefer) - 1 and t <= onceki_t:
            t = onceki_t + ara.get((onceki_stop, stop), 2)
        elif t < onceki_t:
            t = onceki_t
        sonuc.append((stop, t))
    return sonuc


def main(json_yolu, zip_yolu):
    veri = json.load(io.open(json_yolu, encoding='utf-8'))
    tablolar, alanlar = zip_oku(zip_yolu)
    konum = {d['stop_id']: (float(d['stop_lat']), float(d['stop_lon'])) for d in tablolar['stops.txt']}
    adlar = {d['stop_id']: d['stop_name'] for d in tablolar['stops.txt'] if d.get('location_type', '0') in ('', '0')}
    rotalar = [r for r in tablolar['routes.txt'] if r['route_type'] in RAYLI_TURLER]

    # Servis takvimleri: bugünden bir yıl.
    bugun = datetime.date.today()
    bas, bit = (bugun - datetime.timedelta(days=7)).strftime('%Y%m%d'), (bugun + datetime.timedelta(days=365)).strftime('%Y%m%d')
    tablolar['calendar.txt'] = [c for c in tablolar['calendar.txt'] if not c['service_id'].startswith('mi-')]
    for sid, maske in GUN_SERVIS.values():
        gunler = dict(zip(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], maske))
        tablolar['calendar.txt'].append({'service_id': sid, **gunler, 'start_date': bas, 'end_date': bit})

    # Önceki çalıştırmanın seferlerini temizle (yeniden çalıştırılabilir olsun).
    eski_mi = {t['trip_id'] for t in tablolar['trips.txt'] if t['trip_id'].startswith('mi-')}

    yeni_seferler, yeni_saatler, degisen = [], [], set()
    yeni_duraklar = {}
    rapor = []
    for hat in veri.get('hatlar', []):
        ad = hat['ad'].strip().upper()
        adaylar = {r['route_id'] for r in rotalar if (r['route_short_name'] or '').strip().upper().startswith(ad)}
        if not adaylar:
            rapor.append((ad, 'beslemede yok', 0))
            continue
        hat_desenleri = desenler(tablolar, adaylar)
        # Servis bazı istasyonların konumunu vermiyor (M5'in Sultanbeyli uzantısı: 0, 0).
        # Bunlar eskiden eleniyordu ve seferler Samandıra'da bitiyordu; konum, hattın
        # beslemedeki aynı adlı durağından (uzantıyı istasyon-tamamla.py OSM'den ekliyor) alınır.
        hat_duraklari = {d for de in hat_desenleri for d in de[3] if d in konum}
        for i in hat['istasyonlar']:
            if not (i.get('lat') and i.get('lon')):
                ayni = next((d for d in sorted(hat_duraklari) if ad_benzer(i['ad'], adlar.get(d, ''))), None)
                if ayni:
                    i['lat'], i['lon'] = konum[ayni]
        istasyon = {i['id']: i for i in hat['istasyonlar'] if math.isfinite(i.get('lat') or float('nan'))}
        ara = ara_sureleri(tablolar, {t['trip_id'] for t in tablolar['trips.txt'] if t['route_id'] in adaylar})
        for yon in hat['yonler']:
            kalkislar = {int(k): v for k, v in yon['kalkislar'].items()}
            if not kalkislar:
                rapor.append((ad, f"{yon['ad']}: saat yok (eski tarife kalır)", 0))
                continue
            isaret = yon_isareti(hat['istasyonlar'], yon['kalkislar'])
            for gun_adi, (sid, _) in GUN_SERVIS.items():
                satirlar = [(istasyon[i], servis_dakikalari(v[gun_adi])) for i, v in kalkislar.items()
                            if i in istasyon and v.get(gun_adi)]
                if ad in SIRAYA_GORE:
                    satirlar = ring_satirlari(istasyon, kalkislar, gun_adi)
                    isaret = 1
                if len(satirlar) < 2:
                    continue
                # Yön sırası: ilk seferin saatine göre (gidiş yönünde saat artar). Aynı dakikaya
                # düşen istasyonlar (saatler dakikaya yuvarlı; iki istasyonlu hatlarda iki uç
                # aynı dakika) yön adındaki başlangıç–bitişe göre, o bulunamazsa saat sırasına göre.
                if isaret is None and ad not in SIRAYA_GORE:
                    satirlar.sort(key=lambda x: (x[1][0], x[0]['sira']))
                    isaret_ = 1 if satirlar[-1][0]['sira'] >= satirlar[0][0]['sira'] else -1
                else:
                    isaret_ = isaret
                if ad not in SIRAYA_GORE:
                    satirlar.sort(key=lambda x: (x[1][0], isaret_ * x[0]['sira']))
                siralı = [s for s, _ in satirlar]
                en = max(((eslestir(siralı, d[3], konum, adlar), d) for d in hat_desenleri), key=lambda x: x[0][0], default=None)
                if not en or en[0][0][0] < 2:
                    rapor.append((ad, f"{yon['ad']} {gun_adi}: beslemedeki duraklarla eşleşmedi", 0))
                    continue
                (_, duraklar), (rota_id, yon_id, cizgi, _) = en
                if ad in SIRAYA_GORE:
                    duraklar = [None] * len(siralı)  # beslemedeki durakları yanlış yerde; servisin konumları
                # Desende olmayan istasyon (ör. M7 Yeşilpınar: beslemede durağı var ama eski
                # seferler uğramıyordu): beslemedeki aynı adlı en yakın durak (3 km; servisin
                # konumu yanlış olabiliyor), o da yoksa servisin konumuyla yeni durak.
                for j, ist in enumerate(siralı):
                    if duraklar[j] or ist.get('aktif') is False:
                        continue
                    yakin = min(((mesafe((ist['lat'], ist['lon']), konum[d]), d) for d, a in adlar.items()
                                 if d in konum and ad_benzer(ist['ad'], a) and not d.startswith('mi-')),
                                default=(math.inf, None))
                    if yakin[0] < 3000 and ad not in SIRAYA_GORE:
                        duraklar[j] = yakin[1]
                        continue
                    sid_yeni = f"mi-{ist['id']}"
                    if sid_yeni not in yeni_duraklar:
                        yeni_duraklar[sid_yeni] = {'stop_id': sid_yeni, 'stop_name': ist['ad'].strip(),
                                                   'stop_lat': f"{ist['lat']:.7f}", 'stop_lon': f"{ist['lon']:.7f}",
                                                   'location_type': '0', 'wheelchair_boarding': '1'}
                        konum[sid_yeni] = (ist['lat'], ist['lon'])
                    duraklar[j] = sid_yeni
                if ad in SIRAYA_GORE:
                    # Tur süresi servisin listelerinden (ilk kalkışların yayılımı), duraklara eşit bölünür.
                    ilkler = [servis_dakikalari(v[gun_adi])[0] for v in kalkislar.values() if v.get(gun_adi)]
                    zincir = [d for d in duraklar if d]
                    ara_dk = max(1.0, (max(ilkler) - min(ilkler)) / max(1, len(zincir) - 1))
                    seferler = [[(d, t0 + round(k * ara_dk)) for k, d in enumerate(zincir)] for t0 in satirlar[0][1]]
                else:
                    seferler = seferleri_kur([(duraklar[j], satirlar[j][1]) for j in range(len(satirlar)) if duraklar[j]])
                if ad not in SIRAYA_GORE:
                    seferler = [esit_zinciri_onar(sf, ara, konum) for sf in seferler]
                seferler = [saatleri_duzelt(sf, ara) for sf in seferler]
                for k, sefer in enumerate(seferler):
                    tid = f"mi-{hat['id']}-{yon['id']}-{gun_adi}-{k}"
                    yeni_seferler.append({
                        'route_id': rota_id, 'service_id': sid, 'trip_id': tid,
                        'trip_headsign': '', 'trip_short_name': '', 'direction_id': yon_id,
                        'block_id': '', 'shape_id': cizgi, 'wheelchair_accessible': '1', 'bikes_allowed': '0',
                    })
                    for sira, (stop, t) in enumerate(sefer, start=1):
                        yeni_saatler.append({
                            'trip_id': tid, 'arrival_time': saat_yaz(t), 'departure_time': saat_yaz(t),
                            'stop_id': stop, 'stop_sequence': str(sira), 'stop_headsign': '',
                            'pickup_type': '0', 'drop_off_type': '0', 'shape_dist_traveled': '', 'timepoint': '1',
                        })
                degisen.add((rota_id, yon_id))
                rapor.append((ad, f"{yon['ad']} {gun_adi}", len(seferler)))

    # Başlıklar: yön adı son durağın adı.
    ad_bul = {d['stop_id']: d['stop_name'] for d in list(tablolar['stops.txt']) + list(yeni_duraklar.values())}
    son_durak = {}
    for r in yeni_saatler:
        son_durak[r['trip_id']] = r['stop_id']
    for t in yeni_seferler:
        t['trip_headsign'] = ad_bul.get(son_durak.get(t['trip_id']), '')

    # Yerini alacakları eski seferler: aynı rota ve yön (sıklık tanımlıları dahil).
    silinecek = eski_mi | {t['trip_id'] for t in tablolar['trips.txt'] if (t['route_id'], t['direction_id']) in degisen}
    tablolar['stops.txt'] = [d for d in tablolar['stops.txt'] if not d['stop_id'].startswith('mi-')] + list(yeni_duraklar.values())
    if yeni_duraklar:
        print('yeni duraklar:', ', '.join(d['stop_name'] for d in yeni_duraklar.values()))
    tablolar['trips.txt'] = [t for t in tablolar['trips.txt'] if t['trip_id'] not in silinecek] + yeni_seferler
    tablolar['stop_times.txt'] = [r for r in tablolar['stop_times.txt'] if r['trip_id'] not in silinecek] + yeni_saatler
    if 'frequencies.txt' in tablolar:
        tablolar['frequencies.txt'] = [f for f in tablolar['frequencies.txt'] if f['trip_id'] not in silinecek]
    zip_yaz(zip_yolu, tablolar, alanlar)

    print(f"Metro İstanbul tarifesi ({veri.get('indirildi', '?')[:10]} indirildi):")
    for ad, ne, n in rapor:
        print(f'  {ad:5} {ne}' + (f': {n} sefer' if n else ''))
    print(f'\n{len(yeni_seferler)} sefer eklendi, {len(silinecek - eski_mi)} eski sefer kaldırıldı ({len(degisen)} hat-yön)')
    for hat in veri.get('hatlar', []):
        for d in hat.get('durum', []):
            print(f"  duyuru {hat['ad']}: {d}")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('kullanım: python metro-tarife-uygula.py <metro-tarife.json> <ray-vapur-gtfs.zip>')
    main(sys.argv[1], sys.argv[2])
