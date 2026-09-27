# Vapur seferlerine denizden giden çizgi verir.
#
# Sorun: Şehir Hatları, Turyol ve Dentur seferleri tarifelerden yeniden kurulduğu için
# shape_id'leri boş. OTP o zaman iskeleleri düz çizgiyle birleştiriyor; Eminönü–Kadıköy
# Sarayburnu'nu, Üsküdar–Kadıköy Harem'i, Haliç hattı Kasımpaşa'yı, Boğaz'daki bazı
# bacaklar burunları kesiyor.
#
# Yöntem: OSM'deki kıyı çizgisinden (natural=coastline) 40 metrelik bir deniz ızgarası
# kuruluyor: kıyı hücreleri duvar, deniz Marmara'daki ve Boğaz'daki tohumlardan
# doldurulan bölge. İki ardışık iskele arası:
#   - düz çizgi baştan sona denizden geçiyorsa düz çizgi (karşıya geçişler, Adalar);
#   - geçmiyorsa ızgarada en kısa deniz yolu (A*), sonra "ip çekme" ile sadeleştirilip
#     birkaç köşeli, doğal bir rota.
# İskele karada bir nokta: en yakın deniz hücresine bağlanıyor (en fazla 600 m).
#
# Güvenlik ağı: doldurma karaya sızarsa (kıyı çizgisinde kopukluk) bilinen kara noktaları
# deniz çıkar; o zaman hiçbir şey yazılmıyor. Yol bulunamayan bacak düz kalıyor. Çizgisi
# zaten olan seferlere dokunulmuyor.
#
# Kullanım:
#   python vapur-cizgi.py cikar C:\otp\istanbul\Istanbul.osm.pbf C:\otp\osm-kiyi.json   (osmium gerekir, bir kez)
#   python vapur-cizgi.py ekle C:\otp\osm-kiyi.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import collections, csv, heapq, io, json, math, shutil, sys, zipfile

csv.field_size_limit(10 ** 7)

# Izgaranın kapsadığı alan: bütün vapur iskeleleri (Tuzla'dan Rumeli Kavağı'na).
KUTU = (40.78, 41.26, 28.60, 29.36)
# Kesin deniz noktaları: doldurma buradan başlıyor (Marmara, Boğaz ortası).
TOHUMLAR = [(40.93, 28.95), (41.10, 29.06)]
# Kesin kara noktaları: deniz çıkarlarsa kıyı çizgisi kopuk, sonuç güvenilmez.
KARA = [(41.037, 28.985), (40.99, 29.035), (40.862, 29.12), (41.06, 29.02), (41.0, 28.93)]


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


# ---------- OSM'den çıkarma ----------

