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
| `/arac-konumlari` | GTFS-RT VehiclePosition | `vehicle-positions` |
| `/sefer-guncellemeleri` | GTFS-RT TripUpdate | `stop-time-updater` |
| `/durum` | insan için JSON özet | — |

Ortam değişkenleri: `GTFS_ZIP` (varsayılan `C:\otp\istanbul\istanbul-iett-gtfs.zip`),
`PORT` (8082 — 8080 OTP'nin, 8081 Expo'nun), `NABIZ` (40 saniye), `DAKIKADA` (18).

## OTP tarafı

`C:\otp\istanbul\router-config.json` dosyasını oluştur. `feedId` **senin grafiğindeki
besleme kimliği** olmalı; Ayarlar sekmesindeki "TARİFE VERİSİ" bölümü onu listeliyor,
ya da sunucuya sorabilirsin:

```powershell
curl.exe -s -X POST http://localhost:8080/otp/gtfs/v1 -H "Content-Type: application/json" -d "{\"query\":\"{feeds{feedId agencies{name}}}\"}"
```

```json
{
  "updaters": [
    {
      "type": "vehicle-positions",
      "feedId": "BURAYA_FEED_ID",
      "url": "http://localhost:8082/arac-konumlari",
      "frequency": "45s",
      "features": ["position"]
    },
    {
      "type": "stop-time-updater",
      "feedId": "BURAYA_FEED_ID",
      "url": "http://localhost:8082/sefer-guncellemeleri",
      "frequency": "45s"
    }
  ]
}
```

Grafiği yeniden derlemeye gerek yok; OTP'yi `--load --serve` ile yeniden başlatmak yeter.

## Nasıl çalışıyor

**İBB'nin ağ geçidi hız sınırlı.** İlk tasarım 784 hattı 45 saniyede bir tarıyordu ve
kapıyı kapattırdı (`Policy Falsified / Rate limit exceeded`). Mimari buna göre kuruldu:
bütün istekler tek bir kapıdan geçiyor, kapı hızı sınırlıyor ve sınıra takılınca ceza
süresi katlanarak artıyor. Israr etmek sınırı uzatır.

İki hızda çalışıyor:

- **Nabız** (40 saniyede bir, **tek istek**) — `GetFiloAracKonum_json` bütün filonun
  taze konumunu veriyor. Hat bilgisi içermiyor.
- **Tarama** (arka planda, yavaş) — `GetHatOtoKonum_json` hat hat sorularak hangi
  aracın hangi güzergâhta olduğu öğreniliyor. Bir otobüs turunu bitirene kadar hattını
  değiştirmediği için bu eşleme dakikalarca geçerli kalıyor. Yoğun hatlar öne alınıyor.

İkisi **kapı numarası** üzerinden birleşiyor. Sonra aracı seferine bağlamak için:

1. Güzergâh kodu (`34G_G_D0`) → GTFS `route_code`. Ölçüldü: **%100 eşleşme**.
2. Konum → o rotanın en yakın durağı. Filo servisi durak kodu vermediği için
   mesafeden hesaplanıyor.
3. O rotanın, o duraktan, şu ana en yakın saatte geçen aktif seferi seçilir.

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

## Sınırlar

- Yalnızca İETT otobüs ve minibüsleri. Metro, Marmaray, tramvay ve vapurda canlı veri
  yok; onlar tarifeye göre çalışmaya devam eder.
- İBB'de varış tahmini servisi yok; gecikme aracın bulunduğu duraktaki sapmadan
  hesaplanıyor, OTP onu seferin geri kalanına yayıyor.
- Veri 50–60 saniye geride geliyor.
- Köprü OTP ile aynı makinede çalışmalı (ya da OTP'nin erişebileceği bir adreste).
- Eşleşme oranı örnek veride **%91**. Kalan araçlar güzergâhın belirgin biçimde
  dışında: garajda ya da boş sefer yapıyorlar.
- Hat eşlemesi taramanın tur süresi kadar eskiyebiliyor. Yeni sefere çıkan bir araç,
  tarama ona uğrayana kadar akışta görünmez.
