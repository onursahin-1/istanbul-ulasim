# Raylı hatların ve istasyonların tekerlekli sandalye erişimini GTFS'e işler.
#
# Sorun: iki beslemede de erişim bilgisi yok (İETT'de alan hiç yok, raylıda çoğu "0 =
# bilinmiyor"). OTP'nin varsayılanı tekerlekli sandalye aramasında yalnız "erişilebilir"
# diye işaretli sefer ve durakları kullanmak; hiçbiri işaretli olmadığı için "basamaksız"
# arama hiç toplu taşıma bulamıyor, 15 km yürüyüş öneriyordu (3 saat).
#
# Çözümün iki yarısı var:
#   1. router-config.json: bilinmeyen sefer ve duraklar yasak değil, bedelli (bkz. README).
#   2. Bu betik: bildiğimizi işaretler, böylece bedeli yalnız bilinmeyenler öder.
#        - Metro (M1A–M11), Marmaray, T1/T4/T5/T6 tramvayları, F1/F3/F4 füniküleri:
#          asansörlü istasyonlar, alçak tabanlı ya da peron hizasında araçlar → erişilebilir.
#          Seferleri wheelchair_accessible=1, uğradıkları duraklar wheelchair_boarding=1.
#        - T2 (Taksim–Tünel) ve T3 (Kadıköy–Moda) nostaljik tramvay: basamaklı araç →
#          wheelchair_accessible=2 (OTP bunlara yüksek bedel biçer, çaresiz kalmadıkça seçmez).
#        - Öbür raylı hatlar (F2 Tünel, teleferikler) bilinmiyor → 0.
#        - Metrobüs (34, 34AS, 34BZ, 34C, 34G, 34Z…): peron hizasında biniş → seferler
#          erişilebilir; istasyonları da, İETT'nin saydığı yedisi dışında. "Uzunçayır, Acıbadem,
#          Altunizade, Burhaniye, Ayvansaray - Eyüp Sultan, Bayrampaşa - Maltepe ve Merter
#          istasyonları hariç tüm istasyonlar engelli erişimine uygundur" (iett.istanbul,
#          Metrobüs Hatları). O yedi istasyonun metrobüs durakları wheelchair_boarding=2.
#      Öbür otobüslere ve vapura dokunulmaz (bilinmiyor): İETT filosunun çoğu alçak tabanlı ama
#      minibüs ve özel halk otobüslerinde değil; seferden sefere bilgi yok.
#
# Kullanım (tarife betiklerinden sonra, OTP derlemesinden önce):
#   python erisim-isaretle.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip C:\otp\istanbul\istanbul-iett-gtfs.zip

import collections, csv, io, re, shutil, sys, zipfile

csv.field_size_limit(10 ** 7)

RAYLI_TURLER = {'0', '1', '2', '5', '6', '7', '12'}
ERISILEMEZ = {'T2', 'T3'}
ERISILEBILIR_TRAMVAY_FUNIKULER = {'T1', 'T4', 'T5', 'T6', 'F1', 'F3', 'F4'}
# Uygulamadaki metrobusMu ile aynı kural (src/lib/metin.ts).
METROBUS = re.compile(r'^34[A-ZÇĞİÖŞÜ]{0,2}$')
# İETT'ye göre engelli erişimine uygun olmayan metrobüs istasyonları (sadeleştirilmiş adın başı).
METROBUS_ERISILEMEZ = ('uzuncayir', 'acibadem', 'altunizade', 'burhaniye', 'ayvansaray',
                       'bayrampasamaltepe', 'merter')


def sade(ad):
    tablo = str.maketrans('çğıöşüâîûÇĞİÖŞÜ', 'cgiosuaiucgiosu')
    return ''.join(c for c in (ad or '').strip().translate(tablo).lower() if c.isalnum())


def metrobus_mu(rota):
    return rota['route_type'] == '3' and bool(METROBUS.match((rota['route_short_name'] or '').strip().upper()))


def erisim(rota):
    """Hattın erişim durumu: '1' erişilebilir, '2' değil, '0' bilinmiyor; raylı ya da
    metrobüs değilse None."""
    if metrobus_mu(rota):
        return '1'
    if rota['route_type'] not in RAYLI_TURLER:
        return None
    kod = (rota['route_short_name'] or '').strip().upper()
    if kod in ERISILEMEZ:
        return '2'
    if rota['route_type'] in ('1', '2') or kod.startswith('MARMARAY') or kod in ERISILEBILIR_TRAMVAY_FUNIKULER:
        return '1'
    return '0'


