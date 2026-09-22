// İBB'ye giden isteklerin saatlik bütçesi.
//
// İBB'nin belgesi: "Bu servise bir saat içerisinde en fazla 100 kere istek
// gönderilebilmektedir." (İETT Web Servis Kullanım Dokümanı). Köprünün ilk iki
// tasarımı bunu bilmeden yazıldı ve ikisi de kapıyı kapattırdı: ilki 45 saniyede
// 784 istek, ikincisi dakikada ~20 istekle ~12 dakikada 100'ü doldurdu.
//
// Burada bütçe "dakikada şu kadar" değil, "son 60 dakikada en fazla N" olarak
// tutuluyor; tasarım gereği aşılamıyor. Varsayılan 80: 100'ün altında pay bırakıyor,
// çünkü İBB'nin saydığı istekleri biz göremiyoruz (hız sınaması, yeniden başlatma).
//
// Ayrıca iki istek arasında en az birkaç saniye: aynı servisleri kullanan başka bir
// proje, ağ geçidinin arka arkaya ~15 hızlı istekte her servisi kestiğini yazmış.
//
// Saf: saat dışarıdan veriliyor, testlerden çağrılabiliyor.

export const SAAT_MS = 3_600_000;

export class SaatlikButce {
  /**
   * @param {object} p
   * @param {number} p.saatte son 60 dakikada en fazla istek
   * @param {number} p.enAzAralikMs iki istek arasında en az bekleme
   * @param {number[]} p.gecmis önceki çalışmadan kalan istek anları (ms)
   */
  constructor({ saatte = 80, enAzAralikMs = 7_000, gecmis = [] } = {}) {
    this.saatte = saatte;
    this.enAzAralikMs = enAzAralikMs;
    this.anlar = [...gecmis].filter(Number.isFinite).sort((a, b) => a - b);
  }

  #temizle(simdi) {
    const sinir = simdi - SAAT_MS;
    while (this.anlar.length && this.anlar[0] <= sinir) this.anlar.shift();
  }

  /** Son 60 dakikada kaç istek gitti. */
  kullanilan(simdi = Date.now()) {
    this.#temizle(simdi);
    return this.anlar.length;
  }

  /** Bir istek göndermeden önce kaç ms beklemek gerekiyor (0 = hemen). */
  bekleme(simdi = Date.now()) {
    this.#temizle(simdi);
    let ms = 0;
    if (this.anlar.length >= this.saatte) {
      // En eski istek pencereden çıkınca yer açılır.
      ms = this.anlar[this.anlar.length - this.saatte] + SAAT_MS - simdi + 1;
    }
    const son = this.anlar.at(-1);
    if (son !== undefined) ms = Math.max(ms, son + this.enAzAralikMs - simdi);
    return Math.max(0, ms);
  }

  /** İstek gönderildi. */
  kaydet(simdi = Date.now()) {
    this.anlar.push(simdi);
  }

  /** Diske yazmak için: son 60 dakikanın istek anları. */
  disaAktar(simdi = Date.now()) {
    this.#temizle(simdi);
    return [...this.anlar];
  }
}

/**
 * Bütçeyi nabız ve tarama arasında bölüştürür.
 *
 * Nabız (bütün filonun konumu, tek istek) önce gelir: o olmadan hiçbir şey
 * yayımlanamaz. Kalan bütçe hat taramasına gider. Hat listesi günde bir, pay
 * olarak bırakılıyor.
 *
 * @returns {{nabizSaatte:number, taramaSaatte:number, taramaAralikMs:number}}
 */
export function butceyiBol(saatte, nabizAralikMs, pay = 2) {
  const nabizSaatte = Math.ceil(SAAT_MS / nabizAralikMs);
  const taramaSaatte = Math.max(0, saatte - nabizSaatte - pay);
  return {
    nabizSaatte,
    taramaSaatte,
    taramaAralikMs: taramaSaatte ? Math.ceil(SAAT_MS / taramaSaatte) : Infinity,
  };
}
