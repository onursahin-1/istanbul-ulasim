// Araç tabanlı varış tahmini: bir durağa hangi otobüs kaç dakikada gelir.
//
// Köprünün asıl yolu (kopru.mjs) her aracı bir tarife seferine bağlayıp gecikmeyi OTP'ye
// veriyor; OTP de o gecikmeyi seferin kalanına yayıyor. İETT tarifesi gerçeğe uzak olduğu
// için bu zincir kırılgan: araç yanlış sefere bağlanırsa (97GE gerçekte 9 dk uzaktayken
// "17:35'te durakta") ya da hiçbir sefere bağlanamazsa (141M'nin iki otobüsü 5 ve 11 dk
// uzaktayken yalnız tarife) yolcu yanlış saat görüyor.
//
// Burada sefer yok. "Otobüsüm Nerede?" gibi: durağa doğru gelen her otobüsün, hattın
// durak sırasında nerede olduğu bulunur; durağa kalan yol, köprünün öğrendiği durak arası
// sürelerle (segment.mjs; yoksa tarifedeki aralıkla) toplanır. Saat yalnız süre için
// kullanılıyor, seferin kalkış saati için değil.
//
// Aracın yönü (hangi güzergâh varyantı): sefere bağlandıysa onunki; hat taramasının taze
// güzergâh kodu; yoksa iki konumundan (yon.mjs); o da yoksa son bilinen yönü.

import { KonumIzi, yonluAdaylar } from './yon.mjs';

/** Bundan eski konumdaki araç sayılmaz. */
export const EN_ESKI_KONUM_SN = 10 * 60;
/** Durağa en çok bu kadar durak uzaktaki araçlar sayılır. */
export const EN_UZAK_DURAK = 40;
/** Son bilinen yön bu kadar süre geçerli (araç dururken karar verilemiyor). */
export const YON_OMRU_MS = 20 * 60_000;
/** Güzergâh kodu bu kadar tazeyse yön ondan. */
export const TAZE_GUZERGAH_MS = 20 * 60_000;
/** Durağı bu kadar (durak sırası) geçmiş araç "durakta" sayılır; daha çok geçtiyse gitmiş. */
export const DURAKTA_PAYI = 0.15;

const M_DERECE = 111_320;

/** Noktanın a→b doğru parçasına izdüşümü: oran (0–1) ve uzaklık (metre). */
function izdusum(tarife, a, b, enlem, boylam) {
  const olcek = Math.cos((enlem * Math.PI) / 180);
  const ax = (tarife.durakBoylam[a] - boylam) * olcek;
  const ay = tarife.durakEnlem[a] - enlem;
  const dx = (tarife.durakBoylam[b] - boylam) * olcek - ax;
  const dy = tarife.durakEnlem[b] - enlem - ay;
  const uz = dx * dx + dy * dy;
  const t = uz > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / uz)) : 0;
  return { t, metre: Math.hypot(ax + t * dx, ay + t * dy) * M_DERECE };
}

/**
 * Aracın yol (durak listesi) üstündeki kesirli yeri: 3.4 = dördüncü durağı geçmiş, beşinciye
 * %40 gelmiş. Yola `esik` metreden uzaksa null.
 */
export function yoldakiYer(tarife, yol, enlem, boylam, esik) {
  let enIyi = null;
  for (let i = 0; i + 1 < yol.length; i++) {
    const p = izdusum(tarife, yol[i].durak, yol[i + 1].durak, enlem, boylam);
    if (!enIyi || p.metre < enIyi.metre) enIyi = { yer: i + p.t, metre: p.metre };
  }
  return enIyi && enIyi.metre <= esik ? enIyi : null;
}

