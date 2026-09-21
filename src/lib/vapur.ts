// Vapur ücretleri.
//
// Vapurda mesafe kademesi yok, her hattın kendi fiyatı var. Kaynak: İBB Toplu Ulaşım
// Hizmetleri Müdürlüğü'nün 20.07.2026'dan geçerli tarifesi, "Şehir İçi Vapurları"
// bölümü — 17 hat.
//
// Önemli ayrım: bu tarife yalnızca **Şehir Hatları** için geçerli. Turyol, Dentur
// Avrasya ve İDO aynı iskeleler arasında çalışıyor ama kendi fiyatlarını uyguluyor ve
// o fiyatlar yayımlanmıyor. Onlarda Şehir Hatları fiyatını tahmin olarak kullanıp
// tutarı "yaklaşık" işaretliyoruz — yanlış rakamı kesinmiş gibi göstermektense.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

const AKSAN: Record<string, string> = {
  ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u',
};

function sade(metin?: string | null): string {
  const kucuk = (metin ?? '').replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
  return [...kucuk].map((h) => AKSAN[h] ?? h).filter((h) => /[a-z0-9]/.test(h)).join('');
}

/**
 * İskele adlarının sadeleştirilmiş anahtarları.
 *
 * Veride aynı iskele birçok yazımla geçiyor: "KADIKÖY (METRO)", "YENİKADIKÖY",
 * "KADIKÖY2 (ÇAYIRBAŞI)" hepsi Kadıköy. Anahtarlar sadeleştirilmiş adın **içinde**
 * aranıyor, o yüzden uzun yazımlar da yakalanıyor.
 */
const ISKELELER: [string, string][] = [
  ['adalar', 'adalar'],
  ['buyukada', 'adalar'],
  ['heybeliada', 'adalar'],
  ['burgazada', 'adalar'],
  ['kinaliada', 'adalar'],
  ['anadoluhisari', 'anadoluhisari'],
  ['kucuksu', 'kucuksu'],
  ['asiyan', 'asiyan'],
  ['bostanci', 'bostanci'],
  ['cengelkoy', 'cengelkoy'],
  ['ortakoy', 'ortakoy'],
  ['besiktas', 'besiktas'],
  ['kabatas', 'kabatas'],
  ['karakoy', 'karakoy'],
  ['eminonu', 'eminonu'],
  ['uskudar', 'uskudar'],
  ['kadikoy', 'kadikoy'],
  ['beykoz', 'beykoz'],
  ['yenikoy', 'yenikoy'],
  ['sariyer', 'sariyer'],
  ['moda', 'moda'],
];

/** Bir iskele adını tanınan anahtara indirger; tanınmazsa null. */
export function iskeleAnahtari(ad?: string | null): string | null {
  const d = sade(ad);
  if (!d) return null;
  for (const [parca, anahtar] of ISKELELER) {
    if (d.includes(parca)) return anahtar;
  }
  return null;
}

/** [tam, öğrenci] kuruş. */
type Fiyat = [number, number];

const CIFT_FIYATLARI: Record<string, Fiyat> = {
  'eminonu|uskudar': [5852, 2844],
  'ortakoy|uskudar': [5181, 2508],
  'kadikoy|ortakoy': [7107, 3427],
  'kadikoy|uskudar': [6270, 3094],
  'eminonu|kadikoy': [6521, 3176],
  'kadikoy|karakoy': [6521, 3176],
  'besiktas|uskudar': [5015, 2443],
  'kabatas|uskudar': [5181, 2508],
  'besiktas|kadikoy': [6521, 3176],
  'kabatas|kadikoy': [6270, 3094],
  'beykoz|yenikoy': [5097, 2508],
  'bostanci|karakoy': [7690, 3761],
  'anadoluhisari|asiyan': [5015, 2443],
  'asiyan|kucuksu': [5015, 2443],
  'anadoluhisari|kucuksu': [5015, 2443],
  'asiyan|uskudar': [6853, 3345],
  'beykoz|sariyer': [6104, 3010],
  'cengelkoy|kabatas': [6185, 3010],
  'bostanci|kabatas': [7690, 3761],
  'bostanci|moda': [7690, 3761],
  'karakoy|moda': [7690, 3761],
};

/** Adalar hatları ayrı tarifeden; ilk biniş ve aktarma aynı tutar. */
const ADALAR: Fiyat = [15123, 7564];

/** Tarifede bulunmayan hatlar için temsilî değer (Üsküdar–Eminönü). */
const TEMSILI: Fiyat = [5852, 2844];

/** İstanbulkart tarifesi yalnızca Şehir Hatları için yayımlanıyor. */
export function sehirHatlariMi(isletmeci?: string | null): boolean {
  const d = sade(isletmeci);
  return d.includes('sehirhatlari') || d.includes('sehirhatlar');
}

export type VapurUcreti = {
  /** Kuruş, tam bilet karşılığı. */
  tam: number;
  ogrenci: number;
  /** Tutar kesin mi, tahmin mi. */
  yaklasik: boolean;
  /** Kullanıcıya gösterilecek kısa gerekçe. */
  aciklama: string;
};

/**
 * Bir vapur bacağının ücreti.
 *
 * @param binis  binilen iskelenin adı
 * @param inis   inilen iskelenin adı
 * @param isletmeci hattın işletmecisi
 */
export function vapurUcreti(binis?: string | null, inis?: string | null, isletmeci?: string | null): VapurUcreti {
  const a = iskeleAnahtari(binis);
  const b = iskeleAnahtari(inis);
  const ozel = !sehirHatlariMi(isletmeci);

  if (a === 'adalar' || b === 'adalar') {
    return {
      tam: ADALAR[0],
      ogrenci: ADALAR[1],
      yaklasik: ozel,
      aciklama: ozel ? 'Adalar vapuru · özel işletmeci, tutar yaklaşık' : 'Adalar vapuru',
    };
  }

  const anahtar = a && b && a !== b ? [a, b].sort().join('|') : null;
  const fiyat = anahtar ? CIFT_FIYATLARI[anahtar] : undefined;

  if (!fiyat) {
    return {
      tam: TEMSILI[0],
      ogrenci: TEMSILI[1],
      yaklasik: true,
      aciklama: 'Vapur · bu hat tarifede yok, tutar yaklaşık',
    };
  }

  return {
    tam: fiyat[0],
    ogrenci: fiyat[1],
    yaklasik: ozel,
    aciklama: ozel ? 'Vapur · özel işletmeci, tutar yaklaşık' : 'Vapur',
  };
}
