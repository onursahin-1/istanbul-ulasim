// OpenTripPlanner (rota motoru) ile konuşan katman.
// Sorgular OTP 2.10'un GTFS GraphQL şemasına göre yazıldı: /otp/gtfs/v1

import Constants from 'expo-constants';

import type { HamAdim } from './yuruyus';

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

/**
 * Canlı veri köprüsünün adresi (kopru/): OTP ile aynı bilgisayarda, 8082'de.
 * EXPO_PUBLIC_KOPRU_URL ile ayrıca verilebilir.
 */
export const KOPRU_ADRESI = (
  process.env.EXPO_PUBLIC_KOPRU_URL ?? OTP_ADRESI.replace(/:8080$/, ':8082')
).replace(/\/+$/, '');

export class OtpHatasi extends Error {}

// Sorgu metinleri ayrı dosyada; oradan içe aktarılıp buradan yeniden dışa açılıyor.
export { SORGULAR, VARSAYILAN_SECENEKLER, secenekleriDuzelt, tercihleriYap } from './sorgular';
// Bacak yardımcıları bağımlılıksız bir dosyada; çağrı yerleri değişmesin diye buradan da açılıyor.
export { bacakDuraklari } from './bacak';
export type { RotaSecenekleri, RotaTercihi } from './sorgular';
import { SORGULAR as S, VARSAYILAN_SECENEKLER, aramalariYap, type RotaSecenekleri } from './sorgular';
import { rotalariBirlestir, yurumeSiniri } from './rota-secimi';
import type { HamArac } from './arac-konum';
import type { Duyuru } from './duyuru';
import { isletmeciAdi } from './hat-adi';
import { desenleriBirlestir, kardesKimlikleri } from './hat-tekil';
import { aramayiIndir, ayniAdliSaatsizHatlar, saatsizHatlariKatla, yakinlariIndir, type Ebeveynli } from './istasyon';
import { gunuKaydir } from './onbellek';
import { onbellegeYaz, onbellektenOku } from './onbellek-depo';

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

/**
 * Ağ hatasında kaç kez ve ne kadar bekleyerek yeniden denenir. Telefon kilitten
 * açılınca ya da Wi-Fi bir anlığına koptuğunda ilk istek "ağ hatası" ile düşebiliyor;
 * hemen ardından gelen istek geçiyor. Kullanıcıya kırmızı kutu göstermeden önce iki
 * kez daha deneriz.
 */
const YENIDEN_DENEME_MS = [400, 1200];

function iptalHatasi(): Error {
  const e = new Error('İstek iptal edildi');
  e.name = 'AbortError';
  return e;
}

function bekle(ms: number): Promise<void> {
  return new Promise((coz) => setTimeout(coz, ms));
}

