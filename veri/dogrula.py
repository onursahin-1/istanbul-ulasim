# Derlenmiş GTFS beslemelerini sağlamadan geçirir: her araç tipi için belirli günlerde
# gerçekten kaç sefer çalışıyor, ilk ve son sefer ne zaman.
#
# Amaç, sessiz veri kayıplarını erken yakalamak. Daha önce iki kez böyle bir kayıp yaşandı:
# minibüs hatları vapur olarak işaretlenmişti ve gece metrosunun takvimi geçmişte kalmıştı.
#
# Kullanım:  python dogrula.py C:\otp\istanbul

import csv, io, os, sys, zipfile, datetime, collections

TUR_ADI = {'0': 'Tramvay', '1': 'Metro', '2': 'Marmaray / tren', '3': 'Otobüs ve minibüs',
           '4': 'Vapur', '5': 'Nostaljik tramvay', '6': 'Teleferik', '7': 'Füniküler'}
GUN_ALANLARI = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def oku(zf, ad):
    try:
        with zf.open(ad) as fh:
            return list(csv.DictReader(io.TextIOWrapper(fh, encoding='utf-8')))
    except KeyError:
        return []


def saniye(t):
    try:
        p = [int(x) for x in (t or '').strip().split(':')]
        return p[0] * 3600 + p[1] * 60 + p[2]
    except Exception:
        return None


def besleme_oku(yol):
    with zipfile.ZipFile(yol) as zf:
        rotalar = {r['route_id']: r for r in oku(zf, 'routes.txt')}
        seferler = oku(zf, 'trips.txt')
        takvim = {c['service_id']: c for c in oku(zf, 'calendar.txt')}
        istisna = collections.defaultdict(dict)
        for d in oku(zf, 'calendar_dates.txt'):
            istisna[d['service_id']][d['date']] = d['exception_type']
        saatler = collections.defaultdict(lambda: ['99:99:99', '00:00:00', 0])
        with zf.open('stop_times.txt') as fh:
            for r in csv.DictReader(io.TextIOWrapper(fh, encoding='utf-8')):
                t = (r.get('departure_time') or '').strip()
                if not t:
                    continue
                k = saatler[r['trip_id']]
                if t < k[0]: k[0] = t
                if t > k[1]: k[1] = t
                k[2] += 1
        # Sıklık tabanlı seferler: tek bir şablon sefer, frequencies.txt ile çoğaltılır.
        # Sayım bunu hesaba katmazsa Marmaray "günde 8 sefer" gibi görünür.
        frekans = collections.defaultdict(lambda: [0, '99:99:99', '00:00:00'])
        for f in oku(zf, 'frequencies.txt'):
            b, e = saniye(f.get('start_time')), saniye(f.get('end_time'))
            try:
                adim = int(f['headway_secs'])
            except Exception:
                continue
            if b is None or e is None or adim <= 0 or e <= b:
                continue
            k = frekans[f['trip_id']]
            k[0] += (e - b) // adim
            if f['start_time'] < k[1]: k[1] = f['start_time']
            if f['end_time'] > k[2]: k[2] = f['end_time']
    return rotalar, seferler, takvim, istisna, saatler, frekans


def calisiyor_mu(takvim, istisna, sid, tarih):
    d = tarih.strftime('%Y%m%d')
    ist = istisna.get(sid, {}).get(d)
    if ist == '1':
        return True
    if ist == '2':
        return False
    c = takvim.get(sid)
    if not c:
        return False
    if not (c['start_date'] <= d <= c['end_date']):
        return False
    return c[GUN_ALANLARI[tarih.weekday()]] == '1'


def main(klasor):
    bugun = datetime.date.today()
    # Haftanın dört karakteristik günü: iş günü, Cuma, Cumartesi, Pazar
    gunler = []
    for hedef, ad in ((2, 'Çarşamba'), (4, 'Cuma'), (5, 'Cumartesi'), (6, 'Pazar')):
        fark = (hedef - bugun.weekday()) % 7
        gunler.append((bugun + datetime.timedelta(days=fark), ad))

    toplam = collections.defaultdict(lambda: collections.defaultdict(int))
    ozet = {}
    for dosya in sorted(f for f in os.listdir(klasor) if f.endswith('.zip')):
        rotalar, seferler, takvim, istisna, saatler, frekans = besleme_oku(os.path.join(klasor, dosya))
        print(f"\n=== {dosya} ===")
        print(f"  {len(rotalar)} hat, {len(seferler)} sefer ({len(frekans)} tanesi sıklık tabanlı), {len(takvim)} takvim")
        tur_saat = collections.defaultdict(lambda: ['99:99:99', '00:00:00'])
        tur_hat = collections.defaultdict(set)
        for t in seferler:
            rota = rotalar.get(t['route_id'])
            if not rota:
                continue
            tur = rota.get('route_type', '?')
            tur_hat[tur].add(t['route_id'])
            f = frekans.get(t['trip_id'])
            kac = f[0] if f else 1
            for tarih, ad in gunler:
                if calisiyor_mu(takvim, istisna, t['service_id'], tarih):
                    toplam[tur][ad] += kac
                    ilk, son = (f[1], f[2]) if f else (saatler.get(t['trip_id']) or ['99:99:99', '00:00:00'])[:2]
                    if ilk < tur_saat[tur][0]: tur_saat[tur][0] = ilk
                    if son > tur_saat[tur][1]: tur_saat[tur][1] = son
        for tur in sorted(tur_hat, key=lambda x: (len(x), x)):
            ozet.setdefault(tur, [0, ['99:99:99', '00:00:00']])
            ozet[tur][0] += len(tur_hat[tur])
            if tur_saat[tur][0] < ozet[tur][1][0]: ozet[tur][1][0] = tur_saat[tur][0]
            if tur_saat[tur][1] > ozet[tur][1][1]: ozet[tur][1][1] = tur_saat[tur][1]

    print("\n=== ARAÇ TİPİNE GÖRE ÇALIŞAN SEFER SAYISI ===")
    baslik = f"{'Araç tipi':22} {'Hat':>5} " + ' '.join(f"{ad:>10}" for _, ad in gunler) + f"  {'İlk':>8} {'Son':>8}"
    print(baslik)
    print('-' * len(baslik))
    sorun = []
    for tur in sorted(ozet, key=lambda x: -sum(toplam[x].values())):
        hat, (ilk, son) = ozet[tur]
        sayilar = [toplam[tur][ad] for _, ad in gunler]
        print(f"{TUR_ADI.get(tur, 'Bilinmeyen ' + tur):22} {hat:>5} "
              + ' '.join(f"{n:>10,}".replace(',', '.') for n in sayilar)
              + f"  {ilk[:5]:>8} {son[:5]:>8}")
        if sum(sayilar) == 0:
            sorun.append(f"{TUR_ADI.get(tur, tur)}: hiçbir gün sefer yok")
        elif min(sayilar) == 0:
            bos = [ad for (_, ad), n in zip(gunler, sayilar) if n == 0]
            sorun.append(f"{TUR_ADI.get(tur, tur)}: {', '.join(bos)} günü sefer yok")

    print("\n=== SAĞLAMA ===")
    if sorun:
        for x in sorun:
            print('  ! ' + x)
    else:
        print('  Bütün araç tipleri her gün çalışıyor.')


main(sys.argv[1] if len(sys.argv) > 1 else r'C:\otp\istanbul')
