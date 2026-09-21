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

export type Yakin<T extends Konumlu, K> = { mesafe: number; durak: Ebeveynli<T> & { kalkislar: K[] } };

/**
 * Yakın durak listesini istasyon düzeyine indirir: aynı istasyonun peronları
 * birleşir, mesafe en yakın perondan alınır, kalkışlar birleştirilip sıralanır.
 *
 * @param sirala iki kalkışı karşılaştıran işlev; birleşen listeyi sıralamak için
 */
export function yakinlariIndir<T extends Konumlu, K>(
  yakinlar: Yakin<T, K>[],
  sirala: (a: K, b: K) => number,
  enFazlaKalkis = 3,
): { mesafe: number; durak: Konumlu & { kalkislar: K[] } }[] {
  const kume = new Map<string, { mesafe: number; durak: Konumlu; kalkislar: K[] }>();
  const sira: string[] = [];
  for (const y of yakinlar) {
    const t = temsilci(y.durak);
    const varolan = kume.get(t.gtfsId);
    if (!varolan) {
      sira.push(t.gtfsId);
      kume.set(t.gtfsId, { mesafe: y.mesafe, durak: t, kalkislar: [...(y.durak.kalkislar ?? [])] });
      continue;
    }
    varolan.mesafe = Math.min(varolan.mesafe, y.mesafe);
    varolan.kalkislar.push(...(y.durak.kalkislar ?? []));
  }
  return sira
    .map((id) => kume.get(id)!)
    .sort((a, b) => a.mesafe - b.mesafe)
    .map((k) => ({ mesafe: k.mesafe, durak: { ...k.durak, kalkislar: k.kalkislar.sort(sirala).slice(0, enFazlaKalkis) } }));
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
