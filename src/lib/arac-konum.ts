// Hattaki otobüslerin durak sırasına yerleştirilmesi (canlı konum).
//
// Konum İETT'den geliyor, köprü (kopru/) üzerinden OTP'ye. İBB kotası yüzünden
// iki dakikada bir tazeleniyor: otobüs akıcı gitmiyor, sıçrıyor. Bu yüzden her
// konumun yaşı gösteriliyor; eskiyen konum griye dönüyor, çok eskisi hiç
// gösterilmiyor — eski bir konumu "şimdi burada" diye göstermek yolcuyu yanıltır.
//
// Otobüsün hangi iki durak arasında olduğunu burada, durakların koordinatlarından
// çıkarıyoruz. Köprünün gönderdiği "yaklaştığı durak" en yakın durak; otobüs onu
// geçmiş de olabilir, geçmemiş de. Komşu duraklara uzaklık bunu ayırıyor.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { mesafeMetre } from './cografya';

/** Bu yaştan eski konum soluk gösterilir ("civarı", "önce görüldü"). */
export const ESKI_SN = 5 * 60;
/** Bu yaştan eski konum hiç gösterilmez. */
export const GIZLI_SN = 10 * 60;
/** Durağa bu kadar yakın otobüs "durakta" sayılır. */
export const DURAKTA_M = 40;

export type YasSinifi = 'taze' | 'eski' | 'gizli';

export function yasSinifi(yasSn: number): YasSinifi {
  if (yasSn >= GIZLI_SN) return 'gizli';
  if (yasSn >= ESKI_SN) return 'eski';
  return 'taze';
}

/** "az önce", "3 dk önce". */
export function yasYaz(yasSn: number): string {
  if (yasSn < 60) return 'az önce';
  return `${Math.floor(yasSn / 60)} dk önce`;
}

/** Hat ekranı için kısa gecikme: "+3 dk", "zamanında", "2 dk erken". */
export function gecikmeKisa(gecikmeSn: number): string {
  const dk = Math.abs(gecikmeSn) < 60 ? 0 : Math.round(gecikmeSn / 60);
  if (dk === 0) return 'zamanında';
  return dk > 0 ? `+${dk} dk` : `${-dk} dk erken`;
}

export type KonumluDurak = { gtfsId: string; name?: string | null; lat?: number | null; lon?: number | null };

export type SeferDuragi = { stop?: { gtfsId: string } | null; departureDelay?: number | null; realtime?: boolean | null };

export type HamArac = {
  vehicleId?: string | null;
  label?: string | null;
  lat?: number | null;
  lon?: number | null;
  heading?: number | null;
  lastUpdate?: string | null;
  trip?: { gtfsId?: string | null; stoptimesForDate?: (SeferDuragi | null)[] | null } | null;
};

export type YerlesikArac = {
  kimlik: string;
  /** İETT kapı numarası. */
  etiket: string;
  /**
   * Durak sırasındaki yeri. Tam sayı: o durakta. Buçuklu: iki durağın arasında
   * (2.5 → 2. ile 3. durak arası).
   */
  konum: number;
  durum: 'durakta' | 'yaklasiyor';
  /** Bulunduğu ya da yaklaştığı durağın sırası. */
  durak: number;
  yasSn: number;
  sinif: Exclude<YasSinifi, 'gizli'>;
  /** Saniye; canlı gecikme bilinmiyorsa null. */
  gecikme: number | null;
  lat: number;
  lon: number;
  heading: number | null;
};

const nokta = (lat: number, lon: number) => ({ latitude: lat, longitude: lon });

/**
 * Otobüsün durak sırasındaki yeri.
 *
 * En yakın durağa 40 m'den yakınsa o durakta. Değilse en yakın durağın hangi
 * yanında: sonraki durağa önceki duraktan daha yakınsa en yakın durağı geçmiş,
 * sonrakine gidiyor; değilse en yakın durağa geliyor. Uç duraklarda komşu tek:
 * otobüs iki durak arasındaki uzaklıktan daha yakınsa aradadır, yoksa uçtadır
 * (başta bekliyor ya da sonda inmiş).
 */
