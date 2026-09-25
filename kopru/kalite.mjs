// Canlı verinin doğruluğunu ölçer: köprünün tahmin ettiği varış ile aracın o durağa
// gerçekten vardığı an arasındaki fark.
//
// Nasıl: her nabızda araç için ileriki birkaç durağa (1, 4 ve 10 durak sonrası) bir
// varış tahmini not ediliyor — OTP'nin yaptığı gibi "gecikme sabit kalır" varsayımıyla.
// Araç sonraki nabızlarda o durağı geçince, geçiş anı iki gözlem arasında konuma göre
// ara değerleniyor ve tahminle karşılaştırılıyor.
//
//   hata = gerçek varış − tahmin      (+ : otobüs tahminden geç geldi,
//                                       − : tahminden erken geldi)
//
// Aynı tahmin eski yöntemle de (en yakın durağın saatine göre gecikme) hesaplanıyor;
// iki yöntem yan yana görünsün diye. Sonuç /durum'daki `kalite` alanında ve günlük
// dosyada (kayit/kalite-YYYY-MM-DD.json). Özet için: node kalite-rapor.mjs
//
// Bellekte yalnız özet (histogram) tutuluyor; araç başına en çok birkaç bekleyen tahmin.

import { seferDuraklari } from './tarife.mjs';

/** Tahmin ufukları: sıradaki duraktan kaç durak sonrası. */
export const UFUKLAR = [0, 3, 9];
/** Bu kadar dakikada sonuçlanmayan tahmin atılır (araç kayboldu, sefer değişti). */
const TAHMIN_OMRU_SN = 60 * 60;
/** Histogram: 30 sn'lik kutular, ±20 dk. */
const KUTU_SN = 30;
const KUTU_SAYISI = (2 * 20 * 60) / KUTU_SN + 1;
/** İki gözlem bundan uzaksa geçiş anı ara değerlenmez (araç veri vermemiş). */
const EN_UZUN_ARALIK_SN = 10 * 60;

function bosOzet() {
  return { n: 0, toplam: 0, mutlak: 0, ikiDkUstu: 0, kutular: new Array(KUTU_SAYISI).fill(0) };
}

function ozeteEkle(o, hata) {
  o.n++;
  o.toplam += hata;
  o.mutlak += Math.abs(hata);
  if (Math.abs(hata) > 120) o.ikiDkUstu++;
  const k = Math.round(hata / KUTU_SN) + (KUTU_SAYISI >> 1);
  o.kutular[Math.min(KUTU_SAYISI - 1, Math.max(0, k))]++;
}

/** Histogramdan yüzdelik (saniye). */
export function yuzdelik(o, oran) {
  if (!o.n) return null;
  let say = 0;
  for (let i = 0; i < o.kutular.length; i++) {
    say += o.kutular[i];
    if (say >= o.n * oran) return (i - (KUTU_SAYISI >> 1)) * KUTU_SN;
  }
  return null;
}

/** Bir özetin okunur hâli. */
export function ozetYaz(o) {
  if (!o.n) return { n: 0 };
  return {
    n: o.n,
    ortalamaSn: Math.round(o.toplam / o.n),
    ortancaSn: yuzdelik(o, 0.5),
    ortalamaMutlakSn: Math.round(o.mutlak / o.n),
    ikiDkUstuYuzde: Math.round((1000 * o.ikiDkUstu) / o.n) / 10,
    y10Sn: yuzdelik(o, 0.1),
    y90Sn: yuzdelik(o, 0.9),
  };
}

export class KaliteOlcer {
  constructor(tarife) {
    this.tarife = tarife;
    /** kapiNo → { sefer, an, konum, bekleyen: [{ufuk, sira, tahmin, tahminEski, an}] } */
    this.araclar = new Map();
    this.sifirla();
  }

  sifirla(gun = null) {
    this.gun = gun;
    this.baslangic = new Date().toISOString();
    this.yeni = Object.fromEntries(UFUKLAR.map((u) => [u, bosOzet()]));
    this.eski = Object.fromEntries(UFUKLAR.map((u) => [u, bosOzet()]));
    this.gecikme = { yeni: bosOzet(), eski: bosOzet() };
    this.sayac = { gozlem: 0, seferDegisti: 0, geriGitti: 0, zamanAsimi: 0 };
  }

