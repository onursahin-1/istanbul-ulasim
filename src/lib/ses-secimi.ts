// Sesli yol tarifi için telefonda yüklü Türkçe seslerden seçim ve okunacak metnin
// düzeltilmesi.
//
// iOS'ta Türkçe ses varsayılan olarak "Yelda"nın sıkıştırılmış (compact) sürümü; boğuk
// ve hızlı duyuluyor. Aynı sesin "gelişmiş" (enhanced) ya da "premium" sürümü çok daha
// anlaşılır ama kullanıcı indirmeli: Ayarlar › Erişilebilirlik › Seslendirilen İçerik ›
// Sesler › Türkçe. Burada varsa her zaman en kaliteli sürüm seçiliyor.
//
// Cinsiyet: konuşma motoru sesin cinsiyetini vermiyor; bilinen ses adlarından çıkarılıyor.
// Seçilen cinsiyette ses yoksa öbürü kullanılıyor ve ekranda söyleniyor.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

export type SesCinsiyeti = 'kadin' | 'erkek';

export type SesBilgisi = { identifier: string; name: string; quality: string; language: string };

/** Apple'ın ve Android'in bilinen ses adları (Türkçe ve çok dilli Eloquence sesleri). */
const KADIN_ADLARI = ['yelda', 'aylin', 'seda', 'filiz', 'flo', 'sandy', 'shelley', 'grandma', 'female'];
const ERKEK_ADLARI = ['cem', 'emre', 'kerem', 'murat', 'eddy', 'reed', 'rocko', 'grandpa', 'male'];

export function sesCinsiyeti(ses: SesBilgisi): SesCinsiyeti | null {
  const ad = `${ses.name} ${ses.identifier}`.toLocaleLowerCase('tr-TR');
  // "female" "male"i içerdiği için önce kadın adlarına bakılıyor.
  if (KADIN_ADLARI.some((k) => new RegExp(`\\b${k}\\b|[._-]${k}`).test(ad))) return 'kadin';
  if (ERKEK_ADLARI.some((k) => new RegExp(`\\b${k}\\b|[._-]${k}`).test(ad))) return 'erkek';
  return null;
}

/** Ses kalitesi puanı: premium > gelişmiş > varsayılan (sıkıştırılmış). */
export function sesKalitesi(ses: SesBilgisi): number {
  const kimlik = ses.identifier.toLowerCase();
  if (kimlik.includes('premium')) return 3;
  if (kimlik.includes('enhanced') || ses.quality === 'Enhanced') return 2;
  if (kimlik.includes('compact')) return 0;
  return 1;
}

export function turkceMi(ses: SesBilgisi): boolean {
  return /^tr([-_]|$)/i.test(ses.language);
}

/**
 * İstenen cinsiyette en kaliteli Türkçe ses. Yoksa en kaliteli Türkçe ses ve
 * `uydu: false`. Hiç Türkçe ses yoksa null (konuşma motoru dili kendisi seçer).
 */
export function sesSec(sesler: SesBilgisi[], cinsiyet: SesCinsiyeti): { ses: SesBilgisi; uydu: boolean } | null {
  const turkce = sesler.filter(turkceMi).sort((a, b) => sesKalitesi(b) - sesKalitesi(a) || a.name.localeCompare(b.name));
  if (!turkce.length) return null;
  const uyan = turkce.find((s) => sesCinsiyeti(s) === cinsiyet);
  if (uyan) return { ses: uyan, uydu: true };
  // Cinsiyeti bilinmeyen ses de seçilebilir; ama "uydu" denmez.
  return { ses: turkce[0], uydu: false };
}

/**
 * Telefonda hangi cinsiyetlerde Türkçe ses var. iPhone'da Türkçe için yalnız Yelda
 * (kadın) olduğundan çoğu zaman ['kadin']: o zaman ayarlarda seçim gösterilmez.
 */
export function cinsiyetSecenekleri(sesler: SesBilgisi[]): SesCinsiyeti[] {
  const var_ = new Set(sesler.filter(turkceMi).map(sesCinsiyeti).filter((c): c is SesCinsiyeti => c !== null));
  return (['kadin', 'erkek'] as SesCinsiyeti[]).filter((c) => var_.has(c));
}

/** Ekranda gösterilecek ad: "Yelda (gelişmiş)". */
export function sesAdi(ses: SesBilgisi): string {
  const k = sesKalitesi(ses);
  const ek = k === 3 ? ' (premium)' : k === 2 ? ' (gelişmiş)' : k === 0 ? ' (sıkıştırılmış)' : '';
  return `${ses.name}${ek}`;
}

// Durak ve sokak adlarındaki kısaltmalar yazıldığı gibi okununca anlaşılmıyor
// ("Mah." → "mah", "Cad." → "cad"). Sonda nokta olsa da olmasa da açılıyor.
const KISALTMALAR: [string, string][] = [
  ['Mah', 'Mahallesi'],
  ['Mh', 'Mahallesi'],
  ['Cad', 'Caddesi'],
  ['Cd', 'Caddesi'],
  ['Sok', 'Sokak'],
  ['Sk', 'Sokak'],
  ['Bulv', 'Bulvarı'],
  ['Blv', 'Bulvarı'],
  ['Meyd', 'Meydanı'],
  ['Üniv', 'Üniversitesi'],
  ['Hast', 'Hastanesi'],
];
// \b Türkçe harflerde (Ü, İ) çalışmadığı için sözcük başı elle: satır başı, boşluk, virgül, parantez.
const KISALTMA_DESENLERI = KISALTMALAR.map(
  ([kisa, acik]) => [new RegExp(`(^|[\\s,(])${kisa}\\.?(?=\\s|$|,|\\))`, 'g'), `$1${acik}`] as const,
);

/** Okunacak metni düzeltir: kısaltmalar açılır, "–" ve "/" duraklamaya çevrilir. */
export function soylenecekMetin(metin: string): string {
  let m = metin;
  for (const [desen, acik] of KISALTMA_DESENLERI) m = m.replace(desen, acik);
  return m
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
