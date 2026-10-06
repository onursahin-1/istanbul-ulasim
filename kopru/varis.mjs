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
//
// Kendini ölçüyor: her araç için birkaç durak ilerisine (3, 6, 10) tahmin bırakılıyor,
// araç o durağı geçince gerçek süre kaydediliyor. Tahmin iki parçanın toplamı: öğrenilen
// durak arası süreler (O) ve öğrenilmemiş aralıklarda tarife (P). Gerçeğe en iyi uyan
// çarpanlar (gerçek ≈ a·O + b·P) sürekli güncelleniyor ve tahmine uygulanıyor: öğrenilen
// süreler ya da tarife sistematik olarak uzun/kısaysa düzeltiliyor. Hata da ufuk ufuk
// raporlanıyor (/durum, `varis`).
//
// Hat başında (ilk durakta) bekleyen otobüs: tarifedeki kalkışı beklenir, hemen hareket
// ediyor sayılmaz.

import { KonumIzi, yonluAdaylar } from './yon.mjs';

/** Bundan eski konumdaki araç sayılmaz. */
export const EN_ESKI_KONUM_SN = 10 * 60;
/** Durağa en çok bu kadar durak uzaktaki araçlar sayılır. */
export const EN_UZAK_DURAK = 70;
/** Bundan uzun varış gösterilmez (uzaktaki araç tahmini anlamsızlaşıyor). */
export const EN_UZUN_VARIS_SN = 90 * 60;
/** Ölçüm ufukları: aracın bu kadar durak ilerisine tahmin bırakılır. */
export const UFUKLAR = [3, 6, 10];
/** Çarpanların 1'e doğru çekilme gücü (bu kadar ölçüm ağırlığında). */
const CEKIM = 20;
/** Her yeni ölçümde eski ölçümlerin ağırlığı (yaklaşık son 2000 ölçüm). */
const UNUTMA = 0.9995;
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
  /**
   * @param {(rota:number, durak:number, anSn:number) => number | null} [kalkisBul] hat başından
   *   şu andan sonraki ilk tarife kalkışı (unix sn)
   */
  constructor(tarife, yolBul, ogrenilenSure, kalkisBul = () => null) {
    this.tarife = tarife;
    this.yolBul = yolBul;
    this.ogrenilenSure = ogrenilenSure;
    this.kalkisBul = kalkisBul;
    /** kapıNo → ölçüm izi: { rota, yol, yer, damga, hedefler } */
    this.izleme = new Map();
    /** Çarpan regresyonu toplamları ve ufuk hataları (ham ve düzeltilmiş). */
    this.olcum = { OO: 0, OP: 0, PP: 0, OA: 0, PA: 0, n: 0, hata: {} };
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
      const v = { kapiNo: a.kapiNo, hat, rota, enlem: a.enlem, boylam: a.boylam, damga: a.tarih.getTime() };
      liste.push(v);
      this.olc(v);
    }
    for (const [k, iz] of this.izleme) if (an - iz.damga > 30 * 60_000) this.izleme.delete(k);
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
      const parca = this.kalanYol(yol, yer.yer, hedef, anSn);
      const { a, b } = this.carpanlar();
      let sure = a * parca.O + b * parca.P;
      // Hat başında bekleyen otobüs: tarifedeki kalkış saatinden önce yola çıkmaz.
      let cikis = v.damga / 1000;
      if (yer.yer < DURAKTA_PAYI) {
        const kalkis = this.kalkisBul(v.rota, yol[0].durak, Math.floor(simdiMs / 1000));
        if (kalkis != null && kalkis > cikis) cikis = kalkis;
      }
      if (cikis + sure - simdiMs / 1000 > EN_UZUN_VARIS_SN) continue;
      const varis = Math.max(simdiMs, (cikis + sure) * 1000);
      const { aralik, ogrenilen } = parca;
      (sonuc[v.hat] ??= []).push({
        kapiNo: v.kapiNo,
        rotaId: T.rotaAd?.[v.rota] ?? null,
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

  /**
   * Yolun `yer`den `hedef` durağa kalan kısmı: öğrenilen süreli aralıkların toplamı (O),
   * tarife aralıklarının toplamı (P), sn; içinde bulunulan aralığın yalnız kalanı.
   */
  kalanYol(yol, yer, hedef, anSn) {
    const tam = Math.floor(yer);
    let O = 0;
    let P = 0;
    let aralik = 0;
    let ogrenilen = 0;
    for (let j = tam; j < hedef; j++) {
      const p = yol[j];
      const q = yol[j + 1];
      const kesir = j === tam ? 1 - (yer - tam) : 1;
      const ogr = this.ogrenilenSure(p.durak, q.durak, anSn + O + P);
      if (ogr != null) {
        O += kesir * ogr;
        ogrenilen++;
      } else {
        P += kesir * Math.max(0, q.saniye - p.saniye);
      }
      aralik++;
    }
    return { O, P, aralik, ogrenilen };
  }

  /** Gerçeğe uyan çarpanlar (a: öğrenilen süreler, b: tarife), 1'e çekilmiş, 0,4–2,5 arası. */
  carpanlar() {
    const s = this.olcum;
    if (s.n < 1) return { a: 1, b: 1 };
    const l = (CEKIM * (s.OO + s.PP)) / Math.max(s.n, 1);
    const A11 = s.OO + l;
    const A12 = s.OP;
    const A22 = s.PP + l;
    const B1 = s.OA + l;
    const B2 = s.PA + l;
    const det = A11 * A22 - A12 * A12;
    if (!(det > 0)) return { a: 1, b: 1 };
    const sinirla = (x) => Math.min(2.5, Math.max(0.4, x));
    return { a: sinirla((B1 * A22 - A12 * B2) / det), b: sinirla((A11 * B2 - A12 * B1) / det) };
  }

  /** Ölçüm izi: aracın yol üstündeki yeri ilerledikçe bıraktığı tahminleri gerçekle karşılaştır. */
  olc(v) {
    const T = this.tarife;
    const anSn = Math.floor(v.damga / 1000);
    let k = this.izleme.get(v.kapiNo);
    if (!k || k.rota !== v.rota) {
      const liste = T.rotaDuraklari.get(v.rota) ?? [];
      const yol =
        (liste.length && this.yolBul(v.rota, liste[liste.length - 1].durak, anSn)) ||
        (liste.length && this.yolBul(v.rota, liste[0].durak, anSn)) ||
        null;
      if (!yol || yol.length < 2) {
        this.izleme.delete(v.kapiNo);
        return;
      }
      k = { rota: v.rota, yol, yer: null, damga: v.damga, hedefler: [] };
      this.izleme.set(v.kapiNo, k);
    }
    const yer = yoldakiYer(T, k.yol, v.enlem, v.boylam, T.rotaEsik?.get(v.rota) ?? 400);
    if (!yer) {
      this.izleme.delete(v.kapiNo);
      return;
    }
    // Geri gittiyse (yeni tur) ya da uzun boşluk: baştan.
    if (k.yer != null && (yer.yer < k.yer - 0.5 || v.damga - k.damga > 10 * 60_000)) k.hedefler = [];
    if (k.yer != null && yer.yer > k.yer && v.damga > k.damga) {
      for (const h of k.hedefler) {
        if (yer.yer < h.idx) continue;
        const gecis = k.damga + ((h.idx - k.yer) / (yer.yer - k.yer)) * (v.damga - k.damga);
        this.kaydet(h, (gecis - h.baslangic) / 1000);
        h.bitti = true;
      }
      k.hedefler = k.hedefler.filter((h) => !h.bitti && v.damga - h.baslangic < 90 * 60_000);
    }
    // Yeni tahminler: hat başında beklerken değil (bekleme yol süresi değil).
    if (yer.yer >= DURAKTA_PAYI) {
      const tam = Math.floor(yer.yer);
      for (const ufuk of UFUKLAR) {
        const idx = tam + ufuk;
        if (idx >= k.yol.length || k.hedefler.some((h) => h.ufuk === ufuk)) continue;
        const { O, P } = this.kalanYol(k.yol, yer.yer, idx, anSn);
        if (O + P <= 0) continue;
        k.hedefler.push({ ufuk, idx, baslangic: v.damga, O, P });
      }
    }
    k.yer = yer.yer;
    k.damga = v.damga;
  }

  /** Bir tahminin gerçekleşen süresi: regresyon toplamları ve ufuk hataları. */
  kaydet(h, gercek) {
    if (!(gercek > 0) || gercek > 3 * 3600) return;
    const s = this.olcum;
    const { a, b } = this.carpanlar();
    for (const anahtar of ['OO', 'OP', 'PP', 'OA', 'PA', 'n']) s[anahtar] *= UNUTMA;
    s.OO += h.O * h.O;
    s.OP += h.O * h.P;
    s.PP += h.P * h.P;
    s.OA += h.O * gercek;
    s.PA += h.P * gercek;
    s.n += 1;
    const e = (s.hata[h.ufuk] ??= { n: 0, ham: 0, hamMutlak: 0, duz: 0, duzMutlak: 0 });
    for (const anahtar of ['n', 'ham', 'hamMutlak', 'duz', 'duzMutlak']) e[anahtar] *= UNUTMA;
    const ham = gercek - (h.O + h.P);
    const duz = gercek - (a * h.O + b * h.P);
    e.n += 1;
    e.ham += ham;
    e.hamMutlak += Math.abs(ham);
    e.duz += duz;
    e.duzMutlak += Math.abs(duz);
  }

  /** /durum için: ölçüm sayısı, çarpanlar, ufuk ufuk ortalama hata (sn; artı = geç geldi). */
  ozet() {
    const { a, b } = this.carpanlar();
    const hata = {};
    for (const [ufuk, e] of Object.entries(this.olcum.hata)) {
      const n = Math.max(e.n, 1e-9);
      hata[`${ufuk} durak`] = {
        olcum: Math.round(e.n),
        hamOrtalamaSn: Math.round(e.ham / n),
        hamMutlakSn: Math.round(e.hamMutlak / n),
        duzeltilmisOrtalamaSn: Math.round(e.duz / n),
        duzeltilmisMutlakSn: Math.round(e.duzMutlak / n),
      };
    }
    return {
      olcum: Math.round(this.olcum.n),
      carpan: { ogrenilen: Math.round(a * 100) / 100, tarife: Math.round(b * 100) / 100 },
      izlenenArac: this.izleme.size,
      hata,
    };
  }

  disaAktar() {
    return { surum: 1, olcum: this.olcum };
  }

  yukle(veri) {
    if (veri?.surum === 1 && veri.olcum) this.olcum = { ...this.olcum, ...veri.olcum, hata: veri.olcum.hata ?? {} };
  }
}

/**
 * Hat başından (rotanın ilk durağı) şu andan sonraki ilk tarife kalkışı, unix sn.
 * Bir dakika önce "kalkmış" görünen de sayılır (tarife payı).
 */
export function tarifedenKalkisBul(tarife) {
  return (rota, durak, anSn) => {
    const gunSn = (((anSn + 3 * 3600) % 86400) + 86400) % 86400;
    const gunBasi = anSn - gunSn;
    let enIyi = null;
    for (let i = tarife.durakBas[durak]; i < tarife.durakBas[durak + 1]; i++) {
      if (tarife.seferRota[tarife.sSefer[i]] !== rota) continue;
      const sn = tarife.sSaniye[i];
      for (const aday of [gunBasi + sn, gunBasi + sn - 86400]) {
        if (aday >= anSn - 60 && (enIyi == null || aday < enIyi)) enIyi = aday;
      }
    }
    return enIyi;
  };
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
