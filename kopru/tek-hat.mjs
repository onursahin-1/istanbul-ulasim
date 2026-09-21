// Tek bir hattı sorup ham cevabı olduğu gibi gösterir.
// Köprü boş dönerken sorunun nerede olduğunu anlamak için.
//
// Kullanım: node kopru/tek-hat.mjs [hatKodu]

const FILO = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';
const hat = process.argv[2] ?? '34G';

const zarf = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><GetHatOtoKonum_json xmlns="http://tempuri.org/"><HatKodu>${hat}</HatKodu></GetHatOtoKonum_json></soap:Body>
</soap:Envelope>`;

console.log(`${new Date().toLocaleString('tr-TR')} · hat ${hat} soruluyor…`);
const t0 = Date.now();
try {
  const yanit = await fetch(FILO, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'http://tempuri.org/GetHatOtoKonum_json' },
    body: zarf,
    signal: AbortSignal.timeout(45_000),
  });
  const metin = await yanit.text();
  console.log(`HTTP ${yanit.status} · ${Date.now() - t0} ms · ${metin.length} bayt`);
  console.log('--- cevabın ilk 700 karakteri ---');
  console.log(metin.slice(0, 700));
} catch (e) {
  console.log(`ÇÖKTÜ · ${Date.now() - t0} ms`);
  console.log(`${e.name}: ${e.message}`);
  if (e.cause) console.log('sebep:', e.cause.code ?? e.cause.message ?? e.cause);
}
