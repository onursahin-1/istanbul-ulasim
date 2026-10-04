# İETT seferlerinin ara durak saatlerini ve süresini, otobüslerin gerçekte ölçülen yol
# süreleriyle yeniden kurar.
#
# Sorun: İETT tarifesinde bir seferin yalnız ilk ve son durağının saati var; aradaki
# duraklar boş. OTP bunları mesafeye göre eşit dağıtıyor: trafikteki ana cadde ile boş
# sokak aynı hızda geçiliyor sayılıyor. Üstelik uç saatler planlanmış süre: sabah
# yoğunluğunda 41ST, 50M, 97M gibi hatlarda otobüsler tarifeden ~%30 yavaş (köprünün
# ölçümü). Rota motoru bu yüzden Moovit'in 1 sa 9 dk dediği yolculuğa 45 dk diyordu.
#
# Çözüm: canlı veri köprüsü (kopru/) her gün binlerce otobüsün iki durak arası gerçek
# süresini ölçüyor (kopru/segment.mjs → kopru/kayit/segment-sureleri.json). Süreler saat
# dilimine (00–06, 06–10, 10–16, 16–20, 20–24) ve hafta içi / hafta sonuna göre ayrı.
#
# Kural:
#   • Seferin İETT'deki kalkış saati (ilk durak) olduğu gibi kalır: otobüs garajdan o
#     saatte çıkıyor.
#   • Her durak arası: ölçüm varsa ölçülen süre. Yoksa tarifenin o aradaki süresi (uç
#     saatlerin mesafeye göre bölüşümü), seferin ölçülen kısımlarındaki "gerçek / tarife"
#     oranıyla düzeltilmiş. Ölçülen kısım seferin küçük bir parçasıysa oran 1'e çekilir
#     (az ölçüme fazla güvenilmesin) ve 0,7–1,8 aralığında tutulur.
#   • Böylece ara duraklar yolun gerçek akışına göre dağılıyor VE seferin toplam süresi
#     gerçekçi oluyor (yoğun saatte uzun, gece kısa). Son durak saati de buna göre değişir.
#   • Durak çiftinin o saat dilimi için yeterli ölçümü (en az 4) yoksa aynı gün türünün
#     öbür dilimlerinin ortalaması kullanılır.
#
# Özgün tarife korunur: betik her çalıştığında İETT'nin boş ara saatli özgün zip'inden
# başlar. İlk çalışmada (zip İBB'den yeni gelmişken) özgünün bir kopyası
# `C:\otp\iett-gtfs-ozgun.zip`'e yazılır (OTP'nin okuduğu istanbul klasörünün dışına:
# orada ikinci bir besleme sayılırdı). Sonraki çalışmalar oradan başlar; köprü yeni ölçüm
# topladıkça betik yeniden çalıştırılabilir.
#
# Kullanım:
#   python iett-sure-uygula.py C:\otp\istanbul\istanbul-iett-gtfs.zip ..\kopru\kayit\segment-sureleri.json
# Sonra OTP grafiği yeniden derlenmeli.

import csv, io, json, math, os, shutil, sys, time, zipfile

EN_AZ_OLCUM = 4          # kopru/segment.mjs ile aynı eşik
EN_KISA_SN = 10          # iki durak arası en az bu kadar
DILIMLER = [(0, 6), (6, 10), (10, 16), (16, 20), (20, 24)]
GUVEN_PAYI = 0.3         # seferin bu kadarı ölçülmüşse oran tam kullanılır
ORAN_ALT, ORAN_UST = 0.7, 1.8


def dilim_no(saniye):
    saat = (saniye // 3600) % 24
    for i, (bas, bit) in enumerate(DILIMLER):
        if bas <= saat < bit:
            return i
    return 0


def saniye_oku(metin):
    if not metin:
        return None
    s, d, n = metin.split(':')
    return int(s) * 3600 + int(d) * 60 + int(n)


def saniye_yaz(sn):
    return f'{sn // 3600:02d}:{(sn % 3600) // 60:02d}:{sn % 60:02d}'


def mesafe(a, b):
    if a is None or b is None:
        return 0.0
    olcek = math.cos(math.radians(a[0]))
    return math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * olcek)


def tablo(z, ad):
    return csv.DictReader(io.TextIOWrapper(z.open(ad), encoding='utf-8-sig'))


