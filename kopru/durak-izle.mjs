// Bir (ya da birkaç) durağa gelen otobüsler için iki tahmin kaynağını kayda alır:
//
//   • köprü (araç tabanlı, /durak-varislari): durak ekranı, yakındaki duraklar listesi ve
//     bekleme kartı bunu gösteriyor. "Otobüsüm Nerede?" gibi: otobüsün yerinden.
//   • OTP (sefer tabanlı): rota sonuçlarının saatleri bundan. Otobüs bir tarife seferine
//     bağlanıyor, gecikme seferin geri kalanına yayılıyor.
//
// Amaç "Otobüsüm Nerede?" ile karşılaştırmak: durakta iki uygulamanın ekran görüntüsünü
// alırken bu betik bilgisayarda (köprü ve OTP açıkken) 30 saniyede bir yazıyor. Görüntünün
// saati ile kayıttaki an eşleşiyor: node durak-izle-rapor.mjs <kayıt> 17:34
//
// Kullanım (kopru klasöründe, köprü ve OTP açıkken; Ctrl+C ile durur):
//   node durak-izle.mjs 125181                 durak kodu ("Otobüsüm Nerede?"de yazan)
//   node durak-izle.mjs 125181,125182          birkaç durak (ör. meydanın iki yönü)
//   node durak-izle.mjs "göztepe meydanı"      ada göre (bütün yönleri)
//   node durak-izle.mjs 125181 --aralik 20     saniyede bir (varsayılan 30)
//
// Kayıt: kayit/durak-izle/<ilk-kod>-<tarih-saat>.jsonl

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { csvAyristir, zipAc } from './gtfs-oku.mjs';

const KLASOR = dirname(fileURLToPath(import.meta.url));
const ZIP = process.env.GTFS_ZIP ?? 'C:\\otp\\istanbul\\istanbul-iett-gtfs.zip';
const KOPRU = process.env.KOPRU ?? 'http://localhost:8082';
const OTP = process.env.OTP ?? 'http://localhost:8080';
const BESLEME = process.env.BESLEME ?? '1';

let ARALIK_SN = 30;
const durakArgumanlari = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--aralik') ARALIK_SN = Math.max(10, Number(process.argv[++i]) || 30);
  else durakArgumanlari.push(process.argv[i]);
}
// Tırnaksız yazılan ad da olur: node durak-izle.mjs göztepe meydanı
const istenen = durakArgumanlari.join(' ').trim();
if (!istenen) {
  console.error('Durak kodu ya da adı ver: node durak-izle.mjs 125181');
  process.exit(1);
}

// ---------------------------------------------------------------- durağı bul

const trKucuk = (s) => (s ?? '').toLocaleLowerCase('tr-TR').trim();
const tumDuraklar = csvAyristir(zipAc(ZIP, ['stops.txt'])['stops.txt'].toString('utf8')).filter(
  (d) => (d.location_type ?? '0') === '0' || d.location_type === '',
);
const duraklar = [];
for (const parca of istenen.split(',').map((x) => x.trim()).filter(Boolean)) {
  const bulunan = /^\d+$/.test(parca)
    ? tumDuraklar.filter((d) => d.stop_code === parca || d.stop_id === parca)
    : tumDuraklar.filter((d) => trKucuk(d.stop_name) === trKucuk(parca));
  if (!bulunan.length) {
    console.error(`"${parca}" diye bir durak bulunamadı (durak kodu, durak kimliği ya da tam ad).`);
    process.exit(1);
  }
  for (const d of bulunan) if (!duraklar.some((x) => x.stop_id === d.stop_id)) duraklar.push(d);
}
const yonYaz = (desc) => (desc ?? '').replace(/^direction:\s*/i, '').trim();
const etiket = (d) => `${d.stop_name}${yonYaz(d.stop_desc) ? ` (${yonYaz(d.stop_desc)} yönü)` : ''} · ${d.stop_code}`;

// ---------------------------------------------------------------- kayıt dosyası

const simdiYaz = () =>
  new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Istanbul' });
const anYaz = (ms) => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const damga = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' })
  .replace(/[-:]/g, '')
  .replace(' ', '-')
  .slice(0, 15);
