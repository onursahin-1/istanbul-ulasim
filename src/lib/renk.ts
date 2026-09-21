// Renk karıştırma ve okunurluk hesapları.
//
// Rozet tasarımı hat renginden iki türev istiyor: yazının üstünde duracağı açık zemin
// ve o zeminde okunan bir yazı rengi. İkisini elle tablo hâlinde tutmak 30 hattı iki
// temada yönetmek demek; hesaplamak hem daha az iş hem de yeni hat eklenince
// kendiliğinden çalışıyor.
//
// Okunurluk tahmine bırakılmıyor: WCAG karşıtlık oranı hesaplanıp 4.5'in altındaysa
// yazı yeterince koyulaşana (ya da açılana) kadar itiliyor.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

export type Rgb = { k: number; y: number; m: number };

/** "#de1c72" ya da "de1c72" → {k,y,m}. Tanınmayan kod için null. */
export function renkCoz(kod?: string | null): Rgb | null {
  const temiz = (kod ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(temiz)) return null;
  return {
    k: parseInt(temiz.slice(0, 2), 16),
    y: parseInt(temiz.slice(2, 4), 16),
    m: parseInt(temiz.slice(4, 6), 16),
  };
}

const iki = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

export function renkYaz(r: Rgb): string {
  return `#${iki(r.k)}${iki(r.y)}${iki(r.m)}`;
}

/** İki rengi karıştırır. oran 0 → a, 1 → b. */
export function karistir(a: string, b: string, oran: number): string {
  const x = renkCoz(a);
  const y = renkCoz(b);
  if (!x || !y) return a;
  const t = Math.max(0, Math.min(1, oran));
  return renkYaz({ k: x.k + (y.k - x.k) * t, y: x.y + (y.y - x.y) * t, m: x.m + (y.m - x.m) * t });
}

/** WCAG bağıl parlaklık. */
export function parlaklik(kod: string): number {
  const r = renkCoz(kod);
  if (!r) return 0;
  const kanal = (deger: number) => {
    const oran = deger / 255;
    return oran <= 0.03928 ? oran / 12.92 : ((oran + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(r.k) + 0.7152 * kanal(r.y) + 0.0722 * kanal(r.m);
}

/** İki renk arasındaki WCAG karşıtlık oranı (1–21). */
export function karsitlik(a: string, b: string): number {
  const x = parlaklik(a);
  const y = parlaklik(b);
  const [ust, alt] = x > y ? [x, y] : [y, x];
  return (ust + 0.05) / (alt + 0.05);
}

/**
 * Rengi, verilen zeminde okunur hâle gelene kadar koyulaştırır ya da açar.
 * @param hedef istenen karşıtlık oranı (WCAG AA gövde metni için 4.5)
 */
export function okunurYap(renk: string, zemin: string, hedef = 4.5): string {
  if (karsitlik(renk, zemin) >= hedef) return renk;
  // Zemin açıksa yazıyı siyaha, koyuysa beyaza doğru itiyoruz.
  const yon = parlaklik(zemin) > 0.4 ? '#000000' : '#ffffff';
  let adim = 0.08;
  let sonuc = renk;
  while (adim <= 1 && karsitlik(sonuc, zemin) < hedef) {
    sonuc = karistir(renk, yon, adim);
    adim += 0.08;
  }
  return sonuc;
}
