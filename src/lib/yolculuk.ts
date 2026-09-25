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
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { cizgiUzerindeYer, mesafeMetre, type Nokta } from './cografya';

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
      const kalan = liste.length - 1 - y.sira;
      return { adim: bakilacak, faz: 'icinde', kalanDurak: kalan, durakta: kalan === 0 };
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
    const y = enYakinDurak(konum, bacak.duraklar);
    if (y.sira < 0 || y.metre > DURAK_M) return d;
    // Kalan durak yalnız azalır: halka hatlarda ya da GPS kayınca geri sayılmasın.
    const kalan = Math.min(d.kalanDurak ?? Infinity, son - y.sira);
    if (kalan === d.kalanDurak && d.durakta === (kalan === 0)) return d;
    return { ...d, kalanDurak: kalan, durakta: kalan === 0 };
  }

  return d;
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
