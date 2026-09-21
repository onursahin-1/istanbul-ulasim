# Veri hattı

Uygulamanın kullandığı üç veri kümesi burada üretiliyor. Hiçbiri sürüm kontrolüne
girmiyor (büyükler), betikler giriyor.

## Çalıştırma sırası

Betiklerin çoğu zip'i **yerinde** değiştiriyor ve sıraya bağlı. Baştan kurarken:

```powershell
node hazirla-gtfs.mjs C:\otp\istanbul                                        # 1
python osm-cikar.py C:\otp\istanbul\Istanbul.osm.pbf C:\otp\osm-hatlar.json  # 2
python istasyon-tamamla.py C:\otp\osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python marmaray-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python cizgi-ekle.py C:\otp\osm-hatlar.json C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python durak-birlestir.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
python durak-birlestir.py C:\otp\istanbul\istanbul-iett-gtfs.zip
python dogrula.py C:\otp\istanbul                                          # sağlama
```

Yarıda kalmış bir zip'e yeniden çalıştırmak yerine `hazirla-gtfs.mjs` ile baştan
üretmek gerekiyor. **Elle alınmış yedeklere güvenme**: `hazirla-gtfs.mjs` zaman
içinde düzeldiği için eski bir yedek, araç tipi yanlış atanmış bir sürüm olabilir.
`dogrula.py` çıktısındaki hat sayıları (12 metro, 3 Marmaray, 3 tramvay…) bu tür
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

Sağlama: derleme sonrası hat sayıları beklenene yakın olmalı — 12 metro,
3 Marmaray, 3 tramvay, 3 füniküler, 2 teleferik, ~100 vapur, kalanı otobüs/minibüs.

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

## 5. Marmaray'ın kısa dönüş hattı

```powershell
python marmaray-duzelt.py C:\otp\istanbul\istanbul-ray-vapur-gtfs.zip
```

İBB verisinde Marmaray üç hat olarak duruyor: tam hat (Halkalı–Gebze, 43 istasyon,
15 dakikada bir), kısa dönüş (8 dakikada bir) ve Halkalı–Bahçeşehir banliyösü.
Sıklıkların ikisi de TCDD'nin yayımladığı değerlerle uyuşuyor; kusur kapsamda:
kısa dönüş hattı veride yalnızca tünelin yedi istasyonunu (Zeytinburnu–Söğütlüçeşme)
kapsıyor, gerçekte **Ataköy–Pendik** arasında çalışıyor.

Bu yüzden Bakırköy'de ya da Maltepe'de uygulama 15 dakikada bir tren gösteriyordu;
gerçekte iki hat üst üste binip 5-6 dakikaya iniyor. Betik kısa dönüş seferlerini tam
hattın kendi istasyon sırası ve kendi geçiş süreleriyle iki uçtan uzatıyor — saatler
uydurulmuyor, tam hattın seferinden alınıyor. Sonuç: 7 → 25 istasyon.

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

## Grafiği derleme

```powershell
cd C:\otp
java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul
java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul
```
