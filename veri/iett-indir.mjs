// İETT servislerinden bir örnek indirir ve dosyaya yazar.
//
// Amaç: İBB'nin kodlarıyla bizim GTFS'imizdeki kodların ne kadar örtüştüğünü ölçmek.
// İndirme burada yapılır (ağ erişimi olan tek yer senin bilgisayarın), karşılaştırmayı
// Claude yapar. Dosya yalnızca bu araştırma için; sonra silinebilir.
//
// Kullanım: node veri/iett-indir.mjs

import { writeFileSync } from 'node:fs';

const FILO = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';
const HAT_DURAK = 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx';
const CIKTI = 'veri/iett-ornek.json';

// Farklı türde hatlar: metrobüs, uzun arter, kısa mahalle hattı, iki yaka.
const ORNEK_HATLAR = ['34G', '34AS', '500T', '15F', '99A', '14M', '146T', '11C', 'MK12', '3'];

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

async function cagir(url, metot, parametreler = {}) {
  const alanlar = Object.entries(parametreler)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  const zarf = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${metot} xmlns="http://tempuri.org/">${alanlar}</${metot}></soap:Body>
</soap:Envelope>`;

  const yanit = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://tempuri.org/${metot}` },
    body: zarf,
    signal: AbortSignal.timeout(120_000),
  });
  if (!yanit.status || yanit.status !== 200) throw new Error(`${metot}: HTTP ${yanit.status}`);
  const metin = await yanit.text();
  const sonuc = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
  if (!sonuc) throw new Error(`${metot}: sonuç alanı yok`);
  return JSON.parse(sonuc[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]));
}

async function main() {
  const cikti = { alindi: new Date().toISOString() };

  process.stdout.write('hat listesi… ');
  cikti.hatlar = await cagir(HAT_DURAK, 'GetHat_json', { HatKodu: '' });
  console.log(`${cikti.hatlar.length} hat`);

  process.stdout.write('durak listesi… ');
  cikti.duraklar = await cagir(HAT_DURAK, 'GetDurak_json', { DurakKodu: '' });
  console.log(`${cikti.duraklar.length} durak`);

  cikti.araclar = {};
  for (const hat of ORNEK_HATLAR) {
    process.stdout.write(`${hat}… `);
    try {
      const v = await cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: hat });
      cikti.araclar[hat] = Array.isArray(v) ? v : v ? [v] : [];
      console.log(`${cikti.araclar[hat].length} araç`);
    } catch (e) {
      cikti.araclar[hat] = { hata: e.message };
      console.log(`HATA (${e.message})`);
    }
  }

  writeFileSync(CIKTI, JSON.stringify(cikti));
  const mb = (JSON.stringify(cikti).length / 1e6).toFixed(1);
  console.log(`\n${CIKTI} yazıldı (${mb} MB). Claude buradan okuyacak.`);
}

main().catch((e) => {
  console.error('Hata:', e.message);
  process.exitCode = 1;
});
