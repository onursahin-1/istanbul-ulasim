// İETT servislerine giden tek kapı.
//
// İBB'nin kotası saatte 100 istek (İETT Web Servis Kullanım Dokümanı). Bütün
// istekler buradan geçiyor ve saatlik bütçeden (butce.mjs) izin almadan gitmiyor.
// Sınıra yine de takılınırsa (İBB bizim görmediğimiz istekleri de sayıyor olabilir)
// kapı kapanıyor ve bekleme katlanarak artıyor: 15 → 30 → 60 dakika. Kota saatlik
// olduğu için dakikalar içinde yeniden denemek yalnızca cezayı uzatır.
//
// Sunucu hiç yanıt vermezse (HTTP 503, bağlantı yok) ayrı ve daha kısa bir geri
// çekilme: 2 → 4 → 8 → 16 → 30 dakika istek gönderilmiyor. Eskiden nabız ve tarama
// arıza sürdükçe saatte ~75 isteği boşa yolluyor, bütçeyi hep 80/80'de tutuyordu.

import { SaatlikButce } from './butce.mjs';

// IETT_ADRESI yalnız sınama için: sahte bir İBB sunucusuna yönlendirmeye yarıyor.
const TABAN = process.env.IETT_ADRESI ?? 'https://api.ibb.gov.tr';
const FILO = `${TABAN}/iett/FiloDurum/SeferGerceklesme.asmx`;
const HAT_DURAK = `${TABAN}/iett/UlasimAnaVeri/HatDurakGuzergah.asmx`;
const DUYURU = `${TABAN}/iett/UlasimDinamikVeri/Duyurular.asmx`;

const COZ = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };

export class SinirHatasi extends Error {
  constructor() {
    super('İBB ağ geçidi hız sınırı uyguluyor');
    this.name = 'SinirHatasi';
  }
}

/**
 * İBB sunucusu yanıt vermiyor (HTTP 5xx, bağlantı kurulamadı, zaman aşımı). Hız sınırından
 * farklı: kusur bizde değil. Ama yeniden denemek yine bütçeden yiyor ve boşa gidiyor;
 * kapı bir süre istek göndermeden bu hatayı veriyor (bkz. Kapi.#arizaliydi).
 */
export class ArizaHatasi extends Error {
  constructor(neden, kalanMs) {
    super(`İBB yanıt vermiyor (${neden}); ${Math.max(1, Math.round(kalanMs / 60_000))} dk sonra yeniden denenecek`);
    this.name = 'ArizaHatasi';
    this.neden = neden;
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
  constructor({
    butce = new SaatlikButce(),
    ilkCeza = 15 * 60_000,
    enFazlaCeza = 60 * 60_000,
    kapaliyaKadar = 0,
    ilkAriza = 2 * 60_000,
    enFazlaAriza = 30 * 60_000,
  } = {}) {
    this.butce = butce;
    // Sunucu arızası: 2 → 4 → 8 → 16 → 30 dk istek gönderilmez, ilk başarıda sıfırlanır.
    this.ilkAriza = ilkAriza;
    this.enFazlaAriza = enFazlaAriza;
    this.arizaAdimi = ilkAriza;
    this.arizaBitis = 0;
    this.arizaNedeni = '';
    this.ilkCeza = ilkCeza;
    this.enFazlaCeza = enFazlaCeza;
    this.ceza = ilkCeza;
    this.kapaliyaKadar = kapaliyaKadar;
    this.kuyruk = Promise.resolve();
    this.sayac = { istek: 0, sinir: 0, hata: 0, ariza: 0, arizadaAtlanan: 0 };
  }

  /** Kapı şu an kapalıysa kalan süre (ms). */
  kalanCeza() {
    return Math.max(0, this.kapaliyaKadar - Date.now());
  }

  /** Sunucu arızası yüzünden istek gönderilmeyecek kalan süre (ms). */
  kalanAriza() {
    return Math.max(0, this.arizaBitis - Date.now());
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
    // Sunucu yakın zamanda yanıt vermediyse istek hiç gitmesin: bütçe boşa harcanmasın.
    if (this.kalanAriza() > 0) {
      this.sayac.arizadaAtlanan++;
      throw new ArizaHatasi(this.arizaNedeni, this.kalanAriza());
    }
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
      if (yanit.status >= 500) throw this.#arizaliydi(`${metot}: HTTP ${yanit.status}`);
      if (yanit.status !== 200) throw new Error(`${metot}: HTTP ${yanit.status}`);
    } catch (e) {
      if (e instanceof SinirHatasi || e instanceof ArizaHatasi) throw e;
      this.sayac.hata++;
      // Bağlantı kurulamadı ya da zaman aşımı: sunucu tarafı, aynı geri çekilme.
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e instanceof TypeError) {
        throw this.#arizaliydi(`${metot}: ${e.name === 'TypeError' ? 'bağlantı kurulamadı' : 'zaman aşımı'}`);
      }
      throw e;
    }

    const sonuc = metin.match(new RegExp(`<${metot}Result>([\\s\\S]*?)</${metot}Result>`));
    if (!sonuc) {
      this.sayac.hata++;
      const ariza = metin.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
      throw new Error(`${metot}: ${ariza ? ariza[1].slice(0, 120) : 'sonuç alanı yok'}`);
    }
    // Başarılı istek cezayı ve arıza beklemesini başa sarar.
    this.ceza = this.ilkCeza;
    this.arizaAdimi = this.ilkAriza;
    this.arizaNedeni = '';
    return JSON.parse(sonuc[1].replace(/&(lt|gt|amp|quot|apos);/g, (e) => COZ[e]));
  }

  #arizaliydi(neden) {
    this.sayac.ariza++;
    this.arizaNedeni = neden;
    this.arizaBitis = Date.now() + this.arizaAdimi;
    const hata = new ArizaHatasi(neden, this.arizaAdimi);
    this.arizaAdimi = Math.min(this.arizaAdimi * 2, this.enFazlaAriza);
    return hata;
  }

  #sinirdaTakildi() {
    this.sayac.sinir++;
    this.kapaliyaKadar = Date.now() + this.ceza;
    this.ceza = Math.min(this.ceza * 2, this.enFazlaCeza);
  }
}

// ---------- servis çağrıları ----------

/**
 * Bütün hatlar: kod ve ad. Günde bir yenilemek yeterli. Ad duyuruları hatta
 * bağlamak için (duyurular kodla değil adla geliyor).
 */
export async function hatlar(kapi) {
  const liste = await kapi.cagir(HAT_DURAK, 'GetHat_json', { HatKodu: '' });
  const alan = (h, ...adlar) => {
    const k = Object.keys(h ?? {}).find((x) => adlar.includes(x.toUpperCase()));
    return k ? String(h[k] ?? '').trim() : '';
  };
  return (Array.isArray(liste) ? liste : [])
    .map((h) => ({ kod: alan(h, 'SHATKODU', 'HATKODU'), ad: alan(h, 'SHATADI', 'HATADI', 'HAT_ADI') }))
    .filter((h) => h.kod);
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

/** Bütün hatların güncel duyuruları — tek istek. Ham liste; duyuru.mjs düzenliyor. */
export async function duyurular(kapi) {
  return kapi.cagir(DUYURU, 'GetDuyurular_json');
}