def cikar(pbf, cikti):
    import osmium

    class Toplayici(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.kiyi = []

        def way(self, w):
            if w.tags.get('natural') != 'coastline':
                return
            try:
                self.kiyi.append([(round(n.lat, 6), round(n.lon, 6)) for n in w.nodes])
            except osmium.InvalidLocationError:
                pass

    t = Toplayici()
    t.apply_file(pbf, locations=True, idx='flex_mem')
    json.dump({'kiyi': t.kiyi}, open(cikti, 'w', encoding='utf-8'))
    print(f'{len(t.kiyi)} kıyı çizgisi ({sum(len(c) for c in t.kiyi)} nokta) → {cikti}')


# ---------- deniz ızgarası ----------

HUCRE = 40  # metre

class DenizIzgarasi:
    """Kıyı çizgisinden deniz maskesi; iskeleler arası deniz yolu."""
    def __init__(self, kiyi, kutu, tohumlar, kara_noktalari):
        self.lat0, self.lat1, self.lon0, self.lon1 = kutu
        orta = math.radians((self.lat0 + self.lat1) / 2)
        self.dlat = HUCRE / 111320.0
        self.dlon = HUCRE / (111320.0 * math.cos(orta))
        self.en = int((self.lon1 - self.lon0) / self.dlon) + 1
        self.boy = int((self.lat1 - self.lat0) / self.dlat) + 1
        n = self.en * self.boy
        duvar = bytearray(n)
        for c in kiyi:
            for a, b in zip(c, c[1:]):
                self._cizgi(duvar, a, b)
        # Çapraz sızmayı önlemek için duvarı bir hücre kalınlaştır (4-komşu).
        kalin = bytearray(duvar)
        E = self.en
        for i in range(n):
            if duvar[i]:
                x = i % E
                if x > 0: kalin[i - 1] = 1
                if x < E - 1: kalin[i + 1] = 1
                if i >= E: kalin[i - E] = 1
                if i + E < n: kalin[i + E] = 1
        self.duvar = kalin
        # Denizi tohumlardan doldur.
        deniz = bytearray(n)
        kuyruk = collections.deque()
        for t in tohumlar:
            i = self.indeks(*t)
            if i is not None and not kalin[i]:
                deniz[i] = 1
                kuyruk.append(i)
        while kuyruk:
            i = kuyruk.popleft()
            x = i % E
            for j in (i - 1 if x > 0 else -1, i + 1 if x < E - 1 else -1, i - E, i + E):
                if 0 <= j < n and not deniz[j] and not kalin[j]:
                    deniz[j] = 1
                    kuyruk.append(j)
        self.deniz = deniz
        self.sizinti = [p for p in kara_noktalari if self.indeks(*p) is not None and deniz[self.indeks(*p)]]

    def indeks(self, lat, lon):
        x = int((lon - self.lon0) / self.dlon)
        y = int((lat - self.lat0) / self.dlat)
        if 0 <= x < self.en and 0 <= y < self.boy:
            return y * self.en + x
        return None

    def konum(self, i):
        y, x = divmod(i, self.en)
        return (self.lat0 + (y + 0.5) * self.dlat, self.lon0 + (x + 0.5) * self.dlon)

    def _cizgi(self, duvar, a, b):
        ia, ib = self.indeks(*a), self.indeks(*b)
        ax, ay = (a[1] - self.lon0) / self.dlon, (a[0] - self.lat0) / self.dlat
        bx, by = (b[1] - self.lon0) / self.dlon, (b[0] - self.lat0) / self.dlat
        adim = int(max(abs(bx - ax), abs(by - ay)) * 2) + 1
        for k in range(adim + 1):
            x = int(ax + (bx - ax) * k / adim); y = int(ay + (by - ay) * k / adim)
            if 0 <= x < self.en and 0 <= y < self.boy:
                duvar[y * self.en + x] = 1

    def en_yakin_deniz(self, lat, lon, yaricap=600):
        i = self.indeks(lat, lon)
        if i is None: return None
        if self.deniz[i]: return i
        r = int(yaricap / HUCRE)
        y0, x0 = divmod(i, self.en)
        en_iyi, em = None, math.inf
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                x, y = x0 + dx, y0 + dy
                if 0 <= x < self.en and 0 <= y < self.boy and self.deniz[y * self.en + x]:
                    m = dx * dx + dy * dy
                    if m < em: en_iyi, em = y * self.en + x, m
        return en_iyi

    def gorunur(self, i, j):
        """İki hücre arası düz çizgi hep denizden mi."""
        yi, xi = divmod(i, self.en); yj, xj = divmod(j, self.en)
        adim = max(abs(xj - xi), abs(yj - yi)) * 2 + 1
        for k in range(adim + 1):
            x = round(xi + (xj - xi) * k / adim); y = round(yi + (yj - yi) * k / adim)
            if not self.deniz[y * self.en + x]:
                return False
        return True

    def yol(self, a, b):
        s, t = self.en_yakin_deniz(*a), self.en_yakin_deniz(*b)
        if s is None or t is None: return None
        E, n = self.en, len(self.deniz)
        ty, tx = divmod(t, E)
        def h(i):
            y, x = divmod(i, E); dx, dy = abs(x - tx), abs(y - ty)
            return (dx + dy) + (1.4142 - 2) * min(dx, dy)
        g = {s: 0.0}; onceki = {}
        kuyruk = [(h(s), s)]
        kapali = set()
        while kuyruk:
            _, i = heapq.heappop(kuyruk)
            if i == t: break
            if i in kapali: continue
            kapali.add(i)
            y, x = divmod(i, E)
            for dx, dy, m in ((1,0,1),(-1,0,1),(0,1,1),(0,-1,1),(1,1,1.4142),(1,-1,1.4142),(-1,1,1.4142),(-1,-1,1.4142)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < E and 0 <= ny < self.boy): continue
                j = ny * E + nx
                if not self.deniz[j]: continue
                yeni = g[i] + m
                if yeni < g.get(j, math.inf):
                    g[j] = yeni; onceki[j] = i
                    heapq.heappush(kuyruk, (yeni + h(j), j))
        if t not in g: return None
        hucreler = [t]
        while hucreler[-1] in onceki: hucreler.append(onceki[hucreler[-1]])
        hucreler.reverse()
        # İp çekme: görünen en uzak hücreye atla.
        sade = [hucreler[0]]; k = 0
        while k < len(hucreler) - 1:
            j = len(hucreler) - 1
            while j > k + 1 and not self.gorunur(hucreler[k], hucreler[j]):
                j -= 1
            sade.append(hucreler[j]); k = j
        return [tuple(a)] + [self.konum(i) for i in sade] + [tuple(b)]


# ---------- GTFS ----------

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


def bacak_ciz(izgara, a, b):
    """(nokta listesi, nasıl) — nasıl: 'duz' (açık deniz) | 'deniz' (kıyıyı dolanan) | 'yok'."""
    i, j = izgara.en_yakin_deniz(*a), izgara.en_yakin_deniz(*b)
    if i is None or j is None:
        return [a, b], 'yok'
    if izgara.gorunur(i, j):
        return [a, b], 'duz'
    yol = izgara.yol(a, b)
    return (yol, 'deniz') if yol else ([a, b], 'yok')


def ekle(json_yolu, zip_yolu):
    kiyi = json.load(open(json_yolu, encoding='utf-8')).get('kiyi') or []
    if not kiyi:
        print('UYARI: dosyada kıyı çizgisi yok; `cikar` adımını yeniden çalıştır. Vapur çizgileri eklenmedi.')
        return
    izgara = DenizIzgarasi(kiyi, KUTU, TOHUMLAR, KARA)
    if izgara.sizinti:
        print(f'UYARI: deniz ızgarası karaya sızdı ({izgara.sizinti}); kıyı çizgisi kopuk olabilir. '
              'Vapur çizgileri eklenmedi.')
        return
    tablolar, alanlar = zip_oku(zip_yolu)
    vapur = {r['route_id'] for r in tablolar['routes.txt'] if r['route_type'] in ('4', '1200')}
    seferler = [t for t in tablolar['trips.txt'] if t['route_id'] in vapur and not t.get('shape_id')]
    istenen = {t['trip_id'] for t in seferler}
    diziler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        if r['trip_id'] in istenen:
            diziler[r['trip_id']].append(r)
    konum = {d['stop_id']: (float(d['stop_lat']), float(d['stop_lon'])) for d in tablolar['stops.txt']}

    bacak_onbellek, cizgiler = {}, {}
    sayim = collections.Counter()
    yeni_noktalar = []
    for t in seferler:
        dizi = [r['stop_id'] for r in sorted(diziler[t['trip_id']], key=lambda r: int(r['stop_sequence']))]
        if len(dizi) < 2 or any(s not in konum for s in dizi):
            continue
        anahtar = tuple(dizi)
        if anahtar not in cizgiler:
            noktalar = []
            for a, b in zip(dizi, dizi[1:]):
                if (a, b) not in bacak_onbellek:
                    if a != b:
                        cizgi, nasil = bacak_ciz(izgara, konum[a], konum[b])
                    else:
                        cizgi, nasil = [konum[a], konum[b]], 'duz'
                    bacak_onbellek[(a, b)] = (cizgi, nasil)
                    sayim[nasil] += 1
                parca = bacak_onbellek[(a, b)][0]
                noktalar.extend(parca if not noktalar else parca[1:])
            cizgi_id = f'vc-{len(cizgiler) + 1}'
            cizgiler[anahtar] = cizgi_id
            for i, (en, boy) in enumerate(noktalar, start=1):
                yeni_noktalar.append({'shape_id': cizgi_id, 'shape_pt_lat': f'{en:.6f}', 'shape_pt_lon': f'{boy:.6f}',
                                      'shape_pt_sequence': str(i), 'shape_dist_traveled': ''})
        t['shape_id'] = cizgiler[anahtar]

    tablolar['shapes.txt'] = [s for s in tablolar.get('shapes.txt', []) if not s['shape_id'].startswith('vc-')] + yeni_noktalar
    if 'shapes.txt' not in alanlar or not alanlar['shapes.txt']:
        alanlar['shapes.txt'] = ['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled']
    zip_yaz(zip_yolu, tablolar, alanlar)
    print(f'{len(seferler)} vapur seferine {len(cizgiler)} çizgi verildi.')
    print(f"iskele arası bacak: {sayim['duz']} düz (açık deniz), {sayim['deniz']} kıyıyı dolanan, "
          f"{sayim['yok']} deniz yolu bulunamayan (düz kaldı)")
    return bacak_onbellek, konum


if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == 'cikar':
        cikar(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == 'ekle':
        ekle(sys.argv[2], sys.argv[3])
    else:
        sys.exit('kullanım: python vapur-cizgi.py cikar <pbf> <json> | ekle <json> <gtfs.zip>')
