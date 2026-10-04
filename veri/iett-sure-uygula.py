# İETT seferlerinin ara durak saatlerini, otobüslerin gerçekte ölçülen yol süreleriyle doldurur.
#
# Sorun: İETT tarifesinde bir seferin yalnız ilk ve son durağının saati var; aradaki
# duraklar boş. OTP bunları mesafeye göre eşit dağıtıyor: trafikteki
# ana cadde ile boş sokak aynı hızda geçiliyor sayılıyor. Rota motoru aktarma paylarını,
# varış saatlerini ve "hangi rota daha hızlı" kararını bu uydurma saatlerle veriyordu.
#
# Çözüm: canlı veri köprüsü (kopru/) her gün binlerce otobüsün iki durak arası gerçek
# süresini ölçüyor (kopru/segment.mjs → kopru/kayit/segment-sureleri.json). Süreler saat
# dilimine (00–06, 06–10, 10–16, 16–20, 20–24) ve hafta içi / hafta sonuna göre ayrı.
# Köprünün kendi ölçümünde bu süreler tarifenin eşit dağıtımından belirgin biçimde iyi:
# 4 durak sonrası ortalama sapma 2,2 → 1,1 dk, 10 durak sonrası 4,3 → 2,3 dk.
#
# Kural:
#   • İETT'nin verdiği saatlere (uç duraklar; betik bunları timepoint=1 işaretler) dokunulmaz. Aradaki süre,
#     durak çiftlerinin öğrenilen sürelerine göre bölüştürülür (toplam tarifeye eşit kalır).
#     Böylece seferin kalkış ve varış saati İETT'nin planı, ama aradaki duraklara varış
#     yolun gerçek akışına göre: trafikli kısım uzun, açık yol kısa.
#   • Öğrenilmemiş durak çiftinde süre mesafeden, aynı seferin öğrenilen kısımlarındaki
#     hızla tahmin edilir; seferde hiç öğrenilen kısım yoksa eşit dağıtım (eski davranış).
#   • Durak çiftinin o saat dilimi için yeterli ölçümü yoksa (en az 4) aynı gün türünün
#     öbür dilimlerinin ortalaması kullanılır.
#   • Doldurulan satırlar timepoint=0 kalır. Betik tekrar çalıştırılabilir: her seferinde
#     timepoint=0 satırlar yeniden hesaplanır (yeni ölçümlerle güncellenir).
#
# Kullanım:
#   python iett-sure-uygula.py C:\otp\istanbul\istanbul-iett-gtfs.zip ..\kopru\kayit\segment-sureleri.json
# Sonra OTP grafiği yeniden derlenmeli.

import csv, io, json, math, os, shutil, sys, time, zipfile

EN_AZ_OLCUM = 4          # kopru/segment.mjs ile aynı eşik
EN_KISA_SN = 10          # iki durak arası en az bu kadar
DILIMLER = [(0, 6), (6, 10), (10, 16), (16, 20), (20, 24)]


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


