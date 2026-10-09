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
export function siklikBul(veri: SiklikVerisi, kisaAd?: string | null, uzunAd?: string | null): Pencere[] | null {
  if (!kisaAd) return null;
  const kisa = trBuyuk(kisaAd).trim();
  // Kodlu minibüste kodun birden çok güzergâhı var: önce "KOD|GÜZERGÂH" (veri/siklik-cikar.py).
  if (uzunAd) {
    const tam = veri[`${kisa}|${trBuyuk(uzunAd).trim()}`];
    if (tam) return tam;
  }
  return veri[kisa] ?? null;
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

/** Tarife ekranında bir sıklık penceresi: başlangıç ve bitiş (gün başından dk), aralık (dk). */
export type GunPenceresi = { bas: number; bit: number; aralik: number };

/**
 * Bir günün pencereleri (gun: 0 = pazartesi), başlangıca göre sıralı. Aynı aralıkla
 * bitişik ya da üst üste binen pencereler tek satır; aynı saatleri iki desenden gelen
 * pencere de (aralıklar farklıysa sıkı olanı). Gece yarısını aşan pencere (bitiş > 1440)
 * bu günün satırı olarak kalır: "23:00 – 01:30".
 */
export function gununPencereleri(pencereler: Pencere[] | null, gun: number): GunPenceresi[] {
  const liste = (pencereler ?? [])
    .filter(([maske]) => maske[gun] === '1')
    .map(([, bas, bit, aralik]) => ({ bas, bit, aralik }))
    .sort((a, b) => a.bas - b.bas || a.bit - b.bit);
  const sonuc: GunPenceresi[] = [];
  for (const p of liste) {
    const son = sonuc[sonuc.length - 1];
    if (son && son.bas === p.bas && son.bit === p.bit) {
      son.aralik = Math.min(son.aralik, p.aralik);
      continue;
    }
    if (son && son.aralik === p.aralik && p.bas <= son.bit) {
      son.bit = Math.max(son.bit, p.bit);
      continue;
    }
    sonuc.push({ ...p });
  }
  return sonuc;
}

export type SiklikSimdi = {
  /** "Şu an her 5 dk", "İlk sefer 07:00", "Sonraki sefer 16:00", "Bugünlük seferler bitti" */
  ana: string;
  /** "21:00 sonrası her 7 dk · son sefer 22:45"; yoksa null. */
  ek: string | null;
  /** Şu an içinde bulunulan pencerenin sırası (bugun dizisinde); yoksa -1. */
  simdiki: number;
};

/**
 * Tarife ekranının üstündeki "şu an" kutusu. `dun` dünün pencereleri: gece yarısını aşan
 * bir pencere (ör. 23:00 – 01:30) bugünün ilk saatlerinde hâlâ sürüyor olabilir.
 * Bugün hiç pencere yoksa ve dünden süren de yoksa null.
 */
export function siklikSimdi(bugun: GunPenceresi[], dun: GunPenceresi[], dakika: number): SiklikSimdi | null {
  const surenDun = dun.find((p) => p.bit > 1440 && dakika < p.bit - 1440);
  if (!bugun.length && !surenDun) return null;
  const sonSefer = bugun.length ? Math.max(...bugun.map((p) => p.bit)) : surenDun!.bit - 1440;
  const sonYazi = `son sefer ${dakikadanSaat(sonSefer)}`;

  const simdiki = bugun.findIndex((p) => p.bas <= dakika && dakika < p.bit);
  const icinde = simdiki >= 0 ? bugun[simdiki] : surenDun;
  if (icinde) {
    // Sıradaki farklı aralık: "21:00 sonrası her 7 dk".
    const degisen = bugun.find((p) => p.bas > dakika && p.aralik !== icinde.aralik);
    const ek = [degisen ? `${dakikadanSaat(degisen.bas)} sonrası her ${degisen.aralik} dk` : null, sonYazi]
      .filter(Boolean)
      .join(' · ');
    return { ana: `Şu an her ${icinde.aralik} dk`, ek, simdiki };
  }
  const sonraki = bugun.find((p) => p.bas > dakika);
  if (sonraki) {
    const ilk = sonraki === bugun[0];
    return {
      ana: `${ilk ? 'İlk sefer' : 'Sonraki sefer'} ${dakikadanSaat(sonraki.bas)}`,
      ek: `her ${sonraki.aralik} dk · ${sonYazi}`,
      simdiki: -1,
    };
  }
  return { ana: 'Bugünlük seferler bitti', ek: null, simdiki: -1 };
}
