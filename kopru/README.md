# Canlı veri köprüsü

İETT'nin canlı araç konumlarını GTFS-RT'ye çevirip OpenTripPlanner'a sunar. OTP bunu
okuduğunda rota süreleri ve varış saatleri gerçek gecikmeye göre düzelir, araçlar da
haritada görünebilir hâle gelir.

```powershell
cd C:\projeler\istanbul-ulasim\kopru
npm install      # bir kez
npm start
```

Sunucu `http://localhost:8082` adresinde üç uç nokta açar:

| Adres | Ne | OTP karşılığı |
|---|---|---|
| `/arac-konumlari` | GTFS-RT VehiclePosition | `VEHICLE_POSITIONS` |
| `/sefer-guncellemeleri` | GTFS-RT TripUpdate | `STOP_TIME_UPDATER` |
| `/duyurular` | İETT hat duyuruları, JSON (15 dakikada bir tazelenir). BÜYÜK HARFLİ metinler cümle düzenine çevrilir, düşen Türkçe harfler geri konur (`yazim.mjs`); özgün metin `ham` alanında | uygulama doğrudan okur |
| `/durum` | insan için JSON özet | — |

Ortam değişkenleri: `GTFS_ZIP` (varsayılan `C:\otp\istanbul\istanbul-iett-gtfs.zip`),
`PORT` (8082 — 8080 OTP'nin, 8081 Expo'nun), `BUTCE` (saatte 80 istek; İBB'nin sınırı
100, 95'in üstü reddediliyor), `NABIZ` (120 saniye), `OGRENILEN` (öğrenilenlerin
dosyası, varsayılan `kopru\ogrenilen.json`).

Kapının açık olup olmadığına **tek istekle** bakmak için (köprü kapalıyken):

```powershell
node kopru\hiz-siniri.mjs
```

Köprü ve OTP açıkken zincirin baştan sona çalıştığını görmek için:

```powershell
node kopru\canli-kontrol.mjs
```

Birim testleri: `npm test` (kopru klasöründe).

## OTP tarafı

OTP açıkken tek komut yeter; besleme kimliğini OTP'ye sorar, İETT beslemesini
işletme adından bulur ve `C:\otp\istanbul\router-config.json`'u yazar:

```powershell
node kopru\otp-ayari-yaz.mjs
```

Elle yazmak istersen: `feedId` **senin grafiğindeki besleme kimliği** olmalı; Ayarlar sekmesindeki "TARİFE VERİSİ" bölümü onu listeliyor,
ya da sunucuya sorabilirsin:

```powershell
curl.exe -s -X POST http://localhost:8080/otp/gtfs/v1 -H "Content-Type: application/json" -d "{\"query\":\"{feeds{feedId agencies{name}}}\"}"
```

```json
{
  "updaters": [
    {
      "type": "VEHICLE_POSITIONS",
      "feedId": "BURAYA_FEED_ID",
      "url": "http://localhost:8082/arac-konumlari",
      "frequency": "45s",
      "features": ["POSITION"]
    },
    {
      "type": "STOP_TIME_UPDATER",
      "feedId": "BURAYA_FEED_ID",
      "url": "http://localhost:8082/sefer-guncellemeleri",
      "frequency": "45s"
    }
  ]
}
```

**Enum değerleri büyük harfle yazılmalı.** OTP'nin belgelerinde `vehicle-positions`
gibi küçük harfli yazımlar geçiyor; bunlar Türkçe Windows'ta çalışmıyor. OTP gelen
değeri dil belirtmeden büyük harfe çeviriyor ve Türkçede `i` → `İ` olduğu için
`vehicle-positions` → `VEHİCLE-POSİTİONS` oluyor, hiçbir enum'a uymuyor:
`The parameter value 'vehicle-positions' is not legal`. Enum adının kendisini
(`VEHICLE_POSITIONS`) yazınca çeviri bir şey değiştirmiyor. OTP 2.10'un kendisiyle
hem Türkçe hem İngilizce dil ayarında sınandı.

Grafiği yeniden derlemeye gerek yok; OTP'yi `--load --serve` ile yeniden başlatmak yeter.

## Nasıl çalışıyor

