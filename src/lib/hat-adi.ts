// Hat rozetinde ne yazacağını belirler.
//
// Sorun: İBB verisinde "kısa ad" her hatta kısa değil. Minibüs ve taksi dolmuş
// hatlarının kısa adı güzergâhın tamamı — en uzunu 82 karakter. Vapur hatlarında
// kısaltma kodları var ("KBTŞ-EMN-KDK-ADA"). Marmaray ise üç hat olarak geliyor
// (Marmaray, Marmaray1, Marmaray2) ama yolcu için tek bir Marmaray var.
//
// Kural: rozet kimlik taşır, ayrıntı alt satıra iner. Kısa kodu olan hatta kodu
// yazılır; olmayanda araç tipi yazılır ve güzergâh `ayrinti` olarak döner.
//
// Bu dosya bilerek bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { baslikYap, trBuyuk } from './metin';

/** Rozete sığan en uzun kod. Bundan uzunsa araç tipi yazılır. */
const EN_UZUN_KOD = 8;

const MOD_ADLARI: Record<string, string> = {
  BUS: 'Otobüs',
  TROLLEYBUS: 'Troleybüs',
  COACH: 'Otobüs',
  SUBWAY: 'Metro',
  RAIL: 'Tren',
  MONORAIL: 'Monoray',
  TRAM: 'Tramvay',
  FERRY: 'Vapur',
  FUNICULAR: 'Füniküler',
  CABLE_CAR: 'Teleferik',
  GONDOLA: 'Teleferik',
  WALK: 'Yürüyüş',
};

/** "SUBWAY" → "Metro". Bilinmeyen tipler için boş dizi döner. */
export function aracAdi(mode?: string | null): string {
  return MOD_ADLARI[(mode ?? '').toUpperCase()] ?? '';
}

/**
 * GTFS route_type kodundan rota motorunun araç tipi adına.
 *
 * Ağ haritasının verisi doğrudan GTFS'ten geliyor ve orada araç tipi sayı;
 * rozet ve renk işlevleri ise OTP'nin sözcüklerini bekliyor.
 */
const TUR_MODLARI: Record<string, string> = {
  '0': 'TRAM',
  '1': 'SUBWAY',
  '2': 'RAIL',
  '3': 'BUS',
  '4': 'FERRY',
  '5': 'TRAM',        // nostaljik tramvay
  '6': 'GONDOLA',
  '7': 'FUNICULAR',
  '11': 'TROLLEYBUS',
  '12': 'MONORAIL',
};

/** "1" → "SUBWAY". Bilinmeyen kodlarda boş dizi döner. */
export function aracModu(routeType?: string | number | null): string {
  return TUR_MODLARI[String(routeType ?? '').trim()] ?? '';
}

/** İşletmeci adından yolcunun tanıdığı sözcüğü çıkarır: "Minibüs", "Dolmuş" ya da boş. */
export function isletmeciAdi(isletmeci?: string | null): string {
  const d = (isletmeci ?? '').toLocaleLowerCase('tr-TR');
  if (!d) return '';
  if (d.includes('minibus') || d.includes('minibüs')) return 'Minibüs';
  if (d.includes('dolmus') || d.includes('dolmuş') || d.includes('taksi')) return 'Dolmuş';
  return '';
}

export type HatEtiketi = {
  /** Rozette yazan kısa kimlik: "M4", "Marmaray", "Minibüs". */
  rozet: string;
  /** Rozete sığmayan güzergâh metni; alt satırda gösterilir. Yoksa boş. */
  ayrinti: string;
};

/**
 * @param kisaAd   GTFS route_short_name
 * @param mode     araç tipi (SUBWAY, BUS, FERRY…)
 * @param isletmeci işletmeci adı; minibüs ile dolmuşu ayırmak için
 */
export function hatEtiketi(kisaAd?: string | null, mode?: string | null, isletmeci?: string | null): HatEtiketi {
  const ham = (kisaAd ?? '').trim();
  if (!ham) return { rozet: aracAdi(mode) || '?', ayrinti: '' };

  // Marmaray veride üç hat: tam hat, kısa dönüş ve banliyö şubesi. Yolcu için hepsi Marmaray.
  if (/^marmaray\s*\d*$/i.test(ham)) return { rozet: 'Marmaray', ayrinti: '' };

  if (ham.length <= EN_UZUN_KOD) return { rozet: trBuyuk(ham), ayrinti: '' };

  // Kısa ad aslında güzergâhın kendisi: rozete araç tipi, alt satıra güzergâh.
  const tip = isletmeciAdi(isletmeci) || aracAdi(mode) || 'Hat';
  return { rozet: tip, ayrinti: baslikYap(ham) };
}
