// Uygulamanın renkleri ve metin yardımcıları.
//
// Tema telefonun sistem ayarını izler: iPhone karanlık moda geçince uygulama da geçer,
// ekranda ayrı bir düğme yoktur. Katman ileride "Sistem / Açık / Koyu" seçeneği
// eklenebilecek biçimde kuruldu; şimdilik yalnızca sistem okunuyor.
//
// Renk kuralları:
//  - Harita çizgisi hattın resmî rengini kullanır (üstünde yazı yok, okunurluk sorunu yok).
//  - Rozet yazı taşıdığı için gerektiğinde koyulaştırılmış bir sürüm kullanır:
//    M2 yeşili, M3 mavisi, M4 pembesi ve M8 mavisi beyaz yazıyla 4,5:1 eşiğini geçmiyordu.
//  - Koyu temada rozet zemini açılır, yazı koyulaşır; böylece M5'in moru kaybolmaz,
//    M9'un sarısı da göz almaz.

import { useColorScheme } from 'react-native';

import { aracAdi, hatEtiketi } from './hat-adi';
import { baslikYap, hatAnahtari, metrobusMu, trBuyuk, trKucuk, yonYaz } from './metin';
import { karistir, okunurYap } from './renk';

// Metin ve hat kodu yardımcıları ayrı, bağımlılıksız bir dosyada durur (test edilebilsin diye);
// çağrı yerleri değişmesin diye buradan da açılıyor.
export { baslikYap, hatAnahtari, metrobusMu, trBuyuk, trKucuk, yonYaz };
export { aracAdi, aracModu, hatEtiketi } from './hat-adi';

export type Tema = {
  koyu: boolean;
  zemin: string;
  yuzey: string;
  yuzeyIkincil: string;
  yazi: string;
  soluk: string;
  cizgi: string;
  cizgiSilik: string;
  vurgu: string;
  vurguAcik: string;
  vurguYazi: string;
  metrobus: string;
  yurume: string;
  konum: string;
  hata: string;
  hataAcik: string;
  uyari: string;
  uyariAcik: string;
  haritaZemin: string;
  haritaStili: 'light' | 'dark';
};

export const TEMA_ACIK: Tema = {
  koyu: false,
  zemin: '#f4f6f3',
  yuzey: '#ffffff',
  yuzeyIkincil: '#fafbfa',
  yazi: '#14201b',
  soluk: '#66756e',
  cizgi: '#e3e8e4',
  cizgiSilik: '#f0f3f1',
  vurgu: '#0a7b74',
  vurguAcik: '#e6f3f1',
  vurguYazi: '#ffffff',
  metrobus: '#d71a28',
  yurume: '#8c9993',
  konum: '#2a7df0',
  hata: '#b3261e',
  hataAcik: '#fbe9e7',
  uyari: '#a35b12',
  uyariAcik: '#fdf3e8',
  haritaZemin: '#e6ebe7',
  haritaStili: 'light',
};

export const TEMA_KOYU: Tema = {
  koyu: true,
  zemin: '#0e1412',
  yuzey: '#161e1b',
  yuzeyIkincil: '#1b2421',
  yazi: '#e9f0ec',
  soluk: '#8fa099',
  cizgi: '#25302c',
  cizgiSilik: '#1e2825',
  vurgu: '#3ab9ab',
  vurguAcik: '#123330',
  vurguYazi: '#0e1412',
  metrobus: '#ff6b62',
  yurume: '#7d8b85',
  konum: '#5c9dfb',
  hata: '#ff8a80',
  hataAcik: '#33201e',
  uyari: '#f0b95e',
  uyariAcik: '#2e2411',
  haritaZemin: '#141b19',
  haritaStili: 'dark',
};

/** Sistem temasını izler. Kullanıcı telefonun ayarını değiştirdiğinde uygulama anında döner. */
export function useTema(): Tema {
  return useColorScheme() === 'dark' ? TEMA_KOYU : TEMA_ACIK;
}

// ---------- Hat renkleri ----------

/** Haritada çizilen resmî hat renkleri (ağ haritasındaki hâlleri). */
const HARITA_RENKLERI: Record<string, string> = {
  M1A: '#e2261c',
  M1B: '#e2261c',
  M2: '#019a44',
  M2A: '#019a44',
  M3: '#05a8e2',
  M4: '#e72177',
  M5: '#693064',
  M6: '#cbaa77',
  M7: '#f39ec0',
  M8: '#447abe',
  M9: '#ffd300',
  M11: '#ab548f',
  MARMARAY: '#00529b',
  T1: '#0075c9',
  T2: '#92aaa0',
  T3: '#00a3a1',
  T4: '#a6093d',
  T5: '#5c7f3a',
  T6: '#e47a7b',
  F1: '#7d8b99',
  F2: '#7d8b99',
  F3: '#7d8b99',
  F4: '#7d8b99',
  TF1: '#5e8c31',
  TF2: '#5e8c31',
};

