// Alt yaprağın (sürüklenebilir panel) konum hesapları.
//
// Yaprağın üç durağı var: kapalı (yalnız başlık görünür, harita neredeyse tam
// ekran), orta ve açık. Parmak bırakılınca hangisine oturacağını burası seçiyor.
// React Native'e dokunmuyor, testlerden çağrılabiliyor.

export type YaprakDurumu = 'kapali' | 'orta' | 'acik';

export type YaprakYukseklikleri = Record<YaprakDurumu, number>;

/**
 * Üç durağın görünen yüksekliklerini hesaplar.
 *
 * @param kapsayici yaprağın içinde durduğu alanın yüksekliği
 * @param ustPay açıkken yaprağın üstünde boş kalacak alan (arama kutusu görünsün)
 * @param kapali kapalıyken görünen başlık yüksekliği
 * @param ortaOran orta durağın kapsayıcıya oranı
 */
export function yukseklikleriHesapla(
  kapsayici: number,
  ustPay: number,
  kapali: number,
  ortaOran: number,
): YaprakYukseklikleri {
  const acik = Math.max(kapali, kapsayici - ustPay);
  const orta = Math.min(acik, Math.max(kapali, Math.round(kapsayici * ortaOran)));
  return { kapali, orta, acik };
}

/**
 * Yaprak açık hâldeyken kaç piksel aşağı kaydırılmış olmalı ki bu durak görünsün.
 * Yaprak her zaman "açık" boyunda çiziliyor, aşağı itilerek küçülüyor.
 */
export function durakOfseti(y: YaprakYukseklikleri, durum: YaprakDurumu): number {
  return y.acik - y[durum];
}

/** Hızlı bir fiske sayılması için gereken hız (piksel/ms). */
export const FISKE_HIZI = 0.6;

/**
 * Parmak bırakıldığında yaprağın oturacağı durak.
 *
 * Yavaş bırakılırsa en yakın durağa oturur. Hızlı fiskelenirse hareket yönündeki
 * bir sonraki durağa geçer — kısa ama hızlı bir aşağı çekiş de yaprağı kapatsın,
 * kullanıcı yarı yola kadar sürüklemek zorunda kalmasın.
 *
 * @param ofset bırakıldığı andaki aşağı kayma (0 = tam açık)
 * @param hiz dikey hız, piksel/ms; artı aşağı
 */
export function hedefDurak(ofset: number, hiz: number, y: YaprakYukseklikleri): YaprakDurumu {
  const duraklar = (['acik', 'orta', 'kapali'] as const).map((d) => ({ d, o: durakOfseti(y, d) }));
  if (Math.abs(hiz) >= FISKE_HIZI) {
    if (hiz > 0) return duraklar.find((x) => x.o > ofset + 1)?.d ?? 'kapali';
    return [...duraklar].reverse().find((x) => x.o < ofset - 1)?.d ?? 'acik';
  }
  let enYakin = duraklar[0];
  for (const x of duraklar) if (Math.abs(x.o - ofset) < Math.abs(enYakin.o - ofset)) enYakin = x;
  return enYakin.d;
}

/** Başlığa dokununca geçilecek durak: kapalıyı açar, açığı ve ortayı küçültür. */
export function dokununcaDurak(durum: YaprakDurumu): YaprakDurumu {
  if (durum === 'kapali') return 'orta';
  if (durum === 'orta') return 'kapali';
  return 'orta';
}

/**
 * Sürükleme sırasında yaprağın gideceği yer: sınırların dışına çekilirse lastik
 * gibi direnir, tamamen kopmaz.
 */
export function sinirla(ofset: number, y: YaprakYukseklikleri): number {
  const enAlt = durakOfseti(y, 'kapali');
  if (ofset < 0) return ofset / 3;
  if (ofset > enAlt) return enAlt + (ofset - enAlt) / 3;
  return ofset;
}
