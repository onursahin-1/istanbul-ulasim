// İstanbulkart ücret hesabı.
//
// Kaynak: İBB Toplu Ulaşım Hizmetleri Müdürlüğü'nün 20.07.2026'dan itibaren geçerli
// resmî tarifesi (tuhim.ibb.gov.tr → İstanbulkart ücret tarifesi PDF'i).
//
// Hesabın üç kuralı var:
//   1. İlk binişte tam bilet, sonraki her binişte aktarma bedeli ödenir. Aktarma
//      kademeleri 3'ten sonra sabitlenir.
//   2. Aktarma hakkı ilk binişten itibaren 120 dakika sürer. Süre dolduktan sonraki
//      biniş yeni bir yolculuk sayılır ve merdiven baştan başlar.
//   3. Metrobüs, Marmaray ve M11 mesafeye göre ücretlendirilir; bu hatlarda aktarma
//      indirimi, tam biletle aktarma bedeli arasındaki fark kadar düşülür.
//
// Tutarlar kuruş cinsinden tam sayı tutulur: 46,20 ₺ = 4620. Böylece toplama sırasında
// ondalık yuvarlama hatası birikmez.

import { bacakDuraklari } from './bacak';
import { metrobusMu } from './metin';
import type { Bacak } from './otp';

export type UcretTuru = 'tam' | 'ogrenci' | 'indirimli' | 'ogrenci30';

export const UCRET_ADLARI: Record<UcretTuru, string> = {
  tam: 'Tam',
  ogrenci: 'Öğrenci',
  indirimli: 'İndirimli',
  ogrenci30: '30+ Öğrenci',
};

export const UCRET_ACIKLAMALARI: Record<UcretTuru, string> = {
  tam: 'Tam biletli İstanbulkart',
  ogrenci: 'Öğrenci İstanbulkart',
  indirimli: 'Öğretmen, 60–65 yaş ve diğer indirimli kartlar',
  ogrenci30: 'Aylık 30 binişini dolduran öğrenci kartı',
};

/** Tarifenin yürürlük tarihi; Ayarlar ekranında gösterilir. */
export const TARIFE_TARIHI = '20 Temmuz 2026';

// ---------- tarife ----------

const ILK_BINIS: Record<UcretTuru, number> = { tam: 4620, ogrenci: 2255, indirimli: 3308, ogrenci30: 4158 };

/** 1., 2., 3., 4. ve 5. aktarma bedelleri. 5'ten sonrası da bu değerde kalır. */
const AKTARMA: Record<UcretTuru, number[]> = {
  tam: [3440, 2642, 1718, 1718, 1718],
  ogrenci: [1121, 1062, 926, 926, 926],
  indirimli: [2116, 1650, 1121, 1121, 1121],
  ogrenci30: [3096, 2378, 1546, 1546, 1546],
};

/** [en az durak, en çok durak, tam, öğrenci] */
type Kademe = [number, number, number, number];

const METROBUS: Kademe[] = [
  [1, 1, 3308, 1458],
  [2, 2, 3957, 1587],
  [3, 3, 4620, 1848],
  [4, 9, 5281, 2109],
  [10, 15, 5800, 2255],
  [16, 21, 6069, 2255],
  [22, 27, 6267, 2255],
  [28, 33, 6403, 2255],
  [34, Infinity, 6859, 2255],
];

const MARMARAY: Kademe[] = [
  [1, 7, 3740, 1813],
  [8, 14, 4774, 2232],
  [15, 21, 5511, 2658],
  [22, 28, 6356, 3023],
  [29, 35, 7424, 3553],
  [36, Infinity, 8217, 3713],
];

const M11: Kademe[] = [
  [1, 3, 3740, 1813],
  [4, 6, 4234, 2080],
  [7, 8, 4789, 2339],
  [9, 10, 5374, 2597],
  [11, 12, 5990, 2855],
  [13, 14, 6639, 3113],
  [15, Infinity, 7319, 3372],
];

