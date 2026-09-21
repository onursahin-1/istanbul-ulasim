// İETT'nin SOAP servislerinden canlı araç konumlarını çeker.
//
// Servis hat hat soruyor — boş hat koduyla bütün filoyu vermiyor (denendi, HTTP 500).
// 784 hattı sırayla sormak 2,5 dakika sürer, o yüzden sınırlı sayıda isteği aynı anda
// yürütüyoruz. Ölçüm: 10 eşzamanlı istekle bütün şehir ~20 saniyede taranıyor.

const FILO = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';
const HAT_DURAK = 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx';

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

async function cagir(url, metot, parametreler = {}, zamanAsimi = 45_000) {
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
    signal: AbortSignal.timeout(zamanAsimi),
  });
  if (yanit.status !== 200) throw new Error(`${metot}: HTTP ${yanit.status}`);
  const metin = await yanit.text();
  const sonuc = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
  if (!sonuc) {
    const ariza = metin.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    throw new Error(`${metot}: ${ariza ? ariza[1].slice(0, 120) : 'sonuç alanı yok'}`);
  }
  return JSON.parse(sonuc[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]));
}

/** Bütün hat kodları. Günde bir yenilemek yeterli. */
export async function hatKodlari() {
  const liste = await cagir(HAT_DURAK, 'GetHat_json', { HatKodu: '' }, 60_000);
  return liste.map((h) => String(h.SHATKODU).trim()).filter(Boolean);
}

/** Bir hattaki araçlar. Hat boşsa boş dizi döner. */
export async function hattakiAraclar(hatKodu) {
  const v = await cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: hatKodu });
  return Array.isArray(v) ? v : v ? [v] : [];
}

/**
 * Bütün hatları sınırlı eşzamanlılıkla tarar.
 * @param {string[]} hatlar
 * @param {number} esZamanli aynı anda kaç istek
 * @returns {Promise<{araclar: object[], hata: number, sure: number}>}
 */
export async function butunFilo(hatlar, esZamanli = 10) {
  const t0 = Date.now();
  const araclar = [];
  let hata = 0;
  let sira = 0;

  async function isci() {
    while (sira < hatlar.length) {
      const hat = hatlar[sira++];
      try {
        araclar.push(...(await hattakiAraclar(hat)));
      } catch {
        // Tek bir hattın düşmesi taramayı durdurmasın; sayısını tutuyoruz.
        hata++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(esZamanli, hatlar.length) }, isci));
  return { araclar, hata, sure: Date.now() - t0 };
}