export function durakSirasindaYer(
  duraklar: KonumluDurak[],
  lat: number,
  lon: number,
): { konum: number; durum: 'durakta' | 'yaklasiyor'; durak: number } | null {
  const arac = nokta(lat, lon);
  const uzaklik = duraklar.map((d) =>
    d.lat != null && d.lon != null ? mesafeMetre(arac, nokta(d.lat, d.lon)) : Infinity,
  );
  let i = -1;
  for (let k = 0; k < uzaklik.length; k++) if (i < 0 || uzaklik[k] < uzaklik[i]) i = k;
  if (i < 0 || !Number.isFinite(uzaklik[i])) return null;
  if (uzaklik[i] <= DURAKTA_M) return { konum: i, durum: 'durakta', durak: i };

  const son = duraklar.length - 1;
  const arasi = (a: number, b: number) => {
    const da = duraklar[a];
    const db = duraklar[b];
    if (da?.lat == null || da.lon == null || db?.lat == null || db.lon == null) return Infinity;
    return mesafeMetre(nokta(da.lat, da.lon), nokta(db.lat, db.lon));
  };

  if (i === 0) {
    if (son >= 1 && uzaklik[1] < arasi(0, 1)) return { konum: 0.5, durum: 'yaklasiyor', durak: 1 };
    return { konum: 0, durum: 'durakta', durak: 0 };
  }
  if (i === son) {
    if (uzaklik[son - 1] < arasi(son - 1, son)) return { konum: son - 0.5, durum: 'yaklasiyor', durak: son };
    return { konum: son, durum: 'durakta', durak: son };
  }
  if (uzaklik[i + 1] < uzaklik[i - 1]) return { konum: i + 0.5, durum: 'yaklasiyor', durak: i + 1 };
  return { konum: i - 0.5, durum: 'yaklasiyor', durak: i };
}

/**
 * Seferin canlı gecikmesi: otobüsün yaklaştığı duraktaki kalkış sapması. OTP köprünün
 * bildirdiği gecikmeyi seferin geri kalanına yayıyor; o durakta canlı değer yoksa
 * seferin herhangi bir canlı değeri alınıyor.
 */
export function seferGecikmesi(stoptimes: (SeferDuragi | null)[] | null | undefined, durakId?: string): number | null {
  const canli = (stoptimes ?? []).filter((s): s is SeferDuragi => !!s?.realtime && s.departureDelay != null);
  if (!canli.length) return null;
  const burada = durakId ? canli.find((s) => s.stop?.gtfsId === durakId) : undefined;
  return (burada ?? canli[canli.length - 1]).departureDelay ?? null;
}

/**
 * Bir yöndeki otobüsleri durak sırasına yerleştirir, en baştakinden sona sıralar.
 * Konumu olmayan, zamanı okunamayan ve 10 dakikadan eski olanlar düşer.
 */
export function araclariYerlestir(
  duraklar: KonumluDurak[],
  araclar: (HamArac | null)[] | null | undefined,
  simdiMs: number = Date.now(),
): YerlesikArac[] {
  const sonuc: YerlesikArac[] = [];
  const gorulen = new Set<string>();
  for (const a of araclar ?? []) {
    if (!a || a.lat == null || a.lon == null) continue;
    const an = Date.parse(a.lastUpdate ?? '');
    if (Number.isNaN(an)) continue;
    const yasSn = Math.max(0, Math.round((simdiMs - an) / 1000));
    const sinif = yasSinifi(yasSn);
    if (sinif === 'gizli') continue;
    const kimlik = a.vehicleId || a.label || `${a.lat},${a.lon}`;
    if (gorulen.has(kimlik)) continue;
    const yer = durakSirasindaYer(duraklar, a.lat, a.lon);
    if (!yer) continue;
    gorulen.add(kimlik);
    sonuc.push({
      kimlik,
      etiket: a.label || a.vehicleId?.split(':').pop() || '',
      ...yer,
      yasSn,
      sinif,
      gecikme: seferGecikmesi(a.trip?.stoptimesForDate, duraklar[yer.durak]?.gtfsId),
      lat: a.lat,
      lon: a.lon,
      heading: a.heading ?? null,
    });
  }
  return sonuc.sort((x, y) => x.konum - y.konum);
}
