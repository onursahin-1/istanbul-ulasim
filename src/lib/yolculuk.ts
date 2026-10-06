// Canlı yol tarifi: yolculuğun adımları ve konuma göre hangi adımda olunduğu.
//
// "Yolculuğu başlat"tan sonra ekran adım adım moduna geçiyor: her bacak bir kart
// (yürü, bin/otobüste, aktarma, varışa yürü). Burada o kartların listesi ve telefonun
// konumuna bakarak sıradaki karta ne zaman geçileceği hesaplanıyor.
//
// Kurallar (yalnız ileri gidilir, konum titremesi geri götürmez):
//   • Yürüme adımı: bacağın sonuna 50 m kalınca bitti. Sonraki adım araçsa "bekle".
//   • Bekleme: araç hareket edince "içinde". İki yoldan anlaşılıyor: telefon hattın biniş
//     durağından sonraki bir durağın dibinde, ya da konum izi hat çizgisi boyunca araç
//     hızıyla (≥ 4 m/sn; yürüyüş ~1,4) biniş durağından uzaklaşıyor (binisiAlgila). İkincisi
//     sıradaki durağa varmayı beklemiyor ve kaba konumla (metro istasyonunun Wi-Fi'si,
//     otobüs içinde 65 m doğruluk) da çalışıyor; biniş anı duraktan ayrılış anı.
//     Kullanıcı "Bindim" diyerek de geçebilir (elleBin).
//   • İçinde: en yakın durağa göre kalan durak; iniş durağına varıp oradan 60 m
//     uzaklaşınca bitti.
//   • Arada konum gelmemişse (tünel, uyku): telefon sıradaki araç bacağının durakları
//     üzerindeyse doğrudan o adıma atlanır.
//   • Konum doğruluğu: 50 m'den iyisi her karara girer. 50–300 m arası "kaba" konum
//     yalnız ileri götüren kararlara girer ve doğruluğu kadar geride sayılır (temkinli):
//     binişi ve araçtaki ilerlemeyi gösterir, inişe ve yürüyüşün bitişine karar vermez.
//     Eskiden 50 m'den kötüsü tamamen atılıyordu; iPhone otobüs içinde ve istasyonda sık
//     sık 65 m verdiği için yolculuk "başlamamış gibi" kalıyordu.
//   • Araçta duraklar arası kesirli ilerleme tutuluyor (1.4 = 2. duraktan %40 ileride):
//     durak listesindeki mavi nokta duraktan durağa kayarak ilerlesin. Taze GPS varsa
//     konum duraklar çizgisine izdüşürülüyor; yoksa (metro tüneli) ilerleme biniş ve
//     iniş saatinden, duraklar arası mesafeye göre tahmin ediliyor (durumuZamanla).
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { cizgiUzerindeYer, cizgiyeUzaklik, mesafeMetre, type Nokta } from './cografya';

/** Bir konum ölçümü. */
export type KonumOrnegi = {
  an: number;
  konum: Nokta;
  /** Metre; bilinmiyorsa null. */
  dogruluk: number | null;
  /** Telefonun ölçtüğü hız, m/sn (Doppler); bilinmiyorsa null. */
  hiz?: number | null;
};

/** Bundan iyi doğruluklu konum her karara girer. */
export const IYI_DOGRULUK_M = 50;
/** Bundan kötüsü hiçbir karara girmez; arası "kaba": yalnız ileri götürür, temkinli. */
export const KABA_DOGRULUK_M = 300;
/** Biniş: hat çizgisi boyunca biniş durağından en az bu kadar uzaklaşılmış olmalı. */
export const BINIS_ILERLEME_M = 150;
/** Araç hızı: bundan hızlı ilerleme yürüyüş değil (m/sn, ~14 km/sa; hızlı yürüyüş ~2). */
export const ARAC_HIZI_ESIGI_MS = 4;
/** Duraktan ayrılıştan beri ortalama bundan hızlıysa (trafikte duran otobüs dahil) araçtayız. */
export const ORTALAMA_ARAC_HIZI_MS = 2.5;
/**
 * İzde biniş durağının yakınında hiç konum yoksa (yolculuk araçtayken başlatıldı) araç
 * hızı görülmesi ve en az bu kadar ilerleme gerekir. Yalnız uzaklık yetmez: hattın
 * yakınında oturan biri yolculuğu evden başlatınca "metroya binmiş" sayılıyordu.
 */
export const DURAKSIZ_BINIS_M = 300;
/** İzdeki bir konum biniş durağına kuş uçuşu bu kadar yakınsa "durağa gelmişti" sayılır (istasyon girişi). */
export const DURAK_CEVRESI_M = 250;
/** Biniş anı geri hesabında aracın varsayılan hızı, m/sn. */
const VARSAYILAN_ARAC_HIZI_MS = 7;
/** Raylı sisteme yürürken konum bu kadar süre kesilirse (istasyona inildi) yürüyüş bitti sayılır. */
export const SINYAL_KAYBI_MS = 60_000;
/** ...yeter ki son konum istasyona bu kadar yakın olsun. */
export const ISTASYON_GIRISI_M = 200;
/**
 * Yeraltı istasyonda konum çoğu zaman kesilmiyor, kaba geliyor (Wi-Fi, 65–300 m) ve
 * istasyon doğruluk dairesinin içinde kalıyor. Bu durum bu kadar sürerse istasyondayız.
 */
export const ISTASYONDA_KABA_MS = 30_000;

/** Bundan kısa yürüyüşler (aynı duraktaki aktarma, OTP'nin birkaç metrelik bacakları) adım sayılmaz. */
export const KISA_YURUME_M = 30;
/** Yürüme bacağının sonuna bu kadar yaklaşınca varılmış sayılır. */
export const VARIS_M = 50;
/** Araçtayken bir durağa bu kadar yakınsa o duraktayız. Otobüste GPS kayabiliyor. */
export const DURAK_M = 120;
/** İniş durağından bu kadar uzaklaşınca inilmiş sayılır. */
export const AYRILMA_M = 60;

