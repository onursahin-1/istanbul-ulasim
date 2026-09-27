# Bütün veriyi tek komutla baştan kurar: İBB'nin güncel İETT verisi, Metro İstanbul, Şehir
# Hatları, Turyol ve Dentur'un güncel tarifeleri, erişim işaretleri, tatiller, istasyon birleştirme,
# uygulamanın harita ve sıklık dosyaları; istenirse OTP grafiği de.
#
# Ne zaman: İETT tarifesi değişince, mevsim değişince (yaz/kış tarifesi), M7 onarımı gibi
# bir işletme değişikliği bitince, ozel-gunler.json güncellenince. Adımlar README'deki
# sırayla; her biri zip'i yerinde değiştirdiği için yarıda kalan bir kurulum baştan
# başlatılmalı (bu betik zaten baştan başlıyor). Başlamadan önce eski zip'ler yedekleniyor.
#
# Kullanım (veri klasöründe):
#   .\yenile.ps1                 veriyi kur (~20 dk: metro tarifesi indirmesi 10 dk sürüyor)
#   .\yenile.ps1 -Derle          sonunda OTP grafiğini de derle (önce çalışan OTP'yi kapat)
#   .\yenile.ps1 -EskiTarife     metro ve vapur tarifelerini indirme, son indirileni kullan
#
# PowerShell betik çalıştırmaya izin vermezse:
#   powershell -ExecutionPolicy Bypass -File .\yenile.ps1

param(
  [string]$Otp = 'C:\otp',
  [switch]$Derle,
  [switch]$EskiTarife
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ist = Join-Path $Otp 'istanbul'
$ray = Join-Path $ist 'istanbul-ray-vapur-gtfs.zip'
$iett = Join-Path $ist 'istanbul-iett-gtfs.zip'
$osm = Join-Path $Otp 'osm-hatlar.json'
$metro = Join-Path $Otp 'metro-tarife.json'
$vapur = Join-Path $Otp 'vapur-tarife.json'
$ozelVapur = Join-Path $Otp 'ozel-vapur-tarife.json'
$baslangic = Get-Date
$adim = 0

function Adim([string]$ad, [scriptblock]$is) {
  $script:adim++
  Write-Host ""
  Write-Host "[$script:adim] $ad" -ForegroundColor Cyan
  & $is
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Adım başarısız: $ad (çıkış kodu $LASTEXITCODE). Kurulum durdu; yedekten dönmek için aşağıdaki klasöre bak." -ForegroundColor Red
    Write-Host "  $yedek"
    exit 1
  }
}

# Yedek: şimdiki zip'ler (yarıda kalırsa geri konabilsin).
$yedek = Join-Path $Otp ("yedekler\yenile-" + (Get-Date -Format 'yyyyMMdd-HHmm'))
New-Item -ItemType Directory -Force -Path $yedek | Out-Null
Get-ChildItem $ist -Filter *.zip | Copy-Item -Destination $yedek
Write-Host "Eski zip'ler yedeklendi: $yedek" -ForegroundColor DarkGray

Adim "İBB verisi indiriliyor ve GTFS'e çevriliyor" { node hazirla-gtfs.mjs $ist }
if (-not (Test-Path $osm)) {
  Adim "OpenStreetMap'ten raylı hat çizgileri çıkarılıyor" { python osm-cikar.py (Join-Path $ist 'Istanbul.osm.pbf') $osm }
}
Adim "Eksik istasyonlar tamamlanıyor" { python istasyon-tamamla.py $osm $ray }
Adim "Marmaray düzeltmeleri" { python marmaray-duzelt.py $ray }
Adim "Eksik hatlar (T5, T6, F4…) ekleniyor" { python eksik-hatlar.py $osm $ist }
if (-not $EskiTarife -or -not (Test-Path $metro)) {
  Adim "Metro İstanbul tarifesi indiriliyor (~10 dk)" { node metro-tarife-indir.mjs $metro }
}
Adim "Metro tarifesi işleniyor" { python metro-tarife-uygula.py $metro $ray }
if (-not $EskiTarife -or -not (Test-Path $vapur)) {
  Adim "Şehir Hatları tarifesi indiriliyor" { node vapur-tarife-indir.mjs $vapur }
}
Adim "Vapur tarifesi işleniyor" { python vapur-tarife-uygula.py $vapur $ray }
if (-not $EskiTarife -or -not (Test-Path $ozelVapur)) {
  Adim "Turyol ve Dentur tarifesi indiriliyor" { node ozel-vapur-indir.mjs $ozelVapur }
}
Adim "Turyol ve Dentur tarifesi işleniyor" { python ozel-vapur-uygula.py $ozelVapur $ray }
Adim "Erişim (basamaksız) işaretleri" { python erisim-isaretle.py $ray $iett }
Adim "Resmî tatiller ve bayramlar" { python ozel-gun-takvimi.py ..\assets\veri\ozel-gunler.json $ray $iett }
Adim "Hat çizgileri" { python cizgi-ekle.py $osm $ray }
Adim "Hat adları" { python hat-adi-duzelt.py $ray }
Adim "İstasyonlar birleştiriliyor (raylı ve vapur)" { python durak-birlestir.py $ray }
Adim "İstasyonlar birleştiriliyor (İETT)" { python durak-birlestir.py $iett }
Adim "Sağlama" { python dogrula.py $ist }
Adim "Uygulamanın ağ haritası" { python ag-cikar.py $ray ..\assets\veri\ag.json }
Adim "Uygulamanın sıklık verisi" { python siklik-cikar.py $ray ..\assets\veri\siklik.json }

if ($Derle) {
  Adim "OTP grafiği derleniyor" {
    Push-Location $Otp
    java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul
    Pop-Location
  }
}

$sure = [int]((Get-Date) - $baslangic).TotalMinutes
Write-Host ""
Write-Host "Bitti ($sure dk)." -ForegroundColor Green
if (-not $Derle) {
  Write-Host "OTP'yi kapatıp grafiği derle:  cd $Otp; java -Xmx6G -jar otp-shaded-2.10.0.jar --build --save istanbul"
}
Write-Host "Sonra sunucuyu aç:  cd $Otp; java -Xmx6G -jar otp-shaded-2.10.0.jar --load --serve istanbul"
Write-Host "Uygulamanın dosyaları (ag.json, siklik.json) değiştiyse commit'lemeyi unutma: git status"
