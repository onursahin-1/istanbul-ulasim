#!/usr/bin/env bash
# Üç servisi (OTP, köprü, Expo) yeniden başlatır ve OTP hazır olunca durumu yazar.
# OTP grafiği yüklemesi ARM sunucuda 1-3 dakika sürer.
set -uo pipefail

sudo systemctl restart istanbul-otp
sudo systemctl restart istanbul-kopru istanbul-expo

printf 'OTP bekleniyor'
for _ in $(seq 1 60); do
  if curl -fs -o /dev/null -X POST -H 'Content-Type: application/json' \
       --data '{"query":"{ feeds { feedId } }"}' http://localhost:8080/otp/gtfs/v1; then
    printf ' hazır.\n'
    break
  fi
  printf '.'
  sleep 5
done

for s in istanbul-otp istanbul-kopru istanbul-expo; do
  printf '%-16s %s\n' "$s" "$(systemctl is-active $s)"
done
TS_IP=$(tailscale ip -4 | head -1)
echo
echo "Köprü durumu:  curl -s http://localhost:8082/durum | head -c 400"
echo "iPhone'da Safari'de aç:  exp://$TS_IP:8081"
