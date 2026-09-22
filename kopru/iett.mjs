// İETT servislerine giden tek kapı.
//
// İBB'nin kotası saatte 100 istek (İETT Web Servis Kullanım Dokümanı). Bütün
// istekler buradan geçiyor ve saatlik bütçeden (butce.mjs) izin almadan gitmiyor.
// Sınıra yine de takılınırsa (İBB bizim görmediğimiz istekleri de sayıyor olabilir)
// kapı kapanıyor ve bekleme katlanarak artıyor: 15 → 30 → 60 dakika. Kota saatlik
// olduğu için dakikalar içinde yeniden denemek yalnızca cezayı uzatır.

import { SaatlikButce } from './butce.mjs';

// IETT_ADRESI yalnız sınama için: sahte bir İBB sunucusuna yönlendirmeye yarıyor.
const TABAN = process.env.IETT_ADRESI ?? 'https://api.ibb.gov.tr';
const FILO = `${TABAN}/iett/FiloDurum/SeferGerceklesme.asmx`;
const HAT_DURAK = `${TABAN}/iett/UlasimAnaVeri/HatDurakGuzergah.asmx`;

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

export class SinirHatasi extends Error {
  constructor() {
    super('İBB ağ geçidi hız sınırı uyguluyor');
    this.name = 'SinirHatasi';
  }
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Saatlik bütçeye saygılı istek kapısı. Bütün çağrılar sırayla gider. */
export class Kapi {
  /**
   * @param {object} p
   * @param {SaatlikButce} p.butce son 60 dakikanın istek sayacı
   * @param {number} p.ilkCeza sınıra takılınca ilk bekleme (ms)
   * @param {number} p.enFazlaCeza cezanın tavanı (ms)
   * @param {number} p.kapaliyaKadar önceki çalışmadan kalan ceza bitişi (ms)
   */
  constructor({ butce = new SaatlikButce(), ilkCeza = 15 * 60_000, enFazlaCeza = 60 * 60_000, kapaliyaKadar = 0 } = {}) {
    this.butce = butce;
    this.ilkCeza = ilkCeza;
    this.enFazlaCeza = enFazlaCeza;
    this.ceza = ilkCeza;
    this.kapaliyaKadar = kapaliyaKadar;
    this.kuyruk = Promise.resolve();
    this.sayac = { istek: 0, sinir: 0, hata: 0 };
  }

  /** Kapı şu an kapalıysa kalan süre (ms). */
  kalanCeza() {
    return Math.max(0, this.kapaliyaKadar - Date.now());
  }

  /** İstekleri tek sıraya dizer: aynı anda birden fazla istek gitmez. */
  async cagir(url, metot, parametreler = {}, zamanAsimi = 90_000) {
    const sonuc = this.kuyruk.then(() => this.#gonder(url, metot, parametreler, zamanAsimi));
    // Kuyruk zinciri hata yüzünden kopmasın.
    this.kuyruk = sonuc.then(
      () => undefined,
      () => undefined,
    );
    return sonuc;
  }

  async #gonder(url, metot, parametreler, zamanAsimi) {
    // Ceza ve bütçe beklemesi birbirini etkileyebilir; ikisi de sıfırlanana kadar bekle.
    for (;;) {
      const ms = Math.max(this.kalanCeza(), this.butce.bekleme(Date.now()));
      if (ms <= 0) break;
      await bekle(Math.min(ms, 60_000));
    }
    this.butce.kaydet(Date.now());
    this.sayac.istek++;

    const alanlar = Object.entries(parametreler)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('');
    const zarf = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body><${metot} xmlns="http://tempuri.org/">${alanlar}</${metot}></soap:Body>
</soap:Envelope>`;

    let metin;
    try {
      const yanit = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `http://tempuri.org/${metot}` },
        body: zarf,
        signal: AbortSignal.timeout(zamanAsimi),
      });
      metin = await yanit.text();
      if (metin.includes('Rate limit') || metin.includes('Policy Falsified')) {
        this.#sinirdaTakildi();
        throw new SinirHatasi();
      }
      if (yanit.status !== 200) throw new Error(`${metot}: HTTP ${yanit.status}`);
    } catch (e) {
      if (e instanceof SinirHatasi) throw e;
      this.sayac.hata++;
      throw e;
    }

    const sonuc = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
    if (!sonuc) {
      this.sayac.hata++;
      const ariza = metin.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
      throw new Error(`${metot}: ${ariza ? ariza[1].slice(0, 120) : 'sonuç alanı yok'}`);
    }
    // Başarılı istek cezayı başa sarar.
    this.ceza = this.ilkCeza;
    return JSON.parse(sonuc[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]));
  }

  #sinirdaTakildi() {
    this.sayac.sinir++;
    this.kapaliyaKadar = Date.now() + this.ceza;
    this.ceza = Math.min(this.ceza * 2, this.enFazlaCeza);
  }
}

// ---------- servis çağrıları ----------

/** Bütün hat kodları. Günde bir yenilemek yeterli. */
export async function hatKodlari(kapi) {
  const liste = await kapi.cagir(HAT_DURAK, 'GetHat_json', { HatKodu: '' });
  return liste.map((h) => String(h.SHATKODU).trim()).filter(Boolean);
}

/**
 * Bütün filonun anlık konumu — TEK istek, ~6900 araç.
 * Hat bilgisi yok; onu taramadan öğreniyoruz (tarama.mjs).
 */
export async function filoKonumlari(kapi) {
  const liste = await kapi.cagir(FILO, 'GetFiloAracKonum_json');
  return (Array.isArray(liste) ? liste : []).map((a) => ({
    kapiNo: String(a.KapiNo ?? '').trim(),
    enlem: Number(a.Enlem),
    boylam: Number(a.Boylam),
    hiz: Number(a.Hiz),
    saat: String(a.Saat ?? '').trim(),
    isletmeci: a.Operator ?? '',
  }));
}

/** Bir hattaki araçlar: kapı numarasını güzergâha bağlayan tek kaynak. */
export async function hattakiAraclar(kapi, hatKodu) {
  const v = await kapi.cagir(FILO, 'GetHatOtoKonum_json', { HatKodu: hatKodu });
  const liste = Array.isArray(v) ? v : v ? [v] : [];
  return liste.map((a) => ({
    kapiNo: String(a.kapino ?? '').trim(),
    guzergah: String(a.guzergahkodu ?? '').trim().toUpperCase(),
    hat: String(a.hatkodu ?? '').trim(),
    yakinDurak: String(a.yakinDurakKodu ?? '').trim(),
    zaman: String(a.son_konum_zamani ?? '').trim(),
  }));
}
