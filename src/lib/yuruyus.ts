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

/** Ekranda yazmaya değer bir sokak adı mı? */
function sokakAdi(adim: HamAdim): string {
  if (adim.bogusName) return '';
  const ad = (adim.streetName ?? '').trim();
  // Motor adı olmayan yolları bazen böyle etiketliyor.
  if (!ad || /^(path|road|open area|sidewalk|steps|service road)$/i.test(ad)) return '';
  return ad;
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
    const sokak = sokakAdi(adim);
    let metin: string;

    if (donus === 'basla') {
      const yon = YONLER[adim.absoluteDirection ?? ''];
      metin = sokak
        ? `${sokak} boyunca ${yon ? `${yon} doğru ` : ''}yürü`
        : `${yon ? `${yon.replace(/^./, (h) => h.toUpperCase())} doğru yürü` : DONUS_SOZU.basla}`;
    } else if (donus === 'asansor') {
      metin = adim.exit ? `Asansörle ${adim.exit}` : DONUS_SOZU.asansor;
    } else if (donus === 'kavsak' && adim.exit) {
      metin = `Kavşakta ${adim.exit}. çıkış${sokak ? ` · ${sokak}` : ''}`;
    } else if (donus === 'duz') {
      metin = sokak ? `${sokak} boyunca devam et` : DONUS_SOZU.duz;
    } else {
      metin = sokak ? `${DONUS_SOZU[donus]} · ${sokak}` : DONUS_SOZU[donus];
    }

    return { donus, metin, mesafe: mesafe > 0 ? mesafeYaz(mesafe) : '' };
  });
}
