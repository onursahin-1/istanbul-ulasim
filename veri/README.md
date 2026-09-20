# Veri hattı

Uygulamanın kullandığı üç veri kümesi burada üretiliyor. Hiçbiri sürüm kontrolüne
girmiyor (büyükler), betikler giriyor.

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
   göre dağıtılır, sefer sıklığı `frequencies.txt` ile verilir. Bu hattın saatleri
   **tahminîdir**, İBB verisi değildir.
4. **İmkânsız süreleri onarır.** Aralarında yüz metrelerce mesafe olmasına rağmen
   aynı saniyeye yazılmış istasyon çiftlerini (İBB'nin M7 Fulya–Yıldız hatası)
   mesafeye göre açar.

Yeni istasyonlar `osm-<düğüm no>` kimliğiyle eklenir; hiçbir seferde kullanılmayan
istasyonlar yazılmaz, yoksa İBB'de zaten olan duraklar aramada ikinci kez görünür.
Uzatılan seferlerin `shape_id` alanı boşaltılır, çünkü eski çizgi yeni uçları
kapsamıyor.

Betik zip dosyasını **yerinde** değiştirir; tekrar çalıştırmadan önce `hazirla-gtfs.mjs`
ile yeniden üretmek ya da yedekten dönmek gerekir.

## Grafiği derleme

```powershell
cd C:\otp
java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul
java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul
```
