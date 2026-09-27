#!/usr/bin/env bash
# Bilgisayarda push'ladığın kodu sunucuya alır ve servisleri yeniler.
#
# Sunucudaki veri kurulumu (veri/yenile.sh) ag.json ve siklik.json'u yeniden üretiyor;
# bunlar depodakiyle çakışmasın diye önce depodaki hallerine döndürülüyor, çekme bittikten
# sonra sunucunun kendi verisinden yeniden üretiliyor.
#
# Kullanım (sunucuda):  bash /srv/istanbul/uygulama/sunucu/guncelle.sh
set -euo pipefail

UYGULAMA=/srv/istanbul/uygulama
RAY=/srv/istanbul/otp/istanbul/istanbul-ray-vapur-gtfs.zip
cd $UYGULAMA

git checkout -- assets/veri/ag.json assets/veri/siklik.json 2>/dev/null || true
ONCE=$(git rev-parse HEAD)
git pull --ff-only
SONRA=$(git rev-parse HEAD)

if [[ "$ONCE" == "$SONRA" ]]; then
  echo "Yeni commit yok."
else
  git --no-pager log --oneline "$ONCE..$SONRA"
  if ! git diff --quiet "$ONCE" "$SONRA" -- package-lock.json; then npm ci --no-audit --no-fund; fi
  if ! git diff --quiet "$ONCE" "$SONRA" -- kopru/package-lock.json; then (cd kopru && npm ci --no-audit --no-fund); fi
fi

if [[ -f $RAY ]]; then
  (cd veri && python3 ag-cikar.py $RAY ../assets/veri/ag.json >/dev/null && python3 siklik-cikar.py $RAY ../assets/veri/siklik.json >/dev/null)
fi

sudo systemctl restart istanbul-kopru istanbul-expo
echo "Köprü ve Expo yeniden başlatıldı. Telefonda uygulamayı kapatıp aç."