def tablo_oku(z, ad):
    with z.open(ad) as ham:
        okuyucu = csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig'))
        return list(okuyucu), list(okuyucu.fieldnames or [])


def isle(yol):
    """Yalnız trips.txt ve stops.txt yeniden yazılır; öbür dosyalar (İETT'nin yüz
    megabaytlık stop_times'ı) olduğu gibi kopyalanır, belleğe alınmaz."""
    sayim = collections.Counter()
    with zipfile.ZipFile(yol) as z:
        rotalar, _ = tablo_oku(z, 'routes.txt')
        seferler, sefer_alanlari = tablo_oku(z, 'trips.txt')
        duraklar, durak_alanlari = tablo_oku(z, 'stops.txt')

        rota_erisimi = {r['route_id']: erisim(r) for r in rotalar}
        metrobus_rotalari = {r['route_id'] for r in rotalar if metrobus_mu(r)}
        metrobus_seferleri = {t['trip_id'] for t in seferler if t['route_id'] in metrobus_rotalari}
        erisilebilir_seferler = set()
        for t in seferler:
            e = rota_erisimi.get(t['route_id'])
            if e is None:
                continue
            if t.get('wheelchair_accessible', '') != e:
                t['wheelchair_accessible'] = e
                sayim[f'sefer→{e}'] += 1
            if e == '1':
                erisilebilir_seferler.add(t['trip_id'])

        erisilebilir_duraklar, metrobus_duraklari = set(), set()
        if erisilebilir_seferler:
            with z.open('stop_times.txt') as ham:
                for r in csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig')):
                    if r['trip_id'] in erisilebilir_seferler:
                        erisilebilir_duraklar.add(r['stop_id'])
                        if r['trip_id'] in metrobus_seferleri:
                            metrobus_duraklari.add(r['stop_id'])
        erisilemez_metrobus = set()
        for d in duraklar:
            hedef = None
            if d['stop_id'] in metrobus_duraklari and sade(d.get('stop_name')).startswith(METROBUS_ERISILEMEZ):
                hedef = '2'
                erisilemez_metrobus.add(d['stop_name'].strip())
            elif d['stop_id'] in erisilebilir_duraklar:
                hedef = '1'
            if hedef and d.get('wheelchair_boarding', '') != hedef:
                d['wheelchair_boarding'] = hedef
                sayim[f'durak→{hedef}'] += 1

        if not sayim:
            print(f'{yol}: değişiklik yok')
            return
        if 'wheelchair_accessible' not in sefer_alanlari:
            sefer_alanlari.append('wheelchair_accessible')
        if 'wheelchair_boarding' not in durak_alanlari:
            durak_alanlari.append('wheelchair_boarding')
        yeniden = {'trips.txt': (seferler, sefer_alanlari), 'stops.txt': (duraklar, durak_alanlari)}

        gecici = yol + '.yeni'
        with zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as cikti:
            for bilgi in z.infolist():
                if bilgi.filename in yeniden:
                    satirlar, alanlar = yeniden[bilgi.filename]
                    tampon = io.StringIO()
                    w = csv.DictWriter(tampon, fieldnames=alanlar, lineterminator='\n', extrasaction='ignore')
                    w.writeheader()
                    w.writerows(satirlar)
                    cikti.writestr(bilgi.filename, tampon.getvalue())
                else:
                    with z.open(bilgi) as kaynak, cikti.open(bilgi.filename, 'w') as hedef:
                        shutil.copyfileobj(kaynak, hedef, 1 << 20)
    shutil.move(gecici, yol)

    hatlar = collections.defaultdict(set)
    for r in rotalar:
        e = rota_erisimi[r['route_id']]
        if e is not None:
            hatlar[e].add(r['route_short_name'])
    print(yol)
    for e, ad in (('1', 'erişilebilir'), ('2', 'erişilemez'), ('0', 'bilinmiyor')):
        if hatlar[e]:
            print(f'  {ad:13} {", ".join(sorted(hatlar[e]))}')
    print(f"  değişen: {dict(sayim)}; erişilebilir durak: {len(erisilebilir_duraklar)}", flush=True)
    if metrobus_duraklari:
        print(f"  metrobüs: {len(metrobus_duraklari)} durak; erişilemez: {', '.join(sorted(erisilemez_metrobus))}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('kullanım: python erisim-isaretle.py <gtfs.zip> [<gtfs.zip>…]')
    for yol in sys.argv[1:]:
        isle(yol)
