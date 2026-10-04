# Otobüslerin ara durak saatlerini köprünün son öğrendiği yol süreleriyle tazeler ve OTP
# grafiğini yeniden derler. Bütün veriyi baştan kurmadan (yenile.ps1, ~20 dk), yalnız bu
# adım: köprü her gün yeni ölçüm topladıkça haftada bir çalıştırmak yeterli.
#
# Kullanım (veri klasöründe, ÖNCE çalışan OTP'yi kapat):
#   .\sureleri-guncelle.ps1
#   .\sureleri-guncelle.ps1 -DerlemeYok   yalnız zip'i güncelle, grafiği derleme
#
# PowerShell betik çalıştırmaya izin vermezse:
#   powershell -ExecutionPolicy Bypass -File .\sureleri-guncelle.ps1

param(
  [string]$Otp = 'C:\otp',
  [switch]$DerlemeYok
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$iett = Join-Path $Otp 'istanbul\istanbul-iett-gtfs.zip'
$sureler = Join-Path $PSScriptRoot '..\kopru\kayit\segment-sureleri.json'

if (-not (Test-Path $sureler)) {
  Write-Host "Köprünün öğrendiği yol süreleri yok: $sureler" -ForegroundColor Red
  Write-Host "Köprüyü (kopru klasöründe npm start) en az bir gün çalıştır."
  exit 1
}
if (-not $DerlemeYok -and (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "8080'de çalışan bir sunucu var. Grafiği derlemeden önce OTP'yi kapat (penceresinde Ctrl+C)." -ForegroundColor Red
  exit 1
}

$py = $null
foreach ($aday in @(@('py', '-3'), @('python3'), @('python'))) {
  $uygulama = Get-Command $aday[0] -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $uygulama) { continue }
  $ekler = @($aday | Select-Object -Skip 1)
  $surum = & $uygulama.Source @ekler --version 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0 -and $surum -match 'Python 3\.') { $py = @{ Komut = $uygulama.Source; Ekler = $ekler }; break }
}
if (-not $py) {
  Write-Host "Python 3 bulunamadı (winget install -e --id Python.Python.3.12)." -ForegroundColor Red
  exit 1
}

$yedek = Join-Path $Otp ("yedekler\sureler-" + (Get-Date -Format 'yyyyMMdd-HHmm'))
New-Item -ItemType Directory -Force -Path $yedek | Out-Null
Copy-Item $iett $yedek
Write-Host "Eski zip yedeklendi: $yedek" -ForegroundColor DarkGray

Write-Host ""
Write-Host "[1] Ara durak saatleri öğrenilen sürelerle dolduruluyor" -ForegroundColor Cyan
& $py.Komut @($py.Ekler) iett-sure-uygula.py $iett $sureler
if ($LASTEXITCODE -ne 0) { Write-Host "Başarısız; yedek: $yedek" -ForegroundColor Red; exit 1 }

if (-not $DerlemeYok) {
  Write-Host ""
  Write-Host "[2] OTP grafiği derleniyor" -ForegroundColor Cyan
  Push-Location $Otp
  java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul
  $kod = $LASTEXITCODE
  Pop-Location
  if ($kod -ne 0) { Write-Host "Derleme başarısız." -ForegroundColor Red; exit 1 }
}

Write-Host ""
Write-Host "Bitti. Sunucuyu aç:  cd $Otp; java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul" -ForegroundColor Green
Write-Host "Köprüyü de yeniden başlat (yeni tarifeyi okusun):  cd C:\projeler\istanbul-ulasim\kopru; npm start"