def ogrenilenleri_oku(yol):
    """'A>B|i2' → ortalama saniye (yalnız yeterli ölçümlüler) ve gün türü başına dilim ortalaması."""
    with open(yol, encoding='utf-8') as f:
        kayit = json.load(f).get('kayit', {})
    tam = {}
    yedek_toplam = {}
    for anahtar, (sayi, toplam) in kayit.items():
        if sayi <= 0:
            continue
        cift, dilim = anahtar.rsplit('|', 1)
        if sayi >= EN_AZ_OLCUM:
            tam[anahtar] = toplam / sayi
        y = yedek_toplam.setdefault(f'{cift}|{dilim[0]}', [0.0, 0.0])
        y[0] += sayi
        y[1] += toplam
    yedek = {k: t / s for k, (s, t) in yedek_toplam.items() if s >= EN_AZ_OLCUM}
    return tam, yedek


def ara_saatleri_bos_mu(zip_yolu):
    """İBB'den yeni gelmiş zip mi: ilk seferde saati boş ara durak var mı."""
    with zipfile.ZipFile(zip_yolu) as z:
        okuyucu = csv.reader(io.TextIOWrapper(z.open('stop_times.txt'), encoding='utf-8-sig'))
        baslik = next(okuyucu)
        v = baslik.index('arrival_time')
        for n, satir in enumerate(okuyucu):
            if n > 200:
                return False
            if len(satir) > v and not satir[v]:
                return True
    return False


