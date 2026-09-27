# Resmî tatil ve bayramları GTFS takvimine işler (calendar_dates.txt).
#
# Beslemelerde tatil yok: 29 Ekim perşembe olağan bir perşembe gibi görünüyordu. İstanbul'da
# tatillerde pazar ya da cumartesi tarifesi uygulanıyor (Şehir Hatları "Pazar ve Resmî Tatil
# Günleri" tablosunu, İETT her tatil için duyurduğu tarifeyi kullanıyor: millî bayramlarda
# ve bayramın ilk gününde pazar, bayramın öbür günlerinde cumartesi).
#
# Günler assets/veri/ozel-gunler.json'da (uygulama da ücretsiz günleri oradan okuyor). Her
# tatil D için, her servis:
#   - D'nin hafta gününde çalışıp hedef günde (pazar/cumartesi) çalışmıyorsa → D'de çıkarılır;
#   - hedef günde çalışıp D'nin hafta gününde çalışmıyorsa → D'de eklenir.
# Böylece D, bütün beslemelerde hedef günün tarifesiyle işler. Yeniden çalıştırılabilir:
# listedeki tarihlerin eski satırları silinip yeniden yazılır.
#
# Yalnız calendar.txt ve calendar_dates.txt okunup yazılıyor; öbür dosyalar (İETT'nin büyük
# stop_times'ı) olduğu gibi kopyalanıyor.
#
# Kullanım (tarife betiklerinden sonra, OTP derlemesinden önce):
#   python ozel-gun-takvimi.py ..\assets\veri\ozel-gunler.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip C:\otp\istanbul\istanbul-iett-gtfs.zip

import csv, datetime, io, json, shutil, sys, zipfile

GUNLER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
HEDEF = {'pazar': 'sunday', 'cumartesi': 'saturday'}


def oku(z, ad):
    if ad not in z.namelist():
        return [], []
    with z.open(ad) as ham:
        r = csv.DictReader(io.TextIOWrapper(ham, encoding='utf-8-sig'))
        return list(r), list(r.fieldnames or [])


def yaz(satirlar, alanlar):
    tampon = io.StringIO()
    w = csv.DictWriter(tampon, fieldnames=alanlar, lineterminator='\n', extrasaction='ignore')
    w.writeheader()
    w.writerows(satirlar)
    return tampon.getvalue()


def istisnalar(takvim, tatiller):
    """[(service_id, 'YYYYMMDD', '1'|'2')] — tatil günlerinde eklenecek/çıkarılacak servisler."""
    sonuc = []
    for t in tatiller:
        tarih = datetime.date.fromisoformat(t['tarih'])
        gun = tarih.strftime('%Y%m%d')
        olagan = GUNLER[tarih.weekday()]
        hedef = HEDEF.get(t.get('tarife', 'pazar'), 'sunday')
        if olagan == hedef:
            continue
        for c in takvim:
            if not (c['start_date'] <= gun <= c['end_date']):
                continue
            olaganda, hedefte = c[olagan] == '1', c[hedef] == '1'
            if olaganda and not hedefte:
                sonuc.append((c['service_id'], gun, '2'))
            elif hedefte and not olaganda:
                sonuc.append((c['service_id'], gun, '1'))
    return sonuc


def isle(yol, tatiller):
    tarihler = {datetime.date.fromisoformat(t['tarih']).strftime('%Y%m%d') for t in tatiller}
    with zipfile.ZipFile(yol) as z:
        takvim, _ = oku(z, 'calendar.txt')
        eski, alanlar = oku(z, 'calendar_dates.txt')
        alanlar = alanlar or ['service_id', 'date', 'exception_type']
        kalan = [r for r in eski if r['date'] not in tarihler]
        yeni = [{'service_id': s, 'date': d, 'exception_type': e} for s, d, e in istisnalar(takvim, tatiller)]
        icerik = yaz(kalan + yeni, alanlar)
        gecici = yol + '.yeni'
        with zipfile.ZipFile(gecici, 'w', zipfile.ZIP_DEFLATED) as cikti:
            for bilgi in z.infolist():
                if bilgi.filename == 'calendar_dates.txt':
                    continue
                with z.open(bilgi) as kaynak, cikti.open(bilgi.filename, 'w') as hedef:
                    shutil.copyfileobj(kaynak, hedef, 1 << 20)
            cikti.writestr('calendar_dates.txt', icerik)
    shutil.move(gecici, yol)
    eklenen = sum(1 for r in yeni if r['exception_type'] == '1')
    print(f'{yol}: {len(tarihler)} tatil günü, {eklenen} servis eklendi, {len(yeni) - eklenen} çıkarıldı '
          f'({len(eski) - len(kalan)} eski satır yenilendi)')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit('kullanım: python ozel-gun-takvimi.py <ozel-gunler.json> <gtfs.zip> [<gtfs.zip>…]')
    tatiller = json.load(open(sys.argv[1], encoding='utf-8'))['gunler']
    for yol in sys.argv[2:]:
        isle(yol, tatiller)
