// OTP'ye canlı veri köprüsünü tanıtan router-config.json'u yazar.
//
// feedId elle bulunup yazılmak zorundaydı: OTP besleme kimliklerini kendisi
// atıyor (build-config'te verilmediği için) ve yanlış kimlikle güncelleyici
// sessizce hiçbir sefer eşleştiremiyor. Bu betik kimliği çalışan OTP'ye
// soruyor, İETT beslemesini işletme adından buluyor ve dosyayı yazıyor.
//
// Kullanım (OTP açıkken):
//   node kopru\otp-ayari-yaz.mjs [otp-klasoru] [otp-adresi] [kopru-adresi]
// Varsayılanlar: C:\otp\istanbul · http://localhost:8080 · http://localhost:8082

import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KLASOR = process.argv[2] ?? 'C:\\otp\\istanbul';
const OTP = process.argv[3] ?? 'http://localhost:8080';
const KOPRU = process.argv[4] ?? 'http://localhost:8082';

const yanit = await fetch(`${OTP}/otp/gtfs/v1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ feeds { feedId agencies { name } } }' }),
}).catch((e) => {
  console.error(`${OTP} adresine ulaşılamadı: ${e.message}\nOTP açık mı?`);
  process.exit(1);
});
const beslemeler = (await yanit.json())?.data?.feeds ?? [];
for (const b of beslemeler) {
  console.log(`besleme ${b.feedId}  ←  ${(b.agencies ?? []).map((a) => a.name).join(', ')}`);
}

// İETT beslemesinin tek işletmesi "IETT". Raylı beslemede İETT geçmiyor.
const iett = beslemeler.filter((b) => (b.agencies ?? []).some((a) => /^[iİI]ETT$/i.test(a.name.trim())));
if (iett.length !== 1) {
  console.error(`\nİETT beslemesi ${iett.length === 0 ? 'bulunamadı' : 'birden çok çıktı'}; dosya yazılmadı.`);
  process.exit(1);
}
const feedId = iett[0].feedId;

// Değerler BÜYÜK HARFLE ve alt çizgiyle, OTP'deki enum adlarının birebir aynısı.
// OTP gelen değeri dil belirtmeden büyük harfe çeviriyor; Türkçe Windows'ta
// "vehicle-positions" → "VEHİCLE-POSİTİONS" (noktalı İ) oluyor ve hiçbir enum'a
// uymuyor: "The parameter value 'vehicle-positions' is not legal". Büyük harfli
// yazım çevrilirken değişmediği için her dil ayarında çalışıyor. OTP 2.10'un
// kendisiyle tr_TR ve en_US altında sınandı.
const ayar = {
  updaters: [
    {
      type: 'VEHICLE_POSITIONS',
      feedId,
      url: `${KOPRU}/arac-konumlari`,
      frequency: '45s',
      features: ['POSITION'],
    },
    {
      type: 'STOP_TIME_UPDATER',
      feedId,
      url: `${KOPRU}/sefer-guncellemeleri`,
      frequency: '45s',
    },
  ],
};

const dosya = join(KLASOR, 'router-config.json');
if (existsSync(dosya)) {
  copyFileSync(dosya, `${dosya}.yedek`);
  console.log(`\nvar olan dosya yedeklendi: ${dosya}.yedek`);
}
writeFileSync(dosya, `${JSON.stringify(ayar, null, 2)}\n`);
console.log(`\nİETT beslemesi: ${feedId}\nyazıldı: ${dosya}`);
console.log('Şimdi köprüyü başlat, sonra OTP\'yi --load --serve ile yeniden başlat.');