export type AdimTuru = 'yuru' | 'arac';
/** Yürüyüşün yolculuktaki yeri: ilk binişe, aktarmaya, varışa ya da baştan sona yürüyüş. */
export type YuruRolu = 'baslangic' | 'aktarma' | 'varis' | 'tek';

export type Adim = { bacak: number; tur: AdimTuru; rol?: YuruRolu };

/** Bir bacağın adım hesabı için gereken kısmı. */
export type BacakOzeti = {
  arac: boolean;
  /** Metre; bilinmiyorsa null. */
  mesafe: number | null;
  /** Bacağın bittiği nokta (iniş durağı, aktarma durağı, varış). */
  bitis: Nokta;
  /** Araç bacağının durakları, biniş dahil sırayla. Yürüyüşte boş. */
  duraklar: Nokta[];
  /** Biniş ve iniş anı (ms, canlı tahmin varsa o). Konum yokken ilerleme bunlardan. */
  binisMs?: number | null;
  inisMs?: number | null;
  /**
   * Bacağın çizgisi. Araçta biniş → iniş: binişi konum izinden anlamak için. Yürüyüşte
   * yürünecek yol: sonuna gelindiğini kuş uçuşu değil yol boyunca ölçmek için.
   */
  cizgi?: Nokta[];
  /** Metro, Marmaray, füniküler: istasyon yeraltında, girince konum kesilir. */
  rayli?: boolean;
};

export type Faz = 'yuru' | 'bekle' | 'icinde' | 'vardi';

export type YolculukDurumu = {
  /** adimlar dizisindeki sıra. */
  adim: number;
  faz: Faz;
  /** Araçtayken iniş durağına kalan durak; bilinmiyorsa null. */
  kalanDurak: number | null;
  /** İniş durağına varıldı (inilmeyi bekliyor). */
  durakta: boolean;
  /**
   * Araçtayken duraklar arası kesirli konum: 0 biniş durağı, son iniş durağı; 1.4 =
   * ikinci duraktan %40 ileride. Yalnız ileri gider. Araçta değilken yok.
   */
  ilerleme?: number;
  /** Araca binilen an (ms): konumdan, düğmeden ya da tarifeden. Yalnız araçtayken. */
  binisAn?: number;
  /**
   * Metroya yürürken kaba konumun istasyonun dibinde görülmeye başladığı an (ms):
   * yeraltında konum kaba gelir, sürerse istasyona inilmiş sayılır (durumuZamanla).
   */
  kabaYakin?: number;
};

/** Bacaklardan adımlar: araç bacaklarının hepsi, kısa olmayan yürüyüşler. */
export function adimlariKur(bacaklar: Pick<BacakOzeti, 'arac' | 'mesafe'>[]): Adim[] {
  const aracVar = bacaklar.some((b) => b.arac);
  const ilkArac = bacaklar.findIndex((b) => b.arac);
  let sonArac = -1;
  bacaklar.forEach((b, i) => {
    if (b.arac) sonArac = i;
  });
  const adimlar: Adim[] = [];
  bacaklar.forEach((b, i) => {
    if (b.arac) {
      adimlar.push({ bacak: i, tur: 'arac' });
      return;
    }
    if (aracVar && b.mesafe != null && b.mesafe < KISA_YURUME_M) return;
    const rol: YuruRolu = !aracVar ? 'tek' : i < ilkArac ? 'baslangic' : i > sonArac ? 'varis' : 'aktarma';
    adimlar.push({ bacak: i, tur: 'yuru', rol });
  });
  return adimlar;
}

function adimaGir(adimlar: Adim[], sira: number): YolculukDurumu {
  const a = adimlar[sira];
  return { adim: sira, faz: a.tur === 'arac' ? 'bekle' : 'yuru', kalanDurak: null, durakta: false };
}

/** Yolculuk başladığında: ilk adım. */
export function baslangicDurumu(adimlar: Adim[]): YolculukDurumu {
  if (!adimlar.length) return { adim: 0, faz: 'vardi', kalanDurak: null, durakta: false };
  return adimaGir(adimlar, 0);
}

/** Sıradaki adıma geç; yoksa varıldı. */
export function sonrakiAdim(d: YolculukDurumu, adimlar: Adim[]): YolculukDurumu {
  if (d.adim + 1 < adimlar.length) return adimaGir(adimlar, d.adim + 1);
  return { ...d, faz: 'vardi', kalanDurak: null, durakta: false };
}

function enYakinDurak(konum: Nokta, duraklar: Nokta[]): { sira: number; metre: number } {
  let sira = -1;
  let metre = Infinity;
  duraklar.forEach((d, j) => {
    const m = mesafeMetre(konum, d);
    if (m < metre) {
      metre = m;
      sira = j;
    }
  });
  return { sira, metre };
}

/** Bir durağa bu kesirden yakınsa o duraktayız (durakta bekleme, yavaşlama, GPS payı). */
export const DURAKTA_PAYI = 0.15;

/** Kesirli ilerlemeden bulunulan (ya da geçilen son) durağın sırası. */
export function durakSirasi(ilerleme: number, son: number): number {
  return Math.max(0, Math.min(son, Math.floor(ilerleme + DURAKTA_PAYI)));
}

/**
 * Telefonun duraklar çizgisindeki kesirli yeri: her iki durak arası düz bir parça
 * sayılıyor, konum en yakın parçaya izdüşürülüyor. Çizgiden `tolerans`tan uzaksa null.
 * `pay` metre kadar geride sayılır: kaba konumda (doğruluk 65 m) ileri kaçmasın, çünkü
 * ilerleme geri gitmiyor.
 */
