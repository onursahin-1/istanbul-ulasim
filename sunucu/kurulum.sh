#!/usr/bin/env bash
# Oracle Cloud (Ubuntu 24.04, ARM) sunucusunu bir kerede kurar: Java, Node, Python,
# Tailscale, uygulama deposu, OTP ve üç servis (OTP, köprü, Expo).
#
# Ne yapar, sırayla:
#   1. Paketler: OpenJDK 21 (OTP 2.10 ister), Node 22, Python 3, git.
#   2. Tailscale: sunucu senin tailnet'ine katılır. Telefon ve bilgisayar zaten orada;
#      OTP, köprü ve Expo yalnız Tailscale üstünden erişilir, internete açık port yok.
#   3. Oracle'ın Ubuntu imajındaki güvenlik duvarı SSH dışında her şeyi reddediyor;
#      Tailscale arayüzünden gelen trafiğe izin verilir (kalıcı).
#   4. Depo /srv/istanbul/uygulama'ya klonlanır, npm paketleri kurulur.
#   5. systemd servisleri yazılır ve açılışta başlayacak biçimde etkinleştirilir.
#
# Kullanım (sunucuda, ubuntu kullanıcısıyla):
#   bash kurulum.sh <github-depo-adresi>
# Örnek:
#   bash kurulum.sh git@github.com:onursahin-1/istanbul-ulasim.git
#
# Betik yeniden çalıştırılabilir: kurulu olanı atlar, servis dosyalarını yeniler.

set -euo pipefail

DEPO="${1:-}"
KOK=/srv/istanbul
UYGULAMA=$KOK/uygulama
OTP=$KOK/otp
KULLANICI=$(whoami)
OTP_JAR=otp-shaded-2.10.0.jar
OTP_URL=https://repo1.maven.org/maven2/org/opentripplanner/otp-shaded/2.10.0/$OTP_JAR

adim() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

if [[ -z "$DEPO" && ! -d $UYGULAMA/.git ]]; then
  echo "kullanım: bash kurulum.sh <github-depo-adresi>" >&2
  exit 2
fi

adim "1/6 Paketler"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-21-jre-headless python3 git curl unzip ca-certificates iptables-persistent
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
java -version 2>&1 | head -1
node -v
# Zamanlanmış veri yenilemesi (cron) İstanbul saatiyle yazılsın.
sudo timedatectl set-timezone Europe/Istanbul

adim "2/6 Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale ip -4 >/dev/null 2>&1; then
  echo "Aşağıdaki bağlantıyı tarayıcıda açıp sunucuyu hesabına ekle (telefonda kullandığın Tailscale hesabı):"
  sudo tailscale up --hostname=istanbul-ulasim
fi
TS_IP=$(tailscale ip -4 | head -1)
echo "Sunucunun Tailscale adresi: $TS_IP"

adim "3/6 Güvenlik duvarı: Tailscale trafiğine izin"
if ! sudo iptables -C INPUT -i tailscale0 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT 1 -i tailscale0 -j ACCEPT
  sudo netfilter-persistent save
fi

adim "4/6 Depo ve paketler"
sudo mkdir -p $KOK $OTP/istanbul $OTP/yedekler
sudo chown -R "$KULLANICI": $KOK
if [[ ! -d $UYGULAMA/.git ]]; then
  git clone "$DEPO" $UYGULAMA
fi
(cd $UYGULAMA && npm ci --no-audit --no-fund)
(cd $UYGULAMA/kopru && npm ci --no-audit --no-fund)

adim "5/6 OTP"
if [[ ! -f $OTP/$OTP_JAR ]]; then
  curl -fL -o $OTP/$OTP_JAR "$OTP_URL" || echo "OTP indirilemedi; dosyalari-gonder.ps1 ile bilgisayardan gönder."
fi
ls -la $OTP

adim "6/6 Servisler"
# OTP: grafiği yükleyip sunar. 12 GB'lık sunucuda OTP 6 GB, köprü 2 GB, Expo ~1,5 GB.
sudo tee /etc/systemd/system/istanbul-otp.service >/dev/null <<EOF
[Unit]
Description=Istanbul ulasim - OpenTripPlanner
After=network-online.target

[Service]
User=$KULLANICI
WorkingDirectory=$OTP
ExecStart=/usr/bin/java -Xmx6G -jar $OTP/$OTP_JAR --load --serve istanbul
Restart=on-failure
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/istanbul-kopru.service >/dev/null <<EOF
[Unit]
Description=Istanbul ulasim - canli veri koprusu
After=network-online.target istanbul-otp.service

[Service]
User=$KULLANICI
WorkingDirectory=$UYGULAMA/kopru
Environment=GTFS_ZIP=$OTP/istanbul/istanbul-iett-gtfs.zip
ExecStart=/usr/bin/node --max-old-space-size=2048 sunucu.mjs
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Expo: telefondaki Expo Go uygulamayı buradan yükler. Paketleyici adresi Tailscale adresi;
# uygulama OTP'yi ve köprüyü de bu adresten buluyor (src/lib/otp.ts).
sudo tee /etc/systemd/system/istanbul-expo.service >/dev/null <<EOF
[Unit]
Description=Istanbul ulasim - Expo (Metro)
After=network-online.target tailscaled.service

[Service]
User=$KULLANICI
WorkingDirectory=$UYGULAMA
Environment=CI=1
Environment=REACT_NATIVE_PACKAGER_HOSTNAME=$TS_IP
Environment=EXPO_NO_TELEMETRY=1
ExecStart=/usr/bin/npx expo start --port 8081
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable istanbul-otp istanbul-kopru istanbul-expo >/dev/null
echo
echo "Kurulum bitti. Servisler açılışta başlayacak."
if [[ -f $OTP/istanbul/graph.obj ]]; then
  sudo systemctl restart istanbul-otp istanbul-kopru istanbul-expo
  echo "Servisler başlatıldı. Durum:  systemctl status istanbul-otp istanbul-kopru istanbul-expo"
else
  echo "Henüz grafik yok. Bilgisayardan dosyaları gönder (sunucu/dosyalari-gonder.ps1),"
  echo "sonra:  bash $UYGULAMA/sunucu/baslat.sh"
fi
echo
echo "iPhone'da Safari'de aç:  exp://$TS_IP:8081"