/** Açık temada rozet renkleri: yazı okunsun diye bazıları koyulaştırıldı. */
const ROZET_ACIK: Record<string, string> = {
  ...HARITA_RENKLERI,
  M2: '#018a3d',
  M2A: '#018a3d',
  M3: '#0b7fac',
  M4: '#de1c72',
  M8: '#3c6ea9',
  T2: '#6a8479',
  T6: '#c9504f',
  F1: '#63707c',
  F2: '#63707c',
  F3: '#63707c',
  F4: '#63707c',
  TF1: '#4e7526',
  TF2: '#4e7526',
};

/** Koyu temada rozet renkleri: zemin açılır, yazı koyulaşır. */
const ROZET_KOYU: Record<string, string> = {
  M1A: '#ff6b60',
  M1B: '#ff6b60',
  M2: '#3cc274',
  M2A: '#3cc274',
  M3: '#4fc3f0',
  M4: '#ff6faa',
  M5: '#b671b1',
  M6: '#d9bc90',
  M7: '#f7b7d2',
  M8: '#7ea9de',
  M9: '#ffd935',
  M11: '#d98ac0',
  MARMARAY: '#5a9ad8',
  T1: '#4d9fe0',
  T3: '#45c4c1',
  T4: '#e0728f',
  T5: '#93b96a',
  T2: '#b3c7bf',
  T6: '#f0a0a1',
  F1: '#9aa8b5',
  F2: '#9aa8b5',
  F3: '#9aa8b5',
  F4: '#9aa8b5',
  TF1: '#8db357',
  TF2: '#8db357',
};

/** Hat kodu bilinmeyen raylı sistem ve vapur hatları için araç tipinin rengi. */
const MOD_RENKLERI_ACIK: Record<string, string> = {
  FERRY: '#1c6ba0',
  RAIL: '#00529b',
  SUBWAY: '#3b5ba9',
  TRAM: '#0075c9',
  FUNICULAR: '#63707c',
  CABLE_CAR: '#4e7526',
  GONDOLA: '#4e7526',
  MONORAIL: '#3b5ba9',
};

const MOD_RENKLERI_KOYU: Record<string, string> = {
  FERRY: '#52a0d6',
  RAIL: '#5a9ad8',
  SUBWAY: '#7e9ae8',
  TRAM: '#4d9fe0',
  FUNICULAR: '#9aa8b5',
  CABLE_CAR: '#8db357',
  GONDOLA: '#8db357',
  MONORAIL: '#7e9ae8',
};

// Otobüs hatları numaralarından üretilen sabit bir renk alır.
const HAT_RENKLERI_ACIK = ['#2456c8', '#178a4c', '#d9660f', '#7443b8', '#0f7fa6', '#b0406e'];
const HAT_RENKLERI_KOYU = ['#6f93ea', '#3cc274', '#f0913f', '#a884e0', '#4fb0d8', '#e07fa4'];

const MOD_SIMGELERI: Record<string, string> = {
  BUS: 'bus',
  TROLLEYBUS: 'bus',
  COACH: 'bus',
  SUBWAY: 'subway',
  RAIL: 'train',
  MONORAIL: 'train',
  TRAM: 'train',
  FERRY: 'boat',
  FUNICULAR: 'trending-up',
  CABLE_CAR: 'trending-up',
  GONDOLA: 'trending-up',
  WALK: 'walk',
  BICYCLE: 'bicycle',
  CAR: 'car',
  TAXI: 'car',
};


/** Rota motorundan gelen hat bilgisi; ekranlarda yalnızca kısa ad da geçilebilir. */
export type HatBilgisi =
  | { shortName?: string | null; color?: string | null; textColor?: string | null; mode?: string | null }
  | string
  | null
  | undefined;

function hatAyikla(hat: HatBilgisi) {
  if (typeof hat === 'string') return { shortName: hat, color: null, textColor: null, mode: null };
  return {
    shortName: hat?.shortName ?? null,
    color: hat?.color ?? null,
    textColor: hat?.textColor ?? null,
    mode: hat?.mode ?? null,
  };
}

