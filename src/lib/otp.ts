// OpenTripPlanner (rota motoru) ile konuşan katman.
// Sorgular OTP 2.10'un GTFS GraphQL şemasına göre yazıldı: /otp/gtfs/v1

import Constants from 'expo-constants';

/**
 * Rota motorunun adresi.
 * - .env dosyasında EXPO_PUBLIC_OTP_URL tanımlıysa o kullanılır (ör. yayındaki sunucu).
 * - Tanımlı değilse, geliştirme sırasında Expo sunucusunun çalıştığı bilgisayarın IP'si alınır
 *   ve 8080 portu eklenir. Böylece telefon, bilgisayardaki OTP'ye kendiliğinden bağlanır.
 */
function adresBul(): string {
  const tanimli = process.env.EXPO_PUBLIC_OTP_URL;
  if (tanimli) return tanimli.replace(/\/+$/, '');
  const expoAdresi = Constants.expoConfig?.hostUri ?? '';
  const bilgisayar = expoAdresi.split(':')[0] || 'localhost';
  return `http://${bilgisayar}:8080`;
}

export const OTP_ADRESI = adresBul();

export class OtpHatasi extends Error {}

// Sorgu metinleri ayrı dosyada; oradan içe aktarılıp buradan yeniden dışa açılıyor.
export { SORGULAR, VARSAYILAN_SECENEKLER, tercihleriYap } from './sorgular';
// Bacak yardımcıları bağımlılıksız bir dosyada; çağrı yerleri değişmesin diye buradan da açılıyor.
export { bacakDuraklari } from './bacak';
export type { RotaSecenekleri, RotaTercihi } from './sorgular';
import { SORGULAR as S, VARSAYILAN_SECENEKLER, tercihleriYap, type RotaSecenekleri } from './sorgular';

const {
  YAKIN_DURAKLAR,
  DURAK_DETAYI,
  DURAK_SAATLERI,
  DURAK_ARA,
  ROTA_PLANLA,
  HAT_KALKISLARI,
  HATLAR,
  HAT_DETAYI,
  SUNUCU_BILGISI,
} = S;