def main(zip_yolu, sure_yolu):
    basla = time.time()
    tam, yedek = ogrenilenleri_oku(sure_yolu)
    print(f'Öğrenilen süre: {len(tam)} durak çifti-dilim, {len(yedek)} gün türü yedeği')

    with zipfile.ZipFile(zip_yolu) as z:
        duraklar = {s['stop_id']: (float(s['stop_lat']), float(s['stop_lon'])) for s in tablo(z, 'stops.txt')}
        hafta_ici = {}
        for c in tablo(z, 'calendar.txt'):
            hafta_ici[c['service_id']] = any(c[g] == '1' for g in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday'))
        sefer_gun = {t['trip_id']: ('i' if hafta_ici.get(t['service_id'], True) else 'h') for t in tablo(z, 'trips.txt')}

    sayac = {'sefer': 0, 'doldurulan': 0, 'ogrenilen': 0, 'yedek': 0, 'tahmin': 0, 'esit': 0, 'fark_toplam': 0, 'fark_sayi': 0}

    def sure(a, b, gun, an):
        cift = f'{a}>{b}'
        d = tam.get(f'{cift}|{gun}{dilim_no(an)}')
        if d is not None:
            return d, 'ogrenilen'
        d = yedek.get(f'{cift}|{gun}')
        if d is not None:
            return d, 'yedek'
        return None, None

    def seferi_doldur(satirlar, gun):
        """satirlar: [ [trip_id, stop_id, seq, arr, dep, timepoint], ... ] (sıralı). Yerinde doldurur."""
        if any(not r[3] and not r[4] for r in satirlar):
            # İlk kez: İETT'nin saat yazdığı satırlar çapa. Onlar timepoint=1 işaretlenir
            # (son durak veride timepoint=0 geliyor); betik yeniden çalışınca çapalar bunlar.
            capalar = [i for i, r in enumerate(satirlar) if r[3] or r[4]]
            for i in capalar:
                satirlar[i][5] = '1'
        else:
            capalar = [i for i, r in enumerate(satirlar) if r[5] == '1']
        if len(capalar) < 2:
            return
        for i, j in zip(capalar, capalar[1:]):
            if j - i < 2:
                continue
            t0 = saniye_oku(satirlar[i][4] or satirlar[i][3])
            t1 = saniye_oku(satirlar[j][3] or satirlar[j][4])
            if t0 is None or t1 is None or t1 <= t0:
                continue
            yol = [mesafe(duraklar.get(satirlar[k][1]), duraklar.get(satirlar[k + 1][1])) for k in range(i, j)]
            toplam_yol = sum(yol) or 1.0
            # Dilim için önce eşit dağıtımla kabaca geçiş anı.
            gecis, birik = [], 0.0
            for m in yol:
                gecis.append(t0 + (t1 - t0) * birik / toplam_yol)
                birik += m
            sureler, turler = [], []
            for n, k in enumerate(range(i, j)):
                d, tur = sure(satirlar[k][1], satirlar[k + 1][1], gun, int(gecis[n]))
                sureler.append(d)
                turler.append(tur)
            bilinen_yol = sum(m for m, d in zip(yol, sureler) if d is not None)
            bilinen_sure = sum(d for d in sureler if d is not None)
            if bilinen_sure > 0 and bilinen_yol > 0:
                hiz = bilinen_yol / bilinen_sure
            else:
                hiz = toplam_yol / (t1 - t0)
            for n, d in enumerate(sureler):
                if d is None:
                    sureler[n] = yol[n] / hiz if hiz > 0 else (t1 - t0) / len(yol)
                    turler[n] = 'tahmin' if bilinen_sure > 0 else 'esit'
            olcek = (t1 - t0) / (sum(sureler) or 1.0)
            an = float(t0)
            for n, k in enumerate(range(i + 1, j)):
                an += max(sureler[n] * olcek, EN_KISA_SN)
                yeni = min(int(round(an)), t1)
                eski_dogrusal = t0 + (t1 - t0) * (sum(yol[: n + 1]) / toplam_yol)
                sayac['fark_toplam'] += abs(yeni - eski_dogrusal)
                sayac['fark_sayi'] += 1
                metin = saniye_yaz(yeni)
                satirlar[k][3] = metin
                satirlar[k][4] = metin
                sayac['doldurulan'] += 1
            for t in turler:
                sayac[t] += 1

    gecici = zip_yolu + '.gecici'
    with zipfile.ZipFile(zip_yolu) as eski, zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as yeni:
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
                seferi_doldur(satirlar, sefer_gun.get(mevcut, 'i'))
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

    parca = sayac['ogrenilen'] + sayac['yedek'] + sayac['tahmin'] + sayac['esit']
    yuzde = lambda x: f'%{100 * x / parca:.1f}' if parca else '-'
    print(f"{sayac['sefer']} sefer, {sayac['doldurulan']} ara durak saati dolduruldu ({time.time() - basla:.0f} sn)")
    print(f"Durak arası süreler: öğrenilen {yuzde(sayac['ogrenilen'])}, öğrenilen (başka dilim) {yuzde(sayac['yedek'])}, "
          f"mesafeden tahmin {yuzde(sayac['tahmin'])}, eşit dağıtım {yuzde(sayac['esit'])}")
    if sayac['fark_sayi']:
        print(f"Eşit dağıtıma göre ortalama fark: {sayac['fark_toplam'] / sayac['fark_sayi'] / 60:.1f} dk")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Kullanım: python iett-sure-uygula.py <iett-gtfs.zip> <segment-sureleri.json>')
    if not os.path.exists(sys.argv[2]):
        raise SystemExit(f'Öğrenilen süre dosyası yok: {sys.argv[2]} (köprü en az bir gün çalışmış olmalı)')
    main(sys.argv[1], sys.argv[2])
