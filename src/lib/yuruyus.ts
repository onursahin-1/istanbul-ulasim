// Yürüme adımlarını Türkçe yol tarifine çevirir.
//
// Rota motoru adımları ham hâlde veriyor: "RIGHT, Bağdat Caddesi, 240 m". Buradaki iş
// bunu okunur cümleye çevirmek ve gereksiz adımları birleştirmek — OTP aynı caddede
// devam eden yürüyüşü bazen birkaç adıma bölüyor, hepsini ayrı satır yapmak gürültü.
//
// Bu dosya bilerek bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { mesafeYaz } from './zaman';

/** Rota motorunun döndürdüğü ham yürüme adımı. */
export type HamAdim = {
  distance: number | null;
  relativeDirection: string | null;
  absoluteDirection: string | null;
  streetName: string | null;
  /** Sokağın gerçek bir adı yok, motor uydurmuş ("path", "road"). Ekranda yazmıyoruz. */
  bogusName: boolean | null;
  stayOn: boolean | null;
  area: boolean | null;
  exit: string | null;
};

export type DonusTuru =
  | 'basla'
  | 'duz'
  | 'sol'
  | 'sag'
  | 'hafifSol'
  | 'hafifSag'
  | 'keskinSol'
  | 'keskinSag'
  | 'geri'
  | 'kavsak'
  | 'asansor'
  | 'giris'
  | 'cikis'
  | 'tabela';

export type YuruyusAdimi = {
  donus: DonusTuru;
  /** "Sağa dön · Bağdat Caddesi" */
  metin: string;
  /** "240 m" — mesafe bilinmiyorsa boş. */
  mesafe: string;
  /** Aynı mesafe, metre (canlı tarifte "sıradaki dönüşe kaç metre" hesabı için). */
  metre: number;
  /** Yalnız eylem: "Sağa dön", "Düz devam et". Canlı tarifte büyük yazılıyor. */
  eylem: string;
  /** Sokak adı; adı olmayan yolda boş. */
  sokak: string;
};

const DONUSLER: Record<string, DonusTuru> = {
  DEPART: 'basla',
  CONTINUE: 'duz',
  LEFT: 'sol',
  RIGHT: 'sag',
  SLIGHTLY_LEFT: 'hafifSol',
  SLIGHTLY_RIGHT: 'hafifSag',
  HARD_LEFT: 'keskinSol',
  HARD_RIGHT: 'keskinSag',
  UTURN_LEFT: 'geri',
  UTURN_RIGHT: 'geri',
  CIRCLE_CLOCKWISE: 'kavsak',
  CIRCLE_COUNTERCLOCKWISE: 'kavsak',
  ELEVATOR: 'asansor',
  ENTER_STATION: 'giris',
  EXIT_STATION: 'cikis',
  FOLLOW_SIGNS: 'tabela',
};

const DONUS_SOZU: Record<DonusTuru, string> = {
  basla: 'Yürümeye başla',
  duz: 'Düz devam et',
  sol: 'Sola dön',
  sag: 'Sağa dön',
  hafifSol: 'Hafif sola',
  hafifSag: 'Hafif sağa',
  keskinSol: 'Keskin sola',
  keskinSag: 'Keskin sağa',
  geri: 'Geri dön',
  kavsak: 'Kavşaktan devam et',
  asansor: 'Asansöre bin',
  giris: 'İstasyona gir',
  cikis: 'İstasyondan çık',
  tabela: 'Tabelaları takip et',
};

const YONLER: Record<string, string> = {
  NORTH: 'kuzeye',
  NORTHEAST: 'kuzeydoğuya',
  EAST: 'doğuya',
  SOUTHEAST: 'güneydoğuya',
  SOUTH: 'güneye',
  SOUTHWEST: 'güneybatıya',
  WEST: 'batıya',
  NORTHWEST: 'kuzeybatıya',
};

