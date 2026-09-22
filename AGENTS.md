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

Betik `node --experimental-strip-types scripts/sorgu-dogrula.ts` ile de çalışır;
`tsx` kurulu değilse ya da başka bir platformdan kurulmuşsa bu yol işe yarar.

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

## Testler

```powershell
npm test
```

Saf mantık `src/lib/__testler__/` altında Node'un kendi test koşucusuyla denenir.
Hiçbir bağımlılık kullanmıyor: Node kendi TypeScript soyucusuyla çalışıyor,
`scripts/ts-cozucu.mjs` de yalnız uzantısız göreli içe aktarmaları çözüyor. Eskiden
tsx kullanılıyordu ama tsx esbuild'e bağlı ve esbuild ikilisi işletim sistemine özel:
`node_modules` Windows'ta kurulunca Linux'ta, Linux'ta kurulunca Windows'ta kırılıyordu.

Test edilebilmesi için saf parçalar React Native'e dokunmayan dosyalarda tutulur:
`metin.ts` (Türkçe metin ve hat kodu), `bacak.ts` (durak dizisi), `sorgular.ts`
(GraphQL metinleri ve rota tercihleri), `renk.ts`, `vapur.ts`, `istasyon.ts`,
`onbellek.ts`, `ag.ts`. `tema.ts` ve `otp.ts` bunları yeniden dışa açar, böylece çağrı
yerleri değişmez. **Yeni bir saf işlev yazarken onu bu dosyalardan birine koy**, yoksa
test edilemez hâle gelir.

Testi yazdıktan sonra `git status` ile dosyanın gerçekten depoya girdiğini doğrula:
bir kez `vapur.test.ts` yazılıp koşturuldu ama hiç işlenmedi, commit iletisi 15 test
eklendiğini söylerken depoda test yoktu.

Test dosyaları `tsconfig.json`'da hariç tutulur (Node tipleri kurulu değil); doğruluğu
`npm test` gösterir.

## Veri

`veri/README.md` bütün veri hattını anlatır ve **betiklerin çalıştırma sırasını**
verir; betikler zip'i yerinde değiştirdiği için sıra önemli. İBB'nin raylı sistem
beslemesi 2023'ten beri güncellenmiyor; saatler güncel döneme kaydırılmış
yaklaşıklardır. M11 beslemede hiç yok, biz üretiyoruz: istasyonlar ve çizgi OSM'den,
uçtan uca süre ile sıklık iki bağımsız kaynaktan, istasyon arası dağılım tahminî.

Veri zip'lerinin elle alınmış yedeklerine güvenme: `hazirla-gtfs.mjs` zaman içinde
düzeldiği için eski bir yedek, araç tipi yanlış atanmış bir sürüm olabilir. Her
değişiklikten sonra `python veri/dogrula.py C:\otp\istanbul` çalıştır; hat sayıları
(12 metro, 3 Marmaray, 3 tramvay, 3 füniküler, 2 teleferik, ~100 vapur) bu tür bir
karışıklığı hemen gösterir.

## Commit

Commit'leri proje sahibi kendisi atar. Claude değişiklikleri yapar, test eder ve
bırakır; `git commit` ve `git push` çalıştırmaz, commit iletisine `Co-Authored-By`
ya da oturum bağlantısı eklemez. İstenirse önerilen commit iletisini metin olarak verir.

Depodaki bütün commit'ler `ONUR ŞAHİN <156543601+onursahin-1@users.noreply.github.com>`
kimliğiyle. `onur-5534@outlook.com` GitHub'da başka bir hesaba (onursahin55) bağlı;
o adresle atılan commit o hesabı katkıcı olarak gösterir, kullanma.

## Dil

Kod, değişken adları, yorumlar ve kullanıcıya görünen bütün metinler Türkçedir.