/** GTFS rengi "E2261C" biçiminde, diyez olmadan gelir. Geçersiz değerler yok sayılır. */
function renkKoduDuzelt(kod?: string | null): string | null {
  const temiz = (kod ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(temiz) ? `#${temiz.toLowerCase()}` : null;
}



function hashRengi(kisaAd: string, tema: Tema): string {
  const palet = tema.koyu ? HAT_RENKLERI_KOYU : HAT_RENKLERI_ACIK;
  let ozet = 0;
  for (const harf of kisaAd) ozet = (ozet * 31 + (harf.codePointAt(0) ?? 0)) >>> 0;
  return palet[ozet % palet.length];
}

/**
 * Rozetin zemin rengi. Sırasıyla: bilinen hat kodu tablosu, Metrobüs kırmızısı,
 * veriden gelen renk, araç tipinin rengi, en son hat kodundan üretilen sabit renk.
 *
 * Bilinen hat tablosu veriden gelen renge göre önceliklidir: İBB verisinde hat renkleri
 * boş, ama bir gün dolarsa da kontrast düzeltmesi yapılmış sürümü tercih ederiz.
 */
export function hatRengi(hat: HatBilgisi, tema: Tema): string {
  const { shortName, color, mode } = hatAyikla(hat);
  const kisaAd = shortName?.trim();
  if (kisaAd) {
    const tablo = tema.koyu ? ROZET_KOYU : ROZET_ACIK;
    const bilinen = tablo[hatAnahtari(kisaAd)];
    if (bilinen) return bilinen;
    if (metrobusMu(kisaAd)) return tema.metrobus;
  }
  const veriden = renkKoduDuzelt(color);
  if (veriden) return veriden;
  const modTablo = tema.koyu ? MOD_RENKLERI_KOYU : MOD_RENKLERI_ACIK;
  const modRengi = modTablo[(mode ?? '').toUpperCase()];
  if (modRengi) return modRengi;
  return kisaAd ? hashRengi(kisaAd, tema) : tema.soluk;
}

/** Haritadaki çizginin rengi: her zaman hattın resmî rengi, tema ne olursa olsun. */
export function haritaRengi(hat: HatBilgisi, tema: Tema): string {
  const { shortName } = hatAyikla(hat);
  const kisaAd = shortName?.trim();
  if (kisaAd) {
    const resmi = HARITA_RENKLERI[hatAnahtari(kisaAd)];
    if (resmi) return resmi;
  }
  return hatRengi(hat, tema);
}

/**
 * Renkli zemin üzerinde okunur bir yazı rengi seçer.
 * M9 sarısı (#ffd300) ya da M7 pembesi (#f39ec0) üzerinde beyaz yazı okunmuyor.
 */
export function yaziRengi(zeminRengi: string): string {
  const kod = renkKoduDuzelt(zeminRengi);
  if (!kod) return '#ffffff';
  const kanal = (baslangic: number) => {
    const oran = parseInt(kod.slice(baslangic, baslangic + 2), 16) / 255;
    return oran <= 0.03928 ? oran / 12.92 : ((oran + 0.055) / 1.055) ** 2.4;
  };
  const parlaklik = 0.2126 * kanal(1) + 0.7152 * kanal(3) + 0.0722 * kanal(5);
  return parlaklik > 0.42 ? '#14201b' : '#ffffff';
}

/** Rozetteki yazı rengi. */
export function hatYaziRengi(hat: HatBilgisi, tema: Tema): string {
  return yaziRengi(hatRengi(hat, tema));
}

/**
 * Rozetin dört rengi.
 *
 * Tasarım: renk küçük bir simge kutusunda yoğunlaşıyor, yazı ise sakin bir zeminde
 * duruyor. Rozetlerin yan yana dizildiği yerlerde (rota kartındaki bacak zinciri,
 * durak ekranındaki hat listesi) her rozeti dolu renk yapmak satırı rengârenk bir
 * şeride çeviriyor ve hiçbir hat öne çıkmıyordu.
 *
 * Zemin ve yazı hat renginden türetiliyor; yazı WCAG AA eşiğini geçene kadar
 * koyulaştırılıyor (ya da koyu temada açılıyor), böylece yeni bir hat eklendiğinde
 * okunurluk kendiliğinden sağlanıyor.
 */
export function rozetRenkleri(hat: HatBilgisi, tema: Tema) {
  const renk = hatRengi(hat, tema);
  const zemin = tema.koyu ? karistir(renk, tema.yuzey, 0.84) : karistir(renk, '#ffffff', 0.86);
  const hamYazi = tema.koyu ? karistir(renk, '#ffffff', 0.25) : karistir(renk, '#000000', 0.2);
  return {
    kutu: renk,
    kutuYazi: yaziRengi(renk),
    zemin,
    yazi: okunurYap(hamYazi, zemin),
  };
}


/** Araç tipine karşılık gelen Ionicons simgesinin adı. */
export function aracSimgesi(mode?: string | null): string | null {
  return MOD_SIMGELERI[(mode ?? '').toUpperCase()] ?? null;
}


/** Otobüs dışındaki raylı sistem ve vapur hatlarını ayırt etmek için. */
export function rayliVeyaVapurMu(mode?: string | null): boolean {
  return ['SUBWAY', 'RAIL', 'TRAM', 'FERRY', 'FUNICULAR', 'CABLE_CAR', 'GONDOLA', 'MONORAIL'].includes(
    (mode ?? '').toUpperCase(),
  );
}
