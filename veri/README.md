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

## Grafiği derleme

```powershell
cd C:\otp
java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul
java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul
```
