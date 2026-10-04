# Geliştirme ortamını tek komutla açar: rota sunucusu (OTP, 8080), canlı veri köprüsü
# (8082) ve Expo (8081), her biri kendi penceresinde. Zaten çalışanı yeniden açmaz.
#
# Köprü kapalıyken uygulama otobüslerin canlı konumunu ve gelme saatini bilmiyor, yalnız
# tarifeyi gösteriyor; köprünün yol süresi öğrenmesi de duruyor. Bu yüzden hepsi birlikte.
#
# Kullanım (proje klasöründe):
#   npm run baslat              OTP + köprü + Expo
#   npm run baslat -- -Uzaktan  Expo'yu Tailscale adresiyle aç (npm run uzaktan gibi)
#
# Pencereleri kapatmak her birini durdurur. OTP'nin açılması 1–2 dakika sürer; Expo
# penceresinde QR kodu çıkınca telefondan açabilirsin.

param(
  [string]$Otp = 'C:\otp',
  [switch]$Uzaktan
)

$proje = Split-Path -Parent $PSScriptRoot

function Dinliyor($port) {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Pencere($baslik, $klasor, $komut) {
  $tam = "`$Host.UI.RawUI.WindowTitle = '$baslik'; Set-Location '$klasor'; $komut"
  Start-Process powershell -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $tam) | Out-Null
}

if (Dinliyor 8080) {
  Write-Host "Rota sunucusu (8080) zaten çalışıyor." -ForegroundColor DarkGray
} elseif (-not (Test-Path (Join-Path $Otp 'otp-shaded-2.10.0.jar'))) {
  Write-Host "OTP bulunamadı: $Otp\otp-shaded-2.10.0.jar" -ForegroundColor Red
} else {
  Pencere 'OTP (8080)' $Otp 'java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul'
  Write-Host "Rota sunucusu açılıyor (1–2 dk)." -ForegroundColor Green
}

if (Dinliyor 8082) {
  Write-Host "Köprü (8082) zaten çalışıyor." -ForegroundColor DarkGray
} else {
  $kopru = Join-Path $proje 'kopru'
  $hazirlik = if (Test-Path (Join-Path $kopru 'node_modules')) { '' } else { 'npm install; ' }
  Pencere 'Köprü (8082)' $kopru "${hazirlik}npm start"
  Write-Host "Canlı veri köprüsü açılıyor." -ForegroundColor Green
}

# Köprü 8082'yi tutmadan Expo açılırsa Expo o portu kapabiliyor; birkaç saniye bekle.
Start-Sleep -Seconds 5

if (Dinliyor 8081) {
  Write-Host "Expo (8081) zaten çalışıyor." -ForegroundColor DarkGray
} elseif ($Uzaktan) {
  Pencere 'Expo (uzaktan)' $proje 'npm run uzaktan'
} else {
  Pencere 'Expo (8081)' $proje 'npx expo start --port 8081'
}

Write-Host ""
Write-Host "Durum için:  curl.exe -s http://localhost:8082/durum" -ForegroundColor DarkGray
