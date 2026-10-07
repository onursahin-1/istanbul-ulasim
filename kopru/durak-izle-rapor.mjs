// durak-izle kaydını okunur yazar.
//
//   node durak-izle-rapor.mjs                         en yeni kayıt, otobüs otobüs özet
//   node durak-izle-rapor.mjs <kayıt>                 o kayıt
//   node durak-izle-rapor.mjs <kayıt> 17:34 17:41:30  o anlarda iki kaynak ne diyordu
//
// Saat verilince her durak ve hat için o anki dakikalar yazılır: "Otobüsüm Nerede?"
// ekran görüntüsünün saatini ver, karşısına aynı anda bizim söylediğimiz gelsin.
// Özet ise her otobüsün tahmini varışının kayıt boyunca nasıl oynadığını ve listeden
// (durağa varınca) ne zaman düştüğünü gösterir.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { anlikGoruntu, aracCizelgesi, kaydiAyristir, saattenAn } from './durak-izle-ozet.mjs';

const KLASOR = join(dirname(fileURLToPath(import.meta.url)), 'kayit', 'durak-izle');
const argumanlar = process.argv.slice(2);
const saatler = argumanlar.filter((a) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(a));
let dosya = argumanlar.find((a) => !saatler.includes(a));
if (!dosya) {
  // En yeni: dosya adındaki tarih-saat (adın sonu), durak kodundan bağımsız.
  const liste = existsSync(KLASOR)
    ? readdirSync(KLASOR)
        .filter((a) => a.endsWith('.jsonl'))
        .sort((a, b) => a.slice(-21).localeCompare(b.slice(-21)))
    : [];
  if (!liste.length) {
    console.error('Kayıt yok. Önce: node durak-izle.mjs <durak kodu>');
    process.exit(1);
  }
  dosya = join(KLASOR, liste.at(-1));
}
const olaylar = kaydiAyristir(readFileSync(dosya, 'utf8'));
const basla = olaylar.find((o) => o.tur === 'basla');
if (!basla) {
  console.error(`${dosya}: başlangıç satırı yok.`);
  process.exit(1);
}
const durakAdi = new Map(basla.duraklar.map((d) => [d.id, `${d.ad}${d.yon ? ` (${d.yon} yönü)` : ''} · ${d.kod}`]));
const kimlik = (id) => id.slice(id.lastIndexOf(':') + 1);
const saat = (ms, sn = false) =>
  new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', ...(sn ? { second: '2-digit' } : {}), timeZone: 'Europe/Istanbul' });
const ornekSayisi = olaylar.filter((o) => o.tur === 'ornek').length;
const sonOlay = olaylar.at(-1);
console.log(`\n${dosya}\n${saat(basla.t)}–${saat(sonOlay.t)} · ${ornekSayisi} örnek · ${[...durakAdi.values()].join(' | ')}`);

// ---------------------------------------------------------------- belirli anlar

for (const s of saatler) {
  const an = saattenAn(s, basla.t);
  const g = an == null ? null : anlikGoruntu(olaylar, an);
  console.log(`\n=== ${s} ===`);
  if (!g) {
    console.log('  Bu ana yakın örnek yok (kayıt dışında ya da köprü/OTP cevap vermemiş).');
    continue;
  }
  console.log(`  (örnek ${saat(g.ornekAn, true)}${g.bayat ? ', köprü verisi BAYAT' : ''})`);
  for (const [id, hatlar] of Object.entries(g.duraklar)) {
    console.log(`  ${durakAdi.get(kimlik(id)) ?? id}`);
    const sirali = Object.entries(hatlar).sort(([a], [b]) => a.localeCompare(b, 'tr', { numeric: true }));
    for (const [hat, { arac, otp }] of sirali) {
      const a =
        arac
          .slice(0, 3)
          .map((v) => `${v.dk} dk (${v.kalan} durak, ${v.kapi}${v.durDk != null ? `, ${v.durDk} dk'dır duruyor` : ''})`)
          .join(', ') || '—';
      const o = otp.slice(0, 3).map((k) => `${k.dk} dk${k.canli ? '' : ' tarife'}`).join(', ') || '—';
      console.log(`    ${hat.padEnd(6)} araç: ${a.padEnd(48)} OTP: ${o}`);
    }
    // Köprünün tanısı (yeni köprüde): sayılmayan araçlar, hatların taranma durumu ve
    // durağın yakınında hattı başka sanılan araçlar.
    const t = g.teshis?.[kimlik(id)];
    if (!Array.isArray(t?.araclar)) continue;
    const taranma = Object.entries(t.hatlar)
      .map(([h, d]) => `${h} ${d.sonTaramaDkOnce == null ? 'hiç' : `${d.sonTaramaDkOnce} dk önce`}${d.ilgide ? '' : ' (ilgide değil)'}`)
      .join(', ');
    console.log(`    hat taraması: ${taranma}`);
    for (const a of t.araclar.filter((x) => x.neden)) console.log(`    sayılmadı: ${a.hat} ${a.kapiNo} — ${a.neden}`);
    for (const a of t.yakindakiBaskaHat.filter((x) => x.metre <= 800)) {
      const ogr = a.ogrenmeDkOnce == null ? '' : `, ${a.ogrenmeDkOnce < 120 ? `${a.ogrenmeDkOnce} dk` : `${Math.round(a.ogrenmeDkOnce / 60)} sa`} önce öğrenildi`;
      console.log(`    yakında: ${a.kapiNo} ${a.metre} m — hattı ${a.bilinenHat ?? 'bilinmiyor'}${ogr}`);
    }
  }
}
if (saatler.length) process.exit(0);

// ---------------------------------------------------------------- otobüs otobüs

console.log('\nHer otobüs: ilk görüldüğünde ve sonra tahmini varış (saat), listeden düştüğü an.');
console.log('Düşüş ≈ durağa varış; köprünün konumu ~1,5 dk geride olabilir.\n');
for (const a of aracCizelgesi(olaylar)) {
  // Tahmin değişince yaz: "17:31 → 17:40 (6 durak)" gibi.
  const degisimler = [];
  let onceki = null;
  for (const t of a.tahminler) {
    const s = saat(t.varis);
    if (s !== onceki) degisimler.push(`${saat(t.t)}'de ${s} (${t.kalan} d.)`);
    onceki = s;
  }
  const ilk = a.tahminler[0].varis;
  const fark = a.dustu ? Math.round((a.dustu - ilk) / 60_000) : null;
  console.log(
    `${a.hat.padEnd(6)} ${a.kapi.padEnd(8)} ${durakAdi.get(kimlik(a.durak))?.split(' · ')[1] ?? ''}  ` +
      `${degisimler.join(' → ')}  ⇒ ${a.dustu ? `düştü ${saat(a.dustu)} (ilk tahminden ${fark >= 0 ? '+' : ''}${fark} dk)` : 'kayıt bitti, düşmedi'}`,
  );
}