export class AracVarislari {
  /**
   * @param tarife tarifeyiKur() çıktısı (rotaDuraklari, durakEnlem/Boylam, kisaAdtanRotalar, guzergahtanRota, rotaEsik)
   * @param {(rota:number, durak:number, anSn:number) => {durak:number, saniye:number}[] | null} yolBul
   *   rotanın o duraktan geçen bir seferinin durakları ve tarife saatleri
   * @param {(a:number, b:number, anSn:number) => number | null} ogrenilenSure durak arası öğrenilen süre (sn)
   */
  constructor(tarife, yolBul, ogrenilenSure) {
    this.tarife = tarife;
    this.yolBul = yolBul;
    this.ogrenilenSure = ogrenilenSure;
    this.iz = new KonumIzi();
    /** kapıNo → { rota, an } son bilinen yön */
    this.yon = new Map();
    /** Son nabzın araçları: { kapiNo, hat, rota, enlem, boylam, damga (ms) } */
    this.araclar = [];
    this.an = 0;
    this.yolOnbellegi = new Map();
  }

  /**
   * Her nabızda: ham filo konumları, sefere bağlananlar ve hat taramasının bildiği araçlar.
   * @param araclar [{kapiNo, enlem, boylam, tarih: Date}]
   * @param eslesenler kopru.mjs araclariEslestir çıktısı (kapiNo, rotaIdx)
   * @param {(kapiNo:string) => {hat:string, guzergah?:string, an:number} | null} bilgiAl
   */
  guncelle(araclar, eslesenler, bilgiAl, simdi = new Date()) {
    const an = simdi.getTime();
    const T = this.tarife;
    const bagli = new Map(eslesenler.map((e) => [e.kapiNo, e.rotaIdx]));
    const liste = [];
    for (const a of araclar) {
      if (!a.kapiNo || !Number.isFinite(a.enlem) || !Number.isFinite(a.boylam) || !a.tarih) continue;
      if ((an - a.tarih.getTime()) / 1000 > EN_ESKI_KONUM_SN) continue;
      const bilgi = bilgiAl(a.kapiNo);
      const hat = String(bilgi?.hat ?? '').trim().toUpperCase();
      if (!hat) continue;
      const rotalar = T.kisaAdtanRotalar.get(hat) ?? [];
      let rota = bagli.get(a.kapiNo);
      if (rota == null && bilgi.guzergah && an - (bilgi.an ?? 0) <= TAZE_GUZERGAH_MS) {
        rota = T.guzergahtanRota.get(String(bilgi.guzergah).toUpperCase());
      }
      if (rota == null) {
        const onceki = this.iz.onceki(a.kapiNo, an);
        if (onceki) rota = yonluAdaylar(T, rotalar, onceki, a)[0]?.rota;
      }
      if (rota == null) {
        const y = this.yon.get(a.kapiNo);
        if (y && an - y.an <= YON_OMRU_MS && rotalar.includes(y.rota)) rota = y.rota;
      }
      this.iz.guncelle(a.kapiNo, a.enlem, a.boylam, an);
      if (rota == null) continue;
      this.yon.set(a.kapiNo, { rota, an });
      liste.push({ kapiNo: a.kapiNo, hat, rota, enlem: a.enlem, boylam: a.boylam, damga: a.tarih.getTime() });
    }
    for (const [k, y] of this.yon) if (an - y.an > 2 * YON_OMRU_MS) this.yon.delete(k);
    this.iz.temizle(an);
    this.araclar = liste;
    this.an = an;
  }

  /** Rotanın o duraktan geçen temsilci seferinin yolu (yarım saat önbellekte). */
  yol(rota, durak, anSn) {
    const anahtar = `${rota}|${durak}`;
    const k = this.yolOnbellegi.get(anahtar);
    if (k && Math.abs(anSn - k.anSn) < 1800) return k.yol;
    const yol = this.yolBul(rota, durak, anSn);
    this.yolOnbellegi.set(anahtar, { yol, anSn });
    if (this.yolOnbellegi.size > 5000) this.yolOnbellegi.delete(this.yolOnbellegi.keys().next().value);
    return yol;
  }