const KAYIT_KLASORU = join(KLASOR, 'kayit', 'durak-izle');
mkdirSync(KAYIT_KLASORU, { recursive: true });
const KAYIT = join(KAYIT_KLASORU, `${duraklar[0].stop_code || duraklar[0].stop_id}-${damga}.jsonl`);
const yaz = (olay) => appendFileSync(KAYIT, `${JSON.stringify({ t: Date.now(), ...olay })}\n`);
yaz({
  tur: 'basla',
  aralikSn: ARALIK_SN,
  duraklar: duraklar.map((d) => ({ id: d.stop_id, kod: d.stop_code, ad: d.stop_name, yon: yonYaz(d.stop_desc) })),
});

// ---------------------------------------------------------------- iki kaynak

const OTP_SORGU = `query Durak($id: String!) {
  stop(id: $id) {
    kalkislar: stoptimesWithoutPatterns(numberOfDepartures: 40, timeRange: 5400, omitNonPickups: true) {
      scheduledDeparture realtimeDeparture realtime serviceDay
      trip { gtfsId route { shortName } pattern { headsign } }
    }
  }
}`;

async function kopruyuSor() {
  const kimlikler = duraklar.map((d) => `${BESLEME}:${d.stop_id}`).join(',');
  const yanit = await fetch(`${KOPRU}/durak-varislari?durak=${encodeURIComponent(kimlikler)}`, { signal: AbortSignal.timeout(8_000) });
  const govde = await yanit.json();
  const sonuc = {};
  for (const d of duraklar) {
    const hatlar = govde.duraklar?.[`${BESLEME}:${d.stop_id}`] ?? {};
    sonuc[d.stop_id] = Object.fromEntries(
      Object.entries(hatlar).map(([hat, l]) => [
        hat,
        l.map((v) => ({
          kapi: v.kapiNo,
          rota: v.rotaId ?? null,
          varis: v.varis,
          kalan: v.kalanDurak,
          yas: v.yasSn,
          ogr: v.ogrenilen,
          // Konum: duran (bekleyen) otobüsü ve yanlış yere yerleşmeyi sonradan görmek için.
          enlem: v.enlem,
          boylam: v.boylam,
          dur: v.duruyorSn ?? null,
        })),
      ]),
    );
  }
  return { nabiz: govde.nabiz ?? null, bayat: !!govde.bayat, duraklar: sonuc };
}

/** Köprünün tanısı: her aracın sayılıp sayılmadığı ve nedeni (/teshis). Eski köprüde yok: null. */
async function teshisSor(d) {
  try {
    const yanit = await fetch(`${KOPRU}/teshis?durak=${BESLEME}:${d.stop_id}`, { signal: AbortSignal.timeout(8_000) });
    if (!yanit.ok) return null;
    const g = await yanit.json();
    return g.hata ? null : g;
  } catch {
    return null;
  }
}

