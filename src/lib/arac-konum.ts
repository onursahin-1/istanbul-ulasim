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

import { cizgiUzerindeYer, mesafeMetre, type Nokta } from './cografya';

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
  /** Otobüsün yaptığı seferin kimliği (OTP gtfsId); bilinmiyorsa null. */
  sefer: string | null;
  lat: number;
  lon: number;
  heading: number | null;
  /** Konumun alındığı an (ms). */
  an: number;
  /** Köprü: otobüs uzun süredir duruyorsa (mola, park) kaç saniyedir; haritada ilerletilmez. */
  duruyorSn?: number | null;
};

const nokta = (lat: number, lon: number) => ({ latitude: lat, longitude: lon });

/**
 * Köprünün araç tabanlı varışındaki otobüs, haritada ve yaklaşma şeridinde gösterilecek
 * biçimde. Durak sırası bilinmiyor (yalnız durağa kalan durak); sefer yok.
 */
export function aracVarisindanOtobus(v: {
  kapiNo: string;
  kalanDurak: number;
  yasSn: number;
  enlem: number;
  boylam: number;
  duruyorSn?: number | null;
}): YerlesikArac {
  const sinif = yasSinifi(v.yasSn);
  return {
    kimlik: v.kapiNo,
    etiket: v.kapiNo,
    konum: 0,
    durum: v.kalanDurak === 0 ? 'durakta' : 'yaklasiyor',
    durak: 0,
    yasSn: v.yasSn,
    sinif: sinif === 'gizli' ? 'eski' : sinif,
    gecikme: null,
    sefer: null,
    lat: v.enlem,
    lon: v.boylam,
    heading: null,
    an: Date.now() - v.yasSn * 1000,
    duruyorSn: v.duruyorSn ?? null,
  };
}

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
  /**
   * Verilirse (m/sn) otobüs, konumunun yaşı kadar güzergâh boyunca ilerletilmiş yerine göre
   * sıralanır: haritadaki işaret (HareketliOtobus, tahminiKonum) ile liste aynı şeyi
   * söylesin. Konum 1–2 dk eski gelebiliyor; haritada otobüs Yel Değirmeni'ndeyken listede
   * "Göztepe Meydanı'na yaklaşıyor" yazıyordu (2026-10-07 23:25). `lat`/`lon` ham kalır.
   */
  hizMs?: number,
): YerlesikArac[] {
  const sonuc: YerlesikArac[] = [];
  const gorulen = new Set<string>();
  const cizgi = hizMs
    ? duraklar.filter((d) => d.lat != null && d.lon != null).map((d) => nokta(d.lat!, d.lon!))
    : [];
  for (const a of araclar ?? []) {
    if (!a || a.lat == null || a.lon == null) continue;
    const an = Date.parse(a.lastUpdate ?? '');
    if (Number.isNaN(an)) continue;
    const yasSn = Math.max(0, Math.round((simdiMs - an) / 1000));
    const sinif = yasSinifi(yasSn);
    if (sinif === 'gizli') continue;
    const kimlik = a.vehicleId || a.label || `${a.lat},${a.lon}`;
    if (gorulen.has(kimlik)) continue;
    let yer = durakSirasindaYer(duraklar, a.lat, a.lon);
    if (!yer) continue;
    if (hizMs && sinif !== 'eski') {
      const t = tahminiKonum({ lat: a.lat, lon: a.lon, an, durum: yer.durum, heading: a.heading ?? null }, cizgi, hizMs, simdiMs);
      const ileri = t.tahmini ? durakSirasindaYer(duraklar, t.latitude, t.longitude) : null;
      if (ileri && ileri.konum >= yer.konum) yer = ileri;
    }
    gorulen.add(kimlik);
    sonuc.push({
      kimlik,
      etiket: a.label || a.vehicleId?.split(':').pop() || '',
      ...yer,
      yasSn,
      sinif,
      gecikme: seferGecikmesi(a.trip?.stoptimesForDate, duraklar[yer.durak]?.gtfsId),
      sefer: a.trip?.gtfsId ?? null,
      lat: a.lat,
      lon: a.lon,
      heading: a.heading ?? null,
      an,
    });
  }
  return sonuc.sort((x, y) => x.konum - y.konum);
}

/** Yaklaşan otobüsün aranacağı en uzak mesafe (durak). Daha gerideki otobüs "yaklaşan" sayılmaz. */
export const EN_UZAK_DURAK = 15;

/**
 * Bir durağa gelmekte olan otobüs ve kaç durak uzakta olduğu.
 *
 * Önce o kalkışın seferini yapan otobüs aranır (sefer kimliği tutan); yoksa durağın
 * gerisindeki en yakın otobüs. Durağı geçmiş otobüs yaklaşan değildir.
 *
 * @param durakSirasi durağın desen içindeki sırası
 * @param sefer beklenen kalkışın sefer kimliği, biliniyorsa
 * @returns kalan: 0 = durakta, 1 = bir önceki duraktan geliyor…
 */