async function sorgula<T>(sorgu: string, degiskenler: Record<string, unknown>, sinyal?: AbortSignal): Promise<T> {
  let yanit: Response | null = null;
  for (let deneme = 0; !yanit; deneme++) {
    try {
      yanit = await fetch(`${OTP_ADRESI}/otp/gtfs/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: sorgu, variables: degiskenler }),
        signal: sinyal,
      });
    } catch (hata) {
      // İptal edilen istek React Native'de her zaman "AbortError" adıyla dönmüyor;
      // "ağ hatası" gibi görünüp ekrana kırmızı kutu düşürüyordu. Sinyale bakmak kesin.
      if (sinyal?.aborted || (hata as Error)?.name === 'AbortError') throw iptalHatasi();
      if (deneme < YENIDEN_DENEME_MS.length) {
        await bekle(YENIDEN_DENEME_MS[deneme]);
        if (sinyal?.aborted) throw iptalHatasi();
        continue;
      }
      throw new OtpHatasi(
        `Rota sunucusuna ulaşılamadı (${OTP_ADRESI}). Bilgisayarda OpenTripPlanner açık mı ve telefon aynı ağda mı?`,
      );
    }
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
  agency?: { name: string } | null;
};

export type Kalkis = {
  scheduledDeparture: number | null;
  realtimeDeparture: number | null;
  realtime: boolean | null;
  serviceDay: number | null;
  headsign: string | null;
  /** Kalkışın olduğu peron (istasyon sorgusunda hangi peron olduğu buradan anlaşılıyor). */
  stop?: { gtfsId: string } | null;
  /** Desenin yön adı: durak ekranındaki yön satırıyla aynı etiket için. */
  trip: { gtfsId: string; route: Hat; pattern?: { code: string; headsign: string | null } | null } | null;
};

export type Durak = {
  gtfsId: string;
  name: string;
  code: string | null;
  desc: string | null;
  lat: number | null;
  lon: number | null;
};

export type YakinDurak = {
  mesafe: number;
  durak: Durak & {
    kalkislar: Kalkis[];
    routes: Hat[];
    /** Saat bilgisi olmayan (sıklık tabanlı) minibüs ve dolmuş hatları. */
    saatsiz: Hat[];
  };
};

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
  /** Yürüme bacaklarında adım adım yol tarifi; toplu taşımada boş. */
  steps: HamAdim[] | null;
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
  /** Güzergâhın yol üzerindeki çizgisi (kodlanmış polyline); haritada çizmek için. */
  patternGeometry?: { points: string | null } | null;
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
  const ham = (veri.nearest?.edges ?? [])
    .filter((e) => e.node.place?.__typename === 'Stop')
    .map((e) => {
      const yer = e.node.place as YakinDurak['durak'] & {
        parentStation?: (Durak & { kalkislar?: Kalkis[] | null }) | null;
      };
      return {
        mesafe: e.node.distance,
        durak: {
          ...yer,
          // İstasyonun peronuysa istasyonun kalkışları: durak ekranı da istasyonu gösteriyor.
          // Yalnız yakındaki peronun kalkışları alınınca yolun karşı tarafındaki otobüs
          // listede yoktu ama durak ekranında vardı; dakikalar birbirini tutmuyordu.
          kalkislar: yer.parentStation?.kalkislar ?? yer.kalkislar ?? [],
          routes: yer.routes ?? [],
        },
      };
    });
  // Aynı meydanın peronları tek satıra insin, kalkışları birleşsin. İki peron da listede
  // olunca istasyonun kalkışları iki kez gelir; aynı sefer aynı saatte bir kez sayılır.
  const indirilmis = yakinlariIndir(
    ham,
    (a: Kalkis, b: Kalkis) => kalkisAni(a) - kalkisAni(b),
    3,
    (k: Kalkis) => `${k.trip?.gtfsId ?? ''}|${k.serviceDay ?? 0}|${k.scheduledDeparture ?? 0}`,
  );
  // Minibüs ve dolmuş: OTP kalkışlarını vermiyor; hatlarını aynı adlı durağa katla, boş durakları gizle.
  return saatsizHatlariKatla(indirilmis, saatsizHatMi) as YakinDurak[];
}

/** Bir kalkışın mutlak anı (saniye); gerçek zamanlı varsa o, yoksa tarifedeki. */
function kalkisAni(k: Kalkis): number {
  return (k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0);
}

export async function durakDetayiGetir(id: string, sinyal?: AbortSignal): Promise<DurakDetayi | null> {
  const veri = await sorgula<{ stop: DurakDetayi | null }>(DURAK_DETAYI, { id }, sinyal);
  return veri.stop;
}

/**
 * Durak adında arama yapar. Rota motoru adları büyük harfle tuttuğu için arama da
 * büyük harfle yapılır. Sonuç istasyon düzeyine indirilir: aynı meydanın peronları
 * tek satıra düşer.
 */
export async function durakAra(ad: string, sinyal?: AbortSignal): Promise<Durak[]> {
  type Cevap = { stops: Ebeveynli<Durak>[] | null; istasyonlar: Durak[] | null };
  const veri = await sorgula<Cevap>(DURAK_ARA, { ad }, sinyal);
  return aramayiIndir(veri.stops, veri.istasyonlar) as Durak[];
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

/** Aramanın zaman şartı: bu saatten sonra çık, ya da en geç bu saatte var. */
export type RotaZamani = { tur: 'kalkis' | 'varis'; an: string };

export type RotaSonucu = {
  guzergahlar: Guzergah[];
  hatalar: { code: string; description: string }[];
  /** Hiçbir rota 20 dakikadan az yürütmüyor; en az yürüyenler gösteriliyor. */
  yurumeAsildi?: boolean;
};

export async function rotaPlanla(
  nereden: Konum,
  nereye: Konum,
  zaman: RotaZamani,
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
  // Tercihe göre bir ya da iki arama (bkz. aramalariYap); sonuçlar birleşiyor.
  const cevaplar = await Promise.all(
    aramalariYap(secenekler).map((arama) =>
      sorgula<Cevap>(
        ROTA_PLANLA,
        {
          nereden: yer(nereden),
          nereye: yer(nereye),
          zaman: zaman.tur === 'varis' ? { latestArrival: zaman.an } : { earliestDeparture: zaman.an },
          tercihler: arama.tercihler,
          // OTP 2.10 `modes: null` gelince çöküyor ("modesArgs is null"); yoksa hiç gönderilmez.
          ...(arama.modlar ? { modlar: arama.modlar } : {}),
        },
        sinyal,
      ),
    ),
  );
  const hepsi = rotalariBirlestir(
    cevaplar.map((c) => (c.planConnection?.edges ?? []).flatMap((e) => (e ? [e.node] : []))),
  );
  const { rotalar: guzergahlar, asildi } = yurumeSiniri(hepsi);
  // Varışa göre aramada OTP en geç çıkanı başa koyuyor; liste her zaman kalkışa göre okunsun.
  if (zaman.tur === 'varis') guzergahlar.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  const sonuc: RotaSonucu = {
    guzergahlar,
    hatalar: cevaplar.find((c) => c.planConnection?.routingErrors?.length)?.planConnection?.routingErrors ?? [],
    ...(asildi ? { yurumeAsildi: true } : {}),
  };
  if (sonuc.guzergahlar.length) void onbellegeYaz(rotaAnahtari(nereden, nereye, secenekler, zaman.tur), sonuc);
  return sonuc;
}

/** Aynı yolculuğun onbellekteki karşılığı. Koordinatlar ~11 m'ye yuvarlanıyor. */
function rotaAnahtari(nereden: Konum, nereye: Konum, secenekler: RotaSecenekleri, tur: RotaZamani['tur']): string {
  const nk = (k: Konum) => `${k.lat.toFixed(4)},${k.lon.toFixed(4)}`;
  return `rota:${nk(nereden)}>${nk(nereye)}|${secenekler.tercih}|${secenekler.erisilebilir ? 'e' : ''}${tur === 'varis' ? '|v' : ''}`;
}

/**
 * Güzergâh planlar; sunucuya ulaşılamazsa aynı yolculuğun son planını döndürür.
 *
 * Saatler kaydırılmıyor: plan belirli bir kalkış için yapılmıştı ve öyle gösteriliyor.
 * Asıl kullanım metroda sinyal yokken "nerede aktarma yapacaktım" sorusuna bakmak;
 * hangi hatlar ve hangi duraklar olduğu eskimiyor. Bu yüzden ömrü de kısa: bir gün.
 */
export async function rotaPlanlaYedekli(
  nereden: Konum,
  nereye: Konum,
  zaman: RotaZamani,
  secenekler: RotaSecenekleri = VARSAYILAN_SECENEKLER,
  sinyal?: AbortSignal,
): Promise<RotaSonucu & { cevrimdisi: number | null }> {
  try {
    return { ...(await rotaPlanla(nereden, nereye, zaman, secenekler, sinyal)), cevrimdisi: null };
  } catch (hata) {
    if (!(hata instanceof OtpHatasi)) throw hata;
    const kayit = await onbellektenOku<RotaSonucu>(rotaAnahtari(nereden, nereye, secenekler, zaman.tur), 1);
    if (!kayit) throw hata;
    return { ...kayit.veri, cevrimdisi: kayit.zaman };
  }
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

/**
 * Hat ve aynı hattın beslemede ayrı duran öbür güzergâhları (İETT her yönü ayrı
 * yayımlıyor, bkz. hat-tekil.ts): desenleri tek hatta toplanır, `kardesler` bütün
 * kimlikler. Kardeşler alınamazsa hat tek başına döner.
 */
export async function hatDetayiKardesleriyle(
  id: string,
  sinyal?: AbortSignal,
): Promise<(HatDetayi & { kardesler: string[] }) | null> {
  const hat = await hatDetayiGetir(id, sinyal);
  if (!hat) return null;
  try {
    const kimlikler = kardesKimlikleri(hat, await hatlariGetir(sinyal));
    const kardesler = (await Promise.all(kimlikler.map((k) => hatDetayiGetir(k, sinyal)))).filter(
      (h): h is HatDetayi => !!h,
    );
    return {
      ...hat,
      patterns: [
        ...new Map(
          [...(hat.patterns ?? []), ...kardesler.flatMap((k) => k.patterns ?? [])].map((d) => [d.code, d] as const),
        ).values(),
      ],
      kardesler: [hat.gtfsId, ...kardesler.map((k) => k.gtfsId)],
    };
  } catch (hata) {
    if (!(hata instanceof OtpHatasi)) throw hata;
    return { ...hat, kardesler: [hat.gtfsId] };
  }
}

/** İstanbul'un bugünkü tarihi, OTP'nin istediği biçimde: "20260923". */
function istanbulGunu(simdiMs: number = Date.now()): string {
  // İstanbul yaz saati uygulamıyor: her zaman UTC+3.
  return new Date(simdiMs + 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Bir hattın yönlerindeki otobüslerin canlı konumu, desen koduna göre. Canlı veri
 * yoksa (metro, köprü kapalı, hat henüz öğrenilmemiş) boş gelir.
 */
export async function hatAraclariGetir(
  id: string | string[],
  sinyal?: AbortSignal,
): Promise<Record<string, HamArac[]>> {
  type Cevap = { route: { patterns: { code: string; vehiclePositions: HamArac[] | null }[] | null } | null };
  const gun = istanbulGunu();
  const kimlikler = Array.isArray(id) ? id : [id];
  const cevaplar = await Promise.all(kimlikler.map((k) => sorgula<Cevap>(S.HAT_ARACLARI, { id: k, gun }, sinyal)));
  const sonuc: Record<string, HamArac[]> = {};
  for (const veri of cevaplar) for (const d of veri.route?.patterns ?? []) sonuc[d.code] = d.vehiclePositions ?? [];
  return sonuc;
}

/** Bir seferin deseni üzerindeki otobüslerin canlı konumu. */
export async function seferAraclariGetir(seferId: string, sinyal?: AbortSignal): Promise<HamArac[]> {
  type Cevap = { trip: { pattern: { vehiclePositions: HamArac[] | null } | null } | null };
  const veri = await sorgula<Cevap>(S.SEFER_ARACLARI, { id: seferId }, sinyal);
  return veri.trip?.pattern?.vehiclePositions ?? [];
}

// Duyurular 15 dakikada bir değişiyor; ekranlar arası gezinirken her seferinde
// sormamak için beş dakika bellekte tutuluyor.
let duyuruOnbellek: { an: number; liste: Promise<Duyuru[]> } | null = null;
const DUYURU_OMRU = 5 * 60_000;

/**
 * İETT hat duyuruları, köprüden. Köprü kapalıysa ya da yanıt vermezse boş liste:
 * duyuru süs, ekranlar onsuz da çalışıyor.
 */
export function duyurulariGetir(): Promise<Duyuru[]> {
  if (duyuruOnbellek && Date.now() - duyuruOnbellek.an < DUYURU_OMRU) return duyuruOnbellek.liste;
  // AbortSignal.timeout React Native'de her sürümde yok; elle zaman aşımı.
  const iptal = new AbortController();
  const zamanlayici = setTimeout(() => iptal.abort(), 8_000);
  const liste = fetch(`${KOPRU_ADRESI}/duyurular`, { signal: iptal.signal })
    .then((y) => (y.ok ? y.json() : { duyurular: [] }))
    .then((g: { duyurular?: Duyuru[] }) => (Array.isArray(g?.duyurular) ? g.duyurular : []))
    .catch(() => {
      duyuruOnbellek = null;
      return [] as Duyuru[];
    })
    .finally(() => clearTimeout(zamanlayici));
  duyuruOnbellek = { an: Date.now(), liste };
  return liste;
}

// Aynı hat kümesi 5 dakikada bir kereden sık bildirilmez (durak ekranı 30 sn'de bir yenileniyor).
const ilgiSon = new Map<string, number>();
const ILGI_ARALIGI = 5 * 60_000;

/**
 * Köprüye bu hatlarla ilgilendiğimizi bildirir: hat taraması onları öne alır, üstündeki
 * otobüsler birkaç dakika içinde tanınıp canlı görünür. `kalici` favori durakların
 * hatları için: köprü onları daha sık tarar. Sonuç beklenmez, hata yutulur.
 */
export function kopruyeIlgiBildir(hatlar: (string | null | undefined)[], kalici = false): void {
  const liste = [...new Set(hatlar.flatMap((h) => (h ? [h.trim().toLocaleUpperCase('tr-TR')] : [])))]
    .filter((h) => h.length > 0 && h.length <= 12)
    .sort();
  if (!liste.length) return;
  const anahtar = `${kalici ? 'k' : 'i'}:${liste.join(',')}`;
  const simdi = Date.now();
  if (simdi - (ilgiSon.get(anahtar) ?? 0) < ILGI_ARALIGI) return;
  ilgiSon.set(anahtar, simdi);
  const iptal = new AbortController();
  const zamanlayici = setTimeout(() => iptal.abort(), 5_000);
  fetch(`${KOPRU_ADRESI}/ilgi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hatlar: liste, kalici }),
    signal: iptal.signal,
  })
    .catch(() => {})
    .finally(() => clearTimeout(zamanlayici));
}