**İBB'nin kotası saatte 100 istek.** İETT Web Servis Kullanım Dokümanı: "Bu servise bir
saat içerisinde en fazla 100 kere istek gönderilebilmektedir." Köprünün ilk iki tasarımı
bunu bilmeden yazıldı ve ikisi de kapıyı kapattırdı: ilki 45 saniyede 784 istek, ikincisi
dakikada ~20 istekle ~12 dakikada 100'ü doldurdu.

Şimdi bütün istekler tek bir kapıdan geçiyor ve **son 60 dakikada en fazla 80 istek**
kuralına uyuyor (`butce.mjs`); tasarım gereği aşılamıyor. 20'lik pay, İBB'nin bizim
göremediğimiz istekleri de saymasına karşı. İki istek arasında en az 7 saniye var:
aynı servisleri kullanan başka bir proje, ağ geçidinin arka arkaya ~15 hızlı istekte
her servisi kestiğini yazmış. Yine de sınıra takılınırsa kapı 15 → 30 → 60 dakika
kapanıyor; kota saatlik olduğu için dakikalar içinde yeniden denemek yalnızca cezayı
uzatır.

Bütçe ikiye bölünüyor:

- **Nabız** (2 dakikada bir, **tek istek**, saatte 30): `GetFiloAracKonum_json` bütün
  filonun taze konumunu veriyor. Hat bilgisi içermiyor.
- **Tarama** (kalan bütçe, ~75 saniyede bir hat, saatte ~48): `GetHatOtoKonum_json`
  hat hat sorularak hangi aracın hangi hatta olduğu öğreniliyor. En yoğun hatlar önce;
  hiç sorulmamış hatların yoğunluğu tarifedeki sefer sayısından tahmin ediliyor.
  Gece 01:00–05:00 tarama duruyor: o saatte sorulan hat "0 araç" diye kaydedilip
  gündüz sırasında en sona düşüyordu. Tek bir düşük sayım da hattın önceliğini
  silmesin diye araç sayısı yumuşatılıyor.

784 hattın bir turu bu hızla ~16 saat. Bunu işe yarar kılan gözlem: **bir İETT otobüsü
gün boyu, çoğu zaman günlerce aynı hatta çalışıyor.** Öğrenilen "araç → hat" bilgisi
`ogrenilen.json`'a yazılıyor ve bir hafta tutuluyor; köprü her açılışta sıfırdan
başlamıyor, kapsama günden güne büyüyor. Son bir saatin istekleri de dosyada: köprüyü
kapatıp açmak kotayı sıfırlamıyor. Hat listesi günde bir kez isteniyor.

Aracı seferine bağlamanın üç yolu var, bu sırayla:

1. **Önceki seferinde kal.** Araç önceki nabızda bir sefere bağlandıysa ve hâlâ o seferin
   güzergâhında ilerliyorsa o seferde kalır. Araçların çoğu buradan geçer.
2. **Taze güzergâh kodu.** Tarama aracı son 20 dakikada gördüyse güzergâh kodu
   (`34G_G_D0`) doğrudan kullanılır; GTFS `route_code` ile eşleşmesi %100.
3. **Hat biliniyor, yön hareketten** (`yon.mjs`). Yön her seferde değiştiği için eski
   güzergâh kodu güvenilmez. Aracın iki ardışık konumuna bakılıyor: hattın varyantlarından
   aracın durak sırasında ilerlediği varyantlar aday. Araç tarandığı güzergâhta hâlâ
   ilerliyorsa o güzergâh; dönmüşse eski kodun **koridorundaki** (uçları aynı ya da yer
   değiştirmiş) varyantlar kalıyor. Sonra saati en iyi tutan sefer seçiliyor.

   Gerçek veriyle ölçüldü (276 araç, bayat güzergâh kodu): araç aynı yönde devam
   ediyorsa **%100** doğru güzergâh; tarandıktan sonra dönmüşse **%99,6** doğru yol ve
   **hiç ters yön yok**. "Yanlış varyant" sayılan durumların neredeyse hepsi (82/83)
   durakları birebir aynı, yalnız tarifesi farklı varyantlar (`34G_D_D0` ile
   `34G_D_D9006` gibi); orada şu ana en yakın seferi seçmek zaten en iyi tahmin.

