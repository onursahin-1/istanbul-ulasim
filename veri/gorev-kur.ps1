# Haftalık veri güncellemesini (haftalik-guncelle.ps1) Windows Görev Zamanlayıcı'ya kurar.
#
# Görev senin kullanıcınla, yalnız oturumun açıkken ve yönetici izni olmadan çalışır; parola
# sorulmaz. Bilgisayar uykudaysa uyandırır (Windows'ta "uyandırma zamanlayıcıları" açıksa).
# Kaçırılan çalıştırma sonradan yapılmaz: gündüz, uygulamayı kullanırken OTP 25 dakika
# kapanmasın diye. O hafta atlanır, ertesi hafta çalışır.
#
# Kullanım (veri klasöründe):
#   powershell -ExecutionPolicy Bypass -File .\gorev-kur.ps1                       pazartesi 04:30
#   powershell -ExecutionPolicy Bypass -File .\gorev-kur.ps1 -Gun Sunday -Saat 05:00
#   powershell -ExecutionPolicy Bypass -File .\gorev-kur.ps1 -SimdiCalistir         kur ve hemen bir kez çalıştır
#   powershell -ExecutionPolicy Bypass -File .\gorev-kur.ps1 -Kaldir
#
# Görevi görmek: Görev Zamanlayıcı → Görev Zamanlayıcı Kitaplığı → "Istanbul Ulasim - Haftalik veri".
# Son çalıştırmanın özeti: C:\otp\kayit\guncelleme\son-guncelleme.txt

param(
  [ValidateSet('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')]
  [string]$Gun = 'Monday',
  [string]$Saat = '04:30',
  [string]$Otp = 'C:\otp',
  [switch]$SimdiCalistir,
  [switch]$Kaldir
)

$ErrorActionPreference = 'Stop'
$ad = 'Istanbul Ulasim - Haftalik veri'

if ($Kaldir) {
  if (Get-ScheduledTask -TaskName $ad -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $ad -Confirm:$false
    Write-Host "Görev kaldırıldı: $ad" -ForegroundColor Green
  } else {
    Write-Host "Böyle bir görev yok: $ad"
  }
  exit 0
}

$betik = Join-Path $PSScriptRoot 'haftalik-guncelle.ps1'
if (-not (Test-Path $betik)) { throw "Bulunamadı: $betik" }

$eylem = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$betik`" -Otp `"$Otp`"" `
  -WorkingDirectory $PSScriptRoot
$tetik = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Gun -At $Saat
$ayar = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$kim = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $ad -Action $eylem -Trigger $tetik -Settings $ayar -Principal $kim `
  -Description "OTP ve köprüyü durdurur, yenile.ps1 -Derle ile veriyi baştan kurar, ikisini yeniden açar. $betik" `
  -Force | Out-Null

$gorev = Get-ScheduledTask -TaskName $ad
$bilgi = $gorev | Get-ScheduledTaskInfo
Write-Host "Görev kuruldu: $ad" -ForegroundColor Green
Write-Host "  her $Gun $Saat · sıradaki: $($bilgi.NextRunTime)"
Write-Host "  kayıtlar: $Otp\kayit\guncelleme\"

if ($SimdiCalistir) {
  Start-ScheduledTask -TaskName $ad
  Write-Host "Görev başlatıldı (~25 dk). OTP ve köprü kapanıp yeniden açılacak." -ForegroundColor Yellow
  Write-Host "İzlemek için:  Get-Content $Otp\kayit\guncelleme\son-guncelleme.txt  (bitince yazılır)"
}
