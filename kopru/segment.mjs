// Otobüslerin iki durak arası gerçek yol süresini öğrenir.
//
// Neden: İETT tarifesinde bir seferin yalnız ilk ve son durağının saati var; aradaki
// duraklara süre eşit dilimlerle uyduruluyor. Köprüdeki 34G tarifede 3 dakikada
// geçiliyor, trafikteki bir ana cadde ise boş bir sokakla aynı süreyi alıyor. Hem varış
// tahminleri hem rota motoru bu uydurma sürelerle çalışıyordu.
//
// Nasıl: köprü her nabızda (2 dk) eşleşen otobüsün seferi üzerindeki yerini biliyor.
// Aynı otobüsün art arda iki gözlemi arasında geçtiği durakların geçiş anı, iki gözlem
// arasında mesafeye göre ara değerleniyor. Ardışık iki durağın geçiş anları arasındaki
// fark o durak çiftinin bir ölçümü. Tek ölçüm kaba (2 dakikalık aralıkta sabit hız
// varsayımı), ama aynı durak çiftinden günde onlarca otobüs geçiyor; ortalamaları
// gerçeğe oturuyor. Durak çiftleri hattan bağımsız: Metrobüs yolunu 34, 34G, 34AS
// birlikte öğretiyor.
//
// Süreler saat dilimine ve hafta içi/sonuna göre ayrı tutuluyor (sabah trafiği gece
// trafiği değil). Her gece eski ölçümlerin ağırlığı azalıyor (DUSUS): yol çalışması
// bitince öğrenilen süre birkaç günde yeni duruma döner.
//
// Kayıt: kayit/segment-sureleri.json. Özet /durum'da `segment`.

import { seferDuraklari } from './tarife.mjs';

/** İstanbul saatiyle dilimler: [başlangıç saati, bitiş saati). */
export const DILIMLER = [
  [0, 6],
  [6, 10],
  [10, 16],
  [16, 20],
  [20, 24],
];
/** Bir dilimde bu kadar ölçüm olmadan öğrenilen süre kullanılmaz. */
export const EN_AZ_OLCUM = 4;
/** Her gün sonunda eski ölçümlerin ağırlığı bu oranla çarpılır. */
export const DUSUS = 0.85;
/** İki gözlem arası bundan uzunsa (araç veri vermemiş) geçiş anları kestirilmez. */
const EN_UZUN_ARALIK_SN = 6 * 60;
/** Gerçek dışı ölçümler: ~100 km/sa'ten hızlı ya da planın 5 katından yavaş. */
const EN_HIZLI_MS = 28;

/** Unix saniyesinin dilim anahtarı: "i1" = hafta içi 06–10, "h3" = hafta sonu 16–20. */
export function dilimAnahtari(anSn) {
  const d = new Date((anSn + 3 * 3600) * 1000);
  const saat = d.getUTCHours();
  const gun = d.getUTCDay();
  const i = DILIMLER.findIndex(([bas, bit]) => saat >= bas && saat < bit);
  return `${gun === 0 || gun === 6 ? 'h' : 'i'}${i}`;
}

function mesafe(tarife, a, b) {
  const olcek = Math.cos((tarife.durakEnlem[a] * Math.PI) / 180);
  const de = (tarife.durakEnlem[b] - tarife.durakEnlem[a]) * 111_320;
  const db = (tarife.durakBoylam[b] - tarife.durakBoylam[a]) * 111_320 * olcek;
  return Math.hypot(de, db);
}

export class SegmentOgrenici {
  constructor(tarife) {
    this.tarife = tarife;
    /** "durakA>durakB|dilim" → [ölçüm sayısı (ağırlık), toplam saniye] */
    this.kayit = new Map();
    /** kapıNo → { sefer, an, metre, gecis: {i, an} | null } */
    this.araclar = new Map();
    /** sefer → { duraklar, metre[] } — nabız boyunca önbellek */
    this.seferler = new Map();
    this.gun = null;
    this.sayac = { olcum: 0, elenen: 0 };
  }

  /** Seferin durakları ve her durağın sefer başından uzaklığı (metre, kuş uçuşu toplamı). */
  seferYolu(seferIdx) {
    let y = this.seferler.get(seferIdx);
    if (!y) {
      const duraklar = seferDuraklari(this.tarife, seferIdx);
      const metre = [0];
      for (let i = 1; i < duraklar.length; i++) {
        metre.push(metre[i - 1] + mesafe(this.tarife, duraklar[i - 1].durak, duraklar[i].durak));
      }
      y = { duraklar, metre };
      this.seferler.set(seferIdx, y);
    }
    return y;
  }

  /** Durak sırası cinsinden sürekli yeri (12.4) sefer başından metreye çevirir. */
  konumMetre(yol, konum) {
    const { duraklar, metre } = yol;
    for (let i = 0; i < duraklar.length - 1; i++) {
      const a = duraklar[i].sira;
      const b = duraklar[i + 1].sira;
      if (konum <= b) {
        const oran = b > a ? Math.min(1, Math.max(0, (konum - a) / (b - a))) : 0;
        return metre[i] + oran * (metre[i + 1] - metre[i]);
      }
    }
    return metre[metre.length - 1] ?? 0;
  }

  anahtar(durakA, durakB, dilim) {
    return `${this.tarife.durakAd[durakA]}>${this.tarife.durakAd[durakB]}|${dilim}`;
  }

  /** Öğrenilen süre (saniye) ya da yeterli ölçüm yoksa null. */
  sure(durakA, durakB, anSn) {
    const k = this.kayit.get(this.anahtar(durakA, durakB, dilimAnahtari(anSn)));
    return k && k[0] >= EN_AZ_OLCUM ? k[1] / k[0] : null;
  }

