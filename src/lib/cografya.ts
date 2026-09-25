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

/**
 * Bir noktanın bir çizgiye (kırık çizgi) olan en kısa uzaklığı, metre.
 *
 * Şehir ölçeğinde yeterince doğru bir düzlem yaklaşımı kullanıyor: nokta
 * çevresinde boylam cos(enlem) ile daraltılıyor, sonra doğru parçasına dik
 * uzaklık alınıyor.
 */
export function cizgiyeUzaklik(nokta: Nokta, cizgi: Nokta[]): number {
  if (!cizgi.length) return Infinity;
  const kx = 111320 * Math.cos((nokta.latitude * Math.PI) / 180);
  const ky = 110540;
  const x = (p: Nokta) => (p.longitude - nokta.longitude) * kx;
  const y = (p: Nokta) => (p.latitude - nokta.latitude) * ky;
  if (cizgi.length === 1) return Math.hypot(x(cizgi[0]), y(cizgi[0]));
  let enAz = Infinity;
  for (let i = 1; i < cizgi.length; i++) {
    const ax = x(cizgi[i - 1]);
    const ay = y(cizgi[i - 1]);
    const bx = x(cizgi[i]);
    const by = y(cizgi[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const boy2 = dx * dx + dy * dy;
    // Nokta (0,0)'da; parçanın ona en yakın yeri.
    const t = boy2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / boy2)) : 0;
    const u = Math.hypot(ax + t * dx, ay + t * dy);
    if (u < enAz) enAz = u;
  }
  return enAz;
}

/**
 * Noktanın bir çizgi üstündeki yeri: çizginin başından, noktanın izdüşümüne kadar
 * çizgi boyunca kaç metre (`boyunca`), noktanın çizgiye uzaklığı (`uzaklik`) ve
 * çizginin toplam boyu. Yürüme tarifinde "sıradaki dönüşe kaç metre" bunun üstüne
 * kuruluyor: kuş uçuşu değil, yürünecek yol boyunca.
 */
export function cizgiUzerindeYer(nokta: Nokta, cizgi: Nokta[]): { boyunca: number; uzaklik: number; toplam: number } {
  const kx = 111320 * Math.cos((nokta.latitude * Math.PI) / 180);
  const ky = 110540;
  const x = (p: Nokta) => (p.longitude - nokta.longitude) * kx;
  const y = (p: Nokta) => (p.latitude - nokta.latitude) * ky;
  if (cizgi.length < 2) {
    return { boyunca: 0, uzaklik: cizgi.length ? Math.hypot(x(cizgi[0]), y(cizgi[0])) : Infinity, toplam: 0 };
  }
  let biriken = 0;
  let enIyi = { boyunca: 0, uzaklik: Infinity };
  for (let i = 1; i < cizgi.length; i++) {
    const ax = x(cizgi[i - 1]);
    const ay = y(cizgi[i - 1]);
    const dx = x(cizgi[i]) - ax;
    const dy = y(cizgi[i]) - ay;
    const boy = Math.hypot(dx, dy);
    const t = boy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (boy * boy))) : 0;
    const u = Math.hypot(ax + t * dx, ay + t * dy);
    if (u < enIyi.uzaklik) enIyi = { boyunca: biriken + t * boy, uzaklik: u };
    biriken += boy;
  }
  return { ...enIyi, toplam: biriken };
}

/**
 * Dokunulan noktaya en yakın çizginin anahtarı; hiçbiri eşikten yakın değilse null.
 *
 * Harita kütüphanesinin kendi çizgi dokunma algısı kullanılmıyor: iOS'ta çizgiye
 * basılınca çizginin olayından hemen sonra haritanın olayı da her koşulda
 * geliyor, isabet payı da yalnızca 10 piksel. Seçimi burada kendimiz yapınca iki
 * platform aynı davranıyor ve ince çizgiler de rahat seçiliyor.
 *
 * Eşitlikte listede önce gelen kazanır.
 */
export function enYakinCizgi<K>(
  nokta: Nokta,
  cizgiler: { anahtar: K; noktalar: Nokta[] }[],
  esikMetre: number,
): K | null {
  let enIyi: K | null = null;
  let enAz = esikMetre;
  for (const c of cizgiler) {
    const u = cizgiyeUzaklik(nokta, c.noktalar);
    if (u < enAz || (u === enAz && enIyi === null && u <= esikMetre)) {
      enAz = u;
      enIyi = c.anahtar;
    }
  }
  return enIyi;
}

/** Görünen bölgede bir ekran pikselinin kaç metre ettiği (yatay). */
export function metrePiksel(bolge: { latitude: number; longitudeDelta: number }, ekranGenisligi: number): number {
  if (!ekranGenisligi) return 0;
  return (bolge.longitudeDelta * 111320 * Math.cos((bolge.latitude * Math.PI) / 180)) / ekranGenisligi;
}
