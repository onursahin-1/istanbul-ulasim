// Şehir Hatları'nın güncel vapur tarifelerini indirir.
//
// Beslemedeki vapur saatleri İBB'nin 2023'ten beri güncellenmeyen GTFS'inden geliyor ve
// güncel döneme kaydırılmış hâlde; hatların bir kısmı değişmiş, bir kısmı kalkmış, yenileri
// (Moda, Maltepe, Tuzla–Pendik–Büyükada, Sedef Adası…) hiç yok. Şehir Hatları'nın sitesi
// her hattın sefer tarifesini tablo olarak veriyor: gidiş ve dönüş, gün türüne göre ayrı
// bölümler, iskele sütunları (Kalkış/Varış), yıldızlı dipnotlar.
//
// Bu betik tabloları hücre hücre, yorumlamadan indirir; anlamlandırma (gün türleri,
// dipnotlar, iskele eşleme) vapur-tarife-uygula.py'de. Site bulut ortamından erişilemiyor,
// bu yüzden senin bilgisayarında çalışmalı. ~35 istek, bir dakika sürmez.
//
// Kullanım (Node 18+):
//   node veri\vapur-tarife-indir.mjs C:\otp\vapur-tarife.json

import { writeFileSync } from 'node:fs';

const TABAN = 'https://sehirhatlari.istanbul';
const LISTE = '/tr/seferler/ic-hatlar';
const CIKTI = process.argv[2] ?? 'vapur-tarife.json';
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- HTML ayrıştırma (bağımlılıksız; tarayıcıda da aynen çalışır) ----------

// Site Türkçe harfleri çoğunlukla adlı varlıkla yazıyor (Kad&#305;k&ouml;y, &Uuml;sk&uuml;dar).
const VARLIKLAR = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü',
  acirc: 'â', Acirc: 'Â', icirc: 'î', Icirc: 'Î', ucirc: 'û', Ucirc: 'Û',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…',
};

export function metin(html) {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (tum, ad) => {
      if (ad[0] === '#') return String.fromCodePoint(ad[1] === 'x' || ad[1] === 'X' ? parseInt(ad.slice(2), 16) : parseInt(ad.slice(1), 10));
      return VARLIKLAR[ad] ?? VARLIKLAR[ad.toLowerCase()] ?? tum;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Liste sayfasındaki hat bağlantıları: /tr/seferler/ic-hatlar/<grup>/<hat-id>. */
export function hatBaglantilari(html) {
  const bulunan = new Set();
  for (const m of html.matchAll(/href="(\/tr\/seferler\/ic-hatlar\/[^"/]+\/[^"/]+)"/g)) bulunan.add(m[1]);
  return [...bulunan];
}

/** Hat sayfası → { ad, tablolar: [{ yon: 'gidis'|'donus', satirlar: [[hücre…]…] }] }. */
export function sayfayiAyristir(html) {
  const baslik = metin((html.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '');
  // Bazı sayfaların <title>'ı boş; o zaman sayfadaki ilk başlık.
  const h1 = metin((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? [])[1] ?? '');
  const ad = baslik.split('|')[0].replace(/\s+Seferi\s*$/i, '').trim() || h1;
  const tablolar = [];
  const tabloRe = /<table[\s\S]*?<\/table>/gi;
  for (const m of html.matchAll(tabloRe)) {
    const once = html.slice(0, m.index);
    const gidis = once.lastIndexOf('table-going');
    const donus = once.lastIndexOf('table-return');
    const yon = donus > gidis ? 'donus' : 'gidis';
    const satirlar = [];
    for (const tr of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const hucreler = [...tr[1].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map((h) => {
        const yayilim = Number((h[1].match(/colspan\s*=\s*["']?(\d+)/i) ?? [])[1] ?? 1);
        const icerik = metin(h[2]);
        return yayilim > 1 ? { m: icerik, y: yayilim } : icerik;
      });
      if (hucreler.length) satirlar.push(hucreler);
    }
    if (satirlar.length) tablolar.push({ yon, satirlar });
  }
  return { ad, tablolar };
}

// ---------- indirme ----------

async function getir(yol) {
  for (let deneme = 1; ; deneme++) {
    try {
      const yanit = await fetch(TABAN + yol, {
        headers: { 'User-Agent': 'Mozilla/5.0 (istanbul-ulasim tarife indirici)', 'Accept-Language': 'tr' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
      return await yanit.text();
    } catch (e) {
      if (deneme >= 4) throw new Error(`${yol}: ${e.message}`);
      await bekle(2000 * deneme);
    }
  }
}

async function main() {
  const baglantilar = hatBaglantilari(await getir(LISTE));
  if (!baglantilar.length) throw new Error('Hat listesi boş geldi; sitenin yapısı değişmiş olabilir.');
  const hatlar = [];
  for (const yol of baglantilar) {
    await bekle(300);
    const [, , , , grup, kimlik] = yol.split('/');
    try {
      const { ad, tablolar } = sayfayiAyristir(await getir(yol));
      const seferSayisi = tablolar.reduce((t, b) => t + b.satirlar.length, 0);
      console.log(`  ${ad.padEnd(52)} ${tablolar.length} tablo, ${seferSayisi} satır`);
      hatlar.push({ kimlik, grup, ad, adres: TABAN + yol, tablolar });
    } catch (e) {
      console.error(`  ${yol}: ${e.message}`);
    }
  }
  writeFileSync(CIKTI, JSON.stringify({ indirildi: new Date().toISOString(), kaynak: TABAN + LISTE, hatlar }, null, 1));
  console.log(`\n${hatlar.length} hat → ${CIKTI}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