/** Durak ekranındaki bir satır: hat + yön + sıradaki kalkışlar. */
export type DurakDeseni = {
  pattern: {
    code: string;
    headsign: string | null;
    directionId: string | null;
    route: Hat;
    stops?: DurakNoktasi[] | null;
    vehiclePositions?: HamArac[] | null;
  } | null;
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
  // Kimlik bir istasyona da ait olabilir; OTP'de stop() ve station() ayrı alanlar.
  const veri = await sorgula<{ stop: DurakSaatleri | null; istasyon: DurakSaatleri | null }>(
    DURAK_SAATLERI,
    { id, kalkis: kalkisSayisi, aralik: aralikSaniye },
    sinyal,
  );
  const ham = veri.stop ?? veri.istasyon;
  // İstasyonun iki peronu ya da ring hattı aynı deseni iki kez getirebiliyor.
  const sonuc = ham ? { ...ham, desenler: desenleriBirlestir(ham.desenler ?? []) } : null;
  if (sonuc) void onbellegeYaz(`durak:${id}`, sonuc);
  return sonuc;
}

/** Minibüs ve dolmuş: sıklık tabanlı, OTP'den kalkış saati gelmiyor. */
export function saatsizHatMi(h: Hat): boolean {
  return !!isletmeciAdi(h.agency?.name);
}

