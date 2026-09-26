// Rota aramasının sonuçlarını birleştirme, yürüme sınırı ve sıralama.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

import { EN_COK_YURUME_SN, type RotaTercihi } from './sorgular';

/** Burada gereken kadarı: OTP'nin itinerary alanları. */
export type SiralanacakRota = {
  start: string | null;
  duration: number | null;
  walkTime: number | null;
  numberOfTransfers: number;
  legs: {
    mode?: string | null;
    transitLeg?: boolean | null;
    duration?: number | null;
    route?: { gtfsId?: string | null; shortName?: string | null } | null;
    from?: { stop?: { gtfsId?: string | null } | null; name?: string | null } | null;
  }[];
};

/** Aynı kalkışta aynı hatlarla aynı duraklardan binilen rota aynı rotadır. */
export function rotaImzasi(g: SiralanacakRota): string {
  const araclar = g.legs
    .filter((b) => b.transitLeg)
    .map((b) => `${b.route?.gtfsId ?? b.route?.shortName ?? b.mode}@${b.from?.stop?.gtfsId ?? b.from?.name ?? ''}`);
  return `${g.start ?? ''}|${araclar.join('>') || 'yuru'}`;
}

/** Birkaç aramanın sonuçlarını sırayı koruyarak birleştirir, tekrarları atar. */
export function rotalariBirlestir<T extends SiralanacakRota>(listeler: T[][]): T[] {
  const gorulen = new Set<string>();
  const sonuc: T[] = [];
  for (const liste of listeler) {
    for (const g of liste) {
      const imza = rotaImzasi(g);
      if (gorulen.has(imza)) continue;
      gorulen.add(imza);
      sonuc.push(g);
    }
  }
  return sonuc;
}

/**
 * Yürüme sınırı: 20 dakikadan çok yürütülen rotalar atılır. Hiçbiri sınırın altında
 * kalmıyorsa (şehir dışı, gece) boş liste vermek yerine en az yürüyen rotalar kalır ve
 * `asildi` işaretlenir; ekran bunu yolcuya söyler.
 */
export function yurumeSiniri<T extends SiralanacakRota>(
  liste: T[],
  sinirSn: number = EN_COK_YURUME_SN,
): { rotalar: T[]; asildi: boolean } {
  const uygun = liste.filter((g) => (g.walkTime ?? 0) <= sinirSn);
  if (uygun.length || !liste.length) return { rotalar: uygun, asildi: false };
  const enAz = Math.min(...liste.map((g) => g.walkTime ?? 0));
  // En az yürüyenle arası 5 dakikadan az olanlar: yolcuya birkaç seçenek kalsın.
  return { rotalar: liste.filter((g) => (g.walkTime ?? 0) <= enAz + 5 * 60), asildi: true };
}

/** Rotadaki otobüs (ve minibüs, dolmuş) süresi: trafiğe takılabilen kısım. */
export function otobusSuresi(g: SiralanacakRota): number {
  return g.legs
    .filter((b) => b.transitLeg && ['BUS', 'TROLLEYBUS', 'COACH'].includes((b.mode ?? '').toUpperCase()))
    .reduce((t, b) => t + (b.duration ?? 0), 0);
}

/**
 * Önerilen sıralamanın puanı (saniye gibi okunur, küçük olan iyi): süre + yürümenin
 * yarısı + aktarma başına 5 dk + otobüste geçen sürenin beşte biri. Aynı süreli iki
 * rotadan az yürüyen, az aktarmalı ve trafiğe daha az bağlı olanı öne çıkar.
 */
export function oneriPuani(g: SiralanacakRota): number {
  return (g.duration ?? Infinity) + 0.5 * (g.walkTime ?? 0) + 300 * g.numberOfTransfers + 0.2 * otobusSuresi(g);
}

/** Listeyi seçilen tercihe göre sıralar (yeni dizi). */
export function rotalariSirala<T extends SiralanacakRota>(liste: T[], tercih: RotaTercihi): T[] {
  const sure = (g: T) => g.duration ?? Infinity;
  const erken = (g: T) => Date.parse(g.start ?? '') || 0;
  const kopya = [...liste];
  switch (tercih) {
    case 'hizli':
      return kopya.sort((a, b) => sure(a) - sure(b) || erken(a) - erken(b));
    case 'azYurume':
      return kopya.sort((a, b) => (a.walkTime ?? 0) - (b.walkTime ?? 0) || sure(a) - sure(b));
    case 'azAktarma':
      return kopya.sort((a, b) => a.numberOfTransfers - b.numberOfTransfers || sure(a) - sure(b));
    case 'rayli':
      return kopya.sort((a, b) => otobusSuresi(a) - otobusSuresi(b) || sure(a) - sure(b));
    default:
      return kopya.sort((a, b) => oneriPuani(a) - oneriPuani(b) || erken(a) - erken(b));
  }
}