/**
 * Yolun adı olmadığında OTP'nin kendi uydurduğu İngilizce adlar (OTP'nin
 * WayProperties.properties dosyasından). Bunlar sokak adı gibi yazılınca "escalator
 * boyunca devam et" gibi cümleler çıkıyordu. Genel yol türleri adsız sayılıyor;
 * yolcunun işine yarayan yapılar (yürüyen merdiven, üst geçit…) Türkçe cümleye dönüyor.
 */
const ADSIZ = new Set([
  'unnamed',
  'path',
  'bike path',
  'open area',
  'bridleway',
  'corridor',
  'indoor area',
  'road',
  'ramp',
  'link',
  'service road',
  'alley',
  'parking aisle',
  'byway',
  'track',
  'sidewalk',
  'default level',
]);

type OzelYer = 'yuruyenMerdiven' | 'merdiven' | 'asansor' | 'ustGecit' | 'altGecit' | 'yayaGecidi' | 'istasyonGirisi' | 'peron';

const OZEL: Record<OzelYer, { ad: string; cumle: string }> = {
  yuruyenMerdiven: { ad: 'Yürüyen merdiven', cumle: 'Yürüyen merdivenle devam et' },
  merdiven: { ad: 'Merdiven', cumle: 'Merdivenleri kullan' },
  asansor: { ad: 'Asansör', cumle: 'Asansörü kullan' },
  ustGecit: { ad: 'Üst geçit', cumle: 'Üst geçitten karşıya geç' },
  altGecit: { ad: 'Alt geçit', cumle: 'Alt geçitten karşıya geç' },
  yayaGecidi: { ad: 'Yaya geçidi', cumle: 'Yaya geçidinden karşıya geç' },
  istasyonGirisi: { ad: 'İstasyon girişi', cumle: 'İstasyon girişinden geç' },
  peron: { ad: 'Peron', cumle: 'Perona geç' },
};

type Yol = { sokak: string; ozel: OzelYer | null };

/** Adımın yolunu çözer: gerçek sokak adı, bilinen bir yapı ya da adsız. */
function yolCoz(adim: HamAdim): Yol {
  let ad = (adim.streetName ?? '').trim();
  const kucuk = ad.toLowerCase();
  if (kucuk === 'escalator') return { sokak: OZEL.yuruyenMerdiven.ad, ozel: 'yuruyenMerdiven' };
  if (kucuk === 'steps') return { sokak: OZEL.merdiven.ad, ozel: 'merdiven' };
  if (kucuk === 'elevator') return { sokak: OZEL.asansor.ad, ozel: 'asansor' };
  if (kucuk === 'footbridge') return { sokak: OZEL.ustGecit.ad, ozel: 'ustGecit' };
  if (kucuk === 'underpass') return { sokak: OZEL.altGecit.ad, ozel: 'altGecit' };
  if (kucuk === 'station entrance') return { sokak: OZEL.istasyonGirisi.ad, ozel: 'istasyonGirisi' };
  if (kucuk === 'platform' || kucuk.startsWith('platform ')) {
    return { sokak: kucuk === 'platform' ? OZEL.peron.ad : `Peron ${ad.slice(9)}`, ozel: 'peron' };
  }
  const gecit = ad.match(/^crosswalk over (.+)$/i);
  if (gecit) {
    const uzeri = gecit[1].trim();
    const genel = /^(service road|freeway ramp|turn lane)$/i.test(uzeri) || ADSIZ.has(uzeri.toLowerCase());
    return { sokak: genel ? OZEL.yayaGecidi.ad : `${OZEL.yayaGecidi.ad} · ${uzeri}`, ozel: 'yayaGecidi' };
  }
  if (adim.bogusName || !ad || ADSIZ.has(kucuk)) return { sokak: '', ozel: null };
  // "X (part of Y)" → X; "corner of A and B" → "A ile B köşesi"
  ad = ad.replace(/\s*\(part of [^)]*\)\s*$/i, '');
  const kose = ad.match(/^corner of (.+) and (.+)$/i);
  if (kose) ad = `${kose[1]} ile ${kose[2]} köşesi`;
  return { sokak: ad, ozel: null };
}

