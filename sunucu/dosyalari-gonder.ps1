# Sunucunun ilk açılışı için gereken dosyaları bu bilgisayardan Tailscale üstünden gönderir:
# OTP, derlenmiş grafik ve beslemeler, veri kurulumunun elle üretilmiş girdileri ve
# köprünün öğrendiği durak arası süreler (baştan öğrenmesin diye).
#
# Kullanım (proje klasöründe):
#   powershell -ExecutionPolicy Bypass -File sunucu\dosyalari-gonder.ps1
#   powershell -ExecutionPolicy Bypass -File sunucu\dosyalari-gonder.ps1 -Sunucu ubuntu@100.x.y.z
#
# Windows 10/11'in kendi ssh/scp'si kullanılıyor. Sunucuya ilk bağlanışta "Are you sure you
# want to continue connecting" sorusuna yes yaz.

param(
  [string]$Sunucu = 'ubuntu@istanbul-ulasim',
  [string]$Otp = 'C:\otp'
)

$ErrorActionPreference = 'Stop'
$proje = Split-Path $PSScriptRoot -Parent
$hedef = '/srv/istanbul/otp'

$dosyalar = @(
  @{ Yerel = "$Otp\otp-shaded-2.10.0.jar";                  Uzak = "$hedef/" },
  @{ Yerel = "$Otp\istanbul\graph.obj";                     Uzak = "$hedef/istanbul/" },
  @{ Yerel = "$Otp\istanbul\Istanbul.osm.pbf";              Uzak = "$hedef/istanbul/" },
  @{ Yerel = "$Otp\istanbul\istanbul-iett-gtfs.zip";        Uzak = "$hedef/istanbul/" },
  @{ Yerel = "$Otp\istanbul\istanbul-ray-vapur-gtfs.zip";   Uzak = "$hedef/istanbul/" },
  @{ Yerel = "$Otp\istanbul\router-config.json";            Uzak = "$hedef/istanbul/" },
  @{ Yerel = "$Otp\osm-hatlar.json";                        Uzak = "$hedef/" },
  @{ Yerel = "$Otp\osm-kiyi.json";                          Uzak = "$hedef/" },
  @{ Yerel = "$Otp\metro-tarife.json";                      Uzak = "$hedef/" },
  @{ Yerel = "$Otp\vapur-tarife.json";                      Uzak = "$hedef/" },
  @{ Yerel = "$Otp\ozel-vapur-tarife.json";                 Uzak = "$hedef/" },
  @{ Yerel = "$proje\kopru\ogrenilen.json";                 Uzak = "/srv/istanbul/uygulama/kopru/" }
)

Write-Host "Sunucu: $Sunucu" -ForegroundColor Cyan
ssh $Sunucu "mkdir -p $hedef/istanbul /srv/istanbul/uygulama/kopru/kayit"
if ($LASTEXITCODE -ne 0) { Write-Host 'Sunucuya bağlanılamadı. Tailscale açık mı, sunucu adı doğru mu?' -ForegroundColor Red; exit 1 }

foreach ($d in $dosyalar) {
  if (-not (Test-Path $d.Yerel)) { Write-Host "  yok, atlandı: $($d.Yerel)" -ForegroundColor DarkYellow; continue }
  $mb = [math]::Round((Get-Item $d.Yerel).Length / 1MB, 1)
  Write-Host "  $($d.Yerel)  ($mb MB)"
  scp -q $d.Yerel "${Sunucu}:$($d.Uzak)"
  if ($LASTEXITCODE -ne 0) { Write-Host "  gönderilemedi: $($d.Yerel)" -ForegroundColor Red; exit 1 }
}

$kayit = Join-Path $proje 'kopru\kayit'
if (Test-Path $kayit) {
  Write-Host "  $kayit\*"
  scp -q -r "$kayit\*" "${Sunucu}:/srv/istanbul/uygulama/kopru/kayit/"
}

Write-Host ''
Write-Host 'Gönderildi. Sunucuda servisleri başlat:' -ForegroundColor Green
Write-Host "  ssh $Sunucu bash /srv/istanbul/uygulama/sunucu/baslat.sh"
