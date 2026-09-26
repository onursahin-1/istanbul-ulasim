// Köprünün ölçtüğü varış doğruluğunu tablo olarak yazar.
//
//   node kalite-rapor.mjs              → bugünün dosyası (yoksa en yenisi)
//   node kalite-rapor.mjs 2026-09-26   → o günün dosyası
//
// Sütunlar: hata = gerçek varış − tahmin (dakika). + : otobüs tahminden geç geldi.
// "yeni" aracı iki durak arasına yerleştiren ölçüm, "eski" en yakın durağa göre olan.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KLASOR = fileURLToPath(new URL('./kayit/', import.meta.url));
const istenen = process.argv[2];
const dosyalar = existsSync(KLASOR) ? readdirSync(KLASOR).filter((a) => /^kalite-.*\.json$/.test(a)).sort() : [];
const dosya = istenen ? `kalite-${istenen}.json` : dosyalar.at(-1);
if (!dosya || !existsSync(join(KLASOR, dosya))) {
  console.error('Ölçüm dosyası yok. Köprü en az bir saat çalışınca kayit/ klasöründe oluşur.');
  process.exit(1);
}
const r = JSON.parse(readFileSync(join(KLASOR, dosya), 'utf8'));
const dk = (sn) => (sn == null ? '   -' : `${sn >= 0 ? '+' : ''}${(sn / 60).toFixed(1)}`.padStart(5));

console.log(`\n${dosya} · ${r.baslangic} başladı · ${r.sayac.gozlem} gözlem\n`);
console.log('Ufuk          yöntem  örnek   ortalama  ortanca  ort.|hata|  %10   %90   >2 dk');
for (const [ufuk, { yeni, eski }] of Object.entries(r.varisHatasi)) {
  for (const [ad, o] of [['yeni', yeni], ['eski', eski]]) {
    if (!o.n) {
      console.log(`${ufuk.padEnd(13)} ${ad.padEnd(6)}  ${'0'.padStart(5)}`);
      continue;
    }
    console.log(
      `${ufuk.padEnd(13)} ${ad.padEnd(6)}  ${String(o.n).padStart(5)}   ${dk(o.ortalamaSn)}    ${dk(o.ortancaSn)}    ` +
        `${(o.ortalamaMutlakSn / 60).toFixed(1).padStart(5)}     ${dk(o.y10Sn)} ${dk(o.y90Sn)}  %${o.ikiDkUstuYuzde}`,
    );
  }
}
const g = r.gecikmeDagilimi;
console.log(`\nYayımlanan gecikme: yeni ortanca ${dk(g.yeni.ortancaSn)} dk, eski ortanca ${dk(g.eski.ortancaSn)} dk`);
console.log(`Sefer değişen araç: ${r.sayac.seferDegisti} · geri giden: ${r.sayac.geriGitti} · sonuçsuz tahmin: ${r.sayac.zamanAsimi}\n`);