export function konumlaIlerleme(
  duraklar: Nokta[],
  konum: Nokta,
  pay = 0,
  tolerans = DURAK_M,
  cizgi?: Nokta[],
): number | null {
  if (cizgi && cizgi.length > 1 && duraklar.length > 1) return cizgiyleIlerleme(duraklar, cizgi, konum, pay, tolerans);
  let enIyi: { sira: number; oran: number; uzaklik: number } | null = null;
  for (let k = 0; k + 1 < duraklar.length; k++) {
    const yer = cizgiUzerindeYer(konum, [duraklar[k], duraklar[k + 1]]);
    const oran = yer.toplam > 0 ? yer.boyunca / yer.toplam : 0;
    if (!enIyi || yer.uzaklik < enIyi.uzaklik) enIyi = { sira: k, oran, uzaklik: yer.uzaklik };
  }
  if (!enIyi || enIyi.uzaklik > tolerans) return null;
  if (pay <= 0) return enIyi.sira + enIyi.oran;
  const boylar = duraklar.slice(1).map((d, k) => mesafeMetre(duraklar[k], d));
  let metre = boylar.slice(0, enIyi.sira).reduce((t, x) => t + x, 0) + enIyi.oran * boylar[enIyi.sira] - pay;
  if (metre <= 0) return 0;
  for (let k = 0; k < boylar.length; k++) {
    if (metre <= boylar[k]) return k + (boylar[k] > 0 ? metre / boylar[k] : 0);
    metre -= boylar[k];
  }
  return boylar.length;
}

/**
 * Durakların aracın gerçek yolu (bacağın çizgisi) üstündeki yeri, metre. Her durak bir
 * öncekinden sonra aranıyor: yol kendine yaklaşsa da sıra bozulmasın.
 */
function duraklarinYeri(duraklar: Nokta[], cizgi: Nokta[]): number[] {
  const yerler: number[] = [];
  let parca = 0;
  for (const d of duraklar) {
    const kx = 111320 * Math.cos((d.latitude * Math.PI) / 180);
    const ky = 110540;
    let biriken = 0;
    let enIyi = { boyunca: yerler[yerler.length - 1] ?? 0, uzaklik: Infinity, parca };
    for (let i = 1; i < cizgi.length; i++) {
      const ax = (cizgi[i - 1].longitude - d.longitude) * kx;
      const ay = (cizgi[i - 1].latitude - d.latitude) * ky;
      const dx = (cizgi[i].longitude - d.longitude) * kx - ax;
      const dy = (cizgi[i].latitude - d.latitude) * ky - ay;
      const boy = Math.hypot(dx, dy);
      if (i - 1 >= parca) {
        const t = boy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (boy * boy))) : 0;
        const u = Math.hypot(ax + t * dx, ay + t * dy);
        if (u < enIyi.uzaklik) enIyi = { boyunca: biriken + t * boy, uzaklik: u, parca: i - 1 };
      }
      biriken += boy;
    }
    parca = enIyi.parca;
    yerler.push(Math.max(enIyi.boyunca, yerler[yerler.length - 1] ?? 0));
  }
  return yerler;
}

const yerOnbellegi = new WeakMap<Nokta[], { cizgi: Nokta[]; yerler: number[] }>();

/**
 * konumlaIlerleme'nin aracın gerçek yoluyla hâli: konum bacağın çizgisine izdüşürülür,
 * çizgi boyunca kaç metrede olduğu durakların çizgideki yerleriyle kesirli sıraya çevrilir.
 * Duraklar arası düz çizgi kıvrılan yolda (otoyol bağlantısı, uzak duraklar) 120 m'den
 * fazla açılabiliyor; o zaman nokta durağa yaklaşana kadar ilerlemiyordu.
 */
function cizgiyleIlerleme(duraklar: Nokta[], cizgi: Nokta[], konum: Nokta, pay: number, tolerans: number): number | null {
  let kayit = yerOnbellegi.get(duraklar);
  if (!kayit || kayit.cizgi !== cizgi) {
    kayit = { cizgi, yerler: duraklarinYeri(duraklar, cizgi) };
    yerOnbellegi.set(duraklar, kayit);
  }
  const { yerler } = kayit;
  const yer = cizgiUzerindeYer(konum, cizgi);
  if (yer.uzaklik > tolerans) return null;
  const metre = yer.boyunca - pay;
  if (metre <= yerler[0]) return 0;
  for (let k = 0; k + 1 < yerler.length; k++) {
    if (metre <= yerler[k + 1]) {
      const ara = yerler[k + 1] - yerler[k];
      return k + (ara > 0 ? (metre - yerler[k]) / ara : 1);
    }
  }
  return yerler.length - 1;
}

/** Kaba konum doğruluğu kadar geride sayılır; iyisi olduğu yerde. */
const temkinPayi = (dogruluk: number | null | undefined) =>
  dogruluk != null && dogruluk > IYI_DOGRULUK_M ? dogruluk : 0;

type IzNoktasi = { an: number; hiz: number | null; boyunca: number; uzaklik: number; pay: number; duraga: number };

function iziCizgiyeYerlestir(iz: KonumOrnegi[], cizgi: Nokta[]): IzNoktasi[] {
  const durak = cizgi[0];
  return iz
    .filter((o) => o.dogruluk == null || o.dogruluk <= KABA_DOGRULUK_M)
    .map((o) => {
      const yer = cizgiUzerindeYer(o.konum, cizgi);
      return {
        an: o.an,
        hiz: o.hiz != null && o.hiz >= 0 ? o.hiz : null,
        boyunca: yer.boyunca,
        uzaklik: yer.uzaklik,
        pay: temkinPayi(o.dogruluk),
        duraga: durak ? mesafeMetre(o.konum, durak) : Infinity,
      };
    });
}