Her iki yolda da konum, o güzergâhın en yakın durağına çevriliyor (filo servisi durak
kodu vermiyor) ve o duraktan şu ana en yakın saatte geçen aktif sefer seçiliyor.

**İBB yanıt vermezse geri çekiliyor.** `HTTP 503`, bağlantı hatası ya da zaman aşımında
kapı 2 → 4 → 8 → 16 → 30 dakika hiç istek göndermiyor, ilk başarılı istekte sıfırlanıyor.
Bu bir hız sınırı değil (onun yanıtında "Rate limit" yazıyor ve ayrı işleniyor): sunucu
tarafı arıza, çoğunlukla gece. Eskiden nabız ve tarama arıza boyunca saatte ~75 isteği boşa
yolluyordu. Tarama bu sürede hat atlamıyor, arıza bitince kaldığı yerden sürüyor.
`/durum`'da `kapi.kalanArizaSn` ve `kapi.arizaNedeni`.

**Bayat veri yayımlanmıyor.** Son başarılı nabız 5 dakikadan eskiyse köprü boş akış
sunuyor. İkinci tasarım kapı kapandıktan sonra da son veriyi sunmaya devam ediyordu ve
OTP eski gecikmeleri uygulamayı sürdürdü.

**Makul olmayan gecikmeler yayımlanmıyor** (10 dakikadan erken, 30 dakikadan geç).
Böyle bir fark, o saatte o duraktan hiç sefer geçmediği anlamına geliyor: araç büyük
ihtimalle yolcu almadan garaja dönüyor ya da komşu bir sefere bağlandı. Gerçek bir
örnekte 277 araçtan 4'ü böyleydi (-38, -19, -10, +40 dk). OTP gecikmeyi seferin geri
kalanına yaydığı için tek bir yanlış değer bütün varış tahminlerini kaydırıyor.
`/durum`'daki `makulDisi` sayacı kaç aracın elendiğini gösteriyor.

Tarifenin tamamı belleğe alınıyor (6,1 milyon durak-saat satırı, tipli dizilerde
~3 saniye ve ~650 MB).

**Durak eşiği hatta göre değişiyor.** Şehir içi hatlarda duraklar 300 metre arayken
metrobüste 1–2 kilometre; iki durak arasındaki bir metrobüs en yakın durağa 700 metre
uzakta olabiliyor. Sabit 400 metrelik eşik metrobüs araçlarının beşte birini
"güzergâh dışı" sayıyordu. Eşik artık hattın kendi durak aralığından türetiliyor.

**Bir tuzak:** İETT beslemesinde bir seferin yalnızca ilk ve son durağında saat yazılı,
aradakiler boş — OTP onları doğrusal ara değerliyor. Biz de aynısını yapmadan önce
sefer eşleşmesi %7'de kalıyordu; ara değerlemeyle %98'e çıktı.

**İkinci tuzak:** araç bir kez bir sefere bağlandıktan sonra o seferde tutuluyor
(`SeferHafizasi`). Yoksa 10 dakika geciken bir otobüs her taramada "bir sonraki
seferin aracı" sanılır ve gecikme hiç görünmez. Araç durak sırasında geriye giderse
yeni tur başlamış sayılır ve eşleştirme yenilenir.

**Her sefer tek araca.** Metrobüs gibi sık hatlarda tarifedeki seferler 1–2 dakika
arayla; araçları "şu ana en yakın saatteki sefere" bağlamak otobüslerin ~%30'unu başka bir
otobüsle aynı sefere düşürüyordu. Akışa seferin yalnız öndeki aracı giriyor, arkadakinin
bilgisi boşa gidiyordu. Şimdi çakışan grupta tarifeye en yakın araç seferde kalıyor (fark
bir dakikadan azsa önceki nabızda da o seferde olan), öbürleri kendi durağından geçen ve
henüz kimseye verilmemiş en yakın sefere geçiyor (`seferleriAyristir`). `/durum`'da
`ayrilan` başka sefere geçirilen, `cakisan` boş sefer bulamayıp düşen araç sayısı.