/** Şehir Hatları ücreti hatta göre değişir; elimizdeki temsilî değerler. */
const VAPUR_TEMSILI = { tam: 5852, ogrenci: 2844 };
const VAPUR_ADALAR = { tam: 15123, ogrenci: 15123 };

/** Aktarma hakkının süresi. */
const AKTARMA_PENCERESI_DK = 120;

/** Gece tarifesi (çift ücret) bu saatler arasında uygulanır. */
const GECE_BASLANGIC = 30; // 00:30, gün başından dakika
const GECE_BITIS = 330; // 05:30

// ---------- yardımcılar ----------

function kademeBul(tablo: Kademe[], durak: number, tur: UcretTuru): number {
  const n = Math.max(1, durak);
  const satir = tablo.find(([az, cok]) => n >= az && n <= cok) ?? tablo[tablo.length - 1];
  const [, , tam, ogrenci] = satir;
  if (tur === 'tam') return tam;
  if (tur === 'ogrenci') return ogrenci;
  // İndirimli ve 30+ öğrenci için mesafeli tablo yayımlanmıyor; tam bilete oranla ölçekleniyor.
  return Math.round((tam * ILK_BINIS[tur]) / ILK_BINIS.tam);
}

function aktarmaBedeli(tur: UcretTuru, sira: number): number {
  const merdiven = AKTARMA[tur];
  return merdiven[Math.min(sira - 1, merdiven.length - 1)];
}

function dakikaninSaati(iso?: string | null): number | null {
  const e = (iso ?? '').match(/T(\d{2}):(\d{2})/);
  return e ? Number(e[1]) * 60 + Number(e[2]) : null;
}

function geceMi(iso?: string | null): boolean {
  const d = dakikaninSaati(iso);
  return d != null && d >= GECE_BASLANGIC && d < GECE_BITIS;
}

function adalarMi(bacak: Bacak): boolean {
  const metin = `${bacak.headsign ?? ''} ${bacak.to.name ?? ''} ${bacak.from.name ?? ''}`.toLocaleLowerCase('tr-TR');
  return /(büyükada|heybeliada|burgazada|kınalıada|adalar)/.test(metin);
}

// ---------- sonuç ----------

export type BacakUcreti = {
  /** Kuruş. */
  tutar: number;
  /** 0 = ilk biniş, 1 = 1. aktarma… */
  sira: number;
  etiket: string;
  /** Mesafeli tarife ya da vapur gibi kesin olmayan bir hesapsa true. */
  yaklasik: boolean;
  /** "Metrobüs · 12 durak" gibi kısa gerekçe. */
  aciklama: string;
};

export type YolculukUcreti = {
  /** Kuruş. */
  toplam: number;
  /** Güzergâhın bacaklarıyla aynı sırada; yürüme bacakları için null. */
  bacaklar: (BacakUcreti | null)[];
  /** Tutarın en az bir kalemi tahminse true. */
  yaklasik: boolean;
  geceTarifesi: boolean;
  /** Aktarma penceresi dolduğu için ücretin baştan başladığı biniş sayısı. */
  yeniYolculuk: number;
};

/** Bacağın hangi tarifeye girdiğini belirler. */
function tarifeSec(bacak: Bacak): 'metrobus' | 'marmaray' | 'm11' | 'vapur' | 'normal' {
  const kisa = bacak.route?.shortName?.trim() ?? '';
  const mod = (bacak.route?.mode ?? bacak.mode ?? '').toUpperCase();
  if (metrobusMu(kisa)) return 'metrobus';
  if (kisa.toUpperCase() === 'M11') return 'm11';
  if (mod === 'RAIL') return 'marmaray';
  if (mod === 'FERRY') return 'vapur';
  return 'normal';
}

/**
 * Bir güzergâhın İstanbulkart ücretini hesaplar.
 * Yürüme bacakları atlanır, toplu taşıma bacakları sırayla ücretlendirilir.
 */
