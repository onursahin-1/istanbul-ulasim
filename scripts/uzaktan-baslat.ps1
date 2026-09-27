# Expo'yu Tailscale adresiyle başlatır: telefon evin Wi-Fi'ı dışında da (mobil veriyle)
# uygulamaya, rota sunucusuna (8080) ve canlı veri köprüsüne (8082) bağlanır.
#
# Uygulama sunucu adreslerini Expo'nun adresinden çıkarıyor (src/lib/otp.ts): Expo
# Tailscale adresiyle açılınca rota sunucusu ve köprü de o adresten aranır; ayrıca bir
# ayar gerekmez. Evdeyken de aynı adres çalışır (Tailscale aynı ağda doğrudan bağlanır).
#
# Gerekenler: bilgisayarda ve telefonda Tailscale açık, aynı hesapla girilmiş; OTP ve
# köprü (kopru\ npm start) çalışıyor. Köprüyü Expo'dan önce başlat: ikisi de port ister.
#
# Kullanım:  npm run uzaktan            (adres kendiliğinden bulunur)
#            npm run uzaktan -- 100.x.x.x (elle)

# Adres üç yoldan aranır: 1) komut satırına verilen adres (npm run uzaktan -- 100.x.x.x),
# 2) tailscale komutu (PATH'te yoksa Program Files'taki tailscale.exe), 3) bilgisayarın
# 100.64.0.0/10 aralığındaki ağ adresi (Tailscale'in verdiği adresler bu aralıkta).
$ip = $args | Select-Object -First 1
if (-not $ip) {
  $komut = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
  if (-not $komut) {
    $aday = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (Test-Path $aday) { $komut = $aday }
  }
  if ($komut) { $ip = (& $komut ip -4 2>$null) | Select-Object -First 1 }
}
if (-not $ip) {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' } |
    Select-Object -First 1 -ExpandProperty IPAddress
}
if (-not $ip) {
  Write-Host "Tailscale adresi bulunamadı. Tailscale açık ve giriş yapılmış mı?" -ForegroundColor Red
  Write-Host "Adresi elle de verebilirsin:  npm run uzaktan -- 100.x.x.x"
  exit 1
}
Write-Host "Tailscale adresi: $ip" -ForegroundColor Green

# Portlar sabit: uygulama rota sunucusunu 8080'de, köprüyü 8082'de arıyor (src/lib/otp.ts).
# Expo 8081 doluysa kendiliğinden 8082'ye geçmek istiyor; o zaman köprünün yerine oturur ve
# uygulama köprü yerine Expo'ya bağlanır. Bu yüzden önce portlara bakılıyor.
function Dinleyen($port) {
  $b = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($b) { Get-Process -Id $b.OwningProcess -ErrorAction SilentlyContinue }
}

$expo = Dinleyen 8081
if ($expo) {
  Write-Host "8081 portunu başka bir program kullanıyor: $($expo.ProcessName) (PID $($expo.Id))." -ForegroundColor Red
  Write-Host "Büyük ihtimalle açık kalmış başka bir Expo penceresi; onu Ctrl+C ile kapat ya da:"
  Write-Host "  Stop-Process -Id $($expo.Id)"
  exit 1
}
if (-not (Dinleyen 8080)) {
  Write-Host "Uyarı: rota sunucusu (8080) çalışmıyor; C:\otp'de OTP'yi başlat." -ForegroundColor Yellow
}
if (-not (Dinleyen 8082)) {
  Write-Host "Uyarı: canlı veri köprüsü (8082) çalışmıyor; kopru klasöründe npm start." -ForegroundColor Yellow
}

Write-Host "Rota sunucusu: http://${ip}:8080   Köprü: http://${ip}:8082   Expo: exp://${ip}:8081"
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $ip
npx expo start --port 8081
