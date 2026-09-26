// OTP'nin GTFS GraphQL sorguları.
//
// Sorgu metinleri burada, ayrı ve bağımlılıksız bir dosyada duruyor: böylece
// scripts/sorgu-dogrula.ts bunları şemaya karşı doğrulayabiliyor. otp.ts'ten
// içe aktarılsalardı doğrulayıcı expo-constants'ı da yüklemek zorunda kalırdı.


// Rozetlerin doğru renk ve simgeyi seçebilmesi için hat sorgularında araç tipi ve renk de istenir.
// agency: minibüs ile dolmuşu ayırmak için gerekiyor; ikisinin de kısa adı güzergâhın tamamı.
const HAT_ALANLARI = `gtfsId shortName longName mode color textColor agency { name }`;

const KALKIS_ALANLARI = `
  scheduledDeparture
  realtimeDeparture
  realtime
  serviceDay
  headsign
  stop { gtfsId }
  trip { gtfsId pattern { code headsign } route { ${HAT_ALANLARI} } }
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
            # Durak bir istasyonun peronuysa kalkışlar istasyonun bütün peronlarından: durak
            # ekranı istasyonu açıyor, liste aynı saatleri göstersin (yolun karşı tarafı dahil).
            parentStation {
              gtfsId name code desc lat lon
              kalkislar: stoptimesWithoutPatterns(numberOfDepartures: 4, omitNonPickups: true) { ${KALKIS_ALANLARI} }
            }
            routes { ${HAT_ALANLARI} }
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
  istasyon: station(id: $id) { ...durakAlanlari }
  stop(id: $id) { ...durakAlanlari }
}

fragment durakAlanlari on Stop {
  gtfsId name code desc lat lon
  routes { ${HAT_ALANLARI} }
  desenler: stoptimesForPatterns(numberOfDepartures: $kalkis, timeRange: $aralik, omitNonPickups: true) {
    pattern {
      code headsign directionId route { ${HAT_ALANLARI} }
      # Yaklaşan otobüs kaç durak uzakta: desenin durak sırası ve üstündeki otobüsler.
      stops { gtfsId name lat lon }
      vehiclePositions { vehicleId label lat lon heading lastUpdate trip { gtfsId } }
    }
    stoptimes { ${KALKIS_ALANLARI} }
  }
}`;

// Durak ekranı için: aynı meydandaki, aynı adı taşıyan başka beslemenin durakları.
// İBB'nin minibüs durağı İETT durağıyla aynı adı taşıyor ama ayrı bir istasyon;
// minibüs hatlarını İETT durağının ekranında da gösterebilmek için soruluyor.
const YAKIN_AYNI_AD = `
query YakinAyniAd($lat: Float!, $lon: Float!, $yaricap: Int!) {
  nearest(lat: $lat, lon: $lon, maxDistance: $yaricap, filterByPlaceTypes: [STOP], first: 30) {
    edges {
      node {
        distance
        place {
          __typename
          ... on Stop {
            gtfsId name lat lon
            parentStation { gtfsId name lat lon }
            routes { ${HAT_ALANLARI} }
          }
        }
      }
    }
  }
}`;

// Duraklar artık istasyon altında toplandı (veri/durak-birlestir.py). stops() hâlâ
// çocukları döndürdüğü için ebeveyn de isteniyor; adı çocuklarıyla tutmayan
// istasyonlar ise yalnız stations() ile geliyor.
const DURAK_ARA = `
query DurakAra($ad: String!) {
  stops(name: $ad) {
    gtfsId name code desc lat lon
    parentStation { gtfsId name code desc lat lon }
  }
  istasyonlar: stations(name: $ad) { gtfsId name code desc lat lon }
}`;

