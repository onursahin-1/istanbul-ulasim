# Ağ haritası için raylı hat çizgilerini ve istasyonlarını tek bir JSON'a çıkarır.
#
# Neden sunucudan değil dosyadan: ağ haritası bütün hatları aynı anda çiziyor.
# Bunu OTP'den her açılışta çekmek hem yavaş hem de sunucuya bağımlı; harita
# uygulamanın en çok "bir bakayım" diye açılan ekranı olacak. Veri seyrek
# değiştiği için uygulamayla birlikte gidiyor.
#
# Çizgiler Google polyline (5 basamak) ile sıkıştırılıyor; uygulama zaten
# src/lib/cografya.ts içinde çözüyor.
#
# Kullanım:
#   python ag-cikar.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip ..\assets\veri\ag.json

import csv, io, json, sys, zipfile, collections

# Ağ haritasına giren araç tipleri: metro, tramvay, tren, füniküler, teleferik.
TURLER = {'0', '1', '2', '5', '6', '7'}


def oku(z, ad):
    with z.open(ad) as ham:
        return list(csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig')))


def polyline_yaz(noktalar):
    """Google polyline, 5 basamak."""
    cikti = []
    onceki = [0, 0]
    for nokta in noktalar:
        for eksen in (0, 1):
            deger = round(nokta[eksen] * 1e5)
            fark = deger - onceki[eksen]
            onceki[eksen] = deger
            fark = ~(fark << 1) if fark < 0 else (fark << 1)
            while fark >= 0x20:
                cikti.append(chr((0x20 | (fark & 0x1f)) + 63))
                fark >>= 5
            cikti.append(chr(fark + 63))
    return ''.join(cikti)


def seyrelt(noktalar, esik=0.00002):
    """Ardışık çok yakın noktaları atar; çizgi görünümü değişmiyor, dosya küçülüyor."""
    sonuc = [noktalar[0]]
    for n in noktalar[1:]:
        if abs(n[0] - sonuc[-1][0]) > esik or abs(n[1] - sonuc[-1][1]) > esik:
            sonuc.append(n)
    if sonuc[-1] != noktalar[-1]:
        sonuc.append(noktalar[-1])
    return sonuc


def main(zip_yolu, cikti_yolu):
    with zipfile.ZipFile(zip_yolu) as z:
        rotalar = oku(z, 'routes.txt')
        seferler = oku(z, 'trips.txt')
        duraklar = {d['stop_id']: d for d in oku(z, 'stops.txt')}
        cizgiler = collections.defaultdict(list)
        for r in oku(z, 'shapes.txt'):
            cizgiler[r['shape_id']].append((int(r['shape_pt_sequence']),
                                            float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
        saatler = collections.defaultdict(list)
        for r in oku(z, 'stop_times.txt'):
            saatler[r['trip_id']].append(r)

    for c in cizgiler.values():
        c.sort()
    for liste in saatler.values():
        liste.sort(key=lambda r: int(r['stop_sequence']))

    rotaSefer = collections.defaultdict(list)
    for t in seferler:
        rotaSefer[t['route_id']].append(t)

    cikti = []
    atlanan = []
    for ro in rotalar:
        if ro['route_type'] not in TURLER:
            continue
        adaylar = rotaSefer.get(ro['route_id'], [])
        if not adaylar:
            continue
        # Hattı en iyi temsil eden sefer: en çok durağı olan.
        temsilci = max(adaylar, key=lambda t: len(saatler.get(t['trip_id'], [])))
        durakDizisi = saatler.get(temsilci['trip_id'], [])
        if len(durakDizisi) < 2:
            continue

        # Çizgi: bu hattın herhangi bir seferinin en uzun çizgisi.
        enIyi = max((cizgiler.get(t.get('shape_id', ''), []) for t in adaylar), key=len, default=[])
        if len(enIyi) >= 2:
            nokta = seyrelt([(p[1], p[2]) for p in enIyi])
        else:
            # Çizgi yoksa istasyonları birleştir; hiç çizmemekten iyi.
            nokta = [(float(duraklar[r['stop_id']]['stop_lat']), float(duraklar[r['stop_id']]['stop_lon']))
                     for r in durakDizisi if r['stop_id'] in duraklar]
            atlanan.append(ro['route_short_name'])
        if len(nokta) < 2:
            continue

        ist = []
        for r in durakDizisi:
            d = duraklar.get(r['stop_id'])
            if not d:
                continue
            ana = duraklar.get(d.get('parent_station') or '', d)
            ist.append({'id': ana['stop_id'], 'ad': ana['stop_name'],
                        'lat': round(float(ana['stop_lat']), 5), 'lon': round(float(ana['stop_lon']), 5)})

        cikti.append({
            'id': ro['route_id'],
            'kod': ro['route_short_name'],
            'ad': ro['route_long_name'],
            'tur': ro['route_type'],
            'renk': (ro.get('route_color') or '').strip(),
            'cizgi': polyline_yaz(nokta),
            'nokta': len(nokta),
            'duraklar': ist,
        })

    cikti.sort(key=lambda h: (h['tur'], h['kod']))
    govde = {'surum': 1, 'hatlar': cikti}
    metin = json.dumps(govde, ensure_ascii=False, separators=(',', ':'))
    io.open(cikti_yolu, 'w', encoding='utf-8', newline='\n').write(metin)

    print(f'{len(cikti)} hat -> {cikti_yolu}  ({len(metin) / 1024:.0f} KB)')
    for h in cikti:
        print(f"  {h['kod']:10} {h['nokta']:5} nokta {len(h['duraklar']):3} istasyon  {h['ad'][:44]}")
    if atlanan:
        print('çizgisi olmayıp istasyonlardan çizilen:', atlanan)


main(sys.argv[1], sys.argv[2])