def main(zip_yolu, sure_yolu):
    basla = time.time()
    ozgun = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(zip_yolu))), 'iett-gtfs-ozgun.zip')
    if ara_saatleri_bos_mu(zip_yolu):
        shutil.copyfile(zip_yolu, ozgun)
        kaynak = ozgun
        print(f'Özgün tarife saklandı: {ozgun}')
    elif os.path.exists(ozgun):
        kaynak = ozgun
        print(f'Özgün tarifeden başlanıyor: {ozgun}')
    else:
        raise SystemExit(
            f'{zip_yolu} daha önce işlenmiş, özgün tarife ({ozgun}) yok. '
            'Önce veriyi yenile (yenile.ps1) ya da yedekteki özgün zip\'i oraya kopyala.')

    tam, yedek = ogrenilenleri_oku(sure_yolu)
    print(f'Öğrenilen süre: {len(tam)} durak çifti-dilim, {len(yedek)} gün türü yedeği')

    with zipfile.ZipFile(kaynak) as z:
        duraklar = {s['stop_id']: (float(s['stop_lat']), float(s['stop_lon'])) for s in tablo(z, 'stops.txt')}
        hafta_ici = {}
        for c in tablo(z, 'calendar.txt'):
            hafta_ici[c['service_id']] = any(c[g] == '1' for g in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday'))
        sefer_gun = {t['trip_id']: ('i' if hafta_ici.get(t['service_id'], True) else 'h') for t in tablo(z, 'trips.txt')}

    sayac = {'sefer': 0, 'doldurulan': 0, 'ogrenilen': 0, 'yedek': 0, 'tarife': 0,
             'sure_tarife': 0, 'sure_yeni': 0}

    def sure(a, b, gun, an):
        cift = f'{a}>{b}'
        d = tam.get(f'{cift}|{gun}{dilim_no(an)}')
        if d is not None:
            return d, 'ogrenilen'
        d = yedek.get(f'{cift}|{gun}')
        if d is not None:
            return d, 'yedek'
        return None, 'tarife'

    def seferi_kur(satirlar, gun):
        """satirlar: [ [trip_id, stop_id, seq, arr, dep, timepoint], ... ] (sıralı). Yerinde kurar."""
        capalar = [i for i, r in enumerate(satirlar) if r[3] or r[4]]
        if len(capalar) < 2:
            return
        for i in capalar:
            satirlar[i][5] = '1'
        son_capa = capalar[-1]
        kayma = 0  # önceki aralıkta son saatin tarifeden ne kadar kaydığı
        for i, j in zip(capalar, capalar[1:]):
            t0 = saniye_oku(satirlar[i][4] or satirlar[i][3])
            t1 = saniye_oku(satirlar[j][3] or satirlar[j][4])
            if t0 is None or t1 is None or t1 <= t0:
                continue
            bas = t0 + kayma
            yol = [mesafe(duraklar.get(satirlar[k][1]), duraklar.get(satirlar[k + 1][1])) for k in range(i, j)]
            toplam_yol = sum(yol) or 1.0
            tarife = [(t1 - t0) * m / toplam_yol for m in yol]
            # Dilim için kabaca geçiş anı (tarifeye göre).
            gecis, an = [], float(bas)
            for d in tarife:
                gecis.append(an)
                an += d
            olculen, turler = [], []
            for n, k in enumerate(range(i, j)):
                d, tur = sure(satirlar[k][1], satirlar[k + 1][1], gun, int(gecis[n]))
                olculen.append(d)
                turler.append(tur)
            bilinen_tarife = sum(t for t, d in zip(tarife, olculen) if d is not None)
            bilinen_olcum = sum(d for d in olculen if d is not None)
            oran = 1.0
            if bilinen_tarife > 0:
                ham = bilinen_olcum / bilinen_tarife
                agirlik = min(1.0, (bilinen_tarife / (t1 - t0)) / GUVEN_PAYI)
                oran = min(ORAN_UST, max(ORAN_ALT, 1 + (ham - 1) * agirlik))
            sureler = [d if d is not None else t * oran for d, t in zip(olculen, tarife)]
            if j != son_capa:
                # Ara bir çapa (İETT'de nadir): o saat korunur, aradaki süre ona sığdırılır.
                olcek = (t1 - bas) / (sum(sureler) or 1.0)
                sureler = [d * olcek for d in sureler]
            an = float(bas)
            for n, k in enumerate(range(i + 1, j + 1)):
                an += max(sureler[n], EN_KISA_SN)
                if k == j and j != son_capa:
                    yeni = t1
                else:
                    yeni = int(round(an))
                metin = saniye_yaz(yeni)
                satirlar[k][3] = metin
                satirlar[k][4] = metin
                if k != j:
                    sayac['doldurulan'] += 1
            if j == son_capa:
                sayac['sure_tarife'] += t1 - saniye_oku(satirlar[capalar[0]][4] or satirlar[capalar[0]][3])
                sayac['sure_yeni'] += saniye_oku(satirlar[j][3]) - saniye_oku(satirlar[capalar[0]][4] or satirlar[capalar[0]][3])
            kayma = (saniye_oku(satirlar[j][3]) - t1) if j == son_capa else 0
            for t in turler:
                sayac[t] += 1

    gecici = zip_yolu + '.gecici'
    with zipfile.ZipFile(kaynak) as eski, zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as yeni:
        for bilgi in eski.infolist():
            if bilgi.filename != 'stop_times.txt':
                yeni.writestr(bilgi, eski.read(bilgi.filename))
        okuyucu = csv.reader(io.TextIOWrapper(eski.open('stop_times.txt'), encoding='utf-8-sig'))
        baslik = next(okuyucu)
        sutun = {ad: n for n, ad in enumerate(baslik)}
        gerekli = ['trip_id', 'stop_id', 'stop_sequence', 'arrival_time', 'departure_time', 'timepoint']
        if any(ad not in sutun for ad in gerekli):
            raise SystemExit(f'stop_times.txt beklenen sütunları içermiyor: {baslik}')
        sira = [sutun[ad] for ad in gerekli]
        with yeni.open('stop_times.txt', 'w') as hedef_ham:
            hedef = io.TextIOWrapper(hedef_ham, encoding='utf-8', newline='')
            yazici = csv.writer(hedef, lineterminator='\n')
            yazici.writerow(gerekli)
            gorulen = set()
            mevcut, satirlar = None, []

            def bosalt():
                if not satirlar:
                    return
                if mevcut in gorulen:
                    raise SystemExit(f'stop_times.txt sefere göre sıralı değil ({mevcut} iki kez geçiyor)')
                gorulen.add(mevcut)
                satirlar.sort(key=lambda r: int(r[2]))
                seferi_kur(satirlar, sefer_gun.get(mevcut, 'i'))
                yazici.writerows(satirlar)
                sayac['sefer'] += 1

            for ham in okuyucu:
                r = [ham[n] if n < len(ham) else '' for n in sira]
                if r[0] != mevcut:
                    bosalt()
                    mevcut, satirlar = r[0], []
                satirlar.append(r)
            bosalt()
            hedef.flush()
            hedef.detach()
    shutil.move(gecici, zip_yolu)

    parca = sayac['ogrenilen'] + sayac['yedek'] + sayac['tarife']
    yuzde = lambda x: f'%{100 * x / parca:.1f}' if parca else '-'
    print(f"{sayac['sefer']} sefer, {sayac['doldurulan']} ara durak saati ({time.time() - basla:.0f} sn)")
    print(f"Durak arası süreler: ölçülen {yuzde(sayac['ogrenilen'])}, ölçülen (başka dilim) {yuzde(sayac['yedek'])}, "
          f"tarifeden (oranla düzeltilmiş) {yuzde(sayac['tarife'])}")
    if sayac['sure_tarife']:
        print(f"Sefer süreleri toplamda tarifenin %{100 * sayac['sure_yeni'] / sayac['sure_tarife']:.0f}'i")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Kullanım: python iett-sure-uygula.py <iett-gtfs.zip> <segment-sureleri.json>')
    if not os.path.exists(sys.argv[2]):
        raise SystemExit(f'Öğrenilen süre dosyası yok: {sys.argv[2]} (köprü en az bir gün çalışmış olmalı)')
    main(sys.argv[1], sys.argv[2])
