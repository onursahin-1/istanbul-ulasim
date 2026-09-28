// Vasıta türü tercihleri: Ayarlar'da kapatılan türler rotalarda geri planda kalır.
//
// Anlamı Moovit'teki gibi "öncelik", yasak değil. Kapalı tür iki yerde geri itiliyor:
//   1. Rota motoru (OTP): o türün araç kipi pahalı sayılıyor (isteksizlik), böylece
//      kapalı türü kullanmayan seçenekler de aramadan çıkıyor.
//   2. Liste sırası: kapalı türü kullanmayan makul bir rota varsa kapalı türlülerin önüne
//      geçiyor. Makul yoksa (adalara vapursuz yol yok) kapalı türlü rota yine gösteriliyor;
//      "rota bulunamadı" hiç olmuyor.
//
// Metrobüs, minibüs ve dolmuş OTP'de otobüsle aynı kip (BUS). Motor onları ayıramıyor;
// ayrım liste sırasında, hattın kodu ve işletmecisiyle yapılıyor.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

import { isletmeciAdi } from './hat-adi';
import { metrobusMu } from './metin';

export type VasitaTuru = 'otobus' | 'metrobus' | 'metro' | 'marmaray' | 'tramvay' | 'funikuler' | 'minibus' | 'vapur';

/** Ayarlar'daki sıra. */
export const VASITA_TURLERI: VasitaTuru[] = [
  'otobus',
  'metrobus',
  'metro',
  'marmaray',
  'tramvay',
  'funikuler',
  'minibus',
  'vapur',
];

export const VASITA_ADLARI: Record<VasitaTuru, string> = {
  otobus: 'Otobüs',
  metrobus: 'Metrobüs',
  metro: 'Metro',
  marmaray: 'Marmaray',
  tramvay: 'Tramvay',
  funikuler: 'Füniküler ve teleferik',
  minibus: 'Minibüs / Dolmuş',
  vapur: 'Vapur',
};

/** Diskten okunan listeyi temizler: bilinmeyenler ve tekrarlar atılır; hepsi kapalı olamaz. */
export function kapaliTurleriDuzelt(ham: unknown): VasitaTuru[] {
  if (!Array.isArray(ham)) return [];
  const temiz = VASITA_TURLERI.filter((t) => ham.includes(t));
  return temiz.length >= VASITA_TURLERI.length ? [] : temiz;
}

/** Bir türü açıp kapatır. Son açık tür kapatılamaz: liste değişmeden döner. */
export function turuDegistir(kapali: VasitaTuru[], tur: VasitaTuru, acik: boolean): VasitaTuru[] {
  const yeni = acik ? kapali.filter((t) => t !== tur) : kapali.includes(tur) ? kapali : [...kapali, tur];
  return yeni.length >= VASITA_TURLERI.length ? kapali : VASITA_TURLERI.filter((t) => yeni.includes(t));
}

type Bacak = {
  mode?: string | null;
  transitLeg?: boolean | null;
  route?: { shortName?: string | null; agency?: { name?: string | null } | null } | null;
};

/** Bir yolculuk bacağının vasıta türü; yürüme ve bilinmeyen kip için null. */
export function bacakTuru(b: Bacak): VasitaTuru | null {
  if (b.transitLeg === false) return null;
  switch ((b.mode ?? '').toUpperCase()) {
    case 'SUBWAY':
    case 'MONORAIL':
      return 'metro';
    case 'RAIL':
      return 'marmaray';
    case 'TRAM':
      return 'tramvay';
    case 'FUNICULAR':
    case 'GONDOLA':
    case 'CABLE_CAR':
      return 'funikuler';
    case 'FERRY':
      return 'vapur';
    case 'BUS':
    case 'TROLLEYBUS':
    case 'COACH':
      if (metrobusMu(b.route?.shortName)) return 'metrobus';
      if (isletmeciAdi(b.route?.agency?.name)) return 'minibus';
      return 'otobus';
    default:
      return null;
  }
}

/** Rota kapalı bir türü kullanıyor mu. */
export function kapaliTurKullaniyor(rota: { legs: Bacak[] }, kapali: VasitaTuru[]): boolean {
  if (!kapali.length) return false;
  return rota.legs.some((b) => {
    const tur = bacakTuru(b);
    return tur !== null && kapali.includes(tur);
  });
}

/** Kapalı türün OTP'deki isteksizlik çarpanı: 3 kat pahalı (raylı tercihteki otobüs kadar). */
export const KAPALI_ISTEKSIZLIK = 3;
/**
 * Otobüs kapalı ama Metrobüs ya da minibüs açıkken BUS kipinin çarpanı. Üçü aynı kip;
 * tam ceza açık kalan Metrobüs'ü de aramadan atardı, ceza yok da otobüssüz seçenek
 * getirmezdi.
 */
export const KISMI_ISTEKSIZLIK = 1.8;

const KIP_TURLERI: Record<string, VasitaTuru> = {
  SUBWAY: 'metro',
  MONORAIL: 'metro',
  RAIL: 'marmaray',
  TRAM: 'tramvay',
  FUNICULAR: 'funikuler',
  GONDOLA: 'funikuler',
  CABLE_CAR: 'funikuler',
  FERRY: 'vapur',
};
const OTOBUS_KIPLERI = ['BUS', 'TROLLEYBUS', 'COACH'];

/** Bir OTP araç kipinin (BUS, SUBWAY, …) kapalı türlerden gelen isteksizlik çarpanı. */
export function kipCarpani(kip: string, kapali: VasitaTuru[]): number {
  const k = kip.toUpperCase();
  if (OTOBUS_KIPLERI.includes(k)) {
    const otobusTurleri: VasitaTuru[] = ['otobus', 'metrobus', 'minibus'];
    if (otobusTurleri.every((t) => kapali.includes(t))) return KAPALI_ISTEKSIZLIK;
    return kapali.includes('otobus') ? KISMI_ISTEKSIZLIK : 1;
  }
  const tur = KIP_TURLERI[k];
  return tur && kapali.includes(tur) ? KAPALI_ISTEKSIZLIK : 1;
}

/**
 * Kapalı türü kullanan rotaları, kapalı türü kullanmayan makul rotaların arkasına alır.
 * Makul: en kısa rotanın bir buçuk katından ve 10 dakikadan fazla uzun olmayan. Sıra
 * [makul temiz rotalar, kapalı türlüler, kalan temizler]; her grubun içinde tercihin sırası.
 */
export function kapaliTurleriGeriAl<T extends { duration: number | null; legs: Bacak[] }>(
  liste: T[],
  kapali: VasitaTuru[],
): T[] {
  if (!kapali.length || liste.length < 2) return liste;
  const kullanan = liste.filter((g) => kapaliTurKullaniyor(g, kapali));
  if (!kullanan.length || kullanan.length === liste.length) return liste;
  const enKisa = Math.min(...liste.map((g) => g.duration ?? Infinity));
  const makulMu = (g: T) => (g.duration ?? Infinity) <= enKisa * 1.5 + 600;
  const temiz = liste.filter((g) => !kapaliTurKullaniyor(g, kapali));
  return [...temiz.filter(makulMu), ...kullanan, ...temiz.filter((g) => !makulMu(g))];
}