async function otpyeSor(d) {
  const yanit = await fetch(`${OTP}/otp/gtfs/v1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: OTP_SORGU, variables: { id: `${BESLEME}:${d.stop_id}` } }),
    signal: AbortSignal.timeout(8_000),
  });
  const govde = await yanit.json();
  return (govde.data?.stop?.kalkislar ?? []).map((k) => ({
    hat: (k.trip?.route?.shortName ?? '').toUpperCase(),
    sefer: k.trip?.gtfsId ?? null,
    yon: k.trip?.pattern?.headsign ?? null,
    planli: ((k.serviceDay ?? 0) + (k.scheduledDeparture ?? 0)) * 1000,
    tahmin: ((k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0)) * 1000,
    canli: !!k.realtime,
  }));
}

// ---------------------------------------------------------------- ekrana özet

const dk = (ms) => Math.max(0, Math.round((ms - Date.now()) / 60_000));
function ozetYaz(kopru, otp) {
  const satirlar = [`\n${simdiYaz()} · köprü nabzı ${kopru?.nabiz ? anYaz(Date.parse(kopru.nabiz)) : '—'}${kopru?.bayat ? ' (BAYAT)' : ''}`];
  for (const d of duraklar) {
    satirlar.push(`  ${etiket(d)}`);
    const araclar = kopru?.duraklar?.[d.stop_id] ?? {};
    const seferler = otp?.[d.stop_id] ?? [];
    const hatlar = [...new Set([...Object.keys(araclar), ...seferler.map((k) => k.hat)])].sort((a, b) =>
      a.localeCompare(b, 'tr', { numeric: true }),
    );
    for (const hat of hatlar) {
      const a =
        (araclar[hat] ?? [])
          .slice(0, 3)
          .map((v) => `${dk(v.varis)} dk (${v.kalan} durak${v.dur != null ? `, ${Math.round(v.dur / 60)} dk'dır duruyor` : ''})`)
          .join(', ') || '—';
      const o =
        seferler
          .filter((k) => k.hat === hat && k.tahmin >= Date.now() - 60_000)
          .slice(0, 3)
          .map((k) => `${dk(k.tahmin)} dk${k.canli ? '' : ' tarife'}`)
          .join(', ') || '—';
      satirlar.push(`    ${hat.padEnd(6)} araç: ${a.padEnd(34)} OTP: ${o}`);
    }
  }
  console.log(satirlar.join('\n'));
}

// ---------------------------------------------------------------- döngü

console.log(`İzleniyor: ${duraklar.map(etiket).join(' | ')}`);
console.log(`Kayıt: ${KAYIT}\n${ARALIK_SN} saniyede bir. Durdurmak için Ctrl+C.`);

async function tur() {
  const [kopru, ...otpler] = await Promise.allSettled([kopruyuSor(), ...duraklar.map(otpyeSor)]);
  const teshisler = await Promise.all(duraklar.map(teshisSor));
  const teshis = Object.fromEntries(duraklar.map((d, i) => [d.stop_id, teshisler[i]]).filter(([, t]) => t));
  const k = kopru.status === 'fulfilled' ? kopru.value : null;
  const o = {};
  duraklar.forEach((d, i) => {
    if (otpler[i].status === 'fulfilled') o[d.stop_id] = otpler[i].value;
  });
  yaz({
    tur: 'ornek',
    kopru: k,
    otp: o,
    teshis,
    hata: [
      kopru.status === 'rejected' ? `köprü: ${kopru.reason?.message ?? kopru.reason}` : null,
      ...otpler.map((x, i) => (x.status === 'rejected' ? `OTP ${duraklar[i].stop_code}: ${x.reason?.message ?? x.reason}` : null)),
    ].filter(Boolean),
  });
  if (kopru.status === 'rejected') console.log(`${simdiYaz()} köprüye ulaşılamadı (${KOPRU}). Köprü açık mı?`);
  if (otpler.some((x) => x.status === 'rejected')) console.log(`${simdiYaz()} OTP'ye ulaşılamadı (${OTP}). OTP açık mı?`);
  ozetYaz(k, o);
  // Sayılmayan araçlar ve nedeni: "Otobüsüm Nerede?"de görünüp bizde olmayanı açıklar.
  for (const d of duraklar) {
    const t = teshis[d.stop_id];
    if (!Array.isArray(t?.araclar)) continue;
    const disarida = t.araclar.filter((a) => a.neden);
    if (disarida.length) {
      console.log(`    sayılmayan: ${disarida.map((a) => `${a.hat} ${a.kapiNo} (${a.neden})`).join(' · ')}`);
    }
    const baska = t.yakindakiBaskaHat.filter((a) => a.metre <= 600).slice(0, 6);
    if (baska.length) {
      console.log(
        `    yakında, hattı başka: ${baska.map((a) => `${a.kapiNo} ${a.bilinenHat ?? 'hat bilinmiyor'} ${a.metre} m`).join(' · ')}`,
      );
    }
  }
}

await tur();
const zamanlayici = setInterval(() => tur().catch((e) => console.error(e)), ARALIK_SN * 1000);
process.on('SIGINT', () => {
  clearInterval(zamanlayici);
  yaz({ tur: 'bitir' });
  console.log(`\nBitti. Rapor: node durak-izle-rapor.mjs "${KAYIT}"`);
  process.exit(0);
});
