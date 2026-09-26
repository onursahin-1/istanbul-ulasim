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

import { enYakinDurak, gununServisleri, seferBul, seferDuraklari } from './tarife.mjs';
import { koridoraGoreSuz, yonluAdaylar } from './yon.mjs';

/**
 * Taramanın verdiği güzergâh kodu bu kadar süre doğrudan kullanılır. Sonrasında
 * araç büyük ihtimalle yön değiştirmiştir; yalnız hattı kullanılır, yön hareketten
 * çıkarılır.
 */
export const TAZE_GUZERGAH_MS = 20 * 60_000;

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
 * Aracın konumuna göre seferin **o noktadaki** planlanan saati.
 *
 * Eskiden gecikme en yakın durağın saatine göre ölçülüyordu. Araç o durağa henüz
 * varmamışsa (400 m geride) gözlem anı planın gerisinde kalıyor, gecikme olduğundan
 * küçük, hatta "erken" çıkıyordu; durağı geçmişse tersine büyük. Tahmin edilen
 * varışlar bu yüzden durak arası sürenin yarısı kadar oynuyordu.
 *
 * Şimdi araç iki durak arasına yerleştiriliyor: önceki ve sonraki durağı birleştiren
 * doğruya izdüşümü `t` (0 = önceki durak, 1 = sonraki). Plan bu iki durağın saati
 * arasında doğrusal. Yayımlanan güncelleme de sıradaki durak için: "oraya planlanan
 * saat + gecikme ile varır".
 *
 * @returns {{planlanan:number, durak:number, sira:number, konum:number, t:number}|null}
 *   konum: durak sırası cinsinden sürekli yer (12.4 = 12. ile 13. durak arasının %40'ı)
 */
export function konumdakiPlan(tarife, seferIdx, durakIdx, enlem, boylam) {
  const liste = seferDuraklari(tarife, seferIdx);
  const i = liste.findIndex((d) => d.durak === durakIdx);
  if (i < 0) return null;
  const yakin = liste[i];
  const onceki = liste[i - 1] ?? null;
  const sonraki = liste[i + 1] ?? null;

  const olcek = Math.cos((enlem * Math.PI) / 180);
  const xy = (d) => [(tarife.durakBoylam[d] - boylam) * olcek, tarife.durakEnlem[d] - enlem];
  /** Aracın a→b doğrusundaki izdüşümü ve doğruya uzaklığının karesi. */
  const izdusum = (a, b) => {
    const [ax, ay] = xy(a.durak);
    const [bx, by] = xy(b.durak);
    const dx = bx - ax;
    const dy = by - ay;
    const uz = dx * dx + dy * dy;
    const t = uz > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / uz)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    return { a, b, t, uzaklik: px * px + py * py };
  };
  const adaylar = [onceki && izdusum(onceki, yakin), sonraki && izdusum(yakin, sonraki)].filter(Boolean);
  if (!adaylar.length) {
    return { planlanan: yakin.saniye, durak: yakin.durak, sira: yakin.sira, konum: yakin.sira, t: 1 };
  }
  // Aracın asıl bulunduğu aralık doğruya en yakın olanı. Eşitlikte (tam durakta) ileridekini
  // seç ki güncelleme geçilmiş bir durağa yazılmasın.
  adaylar.sort((x, y) => x.uzaklik - y.uzaklik || y.a.sira - x.a.sira);
  const { a, b, t } = adaylar[0];
  const planlanan = Math.round(a.saniye + t * fark(b.saniye, a.saniye));
  return { planlanan, durak: b.durak, sira: b.sira, konum: a.sira + t * (b.sira - a.sira), t };
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

/**
 * Makul gecikme aralığı. Dışındaki eşleşmeler yayımlanmıyor.
 *
 * Eşleştirme aracı o durağa şu ana en yakın saatte uğrayan sefere bağlıyor. Fark
 * çok büyükse o saatte o duraktan hiç sefer geçmiyor demektir: araç büyük
 * ihtimalle yolcu almadan garaja dönüyor ya da komşu bir sefere bağlandı. Gerçek
 * örnekte 277 araçtan 4'ü böyleydi (-38, -19, -10, +40 dk); ikisi aynı sefere
 * düşmüştü. OTP gecikmeyi seferin geri kalanına yaydığı için tek bir yanlış değer
 * bütün varış tahminlerini kaydırıyor — hiç göndermemek daha iyi.
 *
 * Erkene sınır daha dar: şoförler duraklarda bekleyerek erken gitmeyi önlüyor,
 * trafikte geç kalmak ise sık.
 */
export const EN_ERKEN_SN = 10 * 60;
export const EN_GEC_SN = 30 * 60;

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

  /** Aracın son bağlandığı sefer; hangi rotada olduğu kayıtta. */
  al(kapiNo) {
    return this.kayit.get(kapiNo) ?? null;
  }

  koy(kapiNo, rotaIdx, seferIdx, sira, an) {
    this.kayit.set(kapiNo, { rota: rotaIdx, sefer: seferIdx, sira, an });
  }

  unut(kapiNo) {
    this.kayit.delete(kapiNo);
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
 * Aracın seferi üç yoldan biriyle bulunuyor, bu sırayla:
 *
 *  1. Araç önceki nabızda bir sefere bağlandıysa ve hâlâ o seferin güzergâhında
 *     ilerliyorsa, o seferde kalır. En güvenilir yol; araçların çoğu buradan geçer.
 *  2. Tarama aracın güzergâh kodunu yakın zamanda verdiyse (TAZE_GUZERGAH_MS) o
 *     güzergâh kullanılır.
 *  3. Yalnız hattı biliniyorsa, hattın varyantlarından aracın ilerlediği yöndekiler
 *     aday olur (yon.mjs) ve saati en iyi tutan sefer seçilir.
 *
 * @param {object} iz KonumIzi — aracın bir önceki konumu (yön çıkarımı için)
 * @returns {{eslesenler: object[], sayac: object}}
 */
export function araclariEslestir(tarife, araclar, hafiza, tarayici, simdi = new Date(), iz = null) {
  const aktif = gununServisleri(tarife, simdi);
  const an = simdi.getTime();
  const eslesenler = [];
  const sayac = {
    toplam: 0, hatBilinmiyor: 0, rotaYok: 0, durakYok: 0, yonBilinmiyor: 0, seferYok: 0,
    surdurulen: 0, tazeGuzergah: 0, yondenBulunan: 0, eskimis: 0, makulDisi: 0,
    ayrilan: 0, cakisan: 0,
  };
  /** Sefere bağlanan araçlar; aynı sefere düşenler aşağıda ayrıştırılıyor. */
  const adaylar = [];

  for (const a of araclar) {
    sayac.toplam++;
    const kapiNo = String(a.kapiNo ?? '').trim();
    if (!Number.isFinite(a.enlem) || !Number.isFinite(a.boylam)) {
      sayac.durakYok++;
      continue;
    }
    const zaman = zamaniCoz(a.saat, simdi);
    // Çok eski kayıtlar yanıltıcı; 10 dakikadan eskisini yok sayıyoruz.
    if (!zaman || (simdi - zaman.tarih) / 1000 > 600) {
      sayac.eskimis++;
      continue;
    }
    // Önceki konum, güncellemeden önce okunmalı.
    const onceki = kapiNo && iz ? iz.onceki(kapiNo, an) : null;
    if (kapiNo && iz) iz.guncelle(kapiNo, a.enlem, a.boylam, an);

    let secilen = null;
    let rotaIdx = null;
    let durakIdx = null;
    let metre = null;

    // 1) Önceki seferinde kal.
    const kayit = kapiNo ? hafiza.al(kapiNo) : null;
    if (kayit) {
      const yakin = enYakinDurak(tarife, kayit.rota, a.enlem, a.boylam);
      const plan = yakin ? planlananSaat(tarife, kayit.sefer, yakin.durak) : null;
      // Durak sırası geriye gitmemeli: gittiyse araç yeni bir tura başlamış demektir.
      if (plan && plan.sira >= kayit.sira - 1) {
        secilen = { sefer: kayit.sefer, planlanan: plan.saniye, sira: plan.sira };
        rotaIdx = kayit.rota;
        durakIdx = yakin.durak;
        metre = yakin.metre;
        sayac.surdurulen++;
      }
    }

    if (!secilen) {
      const bilgi = kapiNo ? tarayici.bilgi(kapiNo) : null;
      if (!bilgi) {
        sayac.hatBilinmiyor++;
        continue;
      }

      let adaylar;
      let yoldan;
      const tazeRota = bilgi.guzergah && an - bilgi.an <= TAZE_GUZERGAH_MS
        ? tarife.guzergahtanRota.get(String(bilgi.guzergah).toUpperCase())
        : undefined;
      if (tazeRota !== undefined) {
        // 2) Taze güzergâh kodu.
        const yakin = enYakinDurak(tarife, tazeRota, a.enlem, a.boylam);
        if (!yakin) {
          // Araç güzergâhın dışında: ya garajda ya da eşleme eskimiş.
          sayac.durakYok++;
          continue;
        }
        adaylar = [{ rota: tazeRota, durak: yakin.durak, metre: yakin.metre }];
        yoldan = 'tazeGuzergah';
      } else {
        // 3) Hat biliniyor, yön hareketten.
        const hatRotalari = tarife.kisaAdtanRotalar.get(String(bilgi.hat ?? '').trim().toUpperCase());
        if (!hatRotalari?.length) {
          sayac.rotaYok++;
          continue;
        }
        if (!onceki) {
          sayac.yonBilinmiyor++;
          continue;
        }
        adaylar = yonluAdaylar(tarife, hatRotalari, onceki, a);
        if (!adaylar.length) {
          sayac.yonBilinmiyor++;
          continue;
        }
        // Bayat güzergâh kodu yönü söylemez ama koridoru söyler.
        const bayatRota = bilgi.guzergah ? tarife.guzergahtanRota.get(String(bilgi.guzergah).toUpperCase()) : undefined;
        adaylar = koridoraGoreSuz(tarife, adaylar, bayatRota);
        yoldan = 'yondenBulunan';
      }

      // Adaylar arasında saati en iyi tutan sefer.
      let enIyi = null;
      for (const aday of adaylar) {
        const bulunan = seferBul(tarife, aday.rota, aday.durak, zaman.saniye, aktif);
        if (bulunan && (!enIyi || Math.abs(bulunan.sapma) < Math.abs(enIyi.bulunan.sapma))) {
          enIyi = { aday, bulunan };
        }
      }
      if (!enIyi) {
        sayac.seferYok++;
        continue;
      }
      secilen = enIyi.bulunan;
      rotaIdx = enIyi.aday.rota;
      durakIdx = enIyi.aday.durak;
      metre = enIyi.aday.metre;
      sayac[yoldan]++;
    }

    adaylar.push({ a, kapiNo, zaman, secilen, rotaIdx, durakIdx, metre, kayit });
  }

  // Aynı sefere birden çok araç düşmüşse (Metrobüste tarifedeki seferler 1–2 dk arayla,
  // en yakın saat çakışıyor) sefer tarifeye en yakın olanda kalır; öbürleri kendi
  // durağından geçen, henüz kimseye verilmemiş en yakın sefere bağlanır. Eskiden
  // arkadaki araç aynı seferde kalıyor ve gecikme akışına hiç girmiyordu.
  seferleriAyristir(tarife, adaylar, aktif, sayac);

  for (const { a, kapiNo, zaman, secilen, rotaIdx, durakIdx, metre, kayit } of adaylar) {
    // Gecikme: gözlem anı − aracın bulunduğu noktadaki planlanan an. Pozitif = geç kalmış.
    const yerPlan = konumdakiPlan(tarife, secilen.sefer, durakIdx, a.enlem, a.boylam);
    const gecikme = fark(zaman.saniye, yerPlan?.planlanan ?? secilen.planlanan);
    if (gecikme < -EN_ERKEN_SN || gecikme > EN_GEC_SN) {
      sayac.makulDisi++;
      // Hafızadaki sefer artık tutmuyorsa unut; bir sonraki turda baştan eşlensin.
      if (kapiNo) hafiza.unut(kapiNo);
      continue;
    }

    // Hafızada en yakın durağın sırası: bir sonraki turda geri gidiş denetimi onunla.
    if (kapiNo) hafiza.koy(kapiNo, rotaIdx, secilen.sefer, secilen.sira, simdi);

    eslesenler.push({
      kapiNo: kapiNo || `arac-${eslesenler.length}`,
      seferId: tarife.seferAd[secilen.sefer],
      rotaId: tarife.rotaAd[rotaIdx],
      yon: tarife.seferYon[secilen.sefer],
      // Güncelleme sıradaki durak için (araç ona doğru gidiyor).
      durakId: tarife.durakAd[yerPlan?.durak ?? durakIdx],
      sira: yerPlan?.sira ?? secilen.sira,
      gecikme,
      // Ölçüm için (kalite.mjs): eski yöntemin gecikmesi ve araç yerinin ayrıntısı.
      eskiGecikme: fark(zaman.saniye, secilen.planlanan),
      seferIdx: secilen.sefer,
      rotaIdx,
      konum: yerPlan?.konum ?? secilen.sira,
      planlanan: yerPlan?.planlanan ?? secilen.planlanan,
      yakinPlan: secilen.planlanan,
      yoldan: kayit && secilen.sefer === kayit.sefer ? 'surdurulen' : 'yeni',
      enlem: a.enlem,
      boylam: a.boylam,
      damga: Math.floor(zaman.tarih.getTime() / 1000),
      durakMesafe: Math.round(metre),
    });
  }

  hafiza.temizle(simdi);
  iz?.temizle(an);
  return { eslesenler, sayac };
}

/** İki aday aynı seferde eşitse sürdüren kalır: bu kadar saniyelik fark "eşit" sayılır. */
const SURDURME_PAYI_SN = 60;

/**
 * Her sefer en çok bir araca. Çakışan grupta tarifeye en yakın (|sapma| en küçük) araç
 * seferde kalır; fark SURDURME_PAYI_SN içindeyse önceki nabızda da o seferde olan kalır
 * (araç iki sefer arasında gidip gelmesin). Kalanlar alınmamış en yakın sefere geçer;
 * bulunamayan aday düşer. `adaylar` yerinde değişir.
 */
export function seferleriAyristir(tarife, adaylar, aktif, sayac = {}) {
  const gruplar = new Map();
  for (const x of adaylar) {
    const g = gruplar.get(x.secilen.sefer) ?? [];
    g.push(x);
    gruplar.set(x.secilen.sefer, g);
  }
  const alinan = new Set(gruplar.keys());
  const dusen = new Set();
  const sapma = (x) => Math.abs(fark(x.zaman.saniye, x.secilen.planlanan));
  const surduruyor = (x) => !!x.kayit && x.kayit.sefer === x.secilen.sefer;
  for (const g of gruplar.values()) {
    if (g.length < 2) continue;
    g.sort((p, q) => {
      const d = sapma(p) - sapma(q);
      if (Math.abs(d) >= SURDURME_PAYI_SN) return d;
      return Number(surduruyor(q)) - Number(surduruyor(p)) || d;
    });
    for (const x of g.slice(1)) {
      const yeni = seferBul(tarife, x.rotaIdx, x.durakIdx, x.zaman.saniye, aktif, 45 * 60, alinan);
      if (yeni) {
        alinan.add(yeni.sefer);
        x.secilen = yeni;
        sayac.ayrilan = (sayac.ayrilan ?? 0) + 1;
      } else {
        dusen.add(x);
        sayac.cakisan = (sayac.cakisan ?? 0) + 1;
      }
    }
  }
  if (dusen.size) {
    const kalan = adaylar.filter((x) => !dusen.has(x));
    adaylar.length = 0;
    adaylar.push(...kalan);
  }
  return adaylar;
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
