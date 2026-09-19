// Sefer saatlerinden sıklık ve "günün son seferi" bilgisini çıkarır.
//
// OTP'nin GTFS API'sinde frekans alanı yok. Metro ve Marmaray seferleri İBB verisinde
// "her N dakikada bir" diye tanımlı olduğu için tek tek tarifeli saatleri anlamlı değil;
// bunun yerine duraktan geçen ardışık kalkışların arasındaki farka bakıyoruz.

export type Kalkis = { saniye: number; serviceDay: number };

export type SeferBilgisi = {
  /** Ardışık kalkışların ortanca aralığı, dakika. Sıklık çıkarılamadıysa null. */
  aralikDk: number | null;
  /** Aralık dalgalıysa gösterilecek alt-üst sınır ("4–6 dakikada bir"). */
  altDk: number | null;
  ustDk: number | null;
  /** Bu bacaktan sonraki ilk kalkış (gün başından saniye). Yoksa null. */
  sonrakiSaniye: number | null;
  /** Elimizdeki pencerede bundan sonra kalkış yoksa true. */
  sonSefer: boolean;
  /** Penceredeki en son kalkış. */
  sonSaniye: number | null;
};

const BOS: SeferBilgisi = {
  aralikDk: null,
  altDk: null,
  ustDk: null,
  sonrakiSaniye: null,
  sonSefer: false,
  sonSaniye: null,
};

function ortanca(sayilar: number[]): number {
  const s = [...sayilar].sort((a, b) => a - b);
  const orta = Math.floor(s.length / 2);
  return s.length % 2 ? s[orta] : Math.round((s[orta - 1] + s[orta]) / 2);
}

/**
 * @param kalkislar Duraktan geçen, o hatta ait sıralı kalkışlar.
 * @param binisSaniye Kullanıcının bineceği seferin kalkış saati (gün başından saniye).
 */
export function seferBilgisi(kalkislar: Kalkis[], binisSaniye: number | null): SeferBilgisi {
  if (kalkislar.length === 0) return BOS;

  const mutlak = kalkislar.map((k) => k.serviceDay + k.saniye);
  const farklar: number[] = [];
  for (let i = 1; i < mutlak.length; i++) {
    const fark = Math.round((mutlak[i] - mutlak[i - 1]) / 60);
    // 0 dakikalık farklar aynı seferin kopyası, 90 dakikadan büyükler ise servis boşluğu.
    if (fark > 0 && fark <= 90) farklar.push(fark);
  }

  let aralikDk: number | null = null;
  let altDk: number | null = null;
  let ustDk: number | null = null;
  // Sıklıktan söz edebilmek için en az üç kalkış ve makul bir aralık gerekiyor.
  if (farklar.length >= 2) {
    const orta = ortanca(farklar);
    if (orta > 0 && orta <= 30) {
      aralikDk = orta;
      const yakin = farklar.filter((f) => Math.abs(f - orta) <= Math.max(2, orta * 0.5));
      altDk = Math.min(...yakin);
      ustDk = Math.max(...yakin);
      if (altDk === ustDk) {
        altDk = null;
        ustDk = null;
      }
    }
  }

  const sonSaniye = kalkislar[kalkislar.length - 1].saniye;
  let sonrakiSaniye: number | null = null;
  if (binisSaniye != null) {
    const sonraki = kalkislar.find((k) => k.saniye > binisSaniye + 30);
    sonrakiSaniye = sonraki ? sonraki.saniye : null;
  }

  return {
    aralikDk,
    altDk,
    ustDk,
    sonrakiSaniye,
    sonSefer: binisSaniye != null && sonrakiSaniye == null && kalkislar.length > 0,
    sonSaniye,
  };
}

/** "Yaklaşık her 5 dakikada bir" ya da "Her 4–6 dakikada bir". */
export function sikliktanYazi(bilgi: SeferBilgisi): string {
  if (bilgi.aralikDk == null) return '';
  if (bilgi.altDk != null && bilgi.ustDk != null && bilgi.ustDk - bilgi.altDk >= 1) {
    return `Her ${bilgi.altDk}–${bilgi.ustDk} dakikada bir`;
  }
  return `Yaklaşık her ${bilgi.aralikDk} dakikada bir`;
}
