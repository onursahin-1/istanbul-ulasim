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
`PORT` (8082 — 8080 OTP'nin, 8081 Expo'nun), `ARALIK` (45 saniye), `ESZAMANLI` (10).

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

İETT'nin servisi boş hat koduyla bütün filoyu vermiyor, hat hat soruyor. 784 hattı
10 eşzamanlı istekle tarıyoruz; bütün şehir ~20 saniyede çıkıyor, ~6.900 araç.

Asıl iş, aracı **hangi seferi yaptığına** bağlamak: GTFS-RT her şeyi sefer düzeyinde
ister, İETT ise yalnızca hat, yön ve en yakın durak verir. Bağlantı şöyle kuruluyor:

1. `guzergahkodu` (`34G_G_D0`) → GTFS `route_code`. Ölçüldü: **%100 eşleşme**.
2. `yakinDurakKodu` (`900021`) → GTFS `stop_code`. Ölçüldü: **%100 eşleşme**.
3. O rotanın, o duraktan, şu ana en yakın saatte geçen aktif seferi seçilir.

Üçüncü adım için tarifenin tamamı belleğe alınıyor (6,1 milyon durak-saat satırı,
tipli dizilerde ~3 saniye ve ~650 MB).

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
