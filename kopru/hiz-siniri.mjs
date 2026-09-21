// İBB ağ geçidinin hız sınırını ölçer. Nazik davranır: istekler arasında bekler,
// sınır göründüğü anda durur.
//
// İki soru: (1) kapı yeniden açıldı mı, (2) tek çağrıyla bütün filoyu veren
// GetFiloAracKonum_json da sınırlı mı? Köprünün yeni tasarımı ona dayanacak.
//
// Kullanım: node kopru/hiz-siniri.mjs

const FILO = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

async function dene(metot, parametreler = {}) {
  const alanlar = Object.entries(parametreler).map(([k, v]) => `<${k}>${v}</${k}>`).join('');
  const zarf = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${metot} xmlns="http://tempuri.org/">${alanlar}</${metot}></soap:Body>
</soap:Envelope>`;
  const t0 = Date.now();
  try {
    const y = await fetch(FILO, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://tempuri.org/${metot}` },
      body: zarf,
      signal: AbortSignal.timeout(90_000),
    });
    const metin = await y.text();
    const sure = Date.now() - t0;
    if (metin.includes('Rate limit')) return { durum: 'SINIR', sure };
    if (y.status !== 200) return { durum: `HTTP ${y.status}`, sure };
    const m = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
    if (!m) return { durum: 'sonuç yok', sure };
    const v = JSON.parse(m[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]));
    return { durum: 'TAMAM', sure, adet: Array.isArray(v) ? v.length : 1, veri: v };
  } catch (e) {
    return { durum: `çöktü: ${e.message}`.slice(0, 60), sure: Date.now() - t0 };
  }
}

const bekle = (sn) => new Promise((r) => setTimeout(r, sn * 1000));

console.log(`${new Date().toLocaleString('tr-TR')}\n`);

console.log('1) Kapı açıldı mı? Tek hat, 20 saniye arayla, en çok 5 deneme.');
let acik = false;
for (let i = 1; i <= 5; i++) {
  const s = await dene('GetHatOtoKonum_json', { HatKodu: '34G' });
  console.log(`   deneme ${i}: ${s.durum} · ${s.sure} ms${s.adet !== undefined ? ` · ${s.adet} araç` : ''}`);
  if (s.durum === 'TAMAM') { acik = true; break; }
  if (i < 5) await bekle(20);
}

if (!acik) {
  console.log('\nKapı hâlâ kapalı. Bir süre sonra tekrar dene.');
  process.exit(0);
}

console.log('\n2) Bütün filo tek çağrıda (GetFiloAracKonum_json):');
await bekle(5);
const filo = await dene('GetFiloAracKonum_json');
console.log(`   ${filo.durum} · ${filo.sure} ms${filo.adet ? ` · ${filo.adet} araç` : ''}`);
if (filo.veri && Array.isArray(filo.veri) && filo.veri.length) {
  console.log(`   alanlar: ${Object.keys(filo.veri[0]).join(', ')}`);
  console.log(`   örnek: ${JSON.stringify(filo.veri[0])}`);
}

console.log('\n3) Sınır nerede? Saniyede 1 istek, 15 deneme (sınır görülünce durur).');
await bekle(5);
let basarili = 0;
const t0 = Date.now();
for (let i = 1; i <= 15; i++) {
  const s = await dene('GetHatOtoKonum_json', { HatKodu: '34G' });
  if (s.durum !== 'TAMAM') {
    console.log(`   ${i}. istekte sınıra takıldı (${Math.round((Date.now() - t0) / 1000)} sn içinde ${basarili} başarılı)`);
    break;
  }
  basarili++;
  await bekle(1);
}
if (basarili === 15) console.log(`   15/15 başarılı · saniyede 1 istek sorun çıkarmıyor`);

console.log('\nBitti. Çıktının tamamını yapıştır.');