/**
 * İzde araç hızı görüldü mü: art arda iki iyi ölçümde telefonun kendi hızı ≥ 4,5 m/sn,
 * ya da 10–120 sn arayla çizgi boyunca en az 50 m, ≥ 4 m/sn ilerleme. Kısa aralık ve
 * en az 50 m şartı GPS titremesini (10–20 m) hız sanmamak için. Kaba konumda iki ölçümün
 * payı da tam düşülür: binada Wi-Fi konumu 100–200 m sıçrayabiliyor, bu hız sanılmasın.
 */
function aracHiziGoruldu(noktalar: IzNoktasi[]): boolean {
  for (let k = 1; k < noktalar.length; k++) {
    const a = noktalar[k - 1];
    const b = noktalar[k];
    if (!a.pay && !b.pay && (a.hiz ?? 0) >= 4.5 && (b.hiz ?? 0) >= 4.5) return true;
  }
  for (let j = 1; j < noktalar.length; j++) {
    for (let i = Math.max(0, j - 80); i < j; i++) {
      const sn = (noktalar[j].an - noktalar[i].an) / 1000;
      if (sn < 10 || sn > 120) continue;
      const metre = noktalar[j].boyunca - noktalar[i].boyunca - (noktalar[i].pay + noktalar[j].pay);
      if (metre >= 50 && metre / sn >= ARAC_HIZI_ESIGI_MS) return true;
    }
  }
  return false;
}

/** Biniş durağında sayılan yakınlık (çizgi boyunca, metre). */
const DURAK_YAKINI_M = 40;

/**
 * Biniş durağının dibindeki (ya da çevresindeki: istasyon girişi, durağa yürürken) son
 * konumun izdeki sırası (son konum hariç); yoksa -1.
 */
function duraktanAyrilis(noktalar: IzNoktasi[]): number {
  for (let k = noktalar.length - 2; k >= 0; k--) {
    const p = noktalar[k];
    if (p.boyunca - p.pay <= DURAK_YAKINI_M && p.uzaklik <= Math.max(DURAK_M, p.pay + 50)) return k;
  }
  // Durağın dibinde yoksa çevresi: istasyon girişi ya da yandan yaklaşırken. Aracın hat
  // üstünde duraktan uzaklaştığı konumlar sayılmaz (biniş anı kaymasın).
  for (let k = noktalar.length - 2; k >= 0; k--) {
    const p = noktalar[k];
    if (p.duraga <= DURAK_CEVRESI_M && (p.boyunca - p.pay <= 100 || p.uzaklik > DURAK_M)) return k;
  }
  return -1;
}

/**
 * Konum izinden biniş: son konum hat çizgisinin üstünde (biniş durağından sonra) ve
 * biniş durağından en az 150 m ilerde mi, oraya araç hızıyla mı gelindi? Öyleyse biniş
 * anını (duraktan ayrılış) döner, değilse null.
 *
 * Hız şartı yürüyüşü ayırıyor: durakta beklerken birkaç yüz metre ilerdeki durağa
 * yürüyen "bindi" sayılmasın. Yolcu durağa hiç gelmemişse (izde durağın çevresinde konum
 * yok) yalnız gözle görülür araç hızı binişi gösterir; hattın yanında durmak göstermez.
 *
 * @param iz Zaman sıralı konumlar, sonuncusu şimdiki.
 * @param cizgi Araç bacağının çizgisi, biniş durağından başlar.
 */
export function binisiAlgila(iz: KonumOrnegi[], cizgi: Nokta[]): number | null {
  if (cizgi.length < 2) return null;
  const noktalar = iziCizgiyeYerlestir(iz, cizgi);
  const son = noktalar[noktalar.length - 1];
  if (!son || son.uzaklik > Math.max(DURAK_M, son.pay + 30)) return null;
  const ilerleme = son.boyunca - son.pay;
  if (ilerleme < BINIS_ILERLEME_M) return null;
  const tahmin = son.an - (ilerleme / VARSAYILAN_ARAC_HIZI_MS) * 1000;
  const k = duraktanAyrilis(noktalar);
  if (k < 0) return ilerleme >= DURAKSIZ_BINIS_M && aracHiziGoruldu(noktalar) ? tahmin : null;
  if (aracHiziGoruldu(noktalar.slice(k))) return noktalar[k].an;
  const ayrilis = noktalar[k];
  const sn = (son.an - ayrilis.an) / 1000;
  const ortalama = sn > 0 ? (ilerleme - (ayrilis.boyunca + ayrilis.pay)) / sn : 0;
  return ortalama >= ORTALAMA_ARAC_HIZI_MS ? ayrilis.an : null;
}

/** Durak yakınlığıyla anlaşılan binişte biniş anı: izdeki duraktan ayrılış, yoksa geri hesap. */
function binisAniTahmini(iz: KonumOrnegi[] | undefined, cizgi: Nokta[] | undefined): number | undefined {
  if (!iz?.length) return undefined;
  const son = iz[iz.length - 1];
  if (!cizgi || cizgi.length < 2) return son.an;
  const noktalar = iziCizgiyeYerlestir(iz, cizgi);
  const k = duraktanAyrilis(noktalar);
  if (k >= 0) return noktalar[k].an;
  const yer = cizgiUzerindeYer(son.konum, cizgi);
  return son.an - (yer.boyunca / VARSAYILAN_ARAC_HIZI_MS) * 1000;
}

/**
 * Konum yokken tahmin: biniş ile iniş arasında geçen sürenin oranı kadar yol alınmış,
 * yol duraklar arası mesafeye göre bölüştürülüyor (uzun ara uzun sürer).
 */
