// İETT'nin canlı veri servislerini yoklar: ayakta mı, ne döndürüyor, verisi ne kadar taze.
//
// Amaç: GTFS-RT köprüsü yazmaya değer mi, ona karar vermek. Bu betik hiçbir şeyi
// değiştirmez, sadece okur ve özetler.
//
// Kullanım:
//   node veri/iett-canli.mjs
//   node veri/iett-canli.mjs 34          (belirli bir hattı da dener)

const SERVISLER = {
  filo: 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx',
  hatDurak: 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx',
};

const HAT = process.argv[2] ?? '34';
const ZAMAN_ASIMI = 30_000;

function kes(metin, n = 400) {
  const d = String(metin ?? '');
  return d.length > n ? `${d.slice(0, n)}…` : d;
}

async function getir(url, secenekler = {}) {
  const iptal = AbortSignal.timeout(ZAMAN_ASIMI);
  const yanit = await fetch(url, { ...secenekler, signal: iptal });
  return { durum: yanit.status, metin: await yanit.text() };
}

/** ASMX servisinin sunduğu işlem adlarını WSDL'den çıkarır. */
async function islemler(url) {
  try {
    const { durum, metin } = await getir(`${url}?wsdl`);
    if (durum !== 200) return { durum, liste: [] };
    const adlar = [...metin.matchAll(/<(?:wsdl:)?operation name="([^"]+)"/g)].map((e) => e[1]);
    return { durum, liste: [...new Set(adlar)] };
  } catch (e) {
    return { durum: `hata: ${e.message}`, liste: [] };
  }
}

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

/** SOAP 1.1 çağrısı. *_json metotları sonucu XML'in içine gömülü bir JSON metni olarak döndürür. */
async function cagir(url, metot, parametreler = {}) {
  const alanlar = Object.entries(parametreler)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  const zarf = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${metot} xmlns="http://tempuri.org/">${alanlar}</${metot}></soap:Body>
</soap:Envelope>`;

  const baslangic = Date.now();
  const { durum, metin } = await getir(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://tempuri.org/${metot}` },
    body: zarf,
  });
  const sure = Date.now() - baslangic;

  if (durum !== 200) return { durum, sure, hata: kes(metin) };

  const sonuc = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
  if (!sonuc) {
    const arıza = metin.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    return { durum, sure, hata: arıza ? arıza[1] : kes(metin) };
  }

  const ham = sonuc[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]);
  try {
    return { durum, sure, veri: JSON.parse(ham) };
  } catch {
    return { durum, sure, metin: kes(ham, 600) };
  }
}

function ozet(baslik, sonuc, ornekAlanlari) {
  console.log(`\n── ${baslik}`);
  if (sonuc.hata) {
    console.log(`   HATA (${sonuc.durum}, ${sonuc.sure} ms): ${kes(sonuc.hata, 200)}`);
    return null;
  }
  if (sonuc.metin) {
    console.log(`   JSON değil (${sonuc.durum}, ${sonuc.sure} ms): ${sonuc.metin}`);
    return null;
  }
  const liste = Array.isArray(sonuc.veri) ? sonuc.veri : [sonuc.veri];
  console.log(`   ${sonuc.durum} · ${sonuc.sure} ms · ${liste.length} kayıt`);
  if (!liste.length) return liste;
  console.log(`   alanlar: ${Object.keys(liste[0]).join(', ')}`);
  const ornek = ornekAlanlari
    ? Object.fromEntries(ornekAlanlari.filter((a) => a in liste[0]).map((a) => [a, liste[0][a]]))
    : liste[0];
  console.log(`   örnek: ${kes(JSON.stringify(ornek), 300)}`);
  return liste;
}

/** Konum kayıtlarındaki zaman damgasından verinin kaç saniye geride olduğunu çıkarır. */
function tazelik(liste) {
  const alan = Object.keys(liste[0] ?? {}).find((a) => /saat|tarih|zaman|time|date/i.test(a));
  if (!alan) return;
  const damgalar = liste
    .map((k) => Date.parse(String(k[alan]).replace(' ', 'T')))
    .filter((d) => Number.isFinite(d));
  if (!damgalar.length) {
    console.log(`   tazelik: '${alan}' alanı çözülemedi (örnek: ${liste[0][alan]})`);
    return;
  }
  const enYeni = Math.max(...damgalar);
  const gecikme = Math.round((Date.now() - enYeni) / 1000);
  console.log(`   tazelik: '${alan}' · en yeni kayıt ${gecikme} sn önce`);
}

async function main() {
  console.log(`İETT canlı veri yoklaması · ${new Date().toLocaleString('tr-TR')}`);

  for (const [ad, url] of Object.entries(SERVISLER)) {
    const { durum, liste } = await islemler(url);
    console.log(`\n══ ${ad} (${url})`);
    console.log(`   WSDL: ${durum} · ${liste.length} işlem`);
    if (liste.length) console.log(`   ${liste.join(', ')}`);
  }

  const filo = ozet(
    'GetFiloAracKonum_json — bütün filonun anlık konumu',
    await cagir(SERVISLER.filo, 'GetFiloAracKonum_json'),
  );
  if (filo?.length) tazelik(filo);

  const hat = ozet(
    `GetHatOtoKonum_json — ${HAT} hattındaki araçlar`,
    await cagir(SERVISLER.filo, 'GetHatOtoKonum_json', { HatKodu: HAT }),
  );
  if (hat?.length) tazelik(hat);

  ozet(
    'GetDurak_json — durak listesi (statik)',
    await cagir(SERVISLER.hatDurak, 'GetDurak_json', { DurakKodu: '' }),
  );

  console.log('\nBitti. Çıktının tamamını Claude\'a yapıştır.');
}

main().catch((e) => {
  console.error('\nBeklenmeyen hata:', e.message);
  process.exitCode = 1;
});
