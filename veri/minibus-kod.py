# Minibüs hatlarına İBB'nin resmî hat kodunu (A43, C117, BL323, ŞL04, SRY/07…) yazar.
#
# Sorun: raylı beslemedeki minibüs hatlarının "kısa adı" güzergâhın kendisi ("AVCILAR -
# BAĞLARÇEŞME"); kod yok. Uygulama bu yüzden rozete yalnız "Minibüs" yazıyordu. İBB'nin
# açık veri portalındaki "Minibüs Hatları Verisi" her güzergâhın kodunu (HATNO), hat adını ve
# çizgisini veriyor; ama beslemeyle ortak bir kimlik yok, eşleme bizde.
#
# Eşleme (hat hat): beslemedeki hattın en uzun seferinin durakları ile her kodun güzergâh
# çizgileri ve adları karşılaştırılır.
#   yakınlık  durakların ne kadarı o kodun çizgilerinden birine ~150 m yakın (100 m'lik
#             ızgara: durağın gözü ya da komşusu çizginin geçtiği bir göz mü)
#   ad        beslemedeki güzergâh adının kodun güzergâh / hat adlarına benzerliği
#   puan      yakınlık × 0,6 + ad × 0,4; en iyi kod ikinciden en az 0,04 önde olmalı
# Kabul: (yakınlık ≥ 0,8 ve ad ≥ 0,5) ya da (yakınlık ≥ 0,65 ve ad ≥ 0,75) ya da
# (yakınlık ≥ 0,95 ve ad ≥ 0,35). Tutmayan hat eskisi gibi "Minibüs" kalır: yanlış kod
# göstermek koddan hiç göstermemekten kötü. Taksi dolmuşların kodu yok, dokunulmaz.
#
# Kabul edilen hatta: route_short_name = kod, route_long_name = güzergâh (eski kısa ad).
# Aynı kodun birden çok güzergâhı olabiliyor (A43: Avcılar–Kıraç, Avcılar–Bağlarçeşme…);
# uygulama güzergâhı uzun addan gösterir, sıklık verisi (siklik-cikar.py) kod + güzergâhla.
#
# Kullanım (eksik-hatlar.py'den sonra, siklik-cikar.py'den önce):
#   python minibus-kod.py C:\otp\minibus-hatlari.geojson C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
#   python minibus-kod.py --indir C:\otp\minibus-hatlari.geojson <zip>   önce İBB'den indir
# Yeniden çalıştırılabilir: özgün adlar route_desc'te saklanır, ikinci çalıştırma onları kullanır.

import collections, csv, difflib, io, json, math, os, re, shutil, sys, urllib.request, zipfile

csv.field_size_limit(10 ** 7)

KAYNAK = ('https://data.ibb.gov.tr/dataset/8dad4995-0071-44de-9b14-57288ec1de97/resource/'
          '9083216b-7afd-4eae-a242-cf5b09f748f4/download/istanbul_minibus_guzergahlari.geojson')
MINIBUS_AJANS = 'minibus'
ETIKET = 'minibus-kod:'
GOZ = 100.0          # ızgara gözü, metre
ADIM = 40.0          # çizgi bu aralıkla örneklenir


