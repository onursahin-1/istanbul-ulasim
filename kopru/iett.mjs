// İETT servislerine giden tek kapı.
//
// İlk tasarım 784 hattı 10 eşzamanlı istekle tarıyordu ve İBB'nin ağ geçidi bizi
// "Rate limit exceeded" ile kapattı. Artık bütün istekler buradan geçiyor:
// jeton kovası hızı sınırlıyor, sınıra takılınca da ceza süresi katlanarak artıyor.
// Israr etmek sınırı uzatır; doğru davranış geri çekilmektir.

const FILO = 'https://api.ibb.gov.tr/iett/FiloDurum/SeferGerceklesme.asmx';
const HAT_DURAK = 'https://api.ibb.gov.tr/iett/UlasimAnaVeri/HatDurakGuzergah.asmx';

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

export class SinirHatasi extends Error {
  constructor() {
    super('İBB ağ geçidi hız sınırı uyguluyor');
    this.name = 'SinirHatasi';
  }
}

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Hız sınırına saygılı istek kapısı. Bütün çağrılar sırayla ve aralıklı gider. */
export class Kapi {
  /**
   * @param {number} dakikadaEnFazla üst sınır tahminimiz; ölçtükçe ayarlanabilir
   * @param {number} ilkCeza sınıra takılınca ilk bekleme (ms)
   * @param {number} enFazlaCeza cezanın tavanı (ms)
   */
  constructor({ dakikadaEnFazla = 20, ilkCeza = 60_000, enFazlaCeza = 15 * 60_000 } = {}) {
    this.aralik = 60_000 / dakikadaEnFazla;
    this.ilkCeza = ilkCeza;
    this.enFazlaCeza = enFazlaCeza;
    this.ceza = ilkCeza;
    this.kapaliyaKadar = 0;
    this.sonIstek = 0;
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
    const ceza = this.kalanCeza();
    if (ceza > 0) await bekle(ceza);
    const gecen = Date.now() - this.sonIstek;
    if (gecen < this.aralik) await bekle(this.aralik - gecen);
    this.sonIstek = Date.now();
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
