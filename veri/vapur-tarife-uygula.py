# Şehir Hatları'nın güncel vapur tarifesini (vapur-tarife-indir.mjs çıktısı) raylı-vapur GTFS'ine işler.
#
# Beslemedeki Şehir Hatları seferleri İBB'nin 2023'ten beri güncellenmeyen verisinden:
# hatların bir kısmı değişti, bir kısmı kalktı, yenileri (Moda, Maltepe, Tuzla–Pendik–
# Büyükada, Sedef Adası, Boğaz'ın yeni hatları) hiç yok. Bu betik Şehir Hatları'nın
# bütün hatlarını ve seferlerini silip sitenin tarifesinden yeniden kurar. Turyol, Dentur
# ve İDO'ya dokunmaz.
#
# Sitenin tabloları:
#   - Her hatta gidiş ve dönüş tabloları; gün türüne göre ayrı tablolar ("Hafta içi",
#     "Cumartesi Günleri", "Pazar ve Tatil Günleri", "Her gün"…).
#   - İlk satır başlık ve yıldızlı dipnotlar: "* C.TESİ,PAZAR VE RESMİ TATİL GÜNLERİ
#     YAPILMAZ", "** Sadece Pazar ve Resmi Tatil günleri yapılır", "*** KARAKÖY
#     İSKELESİNDE YOLCU ALMAZ", "* Sefer Anadolu Hisarı İskelesi'nde bitmektedir"…
#     Yıldız saatin yanında: o sefere (ya da o iskeleye) uygulanır.
#   - Sonra iskele sütunları, çoğunda bir "Kalkış/Varış" satırı, sonra saatler. "-" o
#     iskeleye uğramaz. Parantezli saat "(07:50)" sütun sırasının dışında, önce uğranan
#     iskele (Bostancı hattında vapur önce Karaköy'e, sonra Kabataş'a uğruyor).
#   - Tek sütunlu tablolar (Kadıköy–Kabataş, İstinye–Çubuklu…) yalnız kalkış verir; varış
#     öbür yönün kalkış iskelesi, yol süresi başka seferlerden ya da mesafeden.
#   - Aynı dakikada iki iskele (ör. "Kadıköy 21:00, Karaköy 21:00") tablo hatası: ikinciye
#     yol süresi eklenir.
#
# Resmî tatiller ayrı işlenmiyor (GTFS'te takvim istisnası yok); o günler olağan gün
# türüyle çalışır.
#
# Kullanım (vapur-tarife-indir.mjs'ten sonra; ardından durak-birlestir.py):
#   python vapur-tarife-uygula.py C:\otp\vapur-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import collections, csv, datetime, html, io, json, math, re, shutil, sys, zipfile

csv.field_size_limit(10 ** 7)

HER_GUN = '1111111'

# Hat kodları (rozette görünen kısa ad). Sitede yeni hat çıkarsa kodsuz kalır, uzun adla görünür.
HAT_KODU = {
    '766': 'KDK-KBT', '163': 'KDK-EMN', '164': 'ÜSK-EMN', '165': 'KDK-BŞK', '768': 'KDK-BŞK GECE',
    '37': 'ÜSK-HALİÇ', '2014': 'AŞİYAN RİNG', '2015': 'ÜSK-AŞİYAN', '2017': 'KDK-HALİÇ', '2019': 'BŞK-HALİÇ',
    '2021': 'ÇNK-KBT', '2024': 'BOS-KBT', '167': 'BOĞAZ', '168': 'AKV-SRY', '169': 'KÇS-KBT',
    '170': 'ÇNK-İST', '171': 'KDK-SRY', '172': 'AKV-ÜSK', '173': 'ORT-KDK', '174': 'RKV-EMN',
    '175': 'KÇS-İST', '595': 'BBK-EMG', '767': 'BYK-SRY', '2078': 'ORT-EMN', '3598': 'İST-ÇBK',
    '177': 'KBT-ADALAR', '769': 'ADALAR-BŞK', '770': 'BOS-ADALAR', '895': 'BYA-SEDEF', '2020': 'MLT-ADALAR',
    '3373': 'TZL-BYA',
}

