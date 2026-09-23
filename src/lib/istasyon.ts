// Arama ve yakın durak listelerinde aynı istasyonun peronlarını tek satıra indirir.
//
// Veri tarafında (veri/durak-birlestir.py) aynı yeri anlatan duraklara ortak bir
// istasyon (GTFS parent_station) verildi. OTP bu istasyonları ayrı bir varlık olarak
// tutuyor ama `stops(name:)` hâlâ çocukları döndürüyor; "Üsküdar" araması altı satır
// getiriyor. Burada çocuk yerine ebeveyni gösteriyoruz.
//
// Kalkışlar birleştiriliyor: Üsküdar'a bakan yolcu Marmaray, M5 ve vapuru tek listede
// görüyor — zaten aynı meydandalar.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { mesafeMetre } from './cografya';
import { trKucuk } from './metin';

export type Konumlu = {
  gtfsId: string;
  name: string;
  code?: string | null;
  desc?: string | null;
  lat?: number | null;
  lon?: number | null;
};

export type Ebeveynli<T extends Konumlu> = T & { parentStation?: Konumlu | null };

/** Bir durağın arama sonucunda temsil edileceği kimlik: varsa istasyonu. */
export function temsilci<T extends Konumlu>(durak: Ebeveynli<T>): Konumlu {
  const ana = durak.parentStation;
  // Adı olmayan bir ebeveyn gösterilemez; o durumda durağın kendisi kalır.
  if (ana && ana.gtfsId && ana.name) return ana;
  const { parentStation: _atilan, ...kendisi } = durak;
  return kendisi as Konumlu;
}

/**
 * Arama sonucunu istasyon düzeyine indirir.
 *
 * @param duraklar `stops(name:)` sonucu
 * @param istasyonlar `stations(name:)` sonucu; adı çocuklarıyla tutmayan istasyonlar
 *                    yalnızca burada geliyor
 */
export function aramayiIndir<T extends Konumlu>(
  duraklar: Ebeveynli<T>[] | null | undefined,
  istasyonlar: Konumlu[] | null | undefined = [],
): Konumlu[] {
  const sonuc: Konumlu[] = [];
  const gorulen = new Set<string>();
  for (const liste of [istasyonlar ?? [], (duraklar ?? []).map(temsilci)]) {
    for (const d of liste) {
      if (!d?.gtfsId || gorulen.has(d.gtfsId)) continue;
      gorulen.add(d.gtfsId);
      sonuc.push(d);
    }
  }
  return sonuc;
}

export type Yakin<T extends Konumlu, K, R extends { gtfsId: string } = { gtfsId: string }> = {
  mesafe: number;
  durak: Ebeveynli<T> & { kalkislar: K[]; routes?: R[] | null };
};

export type IndirilmisYakin<K, R> = { mesafe: number; durak: Konumlu & { kalkislar: K[]; routes: R[] } };

/**
 * Yakın durak listesini istasyon düzeyine indirir: aynı istasyonun peronları
 * birleşir, mesafe en yakın perondan alınır, kalkışlar birleştirilip sıralanır,
 * peronlardan geçen hatlar tekilleştirilerek toplanır.
 *
 * @param sirala iki kalkışı karşılaştıran işlev; birleşen listeyi sıralamak için
 */
export function yakinlariIndir<T extends Konumlu, K, R extends { gtfsId: string } = { gtfsId: string }>(
  yakinlar: Yakin<T, K, R>[],
  sirala: (a: K, b: K) => number,
  enFazlaKalkis = 3,
): IndirilmisYakin<K, R>[] {
  const kume = new Map<string, { mesafe: number; durak: Konumlu; kalkislar: K[]; hatlar: Map<string, R> }>();
  const sira: string[] = [];
  for (const y of yakinlar) {
    const t = temsilci(y.durak);
    let k = kume.get(t.gtfsId);
    if (!k) {
      sira.push(t.gtfsId);
      k = { mesafe: y.mesafe, durak: t, kalkislar: [], hatlar: new Map() };
      kume.set(t.gtfsId, k);
    }
    k.mesafe = Math.min(k.mesafe, y.mesafe);
    k.kalkislar.push(...(y.durak.kalkislar ?? []));
    for (const h of y.durak.routes ?? []) if (h?.gtfsId && !k.hatlar.has(h.gtfsId)) k.hatlar.set(h.gtfsId, h);
  }
  return sira
    .map((id) => kume.get(id)!)
    .sort((a, b) => a.mesafe - b.mesafe)
    .map((k) => {
      const { routes: _eski, ...durak } = k.durak as Konumlu & { routes?: unknown };
      return {
        mesafe: k.mesafe,
        durak: { ...durak, kalkislar: k.kalkislar.sort(sirala).slice(0, enFazlaKalkis), routes: [...k.hatlar.values()] },
      };
    });
}

