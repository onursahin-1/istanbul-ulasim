// Güzergâh bacağı üzerinde yapılan saf hesaplar.
//
// otp.ts'ten ayrı duruyor çünkü o dosya expo-constants'a bağlı; buradakiler Node
// altında çalışan testlerden de çağrılabilsin istiyoruz. Tip bağımlılığı
// `import type` ile alınıyor, derlemede iz bırakmıyor.

import type { Bacak } from './otp';

/**
 * Bir toplu taşıma bacağındaki durakları sırasıyla verir (biniş ve iniş dahil, tekrarsız).
 *
 * Duraklar seferin kendi saatlerinden değil, hattın durak deseninden okunur: metro ve
 * Marmaray seferleri veride sıklık tabanlı (frequencies.txt) tanımlı olduğu için
 * tek tek sefer saatleri bulunmuyor ve saat isteyen alanlar hata veriyor.
 */
export function bacakDuraklari(bacak: Bacak): { gtfsId: string; ad: string; lat: number; lon: number }[] {
  const liste: { gtfsId: string; ad: string; lat: number; lon: number }[] = [];
  const ekle = (gtfsId?: string | null, ad?: string | null, lat?: number | null, lon?: number | null) => {
    if (!gtfsId || lat == null || lon == null) return;
    if (liste.some((d) => d.gtfsId === gtfsId)) return;
    liste.push({ gtfsId, ad: ad ?? '', lat, lon });
  };

  const desen = bacak.trip?.pattern?.stops ?? [];
  const binis = bacak.from.stop?.gtfsId;
  const inis = bacak.to.stop?.gtfsId;
  const bas = binis ? desen.findIndex((d) => d.gtfsId === binis) : -1;
  // Ring hatlarda aynı durak iki kez geçebilir; iniş durağı biniş durağından sonra aranır.
  const son = bas >= 0 && inis ? desen.findIndex((d, i) => i > bas && d.gtfsId === inis) : -1;

  ekle(binis, bacak.from.name, bacak.from.lat, bacak.from.lon);
  if (bas >= 0 && son > bas) for (const d of desen.slice(bas, son + 1)) ekle(d.gtfsId, d.name, d.lat, d.lon);
  ekle(inis, bacak.to.name, bacak.to.lat, bacak.to.lon);
  return liste;
}
