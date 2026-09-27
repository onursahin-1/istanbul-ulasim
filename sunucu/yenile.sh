#!/usr/bin/env bash
# veri/yenile.ps1'in sunucu (Linux) karşılığı: bütün veriyi baştan kurar, istenirse OTP
# grafiğini derleyip servisleri yeniden başlatır. Adımlar ve sıra yenile.ps1 ile aynı;
# biri değişirse ikisi birlikte güncellenmeli.
#
# Kullanım (sunucuda):
#   bash /srv/istanbul/uygulama/sunucu/yenile.sh              veriyi kur (~20 dk)
#   bash /srv/istanbul/uygulama/sunucu/yenile.sh --derle      sonunda grafiği derle, servisleri yenile
#   bash /srv/istanbul/uygulama/sunucu/yenile.sh --eski-tarife --derle
#                                                             metro/vapur tarifelerini indirme
#
# Derleme sırasında OTP ve Expo durduruluyor (12 GB'ta derleme 8 GB istiyor); köprü
# çalışmayı sürdürüyor. Derleme ~15-25 dk; bu sürede uygulama rota bulamaz, o yüzden
# gece çalıştırmak iyi (README'de haftalık zamanlama var).
set -uo pipefail

DERLE=0
ESKI=0
for a in "$@"; do
  case "$a" in
    --derle) DERLE=1 ;;
    --eski-tarife) ESKI=1 ;;
    *) echo "bilinmeyen seçenek: $a" >&2; exit 2 ;;
  esac
done

OTP=/srv/istanbul/otp
IST=$OTP/istanbul
RAY=$IST/istanbul-ray-vapur-gtfs.zip
IETT=$IST/istanbul-iett-gtfs.zip
OSM=$OTP/osm-hatlar.json
METRO=$OTP/metro-tarife.json
VAPUR=$OTP/vapur-tarife.json
OZEL=$OTP/ozel-vapur-tarife.json
KIYI=$OTP/osm-kiyi.json
BAS=$(date +%s)
N=0
YEDEK=$OTP/yedekler/yenile-$(date +%Y%m%d-%H%M)

cd "$(dirname "$0")/../veri"

adim() {
  local ad="$1"; shift
  N=$((N + 1))
  printf '\n\033[1;36m[%d] %s\033[0m\n' "$N" "$ad"
  if ! "$@"; then
    printf '\033[1;31mAdım başarısız: %s. Kurulum durdu; eski zip'"'"'ler: %s\033[0m\n' "$ad" "$YEDEK"
    exit 1
  fi
}

for gerekli in "$OSM" "$KIYI"; do
  [[ -f "$gerekli" ]] || { echo "Eksik: $gerekli (bilgisayardan gönder: sunucu/dosyalari-gonder.ps1)"; exit 1; }
done

mkdir -p "$YEDEK"
cp "$IST"/*.zip "$YEDEK"/ 2>/dev/null || true
echo "Eski zip'ler yedeklendi: $YEDEK"

adim "İBB verisi indiriliyor ve GTFS'e çevriliyor" node hazirla-gtfs.mjs "$IST"
adim "Eksik istasyonlar tamamlanıyor" python3 istasyon-tamamla.py "$OSM" "$RAY"
adim "Marmaray düzeltmeleri" python3 marmaray-duzelt.py "$RAY"
adim "Eksik hatlar (T5, T6, F4…) ekleniyor" python3 eksik-hatlar.py "$OSM" "$IST"
if [[ $ESKI -eq 0 || ! -f $METRO ]]; then
  adim "Metro İstanbul tarifesi indiriliyor (~10 dk)" node metro-tarife-indir.mjs "$METRO"
fi
adim "Metro tarifesi işleniyor" python3 metro-tarife-uygula.py "$METRO" "$RAY"
if [[ $ESKI -eq 0 || ! -f $VAPUR ]]; then
  adim "Şehir Hatları tarifesi indiriliyor" node vapur-tarife-indir.mjs "$VAPUR"
fi
adim "Vapur tarifesi işleniyor" python3 vapur-tarife-uygula.py "$VAPUR" "$RAY"
if [[ $ESKI -eq 0 || ! -f $OZEL ]]; then
  adim "Turyol ve Dentur tarifesi indiriliyor" node ozel-vapur-indir.mjs "$OZEL"
fi
adim "Turyol ve Dentur tarifesi işleniyor" python3 ozel-vapur-uygula.py "$OZEL" "$RAY"
adim "Erişim (basamaksız) işaretleri" python3 erisim-isaretle.py "$RAY" "$IETT"
adim "Resmî tatiller ve bayramlar" python3 ozel-gun-takvimi.py ../assets/veri/ozel-gunler.json "$RAY" "$IETT"
adim "Hat çizgileri" python3 cizgi-ekle.py "$OSM" "$RAY"
adim "Vapur çizgileri (denizden)" python3 vapur-cizgi.py ekle "$KIYI" "$RAY"
adim "Hat adları" python3 hat-adi-duzelt.py "$RAY"
adim "İstasyonlar birleştiriliyor (raylı ve vapur)" python3 durak-birlestir.py "$RAY"
adim "İstasyonlar birleştiriliyor (İETT)" python3 durak-birlestir.py "$IETT"
adim "Sağlama" python3 dogrula.py "$IST"
adim "Uygulamanın ağ haritası" python3 ag-cikar.py "$RAY" ../assets/veri/ag.json
adim "Uygulamanın sıklık verisi" python3 siklik-cikar.py "$RAY" ../assets/veri/siklik.json

if [[ $DERLE -eq 1 ]]; then
  derle() {
    sudo systemctl stop istanbul-otp istanbul-expo
    (cd "$OTP" && java -Xmx8G -jar otp-shaded-2.10.0.jar --build --save istanbul)
    local sonuc=$?
    sudo systemctl start istanbul-otp istanbul-expo
    sudo systemctl restart istanbul-kopru
    return $sonuc
  }
  adim "OTP grafiği derleniyor (OTP ve Expo bu sürede kapalı)" derle
fi

echo
echo "Bitti ($(( ($(date +%s) - BAS) / 60 )) dk)."
if [[ $DERLE -eq 0 ]]; then
  echo "Grafiği derlemek için:  bash $(realpath ../sunucu/yenile.sh) --eski-tarife --derle"
fi
