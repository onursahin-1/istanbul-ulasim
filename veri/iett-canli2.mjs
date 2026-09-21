// İETT canlı veri — ikinci yoklama.
//
// Birinci yoklama servislerin ayakta olduğunu gösterdi. Şimdi köprünün yazılabilir
// olup olmadığını belirleyen üç soruyu soruyoruz:
//
//   1. GetHatOtoKonum_json boş hat koduyla bütün filoyu döndürüyor mu?
//      Döndürüyorsa tek çağrıyla bütün şehri okuruz. Döndürmüyorsa hat hat sormak
//      gerekir ve bu, kaç hat olduğuna göre taşınabilir ya da taşınamaz olur.
//   2. Yoğun hatlarda gerçekten araç görünüyor mu? (34'te tek araç çıkması şüpheli.)
//   3. GetHat_json kaç hat döndürüyor, hat kodları GTFS'teki kodlarla eşleşiyor mu?
//
// Kullanım: node veri/iett-canli2.mjs

const FILO = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';
const HAT_DURAK = 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx';

// Farklı türde yoğun hatlar: metrobüs, ana arterler, iki yaka.
const DENENECEK = ['34', '34G', '34AS', '500T', '15F', '99A', '14M', 'E-5', '146T', 'MK12'];

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

async function cagir(url, metot, parametreler = {}) {
  const alanlar = Object.entries(parametreler)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join('');
  const zarf = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${metot} xmlns="http://tempuri.org/">${alanlar}</${metot}></soap:Body>
</soap:Envelope>`;

  const t0 = Date.now();
  let yanit;
  try {
    yanit = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://tempuri.org/${metot}` },
      body: zarf,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return { sure: Date.now() - t0, hata: e.message };
  }
  const metin = await yanit.text();
  const sure = Date.now() - t0;
  if (yanit.status !== 200) return { sure, hata: `HTTP ${yanit.status}` };

  const sonuc = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
  if (!sonuc) {
    const ariza = metin.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    return { sure, hata: ariza ? ariza[1].slice(0, 200) : 'sonuç alanı yok' };
  }
  const ham = sonuc[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]);
  try {
    return { sure, veri: JSON.parse(ham) };
  } catch {
    return { sure, hata: `JSON değil: ${ham.slice(0, 160)}` };
  }
}

const say = (v) => (Array.isArray(v) ? v.length : v == null ? 0 : 1);

async function main() {
  console.log(`İETT yoklama 2 · ${new Date().toLocaleString('tr-TR')}\n`);

  // 1 ── Boş hat kodu bütün filoyu verir mi?
  console.log('1) GetHatOtoKonum_json, boş hat kodu:');
  for (const deger of ['', '%', '*']) {
    const s = await cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: deger });
    const etiket = deger === '' ? '(boş)' : deger;
    if (s.hata) {
      console.log(`   ${etiket.padEnd(6)} HATA · ${s.sure} ms · ${s.hata}`);
      continue;
    }
    const n = say(s.veri);
    const hatlar = Array.isArray(s.veri) ? new Set(s.veri.map((a) => a.hatkodu)).size : 0;
    console.log(`   ${etiket.padEnd(6)} ${n} araç · ${hatlar} farklı hat · ${s.sure} ms`);
  }

  // 2 ── Yoğun hatlarda araç var mı?
  console.log('\n2) Hat hat araç sayısı:');
  for (const hat of DENENECEK) {
    const s = await cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: hat });
    if (s.hata) {
      console.log(`   ${hat.padEnd(6)} HATA · ${s.hata}`);
      continue;
    }
    const liste = Array.isArray(s.veri) ? s.veri : s.veri ? [s.veri] : [];
    const yonler = new Set(liste.map((a) => a.guzergahkodu));
    const gecikme = liste.length
      ? Math.round(
          (Date.now() - Math.max(...liste.map((a) => Date.parse(String(a.son_konum_zamani).replace(' ', 'T'))))) / 1000,
        )
      : null;
    console.log(
      `   ${hat.padEnd(6)} ${String(liste.length).padStart(3)} araç · ${yonler.size} güzergâh · ` +
        `${s.sure} ms${gecikme != null ? ` · en yeni ${gecikme} sn önce` : ''}`,
    );
  }

  // 3 ── Hat listesi
  console.log('\n3) GetHat_json — hat listesi:');
  const hatlar = await cagir(HAT_DURAK, 'GetHat_json', { HatKodu: '' });
  if (hatlar.hata) {
    console.log(`   HATA · ${hatlar.hata}`);
  } else {
    const liste = Array.isArray(hatlar.veri) ? hatlar.veri : [];
    console.log(`   ${liste.length} hat · ${hatlar.sure} ms`);
    if (liste.length) {
      console.log(`   alanlar: ${Object.keys(liste[0]).join(', ')}`);
      console.log(`   örnek: ${JSON.stringify(liste[0])}`);
      console.log(`   örnek kodlar: ${liste.slice(0, 12).map((h) => h.SHATKODU ?? h.HatKodu ?? '?').join(', ')}`);
    }
  }

  // 4 ── Aynı hattı iki kez sorup araçların kıpırdayıp kıpırdamadığına bak
  console.log('\n4) Hareket kontrolü (500T, 20 sn arayla):');
  const ilk = await cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: '500T' });
  if (ilk.veri) {
    const a = new Map((Array.isArray(ilk.veri) ? ilk.veri : []).map((x) => [x.kapino, `${x.enlem},${x.boylam}`]));
    await new Promise((r) => setTimeout(r, 20_000));
    const son = await cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: '500T' });
    const b = new Map((Array.isArray(son.veri) ? son.veri : []).map((x) => [x.kapino, `${x.enlem},${x.boylam}`]));
    let kipirdayan = 0;
    for (const [kapi, konum] of b) if (a.has(kapi) && a.get(kapi) !== konum) kipirdayan += 1;
    console.log(`   ${a.size} → ${b.size} araç · ${kipirdayan} tanesi yer değiştirdi`);
  } else {
    console.log(`   HATA · ${ilk.hata}`);
  }

  console.log('\nBitti. Çıktının tamamını yapıştır.');
}

main().catch((e) => {
  console.error('Beklenmeyen hata:', e.message);
  process.exitCode = 1;
});
