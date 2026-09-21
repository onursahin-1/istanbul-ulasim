# M11'in tarifesini gerçek değerlerle değiştirir.
#
# Sorun: M11 İBB beslemesinde hiç yok, biz onu OSM'den sıfırdan üretiyoruz
# (istasyon-tamamla.py). İstasyon sırası ve konumları OSM'den geldiği için doğru,
# ama saatler bizim tahminimizdi: uçtan uca 42 dk ve 10-15 dakikada bir sefer.
# İkisi de gerçeğin belirgin biçimde üstünde.
#
# Gerçek değerler (iki bağımsız kaynakta aynı):
#   uçtan uca      57 dakika (Gayrettepe-Halkalı, 69 km)
#   ilk / son      06:00 / 00:40
#   sıklık         zirvede 20 dk, diğer saatlerde 20-30 dk
# Kaynak: marmaray.istanbul ve gokyuzuhaberci.com, 2026. Hattın tamamı Haziran
# 2026'da açıldı; 15 istasyonun adları ve sırası ikisinde de bizim dizimizle birebir.
#
# 20 dakikalık sıklık, tahminimizdeki 10 dakikanın iki katı: uygulama havalimanına
# giden yolcuya olduğundan hızlı bir bağlantı gösteriyordu.
#
# Bu betik yalnızca saatleri düzeltir; istasyonlara dokunmaz. istasyon-tamamla.py
# zaten aynı değerleri üretecek biçimde güncellendi, bu betik hâlihazırda kurulmuş
# bir zip'i baştan üretmeden onarmak için.
#
# Kullanım:
#   python m11-tarife-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip

import csv, io, math, shutil, sys, zipfile, collections

ROTA = 'osm-m11'
SURE_DK = 57             # uçtan uca, istasyon duraklamaları dâhil
DURAKLAMA = 20           # saniye
ILK = '06:00:00'
PENCERELER = [('06:00:00', '22:00:00', 1200),
              ('22:00:00', '24:40:00', 1800)]


def sn(t):
    p = [int(x) for x in t.split(':')]
    return p[0] * 3600 + p[1] * 60 + p[2]


def saat(s):
    s = int(s)
    return f'{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}'


def mesafe(a, b):
    R = 6371000.0
    fa, fb = math.radians(a[0]), math.radians(b[0])
    da, db = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(da / 2) ** 2 + math.cos(fa) * math.cos(fb) * math.sin(db / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


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


def main(zip_yolu):
    tablolar, alanlar = zip_oku(zip_yolu)
    konum = {d['stop_id']: (float(d['stop_lat']), float(d['stop_lon'])) for d in tablolar['stops.txt']}

    seferler = [t['trip_id'] for t in tablolar['trips.txt'] if t['route_id'] == ROTA]
    if not seferler:
        print(f'{ROTA} bulunamadı; istasyon-tamamla.py çalıştırıldı mı?')
        return

    saatler = collections.defaultdict(list)
    for r in tablolar['stop_times.txt']:
        if r['trip_id'] in seferler:
            saatler[r['trip_id']].append(r)
    for liste in saatler.values():
        liste.sort(key=lambda r: int(r['stop_sequence']))

    for tid, liste in saatler.items():
        onceki = (sn(liste[-1]['arrival_time']) - sn(liste[0]['arrival_time'])) / 60
        araliklar = [mesafe(konum[a['stop_id']], konum[b['stop_id']]) for a, b in zip(liste, liste[1:])]
        toplam_m = sum(araliklar) or 1.0
        hedef = max(60, SURE_DK * 60 - DURAKLAMA * (len(liste) - 1))
        sureler = [max(70, round(hedef * m / toplam_m)) for m in araliklar]

        t = sn(ILK)
        for i, r in enumerate(liste):
            if i:
                t += sureler[i - 1]
            r['arrival_time'] = saat(t)
            r['departure_time'] = saat(t + DURAKLAMA)
            t += DURAKLAMA
        sonra = (sn(liste[-1]['arrival_time']) - sn(liste[0]['arrival_time'])) / 60
        print(f'{tid}: uçtan uca {onceki:.0f} dk → {sonra:.0f} dk')

    tablolar['frequencies.txt'] = [r for r in tablolar['frequencies.txt'] if r['trip_id'] not in seferler]
    for tid in seferler:
        for bas, bit, ara in PENCERELER:
            tablolar['frequencies.txt'].append({
                'trip_id': tid, 'start_time': bas, 'end_time': bit,
                'headway_secs': str(ara), 'exact_times': '0',
            })
    print('sıklık:', ', '.join(f'{b[:5]}-{s[:5]} {a // 60} dk' for b, s, a in PENCERELER))

    zip_yaz(zip_yolu, tablolar, alanlar)
    print('yazıldı:', zip_yolu)


main(sys.argv[1])