export function yolculukUcreti(bacaklar: Bacak[], tur: UcretTuru): YolculukUcreti {
  const sonuc: (BacakUcreti | null)[] = [];
  let toplam = 0;
  let sira = 0;
  let pencereBasi: number | null = null;
  let yaklasik = false;
  let gece = false;
  let yeniYolculuk = 0;

  for (const bacak of bacaklar) {
    if (!bacak.transitLeg) {
      sonuc.push(null);
      continue;
    }

    const binisIso = bacak.start.estimated?.time ?? bacak.start.scheduledTime;
    const binisAn = Date.parse(binisIso ?? '');

    // Aktarma penceresi dolduysa merdiven baştan başlar.
    if (pencereBasi != null && !Number.isNaN(binisAn) && binisAn - pencereBasi > AKTARMA_PENCERESI_DK * 60_000) {
      sira = 0;
      pencereBasi = binisAn;
      yeniYolculuk += 1;
    } else if (pencereBasi == null && !Number.isNaN(binisAn)) {
      pencereBasi = binisAn;
    }

    const tarife = tarifeSec(bacak);
    const durakSayisi = Math.max(1, bacakDuraklari(bacak).length - 1);
    const indirim = sira === 0 ? 0 : ILK_BINIS[tur] - aktarmaBedeli(tur, sira);

    let taban: number;
    let aciklama: string;
    let bacakYaklasik = false;

    if (tarife === 'metrobus') {
      taban = kademeBul(METROBUS, durakSayisi, tur);
      aciklama = `Metrobüs · ${durakSayisi} durak`;
      bacakYaklasik = tur === 'indirimli' || tur === 'ogrenci30';
    } else if (tarife === 'marmaray') {
      taban = kademeBul(MARMARAY, durakSayisi, tur);
      aciklama = `Marmaray · ${durakSayisi} istasyon`;
      bacakYaklasik = tur === 'indirimli' || tur === 'ogrenci30';
    } else if (tarife === 'm11') {
      taban = kademeBul(M11, durakSayisi, tur);
      aciklama = `M11 · ${durakSayisi} istasyon`;
      bacakYaklasik = tur === 'indirimli' || tur === 'ogrenci30';
    } else if (tarife === 'vapur') {
      const ada = adalarMi(bacak);
      const tablo = ada ? VAPUR_ADALAR : VAPUR_TEMSILI;
      const temel = tur === 'ogrenci' ? tablo.ogrenci : tablo.tam;
      taban = tur === 'tam' || tur === 'ogrenci' ? temel : Math.round((tablo.tam * ILK_BINIS[tur]) / ILK_BINIS.tam);
      aciklama = ada ? 'Adalar vapuru' : 'Vapur · hatta göre değişir';
      bacakYaklasik = true;
    } else {
      taban = sira === 0 ? ILK_BINIS[tur] : aktarmaBedeli(tur, sira);
      aciklama = sira === 0 ? 'İlk biniş' : `${sira}. aktarma`;
    }

    // Mesafeli hatlarda gerekçe iki parçalı: kademe + varsa aktarma indirimi.
    if (tarife !== 'normal' && sira > 0) aciklama += ` · ${sira}. aktarma indirimi`;

    let tutar = tarife === 'normal' ? taban : Math.max(0, taban - indirim);
    if (geceMi(binisIso)) {
      tutar *= 2;
      gece = true;
    }

    toplam += tutar;
    yaklasik = yaklasik || bacakYaklasik;
    sonuc.push({
      tutar,
      sira,
      etiket: sira === 0 ? 'İlk biniş' : `${sira}. aktarma`,
      yaklasik: bacakYaklasik,
      aciklama,
    });
    sira += 1;
  }

  return { toplam, bacaklar: sonuc, yaklasik, geceTarifesi: gece, yeniYolculuk };
}

// ---------- gösterim ----------

/** 4620 → "46,20 ₺" */
export function ucretYaz(kurus: number): string {
  return `${(kurus / 100).toFixed(2).replace('.', ',')} ₺`;
}

/** Kart üstünde yer az: "46,20 ₺" ya da tahminse "≈46,20 ₺". */
export function ucretKisa(ucret: YolculukUcreti): string {
  if (ucret.toplam === 0) return 'Ücretsiz';
  return `${ucret.yaklasik ? '≈' : ''}${ucretYaz(ucret.toplam)}`;
}