/** Durak ekranındaki saatsiz hatlar yakın aynı adlı duraklardan bu yarıçapta toplanır. */
const AYNI_AD_YARICAPI = 150;

/**
 * Bir durağın saatsiz (minibüs, dolmuş) hatları: kendisininkiler ve aynı meydandaki
 * aynı adlı duraklarınkiler. Sunucuya ulaşılamazsa durağın kendi hatlarıyla yetinir.
 */
export async function saatsizHatlariGetir(durak: DurakSaatleri, sinyal?: AbortSignal): Promise<Hat[]> {
  if (durak.lat == null || durak.lon == null) return (durak.routes ?? []).filter(saatsizHatMi);
  type Cevap = {
    nearest: {
      edges: { node: { place: ({ __typename: string } & Ebeveynli<Durak> & { routes: Hat[] | null }) | null } }[];
    } | null;
  };
  try {
    const veri = await sorgula<Cevap>(
      S.YAKIN_AYNI_AD,
      { lat: durak.lat, lon: durak.lon, yaricap: AYNI_AD_YARICAPI },
      sinyal,
    );
    const adaylar = (veri.nearest?.edges ?? [])
      .map((e) => e.node.place)
      .filter((p): p is NonNullable<typeof p> => p?.__typename === 'Stop')
      .map((durak) => ({ durak }));
    return ayniAdliSaatsizHatlar(durak, adaylar, saatsizHatMi);
  } catch (hata) {
    if (!(hata instanceof OtpHatasi)) throw hata;
    return (durak.routes ?? []).filter(saatsizHatMi);
  }
}