  /**
   * Bir durağa gelen araçlar, hat hat, varışa göre sıralı.
   * @param {number} durak durak sırası (tarife.durakAd içinde)
   * @param {Set<string>} [hatlar] yalnız bu hatlar (büyük harf)
   * @returns {Record<string, {kapiNo:string, varis:number, kalanDurak:number, yasSn:number,
   *   enlem:number, boylam:number, ogrenilen:number}[]>}
   */
  durakVarislari(durak, simdiMs = Date.now(), hatlar = null) {
    const T = this.tarife;
    const sonuc = {};
    for (const v of this.araclar) {
      if (hatlar && !hatlar.has(v.hat)) continue;
      const anSn = Math.floor(v.damga / 1000);
      const yol = this.yol(v.rota, durak, anSn);
      if (!yol || yol.length < 2) continue;
      const esik = T.rotaEsik?.get(v.rota) ?? 400;
      const yer = yoldakiYer(T, yol, v.enlem, v.boylam, esik);
      if (!yer) continue;
      // Hedef: aracın önündeki ilk uğrayışı (halka hatlarda durak iki kez geçebilir).
      let hedef = -1;
      for (let i = 0; i < yol.length; i++) {
        if (yol[i].durak === durak && i + DURAKTA_PAYI >= yer.yer) {
          hedef = i;
          break;
        }
      }
      if (hedef < 0) continue;
      const tam = Math.floor(yer.yer);
      const kalanDurak = Math.max(0, hedef - tam - (yer.yer - tam >= 1 - DURAKTA_PAYI ? 1 : 0));
      if (hedef - tam > EN_UZAK_DURAK) continue;
      // Kalan yol: içinde bulunulan aralığın kalanı, sonra tam aralıklar.
      let sure = 0;
      let ogrenilen = 0;
      let aralik = 0;
      for (let j = tam; j < hedef; j++) {
        const p = yol[j];
        const q = yol[j + 1];
        const ogr = this.ogrenilenSure(p.durak, q.durak, anSn + sure);
        const plan = Math.max(0, q.saniye - p.saniye);
        const s = ogr ?? plan;
        sure += j === tam ? (1 - (yer.yer - tam)) * s : s;
        aralik++;
        if (ogr != null) ogrenilen++;
      }
      const varis = Math.max(simdiMs, v.damga + sure * 1000);
      (sonuc[v.hat] ??= []).push({
        kapiNo: v.kapiNo,
        varis,
        kalanDurak,
        yasSn: Math.max(0, Math.round((simdiMs - v.damga) / 1000)),
        enlem: v.enlem,
        boylam: v.boylam,
        ogrenilen: aralik ? Math.round((ogrenilen / aralik) * 100) / 100 : 1,
      });
    }
    for (const liste of Object.values(sonuc)) liste.sort((a, b) => a.varis - b.varis);
    return sonuc;
  }
}

/**
 * Gerçek tarifeden yol: rotanın o duraktan geçen seferlerinden tarife saati şimdiye en
 * yakın olanın durakları ve saatleri.
 */
export function tarifedenYolBul(tarife, seferDuraklari) {
  return (rota, durak, anSn) => {
    const gunSn = (((anSn + 3 * 3600) % 86400) + 86400) % 86400;
    let enIyi = -1;
    let enAz = Infinity;
    for (let i = tarife.durakBas[durak]; i < tarife.durakBas[durak + 1]; i++) {
      const sefer = tarife.sSefer[i];
      if (tarife.seferRota[sefer] !== rota) continue;
      let fark = Math.abs(tarife.sSaniye[i] - gunSn);
      fark = Math.min(fark, Math.abs(fark - 86400));
      if (fark < enAz) {
        enAz = fark;
        enIyi = sefer;
      }
    }
    return enIyi < 0 ? null : seferDuraklari(tarife, enIyi).map((d) => ({ durak: d.durak, saniye: d.saniye }));
  };
}
