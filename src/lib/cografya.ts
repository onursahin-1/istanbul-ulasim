// Harita ve konum hesapları.

export type Nokta = { latitude: number; longitude: number };

/** Rota motorunun döndürdüğü sıkıştırılmış çizgiyi (Google polyline, 5 basamak) koordinatlara açar. */
export function polylineCoz(kodlu?: string | null): Nokta[] {
  if (!kodlu) return [];
  const noktalar: Nokta[] = [];
  let i = 0;
  let enlem = 0;
  let boylam = 0;
  while (i < kodlu.length) {
    for (const eksen of [0, 1]) {
      let sonuc = 0;
      let kayma = 0;
      let bayt: number;
      do {
        bayt = kodlu.charCodeAt(i++) - 63;
        sonuc |= (bayt & 0x1f) << kayma;
        kayma += 5;
      } while (bayt >= 0x20 && i < kodlu.length);
      const fark = sonuc & 1 ? ~(sonuc >> 1) : sonuc >> 1;
      if (eksen === 0) enlem += fark;
      else boylam += fark;
    }
    noktalar.push({ latitude: enlem / 1e5, longitude: boylam / 1e5 });
  }
  return noktalar;
}

/** İki nokta arasındaki kuş uçuşu mesafe (metre). */
export function mesafeMetre(a: Nokta, b: Nokta): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dEnlem = rad(b.latitude - a.latitude);
  const dBoylam = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dEnlem / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dBoylam / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Kadıköy, Altıyol: konum izni verilmezse ya da telefon İstanbul dışındaysa kullanılır. */
export const VARSAYILAN_KONUM: Nokta = { latitude: 40.99018, longitude: 29.02824 };

export function istanbulIcinde(n: Nokta): boolean {
  return n.latitude > 40.75 && n.latitude < 41.65 && n.longitude > 27.9 && n.longitude < 30.0;
}
