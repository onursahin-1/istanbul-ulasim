# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# İstanbul Ulaşım — projeye özgü notlar

Windows'ta geliştirilir, iPhone'da Expo Go ile denenir. Dolayısıyla native modül
eklenemez: Dinamik Ada / Live Activity, arka planda konum ve gerçek push bildirimi
kendi derlememiz (development build) olmadan çalışmaz.

## Rota motoru

OpenTripPlanner 2.10, kullanıcının bilgisayarında `C:\otp` altında çalışır; uygulama
`http://<bilgisayarın IP'si>:8080/otp/gtfs/v1` adresine bağlanır, yani telefon aynı
Wi-Fi'de olmak zorunda. Adres `EXPO_PUBLIC_OTP_URL` ile değiştirilebilir.

## GraphQL sorguları

Sorgu metinleri `src/lib/sorgular.ts` içinde, bağımlılıksız bir dosyada durur;
`src/lib/otp.ts` onları içe aktarır. Bunun tek sebebi doğrulanabilir olmaları:

```powershell
npm run sorgu            # jar'ı C:\otp içinde kendi bulur
npm run sorgu -- <yol>   # başka bir jar ya da klasör
```

Betik `node --import tsx` ile çalışır, `tsx` kabuk kısayoluyla değil: proje Windows'ta
geliştirilirken bağımlılıklar başka bir makineden kurulduysa `node_modules/.bin` içindeki
`.cmd` kısayolları oluşmuyor ve `tsx` bulunamıyor.

Betik şemayı jar'ın içinden (`org/opentripplanner/apis/gtfs/schema.graphqls`) çıkarır ve
hem sorguları hem de rota tercihi nesnelerini denetler. **Sorgu değiştiren her
düzenlemeden sonra çalıştır**: OTP'nin GTFS API'si tahmin edilebilir görünse de
alan adlarında sürprizler var (örneğin frekans/headway alanı yok, sıklık ardışık
kalkışlardan çıkarılıyor; sıklık tabanlı seferlerde `stopCalls` hata veriyor, onun
yerine `trip.pattern.stops` kullanılıyor).

`buildSchema` çağrısı `assumeValid` ile yapılır: OTP'nin şeması graphql-js'in bir
kuralını çiğniyor, ama bizi ilgilendiren sorguların geçerliliği.

## Veri

`veri/README.md` bütün veri hattını anlatır: GTFS hazırlama, OSM kırpma, ilgi
noktaları ve eksik metro istasyonlarının OSM'den tamamlanması. İBB'nin raylı sistem
beslemesi 2023'ten beri güncellenmiyor; saatler güncel döneme kaydırılmış
yaklaşıklardır ve M11 tamamen bizim ürettiğimiz tahminî tarifedir.

## Dil

Kod, değişken adları, yorumlar ve kullanıcıya görünen bütün metinler Türkçedir.