/** Ekranda yazmaya değer bir sokak adı mı? */
function sokakAdi(adim: HamAdim): string {
  return yolCoz(adim).sokak;
}

/**
 * Ham adımları okunur satırlara çevirir.
 *
 * Aynı sokakta devam eden ardışık adımlar birleştirilir: "Bağdat Caddesi boyunca
 * 120 m" ve hemen ardından yine "Bağdat Caddesi boyunca 80 m" demek yerine tek
 * satırda 200 m yazılır.
 */
export function adimlariYaz(adimlar?: HamAdim[] | null): YuruyusAdimi[] {
  if (!adimlar?.length) return [];

  // 1) Aynı sokakta süren adımları topla.
  type Birikim = { adim: HamAdim; mesafe: number };
  const birikmis: Birikim[] = [];
  for (const adim of adimlar) {
    const mesafe = adim.distance ?? 0;
    const son = birikmis[birikmis.length - 1];
    const ayniSokak = son && sokakAdi(son.adim) && sokakAdi(son.adim) === sokakAdi(adim);
    const donmuyor = DONUSLER[adim.relativeDirection ?? ''] === 'duz' || adim.stayOn;
    if (son && ayniSokak && donmuyor) {
      son.mesafe += mesafe;
      continue;
    }
    birikmis.push({ adim, mesafe });
  }

  // 2) Cümleye çevir.
  return birikmis.map(({ adim, mesafe }) => {
    const donus = DONUSLER[adim.relativeDirection ?? ''] ?? 'duz';
    const { sokak, ozel } = yolCoz(adim);
    let metin: string;
    let eylem: string = DONUS_SOZU[donus];

    if (ozel && donus !== 'asansor' && donus !== 'kavsak') {
      // "Yürüyen merdivenle devam et"; dönüşle birlikte "Sağa dön, yürüyen merdivenle devam et".
      const cumle = OZEL[ozel].cumle;
      const donuyor = donus !== 'duz' && donus !== 'basla';
      metin = donuyor ? `${DONUS_SOZU[donus]}, ${cumle.charAt(0).toLocaleLowerCase('tr-TR')}${cumle.slice(1)}` : cumle;
      eylem = donuyor ? DONUS_SOZU[donus] : cumle;
      return { donus, metin, mesafe: mesafe > 0 ? mesafeYaz(mesafe) : '', metre: mesafe, eylem, sokak: donuyor ? sokak : '' };
    }

    if (donus === 'basla') {
      const yon = YONLER[adim.absoluteDirection ?? ''];
      metin = sokak
        ? `${sokak} boyunca ${yon ? `${yon} doğru ` : ''}yürü`
        : `${yon ? `${yon.replace(/^./, (h) => h.toUpperCase())} doğru yürü` : DONUS_SOZU.basla}`;
      eylem = sokak ? 'Yürümeye başla' : metin;
    } else if (donus === 'asansor') {
      metin = adim.exit ? `Asansörle ${adim.exit}` : DONUS_SOZU.asansor;
      eylem = metin;
    } else if (donus === 'kavsak' && adim.exit) {
      eylem = `Kavşakta ${adim.exit}. çıkış`;
      metin = `${eylem}${sokak ? ` · ${sokak}` : ''}`;
    } else if (donus === 'duz') {
      metin = sokak ? `${sokak} boyunca devam et` : DONUS_SOZU.duz;
      eylem = 'Düz devam et';
    } else {
      metin = sokak ? `${DONUS_SOZU[donus]} · ${sokak}` : DONUS_SOZU[donus];
    }

    return { donus, metin, mesafe: mesafe > 0 ? mesafeYaz(mesafe) : '', metre: mesafe, eylem, sokak };
  });
}
