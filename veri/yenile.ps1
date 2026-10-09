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
#   .\yenile.ps1 -Python C:\Python312\python.exe   Python'u elle göster (bulunamazsa)
#
# Python 3 gerekiyor (yalnız standart kütüphane). Betik sırayla `py -3`, `python3`, `python`
# deniyor; Windows'un "Python bulunamadı, Microsoft Store'u aç" kısayolu gerçek Python
# sayılmıyor.
#
# PowerShell betik çalıştırmaya izin vermezse:
#   powershell -ExecutionPolicy Bypass -File .\yenile.ps1

param(
  [string]$Otp = 'C:\otp',
  [switch]$Derle,
  [switch]$EskiTarife,
  [string]$Python = ''
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ist = Join-Path $Otp 'istanbul'
$ray = Join-Path $ist 'istanbul-ray-vapur-gtfs.zip'
$iett = Join-Path $ist 'istanbul-iett-gtfs.zip'
$osm = Join-Path $Otp 'osm-hatlar.json'
$metro = Join-Path $Otp 'metro-tarife.json'
$vapur = Join-Path $Otp 'vapur-tarife.json'
$marmaray = Join-Path $Otp 'marmaray-tarife.json'
$ozelVapur = Join-Path $Otp 'ozel-vapur-tarife.json'
$kiyi = Join-Path $Otp 'osm-kiyi.json'
$baslangic = Get-Date
$adim = 0

# Çalışan bir Python 3 bul. Store kısayolu (WindowsApps\python.exe) 9009 ile çıkıyor, elenir.
function PythonBul {
  $adaylar = @()
  if ($Python) { $adaylar += ,@($Python) }
  $adaylar += ,@('py', '-3')
  $adaylar += ,@('python3')
  $adaylar += ,@('python')
  foreach ($aday in $adaylar) {
    $komut = $aday[0]
    $ekler = @($aday | Select-Object -Skip 1)
    # Yalnız gerçek programlar: aynı adlı bir PowerShell işlevi/takma adı sayılmasın.
    $uygulama = Get-Command $komut -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $uygulama) { continue }
    $komut = $uygulama.Source
    try {
      $surum = & $komut @ekler --version 2>&1 | Out-String
      if ($LASTEXITCODE -eq 0 -and $surum -match 'Python 3\.') {
        return @{ Komut = $komut; Ekler = $ekler; Surum = $surum.Trim() }
      }
    } catch { }
  }
  return $null
}

$py = PythonBul
if (-not $py) {
  Write-Host "Python 3 bulunamadı. Veri betikleri Python istiyor (yalnız standart kütüphane)." -ForegroundColor Red
  Write-Host "Kurmak için:  winget install -e --id Python.Python.3.12"
  Write-Host "Sonra YENİ bir PowerShell penceresi açıp betiği yeniden çalıştır."
  Write-Host "Python kuruluysa yolunu göster:  .\yenile.ps1 -Python C:\yol\python.exe"
  exit 1
}
Write-Host "Python: $($py.Surum) ($($py.Komut) $($py.Ekler -join ' '))" -ForegroundColor DarkGray
# İşlevin adı "py" olamaz: PowerShell büyük/küçük harf ayırmıyor, `& 'py'` işlevin kendisini
# çağırıp sonsuz döngüye giriyordu. Program yukarıda tam yoluyla tutuluyor.
function PythonCalistir { & $py.Komut @($py.Ekler) @args }

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
  Adim "OpenStreetMap'ten raylı hat çizgileri çıkarılıyor" { PythonCalistir osm-cikar.py (Join-Path $ist 'Istanbul.osm.pbf') $osm }
}
Adim "Eksik istasyonlar tamamlanıyor" { PythonCalistir istasyon-tamamla.py $osm $ray }
Adim "Marmaray düzeltmeleri" { PythonCalistir marmaray-duzelt.py $ray }
Adim "Eksik hatlar (T5, T6, F4…) ekleniyor" { PythonCalistir eksik-hatlar.py $osm $ist }
if (-not $EskiTarife -or -not (Test-Path $metro)) {
  Adim "Metro İstanbul tarifesi indiriliyor (~10 dk)" { node metro-tarife-indir.mjs $metro }
}
Adim "Metro tarifesi işleniyor" { PythonCalistir metro-tarife-uygula.py $metro $ray }
if (Test-Path $marmaray) {
  Adim "TCDD tarifesi işleniyor (Marmaray, M11, T6)" { PythonCalistir marmaray-tarife-uygula.py $marmaray $ray }
} else {
  Write-Host "TCDD tarifesi yok ($marmaray); Marmaray, M11 ve T6 sıklıkla kalacak. Bkz. README 4c2." -ForegroundColor Yellow
}
if (-not $EskiTarife -or -not (Test-Path $vapur)) {
  Adim "Şehir Hatları tarifesi indiriliyor" { node vapur-tarife-indir.mjs $vapur }
}
Adim "Vapur tarifesi işleniyor" { PythonCalistir vapur-tarife-uygula.py $vapur $ray }
if (-not $EskiTarife -or -not (Test-Path $ozelVapur)) {
  Adim "Turyol ve Dentur tarifesi indiriliyor" { node ozel-vapur-indir.mjs $ozelVapur }
}
Adim "Turyol ve Dentur tarifesi işleniyor" { PythonCalistir ozel-vapur-uygula.py $ozelVapur $ray }
Adim "Erişim (basamaksız) işaretleri" { PythonCalistir erisim-isaretle.py $ray $iett }
Adim "Resmî tatiller ve bayramlar" { PythonCalistir ozel-gun-takvimi.py ..\assets\veri\ozel-gunler.json $ray $iett }
Adim "Hat çizgileri" { PythonCalistir cizgi-ekle.py $osm $ray }
if (-not (Test-Path $kiyi)) {
  Adim "OpenStreetMap'ten kıyı çizgisi çıkarılıyor (osmium gerekir)" { PythonCalistir vapur-cizgi.py cikar (Join-Path $ist 'Istanbul.osm.pbf') $kiyi }
}
Adim "Vapur çizgileri (denizden)" { PythonCalistir vapur-cizgi.py ekle $kiyi $ray }
Adim "Hat adları" { PythonCalistir hat-adi-duzelt.py $ray }
Adim "İstasyonlar birleştiriliyor (raylı ve vapur)" { PythonCalistir durak-birlestir.py $ray }
Adim "İstasyonlar birleştiriliyor (İETT)" { PythonCalistir durak-birlestir.py $iett }
# Otobüslerin ara durak saatleri: İETT yalnız uç durakların saatini veriyor. Köprü en az bir
# gün çalıştıysa öğrendiği gerçek yol süreleriyle doldurulur; yoksa OTP eşit dağıtır.
$sureler = Join-Path $PSScriptRoot '..\kopru\kayit\segment-sureleri.json'
if (Test-Path $sureler) {
  Adim "Otobüs ara durak saatleri (köprünün öğrendiği yol süreleriyle)" { PythonCalistir iett-sure-uygula.py $iett $sureler }
} else {
  Write-Host "Köprünün öğrendiği yol süreleri yok ($sureler); ara durak saatleri eşit dağıtılacak." -ForegroundColor Yellow
}
Adim "Sağlama" { PythonCalistir dogrula.py $ist }
Adim "Uygulamanın ağ haritası" { PythonCalistir ag-cikar.py $ray ..\assets\veri\ag.json }
Adim "Uygulamanın sıklık verisi" { PythonCalistir siklik-cikar.py $ray ..\assets\veri\siklik.json }

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