  ekle(durakA, durakB, sureSn, anSn, planSn, metre) {
    const hiz = metre / Math.max(sureSn, 1);
    if (sureSn < 5 || hiz > EN_HIZLI_MS || (planSn > 0 && sureSn > 5 * planSn + 300)) {
      this.sayac.elenen++;
      return;
    }
    const a = this.anahtar(durakA, durakB, dilimAnahtari(anSn));
    const k = this.kayit.get(a) ?? [0, 0];
    k[0] += 1;
    k[1] += sureSn;
    this.kayit.set(a, k);
    this.sayac.olcum++;
  }

  /** Bir nabzın eşleşmelerinden geçiş anlarını çıkarır, ardışık durak sürelerini kaydeder. */
  gozlem(eslesenler, simdi = new Date()) {
    const gun = simdi.toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    if (this.gun && this.gun !== gun) this.sonumle();
    this.gun = gun;
    this.seferler.clear();
    const gorulen = new Set();
    for (const e of eslesenler) {
      if (!Number.isFinite(e.konum) || e.seferIdx == null) continue;
      gorulen.add(e.kapiNo);
      const yol = this.seferYolu(e.seferIdx);
      if (yol.duraklar.length < 2) continue;
      const metre = this.konumMetre(yol, e.konum);
      const an = e.damga;
      let k = this.araclar.get(e.kapiNo);
      if (!k || k.sefer !== e.seferIdx || metre < k.metre - 50) {
        k = { sefer: e.seferIdx, an, metre, gecis: null };
        this.araclar.set(e.kapiNo, k);
        continue;
      }
      if (an > k.an && an - k.an <= EN_UZUN_ARALIK_SN && metre > k.metre) {
        for (let i = 0; i < yol.duraklar.length; i++) {
          const m = yol.metre[i];
          if (m <= k.metre || m > metre) continue;
          const gecisAn = k.an + ((m - k.metre) / (metre - k.metre)) * (an - k.an);
          const onceki = k.gecis;
          if (onceki && onceki.i === i - 1) {
            const a = yol.duraklar[i - 1];
            const b = yol.duraklar[i];
            this.ekle(a.durak, b.durak, gecisAn - onceki.an, onceki.an, b.saniye - a.saniye, yol.metre[i] - yol.metre[i - 1]);
          }
          k.gecis = { i, an: gecisAn };
        }
      } else if (an - k.an > EN_UZUN_ARALIK_SN) {
        // Uzun boşluk: zincir kopar, sonraki geçişler yeni başlangıç.
        k.gecis = null;
      }
      k.an = an;
      k.metre = metre;
    }
    const sinir = simdi.getTime() / 1000 - 30 * 60;
    for (const [kapi, k] of this.araclar) if (!gorulen.has(kapi) && k.an < sinir) this.araclar.delete(kapi);
  }

  /**
   * Seferin sıradaki durağından sonraki durakların tahmini varış anları. Öğrenilen süre
   * olan aralıkta o, olmayanda tarifedeki süre kullanılır.
   *
   * @param e eşleşme (kopru.mjs): seferIdx, konum, damga
   * @returns {{sira:number, an:number, ogrenilen:boolean}[]} sıradaki duraktan başlayarak
   */
  varislar(e, enFazla = 40) {
    const yol = this.seferYolu(e.seferIdx);
    const { duraklar } = yol;
    // Sıradaki durak: eşleşmenin güncelleme yazdığı durak (kopru.mjs, konumdakiPlan).
    let i = duraklar.findIndex((d) => d.sira === e.sira);
    if (i < 0) i = duraklar.findIndex((d) => d.sira > e.konum);
    if (i < 1) return [];
    const a = duraklar[i - 1];
    const b = duraklar[i];
    const oran = b.sira > a.sira ? Math.min(1, Math.max(0, (e.konum - a.sira) / (b.sira - a.sira))) : 1;
    let an = e.damga;
    const sonuc = [];
    for (let j = i; j < duraklar.length && sonuc.length < enFazla; j++) {
      const p = duraklar[j - 1];
      const q = duraklar[j];
      const plan = q.saniye - p.saniye;
      const ogr = this.sure(p.durak, q.durak, an);
      const tam = ogr ?? plan;
      an += j === i ? (1 - oran) * tam : tam;
      sonuc.push({ sira: q.sira, an, ogrenilen: ogr != null });
    }
    return sonuc;
  }

  /** Gün sonu: eski ölçümlerin ağırlığı azalır, çok zayıflayanlar silinir. */
  sonumle() {
    for (const [a, k] of this.kayit) {
      k[0] *= DUSUS;
      k[1] *= DUSUS;
      if (k[0] < 0.5) this.kayit.delete(a);
    }
  }

  ozet() {
    let kullanilir = 0;
    for (const k of this.kayit.values()) if (k[0] >= EN_AZ_OLCUM) kullanilir++;
    return { anahtar: this.kayit.size, kullanilir, ...this.sayac, izlenenArac: this.araclar.size };
  }

  disaAktar() {
    const kayit = {};
    for (const [a, k] of this.kayit) kayit[a] = [Math.round(k[0] * 100) / 100, Math.round(k[1])];
    return { gun: this.gun, kayit };
  }

  yukle(veri) {
    if (!veri?.kayit) return;
    for (const [a, k] of Object.entries(veri.kayit)) {
      if (Array.isArray(k) && k.length === 2 && k[0] > 0) this.kayit.set(a, [k[0], k[1]]);
    }
    this.gun = veri.gun ?? null;
  }
}
