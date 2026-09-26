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

type BirlesecekDesen<K> = { pattern: { code: string } | null; stoptimes: K[] | null };
type BirlesecekKalkis = {
  stop?: { gtfsId: string } | null;
  scheduledDeparture?: number | null;
  serviceDay?: number | null;
  trip?: { gtfsId: string } | null;
};

/**
 * Durağın desenlerinde aynı desen birden çok kez gelebiliyor. Aynı desen ve aynı peron
 * tek satıra toplanır; kalkışları birleşir, aynı sefer aynı saatte iki kez yazılmaz,
 * sıralanır.
 *
 * Farklı peronlar ayrı kalır: ring hattı (91E "Göztepe Mahallesi - Aksaray Ring")
 * istasyonun bir peronundan gidişte, karşısındakinden dönüşte geçiyor. İkisini tek
 * satırda birleştirmek iki ayrı yönün saatlerini karıştırıyordu (19:04 bu taraftan,
 * 19:11 karşı taraftan).
 */
export function desenleriBirlestir<K extends BirlesecekKalkis, D extends BirlesecekDesen<K>>(desenler: D[]): D[] {
  const sira: D[] = [];
  const kodla = new Map<string, D>();
  for (const d of desenler) {
    const peron = (d.stoptimes ?? []).find((k) => k?.stop?.gtfsId)?.stop?.gtfsId ?? '';
    const kod = d.pattern?.code ? `${d.pattern.code}|${peron}` : undefined;
    if (!kod) {
      sira.push(d);
      continue;
    }
    const var_ = kodla.get(kod);
    if (!var_) {
      const kopya = { ...d, stoptimes: [...(d.stoptimes ?? [])] };
      kodla.set(kod, kopya);
      sira.push(kopya);
      continue;
    }
    const gorulen = new Set((var_.stoptimes ?? []).map(kalkisAnahtari));
    for (const k of d.stoptimes ?? []) {
      const a = kalkisAnahtari(k);
      if (gorulen.has(a)) continue;
      gorulen.add(a);
      var_.stoptimes!.push(k);
    }
    var_.stoptimes!.sort(
      (x, y) => (x.serviceDay ?? 0) + (x.scheduledDeparture ?? 0) - ((y.serviceDay ?? 0) + (y.scheduledDeparture ?? 0)),
    );
  }
  return sira;
}

function kalkisAnahtari(k: BirlesecekKalkis): string {
  return `${k.trip?.gtfsId ?? ''}|${k.serviceDay ?? 0}|${k.scheduledDeparture ?? 0}`;
}