export function zamanlaIlerleme(duraklar: Nokta[], binisMs: number, inisMs: number, simdi: number): number {
  const son = duraklar.length - 1;
  if (son <= 0) return 0;
  const oran = inisMs > binisMs ? Math.max(0, Math.min(1, (simdi - binisMs) / (inisMs - binisMs))) : simdi >= inisMs ? 1 : 0;
  const parcalar = duraklar.slice(1).map((d, k) => mesafeMetre(duraklar[k], d));
  const toplam = parcalar.reduce((t, x) => t + x, 0);
  if (toplam <= 0) return oran * son;
  let kalan = oran * toplam;
  for (let k = 0; k < parcalar.length; k++) {
    if (kalan <= parcalar[k]) return k + (parcalar[k] > 0 ? kalan / parcalar[k] : 0);
    kalan -= parcalar[k];
  }
  return son;
}

/** Yeni ilerlemeyi işler: yalnız ileri; kalan durak ve "inişte" ondan çıkar. */
function ilerlemeyiYaz(d: YolculukDurumu, yeni: number, son: number): YolculukDurumu {
  const ilerleme = Math.max(d.ilerleme ?? 0, Math.min(Math.max(yeni, 0), son));
  const kalan = Math.min(d.kalanDurak ?? Infinity, son - durakSirasi(ilerleme, son));
  const durakta = kalan === 0;
  if (ilerleme === d.ilerleme && kalan === d.kalanDurak && durakta === d.durakta) return d;
  return { ...d, ilerleme, kalanDurak: kalan, durakta };
}

/**
 * Yürüyüşün sonuna gelindi mi, yürünecek yol boyunca: durağa kuş uçuşu yakın olmak yetmez.
 * Evin metro istasyonunun 50 m yanında, girişi ise otoyolun öbür yakasında olabilir
 * (880 m yürüyüş); yolculuğu evden başlatınca "durağa vardın" denmesin. Yürüme çizgisi
 * yoksa ya da konum çizgiden uzaksa (başka sokaktan gelindi) yalnız uzaklık; kaba konumla değil.
 */
function yuruyusSonundaMi(bacak: BacakOzeti, konum: Nokta, pay: number): boolean {
  const cizgi = bacak.cizgi;
  if (!cizgi || cizgi.length < 2) return true;
  const yer = cizgiUzerindeYer(konum, cizgi);
  if (yer.uzaklik > 150) return pay === 0;
  return yer.toplam - yer.boyunca <= Math.max(2 * VARIS_M, pay);
}

/** durumuIlerlet'e konumla gelen ek bilgi. */
export type IlerletmeEki = {
  /** Konumun doğruluğu, metre. Verilmezse iyi sayılır. */
  dogruluk?: number | null;
  /** Son birkaç dakikanın konumları (sonuncusu bu konum): binişi hızdan anlamak için. */
  iz?: KonumOrnegi[];
};

function icineGir(adim: number, binisAn: number | undefined): YolculukDurumu {
  return { adim, faz: 'icinde', kalanDurak: null, durakta: false, ...(binisAn != null ? { binisAn } : {}) };
}

/** Telefonun yeni konumuna göre durumu ilerletir. Durum değişmediyse aynı nesneyi döner. */
export function durumuIlerlet(
  d: YolculukDurumu,
  konum: Nokta,
  adimlar: Adim[],
  bacaklar: BacakOzeti[],
  ek: IlerletmeEki = {},
): YolculukDurumu {
  if (d.faz === 'vardi' || !adimlar[d.adim]) return d;
  const dogruluk = ek.dogruluk ?? null;
  if (dogruluk != null && dogruluk > KABA_DOGRULUK_M) return d;
  const iyi = dogruluk == null || dogruluk <= IYI_DOGRULUK_M;
  const pay = temkinPayi(dogruluk);
  const tolerans = Math.max(DURAK_M, pay + 30);

  // Sıradaki araç adımına (şimdiki de olabilir) binildi mi?
  const bakilacak = adimlar.findIndex((a, i) => i >= d.adim && a.tur === 'arac' && !(i === d.adim && d.faz === 'icinde'));
  if (bakilacak >= 0) {
    const b = bacaklar[adimlar[bakilacak].bacak];
    const liste = b?.duraklar ?? [];
    const son = liste.length - 1;
    // Biniş durağından sonraki bir durağın dibindeyiz (iyi konum). Konum izi varsa buna
    // bakılmıyor: sıradaki durağa yürüyen de oraya varıyor, araç olduğunu hız söylüyor.
    const y = enYakinDurak(konum, liste);
    if (!ek.iz && iyi && y.sira >= 1 && y.metre <= DURAK_M) {
      return ilerlemeyiYaz(icineGir(bakilacak, binisAniTahmini(ek.iz, b?.cizgi)), konumlaIlerleme(liste, konum, 0, DURAK_M, b?.cizgi) ?? y.sira, son);
    }
    // Konum izi hat boyunca araç hızıyla ilerliyor (sıradaki durağa varmayı beklemeden).
    if (ek.iz && b?.cizgi) {
      const binisAn = binisiAlgila(ek.iz, b.cizgi);
      if (binisAn != null) {
        return ilerlemeyiYaz(icineGir(bakilacak, binisAn), konumlaIlerleme(liste, konum, pay, tolerans, b.cizgi) ?? 0, son);
      }
    }
  }

  const bacak = bacaklar[adimlar[d.adim].bacak];
  if (!bacak) return d;

  if (d.faz === 'yuru') {
    // Kaba konumda doğruluğu kadar (en çok 150 m) yakınlık yeter: duraktayız ama GPS bilemiyor.
    const esik = iyi ? VARIS_M : Math.min(pay, 150);
    if (mesafeMetre(konum, bacak.bitis) > esik) return d;
    return yuruyusSonundaMi(bacak, konum, iyi ? 0 : pay) ? sonrakiAdim(d, adimlar) : d;
  }

  if (d.faz === 'icinde') {
    const son = bacak.duraklar.length - 1;
    const inis = bacak.duraklar[son];
    // İniş yalnız iyi konumla: kaba konum araçta giderken de 60 m "uzak" görünebilir.
    if (iyi && d.durakta && inis && mesafeMetre(konum, inis) > AYRILMA_M) return sonrakiAdim(d, adimlar);
    // İlerleme ve kalan durak yalnız artar/azalır: halka hatlarda ya da GPS kayınca geri gitmesin.
    const yeni = konumlaIlerleme(bacak.duraklar, konum, pay, tolerans, bacak.cizgi);
    return yeni == null ? d : ilerlemeyiYaz(d, yeni, son);
  }

  return d;
}

