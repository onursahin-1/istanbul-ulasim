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

/**
 * Resmî hat renkleri. Metro İstanbul'un işlettiği hatlar metro.istanbul'daki hat
 * rozetlerinin kendi renkleri (2026-09); T2, T6, M11 ve F2/F3 için OSM'deki hat rengi,
 * Marmaray için TCDD mavisi. Haritadaki çizgiler ve raylı hat rozetleri bunları kullanır.
 */
const HARITA_RENKLERI: Record<string, string> = {
  M1A: '#ee3124',
  M1B: '#ee3124',
  M2: '#009944',
  M2A: '#009944',
  M3: '#00a8e1',
  M4: '#e91e76',
  M5: '#683064',
  M6: '#caa977',
  M7: '#f89aba',
  M8: '#447abe',
  M9: '#f0e514',
  M11: '#ab548f',
  MARMARAY: '#00529b',
  T1: '#004f7d',
  T2: '#92aaa0',
  T3: '#a86528',
  T4: '#f47e46',
  T5: '#7c72b3',
  T6: '#e47a7b',
  F1: '#7c7358',
  F2: '#7c7358',
  F3: '#7c7358',
  F4: '#7c7358',
  TF1: '#68bcb0',
  TF2: '#68bcb0',
};

/** Açık temada hat rengi (çizgiler, şeritler, işaretler): resmî renkler. */
const ROZET_ACIK: Record<string, string> = { ...HARITA_RENKLERI };

/** Koyu temada hat rengi: koyu zeminde seçilsin diye resmî rengin açılmış hâli. */
const ROZET_KOYU: Record<string, string> = {
  M1A: '#ff6b60',
  M1B: '#ff6b60',
  M2: '#3cc274',
  M2A: '#3cc274',
  M3: '#3fc0ec',
  M4: '#ff6faa',
  M5: '#b671b1',
  M6: '#d9bc90',
  M7: '#fab3cb',
  M8: '#7ea9de',
  M9: '#f5ec4a',
  M11: '#d98ac0',
  MARMARAY: '#5a9ad8',
  T1: '#4c9bd0',
  T2: '#b3c7bf',
  T3: '#d08e53',
  T4: '#f7925f',
  T5: '#a49ddb',
  T6: '#f0a0a1',
  F1: '#b3aa8a',
  F2: '#b3aa8a',
  F3: '#b3aa8a',
  F4: '#b3aa8a',
  TF1: '#8fd1c7',
  TF2: '#8fd1c7',
};

/**
 * Resmî rozeti daire olan raylı hatlar (metro.istanbul'daki gibi: hat renginde daire,
 * içinde kod). Açık renkli zeminlerde yazı koyu: resmî rozette beyaz ama M9 sarısında,
 * M6 bejinde, M7 pembesinde okunmuyor.
 */
const DAIRE_ROZETLI = new Set(Object.keys(HARITA_RENKLERI).filter((k) => k !== 'MARMARAY'));
const KOYU_YAZILI = new Set(['M6', 'M7', 'M9', 'TF1', 'TF2', 'T2']);

/**
 * Hattın resmî daire rozeti; yoksa (otobüs, Marmaray, vapur) null. Otobüs olarak
 * işaretli bir hat kısa adı "T1" olsa bile daire almaz.
 */
export function resmiRozet(hat: HatBilgisi): { renk: string; yazi: string; kod: string } | null {
  const { shortName, mode } = hatAyikla(hat);
  const kod = hatAnahtari(shortName?.trim() ?? '');
  if (!kod || !DAIRE_ROZETLI.has(kod)) return null;
  if (['BUS', 'TROLLEYBUS', 'COACH', 'FERRY'].includes((mode ?? '').toUpperCase())) return null;
  return { renk: HARITA_RENKLERI[kod], yazi: KOYU_YAZILI.has(kod) ? '#1b1b1b' : '#ffffff', kod };
}

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
