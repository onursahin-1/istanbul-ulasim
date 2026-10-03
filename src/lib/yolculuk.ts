// Canlı yol tarifi: yolculuğun adımları ve konuma göre hangi adımda olunduğu.
//
// "Yolculuğu başlat"tan sonra ekran adım adım moduna geçiyor: her bacak bir kart
// (yürü, bin/otobüste, aktarma, varışa yürü). Burada o kartların listesi ve telefonun
// konumuna bakarak sıradaki karta ne zaman geçileceği hesaplanıyor.
//
// Kurallar (yalnız ileri gidilir, konum titremesi geri götürmez):
//   • Yürüme adımı: bacağın sonuna 50 m kalınca bitti. Sonraki adım araçsa "bekle".
//   • Bekleme: telefon hattın biniş durağından sonraki bir durağa yaklaşınca "içinde".
//     (Otobüs hareket etmeden binildiğini ayırt edemeyiz; ilk durak geçilince anlaşılıyor.)
//   • İçinde: en yakın durağa göre kalan durak; iniş durağına varıp oradan 60 m
//     uzaklaşınca bitti.
//   • Arada konum gelmemişse (tünel, uyku): telefon sıradaki araç bacağının durakları
//     üzerindeyse doğrudan o adıma atlanır.
//   • Araçta duraklar arası kesirli ilerleme tutuluyor (1.4 = 2. duraktan %40 ileride):
//     durak listesindeki mavi nokta duraktan durağa kayarak ilerlesin. Taze GPS varsa
//     konum duraklar çizgisine izdüşürülüyor; yoksa (metro tüneli) ilerleme biniş ve
//     iniş saatinden, duraklar arası mesafeye göre tahmin ediliyor (durumuZamanla).
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { cizgiUzerindeYer, cizgiyeUzaklik, mesafeMetre, type Nokta } from './cografya';

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
 * sayılıyor, konum en yakın parçaya izdüşürülüyor. Çizgiden DURAK_M'den uzaksa null.
 */
export function konumlaIlerleme(duraklar: Nokta[], konum: Nokta): number | null {
  let enIyi: { sira: number; uzaklik: number } | null = null;
  for (let k = 0; k + 1 < duraklar.length; k++) {
    const yer = cizgiUzerindeYer(konum, [duraklar[k], duraklar[k + 1]]);
    const sira = k + (yer.toplam > 0 ? yer.boyunca / yer.toplam : 0);
    if (!enIyi || yer.uzaklik < enIyi.uzaklik) enIyi = { sira, uzaklik: yer.uzaklik };
  }
  return enIyi && enIyi.uzaklik <= DURAK_M ? enIyi.sira : null;
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

/** Telefonun yeni konumuna göre durumu ilerletir. Durum değişmediyse aynı nesneyi döner. */
export function durumuIlerlet(
  d: YolculukDurumu,
  konum: Nokta,
  adimlar: Adim[],
  bacaklar: BacakOzeti[],
): YolculukDurumu {
  if (d.faz === 'vardi' || !adimlar[d.adim]) return d;

  // Sıradaki araç adımının (şimdiki de olabilir) biniş sonrası duraklarındaysak oraya atla.
  const bakilacak = adimlar.findIndex((a, i) => i >= d.adim && a.tur === 'arac' && !(i === d.adim && d.faz === 'icinde'));
  if (bakilacak >= 0) {
    const liste = bacaklar[adimlar[bakilacak].bacak]?.duraklar ?? [];
    const y = enYakinDurak(konum, liste);
    if (y.sira >= 1 && y.metre <= DURAK_M) {
      const son = liste.length - 1;
      const giris: YolculukDurumu = { adim: bakilacak, faz: 'icinde', kalanDurak: null, durakta: false };
      return ilerlemeyiYaz(giris, konumlaIlerleme(liste, konum) ?? y.sira, son);
    }
  }

  const bacak = bacaklar[adimlar[d.adim].bacak];
  if (!bacak) return d;

  if (d.faz === 'yuru') {
    return mesafeMetre(konum, bacak.bitis) <= VARIS_M ? sonrakiAdim(d, adimlar) : d;
  }

  if (d.faz === 'icinde') {
    const son = bacak.duraklar.length - 1;
    const inis = bacak.duraklar[son];
    if (d.durakta && inis && mesafeMetre(konum, inis) > AYRILMA_M) return sonrakiAdim(d, adimlar);
    // İlerleme ve kalan durak yalnız artar/azalır: halka hatlarda ya da GPS kayınca geri gitmesin.
    const yeni = konumlaIlerleme(bacak.duraklar, konum);
    return yeni == null ? d : ilerlemeyiYaz(d, yeni, son);
  }

  return d;
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
  gps: { an: number; dogruluk?: number | null } | null,
): YolculukDurumu {
  const a = adimlar[d.adim];
  if (!a || a.tur !== 'arac' || (d.faz !== 'bekle' && d.faz !== 'icinde')) return d;
  const b = bacaklar[a.bacak];
  if (!b || b.binisMs == null || b.inisMs == null || b.duraklar.length < 2) return d;
  const son = b.duraklar.length - 1;
  const gpsTaze =
    gps != null && simdi - gps.an <= GPS_TAZE_MS && (gps.dogruluk == null || gps.dogruluk <= GPS_TAZE_DOGRULUK_M);
  if (gpsTaze) return d;
  if (d.faz === 'bekle') {
    if (simdi < b.binisMs + KALKIS_PAYI_MS) return d;
    const giris: YolculukDurumu = { ...d, faz: 'icinde', kalanDurak: null, durakta: false };
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