export function yaklasanOtobus(
  araclar: YerlesikArac[],
  durakSirasi: number,
  sefer?: string | null,
): { otobus: YerlesikArac; kalan: number } | null {
  if (durakSirasi < 0) return null;
  const gerideki = araclar.filter((a) => a.konum <= durakSirasi && durakSirasi - a.konum <= EN_UZAK_DURAK);
  const seferle = sefer ? gerideki.find((a) => a.sefer === sefer) : undefined;
  const secilen =
    seferle ?? gerideki.reduce<YerlesikArac | null>((en, a) => (!en || a.konum > en.konum ? a : en), null);
  if (!secilen) return null;
  return { otobus: secilen, kalan: Math.ceil(durakSirasi - secilen.konum) };
}

/** "durakta", "1 durak uzakta", "3 durak uzakta". */
export function kalanYaz(kalan: number): string {
  return kalan <= 0 ? 'durakta' : `${kalan} durak uzakta`;
}

// ---------------------------------------------------------------- iki konum arası tahmin
//
// Köprü otobüs konumunu 75 saniyede bir alabiliyor (İBB'nin kotası saatte 100 istek).
// Haritada otobüs bu arada donup sonra sıçramasın diye, son konumdan bu yana geçen
// sürede güzergâh üstünde ortalama hızla ne kadar ilerlediği tahmin ediliyor. Tahmin
// kısa tutuluyor: en çok 150 sn ileriye ve hattın dışına hiç çıkmadan.

/** İstanbul'da şehir içi otobüsün ortalama hızı (durak beklemeleri dahil), m/sn ≈ 16 km/sa. */
export const OTOBUS_HIZI_MS = 4.5;
/** Metrobüs kendi yolunda: ≈ 30 km/sa. */
export const METROBUS_HIZI_MS = 8.5;
/** Son konumdan en çok bu kadar saniye ileriye tahmin edilir. */
export const EN_COK_TAHMIN_SN = 150;
/** Durakta görülen otobüsün kalkmadan önce beklediği varsayılan süre. */
export const DURAK_BEKLEMESI_SN = 20;
/** Güzergâh çizgisine bundan uzak konum tahmin edilmez (garaj, sapma). */
const CIZGIDEN_UZAK_M = 80;

export type TahminiKonum = { latitude: number; longitude: number; yon: number | null; tahmini: boolean };

function yonBul(a: Nokta, b: Nokta): number {
  const y = Math.sin(((b.longitude - a.longitude) * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180);
  const x =
    Math.cos((a.latitude * Math.PI) / 180) * Math.sin((b.latitude * Math.PI) / 180) -
    Math.sin((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.cos(((b.longitude - a.longitude) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Çizgi üzerinde baştan `metre` uzaklıktaki nokta ve o parçanın yönü. */
export function cizgideNokta(cizgi: Nokta[], metre: number): { nokta: Nokta; yon: number | null } {
  if (cizgi.length === 0) return { nokta: { latitude: 0, longitude: 0 }, yon: null };
  let kalan = Math.max(0, metre);
  for (let i = 1; i < cizgi.length; i++) {
    const a = cizgi[i - 1];
    const b = cizgi[i];
    const boy = mesafeMetre(a, b);
    if (kalan <= boy || i === cizgi.length - 1) {
      const t = boy > 0 ? Math.min(1, kalan / boy) : 0;
      return {
        nokta: { latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t },
        yon: boy > 0 ? yonBul(a, b) : null,
      };
    }
    kalan -= boy;
  }
  return { nokta: cizgi[cizgi.length - 1], yon: null };
}

/**
 * Otobüsün şu anki tahmini yeri: son konum güzergâha izdüşürülüp, o andan bu yana geçen
 * sürede ortalama hızla ilerletiliyor. Güzergâhtan uzaksa ya da çizgi yoksa son konum.
 */
export function tahminiKonum(
  arac: Pick<YerlesikArac, 'lat' | 'lon' | 'an' | 'durum' | 'heading'>,
  cizgi: Nokta[],
  hizMs: number,
  simdiMs: number,
): TahminiKonum {
  const son: TahminiKonum = { latitude: arac.lat, longitude: arac.lon, yon: arac.heading, tahmini: false };
  if (cizgi.length < 2 || !Number.isFinite(arac.an)) return son;
  const yer = cizgiUzerindeYer({ latitude: arac.lat, longitude: arac.lon }, cizgi);
  if (yer.uzaklik > CIZGIDEN_UZAK_M) return son;
  let gecen = Math.min(Math.max(0, (simdiMs - arac.an) / 1000), EN_COK_TAHMIN_SN);
  if (arac.durum === 'durakta') gecen = Math.max(0, gecen - DURAK_BEKLEMESI_SN);
  // İzdüşüm kendi düzlem ölçeğiyle ölçüyor; çizgi boyunu cizgideNokta'nın ölçeğine çevir.
  let boy = 0;
  for (let i = 1; i < cizgi.length; i++) boy += mesafeMetre(cizgi[i - 1], cizgi[i]);
  const bas = yer.toplam > 0 ? (yer.boyunca / yer.toplam) * boy : 0;
  const { nokta, yon } = cizgideNokta(cizgi, Math.min(bas + hizMs * gecen, boy));
  return { ...nokta, yon: yon ?? arac.heading, tahmini: gecen > 0 };
}