# Beslemede olmayan iskeleler (konumlar OpenStreetMap'ten).
EK_ISKELELER = {
    'moda': ('sh-moda', 'Moda ŞH.', 40.978932, 29.025191),
    'maltepe': ('sh-maltepe', 'Maltepe ŞH.', 40.919027, 29.127808),
    'tuzla': ('sh-tuzla', 'Tuzla ŞH.', 40.814760, 29.301825),
    'pendik': ('sh-pendik', 'Pendik ŞH.', 40.874612, 29.236362),
    'sedefadasi': ('sh-sedef', 'Sedef Adası ŞH.', 40.853923, 29.144463),
    'buyukdere': ('sh-buyukdere', 'Büyükdere ŞH.', 41.160774, 29.046117),
}

# Sitedeki kısaltmaların açılışı (yön tabelasında görünür).
AD_DUZELT = {'A.Hisari': 'Anadolu Hisarı', 'A.Hisarı': 'Anadolu Hisarı', 'Anadolukavağı': 'Anadolu Kavağı',
             'Rumelikavağı': 'Rumeli Kavağı'}

# Sitedeki adın beslemedeki karşılığı (sade yazımla).
AD_ESI = {'ahisari': 'anadoluhisari', 'eyupsultan': 'eyup'}

AKSAN = {'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}


def sade(metin):
    k = (metin or '').replace('I', 'ı').replace('İ', 'i').lower()
    return ''.join(AKSAN.get(h, h) for h in k if AKSAN.get(h, h).isalnum())


def tr_buyuk(metin):
    return (metin or '').replace('i', 'İ').replace('ı', 'I').upper()


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


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


# ---------- tablo okuma ----------

SAAT_RE = re.compile(r'(\d{1,2})[:.](\d{2})')


def hucre_metni(h):
    return html.unescape(h['m'] if isinstance(h, dict) else h).strip()


def genislet(satir):
    """colspan'lı hücreleri tekrarlayarak düz listeye açar."""
    sonuc = []
    for h in satir:
        sonuc.extend([hucre_metni(h)] * (h.get('y', 1) if isinstance(h, dict) else 1))
    return sonuc


def saat_hucresi(metin):
    """'06:10 *' → (370, False, 1); '(07:50)' → (470, True, 0); '-' → None."""
    m = SAAT_RE.search(metin)
    if not m:
        return None
    yildiz = max((len(y) for y in re.findall(r'\*+', metin)), default=0)
    return int(m.group(1)) * 60 + int(m.group(2)), metin.lstrip().startswith('('), yildiz


def gun_maskesi(etiket):
    """Tablo başlığındaki gün türü → (Pzt..Paz maskesi, gece mi). Tanınmazsa (None, False)."""
    s = sade(etiket)
    if 'baglayangece' in s:
        return '0000110', True  # cuma ve cumartesi geceleri; saatler ertesi güne taşar
    if 'hergun' in s:
        return HER_GUN, False
    if 'sadecehaftaici' in s:
        return '1111100', False
    if 'haftaicivecumartesi' in s:
        return '1111110', False
    if 'haftaici' in s:
        return '1111100', False
    if 'cumartesipazar' in s:
        return '0000011', False
    if 'cumartesi' in s:
        return '0000010', False
    if 'pazar' in s:
        return '0000001', False
    return None, False


def ve(a, b):
    return ''.join('1' if x == '1' and y == '1' else '0' for x, y in zip(a, b))


def dipnot_etkisi(metin, iskeleler):
    """Dipnot → ('gun', maske) | ('almaz',) | ('bitir', sütun) | ('iskele', 'eski'|'yeni') | ('yok',) | None."""
    s = sade(metin)
    if 'yolcualmaz' in s:
        return ('almaz',)
    if 'bitmektedir' in s or 'bitiyor' in s:
        for j, ad in enumerate(iskeleler):
            if sade(ad) and sade(ad) in s:
                return ('bitir', j)
        return None
    if 'iskelesinden' in s:
        return ('iskele', 'yeni' if 'yeni' in s else 'eski')
    if 'varissaat' in s:
        return ('yok',)
    cmt = 'cumartesi' in s or 'ctesi' in s
    pzr = 'pazar' in s
    if 'yapilmaz' in s and (cmt or pzr):
        return ('gun', '11111' + ('0' if cmt else '1') + ('0' if pzr else '1'))
    if 'yapilir' in s and (cmt or pzr):
        return ('gun', '00000' + ('1' if cmt else '0') + ('1' if pzr else '0'))
    return None


def tablo_coz(tablo):
    """Sitenin tablosu → {'etiket', 'iskeleler', 'satirlar': [[(dk, parantez, yıldız)|None…]…]}."""
    satirlar = tablo['satirlar']
    i, etiket = 0, ''
    if satirlar and len(satirlar[0]) == 1 and not saat_hucresi(hucre_metni(satirlar[0][0])):
        etiket, i = hucre_metni(satirlar[0][0]), 1
    iskeleler = genislet(satirlar[i]) if i < len(satirlar) else []
    i += 1
    if i < len(satirlar) and all(sade(h) in ('kalkis', 'varis') for h in genislet(satirlar[i])):
        i += 1
    saatler = []
    for satir in satirlar[i:]:
        hucreler = genislet(satir)
        if len(hucreler) != len(iskeleler):
            continue
        saatler.append([saat_hucresi(h) for h in hucreler])
    return {'etiket': etiket, 'iskeleler': iskeleler, 'satirlar': saatler}


# ---------- iskele eşleme ----------

def iskele_adi(ad):
    """'Eminönü (K)' → ('eminonu', 'k'); 'Kadıköy(Eski)' → ('kadikoy', 'eski')."""
    m = re.match(r'\s*([^(]*?)\s*(?:\((.*?)\))?\s*$', ad)
    kok, etiket = sade(m.group(1)), sade(m.group(2) or '')
    return AD_ESI.get(kok, kok), etiket


class Iskeleler:
    def __init__(self, tablolar, ajans_id):
        rotalar = {r['route_id'] for r in tablolar['routes.txt'] if r['agency_id'] == ajans_id}
        seferler = {t['trip_id'] for t in tablolar['trips.txt'] if t['route_id'] in rotalar}
        kullanim = collections.Counter(r['stop_id'] for r in tablolar['stop_times.txt'] if r['trip_id'] in seferler)
        self.duraklar = {d['stop_id']: d for d in tablolar['stops.txt']}
        self.adla = collections.defaultdict(list)
        for sid, d in self.duraklar.items():
            if 'ŞH' not in d['stop_name'] or sid.startswith('sh-'):
                continue
            self.adla[sade(re.sub(r'ŞH\.?.*$', '', d['stop_name']))].append(sid)
        for k in self.adla:
            self.adla[k].sort(key=lambda s: -kullanim.get(s, 0))
        self.yeni = {}
        self.bulunamayan = set()
        self.gorunen = {}  # stop_id → sitedeki adı ("Kadıköy"; beslemede "Kadıköy-Beşiktaş ŞH.")

    def bul(self, ad, grup, hat_no, dipnot_iskele=None):
        sid = self._bul(ad, grup, hat_no, dipnot_iskele)
        if sid and sid not in self.gorunen:
            temiz = re.sub(r'\s*\(.*?\)\s*', ' ', ad).strip()
            if temiz.isupper():
                temiz = ' '.join(k[:1] + k[1:].replace('I', 'ı').replace('İ', 'i').lower() for k in temiz.split())
            self.gorunen[sid] = AD_DUZELT.get(temiz, temiz)
        return sid

    def _bul(self, ad, grup, hat_no, dipnot_iskele=None):
        kok, etiket = iskele_adi(ad)
        etiket = dipnot_iskele or etiket
        if kok == 'eminonu':
            return '18908' if grup == 'bogaz-hatlari' else '18936'
        if kok == 'kadikoy':
            return '18915' if etiket == 'yeni' else '18923'
        if kok == 'besiktas':
            return '18940'
        if kok in ('istinye', 'cubuklu') and hat_no == '3598':  # arabalı vapur iskeleleri
            return {'istinye': '87063', 'cubuklu': '87065'}[kok]
        if kok in self.adla:
            return self.adla[kok][0]
        if kok in EK_ISKELELER:
            sid, isim, lat, lon = EK_ISKELELER[kok]
            self.yeni[sid] = {'stop_id': sid, 'stop_name': isim, 'stop_lat': f'{lat:.6f}', 'stop_lon': f'{lon:.6f}',
                              'location_type': '0', 'wheelchair_boarding': '0'}
            return sid
        self.bulunamayan.add(ad)
        return None

    def konum(self, sid):
        d = self.yeni.get(sid) or self.duraklar.get(sid)
        return (float(d['stop_lat']), float(d['stop_lon'])) if d else None

    def ad(self, sid):
        if sid in self.gorunen:
            return self.gorunen[sid]
        d = self.yeni.get(sid) or self.duraklar.get(sid)
        return re.sub(r'\s*ŞH\.?.*$', '', d['stop_name']).strip() if d else ''


# ---------- seferleri kurma ----------

def olaylar(hat, tablo, iskeleler, grup, hat_no, uyarilar):
    """Bir tablonun sefer taslakları: [(maske, [(stop_id, dk, parantez, binilmez)…])…]."""
    maske, gece = gun_maskesi(tablo['etiket'].split('*')[0])
    if maske is None:
        uyarilar.append(f"{hat['ad']}: gün türü anlaşılmadı: {tablo['etiket'][:60]!r} (her gün sayıldı)")
        maske = HER_GUN
    dipnotlar = {}
    for yildiz, metin in re.findall(r'(\*+)\s*([^*]+)', tablo['etiket']):
        etki = dipnot_etkisi(metin, tablo['iskeleler'])
        if etki is None:
            uyarilar.append(f"{hat['ad']}: dipnot anlaşılmadı: {yildiz} {metin.strip()[:60]!r}")
            continue
        dipnotlar[len(yildiz)] = etki
    sonuc = []
    onceki_ilk, ek = None, 0
    for satir in tablo['satirlar']:
        dolu = [(j, h) for j, h in enumerate(satir) if h]
        if not dolu:
            continue
        sefer_maskesi, bitir = maske, None
        for _, (_, _, yildiz) in dolu:
            etki = dipnotlar.get(yildiz)
            if etki and etki[0] == 'gun':
                sefer_maskesi = ve(sefer_maskesi, etki[1])
            if etki and etki[0] == 'bitir':
                bitir = etki[1]
        ilk = dolu[0][1][0] + (1440 if gece and dolu[0][1][0] < 12 * 60 else 0)
        # Gece yarısını geçen satırlar (23:30'dan sonra 00:00) aynı servis gününün devamı.
        if onceki_ilk is not None and ilk + ek < onceki_ilk - 6 * 60:
            ek += 1440
        onceki_ilk = ilk + ek
        durak_saatleri, taban = [], None
        for j, (dk, parantez, yildiz) in dolu:
            if bitir is not None and j > bitir and not parantez:
                continue
            if gece and dk < 12 * 60:
                dk += 1440
            dk += ek
            if taban is not None and dk < taban - 12 * 60:
                dk += 1440
            taban = dk if taban is None else taban
            etki = dipnotlar.get(yildiz)
            sid = iskeleler.bul(tablo['iskeleler'][j], grup, hat_no, etki[1] if etki and etki[0] == 'iskele' else None)
            if sid:
                durak_saatleri.append((sid, dk, parantez, bool(etki and etki[0] == 'almaz')))
        if sefer_maskesi != '0000000':
            sonuc.append((sefer_maskesi, durak_saatleri))
    return sonuc


def sure_tablosu(tum_seferler):
    """Ardışık iki iskele arası yol süresi (dk, ortanca), sütun sırasındaki saatlerden."""
    sureler = collections.defaultdict(list)
    for _, duraklar in tum_seferler:
        duz = [d for d in duraklar if not d[2]]
        for a, b in zip(duz, duz[1:]):
            if 0 < b[1] - a[1] <= 120 and a[0] != b[0]:
                sureler[(a[0], b[0])].append(b[1] - a[1])
    return {k: sorted(v)[len(v) // 2] for k, v in sureler.items()}


def yol_suresi(a, b, sureler, iskeleler):
    if (a, b) in sureler:
        return sureler[(a, b)]
    if (b, a) in sureler:
        return sureler[(b, a)]
    ka, kb = iskeleler.konum(a), iskeleler.konum(b)
    if not ka or not kb:
        return 15
    return max(5, round(4 + mesafe(ka, kb) / 1000 * 2.6))  # ~23 km/sa, yanaşma payıyla


def seferi_duzelt(duraklar, sureler, iskeleler):
    """Sütun sırasındaki saatler artmalı; aynı dakikaya ya da geriye düşen iskeleye yol süresi
    eklenir. Parantezli (önce uğranan) iskeleler sonra saatine göre yerine konur."""
    duz = []
    for sid, dk, parantez, almaz in duraklar:
        if parantez:
            continue
        if duz and dk <= duz[-1][1]:
            dk = duz[-1][1] + yol_suresi(duz[-1][0], sid, sureler, iskeleler)
        duz.append((sid, dk, almaz))
    duz += [(sid, dk, almaz) for sid, dk, parantez, almaz in duraklar if parantez]
    duz.sort(key=lambda x: x[1])
    # Aynı iskele art arda (parantezli uğrama sütundakiyle çakışırsa) tek sefer.
    return [d for i, d in enumerate(duz) if i == 0 or d[0] != duz[i - 1][0]]


def hat_adi_uretilmis(hat):
    """Sayfanın başlığı boşsa gidiş ve dönüş tablolarının ilk iskelelerinden: "İstinye - Çubuklu"."""
    uclar = []
    for yon in ('gidis', 'donus'):
        tablo = next((tablo_coz(t) for t in hat['tablolar'] if t['yon'] == yon), None)
        if tablo and tablo['iskeleler']:
            uc = re.sub(r'\s*\(.*?\)', '', tablo['iskeleler'][0]).strip()
            if uc not in uclar:
                uclar.append(uc)
    return ' - '.join(uclar) or hat['kimlik']


GUN_ADLARI = {'1111111': 'her gün', '1111100': 'hafta içi', '1111110': 'hafta içi+cmt', '0000010': 'cumartesi',
              '0000001': 'pazar', '0000011': 'hafta sonu', '0000110': 'cuma-cmt gecesi', '1111101': 'cmt hariç'}


def main(json_yolu, zip_yolu):
    veri = json.load(io.open(json_yolu, encoding='utf-8'))
    tablolar, alanlar = zip_oku(zip_yolu)
    ajans = next((a for a in tablolar['agency.txt'] if sade(a['agency_name']).startswith('sehirhat')), None)
    if not ajans:
        sys.exit('Beslemede Şehir Hatları ajansı yok.')
    ajans_id = ajans['agency_id']
    iskeleler = Iskeleler(tablolar, ajans_id)

    # 1) Tabloları oku, sefer taslaklarını çıkar.
    uyarilar, taslak = [], []
    for hat in veri.get('hatlar', []):
        hat_no = (re.search(r'(\d+)$', hat['kimlik']) or [None, ''])[1]
        gorulen = set()
        for tablo_ham in hat['tablolar']:
            anahtar = json.dumps(tablo_ham['satirlar'], ensure_ascii=False)
            if anahtar in gorulen:  # Aşiyan ring hattının gidiş ve dönüş tablosu aynı
                continue
            gorulen.add(anahtar)
            tablo = tablo_coz(tablo_ham)
            if not tablo['iskeleler'] or not tablo['satirlar']:
                continue
            seferler = olaylar(hat, tablo, iskeleler, hat.get('grup', ''), hat_no, uyarilar)
            taslak.append((hat, hat_no, tablo_ham['yon'], tablo, seferler))

    sureler = sure_tablosu([s for *_, seferler in taslak for s in seferler])

    # 2) Tek sütunlu tablolar: varış öbür yönün kalkış iskelesi.
    uclar = collections.defaultdict(dict)
    for hat, _, yon, tablo, seferler in taslak:
        if len(tablo['iskeleler']) == 1:
            ilk = next((d[0][0] for _, d in seferler if d), None)
            if ilk:
                uclar[hat['kimlik']][yon] = ilk

    # 3) GTFS'e yaz: Şehir Hatları'nın eski hatları gider, sitenin hatları gelir.
    eski_rotalar = {r['route_id'] for r in tablolar['routes.txt'] if r['agency_id'] == ajans_id or r['route_id'].startswith('sh-')}
    eski_seferler = {t['trip_id'] for t in tablolar['trips.txt'] if t['route_id'] in eski_rotalar}
    rotalar, yeni_seferler, yeni_saatler, servisler = {}, [], [], set()
    sayim = collections.defaultdict(collections.Counter)
    for hat, hat_no, yon, tablo, seferler in taslak:
        rota_id = f"sh-{hat_no or sade(hat['kimlik'])}"
        if rota_id not in rotalar:
            ad = hat['ad'] or hat_adi_uretilmis(hat)
            rotalar[rota_id] = {'route_id': rota_id, 'agency_id': ajans_id, 'route_short_name': HAT_KODU.get(hat_no, ''),
                                'route_long_name': tr_buyuk(re.sub(r'\s+Hattı\s*$', '', ad, flags=re.I)),
                                'route_type': '4', 'route_url': hat.get('adres', '')}
        tek = len(tablo['iskeleler']) == 1
        for maske, duraklar in seferler:
            if tek and duraklar:
                karsi = uclar[hat['kimlik']].get('donus' if yon == 'gidis' else 'gidis')
                if not karsi or karsi == duraklar[0][0]:
                    continue
                sid, dk, _, almaz = duraklar[0]
                duraklar = [(sid, dk, False, almaz), (karsi, dk + yol_suresi(sid, karsi, sureler, iskeleler), False, False)]
            sefer = seferi_duzelt(duraklar, sureler, iskeleler)
            if len(sefer) < 2:
                continue
            servisler.add(maske)
            tid = f"{rota_id}-{yon}-{len(yeni_seferler)}"
            yeni_seferler.append({'route_id': rota_id, 'service_id': f'sh-{maske}', 'trip_id': tid,
                                  'trip_headsign': iskeleler.ad(sefer[-1][0]), 'direction_id': '0' if yon == 'gidis' else '1',
                                  'shape_id': '', 'wheelchair_accessible': '0', 'bikes_allowed': '0'})
            for sira, (sid, dk, almaz) in enumerate(sefer, start=1):
                yeni_saatler.append({'trip_id': tid, 'arrival_time': saat_yaz(dk), 'departure_time': saat_yaz(dk),
                                     'stop_id': sid, 'stop_sequence': str(sira), 'stop_headsign': '',
                                     'pickup_type': '1' if almaz and sira < len(sefer) else '0', 'drop_off_type': '0',
                                     'shape_dist_traveled': '', 'timepoint': '1'})
            sayim[rota_id][maske] += 1

    bugun = datetime.date.today()
    bas, bit = (bugun - datetime.timedelta(days=7)).strftime('%Y%m%d'), (bugun + datetime.timedelta(days=365)).strftime('%Y%m%d')
    gunler = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    tablolar['calendar.txt'] = [c for c in tablolar['calendar.txt'] if not c['service_id'].startswith('sh-')]
    for maske in sorted(servisler):
        tablolar['calendar.txt'].append({'service_id': f'sh-{maske}', **dict(zip(gunler, maske)), 'start_date': bas, 'end_date': bit})

    tablolar['routes.txt'] = [r for r in tablolar['routes.txt'] if r['route_id'] not in eski_rotalar] + list(rotalar.values())
    tablolar['trips.txt'] = [t for t in tablolar['trips.txt'] if t['trip_id'] not in eski_seferler] + yeni_seferler
    tablolar['stop_times.txt'] = [r for r in tablolar['stop_times.txt'] if r['trip_id'] not in eski_seferler] + yeni_saatler
    if 'frequencies.txt' in tablolar:
        tablolar['frequencies.txt'] = [f for f in tablolar['frequencies.txt'] if f['trip_id'] not in eski_seferler]
    tablolar['stops.txt'] = [d for d in tablolar['stops.txt'] if not d['stop_id'].startswith('sh-')] + list(iskeleler.yeni.values())
    if 'route_url' not in alanlar['routes.txt']:
        alanlar['routes.txt'].append('route_url')
    zip_yaz(zip_yolu, tablolar, alanlar)

    print(f"Şehir Hatları tarifesi ({veri.get('indirildi', '?')[:10]} indirildi):")
    for rota_id, r in rotalar.items():
        dagilim = ', '.join(f"{GUN_ADLARI.get(m, m)} {n}" for m, n in sorted(sayim[rota_id].items(), key=lambda x: -x[1]))
        print(f"  {r['route_short_name'] or '?':13} {r['route_long_name'][:46]:46} {sum(sayim[rota_id].values()):4} sefer  ({dagilim})")
    print(f'\n{len(yeni_seferler)} sefer eklendi; eski Şehir Hatları verisinden {len(eski_rotalar)} hat, {len(eski_seferler)} sefer silindi.')
    if iskeleler.yeni:
        print('yeni iskeleler:', ', '.join(d['stop_name'] for d in iskeleler.yeni.values()))
    if iskeleler.bulunamayan:
        print('EŞLEŞMEYEN İSKELELER (seferlerden atlandı):', ', '.join(sorted(iskeleler.bulunamayan)))
    for u in uyarilar:
        print('  uyarı:', u)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('kullanım: python vapur-tarife-uygula.py <vapur-tarife.json> <ray-vapur-gtfs.zip>')
    main(sys.argv[1], sys.argv[2])