/**
 * Kullanıcı "Bindim" dedi: şimdiki (ya da yürüyüşten sonraki) araç adımında araca
 * binilmiş sayılır, biniş anı şimdi. Araçta değilken ve sırada araç yoksa değişmez.
 */
export function elleBin(d: YolculukDurumu, adimlar: Adim[], bacaklar: BacakOzeti[], simdi: number): YolculukDurumu {
  if (d.faz === 'vardi' || d.faz === 'icinde') return d;
  const sira = adimlar[d.adim]?.tur === 'arac' ? d.adim : adimlar[d.adim + 1]?.tur === 'arac' ? d.adim + 1 : -1;
  if (sira < 0) return d;
  const son = Math.max(0, (bacaklar[adimlar[sira].bacak]?.duraklar.length ?? 1) - 1);
  return ilerlemeyiYaz(icineGir(sira, simdi), 0, son);
}

/**
 * Kullanıcı "İstasyondayım / Duraktayım" dedi: yürüyüş bitti, sıradaki araç bekleniyor.
 * Konum anlayamadıysa (yeraltı, bina içi) elle. Yürümüyorken ya da sırada araç yoksa değişmez.
 */
export function elleVar(d: YolculukDurumu, adimlar: Adim[]): YolculukDurumu {
  if (d.faz !== 'yuru' || adimlar[d.adim + 1]?.tur !== 'arac') return d;
  return sonrakiAdim(d, adimlar);
}

/** GPS bundan eskiyse "yok" sayılır (metro tüneli); ilerleme saatten tahmin edilir. */
export const GPS_TAZE_MS = 25_000;
/** Taze sayılması için en kötü doğruluk. */
export const GPS_TAZE_DOGRULUK_M = 50;
/** Kalkıştan bu kadar sonra konum yoksa araca binilmiş sayılır. */
export const KALKIS_PAYI_MS = 45_000;
/** İnişten bu kadar sonra konum yoksa inilmiş sayılır (yeraltında aktarma). */
export const INIS_PAYI_MS = 120_000;

/**
 * Konum gelmeden geçen zamana göre ilerletir; birkaç saniyede bir çağrılıyor.
 *
 * Yalnız GPS yokken iş görür (tünel, istasyon içi): taze konum varken durumu konum
 * belirliyor (durumuIlerlet). Kalkış saati geçip konum da gelmiyorsa metroya binilmiş
 * sayılıyor; taze konum hâlâ biniş durağındaysa sayılmıyor (kaçırılmış olabilir).
 */
export function durumuZamanla(
  d: YolculukDurumu,
  simdi: number,
  adimlar: Adim[],
  bacaklar: BacakOzeti[],
  gps: { an: number; dogruluk?: number | null; konum?: Nokta | null } | null,
): YolculukDurumu {
  const a = adimlar[d.adim];
  // Metroya yürürken istasyona inildi. İki görünüşü var:
  //   • konum kaba geliyor ve istasyon doğruluk dairesinin içinde (yeraltında Wi-Fi konumu):
  //     30 sn sürerse istasyondayız. Yol boyunca bakılmıyor: yolculuk istasyonun içinde
  //     başlatılınca rota da o kaba konumdan çizildiği için yürüyüş "hiç yürünmemiş" görünür.
  //     İyi konum (evde, sokakta) bunu sıfırlar; evden başlatınca "vardın" denmez.
  //   • konum kesildi, son konum istasyonun yanındaydı.
  if (a?.tur === 'yuru' && d.faz === 'yuru') {
    const sonraki = adimlar[d.adim + 1];
    const bitis = bacaklar[a.bacak]?.bitis;
    const sifirla = (x: YolculukDurumu) => {
      if (x.kabaYakin == null) return x;
      const { kabaYakin: _, ...geri } = x;
      return geri;
    };
    if (sonraki?.tur !== 'arac' || !bacaklar[sonraki.bacak]?.rayli || !gps?.konum || !bitis) return sifirla(d);
    const kabaTaze =
      simdi - gps.an <= GPS_TAZE_MS &&
      gps.dogruluk != null &&
      gps.dogruluk > IYI_DOGRULUK_M &&
      gps.dogruluk <= KABA_DOGRULUK_M;
    if (kabaTaze) {
      const icinde = mesafeMetre(gps.konum, bitis) <= Math.min(Math.max(gps.dogruluk!, 100), ISTASYON_GIRISI_M);
      if (!icinde) return sifirla(d);
      if (d.kabaYakin == null) return { ...d, kabaYakin: simdi };
      return simdi - d.kabaYakin >= ISTASYONDA_KABA_MS ? sonrakiAdim(d, adimlar) : d;
    }
    d = sifirla(d);
    if (simdi - gps.an < SINYAL_KAYBI_MS || mesafeMetre(gps.konum, bitis) > ISTASYON_GIRISI_M) return d;
    // Yürüyüşün sonuna yakın olmalı: istasyonun yanındaki evde konum kesildi diye değil.
    // Son konum kabaysa yol boyunca ilerlemeye bakılmaz: kaba konumla ölçülemez (yolculuk
    // istasyonun içinde başlatılınca yürüyüş de o kaba konumdan çizilmiş olur).
    const b0 = bacaklar[a.bacak];
    const cizgi = b0?.cizgi;
    const iyiSon = gps.dogruluk == null || gps.dogruluk <= IYI_DOGRULUK_M;
    if (cizgi && cizgi.length > 1 && iyiSon) {
      const yer = cizgiUzerindeYer(gps.konum, cizgi);
      if (yer.uzaklik <= 150 && yer.toplam - yer.boyunca > ISTASYON_GIRISI_M) return d;
    }
    return sonrakiAdim(d, adimlar);
  }
  if (!a || a.tur !== 'arac' || (d.faz !== 'bekle' && d.faz !== 'icinde')) return d;
  const b = bacaklar[a.bacak];
  if (!b || b.binisMs == null || b.inisMs == null || b.duraklar.length < 2) return d;
  const son = b.duraklar.length - 1;
  const gpsTaze =
    gps != null && simdi - gps.an <= GPS_TAZE_MS && (gps.dogruluk == null || gps.dogruluk <= GPS_TAZE_DOGRULUK_M);
  if (gpsTaze) return d;
  // Kaba konum da geliyorsa (otobüs içi, bina içi 65–300 m) kararı konum verir: saat,
  // trafikte bekleyen otobüsü ileri götürüp yanlış durakta "indin" diyebilir; beklerken de
  // telefon hareket etmiyorken "kalkış saati geçti, bindin" demek yanlış. Saat yalnız konum
  // gerçekten kesilince (tünel, yeraltı peron) devreye girer.
  const kabaTaze = gps != null && simdi - gps.an <= GPS_TAZE_MS && (gps.dogruluk == null || gps.dogruluk <= KABA_DOGRULUK_M);
  if (kabaTaze) return d;
  if (d.faz === 'bekle') {
    if (simdi < b.binisMs + KALKIS_PAYI_MS) return d;
    // Konum kesilmeden önce durağın çevresinde değildiyse (evde, yolda) binilmiş olamaz.
    if (gps?.konum && mesafeMetre(gps.konum, b.duraklar[0]) > 2 * ISTASYON_GIRISI_M) return d;
    const giris: YolculukDurumu = { ...d, faz: 'icinde', kalanDurak: null, durakta: false, binisAn: b.binisMs };
    return ilerlemeyiYaz(giris, zamanlaIlerleme(b.duraklar, b.binisMs, b.inisMs, simdi), son);
  }
  if (d.durakta) return simdi > b.inisMs + INIS_PAYI_MS ? sonrakiAdim(d, adimlar) : d;
  return ilerlemeyiYaz(d, zamanlaIlerleme(b.duraklar, b.binisMs, b.inisMs, simdi), son);
}

