// İETT hat duyuruları (sefer iptali, güzergâh değişikliği, günlük aksaklık).
//
// Köprü (kopru/) duyuruları 15 dakikada bir İETT'den alıp /duyurular adresinde
// sunuyor. Burada hattın kısa adıyla eşleştiriliyor.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

import { trBuyuk } from './metin';

export type Duyuru = { hat: string; tip: string; saat: string; mesaj: string };

/** Bir hattın duyuruları. Kısa ad büyük harfe çevrilip karşılaştırılıyor ("m1a" = "M1A"). */
export function hattinDuyurulari(liste: Duyuru[], kisaAd?: string | null): Duyuru[] {
  if (!kisaAd) return [];
  const aranan = trBuyuk(kisaAd).trim();
  return liste.filter((d) => trBuyuk(d.hat).trim() === aranan);
}

/** Birden çok hattın duyuruları, hat sırasıyla; aynı mesaj iki kez gelmez. */
export function hatlarinDuyurulari(liste: Duyuru[], kisaAdlar: (string | null | undefined)[]): Duyuru[] {
  const gorulen = new Set<string>();
  const sonuc: Duyuru[] = [];
  for (const ad of kisaAdlar) {
    for (const d of hattinDuyurulari(liste, ad)) {
      const anahtar = `${d.hat}|${d.mesaj}`;
      if (gorulen.has(anahtar)) continue;
      gorulen.add(anahtar);
      sonuc.push(d);
    }
  }
  return sonuc;
}
