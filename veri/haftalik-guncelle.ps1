# Haftalık veri güncellemesi: OTP'yi ve köprüyü durdurur, yenile.ps1 -Derle ile bütün veriyi
# baştan kurup grafiği derler, sonra ikisini yeniden açar. Windows Görev Zamanlayıcı'dan
# çalışsın diye yazıldı (kurulum: gorev-kur.ps1); elle de çalıştırılabilir.
#
# Neden: Metro İstanbul, Şehir Hatları, Turyol/Dentur ve İETT tarifeleri değişiyor; yenile.ps1
# bunları kendisi indiriyor ama biri çalıştırmazsa uygulama eski tarifede kalıyor. Grafik
# derlenirken OTP kapalı olmalı (ikisi de ~6 GB bellek istiyor); köprü de İETT zip'ini yalnız
# açılışta okuyor, yeni zip'le yeniden açılmalı.
#
# Bir şey ters giderse eski hâle döner: yenile.ps1'in aldığı zip yedekleri ve bu betiğin
# aldığı graph.obj yedeği geri konur, OTP eski grafikle açılır. Yeni grafikle açılan OTP
# 15 dakika içinde cevap vermezse de aynısı yapılır.
#
# TCDD tarifesi (Marmaray, M11, T6) yenile.ps1'de Edge'le indiriliyor; indirme olmazsa son dosya
# kullanılıyor. Dosya 120 günden eskiyse (indirme uzun süredir başarısız) özete uyarı yazılır.
#
# Kayıtlar: C:\otp\kayit\guncelleme\  (son 12 çalıştırma tutulur)
#   guncelleme-<tarih>.log   bu betiğin adımları
#   yenile-<tarih>.log       yenile.ps1'in bütün çıktısı (indirme, işleme, derleme)
#   son-guncelleme.txt       son çalıştırmanın tek satırlık özeti
#
# Kullanım:
#   powershell -ExecutionPolicy Bypass -File .\haftalik-guncelle.ps1
#   powershell -ExecutionPolicy Bypass -File .\haftalik-guncelle.ps1 -EskiTarife   indirmeden, son tarifelerle
#   powershell -ExecutionPolicy Bypass -File .\haftalik-guncelle.ps1 -AcmaYok      sonunda OTP ve köprüyü açma

param(
  [string]$Otp = 'C:\otp',
  [string]$Jar = 'otp-shaded-2.10.0.jar',
  [switch]$EskiTarife,
  [switch]$AcmaYok
)

$ErrorActionPreference = 'Stop'
$veri = $PSScriptRoot
$kopru = Join-Path $PSScriptRoot '..\kopru' | Resolve-Path | Select-Object -ExpandProperty Path
$ist = Join-Path $Otp 'istanbul'
$grafik = Join-Path $ist 'graph.obj'
$kayitKlasoru = Join-Path $Otp 'kayit\guncelleme'
New-Item -ItemType Directory -Force -Path $kayitKlasoru | Out-Null
$damga = Get-Date -Format 'yyyyMMdd-HHmm'
$baslangic = Get-Date
Start-Transcript -Path (Join-Path $kayitKlasoru "guncelleme-$damga.log") | Out-Null

function Yaz([string]$metin, [string]$renk = 'Gray') {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $metin) -ForegroundColor $renk
}

