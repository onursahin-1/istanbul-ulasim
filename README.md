# İstanbul Ulaşım

İstanbul için toplu taşıma uygulaması: rota arama, canlı araç konumları, durak ve hat
ekranları, sesli yol tarifi, ücret hesabı. Expo (React Native) ile yazıldı, iPhone'da
Expo Go ile çalışıyor. Rotaları kendi OpenTripPlanner sunucumuz buluyor; veri İBB'nin açık
verisinden, işletmecilerin sitelerinden ve OpenStreetMap'ten.

## Parçalar

| Klasör | Ne | Ayrıntı |
|---|---|---|
| `src/` | Uygulama (Expo Router). Ekranlar `src/app`, ortak bileşenler `src/components`, mantık `src/lib` | — |
| `veri/` | Veri hattı: İBB GTFS'ini indirip onarır, Metro İstanbul, Şehir Hatları, Turyol ve Dentur tarifelerini işler, OTP'nin kullandığı zip'leri üretir | [veri/README.md](veri/README.md) |
| `kopru/` | Canlı veri köprüsü: İETT'nin araç konumlarını GTFS-RT'ye çevirip OTP'ye verir, varış tahminlerini öğrenir | [kopru/README.md](kopru/README.md) |
| `sunucu/` | OTP, köprü ve Expo'yu bulut sunucusunda (Oracle, Tailscale) çalıştırma betikleri | [sunucu/README.md](sunucu/README.md) |
| `assets/veri/` | Uygulamayla giden veri: ağ haritası, sıklıklar, tatil takvimi, yer araması veritabanı | — |

```
iPhone (Expo Go) ──▶ :8081 Expo (uygulamanın kodu)
                 ──▶ :8080 OpenTripPlanner (rota, durak, hat)   ◀── veri/ (GTFS zip'leri)
                 ──▶ :8082 köprü (canlı konum, duyurular)       ◀── İBB canlı servisleri
```

Uygulama OTP'nin ve köprünün adresini Expo'nun adresinden çıkarıyor (`src/lib/otp.ts`):
üçü aynı makinede çalışıyor.

## Bilgisayarda çalıştırma

Üç ayrı PowerShell penceresinde, bu sırayla:

```powershell
# 1. OTP (hazır olması 1-2 dk)
cd C:\otp
java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul

# 2. Köprü
cd C:\projeler\istanbul-ulasim\kopru
npm start

# 3. Expo: evde aynı Wi-Fi'da
cd C:\projeler\istanbul-ulasim
npx expo start
#    ya da dışarıdan Tailscale ile
npm run uzaktan
```

iPhone'da Expo Go'dan projeyi aç ya da QR kodu okut.

## Veriyi yenileme

```powershell
cd C:\projeler\istanbul-ulasim\veri
.\yenile.ps1 -Derle             # her şeyi indir, kur, OTP grafiğini derle (~25 dk)
.\yenile.ps1 -EskiTarife -Derle # metro/vapur tarifelerini yeniden indirmeden
```

Haftada bir kendiliğinden yapılması için (OTP ve köprüyü kapatıp kurar, yeniden açar):

```powershell
powershell -ExecutionPolicy Bypass -File .\gorev-kur.ps1   # pazartesi 04:30; ayrıntı: veri/README.md
```

Ne zaman: İETT tarifesi değişince, mevsim değişince (yaz/kış), `assets/veri/ozel-gunler.json`
güncellenince. İETT takvimi bitmeye yaklaşırsa kurulum onu kendiliğinden uzatıp uyarıyor;
yine de İBB yeni dönemin verisini yayımlayınca yeniden çalıştırmak gerekiyor.

## Testler

```powershell
npm test               # uygulamanın mantık testleri
npx tsc --noEmit       # tip denetimi
npm run sorgu          # GraphQL sorgularını OTP şemasına karşı doğrula (sorgu değişince)
cd kopru; npm test     # köprünün testleri
```

## Bilinen sınırlar

- **Expo Go:** native modül eklenemiyor; arka planda konum, gerçek push bildirimi, Dinamik
  Ada bağımsız bir derleme (Apple Developer üyeliği) olmadan çalışmıyor.
- **Canlı konum** yalnız İETT otobüslerinde var; metro, tramvay ve vapur için açık canlı
  veri yok.
- **Yaklaşık saatler:** Marmaray (TCDD istasyon saati yayımlamıyor, sıklıktan), İDO ve
  minibüs/dolmuş (İBB'nin eski verisi).

## Veri kaynakları

Uygulama şu kaynakların açık verisini ya da yayımlanmış tarifesini kullanıyor. Veri,
kodun lisansına değil kendi kaynağının lisansına tabi; kaynakların anılması isteniyor,
bu yüzden uygulamanın Hakkında ekranında da listeleniyorlar.

| Kaynak | Ne için | Lisans |
|---|---|---|
| [İBB Açık Veri Portalı](https://data.ibb.gov.tr) | İETT GTFS (otobüs, Metrobüs, durak, hat), İDO, minibüs ve dolmuş; İETT canlı araç konumları | İBB Açık Veri Lisansı |
| [Metro İstanbul](https://www.metro.istanbul) | Metro, tramvay, füniküler ve teleferik tarifesi | Yayımlanmış tarife |
| [Şehir Hatları](https://sehirhatlari.istanbul), [Turyol](https://www.turyol.com), [Dentur Avrasya](https://www.denturavrasya.com) | Vapur tarifeleri | Yayımlanmış tarife |
| [TCDD Taşımacılık](https://www.tcddtasimacilik.gov.tr) | Marmaray sefer sıklığı | Yayımlanmış bilgi |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Yol ağı (yürüme), ilgi noktaları, ray ve kıyı geometrisi | © OpenStreetMap katkıda bulunanları, ODbL 1.0 |

`assets/veri/istanbul-poi.db` OpenStreetMap'ten türetilmiş bir veritabanı; ODbL gereği
kendisi de ODbL 1.0 lisansına tabi.

## Lisans

Kod: © 2026 Onur Şahin, tüm hakları saklıdır (bkz. [LICENSE](LICENSE)). Veri yukarıdaki
kaynakların lisansına tabidir.