const ROTA_PLANLA = `
query RotaPlanla(
  $nereden: PlanLabeledLocationInput!
  $nereye: PlanLabeledLocationInput!
  $zaman: PlanDateTimeInput!
  $tercihler: PlanPreferencesInput
  $modlar: PlanModesInput
) {
  planConnection(
    origin: $nereden
    destination: $nereye
    # { earliestDeparture } ya da { latestArrival }: "9:00'da orada olmalıyım" aramaları için.
    dateTime: $zaman
    preferences: $tercihler
    modes: $modlar
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
          steps { distance relativeDirection absoluteDirection streetName bogusName stayOn area exit }
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
  }
}`;

// Bir hattın durak deseni. Her yön ayrı bir "pattern" olarak gelir.
const HAT_DETAYI = `
query HatDetayi($id: String!) {
  route(id: $id) {
    ${HAT_ALANLARI}
    patterns {
      code
      name
      headsign
      directionId
      stops { gtfsId name lat lon }
      patternGeometry { points }
    }
  }
}`;

// Hat ekranı: hattın her yönündeki otobüslerin canlı konumu. Durak listesinden ayrı
// soruluyor, çünkü yalnız bu kısım yarım dakikada bir tazeleniyor. Gecikme seferin
// bugünkü canlı saatlerinden okunuyor (arac-konum.ts, seferGecikmesi).
const HAT_ARACLARI = `
query HatAraclari($id: String!, $gun: String!) {
  route(id: $id) {
    patterns {
      code
      vehiclePositions {
        vehicleId label lat lon heading lastUpdate
        trip {
          gtfsId
          stoptimesForDate(serviceDate: $gun) { stop { gtfsId } departureDelay realtime }
        }
      }
    }
  }
}`;

// Yolculuk detayı: bineceğin seferin deseni üzerindeki otobüsler. Ekranda yalnız
// seferi tutan otobüs gösteriliyor ("bineceğin otobüs"), başka sefer değil.
const SEFER_ARACLARI = `
query SeferAraclari($id: String!) {
  trip(id: $id) {
    pattern {
      vehiclePositions { vehicleId label lat lon heading lastUpdate trip { gtfsId } }
    }
  }
}`;

// Ayarlar ekranı: sunucunun hangi veriyi yüklediği ve tarifenin hangi tarihleri kapsadığı.
const SUNUCU_BILGISI = `
query SunucuBilgisi {
  serviceTimeRange { start end }
  feeds { feedId agencies { name } }
}`;

/**
 * Kullanıcının rota arama tercihi.
 *   dengeli   Önerilen: süre, yürüme, aktarma dengesi; raylı sistem ve vapur hafif öncelikli
 *   hizli     En hızlı: yalnız süre
 *   azYurume  Az yürüme
 *   azAktarma Az aktarma
 *   rayli     Raylı sistem ve vapur: otobüs ancak başka yol yoksa
 */
export type RotaTercihi = 'dengeli' | 'hizli' | 'azYurume' | 'azAktarma' | 'rayli';

export const ROTA_TERCIHLERI: RotaTercihi[] = ['dengeli', 'hizli', 'azYurume', 'azAktarma', 'rayli'];

export type RotaSecenekleri = { tercih: RotaTercihi; erisilebilir: boolean };

export const VARSAYILAN_SECENEKLER: RotaSecenekleri = { tercih: 'dengeli', erisilebilir: false };

/** Diskten okunan tercih bilinmiyorsa (eski sürüm, bozuk kayıt) varsayılana döner. */
export function secenekleriDuzelt(ham: Partial<RotaSecenekleri> | null | undefined): RotaSecenekleri {
  const tercih = ROTA_TERCIHLERI.includes(ham?.tercih as RotaTercihi) ? (ham!.tercih as RotaTercihi) : 'dengeli';
  return { tercih, erisilebilir: !!ham?.erisilebilir };
}

/**
 * Bir rotada toplam yürüyüşün üst sınırı (saniye). Bunu aşan rotalar listelenmez;
 * hiçbir rota sınırın altında kalmazsa en az yürüyenler bir notla gösterilir.
 */
export const EN_COK_YURUME_SN = 20 * 60;

