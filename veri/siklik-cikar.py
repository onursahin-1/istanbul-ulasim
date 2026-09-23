# Minibüs ve dolmuş hatlarının sefer sıklığını bir JSON'a çıkarır.
#
# Neden: bu hatların GTFS'te saatli seferi yok, "07:00–23:00 arası her 5 dakikada"
# gibi sıklık pencereleri var (frequencies.txt). OTP bunlarla rota kuruyor ama durak
# kalkışlarında döndürmüyor ve GraphQL API'sinde sıklık alanı yok. Uygulama bu
# dosyadan "her 5 dk · 23:00'a kadar" yazıyor.
#
# Anahtar hattın kısa adı (büyük harf): minibüs ve dolmuşta kısa ad güzergâhın
# kendisi ("İSTOÇ-BAĞCILAR DEVLET HASTANESİ") ve hat başına tek. Beslemenin kimliğine
# (OTP'deki "2:" öneki) bağlı kalmamak için route_id kullanılmıyor.
#
# Biçim: { "KISA AD": [[gunler, bas, bit, aralik], ...] }
#   gunler: 7 karakterlik maske, pazartesiden pazara ("1111100" hafta içi)
#   bas, bit: gün başından dakika (bit 1440'ı aşabilir: gece yarısını geçen pencere)
#   aralik: dakika
# Aynı hattın iki yönü ve aynı güne düşen seferleri birleştiriliyor: bir penceredeki
# aralık, o saatte iki yönden en sık olanı.
#
# Kullanım:
#   python siklik-cikar.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip ..\assets\veri\siklik.json

import csv, io, json, sys, zipfile, collections

# Saatsiz hatların işletmecileri: adında minibüs ya da dolmuş geçenler.
def saatsiz_mi(ajans_adi):
    a = (ajans_adi or '').lower()
    return any(k in a for k in ('minibus', 'minibüs', 'dolmus', 'dolmuş', 'taksi'))


def oku(z, ad):
    with z.open(ad) as ham:
        return list(csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig')))


def dakika(saat):
    s, d, *_ = (int(x) for x in saat.strip().split(':'))
    return s * 60 + d


def buyuk(metin):
    return metin.replace('i', 'İ').replace('ı', 'I').upper().strip()


def main(zip_yolu, cikti):
    with zipfile.ZipFile(zip_yolu) as z:
        ajanslar = {a['agency_id']: a['agency_name'] for a in oku(z, 'agency.txt')}
        hatlar = {r['route_id']: r for r in oku(z, 'routes.txt') if saatsiz_mi(ajanslar.get(r['agency_id']))}
        takvim = {}
        for c in oku(z, 'calendar.txt'):
            takvim[c['service_id']] = ''.join(
                c[g] for g in ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
            )
        seferler = {t['trip_id']: t for t in oku(z, 'trips.txt') if t['route_id'] in hatlar}
        # (hat, gün maskesi) → dakika dakika en sık aralık
        izgara = collections.defaultdict(dict)
        for f in oku(z, 'frequencies.txt'):
            t = seferler.get(f['trip_id'])
            if not t:
                continue
            maske = takvim.get(t['service_id'])
            if not maske or '1' not in maske:
                continue
            ad = buyuk(hatlar[t['route_id']]['route_short_name'])
            bas, bit = dakika(f['start_time']), dakika(f['end_time'])
            aralik = max(1, round(int(f['headway_secs']) / 60))
            h = izgara[(ad, maske)]
            for m in range(bas, bit):
                if m not in h or aralik < h[m]:
                    h[m] = aralik

    sonuc = collections.defaultdict(list)
    for (ad, maske), h in izgara.items():
        # Ardışık, aynı aralıklı dakikaları pencerelere topla.
        pencere = None
        for m in sorted(h):
            if pencere and m == pencere[2] and h[m] == pencere[3]:
                pencere[2] = m + 1
            else:
                if pencere:
                    sonuc[ad].append(pencere)
                pencere = [maske, m, m + 1, h[m]]
        if pencere:
            sonuc[ad].append(pencere)
    for ad in sonuc:
        sonuc[ad].sort(key=lambda p: (p[0], p[1]))

    with open(cikti, 'w', encoding='utf-8') as dosya:
        json.dump(dict(sorted(sonuc.items())), dosya, ensure_ascii=False, separators=(',', ':'))
    pencere_sayisi = sum(len(v) for v in sonuc.values())
    print(f'{len(sonuc)} hat, {pencere_sayisi} pencere → {cikti}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('kullanım: python siklik-cikar.py <ray-vapur-gtfs.zip> <çıktı.json>')
    main(sys.argv[1], sys.argv[2])
