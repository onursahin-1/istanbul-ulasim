// Aynı hattın beslemede birden çok "güzergâh" (route) olarak durması.
//
// İETT her yönü ve her varyantı ayrı bir route olarak yayımlıyor: T2 nostaljik tramvay
// "Taksim Meydan - Beyoğlu Tünel" ve "Beyoğlu Tünel - Taksim Meydan" diye iki kez,
// 80T üç kez. Hat listesinde her biri ayrı satır oluyor, hat ekranında da yalnız bir
// yön görünüyordu. Kısa adı, araç tipi ve işletmecisi aynı olan güzergâhlar tek hat
// sayılıyor.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

export type TekillenecekHat = {
  gtfsId: string;
  shortName: string | null;
  mode?: string | null;
  agency?: { name: string } | null;
};

/** Aynı hattın güzergâhlarını birleştiren anahtar; kısa adı olmayan hat kendi başına. */
export function hatGrubu(h: TekillenecekHat): string {
  const kisa = (h.shortName ?? '').trim().toLocaleUpperCase('tr-TR');
  if (!kisa) return `#${h.gtfsId}`;
  return `${(h.mode ?? '').toUpperCase()}|${h.agency?.name ?? ''}|${kisa}`;
}

/**
 * Listeyi hat başına tek satıra indirir. İlk görülen güzergâh temsilci olur;
 * `kardesler` hepsinin kimlikleri (temsilci dahil, ilk o).
 */
export function hatlariTekille<T extends TekillenecekHat>(hatlar: T[]): (T & { kardesler: string[] })[] {
  const gruplar = new Map<string, T & { kardesler: string[] }>();
  for (const h of hatlar) {
    const a = hatGrubu(h);
    const var_ = gruplar.get(a);
    if (var_) var_.kardesler.push(h.gtfsId);
    else gruplar.set(a, { ...h, kardesler: [h.gtfsId] });
  }
  return [...gruplar.values()];
}

/** Bir hattın öbür güzergâhlarının kimlikleri (kendisi hariç). */
export function kardesKimlikleri(hat: TekillenecekHat, hepsi: TekillenecekHat[]): string[] {
  const a = hatGrubu(hat);
  return hepsi.filter((h) => h.gtfsId !== hat.gtfsId && hatGrubu(h) === a).map((h) => h.gtfsId);
}