**Gecikme aracın bulunduğu noktada ölçülüyor.** Eskiden en yakın durağın saatiyle
karşılaştırılıyordu: o durağa 400 m kala görülen otobüs, oraya daha varmadığı için
planın gerisinde görünüp "erken" sayılıyor, durağı geçmiş olan ise olduğundan geç.
Varış tahminleri durak arası sürenin yarısı kadar oynuyordu. Şimdi araç iki durak
arasına yerleştiriliyor (`konumdakiPlan`), plan o noktada ara değerleniyor ve güncelleme
**sıradaki durak** için yayımlanıyor.

### Doğruluk ölçümü

Köprü kendi tahminlerini denetliyor (`kalite.mjs`). Her nabızda araç için 1, 4 ve 10
durak sonrasına bir varış tahmini not ediliyor (OTP gibi "gecikme sabit kalır"
varsayımıyla); araç o durağı geçince geçiş anı iki gözlem arasında ara değerlenip
tahminle karşılaştırılıyor. Aynı tahmin eski yöntemle de hesaplanıyor.

```
node kalite-rapor.mjs              # bugünün özeti
node kalite-rapor.mjs 2026-09-26   # belirli bir gün
```

`hata = gerçek varış − tahmin`: artı ise otobüs tahminden geç geldi, eksi ise erken.
Ortalama sıfırdan belirgin uzaksa tahminler bir yöne kayık demektir. Ölçüm
`kayit/kalite-YYYY-MM-DD.json`'a 5 dakikada bir yazılıyor ve `/durum`'da `kalite`
alanında. Köprü yeniden başlarsa o günün sayımı sıfırdan başlar. Nabız 2 dakikada bir
olduğu için geçiş anı ±1 dakika içinde bilinir; ortalama bundan etkilenmez, tek tek
örnekler etkilenir.

### Öğrenilen yol süreleri

İETT tarifesinde bir seferin yalnız ilk ve son durağının saati var; aradakilere süre eşit
dilimlerle uyduruluyor (Köprü'deki 34G tarifede 3 dakika). Köprü bunun yerine otobüslerin
gerçek süresini öğreniyor (`segment.mjs`): aynı otobüsün art arda iki gözlemi arasında
geçtiği durakların geçiş anı mesafeye göre ara değerleniyor, ardışık iki geçişin farkı o
durak çiftinin bir ölçümü. Durak çiftleri hattan bağımsız (Metrobüs yolunu 34, 34G, 34AS
birlikte öğretiyor), saat dilimi (00–06, 06–10, 10–16, 16–20, 20–24) ve hafta içi/sonu
ayrı. Bir dilimde en az 4 ölçüm olunca kullanılıyor; her gece eski ölçümlerin ağırlığı
%15 azalıyor. Kayıt `kayit/segment-sureleri.json`, özet `/durum`'da `segment`.

Şimdilik yalnız ölçülüyor: doğruluk raporunda (`node kalite-rapor.mjs`) "öğren." satırı,
aynı tahminin öğrenilen sürelerle yapılmış hâli. Tarifeden belirgin biçimde iyi çıkarsa
canlı akışa, sonra da rota motorunun tarifesine geçecek.

## Sınırlar

- Yalnızca İETT otobüs ve minibüsleri. Metro, Marmaray, tramvay ve vapurda canlı veri
  yok; onlar tarifeye göre çalışmaya devam eder.
- İBB'de varış tahmini servisi yok; gecikme aracın bulunduğu duraktaki sapmadan
  hesaplanıyor, OTP onu seferin geri kalanına yayıyor.
- Köprü OTP ile aynı makinede çalışmalı (ya da OTP'nin erişebileceği bir adreste).
- Eşleşme oranı örnek veride **%91**. Kalan araçlar güzergâhın belirgin biçimde
  dışında: garajda ya da boş sefer yapıyorlar.
- **Kapsama zamanla büyüyor.** İlk gün yoğun hatlar birkaç saatte, filonun çoğu bir iki
  günde öğreniliyor. Hattı hiç taranmamış bir araç akışta görünmez. İBB'den daha yüksek
  kota alınırsa `BUTCE` ile tarama hızlandırılabilir (ama 100'ün üstüne çıkmaz).
- Nabız 2 dakikada bir: canlı konum en fazla ~3 dakika geride.
