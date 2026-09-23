// Minibüs ve dolmuş hatlarının sefer sıklığı.
//
// Bu hatların saatli seferi yok; GTFS'te "07:00–23:00 arası her 5 dakikada" gibi
// pencereler var. OTP bu pencereleri API'de vermediği için veri/siklik-cikar.py
// onları assets/veri/siklik.json'a çıkarıyor, burada o dosya okunuyor.
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor. Veri dosyası
// çağıran tarafından veriliyor (siklikBul).

import { trBuyuk } from './metin';

/** [gün maskesi (pzt→paz), başlangıç dk, bitiş dk, aralık dk] */
export type Pencere = [string, number, number, number];
export type SiklikVerisi = Record<string, Pencere[]>;

export type SiklikDurumu =
  | { tur: 'calisiyor'; aralik: number; sonSefer: number }
  | { tur: 'baslayacak'; ilkSefer: number }
  | { tur: 'bitti' };

/** İstanbul'da haftanın günü (0 = pazartesi) ve gün başından dakika. İstanbul hep UTC+3. */
export function istanbulAni(simdiMs: number): { gun: number; dakika: number } {
  const t = new Date(simdiMs + 3 * 3600_000);
  return { gun: (t.getUTCDay() + 6) % 7, dakika: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** Hattın kısa adından pencereleri. Bulunamazsa null. */
export function siklikBul(veri: SiklikVerisi, kisaAd?: string | null): Pencere[] | null {
  if (!kisaAd) return null;
  return veri[trBuyuk(kisaAd).trim()] ?? null;
}

/**
 * Şu an hattın durumu: çalışıyorsa kaç dakikada bir ve son sefer; henüz başlamadıysa
 * ilk sefer; bittiyse bitti. Bugün için hiç pencere yoksa null.
 *
 * Gece yarısını aşan pencereler (bitiş > 1440) ertesi günün başına da sayılıyor.
 */
export function siklikDurumu(pencereler: Pencere[] | null, simdiMs: number): SiklikDurumu | null {
  if (!pencereler?.length) return null;
  const { gun, dakika } = istanbulAni(simdiMs);
  const dun = (gun + 6) % 7;
  const bugun: [number, number, number][] = [];
  for (const [maske, bas, bit, aralik] of pencereler) {
    if (maske[gun] === '1') bugun.push([bas, bit, aralik]);
    if (maske[dun] === '1' && bit > 1440) bugun.push([Math.max(0, bas - 1440), bit - 1440, aralik]);
  }
  if (!bugun.length) return null;

  const sonSefer = Math.max(...bugun.map((p) => p[1]));
  const simdiki = bugun.filter(([bas, bit]) => bas <= dakika && dakika < bit);
  if (simdiki.length) return { tur: 'calisiyor', aralik: Math.min(...simdiki.map((p) => p[2])), sonSefer };
  const sonraki = bugun.filter(([bas]) => bas > dakika);
  if (sonraki.length) return { tur: 'baslayacak', ilkSefer: Math.min(...sonraki.map((p) => p[0])) };
  return { tur: 'bitti' };
}

/** Dakikayı saate: 1380 → "23:00", 1470 → "00:30". */
export function dakikadanSaat(dk: number): string {
  const d = ((dk % 1440) + 1440) % 1440;
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`;
}

/** Tek hat için: "Her 5 dk · son sefer 23:00", "İlk sefer 06:30", "Bugünlük seferler bitti". */
export function siklikYaz(durum: SiklikDurumu | null): string | null {
  if (!durum) return null;
  if (durum.tur === 'calisiyor') return `Her ${durum.aralik} dk · son sefer ${dakikadanSaat(durum.sonSefer)}`;
  if (durum.tur === 'baslayacak') return `İlk sefer ${dakikadanSaat(durum.ilkSefer)}`;
  return 'Bugünlük seferler bitti';
}

/**
 * Birden çok hat için tek satır (yakındaki duraklar listesi): çalışanların aralığı.
 * "3–10 dk arayla", "her 5 dk", "şu an sefer yok"; hiç veri yoksa null.
 */
export function siklikOzeti(durumlar: (SiklikDurumu | null)[]): string | null {
  const bilinen = durumlar.filter((d): d is SiklikDurumu => !!d);
  if (!bilinen.length) return null;
  const araliklar = bilinen.flatMap((d) => (d.tur === 'calisiyor' ? [d.aralik] : []));
  if (!araliklar.length) return 'şu an sefer yok';
  const en = Math.min(...araliklar);
  const cok = Math.max(...araliklar);
  return en === cok ? `her ${en} dk` : `${en}–${cok} dk arayla`;
}