/** Aktarmada yetişme payı, dakika (aşağı yuvarlanır). Eksi: yetişilemiyor. */
export function aktarmaPayi(varisMs: number, kalkisMs: number): number {
  return Math.floor((kalkisMs - varisMs) / 60_000);
}

/**
 * Otobüsteyken gösterilecek sıradaki duraklar (desen içindeki sıraları). En çok `en`
 * durak; kalan daha çoksa önce ilk birkaçı, araya boşluk (-1), sonra iniş durağı.
 */
export function siradakiDuraklar(durakSayisi: number, kalanDurak: number, en = 3): number[] {
  const son = durakSayisi - 1;
  const simdiki = son - kalanDurak;
  const kalanlar: number[] = [];
  for (let i = Math.max(simdiki + 1, 0); i <= son; i++) kalanlar.push(i);
  if (kalanlar.length <= en) return kalanlar;
  return [...kalanlar.slice(0, en - 1), -1, son];
}

/**
 * Binme cümlesinin fiil kısmı: "89T otobüsüne bin", "M4 metrosuna bin". Araç tipine
 * göre ek değiştiği için hazır ifadeler; işletmeci minibüs/dolmuşsa onlarınki.
 */
export function binmeIfadesi(mode?: string | null, isletmeci?: string | null): string {
  const i = (isletmeci ?? '').toLocaleLowerCase('tr-TR');
  if (i.includes('minibus') || i.includes('minibüs')) return 'minibüsüne bin';
  if (i.includes('dolmus') || i.includes('dolmuş') || i.includes('taksi')) return 'dolmuşuna bin';
  switch ((mode ?? '').toUpperCase()) {
    case 'SUBWAY':
      return 'metrosuna bin';
    case 'TRAM':
      return 'tramvayına bin';
    case 'FERRY':
      return 'vapuruna bin';
    case 'RAIL':
      return 'trenine bin';
    case 'FUNICULAR':
      return 'füniküler hattına bin';
    case 'CABLE_CAR':
    case 'GONDOLA':
      return 'teleferiğine bin';
    case 'MONORAIL':
      return 'monoray hattına bin';
    case 'BUS':
    case 'TROLLEYBUS':
    case 'COACH':
      return 'otobüsüne bin';
    default:
      return 'hattına bin';
  }
}

/**
 * Yürürken tarifte neredeyiz.
 *
 * Telefonun konumu yürüme çizgisine izdüşürülüp çizgi boyunca kaç metre yürünmüş
 * olduğu bulunuyor; tarif adımlarının başlangıçları da adım mesafelerinin toplamından
 * geliyor (çizginin boyuna ölçeklenerek: OTP'nin adım mesafeleri ile çizginin boyu
 * birkaç metre tutmayabiliyor). Böylece "sıradaki dönüşe kaç metre" kuş uçuşu değil,
 * yürünecek yol boyunca; kıvrılan sokaklarda da doğru adım seçiliyor.
 *
 * @returns simdiki: içinde bulunulan adım; sonrakine: sıradaki manevraya (son adımda
 *   bacağın sonuna) kalan metre; rotadan: telefonun çizgiye uzaklığı (sapma).
 */