async function sorgula<T>(sorgu: string, degiskenler: Record<string, unknown>, sinyal?: AbortSignal): Promise<T> {
  let yanit: Response;
  try {
    yanit = await fetch(`${OTP_ADRESI}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: sorgu, variables: degiskenler }),
      signal: sinyal,
    });
  } catch (hata) {
    if ((hata as Error)?.name === 'AbortError') throw hata;
    throw new OtpHatasi(
      `Rota sunucusuna ulaşılamadı (${OTP_ADRESI}). Bilgisayarda OpenTripPlanner açık mı ve telefon aynı ağda mı?`,
    );
  }
  if (!yanit.ok) throw new OtpHatasi(`Rota sunucusu hata döndürdü (HTTP ${yanit.status}).`);
  const govde = (await yanit.json()) as { data?: T; errors?: { message: string }[] };
  // GraphQL tek bir alanda hata verse bile gövdenin geri kalanı geçerli olabilir.
  // Veri geldiyse onu kullanırız; hata yalnızca hiç veri yoksa yüzeye çıkar.
  if (!govde.data) {
    throw new OtpHatasi(
      govde.errors?.length
        ? `Rota sunucusu sorguyu reddetti: ${govde.errors[0].message}`
        : 'Rota sunucusundan boş cevap geldi.',
    );
  }
  if (govde.errors?.length) console.warn('[OTP] kısmi hata:', govde.errors[0].message);
  return govde.data;
}

// ---------- Tipler ----------

/** Hat bilgisi: renk ve araç tipi, rozetlerin metro/vapur/otobüs ayrımını yapabilmesi için. */
export type Hat = {
  gtfsId: string;
  shortName: string | null;
  longName?: string | null;
  mode?: string | null;
  color?: string | null;
  textColor?: string | null;
};

export type Kalkis = {
  scheduledDeparture: number | null;
  realtimeDeparture: number | null;
  realtime: boolean | null;
  serviceDay: number | null;
  headsign: string | null;
  trip: { gtfsId: string; route: Hat } | null;
};

export type Durak = {
  gtfsId: string;
  name: string;
  code: string | null;
  desc: string | null;
  lat: number | null;
  lon: number | null;
};

export type YakinDurak = { mesafe: number; durak: Durak & { kalkislar: Kalkis[] } };

export type DurakDetayi = Durak & {
  routes: Hat[] | null;
  kalkislar: Kalkis[];
};

export type Yer = { name: string | null; lat: number; lon: number; stop: { gtfsId: string } | null };

export type Bacak = {
  mode: string | null;
  duration: number | null;
  distance: number | null;
  transitLeg: boolean | null;
  headsign: string | null;
  start: { scheduledTime: string; estimated: { time: string } | null };
  end: { scheduledTime: string; estimated: { time: string } | null };
  from: Yer;
  to: Yer;
  route: Hat | null;
  legGeometry: { points: string | null } | null;
  trip: { gtfsId: string; pattern: { stops: DurakNoktasi[] | null } | null } | null;
};

export type DurakNoktasi = { gtfsId: string; name: string | null; lat: number | null; lon: number | null };

export type Guzergah = {
  start: string | null;
  end: string | null;
  duration: number | null;
  walkTime: number | null;
  walkDistance: number | null;
  numberOfTransfers: number;
  legs: Bacak[];
};

export type Konum = { ad: string; lat: number; lon: number };

export type HatOzeti = Hat & { agency: { name: string } | null };

export type HatDeseni = {
  code: string;
  name: string | null;
  headsign: string | null;
  directionId: string | null;
  stops: { gtfsId: string; name: string; lat: number | null; lon: number | null }[] | null;
};

export type HatDetayi = HatOzeti & { patterns: HatDeseni[] | null };


// ---------- İşlevler ----------

/** Verilen noktaya yürüme mesafesi 1 km içindeki duraklar ve sıradaki kalkışları. */
export async function yakinDuraklariGetir(lat: number, lon: number, sinyal?: AbortSignal): Promise<YakinDurak[]> {
  type Cevap = {
    nearest: {
      edges: { node: { distance: number; place: ({ __typename: string } & Partial<YakinDurak['durak']>) | null } }[];
    } | null;
  };
  const veri = await sorgula<Cevap>(YAKIN_DURAKLAR, { lat, lon }, sinyal);
  return (veri.nearest?.edges ?? [])
    .filter((e) => e.node.place?.__typename === 'Stop')
    .map((e) => ({
      mesafe: e.node.distance,
      durak: { ...(e.node.place as YakinDurak['durak']), kalkislar: e.node.place?.kalkislar ?? [] },
    }));
}

export async function durakDetayiGetir(id: string, sinyal?: AbortSignal): Promise<DurakDetayi | null> {
  const veri = await sorgula<{ stop: DurakDetayi | null }>(DURAK_DETAYI, { id }, sinyal);
  return veri.stop;
}

/** Durak adında arama yapar. Rota motoru adları büyük harfle tuttuğu için arama da büyük harfle yapılır. */
export async function durakAra(ad: string, sinyal?: AbortSignal): Promise<Durak[]> {
  const veri = await sorgula<{ stops: Durak[] | null }>(DURAK_ARA, { ad }, sinyal);
  return veri.stops ?? [];
}

/**
 * Bir duraktan geçen belirli bir hattın kalkış saatleri (gün başından itibaren saniye).
 * Kullanıcı bir bacağı açtığında tembel olarak çağrılır.
 */
export async function hatKalkislariGetir(
  durakId: string,
  hatId: string,
  aralikSaniye = 8 * 3600,
  sinyal?: AbortSignal,
): Promise<{ saniye: number; serviceDay: number }[]> {
  type Cevap = { stop: { kalkislar: Kalkis[] | null } | null };
  const veri = await sorgula<Cevap>(HAT_KALKISLARI, { durak: durakId, aralik: aralikSaniye }, sinyal);
  return (veri.stop?.kalkislar ?? [])
    .filter((k) => k.trip?.route.gtfsId === hatId)
    .map((k) => ({ saniye: k.realtimeDeparture ?? k.scheduledDeparture ?? 0, serviceDay: k.serviceDay ?? 0 }))
    .filter((k) => k.saniye > 0)
    .sort((a, b) => a.serviceDay + a.saniye - (b.serviceDay + b.saniye));
}

export type RotaSonucu = { guzergahlar: Guzergah[]; hatalar: { code: string; description: string }[] };

export async function rotaPlanla(
  nereden: Konum,
  nereye: Konum,
  zaman: string,
  secenekler: RotaSecenekleri = VARSAYILAN_SECENEKLER,
  sinyal?: AbortSignal,
): Promise<RotaSonucu> {
  type Cevap = {
    planConnection: {
      routingErrors: { code: string; description: string }[];
      edges: ({ node: Guzergah } | null)[] | null;
    } | null;
  };
  const yer = (k: Konum) => ({ label: k.ad, location: { coordinate: { latitude: k.lat, longitude: k.lon } } });
  const veri = await sorgula<Cevap>(
    ROTA_PLANLA,
    { nereden: yer(nereden), nereye: yer(nereye), zaman, tercihler: tercihleriYap(secenekler) },
    sinyal,
  );
  return {
    guzergahlar: (veri.planConnection?.edges ?? []).flatMap((e) => (e ? [e.node] : [])),
    hatalar: veri.planConnection?.routingErrors ?? [],
  };
}

// Hat listesi seyrek değişir; oturum boyunca bir kez çekilip bellekte tutulur.
let hatlarOnbellek: Promise<HatOzeti[]> | null = null;

/** Ağdaki bütün hatlar. İlk çağrıda sunucudan çekilir, sonrasında bellekten verilir. */
export async function hatlariGetir(sinyal?: AbortSignal): Promise<HatOzeti[]> {
  if (!hatlarOnbellek) {
    hatlarOnbellek = sorgula<{ routes: (HatOzeti | null)[] | null }>(HATLAR, {}, sinyal)
      .then((veri) => (veri.routes ?? []).filter((h): h is HatOzeti => !!h && !!h.gtfsId))
      .catch((e) => {
        hatlarOnbellek = null;
        throw e;
      });
  }
  return hatlarOnbellek;
}

/** Bir hattın yönleri ve her yöndeki durak sırası. */
export async function hatDetayiGetir(id: string, sinyal?: AbortSignal): Promise<HatDetayi | null> {
  const veri = await sorgula<{ route: HatDetayi | null }>(HAT_DETAYI, { id }, sinyal);
  return veri.route;
}

/** Durak ekranındaki bir satır: hat + yön + sıradaki kalkışlar. */
export type DurakDeseni = {
  pattern: { code: string; headsign: string | null; directionId: string | null; route: Hat } | null;
  stoptimes: Kalkis[] | null;
};

export type DurakSaatleri = Durak & { routes: Hat[] | null; desenler: DurakDeseni[] | null };

/** Bir duraktan geçen bütün hatların yön yön sıradaki kalkışları. */
export async function durakSaatleriGetir(
  id: string,
  kalkisSayisi = 3,
  aralikSaniye = 3 * 3600,
  sinyal?: AbortSignal,
): Promise<DurakSaatleri | null> {
  const veri = await sorgula<{ stop: DurakSaatleri | null }>(
    DURAK_SAATLERI,
    { id, kalkis: kalkisSayisi, aralik: aralikSaniye },
    sinyal,
  );
  return veri.stop;
}

export type SunucuBilgisi = {
  serviceTimeRange: { start: number | null; end: number | null } | null;
  feeds: { feedId: string; agencies: { name: string }[] | null }[] | null;
};

/** Rota sunucusunun durumu ve yüklü tarifenin kapsadığı tarih aralığı. */
export async function sunucuBilgisiGetir(sinyal?: AbortSignal): Promise<SunucuBilgisi> {
  return sorgula<SunucuBilgisi>(SUNUCU_BILGISI, {}, sinyal);
}
