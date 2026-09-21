// Canlı araç kayıtlarını GTFS-RT'ye çevirir.
//
// İki akış üretiliyor:
//   • VehiclePosition — aracın nerede olduğu. Haritada "otobüs şu an burada".
//   • TripUpdate      — seferin tarifeden ne kadar saptığı. Rota sürelerini ve
//                       varış tahminlerini düzelten asıl akış budur.
//
// Aracın hangi seferi yaptığı tarife.mjs'teki çıkarımla bulunuyor. Bir kere
// bulunduktan sonra araç o seferde **tutuluyor**: yoksa 10 dakika geciken bir otobüs
// her taramada "bir sonraki seferin aracı" sanılır ve gecikme hiç görünmez.

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

import { enYakinDurak, gununServisleri, seferBul } from './tarife.mjs';

const { FeedMessage, FeedHeader, TripDescriptor, VehiclePosition, TripUpdate } =
  GtfsRealtimeBindings.transit_realtime;

/** Bir seferin belirli bir duraktaki planlanan saati; sefer o duraktan geçmiyorsa null. */
function planlananSaat(tarife, seferIdx, durakIdx) {
  for (let i = tarife.durakBas[durakIdx]; i < tarife.durakBas[durakIdx + 1]; i++) {
    if (tarife.sSefer[i] === seferIdx) return { saniye: tarife.sSaniye[i], sira: tarife.sSira[i] };
  }
  return null;
}

/**
 * Zaman alanını çözer. Filo servisi yalnızca "16:38:55" veriyor (tarihsiz),
 * hat servisi ise "2026-09-21 16:38:49". İkisini de kabul ediyoruz.
 */
function zamaniCoz(metin, simdi = new Date()) {
  const d = String(metin ?? '').trim();
  const tam = d.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (tam) {
    const [, y, ay, g, s, dk, sn] = tam.map(Number);
    return { tarih: new Date(y, ay - 1, g, s, dk, sn), saniye: s * 3600 + dk * 60 + sn };
  }
  const yalniz = d.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!yalniz) return null;
  const [, s, dk, sn] = yalniz.map(Number);
  const tarih = new Date(simdi);
  tarih.setHours(s, dk, sn, 0);
  // Gece yarısını yeni geçtiysek "23:59" dünden kalmadır.
  if (tarih - simdi > 12 * 3600 * 1000) tarih.setDate(tarih.getDate() - 1);
  return { tarih, saniye: s * 3600 + dk * 60 + sn };
}

const GUN = 86_400;

/** İki saniye değeri arasındaki farkı gece yarısını aşarak hesaplar. */
function fark(a, b) {
  let f = a - b;
  if (f > GUN / 2) f -= GUN;
  else if (f < -GUN / 2) f += GUN;
  return f;
}

/**
 * Araçların sefer atamasını turlar arasında saklar.
 * Anahtar: kapı numarası (araç kimliği).
 */
export class SeferHafizasi {
  constructor(unutmaSn = 15 * 60) {
    this.kayit = new Map();
    this.unutmaSn = unutmaSn;
  }

  al(kapiNo, rotaIdx) {
    const k = this.kayit.get(kapiNo);
    if (!k) return null;
    if (k.rota !== rotaIdx) return null; // araç hat değiştirmiş
    return k;
  }

  koy(kapiNo, rotaIdx, seferIdx, sira, an) {
    this.kayit.set(kapiNo, { rota: rotaIdx, sefer: seferIdx, sira, an });
  }

  temizle(simdi) {
    for (const [kapi, k] of this.kayit) {
      if ((simdi - k.an) / 1000 > this.unutmaSn) this.kayit.delete(kapi);
    }
  }
}

/**
 * Canlı araç kayıtlarını eşleştirir.
 *
 * Girdi, filo servisinden gelen kayıtlar: kapı numarası, enlem, boylam, saat.
 * Hat bilgisi taramadan (`tarayici`) geliyor, durak ise konumdan hesaplanıyor —
 * filo servisi durak kodu vermiyor.
 *
 * @returns {{eslesenler: object[], sayac: object}}
 */