def sade(a):
    a = (a or '').replace('İ', 'i').replace('I', 'ı').lower()
    for k, v in {'ı': 'i', 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u'}.items():
        a = a.replace(k, v)
    a = re.sub(r'^\s*\d+\s*\.?\s*guzergah\s*(adi)?\s*:?', '', a)
    a = re.sub(r'sry\s*/\s*\d+', '', a)
    a = re.sub(r'\(.*?\)', '', a)
    a = re.sub(r'[^a-z0-9]+', ' ', a)
    a = re.sub(r'\b(mah|mahallesi|mh|cad|caddesi|cd|metro|metrobus|son|durak|sk|sokak|ve|guzergah|ring)\b', ' ', a)
    return ' '.join(a.split())


def benzerlik(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def goz(lat, lon):
    return (int(lon * 111320 * math.cos(math.radians(41.0)) // GOZ), int(lat * 110540 // GOZ))


def kodlari_oku(yol):
    """Kod → {gözler, güzergâh adları, hat adları}. SRY kodları güzergâh adından (SRY/07)."""
    kodlar = collections.defaultdict(lambda: {'gozler': set(), 'guz': set(), 'ad': set()})
    for f in json.load(io.open(yol, encoding='utf-8'))['features']:
        p = f['properties']
        kod = (p.get('HATNO') or '').strip()
        if kod.upper() == 'SRY':
            m = re.match(r'\s*SRY\s*/\s*(\d+)', p.get('GUZERGAH') or '')
            kod = f'SRY/{m.group(1)}' if m else ''
        if not kod:
            continue
        g = f['geometry']
        parcalar = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        k = kodlar[kod]
        for parca in parcalar:
            for (x1, y1), (x2, y2) in zip(parca, parca[1:]):
                m = math.dist((x1 * 84000, y1 * 111000), (x2 * 84000, y2 * 111000))
                n = max(1, int(m // ADIM))
                for i in range(n + 1):
                    gx, gy = goz(y1 + (y2 - y1) * i / n, x1 + (x2 - x1) * i / n)
                    k['gozler'].add((gx, gy))
        k['guz'].add(sade(p.get('GUZERGAH')))
        k['ad'].add(sade(p.get('HAT_ADI')))
    return kodlar


def yakin_mi(g, gozler):
    gx, gy = g
    return any((gx + dx, gy + dy) in gozler for dx in (-1, 0, 1) for dy in (-1, 0, 1))


def geri_al(r, guzergah, eski_uzun):
    """Önceki çalıştırmada kod yazılmış ama artık eşleşmeyen hat: özgün adlarına döner."""
    if (r.get('route_desc') or '').startswith(ETIKET):
        r['route_short_name'], r['route_long_name'], r['route_desc'] = guzergah, eski_uzun, ''


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


def main(geojson, zip_yolu):
    kodlar = kodlari_oku(geojson)
    tablolar, alanlar = zip_oku(zip_yolu)
    ajanslar = {a['agency_id'] for a in tablolar['agency.txt'] if MINIBUS_AJANS in a['agency_name'].lower()}
    rotalar = {r['route_id']: r for r in tablolar['routes.txt'] if r['agency_id'] in ajanslar}
    konum = {s['stop_id']: goz(float(s['stop_lat']), float(s['stop_lon'])) for s in tablolar['stops.txt']}
    seferler = {t['trip_id']: t['route_id'] for t in tablolar['trips.txt'] if t['route_id'] in rotalar}
    diziler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        if r['trip_id'] in seferler:
            diziler[r['trip_id']].append(r['stop_id'])
    duraklar = {}
    for tid, liste in diziler.items():
        rid = seferler[tid]
        if len(liste) > len(duraklar.get(rid, [])):
            duraklar[rid] = liste

    if 'route_desc' not in alanlar['routes.txt']:
        alanlar['routes.txt'].append('route_desc')
    sayac = collections.Counter()
    for rid, r in rotalar.items():
        # Yeniden çalıştırmada özgün adlar route_desc'te.
        if (r.get('route_desc') or '').startswith(ETIKET):
            guzergah, eski_uzun = json.loads(r['route_desc'][len(ETIKET):])
        else:
            guzergah, eski_uzun = r['route_short_name'], r['route_long_name']
        gozler = [konum[s] for s in duraklar.get(rid, []) if s in konum]
        if not gozler:
            sayac['durağı yok'] += 1
            continue
        kisa, uzun = sade(guzergah), sade(eski_uzun)
        adaylar = []
        for kod, k in kodlar.items():
            yakinlik = sum(1 for g in gozler if yakin_mi(g, k['gozler'])) / len(gozler)
            if yakinlik < 0.3:
                continue
            ad = max([benzerlik(kisa, g) for g in k['guz']] + [benzerlik(kisa, a) for a in k['ad']] +
                     [benzerlik(uzun, a) * 0.9 for a in k['ad']])
            adaylar.append((yakinlik * 0.6 + ad * 0.4, yakinlik, ad, kod))
        adaylar.sort(reverse=True)
        if not adaylar:
            sayac['eşleşmedi'] += 1
            geri_al(r, guzergah, eski_uzun)
            continue
        puan, yakinlik, ad, kod = adaylar[0]
        fark = puan - (adaylar[1][0] if len(adaylar) > 1 else 0)
        kabul = fark >= 0.04 and ((yakinlik >= 0.8 and ad >= 0.5) or (yakinlik >= 0.65 and ad >= 0.75) or
                                  (yakinlik >= 0.95 and ad >= 0.35))
        if not kabul:
            sayac['eşleşmedi'] += 1
            geri_al(r, guzergah, eski_uzun)
            continue
        r['route_desc'] = ETIKET + json.dumps([guzergah, eski_uzun], ensure_ascii=False)
        r['route_short_name'] = kod
        # Bazı hatların kısa adı yalnız "1.GÜZERGAH": o zaman güzergâh için özgün uzun ad.
        r['route_long_name'] = eski_uzun if re.fullmatch(r'\s*\d*\s*\.?\s*güzergah\s*', guzergah, re.I) else guzergah
        sayac['kod yazıldı'] += 1
    zip_yaz(zip_yolu, tablolar, alanlar)
    print(f"Minibüs hat kodları ({len(kodlar)} kod, {len(rotalar)} minibüs hattı): " +
          ', '.join(f'{k}: {v}' for k, v in sayac.most_common()))


if __name__ == '__main__':
    argumanlar = [a for a in sys.argv[1:] if a != '--indir']
    if len(argumanlar) != 2:
        sys.exit('kullanım: python minibus-kod.py [--indir] <minibus-hatlari.geojson> <ray-vapur-gtfs.zip>')
    geojson, zip_yolu = argumanlar
    if '--indir' in sys.argv:
        try:
            with urllib.request.urlopen(KAYNAK, timeout=120) as cevap:
                veri = cevap.read()
            json.loads(veri)
            with open(geojson + '.yeni', 'wb') as f:
                f.write(veri)
            os.replace(geojson + '.yeni', geojson)
            print(f'İBB minibüs hatları indirildi ({len(veri) // 1024} KB)')
        except Exception as e:
            if not os.path.exists(geojson):
                sys.exit(f'İBB minibüs hatları indirilemedi ve önceki dosya yok: {e}')
            print(f'UYARI: İBB minibüs hatları indirilemedi ({e}); önceki dosya kullanılıyor')
    main(geojson, zip_yolu)