  /** Seferin sıradaki durağından `adim` durak sonrası: {durak, sira, saniye}. */
  ilerikiDurak(e, adim) {
    const liste = seferDuraklari(this.tarife, e.seferIdx);
    const i = liste.findIndex((d) => d.sira >= e.sira);
    return i >= 0 ? (liste[i + adim] ?? null) : null;
  }

  /** Bir nabzın eşleşmelerini işler. */
  gozlem(eslesenler, simdi = new Date()) {
    const gun = simdi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    if (this.gun !== gun) {
      if (this.gun) this.onGunBitti?.(this.rapor());
      this.sifirla(gun);
    }
    const gorulen = new Set();
    for (const e of eslesenler) {
      if (!Number.isFinite(e.konum) || e.seferIdx == null) continue;
      this.sayac.gozlem++;
      ozeteEkle(this.gecikme.yeni, e.gecikme);
      ozeteEkle(this.gecikme.eski, e.eskiGecikme);
      gorulen.add(e.kapiNo);
      const an = e.damga;
      let k = this.araclar.get(e.kapiNo);
      if (k && k.sefer !== e.seferIdx) {
        this.sayac.seferDegisti++;
        k = null;
      }
      if (k && e.konum < k.konum - 1) {
        this.sayac.geriGitti++;
        k = null;
      }
      if (!k) k = { sefer: e.seferIdx, an, konum: e.konum, bekleyen: [] };

      // Geçilen durakların tahminlerini sonuçlandır.
      if (an > k.an && an - k.an <= EN_UZUN_ARALIK_SN && e.konum > k.konum) {
        k.bekleyen = k.bekleyen.filter((b) => {
          if (e.konum < b.sira) return true;
          const oran = (b.sira - k.konum) / (e.konum - k.konum);
          if (oran < 0) return false; // tahmin yapıldığında durak zaten geçilmişti
          const gercek = k.an + oran * (an - k.an);
          ozeteEkle(this.yeni[b.ufuk], gercek - b.tahmin);
          ozeteEkle(this.eski[b.ufuk], gercek - b.tahminEski);
          return false;
        });
      }
      k.bekleyen = k.bekleyen.filter((b) => {
        if (an - b.an <= TAHMIN_OMRU_SN) return true;
        this.sayac.zamanAsimi++;
        return false;
      });

      // Yeni tahminler: her ufukta aynı anda tek bekleyen.
      for (const ufuk of UFUKLAR) {
        if (k.bekleyen.some((b) => b.ufuk === ufuk)) continue;
        const hedef = this.ilerikiDurak(e, ufuk);
        if (!hedef) continue;
        // Gecikme sabit: hedefe planlanan süre kadar sonra varır.
        const sure = hedef.saniye - e.planlanan;
        const sureEski = hedef.saniye - e.yakinPlan;
        k.bekleyen.push({ ufuk, sira: hedef.sira, tahmin: an + sure, tahminEski: an + sureEski, an });
      }
      k.an = an;
      k.konum = e.konum;
      this.araclar.set(e.kapiNo, k);
    }
    // Uzun süre görünmeyen araçları unut.
    const sinir = simdi.getTime() / 1000 - TAHMIN_OMRU_SN;
    for (const [kapi, k] of this.araclar) if (!gorulen.has(kapi) && k.an < sinir) this.araclar.delete(kapi);
  }

  rapor() {
    const ufuklar = {};
    for (const u of UFUKLAR) ufuklar[`${u + 1}. durak`] = { yeni: ozetYaz(this.yeni[u]), eski: ozetYaz(this.eski[u]) };
    return {
      gun: this.gun,
      baslangic: this.baslangic,
      sayac: this.sayac,
      // hata = gerçek varış − tahmin. + : tahminden geç geldi, − : erken geldi.
      varisHatasi: ufuklar,
      gecikmeDagilimi: { yeni: ozetYaz(this.gecikme.yeni), eski: ozetYaz(this.gecikme.eski) },
    };
  }

  /** Histogramlar dahil ham durum (günlük dosyaya). */
  disaAktar() {
    return { ...this.rapor(), ham: { yeni: this.yeni, eski: this.eski, gecikme: this.gecikme } };
  }
}