function PortAcik([int]$port) {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Bekle([scriptblock]$kosul, [int]$saniye, [int]$aralik = 5) {
  $bitis = (Get-Date).AddSeconds($saniye)
  while ((Get-Date) -lt $bitis) {
    if (& $kosul) { return $true }
    Start-Sleep -Seconds $aralik
  }
  return [bool](& $kosul)
}

function Surecler([string]$ad, [string]$desen) {
  @(Get-CimInstance Win32_Process -Filter "Name='$ad'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $desen })
}

function OtpDurdur {
  $liste = @(Surecler 'java.exe' 'otp-shaded.*--serve') + @(Surecler 'javaw.exe' 'otp-shaded.*--serve')
  foreach ($s in $liste) {
    Yaz "OTP durduruluyor (süreç $($s.ProcessId))"
    Stop-Process -Id $s.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if (-not (Bekle { -not (PortAcik 8080) } 60 2)) { throw "8080 kapanmadı; OTP durdurulamadı." }
}

function KopruDurdur {
  if (PortAcik 8082) {
    # Ctrl+C gibi: öğrenilenleri ve İBB istek bütçesini yazıp kapanır (sunucu.mjs, POST /kapat).
    try {
      Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8082/kapat' -TimeoutSec 10 | Out-Null
      Yaz 'Köprüye kapan dendi'
    } catch {
      Yaz "Köprü kapat isteğine cevap vermedi: $($_.Exception.Message)" 'Yellow'
    }
    if (Bekle { -not (PortAcik 8082) } 30 2) { return }
  }
  # Eski köprü (/kapat'ı bilmeyen) ya da takılan: zorla. En çok son 5 dakikanın öğrendikleri gider.
  foreach ($s in (Surecler 'node.exe' 'sunucu\.mjs')) {
    Yaz "Köprü zorla durduruluyor (süreç $($s.ProcessId))" 'Yellow'
    Stop-Process -Id $s.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if (-not (Bekle { -not (PortAcik 8082) } 30 2)) { throw "8082 kapanmadı; köprü durdurulamadı." }
}

function OtpAc {
  $komut = "`$Host.UI.RawUI.WindowTitle = 'OTP'; Set-Location '$Otp'; java -Xmx6G -jar $Jar --load --serve istanbul"
  Start-Process powershell.exe -ArgumentList @('-NoExit', '-NoProfile', '-Command', $komut) -WindowStyle Minimized | Out-Null
  Yaz 'OTP açılıyor (küçültülmüş pencerede)'
}

function KopruAc {
  $komut = "`$Host.UI.RawUI.WindowTitle = 'Köprü'; Set-Location '$kopru'; npm start"
  Start-Process powershell.exe -ArgumentList @('-NoExit', '-NoProfile', '-Command', $komut) -WindowStyle Minimized | Out-Null
  Yaz 'Köprü açılıyor (küçültülmüş pencerede)'
}

function OtpCevapVeriyor {
  try {
    $govde = '{"query":"{ feeds { feedId } }"}'
    $c = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/otp/gtfs/v1' -ContentType 'application/json' -Body $govde -TimeoutSec 20
    return @($c.data.feeds).Count -gt 0
  } catch { return $false }
}

function KopruCevapVeriyor {
  try { Invoke-RestMethod -Uri 'http://127.0.0.1:8082/durum' -TimeoutSec 10 | Out-Null; return $true } catch { return $false }
}

function EskiyeDon([string]$yedek) {
  Yaz 'Eski hâle dönülüyor' 'Yellow'
  if ($yedek -and (Test-Path $yedek)) {
    Get-ChildItem $yedek -Filter *.zip | Copy-Item -Destination $ist -Force
    Yaz "  zip'ler geri kondu: $yedek"
  }
  $grafikYedek = Join-Path $Otp 'yedekler\graph-onceki.obj'
  if (Test-Path $grafikYedek) {
    Copy-Item $grafikYedek $grafik -Force
    Yaz '  graph.obj geri kondu'
  }
}

function Ozet([string]$sonuc) {
  $dk = [int]((Get-Date) - $baslangic).TotalMinutes
  $satir = "{0}  {1}  ({2} dk)  ayrıntı: guncelleme-{3}.log, yenile-{3}.log" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $sonuc, $dk, $damga
  Set-Content -Path (Join-Path $kayitKlasoru 'son-guncelleme.txt') -Value $satir -Encoding UTF8
  Yaz $satir
}

$sonuc = 'BAŞARILI'
$cikis = 0
try {
  Yaz "Haftalık güncelleme başladı ($Otp)" 'Cyan'

  # TCDD tarifesi indirilemezse eski dosya kullanılıyor; uzun süredir böyleyse hatırlat.
  $tcdd = Join-Path $Otp 'marmaray-tarife.json'
  if (-not (Test-Path $tcdd)) {
    $sonuc = 'BAŞARILI (uyarı: marmaray-tarife.json yok)'
  } elseif ((Get-Item $tcdd).LastWriteTime -lt (Get-Date).AddDays(-120)) {
    $sonuc = 'BAŞARILI (uyarı: TCDD tarifesi 120 günden eski, indirme başarısız olabilir: yenile-*.log, README 4c2)'
  }

  $otpAcikti = PortAcik 8080
  $kopruAcikti = PortAcik 8082
  Yaz "Önceki durum: OTP $(if ($otpAcikti) {'açık'} else {'kapalı'}), köprü $(if ($kopruAcikti) {'açık'} else {'kapalı'})"
  OtpDurdur
  KopruDurdur

  # Derleme yarıda kalırsa eski grafiğe dönebilmek için.
  New-Item -ItemType Directory -Force -Path (Join-Path $Otp 'yedekler') | Out-Null
  if (Test-Path $grafik) {
    Copy-Item $grafik (Join-Path $Otp 'yedekler\graph-onceki.obj') -Force
    Yaz 'graph.obj yedeklendi'
  }

  # yenile.ps1 ayrı bir PowerShell'de; bütün akışları (Write-Host, python, node, java) sırasıyla
  # tek dosyaya. Python'un çıktısı UTF-8 olsun diye PYTHONUTF8.
  $yenileKayit = Join-Path $kayitKlasoru "yenile-$damga.log"
  $ekler = '-Derle'
  if ($EskiTarife) { $ekler += ' -EskiTarife' }
  $komut = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
    "& '$(Join-Path $veri 'yenile.ps1')' -Otp '$Otp' $ekler *>&1 | Out-File -FilePath '$yenileKayit' -Encoding utf8 -Width 400; " +
    "exit `$LASTEXITCODE"
  $env:PYTHONUTF8 = '1'
  Yaz "yenile.ps1 $ekler çalışıyor (~25 dk) → $yenileKayit"
  $surec = Start-Process powershell.exe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $komut) `
    -WorkingDirectory $veri -NoNewWindow -Wait -PassThru
  $yedek = Get-ChildItem (Join-Path $Otp 'yedekler') -Directory -Filter 'yenile-*' -ErrorAction SilentlyContinue |
    Where-Object { $_.CreationTime -ge $baslangic.AddMinutes(-1) } | Sort-Object CreationTime | Select-Object -Last 1 -ExpandProperty FullName

  if ($surec.ExitCode -ne 0) {
    Yaz "yenile.ps1 başarısız (çıkış kodu $($surec.ExitCode)). Son satırlar:" 'Red'
    Get-Content $yenileKayit -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Yaz "  $_" 'DarkGray' }
    EskiyeDon $yedek
    $sonuc = "BAŞARISIZ: yenile.ps1 çıkış kodu $($surec.ExitCode), eski veriyle devam"
    $cikis = 1
  } else {
    Yaz 'yenile.ps1 bitti' 'Green'
  }

  if (-not $AcmaYok) {
    OtpAc
    if (-not (Bekle { OtpCevapVeriyor } 900 15)) {
      if ($cikis -eq 0) {
        Yaz 'OTP yeni grafikle 15 dakikada cevap vermedi; eski grafiğe dönülüyor.' 'Red'
        OtpDurdur
        EskiyeDon $yedek
        OtpAc
        $sonuc = 'BAŞARISIZ: yeni grafikle OTP açılmadı, eski veriyle devam'
        $cikis = 1
        if (-not (Bekle { OtpCevapVeriyor } 900 15)) { $sonuc += '; OTP eski grafikle de açılmadı!' }
      } else {
        $sonuc += '; OTP açılmadı!'
      }
    }
    if (OtpCevapVeriyor) { Yaz 'OTP cevap veriyor' 'Green' }
    KopruAc
    if (Bekle { KopruCevapVeriyor } 180 5) { Yaz 'Köprü cevap veriyor' 'Green' } else { $sonuc += '; köprü açılmadı!'; $cikis = 1 }
  }

  # Eski yedekler ve kayıtlar: haftada ~60 MB yedek birikmesin.
  Get-ChildItem (Join-Path $Otp 'yedekler') -Directory -Filter 'yenile-*' -ErrorAction SilentlyContinue |
    Sort-Object CreationTime -Descending | Select-Object -Skip 4 | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  foreach ($desen in 'guncelleme-*.log', 'yenile-*.log') {
    Get-ChildItem $kayitKlasoru -Filter $desen | Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 12 | Remove-Item -Force -ErrorAction SilentlyContinue
  }

  if ($cikis -eq 0) {
    Yaz "Uygulamanın dosyaları (assets\veri\ag.json, siklik.json) değişmiş olabilir: git status ile bak, commit'le."
  }
} catch {
  Yaz "Beklenmeyen hata: $($_.Exception.Message)" 'Red'
  $sonuc = "BAŞARISIZ: $($_.Exception.Message)"
  $cikis = 1
  if (-not $AcmaYok) {
    if (-not (PortAcik 8080)) { OtpAc }
    if (-not (PortAcik 8082)) { KopruAc }
  }
} finally {
  Ozet $sonuc
  Stop-Transcript | Out-Null
}
exit $cikis