export function araclariEslestir(tarife, araclar, hafiza, tarayici, simdi = new Date()) {
  const aktif = gununServisleri(tarife, simdi);
  const eslesenler = [];
  const sayac = { toplam: 0, hatBilinmiyor: 0, rotaYok: 0, durakYok: 0, seferYok: 0, surdurulen: 0, yeni: 0, eskimis: 0 };

  for (const a of araclar) {
    sayac.toplam++;
    const kapiNo = String(a.kapiNo ?? '').trim();
    const guzergah = kapiNo ? tarayici.guzergah(kapiNo) : null;
    if (!guzergah) {
      sayac.hatBilinmiyor++;
      continue;
    }
    const rotaIdx = tarife.guzergahtanRota.get(guzergah);
    if (rotaIdx === undefined) {
      sayac.rotaYok++;
      continue;
    }
    if (!Number.isFinite(a.enlem) || !Number.isFinite(a.boylam)) {
      sayac.durakYok++;
      continue;
    }
    const yakin = enYakinDurak(tarife, rotaIdx, a.enlem, a.boylam);
    if (!yakin) {
      // Araç güzergâhın 400 metre dışında: ya garajda ya da eşleme eskimiş.
      sayac.durakYok++;
      continue;
    }
    const durakIdx = yakin.durak;
    const zaman = zamaniCoz(a.saat, simdi);
    if (!zaman) {
      sayac.eskimis++;
      continue;
    }
    // Çok eski kayıtlar yanıltıcı; 10 dakikadan eskisini yok sayıyoruz.
    if ((simdi - zaman.tarih) / 1000 > 600) {
      sayac.eskimis++;
      continue;
    }

    let secilen = null;

    // 1) Araç zaten bir sefere bağlıysa ve o sefer bu duraktan geçiyorsa, seferde kal.
    const onceki = kapiNo ? hafiza.al(kapiNo, rotaIdx) : null;
    if (onceki) {
      const plan = planlananSaat(tarife, onceki.sefer, durakIdx);
      // Durak sırası geriye gitmemeli: gittiyse araç yeni bir tura başlamış demektir.
      if (plan && plan.sira >= onceki.sira - 1) {
        secilen = { sefer: onceki.sefer, planlanan: plan.saniye, sira: plan.sira, surduruldu: true };
        sayac.surdurulen++;
      }
    }

    // 2) Değilse şu ana en yakın planlı seferi seç.
    if (!secilen) {
      const bulunan = seferBul(tarife, rotaIdx, durakIdx, zaman.saniye, aktif);
      if (!bulunan) {
        sayac.seferYok++;
        continue;
      }
      secilen = { ...bulunan, surduruldu: false };
      sayac.yeni++;
    }

    if (kapiNo) hafiza.koy(kapiNo, rotaIdx, secilen.sefer, secilen.sira, simdi);

    eslesenler.push({
      kapiNo: kapiNo || `arac-${eslesenler.length}`,
      seferId: tarife.seferAd[secilen.sefer],
      rotaId: tarife.rotaAd[rotaIdx],
      yon: tarife.seferYon[secilen.sefer],
      durakId: tarife.durakAd[durakIdx],
      sira: secilen.sira,
      // Gecikme: gözlem anı − planlanan an. Pozitif = geç kalmış.
      gecikme: fark(zaman.saniye, secilen.planlanan),
      enlem: a.enlem,
      boylam: a.boylam,
      damga: Math.floor(zaman.tarih.getTime() / 1000),
      durakMesafe: Math.round(yakin.metre),
    });
  }

  hafiza.temizle(simdi);
  return { eslesenler, sayac };
}

function baslik(simdi) {
  return FeedHeader.create({
    gtfsRealtimeVersion: '2.0',
    incrementality: FeedHeader.Incrementality.FULL_DATASET,
    timestamp: Math.floor(simdi.getTime() / 1000),
  });
}

function seferTanimi(e) {
  return TripDescriptor.create({
    tripId: e.seferId,
    routeId: e.rotaId,
    directionId: e.yon,
    scheduleRelationship: TripDescriptor.ScheduleRelationship.SCHEDULED,
  });
}

/** Araç konumları akışı (GTFS-RT protobuf). */
export function konumAkisi(eslesenler, simdi = new Date()) {
  const entity = eslesenler
    .filter((e) => Number.isFinite(e.enlem) && Number.isFinite(e.boylam))
    .map((e) => ({
      id: `arac-${e.kapiNo}`,
      vehicle: VehiclePosition.create({
        trip: seferTanimi(e),
        vehicle: { id: e.kapiNo, label: e.kapiNo },
        position: { latitude: e.enlem, longitude: e.boylam },
        currentStopSequence: e.sira,
        stopId: e.durakId,
        currentStatus: VehiclePosition.VehicleStopStatus.IN_TRANSIT_TO,
        timestamp: e.damga,
      }),
    }));
  return FeedMessage.encode(FeedMessage.create({ header: baslik(simdi), entity })).finish();
}

/**
 * Sefer güncellemeleri akışı: aracın bulunduğu duraktaki gecikme.
 * OTP bu gecikmeyi seferin geri kalanına kendisi yayıyor, o yüzden tek durak yeterli.
 */
export function gecikmeAkisi(eslesenler, simdi = new Date()) {
  // Aynı sefere birden çok araç düşerse en ileri olanı alıyoruz: tarifeyi o belirler.
  const enIyi = new Map();
  for (const e of eslesenler) {
    const v = enIyi.get(e.seferId);
    if (!v || e.sira > v.sira) enIyi.set(e.seferId, e);
  }

  const entity = [...enIyi.values()].map((e) => ({
    id: `sefer-${e.seferId}`,
    tripUpdate: TripUpdate.create({
      trip: seferTanimi(e),
      vehicle: { id: e.kapiNo, label: e.kapiNo },
      stopTimeUpdate: [
        {
          stopSequence: e.sira,
          stopId: e.durakId,
          arrival: { delay: e.gecikme },
          departure: { delay: e.gecikme },
          scheduleRelationship: TripUpdate.StopTimeUpdate.ScheduleRelationship.SCHEDULED,
        },
      ],
      timestamp: e.damga,
    }),
  }));
  return FeedMessage.encode(FeedMessage.create({ header: baslik(simdi), entity })).finish();
}
