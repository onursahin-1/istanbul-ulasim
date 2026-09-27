# Sunucu: bilgisayar kapalıyken de çalışan uygulama

OTP, canlı veri köprüsü ve Expo (uygulamanın paketleyicisi) Oracle Cloud'un ücretsiz ARM
sunucusunda çalışır. Telefon sunucuya Tailscale üstünden bağlanır; internete açık port yok.
Uygulama yine Expo Go içinde açılır, ama artık bilgisayarın açık olması gerekmez.

```
iPhone (Expo Go) ──Tailscale──▶ sunucu :8081 Expo  → uygulamanın kodu
                                        :8080 OTP   → rota, durak, hat
                                        :8082 köprü → canlı konum (İBB'den)
```

Bellek: 12 GB'ın ~6 GB'ı OTP, 2 GB'ı köprü, ~1,5 GB'ı Expo. Grafik derlemesi 8 GB istediği
için derlerken OTP ve Expo birkaç dakika kapatılıyor (`yenile.sh --derle` bunu kendisi yapıyor).

## 1. Oracle hesabı

1. <https://www.oracle.com/cloud/free/> → **Start for free**. Kart doğrulaması isteniyor;
   Always Free kaynakları için ücret alınmıyor.
2. **Home region**'ı dikkatli seç, sonradan değişmiyor. Sana yakın bir Avrupa bölgesi
   (Frankfurt, Amsterdam, Milano, Stockholm…). ARM sunucu için "kapasite yok" hatası
   bölgeye göre değişiyor; Frankfurt sık doluyor.

## 2. Bilgisayarda SSH anahtarı

PowerShell'de (bir kez; soruları Enter'la geç):

```powershell
ssh-keygen -t ed25519
Get-Content $HOME\.ssh\id_ed25519.pub
```

Son komutun yazdığı satırı kopyala; sunucuyu açarken yapıştıracaksın.

## 3. Sunucuyu aç

Oracle konsolu → **Compute → Instances → Create instance**:

| Alan | Değer |
|---|---|
| Image | Canonical **Ubuntu 24.04** (aarch64 olanı) |
| Shape | **Ampere → VM.Standard.A1.Flex**, **2 OCPU**, **12 GB** bellek |
| Networking | Varsayılan VCN, public subnet, **Assign a public IPv4 address** açık |
| Add SSH keys | **Paste public keys** → 2. adımdaki satır |
| Boot volume | 100 GB |

"Out of capacity" hatası alırsan başka bir *availability domain* seç ya da birkaç saat sonra
tekrar dene. Sunucu açılınca sayfada **Public IP address** görünür.

## 4. İlk bağlantı ve kurulum

```powershell
ssh ubuntu@<Public IP>
```

Sunucuda, GitHub deposunu okuyabilmesi için bir anahtar üret:

```bash
ssh-keygen -t ed25519 -C istanbul-ulasim-sunucu -N "" -f ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub
```

Yazdığı satırı GitHub'da depoya ekle: **istanbul-ulasim → Settings → Deploy keys → Add
deploy key** (yazma izni verme). Sonra:

```bash
sudo mkdir -p /srv/istanbul && sudo chown ubuntu: /srv/istanbul
git clone git@github.com:onursahin-1/istanbul-ulasim.git /srv/istanbul/uygulama
bash /srv/istanbul/uygulama/sunucu/kurulum.sh
```

Kurulum Java, Node, Python ve Tailscale'i kuruyor. Tailscale adımında bir bağlantı
yazıyor: onu tarayıcıda aç ve telefonda kullandığın Tailscale hesabıyla onayla. Sunucu
tailnet'e `istanbul-ulasim` adıyla katılıyor. Kurulum sonunda sunucunun Tailscale adresini
(`100.x.y.z`) yazıyor.

## 5. Dosyaları bilgisayardan gönder

Bilgisayarda (Tailscale açık), proje klasöründe:

```powershell
powershell -ExecutionPolicy Bypass -File sunucu\dosyalari-gonder.ps1
ssh ubuntu@istanbul-ulasim bash /srv/istanbul/uygulama/sunucu/baslat.sh
```

İlk komut OTP'yi, derlenmiş grafiği, beslemeleri, veri kurulumunun girdilerini ve köprünün
öğrendiği süreleri gönderiyor (~400 MB). İkincisi servisleri başlatıp OTP'nin hazır olmasını
bekliyor.

## 6. Telefon

Tailscale açıkken Safari'de `exp://100.x.y.z:8081` adresini aç (kurulumun yazdığı adres).
Expo Go açılıp uygulamayı yükler; ilk yükleme sunucuda paketleme yüzünden 1-2 dakika
sürebilir. Sonra Expo Go'nun ana ekranındaki son projeler listesinden açılır.

Artık bilgisayarda OTP, köprü ve Expo'yu çalıştırmana gerek yok.

## Günlük kullanım

**Kod değişince** (bilgisayarda commit ve push'tan sonra):

```powershell
ssh ubuntu@istanbul-ulasim bash /srv/istanbul/uygulama/sunucu/guncelle.sh
```

**Veriyi yenilemek** (İETT tarifesi, mevsim değişimi, tatil listesi):

```bash
bash /srv/istanbul/uygulama/sunucu/yenile.sh --derle
```

Haftalık kendiliğinden yenilesin istersen sunucuda `crontab -e` ile şu satırı ekle
(pazartesi 03:30, İstanbul saati):

```
30 3 * * 1 bash /srv/istanbul/uygulama/sunucu/yenile.sh --derle >> /srv/istanbul/otp/yenile.log 2>&1
```

**Durum ve kayıtlar:**

```bash
systemctl status istanbul-otp istanbul-kopru istanbul-expo
journalctl -u istanbul-kopru -n 50
curl -s localhost:8082/durum | head -c 600
```

## Güvenlik

Tailscale çalışınca Oracle konsolunda **Networking → Virtual cloud networks → (VCN) →
Security Lists → Default** içindeki 22 numaralı port kuralını silebilirsin. SSH'a o zaman
yalnız Tailscale'den (`ssh ubuntu@istanbul-ulasim`) bağlanılır ve sunucunun internete açık
hiçbir portu kalmaz.

## Bilinmesi gerekenler

- **Boşta kalan sunucu:** Oracle, 7 gün boyunca işlemci, ağ ve bellek kullanımının üçü de
  %20'nin altında kalan ücretsiz sunucuları geri alabiliyor. Bu sunucuda OTP bellekte ~6 GB
  tuttuğu için bellek ölçütü aşılıyor; yine de Oracle e-posta atarsa haber ver.
- **ARM:** Java, Node ve Python ARM'da sorunsuz. OTP grafiği işlemciden bağımsız;
  bilgisayarda derlenen grafik sunucuda da açılıyor.
- **Veri kurulumu:** `yenile.sh`, `veri/yenile.ps1`'in Linux karşılığı; adım eklenirse ikisi
  birlikte güncellenmeli. OSM'den çıkarma adımları (osmium ister) sunucuda yok: onların
  çıktıları (`osm-hatlar.json`, `osm-kiyi.json`) bilgisayardan gönderiliyor.