/**
 * Saatsiz hatları (minibüs, dolmuş) yakın durak listesine katlar ve seferi
 * görünmeyen durakları gizler.
 *
 * Minibüs ve dolmuş seferleri GTFS'te sıklık tabanlı (frequencies.txt). OTP bunlarla
 * rota kuruyor ama durak kalkış sorgularında hiç döndürmüyor; bu yüzden minibüs
 * durakları listede hep "yakın zamanda sefer yok" diye görünüyordu. Üstelik İBB'nin
 * minibüs durağı çoğu zaman İETT durağıyla aynı adı taşıyor, aynı meydan iki kez
 * listeleniyordu.
 *
 * Kural:
 * - Her durağın saatsiz hatları `saatsiz` alanına alınır.
 * - Kalkışı olmayan ama saatsiz hattı olan durak, yakınında (eşik içinde) aynı adlı
 *   ve kalkışı olan bir durak varsa ona katlanır; yoksa kendi satırında kalır.
 * - Ne kalkışı ne saatsiz hattı olan durak gizlenir.
 * - Hepsi gizlenecekse (gece yarısı) hiçbiri gizlenmez: yakındaki durakları yine de
 *   görmek isteriz, yanlarında "sefer yok" yazar.
 */
export function saatsizHatlariKatla<K, R extends { gtfsId: string }>(
  liste: IndirilmisYakin<K, R>[],
  saatsizMi: (hat: R) => boolean,
  esikMetre = 150,
): (IndirilmisYakin<K, R> & { durak: { saatsiz: R[] } })[] {
  const ekli = liste.map((y) => ({
    mesafe: y.mesafe,
    durak: { ...y.durak, saatsiz: y.durak.routes.filter(saatsizMi) },
  }));
  const dolu = ekli.filter((y) => y.durak.kalkislar.length > 0);
  if (dolu.length === 0) return ekli;

  const sonuc: typeof ekli = [];
  for (const y of ekli) {
    if (y.durak.kalkislar.length > 0) {
      sonuc.push(y);
      continue;
    }
    if (y.durak.saatsiz.length === 0) continue;
    const ad = trKucuk(y.durak.name ?? '').trim();
    const hedef = dolu.find(
      (d) =>
        trKucuk(d.durak.name ?? '').trim() === ad &&
        d.durak.lat != null &&
        d.durak.lon != null &&
        y.durak.lat != null &&
        y.durak.lon != null &&
        mesafeMetre({ latitude: d.durak.lat, longitude: d.durak.lon }, { latitude: y.durak.lat, longitude: y.durak.lon }) <=
          esikMetre,
    );
    if (!hedef) {
      sonuc.push(y);
      continue;
    }
    for (const h of y.durak.saatsiz) {
      if (!hedef.durak.saatsiz.some((v) => v.gtfsId === h.gtfsId)) hedef.durak.saatsiz.push(h);
    }
  }
  return sonuc;
}

/**
 * Aynı adın yakın tekrarlarını eler.
 *
 * parent_station tek bir beslemenin içinde çalışıyor; İETT'nin "MECİDİYEKÖY"
 * durağı ile raylı beslemenin "Mecidiyeköy" istasyonu ayrı beslemelerde olduğu
 * için GTFS onları birleştiremiyor. Burada ad + yakınlık ile eliyoruz.
 *
 * Yakınlık şart: "KADIKÖY" adında bir durak Şile'de de var, onu elemek yanlış
 * olur. Liste mesafeye göre sıralı gelmeli — ilk giren, yani en yakın olan kalır.
 */
export function adTekrariniEle<T extends Konumlu>(liste: T[], esikMetre = 500): T[] {
  const tutulan: { ad: string; lat: number; lon: number }[] = [];
  const sonuc: T[] = [];
  for (const d of liste) {
    if (d.lat == null || d.lon == null) continue;
    const ad = trKucuk(d.name ?? '').trim();
    const tekrar = tutulan.some(
      (t) =>
        t.ad === ad &&
        mesafeMetre({ latitude: t.lat, longitude: t.lon }, { latitude: d.lat!, longitude: d.lon! }) <= esikMetre,
    );
    if (tekrar) continue;
    tutulan.push({ ad, lat: d.lat, lon: d.lon });
    sonuc.push(d);
  }
  return sonuc;
}
