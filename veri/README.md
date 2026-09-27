# Veri hattı

Uygulamanın kullandığı üç veri kümesi burada üretiliyor. Hiçbiri sürüm kontrolüne
girmiyor (büyükler), betikler giriyor.

## Çalıştırma sırası

**Tek komutla:** `.\yenile.ps1` aşağıdaki adımların hepsini sırayla çalıştırıyor (önce eski
zip'leri `C:\otp\yedekler\yenile-…` klasörüne yedekliyor, bir adım hata verirse duruyor).
`-Derle` sonunda OTP grafiğini de derliyor (çalışan OTP'yi önce kapat); `-EskiTarife` metro
ve vapur tarifelerini yeniden indirmeden son indirileni kullanıyor. İETT tarifesi, mevsim ya da
bir işletme değişikliği olunca, `ozel-gunler.json` güncellenince bunu çalıştırmak yeter.

Betiklerin çoğu zip'i **yerinde** değiştiriyor ve sıraya bağlı. Elle baştan kurarken:

```powershell
node hazirla-gtfs.mjs C:\otp\istanbul                                        # 1
python osm-cikar.py C:\otp\istanbul\Istanbul.osm.pbf C:\otp\osm-hatlar.json  # 2
python istasyon-tamamla.py C:\otp\osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python marmaray-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python eksik-hatlar.py C:\otp\osm-hatlar.json C:\otp\istanbul
node metro-tarife-indir.mjs C:\otp\metro-tarife.json            # yalnız senin bilgisayarında (~10 dk)
python metro-tarife-uygula.py C:\otp\metro-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
node vapur-tarife-indir.mjs C:\otp\vapur-tarife.json            # yalnız senin bilgisayarında (<1 dk)
python vapur-tarife-uygula.py C:\otp\vapur-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
node ozel-vapur-indir.mjs C:\otp\ozel-vapur-tarife.json       # yalnız senin bilgisayarında (<1 dk)
python ozel-vapur-uygula.py C:\otp\ozel-vapur-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python erisim-isaretle.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip C:\otp\istanbul\istanbul-iett-gtfs.zip
python ozel-gun-takvimi.py ..\assets\veri\ozel-gunler.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip C:\otp\istanbul\istanbul-iett-gtfs.zip
python cizgi-ekle.py C:\otp\osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python vapur-cizgi.py ekle C:\otp\osm-kiyi.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python hat-adi-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python durak-birlestir.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python durak-birlestir.py C:\otp\istanbul\istanbul-iett-gtfs.zip
python dogrula.py C:\otp\istanbul                                          # sağlama
python ag-cikar.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip ..\assets\veri\ag.json
python siklik-cikar.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip ..\assets\veri\siklik.json
```

Yarıda kalmış bir zip'e yeniden çalıştırmak yerine `hazirla-gtfs.mjs` ile baştan
üretmek gerekiyor. **Elle alınmış yedeklere güvenme**: `hazirla-gtfs.mjs` zaman
içinde düzeldiği için eski bir yedek, araç tipi yanlış atanmış bir sürüm olabilir.
`dogrula.py` çıktısındaki hat sayıları (12 metro, 3 Marmaray, 7 tramvay…) bu tür
bir karışıklığı hemen gösterir.

## 1. GTFS — sefer tarifeleri

```powershell
node hazirla-gtfs.mjs C:\otp\istanbul          # her iki besleme
node hazirla-gtfs.mjs C:\otp\istanbul ray      # yalnızca metro/vapur beslemesi
```

İBB Açık Veri Portalı'ndan iki besleme indirilir, GTFS'e çevrilir ve bilinen veri
hataları onarılır:

- **İETT** (otobüs, Metrobüs) — düzenli güncelleniyor.
- **Raylı sistemler ve vapur** (metro, Marmaray, tramvay, füniküler, teleferik,
  vapur, minibüs, dolmuş) — İBB artık güncellemiyor, verinin takvimi 2021–2023
  arasında kalmış. Betik takvimi tam hafta kaydırarak güncel döneme taşır, böylece
  hafta içi/hafta sonu düzeni bozulmaz.

Onarılan başlıca sorunlar:

- Koordinatlar Excel'den geçerken bozulmuş (`41.019...` → `410.191.700.005.564`).
- Türkçe karakterler iki kez kodlanmış (`KADIKÖY` → `KADIKÃ–Y`).
- Araç tipi kodları güvenilmez: **minibüs hatlarının bir kısmı vapur (4), bir
  kısmı metro (1)** olarak işaretlenmiş. Tür artık hat adından değil işletmeciden
  belirleniyor (Şehir Hatları → vapur, TCDD → Marmaray, Metro İstanbul → hat
  koduna göre, Minibüs/Taksi Dolmuş/İETT → otobüs).
- Standart dışı tür kodları (ör. 9), boş hat adları, kayıp `agency_id`, ilk/son
  durağında saati olmayan seferler, kopuk referanslar.
- Bütünüyle tırnak içine sıkışmış satırlar.

Sağlama: bütün adımlardan sonra hat sayıları beklenene yakın olmalı — 12 metro,
3 Marmaray, 7 tramvay (T1, T3, T4, T5, T6 ve İETT'nin iki yönlü T2'si), 4 füniküler,
2 teleferik, ~100 vapur, kalanı otobüs/minibüs.

## 2. OSM — yol ağı

OTP'ye verilen `Istanbul.osm.pbf`, Marmara özetinin bizim alanımıza kırpılmış hâli.

```powershell
# 163 MB'lık Marmara özetini indir (tarayıcıdan):
#   https://download.openstreetmap.fr/extracts/europe/turkey/marmara-latest.osm.pbf
# C:\otp\ içine koy, sonra:
python kirp-osm.py C:\otp\marmara-latest.osm.pbf C:\otp\istanbul\Istanbul.osm.pbf 40.75 41.50 27.95 29.95
```

Kutu bütün durakları kapsıyor (duraklar 40.78–41.48 enlem, 28.00–29.91 boylam
arasına yayılıyor). Daha dar bir özet kullanılırsa kutu dışındaki duraklar yol
ağına bağlanamaz ve uygulamada "yol ağına bağlanamadı" hatası verir.

`.pbf` dosyası `C:\otp\istanbul\` içinde **tek** olmalı; OTP klasördeki bütün
`.pbf` dosyalarını derlemeye çalışır.

## 3. İlgi noktaları — yer araması

```powershell
python cikar.py C:\otp\istanbul\Istanbul.osm.pbf ham.jsonl
python kur.py ham.jsonl istanbul-poi.db
copy istanbul-poi.db ..\assets\veri\istanbul-poi.db
```

Aynı OSM dosyasından adı olan hastane, okul, eczane, benzinlik, kırtasiye, park,
AVM, semt gibi noktaları çıkarır (~52 bin nokta, 70 kategori) ve telefonda
çalışan bir SQLite veritabanı üretir. Arama tamamen cihazda yapılır.

Veritabanı her yenilendiğinde `src/lib/poi.ts` içindeki `SURUM` numarası
artırılmalı; dosya adı numarayı taşıdığı için telefondaki eski kopya böylece
kendiliğinden değişir.

## 4. Eksik metro istasyonları — OSM'den tamamlama

İBB raylı sistem beslemesini 2023'ten beri güncellemiyor. O tarihten sonra açılan
istasyonlar veride yok: M3 Bakırköy Sahil–Kayaşehir ucu, M4'ün Sabiha Gökçen ucu,
M5'in Sultanbeyli ucu, M9'un Ataköy ucu; M11 ise hiç yok.

```powershell
python osm-cikar.py C:\otp\istanbul\Istanbul.osm.pbf osm-hatlar.json
python istasyon-tamamla.py osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

`osm-cikar.py` OSM'deki raylı sistem hat bağıntılarını (sıralı istasyon listesi,
işletmeci, resmî renk) JSON'a döker. `istasyon-tamamla.py` dört iş yapar:

1. **Parçalı hatları birleştirir.** OSM'de bazı hatlar iki bağıntı hâlinde duruyor
   (M7 = "Yıldız–Mecidiyeköy" + "Mecidiyeköy–Mahmutbey"). Uç istasyon adları
   tutuyorsa ve birleşimde tekrar eden istasyon oluşmuyorsa tek diziye bağlanır.
   Tekrar şartı, gidiş ve dönüş bağıntılarının yanlışlıkla uç uca eklenmesini önler.
2. **Mevcut hatları uzatır.** Eksikler hep uçlarda olduğu için İBB'nin gerçek
   tarifesi korunur, sefer dizisi iki uçtan uzatılır. Hizalama **her sefer için
   ayrı** yapılır: seferin kendi durak dizisi OSM dizisinin içinde ya da tersinde
   aranır, böylece gidiş–dönüş yönleri kendiliğinden doğru tarafa uzar. Yeni
   istasyonların saatleri o hattın kendi istasyon arası ortalamasından türetilir.
3. **Hiç olmayan hatları üretir.** `SIFIRDAN` sözlüğündeki hatlar (şu an yalnız
   M11) OSM dizisinden sıfırdan kurulur: uçtan uca süre istasyonlar arası mesafeye
   göre dağıtılır, sefer sıklığı `frequencies.txt` ile verilir. M11'in uçtan uca
   süresi (57 dk), ilk/son seferi (06:00 / 00:40) ve sıklığı (zirvede 20 dk) iki
   bağımsız kaynaktan okundu; **istasyonlar arası dağılım** tahminîdir.
4. **İmkânsız süreleri onarır.** Aralarında yüz metrelerce mesafe olmasına rağmen
   aynı saniyeye yazılmış istasyon çiftlerini (İBB'nin M7 Fulya–Yıldız hatası)
   mesafeye göre açar.

Yeni istasyonlar `osm-<düğüm no>` kimliğiyle eklenir; hiçbir seferde kullanılmayan
istasyonlar yazılmaz, yoksa İBB'de zaten olan duraklar aramada ikinci kez görünür.
Uzatılan seferlerin `shape_id` alanı boşaltılır, çünkü eski çizgi yeni uçları
kapsamıyor — çizgiyi `cizgi-ekle.py` geri veriyor (bkz. 6).

Betik zip dosyasını **yerinde** değiştirir; tekrar çalıştırmadan önce `hazirla-gtfs.mjs`
ile yeniden üretmek ya da yedekten dönmek gerekir.

## 4b. Hiç olmayan hatlar, kapanan hat, yanlış türler

```powershell
python eksik-hatlar.py C:\otp\osm-hatlar.json C:\otp\istanbul
```

2026-09 denetiminde OSM'de olup beslemede hiç bulunmayan hatlar: **T5** Eminönü–Alibeyköy
tramvayı, **T6** Sirkeci–Kazlıçeşme raylı sistemi, **F4** Hisarüstü–Aşiyan füniküleri.
Betik bunları OSM istasyon dizisinden kuruyor; saatler resmî sayfalardan (T5 06:00–00:00,
zirvede 5 dk, 32 dk; T6 25 dk arayla, son tren Sirkeci 23:05 / Kazlıçeşme 22:40, 18 dk;
F4 8 dk). T5'in zirve dışı sıklığı yayımlanmamış, 10 dk varsayıldı.

Ayrıca:

- **M3A** çıkarılıyor: 2021'de M9'un parçası oldu, M9 aynı istasyonları zaten kapsıyor.
- **M7, M8, M9** gündüz sıklıkları resmî değerlere çekiliyor. M8 beslemede yalnız hafta
  içi çalışıyordu (hafta sonu hiç yoktu) ve 4 dk görünüyordu; gerçekte her gün 7 dk.
- Raylı hatların sıklık pencereleri **kesin saatli** (`exact_times=1`) yapılıyor. OTP
  kesin olmayan sıklıkta yolcunun bir tam aralık beklediğini varsayıyordu (M7'de 6 dk);
  metrolu rotalar olduğundan uzun çıkıp otobüse yeniliyordu. Kesin saatte bekleme gerçek
  bir sonraki sefere göre ve bu seferler durak ekranında saatleriyle görünüyor.
- İETT beslemesinde **T2** (nostaljik tramvay) ve **F2** (Tünel) otobüs türünde
  duruyordu; türleri düzeltiliyor. T2'nin saatleri İETT'nin kendi tarifesi.

Betik yeniden çalıştırılabilir (kendi eklediklerini `ek-` kimliğinden tanıyıp önce
siliyor). Ardından `cizgi-ekle.py` ve `durak-birlestir.py` yeniden çalıştırılmalı.

## 4c. Metro İstanbul'un gerçek tarifesi

```powershell
node metro-tarife-indir.mjs C:\otp\metro-tarife.json
python metro-tarife-uygula.py C:\otp\metro-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

Metro İstanbul'un mobil uygulamasının servisi (`api.ibb.gov.tr/MetroIstanbul`) her
istasyonun her yöndeki gerçek kalkış saatlerini veriyor: hafta içi, cumartesi, pazar.
Servise bulut ortamından erişilemiyor (403); indirme betiği bu bilgisayarda çalışmalı.

Uygulama betiği her yönün seferlerini istasyon saatlerinden kuruyor (bir yönde her
istasyonun listesi aynı uzunlukta, k. sefer her istasyonun k. saati) ve beslemedeki o
hat-yönün eski seferlerinin yerine koyuyor. İstasyonlar beslemedeki durağa konum (400 m,
adı tutan durak dört kat yakın sayılır) ve sırayla bağlanıyor; M2'nin Sanayi–Seyrantepe
mekiği M2A'ya, M7'nin onarım nedeniyle bölünmüş işletmesi M7'nin duraklarına düşüyor.
Eski seferlerin uğramadığı istasyon (M7 Yeşilpınar) beslemedeki aynı adlı durağa, o da
yoksa servisin konumuyla yeni bir `mi-` durağına bağlanıyor. Servisin koordinatsız verdiği
istasyonlar (M5'in Sultanbeyli uzantısı) atlanıyor. Servisin boş döndüğü yönler eski
tarifesiyle kalıyor. Metro İstanbul'un güncel işletme duyuruları (onarım, bölünmüş hat)
çıktının sonunda yazılıyor.

Servisin iki tuhaflığı düzeltiliyor: son istasyona bir öncekinin saati yazılıyor (iki
istasyonlu füniküler ve teleferiklerde iki uç aynı dakika) — son aralığa beslemedeki eski
yol süresi ekleniyor; T3 ringinde saat listeleri gidiş yönünün tersine sıralı — T3 istasyon
sırasıyla ve servisin konumlarıyla kuruluyor (beslemedeki T3 durakları yanlış adlı).

T2 (İETT), T6, M11 ve Marmaray (TCDD), F2 (İETT) ve F3 Metro İstanbul servisinde yok;
onlar beslemedeki (ya da `eksik-hatlar.py`'nin eklediği) tarifeleriyle kalıyor.

Betik yeniden çalıştırılabilir ama eski yol sürelerini beslemeden okuduğu için en iyisi
`eksik-hatlar.py` çıktısı üzerinde çalıştırmak (yedeği `C:\otp\yedekler`'de tut).

`eksik-hatlar.py`'den sonra çalıştırılmalı (o T5'i ve M7/M8/M9 sıklıklarını yaklaşık
değerlerle yeniden kuruyor; bu betik gerçeğini koyuyor). Metro İstanbul tarifesini
değiştirdikçe yeniden indirip uygulamak yeter.

## 4d. Şehir Hatları'nın güncel vapur tarifesi

```powershell
node vapur-tarife-indir.mjs C:\otp\vapur-tarife.json
python vapur-tarife-uygula.py C:\otp\vapur-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

Beslemedeki Şehir Hatları seferleri 2023'ün tarifesiydi; bir kısmı sıklıkla tanımlıydı
("her 20 dakikada"), yeni hatlar (Bostancı–Moda–Kabataş, Maltepe–Adalar, Tuzla–Pendik–
Büyükada, Sedef Adası, İstinye–Çubuklu arabalı vapuru…) hiç yoktu. Şehir Hatları'nın
sitesi (`sehirhatlari.istanbul/tr/seferler/ic-hatlar`) her hattın tarifesini tablo olarak
veriyor. İndirme betiği tabloları hücre hücre, yorumlamadan alıyor; site bulut ortamından
erişilemiyor, bu bilgisayarda çalışmalı.

Uygulama betiği Şehir Hatları'nın bütün eski hat ve seferlerini silip sitenin 31 hattını
kuruyor (Turyol, Dentur, İDO'ya dokunmuyor):

- Gün türü tablo başlığından ("Hafta içi", "Cumartesi Günleri", "Her gün"…), yıldızlı
  dipnotlar saatin yanındaki yıldızla o sefere uygulanıyor ("* C.TESİ, PAZAR VE RESMİ TATİL
  GÜNLERİ YAPILMAZ", "** Sadece Pazar… yapılır"). "Yolcu almaz" o iskelede binişi kapatıyor,
  "…İskelesi'nde bitmektedir" seferi orada bitiriyor, "Eski/Yeni Kadıköy iskelesi" iskeleyi
  seçiyor. Anlaşılmayan dipnot çıktıda **uyarı** olarak yazılıyor: site yeni bir kalıp
  kullanmaya başlarsa oradan görünür.
- Parantezli saat sütun sırasının dışında uğranan iskele (Bostancı hattında vapur önce
  Karaköy'e, sonra Kabataş'a gidiyor); iskeleler saatine göre sıralanıyor.
- Tek sütunlu tablolar (Kadıköy–Kabataş, Beykoz–Sarıyer…) yalnız kalkış veriyor; varış
  öbür yönün kalkış iskelesi, yol süresi başka seferlerde görülen süreden, yoksa mesafeden.
- Gece hattı ("Cuma'yı cumartesiye bağlayan geceler") cuma ve cumartesi servis gününe,
  00:15 gibi saatler 24:15 olarak yazılıyor.
- Beslemede olmayan iskeleler (Moda, Maltepe, Tuzla, Pendik, Sedef Adası, Büyükdere)
  OpenStreetMap konumlarıyla ekleniyor. Eşleşmeyen iskele çıktıda yazılıyor.
- Resmî tatiller ayrı işlenmiyor; o günler olağan gün türüyle çalışıyor.

Ardından `durak-birlestir.py` (yeni iskeleler istasyonlara bağlansın) ve `siklik-cikar.py`
yeniden çalıştırılmalı. Şehir Hatları tarifesini değiştirdikçe (yaz/kış) yeniden indirip
uygulamak yeter; betik yeniden çalıştırılabilir.

### Turyol ve Dentur Avrasya

```powershell
node ozel-vapur-indir.mjs C:\otp\ozel-vapur-tarife.json
python ozel-vapur-uygula.py C:\otp\ozel-vapur-tarife.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

Beslemedeki iki özel işletmecinin seferleri İBB'nin eski verisindendi: Dentur'un
"Üsküdar–Kabataş" seferleri Beşiktaş'a gidiyordu, kalkmış hatlar (Eminönü–Bebek, Avcılar–
Adalar, Kabataş–Kadıköy, Turyol'un Beşiktaş–Kadıköy'ü) duruyordu. İndirme betiği iki
sitenin tarifesini okuyor (bu bilgisayarda çalışmalı), uygulama betiği iki işletmecinin
bütün eski hat ve seferlerini silip yenilerini kuruyor (Şehir Hatları'na ve İDO'ya
dokunmuyor):

- **Turyol** (`turyol.com/Home/Tarifeler`) yalnız "şu iskeleden şu iskeleye kalkış
  saatleri" veriyor. Seferler betikteki güzergâhlar üzerinde kuruluyor (Üsküdar–Karaköy–
  Eminönü, Kadıköy Yeni–Karaköy–Eminönü, Eminönü–Karaköy–Kadıköy–Adalar…): bir iskelenin
  kalkışı, önceki iskeleden kalkan vapurun beklenen varışına en yakın saatle eşleniyor
  (Karaköy 07:15 → Eminönü 07:25 → Kadıköy). Kalkışı olmayan iskelelerin saati yol
  süresinden; satılmayan biniş/iniş (Eminönü'nden Karaköy'e bilet yok) GTFS'te kapalı.
  Turyol yeni bir iskele çifti eklerse ve güzergâhlara oturmazsa çıktıda uyarı çıkar,
  sefer doğrudan sefer olarak eklenir; `TURYOL_GUZERGAH`'a eklemek gerekir.
- **Dentur** (`denturavrasya.com/tr-TR/hatlarimiz/…`): her hat sayfasındaki tarife elle
  yazılmış bir HTML parçası ve sayfaların biçimi farklı (kalkış tablosu, saat listesi,
  iskele sütunlu Adalar tablosu, alt alta Yalova seferi). Biçim değişirse indirme betiği
  o hattı boş bulup **durur**. "Arası sürekli sefer" aralıkları 10 dakikada bir sayılıyor
  (site sıklık vermiyor). Yalova grafiğin dışında: Yalova–Adalar seferinin İstanbul kısmı
  alınıyor.
- Aynı saatlerle birden çok gün türünde çalışan seferler tek sefer (birleşik gün maskesi).
- Bir site indirilemezse (çökmüş, biçimi değişmiş) önceki indirmedeki verisi kullanılıyor;
  o da yoksa o işletmecinin beslemedeki eski verisine dokunulmuyor. Kurulum durmuyor, çıktıda
  UYARI yazıyor.

Ardından `durak-birlestir.py` ve `siklik-cikar.py` (yenile.ps1 zaten sırayla yapıyor).
Yaz/kış tarifesi değişince yeniden indirip uygulamak yeter.

## 4e. Basamaksız (tekerlekli sandalye) arama

```powershell
python erisim-isaretle.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip C:\otp\istanbul\istanbul-iett-gtfs.zip
```

OTP tekerlekli sandalye aramasında varsayılan olarak **yalnız erişilebilir diye
işaretli** sefer ve durakları kullanıyor. Beslemelerde bu bilgi yok (İETT'de alan hiç
yok, raylıda çoğu "bilinmiyor"), o yüzden "Basamaksız güzergâh" açıkken hiç toplu taşıma
bulunamıyor, Bağcılar'dan Taksim'e 15 km, 3 saatlik yürüyüş öneriliyordu.

İki yarısı var:

1. `C:\otp\istanbul\router-config.json`: bilinmeyen sefer ve duraklar yasak değil,
   bedelli (biniş başına 5 dakikaya bedel); erişilemez diye işaretliler 1 saate bedel.
   Merdiven yine en son çare. Bu dosya derlemede değil sunucu açılırken okunur.

   ```json
   "routingDefaults": {
     "wheelchairAccessibility": {
       "trip":     { "onlyConsiderAccessible": false, "unknownCost": 300, "inaccessibleCost": 3600 },
       "stop":     { "onlyConsiderAccessible": false, "unknownCost": 300, "inaccessibleCost": 3600 },
       "elevator": { "onlyConsiderAccessible": false, "unknownCost": 20,  "inaccessibleCost": 3600 },
       "stairsReluctance": 100
     }
   }
   ```

2. `erisim-isaretle.py` bildiğimizi işaretliyor, bedeli yalnız bilinmeyenler ödesin:
   metro (M1A–M11), Marmaray, T1/T4/T5/T6 tramvayları ve F1/F3/F4 füniküleri erişilebilir
   (asansörlü istasyon, alçak taban ya da peron hizası); T2 ve T3 nostaljik tramvayları
   erişilemez (basamaklı araç); F2 ve teleferikler bilinmiyor. Otobüs ve vapura
   dokunulmuyor. Betik İETT'nin büyük dosyalarını belleğe almadan kopyalıyor.

Eğim hesaba katılmıyor: OTP'ye yükseklik verisi verilmediği için yokuşlar düz sayılıyor.

## 4f. Resmî tatiller ve bayramlar

```powershell
python ozel-gun-takvimi.py ..\assets\veri\ozel-gunler.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip C:\otp\istanbul\istanbul-iett-gtfs.zip
```

Beslemelerde tatil yok; 29 Ekim olağan bir perşembe gibi görünüyordu. Tatil günleri
`assets/veri/ozel-gunler.json`'da; betik her tatili o gün uygulanan tarifeye (pazar ya da
cumartesi) çeviriyor: tatilin hafta gününde çalışıp hedef günde çalışmayan servisler o gün
çıkarılıyor, hedef günde çalışanlar ekleniyor (`calendar_dates.txt`). Yeniden
çalıştırılabilir; İETT'nin büyük dosyaları belleğe alınmadan kopyalanıyor.

Aynı dosyayı uygulama da okuyor: o gün aranan rotada ücretsiz hatlar 0 ₺ görünüyor ve
listenin üstünde bir not çıkıyor. Kurallar (2026'daki duyurulara göre):

- **Tarife:** millî bayramlarda ve bayramın ilk gününde pazar, bayramın öbür günlerinde
  cumartesi (İETT 2026 Kurban Bayramı duyurusu). Şehir Hatları'nın tablolarında zaten
  "Pazar ve Resmî Tatil Günleri" yazıyor.
- **İBB hatları** (İETT, Metro İstanbul, Şehir Hatları): dinî ve millî bayramlarda
  kişiselleştirilmiş İstanbulkart'la ücretsiz; Adalar'daki İETT hatları, T2, Tünel,
  SG-1/SG-2 ve 139/139A hariç. 1 Ocak, 1 Mayıs ve 15 Temmuz'da ücretli.
- **TCDD** (Marmaray, T6, M11): Cumhurbaşkanı kararıyla millî bayramlarda, 1 Mayıs'ta,
  15 Temmuz'da ve bayramlarda ücretsiz.
- Minibüs, dolmuş, Turyol, Dentur, İDO ücretli.

Bu kararlar her yıl ayrıca duyuruluyor; İETT her tatil için hangi tarifeyi uygulayacağını
da duyuruyor. Duyuru farklıysa dosyadaki o günü düzeltip betiği yeniden çalıştır, sonra OTP
grafiğini derle ve uygulamayı yenile. Arife günleri (öğleden sonra yarım gün) işlenmiyor.

## 5. Marmaray'ın kısa dönüş hattı

```powershell
python marmaray-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

İBB verisinde Marmaray üç hat olarak duruyor: tam hat (Halkalı–Gebze, 43 istasyon,
15 dakikada bir), kısa dönüş (8 dakikada bir) ve Halkalı–Bahçeşehir banliyösü. İki
kusur düzeltiliyor:

- **Kapsam:** kısa dönüş hattı veride yalnızca tünelin yedi istasyonunu (Zeytinburnu–
  Söğütlüçeşme) kapsıyor, gerçekte **Ataköy–Pendik** arasında çalışıyor. Betik seferleri
  tam hattın kendi istasyon sırası ve geçiş süreleriyle iki uçtan uzatıyor — saatler
  uydurulmuyor, tam hattın seferinden alınıyor. Sonuç: 7 → 25 istasyon.
- **Sıklık:** TCDD'nin günlük tren saatleri sayfası "Gebze–Halkalı 15 dk, Ataköy–Pendik
  8 dk" diyor; aynı sayfadaki günlük sefer sayıları (Gebze-Halkalı-Gebze 148, Pendik-
  Ataköy-Pendik 139) ise kısa dönüş trenlerinin de ~15 dakikada bir kalktığını gösteriyor
  (8 dakikada bir olsa ~270 sefer olurdu). "8 dk", Ataköy–Pendik arasında iki hattın
  birlikte verdiği aralık. Betik kısa dönüşü 15 dakikaya çekiyor ve uzun trenlerin
  arasına yerleştiriyor (Sirkeci'de 7,5 dakika arayla). Veride 8 dakikalık sıklık
  Ataköy–Pendik arasında treni olduğundan iki kat sık gösteriyordu.

İstasyon saatleri yayımlanmadığı için Marmaray saatleri hâlâ yaklaşık (sıklıktan).

## 6. Hat çizgileri — OSM'den ray geometrisi

```powershell
python cizgi-ekle.py C:\otp\osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

Uzatılan ve sıfırdan üretilen hatların `shape_id`'si boş kalıyor; OTP o zaman
duraklar arasını düz çizgiyle birleştiriyor, yolculuk ekranındaki harita M4'ü
Kadıköy'den Sabiha Gökçen'e düz bir çizgi olarak, Marmaray1'i de Boğaz'ın
üstünden geçiriyordu.

`osm-cikar.py` artık bağıntının yol üyelerinin geometrisini de çıkarıyor. Aynı hat
OSM'de hem gidiş hem dönüş bağıntısı olarak durduğu için önce kopyalar eleniyor —
elenmezlerse uç uca eklenip hattı iki katı uzunlukta, gidip geri gelen bir çizgi
yapıyorlar (M4 32,7 km yerine 65,4 km çıkmıştı). Kalanlar (M7 gibi gerçekten
parçalı hatlar) uçlarından bağlanıyor.

Güvenlik ağı: çizgi ancak seferin **bütün** durakları ona 300 m'den yakınsa ve
duraklar çizgi boyunca sırayla ilerliyorsa kullanılıyor. Marmaray1 bu sınavı tam
hattın (OSM'de `B1`) çizgisiyle geçiyor; ölçülen en büyük sapma 69 m.

Çizgisi zaten olan seferlere dokunulmuyor.

## 6b. Vapur çizgileri — denizden

```powershell
python vapur-cizgi.py cikar C:\otp\istanbul\Istanbul.osm.pbf C:\otp\osm-kiyi.json   # bir kez, osmium gerekir
python vapur-cizgi.py ekle C:\otp\osm-kiyi.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

Tarifeden kurulan vapur seferlerinin (Şehir Hatları, Turyol, Dentur) çizgisi yoktu; OTP
iskeleleri düz çizgiyle birleştirince Eminönü–Kadıköy Sarayburnu'nu, Üsküdar–Kadıköy
Harem'i, Haliç hattı Kasımpaşa'yı kesiyordu. Betik OSM kıyı çizgisinden 40 metrelik bir
deniz ızgarası kuruyor (kıyı duvar, deniz Marmara ve Boğaz'daki tohumlardan doldurulan
bölge). İki iskele arası düz çizgi baştan sona denizdense düz kalıyor (karşıya geçişler,
Adalar); değilse ızgarada en kısa deniz yolu bulunup köşeleri sadeleştiriliyor. Doldurma
bilinen kara noktalarına sızarsa (kıyı çizgisinde kopukluk) betik hiçbir şey yazmıyor.
Sonuç `C:\otp\vapur-cizgi-onizleme.png`'deki gibi: 59 bacak düz, 171 bacak kıyıyı
dolanıyor, karadan geçen çizgi yok.

## 7. Durakları istasyon altında toplama

```powershell
python durak-birlestir.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python durak-birlestir.py C:\otp\istanbul\istanbul-iett-gtfs.zip
```

İki beslemede de `parent_station` baştan sona boştu: "Üsküdar" araması altı sonuç
veriyordu (Marmaray, M5, ŞH., Turyol, Dentur, Beşiktaş-Üsküdar), otobüste yolun
iki yakası ayrı durak olduğu için daha da kötüydü.

Kural iki parçalı:

1. Sadeleştirilmiş ad aynı **ve** mesafe eşiğin altında — raylı-raylı 350 m,
   diğerleri 200 m. Ad tek başına yetmiyor: "FATİH MAHALLESİ" şehirde 17 yerde
   geçiyor, aralarında 64 km var. Sadeleştirme işletmeci ve araç eklerini atıyor
   ("Üsküdar ŞH.", "ÜSKÜDAR MARMARAY" → `uskudar`).
2. Adı tutmayan gerçek aktarmalar `EL_ILE` listesinde, her satırın yanında ölçülen
   mesafe duruyor (Ayrılıkçeşme/Ayrılık Çeşmesi 16 m, Mecidiyeköy/Şişli-Mecidiyeköy
   183 m…). Tartışmalı adaylar aynı yerde yorum olarak listeli.

Sonuç: raylı+vapur 3.337 → 1.543 istasyon, İETT 12.078 → 5.782. Küme çapı
ortancası 28–36 m.

`parent_station` OTP'de bedava aktarma açmıyor; yürüme süreleri yine sokak ağından
hesaplanıyor. Kazanç aramada ve aktarma modelinde. Betik yeniden çalıştırılabilir:
önceki turun istasyonlarını temizleyip baştan kuruyor.

## 8. Hat adları

```powershell
python hat-adi-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

`istasyon-tamamla.py` hatları uzatıyor ama `route_long_name`'e dokunmuyordu: M4
"KADIKÖY - TAVŞANTEPE" yazıyordu, oysa Sabiha Gökçen'e kadar gidiyor. Ad hat
listesinde ve hat ekranında görünüyor.

Ad ancak uç istasyonlardan **en az biri** adın içinde geçmiyorsa değiştiriliyor;
böylece M11'in "GAYRETTEPE - İSTANBUL HAVALİMANI - HALKALI"sı korunuyor (iki ucu
da içeriyor, ayrıca aradaki havalimanını söylüyor). Halka hatlara hiç
dokunulmuyor: T3'ün iki ucu da Kadıköy iskelesinde, uçlardan ad üretmek
"KADIKÖY - MODA"yı "İSKELE CAMİ - KADIKÖY İDO"ya çeviriyordu.

Yenilenenler: M3, M4, M5, M6, M8, M9, M1B.

## 9. Ağ haritası verisi

```powershell
python ag-cikar.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip ..\assets\veri\ag.json
```

Ağ haritası bütün raylı hatları aynı anda çiziyor. Bunu her açılışta OTP'den
çekmek hem yavaş hem sunucuya bağımlı olurdu; veri seyrek değiştiği için
uygulamayla birlikte gidiyor. Çizgiler Google polyline (5 basamak) ile
sıkıştırılıyor — uygulama zaten `src/lib/cografya.ts` içinde çözüyor.

24 hat, **46 KB**. Zip her yenilendiğinde bu dosya da yenilenmeli.

## Grafiği derleme

```powershell
cd C:\otp
java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul
java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul
```

## Minibüs ve dolmuş sıklıkları

```powershell
python siklik-cikar.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip ..\assets\veri\siklik.json
```

Minibüs ve dolmuş seferleri GTFS'te saatli değil, sıklık pencereleri olarak duruyor
(`frequencies.txt`). OTP bunları durak kalkışlarında göstermiyor ve API'sinde sıklık
alanı yok; uygulama "Her 5 dk · son sefer 23:00" yazısını bu dosyadan üretiyor
(`src/lib/siklik.ts`). GTFS yenilenince bu betik de yeniden çalıştırılmalı.