/**
 * Metro, Marmaray, tramvay ya da vapur içeren rotalarda yürüme sınırı. İstasyonlar
 * duraklardan seyrek: Bağcılar Göztepe Mh.'den en yakın metro 11–19 dk yürüme, metrolu
 * rotanın toplam yürüyüşü 24–25 dk tutuyor ve 20 dk sınırı onları hep eliyordu.
 */
export const EN_COK_YURUME_RAYLI_SN = 30 * 60;

// OTP'nin varsayılanları: yürüme isteksizliği 2.0, aktarma bedeli 0.
// Aşağıdaki değerler bu varsayılanların üzerine biniyor.
const YURUME_ISTEKSIZLIGI = 5.0;
const AKTARMA_BEDELI = 900; // saniye cinsinden ceza: bir aktarma 15 dakikaya bedel sayılır

/**
 * Otobüsün isteksizliği (1 = diğer araçlarla eşit). Tarife otobüsün trafiğe takıldığını
 * bilmiyor; aynı süreli iki rotadan metrolusu gerçekte daha güvenilir. Önerilen aramada
 * hafif (1,3), "raylı sistem" tercihinde güçlü (3) bir kayırma.
 */
const OTOBUS_HAFIF = 1.3;
const OTOBUS_GUCLU = 3.0;
const TUM_KIPLER = ['BUS', 'TROLLEYBUS', 'COACH', 'RAIL', 'SUBWAY', 'TRAM', 'MONORAIL', 'FERRY', 'FUNICULAR', 'GONDOLA', 'CABLE_CAR'];

/** Otobüsü `isteksizlik` kadar pahalı sayan araç kipleri (öbür kipler 1). */
function otobusIsteksiz(isteksizlik: number): Record<string, unknown> {
  return {
    transit: {
      transit: TUM_KIPLER.map((mode) => ({
        mode,
        cost: { reluctance: ['BUS', 'TROLLEYBUS', 'COACH'].includes(mode) ? isteksizlik : 1 },
      })),
    },
  };
}

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

/** Bir OTP araması: tercihler ve araç kipleri (null = sunucu varsayılanı). */
export type RotaAramasi = { tercihler: Record<string, unknown> | null; modlar: Record<string, unknown> | null };

/**
 * Bir tercih için yapılacak aramalar. Önerilen aramada iki arama birleşiyor: raylıyı
 * hafif kayıran ve kayırmayan. OTP tek aramada 12 rota veriyor ama çoğu aynı hattın
 * sonraki seferleri; iki arama farklı araç karışımlarını birlikte getiriyor.
 */
export function aramalariYap(secenekler: RotaSecenekleri): RotaAramasi[] {
  const tercihler = tercihleriYap(secenekler);
  switch (secenekler.tercih) {
    case 'dengeli':
      // Üçüncü arama raylıyı güçlü kayırıyor: en iyi raylı seçenek her zaman elde olsun
      // (listede ilk üçe konuyor, bkz. rota-secimi.ts).
      return [
        { tercihler, modlar: otobusIsteksiz(OTOBUS_HAFIF) },
        { tercihler, modlar: null },
        { tercihler, modlar: otobusIsteksiz(OTOBUS_GUCLU) },
      ];
    case 'rayli':
      return [
        { tercihler, modlar: otobusIsteksiz(OTOBUS_GUCLU) },
        { tercihler, modlar: otobusIsteksiz(OTOBUS_HAFIF) },
      ];
    default:
      return [{ tercihler, modlar: null }];
  }
}

// Sorgu metinleri, geliştirme sırasında şemaya karşı doğrulanabilsin diye dışa açılır.
export const SORGULAR = {
  YAKIN_DURAKLAR,
  DURAK_DETAYI,
  DURAK_SAATLERI,
  YAKIN_AYNI_AD,
  DURAK_ARA,
  ROTA_PLANLA,
  HAT_KALKISLARI,
  HATLAR,
  HAT_DETAYI,
  HAT_ARACLARI,
  SEFER_ARACLARI,
  SUNUCU_BILGISI,
};
