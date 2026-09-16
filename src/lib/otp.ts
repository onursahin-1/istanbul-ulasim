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
  if (govde.errors?.length) throw new OtpHatasi(`Rota sunucusu sorguyu reddetti: ${govde.errors[0].message}`);
  if (!govde.data) throw new OtpHatasi('Rota sunucusundan boş cevap geldi.');
  return govde.data;
}

// ---------- Tipler ----------

export type Kalkis = {
  scheduledDeparture: number | null;
  realtimeDeparture: number | null;
  realtime: boolean | null;
  serviceDay: number | null;
  headsign: string | null;
  trip: { gtfsId: string; route: { gtfsId: string; shortName: string | null } } | null;
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
  routes: { gtfsId: string; shortName: string | null; longName: string | null }[] | null;
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
  route: { gtfsId: string; shortName: string | null; longName: string | null } | null;
  legGeometry: { points: string | null } | null;
  stopCalls: { stopLocation: { __typename: string; gtfsId?: string; name?: string; lat?: number; lon?: number } }[];
};

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

// ---------- Sorgular ----------

const KALKIS_ALANLARI = `
  scheduledDeparture
  realtimeDeparture
  realtime
  serviceDay
  headsign
  trip { gtfsId route { gtfsId shortName } }
`;

const YAKIN_DURAKLAR = `
query YakinDuraklar($lat: Float!, $lon: Float!) {
  nearest(lat: $lat, lon: $lon, maxDistance: 1000, filterByPlaceTypes: [STOP], first: 8) {
    edges {
      node {
        distance
        place {
          __typename
          ... on Stop {
            gtfsId name code desc lat lon
            kalkislar: stoptimesWithoutPatterns(numberOfDepartures: 3, omitNonPickups: true) { ${KALKIS_ALANLARI} }
          }
        }
      }
    }
  }
}`;

const DURAK_DETAYI = `
query DurakDetayi($id: String!) {
  stop(id: $id) {
    gtfsId name code desc lat lon
    routes { gtfsId shortName longName }
    kalkislar: stoptimesWithoutPatterns(numberOfDepartures: 20, omitNonPickups: true, timeRange: 7200) { ${KALKIS_ALANLARI} }
  }
}`;

const DURAK_ARA = `
query DurakAra($ad: String!) {
  stops(name: $ad) { gtfsId name code desc lat lon }
}`;

const ROTA_PLANLA = `
query RotaPlanla($nereden: PlanLabeledLocationInput!, $nereye: PlanLabeledLocationInput!, $zaman: OffsetDateTime!) {
  planConnection(origin: $nereden, destination: $nereye, dateTime: { earliestDeparture: $zaman }, first: 6) {
    routingErrors { code description }
    edges {
      node {
        start end duration walkTime walkDistance numberOfTransfers
        legs {
          mode duration distance transitLeg headsign
          start { scheduledTime estimated { time } }
          end { scheduledTime estimated { time } }
          from { name lat lon stop { gtfsId } }
          to { name lat lon stop { gtfsId } }
          route { gtfsId shortName longName }
          legGeometry { points }
          stopCalls { stopLocation { __typename ... on Stop { gtfsId name lat lon } } }
        }
      }
    }
  }
}`;

// Sorgu metinleri, geliştirme sırasında şemaya karşı doğrulanabilsin diye dışa açılır.
export const SORGULAR = { YAKIN_DURAKLAR, DURAK_DETAYI, DURAK_ARA, ROTA_PLANLA };

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

export type RotaSonucu = { guzergahlar: Guzergah[]; hatalar: { code: string; description: string }[] };

export async function rotaPlanla(nereden: Konum, nereye: Konum, zaman: string, sinyal?: AbortSignal): Promise<RotaSonucu> {
  type Cevap = {
    planConnection: {
      routingErrors: { code: string; description: string }[];
      edges: ({ node: Guzergah } | null)[] | null;
    } | null;
  };
  const yer = (k: Konum) => ({ label: k.ad, location: { coordinate: { latitude: k.lat, longitude: k.lon } } });
  const veri = await sorgula<Cevap>(ROTA_PLANLA, { nereden: yer(nereden), nereye: yer(nereye), zaman }, sinyal);
  return {
    guzergahlar: (veri.planConnection?.edges ?? []).flatMap((e) => (e ? [e.node] : [])),
    hatalar: veri.planConnection?.routingErrors ?? [],
  };
}

/** Bir toplu taşıma bacağındaki durakları sırasıyla verir (biniş ve iniş dahil, tekrarsız). */
export function bacakDuraklari(bacak: Bacak): { gtfsId: string; ad: string; lat: number; lon: number }[] {
  const liste: { gtfsId: string; ad: string; lat: number; lon: number }[] = [];
  const ekle = (gtfsId: string | undefined, ad: string | null | undefined, lat?: number, lon?: number) => {
    if (!gtfsId || lat == null || lon == null) return;
    if (liste.some((d) => d.gtfsId === gtfsId)) return;
    liste.push({ gtfsId, ad: ad ?? '', lat, lon });
  };
  ekle(bacak.from.stop?.gtfsId, bacak.from.name, bacak.from.lat, bacak.from.lon);
  for (const cagri of bacak.stopCalls ?? []) {
    const d = cagri.stopLocation;
    if (d.__typename === 'Stop') ekle(d.gtfsId, d.name, d.lat, d.lon);
  }
  ekle(bacak.to.stop?.gtfsId, bacak.to.name, bacak.to.lat, bacak.to.lon);
  return liste;
}
