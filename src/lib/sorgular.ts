// OTP'nin GTFS GraphQL sorguları.
//
// Sorgu metinleri burada, ayrı ve bağımlılıksız bir dosyada duruyor: böylece
// scripts/sorgu-dogrula.ts bunları şemaya karşı doğrulayabiliyor. otp.ts'ten
// içe aktarılsalardı doğrulayıcı expo-constants'ı da yüklemek zorunda kalırdı.


// Rozetlerin doğru renk ve simgeyi seçebilmesi için hat sorgularında araç tipi ve renk de istenir.
const HAT_ALANLARI = `gtfsId shortName longName mode color textColor`;

const KALKIS_ALANLARI = `
  scheduledDeparture
  realtimeDeparture
  realtime
  serviceDay
  headsign
  trip { gtfsId route { ${HAT_ALANLARI} } }
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
    routes { ${HAT_ALANLARI} }
    kalkislar: stoptimesWithoutPatterns(numberOfDepartures: 20, omitNonPickups: true, timeRange: 7200) { ${KALKIS_ALANLARI} }
  }
}`;

// Bir duraktan belirli bir hattın bugünkü kalkışları. Sefer sıklığını ve günün son seferini
// buradan hesaplıyoruz: OTP'nin GTFS API'sinde frekans (headway) alanı yok, ama frekans tabanlı
// seferler ayrı ayrı kalkışlar olarak görünüyor; aralarındaki farktan sıklık çıkıyor.
const HAT_KALKISLARI = `
query HatKalkislari($durak: String!, $aralik: Int!) {
  stop(id: $durak) {
    kalkislar: stoptimesWithoutPatterns(numberOfDepartures: 60, timeRange: $aralik, omitNonPickups: true) {
      scheduledDeparture
      realtimeDeparture
      serviceDay
      headsign
      trip { gtfsId route { gtfsId shortName } }
    }
  }
}`;

// Durak ekranı: o duraktan geçen her hattın kendi yönüyle birlikte sıradaki kalkışları.
// stoptimesWithoutPatterns hepsini tek listede karıştırdığı için kalabalık duraklarda
// bazı hatlar hiç görünmüyor; desen başına sormak her hatta yer garantiliyor.
const DURAK_SAATLERI = `
query DurakSaatleri($id: String!, $kalkis: Int!, $aralik: Int!) {
  stop(id: $id) {
    gtfsId name code desc lat lon
    routes { ${HAT_ALANLARI} }
    desenler: stoptimesForPatterns(numberOfDepartures: $kalkis, timeRange: $aralik, omitNonPickups: true) {
      pattern { code headsign directionId route { ${HAT_ALANLARI} } }
      stoptimes { ${KALKIS_ALANLARI} }
    }
  }
}`;

const DURAK_ARA = `
query DurakAra($ad: String!) {
  stops(name: $ad) { gtfsId name code desc lat lon }
}`;

const ROTA_PLANLA = `
query RotaPlanla(
  $nereden: PlanLabeledLocationInput!
  $nereye: PlanLabeledLocationInput!
  $zaman: OffsetDateTime!
  $tercihler: PlanPreferencesInput
) {
  planConnection(
    origin: $nereden
    destination: $nereye
    dateTime: { earliestDeparture: $zaman }
    preferences: $tercihler
    first: 12
  ) {
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
          route { ${HAT_ALANLARI} }
          legGeometry { points }
          trip { gtfsId pattern { stops { gtfsId name lat lon } } }
        }
      }
    }
  }
}`;

// Hatlar sekmesi: bütün hatlar bir kez çekilir, süzme ve arama telefonda yapılır.
const HATLAR = `
query Hatlar {
  routes {
    ${HAT_ALANLARI}
    agency { name }
  }
}`;

// Bir hattın durak deseni. Her yön ayrı bir "pattern" olarak gelir.
const HAT_DETAYI = `
query HatDetayi($id: String!) {
  route(id: $id) {
    ${HAT_ALANLARI}
    agency { name }
    patterns {
      code
      name
      headsign
      directionId
      stops { gtfsId name lat lon }
    }
  }
}`;

// Ayarlar ekranı: sunucunun hangi veriyi yüklediği ve tarifenin hangi tarihleri kapsadığı.
const SUNUCU_BILGISI = `
query SunucuBilgisi {
  serviceTimeRange { start end }
  feeds { feedId agencies { name } }
}`;

/** Kullanıcının rota arama tercihi. */
export type RotaTercihi = 'dengeli' | 'azYurume' | 'azAktarma';

export type RotaSecenekleri = { tercih: RotaTercihi; erisilebilir: boolean };

export const VARSAYILAN_SECENEKLER: RotaSecenekleri = { tercih: 'dengeli', erisilebilir: false };

// OTP'nin varsayılanları: yürüme isteksizliği 2.0, aktarma bedeli 0.
// Aşağıdaki değerler bu varsayılanların üzerine biniyor.
const YURUME_ISTEKSIZLIGI = 5.0;
const AKTARMA_BEDELI = 1200; // saniye cinsinden ceza: bir aktarma 20 dakikaya bedel sayılır

/**
 * Seçenekleri OTP'nin `PlanPreferencesInput` yapısına çevirir.
 * Hiçbir tercih seçilmediyse null döner; o zaman sunucunun kendi varsayılanları geçerli olur.
 */
export function tercihleriYap(secenekler: RotaSecenekleri): Record<string, unknown> | null {
  const tercihler: Record<string, unknown> = {};
  if (secenekler.tercih === 'azYurume') {
    tercihler.street = { walk: { reluctance: YURUME_ISTEKSIZLIGI } };
  }
  if (secenekler.tercih === 'azAktarma') {
    tercihler.transit = { transfer: { cost: AKTARMA_BEDELI } };
  }
  if (secenekler.erisilebilir) {
    tercihler.accessibility = { wheelchair: { enabled: true } };
  }
  return Object.keys(tercihler).length ? tercihler : null;
}

// Sorgu metinleri, geliştirme sırasında şemaya karşı doğrulanabilsin diye dışa açılır.
export const SORGULAR = {
  YAKIN_DURAKLAR,
  DURAK_DETAYI,
  DURAK_SAATLERI,
  DURAK_ARA,
  ROTA_PLANLA,
  HAT_KALKISLARI,
  HATLAR,
  HAT_DETAYI,
  SUNUCU_BILGISI,
};
