// Vasıta türü tercihleri: Ayarlar'da kapatılan türler rotalarda hiç kullanılmaz.
//
// İlk sürümde kapalı tür yalnız "geri planda" kalıyordu (pahalı sayılıp listenin sonuna
// itiliyordu); minibüsü kapatan yolcu yine minibüslü rota görüyordu. Şimdi:
//   1. Rota motoru (OTP) kapalı türü hiç kullanmıyor: araç kipi listeden çıkıyor
//      (metro, Marmaray, tramvay, füniküler, vapur), otobüs kipi içindeki türler
//      (Metrobüs, minibüs, dolmuş) hat ve işletmeci süzgeciyle ayıklanıyor.
//   2. Güvence: gelen sonuçlarda yine de kapalı türlü rota varsa liste dışı kalıyor.
//   3. Kapalı türler yüzünden hiç rota bulunamazsa yolcu uyarılıyor ve vasıta
//      tercihlerine yönlendiriliyor (rota.tsx).
//
// Metrobüs, minibüs ve dolmuş OTP'de otobüsle aynı kip (BUS); ayrım hattın kodu ve
// işletmecisiyle yapılıyor.
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

export type Bacak = {
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
const OTOBUS_TURLERI: VasitaTuru[] = ['otobus', 'metrobus', 'minibus'];

/**
 * Bir OTP araç kipi (BUS, SUBWAY, …) aramaya girsin mi. Otobüs kipi ancak otobüs,
 * Metrobüs ve minibüsün üçü de kapalıysa çıkar; biri açıksa kip kalır, kapalı olanlar
 * süzgeçle ayıklanır (vasitaSuzgeci).
 */
export function kipAcikMi(kip: string, kapali: VasitaTuru[]): boolean {
  const k = kip.toUpperCase();
  if (OTOBUS_KIPLERI.includes(k)) return !OTOBUS_TURLERI.every((t) => kapali.includes(t));
  const tur = KIP_TURLERI[k];
  return !tur || !kapali.includes(tur);
}

/** Süzgeç kurmak için gereken hat bilgisi (OTP `routes` sorgusu). */
export type SuzgecHatti = {
  gtfsId: string;
  shortName?: string | null;
  mode?: string | null;
  agency?: { gtfsId?: string | null; name?: string | null } | null;
};

/** OTP'nin `TransitFilterInput`'u: dışarıda bırakılan ve izin verilen işletmeci/hatlar. */
export type TasimaSuzgeci = {
  exclude?: ({ agencies: string[] } | { routes: string[] })[];
  include?: ({ agencies: string[] } | { routes: string[] })[];
};

/** Bir hattın vasıta türü (bacakTuru ile aynı kural). */
export function hatTuru(h: SuzgecHatti): VasitaTuru | null {
  return bacakTuru({ mode: h.mode, transitLeg: true, route: { shortName: h.shortName, agency: h.agency } });
}

/**
 * Kapalı türleri rota motorundan çıkaran süzgeç; kapalı tür yoksa ya da yalnız kip
 * düzeyinde kapatılan türler varsa (metro, vapur… kip listesinden çıkıyor) null.
 *
 * İşletmecinin bütün hatları kapalıysa işletmeci dışarıda (minibüs, dolmuş). Bir
 * kısmıysa: kapalı hat azsa onlar dışarıda (Metrobüs kapalı: 113 hat); çoksa izin
 * verilenler listeleniyor (otobüs kapalı ama Metrobüs açık: İETT'nin 9.000'i aşkın
 * hattını tek tek dışarıda bırakmak yerine yalnız Metrobüs hatlarına izin).
 */
export function vasitaSuzgeci(kapali: VasitaTuru[], hatlar: SuzgecHatti[]): TasimaSuzgeci[] | null {
  if (!kapali.some((t) => OTOBUS_TURLERI.includes(t))) return null;
  const isletmeciler = new Map<string, { acik: string[]; kapali: string[] }>();
  for (const h of hatlar) {
    const isl = h.agency?.gtfsId;
    if (!isl || !h.gtfsId) continue;
    const kayit = isletmeciler.get(isl) ?? { acik: [], kapali: [] };
    const tur = hatTuru(h);
    (tur && kapali.includes(tur) ? kayit.kapali : kayit.acik).push(h.gtfsId);
    isletmeciler.set(isl, kayit);
  }
  const disaridaIsletme: string[] = [];
  const disaridaHat: string[] = [];
  const tamAcik: string[] = [];
  const izinliHat: string[] = [];
  let izinListesi = false;
  for (const [isl, { acik, kapali: kapaliHat }] of isletmeciler) {
    if (!kapaliHat.length) tamAcik.push(isl);
    else if (!acik.length) disaridaIsletme.push(isl);
    else if (kapaliHat.length <= acik.length) {
      disaridaHat.push(...kapaliHat);
      tamAcik.push(isl);
    } else {
      izinListesi = true;
      izinliHat.push(...acik);
    }
  }
  const exclude: NonNullable<TasimaSuzgeci['exclude']> = [];
  if (disaridaIsletme.length) exclude.push({ agencies: disaridaIsletme });
  if (disaridaHat.length) exclude.push({ routes: disaridaHat });
  const suzgec: TasimaSuzgeci = {};
  if (exclude.length) suzgec.exclude = exclude;
  if (izinListesi) {
    suzgec.include = [
      ...(tamAcik.length ? [{ agencies: tamAcik }] : []),
      ...(izinliHat.length ? [{ routes: izinliHat }] : []),
    ];
  }
  return suzgec.exclude || suzgec.include ? [suzgec] : null;
}

/** Minibüs ve dolmuş işletmecilerini dışarıda bırakan süzgeç (önerilen aramanın çeşitliliği için). */
export function minibussuzSuzgec(hatlar: SuzgecHatti[]): TasimaSuzgeci[] | null {
  const isletmeler = [
    ...new Set(hatlar.filter((h) => hatTuru(h) === 'minibus').map((h) => h.agency?.gtfsId).filter((x): x is string => !!x)),
  ];
  return isletmeler.length ? [{ exclude: [{ agencies: isletmeler }] }] : null;
}

/** Trafiğe takılmayan türler: raylı sistem, vapur ve kendi yolu olan Metrobüs. */
export const TRAFIKSIZ_TURLER: VasitaTuru[] = ['metro', 'marmaray', 'tramvay', 'funikuler', 'vapur', 'metrobus'];

/**
 * Yalnız trafiksiz türlerle (metro, Marmaray, tramvay, füniküler, teleferik, vapur,
 * Metrobüs) arama süzgeci; kapalı türler dışarıda. Önerilen aramalarda otobüs her yerde
 * sık geçtiği için OTP'nin döndürdüğü ilk 12 rota otobüs çeşitlemeleriyle doluyor, metrolu
 * seçenek listeye hiç giremiyordu. Bu ayrı arama trafiksiz seçenekleri her zaman getiriyor.
 */
export function trafiksizSuzgec(kapali: VasitaTuru[], hatlar: SuzgecHatti[]): TasimaSuzgeci[] | null {
  const izinli = hatlar
    .filter((h) => {
      const tur = hatTuru(h);
      return !!h.gtfsId && tur != null && TRAFIKSIZ_TURLER.includes(tur) && !kapali.includes(tur);
    })
    .map((h) => h.gtfsId);
  return izinli.length ? [{ include: [{ routes: izinli }] }] : null;
}

/** Kapalı türü kullanan rotaları listeden çıkarır (rota motoru süzgecine ek güvence). */
export function kapaliTurleriAyikla<T extends { legs: Bacak[] }>(liste: T[], kapali: VasitaTuru[]): T[] {
  if (!kapali.length) return liste;
  return liste.filter((g) => !kapaliTurKullaniyor(g, kapali));
}

/** Rotadaki minibüs ve dolmuş süresi (saniye) ve bacak sayısı. */
export function minibusPayi(rota: { legs: (Bacak & { duration?: number | null })[] }): { sure: number; bacak: number } {
  let sure = 0;
  let bacak = 0;
  for (const b of rota.legs) {
    if (bacakTuru(b) !== 'minibus') continue;
    sure += b.duration ?? 0;
    bacak += 1;
  }
  return { sure, bacak };
}
