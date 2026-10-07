// Uzun bekleyen istek: uygulama son aldığı nabzı (`sonra`) gönderir; köprüde ondan yeni nabız
// yoksa cevap bir sonraki nabza kadar tutulur. Uygulama 30 sn'de bir sormak yerine cevabı
// alır almaz yeniden soruyor; yeni konum nabızdan hemen sonra telefonda. iOS isteği 60 sn
// sessizlikten sonra kesebildiği için en çok UZUN_BEKLEME_MS tutulur; nabız gecikirse aynı
// veri döner, uygulama yeniden sorar.

export const UZUN_BEKLEME_MS = 50_000;

export class NabizBeklemesi {
  constructor(sureMs = UZUN_BEKLEME_MS) {
    this.sureMs = sureMs;
    this.sonNabiz = 0;
    this.bekleyenler = new Set();
  }

  /**
   * `sonra` (ISO) son nabızdan yeni değilse `is` sonraki nabza ya da süre dolana kadar
   * ertelenir; değilse hemen çalışır. Dönen işlev bekleyişi iptal eder (istek kapandı).
   */
  bekle(sonra, is) {
    const an = Date.parse(sonra ?? '');
    if (!Number.isFinite(an) || this.sonNabiz > an) {
      is();
      return () => {};
    }
    const kayit = { is, zamanlayici: setTimeout(() => this.bitir(kayit), this.sureMs) };
    this.bekleyenler.add(kayit);
    return () => {
      clearTimeout(kayit.zamanlayici);
      this.bekleyenler.delete(kayit);
    };
  }

  /** Yeni nabız: bekleyen bütün istekler cevaplanır. */
  nabiz(an) {
    this.sonNabiz = an;
    for (const kayit of [...this.bekleyenler]) this.bitir(kayit);
  }

  bitir(kayit) {
    if (!this.bekleyenler.delete(kayit)) return;
    clearTimeout(kayit.zamanlayici);
    try {
      kayit.is();
    } catch (e) {
      console.error(`bekleyen istek cevaplanamadı: ${e.message}`);
    }
  }
}