export function yuruyusKonumu(
  adimlar: { metre: number }[],
  cizgi: Nokta[],
  konum: Nokta,
): { simdiki: number; sonrakine: number; rotadan: number } | null {
  if (!adimlar.length || cizgi.length < 2) return null;
  const yer = cizgiUzerindeYer(konum, cizgi);
  const adimToplam = adimlar.reduce((t, a) => t + (a.metre || 0), 0);
  const olcek = adimToplam > 0 ? yer.toplam / adimToplam : 0;
  let bas = 0;
  const baslangiclar = adimlar.map((a) => {
    const b = bas;
    bas += (a.metre || 0) * olcek;
    return b;
  });
  let simdiki = 0;
  for (let k = 0; k < baslangiclar.length; k++) if (baslangiclar[k] <= yer.boyunca + 1) simdiki = k;
  const sonraki = simdiki + 1 < baslangiclar.length ? baslangiclar[simdiki + 1] : yer.toplam;
  return {
    simdiki,
    sonrakine: Math.max(0, Math.round(sonraki - yer.boyunca)),
    rotadan: Math.round(yer.uzaklik),
  };
}

/** Bu kadar yaklaşınca manevra "şimdi" yazılır. */
export const SIMDI_M = 15;
/** Yürüme çizgisinden bu kadar uzaklaşınca "rotadan çıktın" uyarısı. */
export const SAPMA_M = 40;

/** Kalan süre: "45 dk", "2 sa", "9 sa 50 dk". */
export function kalanSureYaz(dakika: number): string {
  const dk = Math.max(0, Math.round(dakika));
  if (dk < 60) return `${dk} dk`;
  const sa = Math.floor(dk / 60);
  const kalan = dk % 60;
  return kalan ? `${sa} sa ${kalan} dk` : `${sa} sa`;
}

/** Durağa yetişmek için en geç yola çıkış: kalkıştan yürüme süresi ve 2 dk pay düşülür. */
export function yolaCikisAni(kalkisMs: number, yurumeSn: number): number {
  return kalkisMs - yurumeSn * 1000 - 2 * 60_000;
}

// ---------------------------------------------------------------- yürüyüşü yeniden çizme
//
// Rota, aramanın yapıldığı yerden çiziliyor. Yolculuk başladığında telefon başka bir
// yerdeyse (konum aramada kabaca alınmış, ya da yolcu o arada yürümüş) ya da yürürken
// yanlış sokağa saparsa, yürüyüş bulunulan yerden aynı durağa yeniden çiziliyor.
// Binilecek hat ve durak değişmiyor; yalnız oraya yürüme yolu.

/** Yolculuğun ilk konumu yürüyüşün başından bu kadar uzaksa çizgi bulunulan yerden başlar. */
export const BASLANGIC_KAYMA_M = 15;
/** Yürürken çizgiden bu kadar uzaklaşınca yürüyüş yeniden çizilir. */
export const YENIDEN_CIZ_M = 25;
/** Bundan kötü doğruluklu konum yeniden çizdirmez: GPS kaymasıyla yol oynamasın. */
export const YENIDEN_CIZ_DOGRULUK_M = 35;
/** İki yeniden çizim arası en az bu kadar. */
export const YENIDEN_CIZ_ARA_MS = 15_000;

export type YenidenCizimGirdisi = {
  durum: YolculukDurumu | null;
  adim: Adim | undefined;
  /** Yolculuğun ilk (doğruluğu yeterli) konumu mu. */
  ilkKonum: boolean;
  konum: Nokta;
  /** Şimdiki yürüme bacağının çizgisi. */
  cizgi: Nokta[];
  /** Yürüme bacağının bittiği yer (biniş durağı ya da varış). */
  bitis: Nokta;
  dogruluk: number | null | undefined;
  simdi: number;
  /** Son yeniden çizimin zamanı; hiç çizilmediyse null. */
  sonCizim: number | null;
};

/** Yürüyüş bulunulan yerden yeniden çizilmeli mi. */
export function yenidenCizilmeli(g: YenidenCizimGirdisi): boolean {
  if (!g.durum || g.durum.faz !== 'yuru' || g.adim?.tur !== 'yuru') return false;
  if (g.dogruluk != null && g.dogruluk > YENIDEN_CIZ_DOGRULUK_M) return false;
  if (g.sonCizim != null && g.simdi - g.sonCizim < YENIDEN_CIZ_ARA_MS) return false;
  // Durağa varmak üzereyken yeni yol çizmenin anlamı yok.
  if (mesafeMetre(g.konum, g.bitis) <= VARIS_M) return false;
  if (g.cizgi.length < 2) return true;
  if (g.ilkKonum && mesafeMetre(g.konum, g.cizgi[0]) > BASLANGIC_KAYMA_M) return true;
  return cizgiyeUzaklik(g.konum, g.cizgi) > YENIDEN_CIZ_M;
}

// ---------------------------------------------------------------- durak, istasyon, iskele

export type DurakSozcugu = {
  /** "durağı", "istasyonu", "iskelesi" */
  ad: string;
  /** "durağına" */
  e: string;
  /** "durağında" */
  de: string;
  /** "durağındasın" */
  desin: string;
};

const DURAK: DurakSozcugu = { ad: 'durağı', e: 'durağına', de: 'durağında', desin: 'durağındasın' };
const ISTASYON: DurakSozcugu = { ad: 'istasyonu', e: 'istasyonuna', de: 'istasyonunda', desin: 'istasyonundasın' };
const ISKELE: DurakSozcugu = { ad: 'iskelesi', e: 'iskelesine', de: 'iskelesinde', desin: 'iskelesindesin' };

/** Aracın türüne göre bekleme yerinin adı: otobüs durağı, metro istasyonu, vapur iskelesi. */
export function durakSozcugu(mode?: string | null): DurakSozcugu {
  switch ((mode ?? '').toUpperCase()) {
    case 'SUBWAY':
    case 'MONORAIL':
    case 'RAIL':
    case 'TRAM':
    case 'FUNICULAR':
    case 'CABLE_CAR':
    case 'GONDOLA':
      return ISTASYON;
    case 'FERRY':
      return ISKELE;
    default:
      return DURAK;
  }
}