/**
 * Durak saatlerini getirir; sunucuya ulaşılamazsa son kaydı döndürür.
 *
 * Kayıttaki saatler mutlak olduğu için bugüne kaydırılıyor. Kaydırma yalnız aynı
 * gün türünden bir kayıt için yapılıyor (onbellek.ts) — hafta içi tarifesini
 * cumartesi göstermek yolcuyu yanıltır.
 */
export async function durakSaatleriYedekli(
  id: string,
  kalkisSayisi = 3,
  aralikSaniye = 3 * 3600,
  sinyal?: AbortSignal,
): Promise<{ durak: DurakSaatleri | null; cevrimdisi: number | null }> {
  try {
    return { durak: await durakSaatleriGetir(id, kalkisSayisi, aralikSaniye, sinyal), cevrimdisi: null };
  } catch (hata) {
    if (!(hata instanceof OtpHatasi)) throw hata;
    const kayit = await onbellektenOku<DurakSaatleri>(`durak:${id}`);
    if (!kayit) throw hata;
    const simdi = Date.now();
    const kaydir = (k: Kalkis): Kalkis => ({
      ...k,
      serviceDay: gunuKaydir(k.serviceDay ?? 0, kayit.zaman, simdi),
      // Gerçek zamanlı değer eski kayıtta artık anlamlı değil.
      realtimeDeparture: null,
      realtime: false,
    });
    return {
      durak: {
        ...kayit.veri,
        desenler: desenleriBirlestir(kayit.veri.desenler ?? []).map((d) => ({
          ...d,
          stoptimes: (d.stoptimes ?? []).map(kaydir),
        })),
      },
      cevrimdisi: kayit.zaman,
    };
  }
}

export type SunucuBilgisi = {
  serviceTimeRange: { start: number | null; end: number | null } | null;
  feeds: { feedId: string; agencies: { name: string }[] | null }[] | null;
};

/** Rota sunucusunun durumu ve yüklü tarifenin kapsadığı tarih aralığı. */
export async function sunucuBilgisiGetir(sinyal?: AbortSignal): Promise<SunucuBilgisi> {
  return sorgula<SunucuBilgisi>(SUNUCU_BILGISI, {}, sinyal);
}
