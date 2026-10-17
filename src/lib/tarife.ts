// Bir hattın bir duraktan bütün günkü kalkışları: hangi gün sorulacak, saat saat tablo.
//
// Rota motoru tarifeyi "hizmet günü" ile veriyor (stoptimesForServiceDate). Hafta içi,
// Cumartesi ve Pazar için bugünden başlayıp o türün ilk sıradan gününe bakıyoruz.
// Resmî tatiller atlanıyor: bayramda Pazar tarifesi işler (ozel-gunler.json), "hafta
// içi" diye bayram gününün tarifesini göstermek yanlış olur.
//
// Saniyeler hizmet gününün başından: gece yarısını geçen seferler 24:xx, 25:xx diye
// gelir; tabloda günün sonunda 00, 01 satırı olarak görünürler.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

export type TarifeGunu = 'haftaici' | 'cumartesi' | 'pazar';

export const TARIFE_GUNLERI: [TarifeGunu, string][] = [
  ['haftaici', 'Hafta içi'],
  ['cumartesi', 'Cumartesi'],
  ['pazar', 'Pazar'],
];

const GUN = 86_400_000;

/** "2026-10-05" → o günün tarife türü (haftanın gününe göre). */
export function gunTuru(tarih: string): TarifeGunu {
  const g = new Date(`${tarih}T12:00:00Z`).getUTCDay();
  return g === 0 ? 'pazar' : g === 6 ? 'cumartesi' : 'haftaici';
}

/** Bugünün tarifesi: resmî tatilse o günün işlettiği tarife, değilse haftanın günü. */
export function bugununTarifesi(bugun: string, ozelGunler: { tarih: string; tarife: 'pazar' | 'cumartesi' }[]): TarifeGunu {
  return ozelGunler.find((g) => g.tarih === bugun)?.tarife ?? gunTuru(bugun);
}

/**
 * Her tarife türü için sorgulanacak hizmet günü (YYYYMMDD): bugünden başlayarak o türün
 * resmî tatil olmayan ilk günü. İki hafta içinde bulunamazsa (art arda bayramlar) tatil
 * de olsa ilk gün alınır.
 */
export function tarifeTarihleri(bugun: string, ozelGunler: { tarih: string }[]): Record<TarifeGunu, string> {
  const tatil = new Set(ozelGunler.map((g) => g.tarih));
  const sonuc: Partial<Record<TarifeGunu, string>> = {};
  const yedek: Partial<Record<TarifeGunu, string>> = {};
  const bas = new Date(`${bugun}T12:00:00Z`).getTime();
  for (let i = 0; i < 14; i++) {
    const tarih = new Date(bas + i * GUN).toISOString().slice(0, 10);
    const tur = gunTuru(tarih);
    const yaz = tarih.replace(/-/g, '');
    yedek[tur] ??= yaz;
    if (!tatil.has(tarih)) sonuc[tur] ??= yaz;
  }
  return {
    haftaici: sonuc.haftaici ?? yedek.haftaici!,
    cumartesi: sonuc.cumartesi ?? yedek.cumartesi!,
    pazar: sonuc.pazar ?? yedek.pazar!,
  };
}

/** Tablodaki bir kalkış: kısa dönüş seferinde son durağının harfi (bkz. kisaDonusleriIsaretle). */
export type TarifeKalkisi = { saniye: number; isaret?: string };

export type SaatSatiri = { saat: number; kalkislar: { saniye: number; dakika: number; isaret?: string }[] };

/**
 * Kalkışları saat satırlarına böler. Aynı dakikadaki tekrarlar (iki desenden gelen aynı
 * sefer) bir kez yazılır; aynı dakikada farklı yere giden iki sefer (T1'de 08:16 Kabataş
 * ve 08:16 Eminönü) ikisi de. Sıra saniyeye göre: 24:10 (gece 00:10) en sonda.
 */
export function saatlereBol(kalkislar: (number | TarifeKalkisi)[]): SaatSatiri[] {
  const tekil = new Map<string, TarifeKalkisi>();
  for (const k of kalkislar) {
    const x = typeof k === 'number' ? { saniye: k } : k;
    if (!Number.isFinite(x.saniye) || x.saniye < 0) continue;
    const saniye = Math.floor(x.saniye / 60) * 60;
    const anahtar = `${saniye}|${x.isaret ?? ''}`;
    if (!tekil.has(anahtar)) tekil.set(anahtar, { saniye, ...(x.isaret ? { isaret: x.isaret } : {}) });
  }
  // Aynı dakikada işaretsiz (hattın sonuna giden) önce.
  const sirali = [...tekil.values()].sort((a, b) => a.saniye - b.saniye || (a.isaret ?? '').localeCompare(b.isaret ?? ''));
  const satirlar: SaatSatiri[] = [];
  for (const { saniye, isaret } of sirali) {
    const saatSirasi = Math.floor(saniye / 3600);
    const son = satirlar[satirlar.length - 1];
    const kalkis = { saniye, dakika: Math.floor((saniye % 3600) / 60), ...(isaret ? { isaret } : {}) };
    if (son && Math.floor(son.kalkislar[0].saniye / 3600) === saatSirasi) son.kalkislar.push(kalkis);
    else satirlar.push({ saat: saatSirasi % 24, kalkislar: [kalkis] });
  }
  return satirlar;
}

/** Bugünün tablosunda sıradaki kalkışın saniyesi (yoksa null). `simdi`: gün başından saniye. */
export function siradakiKalkis(satirlar: SaatSatiri[], simdi: number): number | null {
  for (const satir of satirlar) for (const k of satir.kalkislar) if (k.saniye >= simdi) return k.saniye;
  return null;
}

/** Bir desenin o duraktan günlük kalkışları ve gittiği yer (otp.ts, durakTarifesiGetir). */
export type DesenTarifesi = {
  kod: string;
  /** Seferlerin gittiği yer: desenin tabelası, yoksa son durağı ("Ataköy"). */
  hedef: string;
  /** Desenin durak adları, sırasıyla. */
  duraklar: string[];
  saniyeler: number[];
};

export type KisaDonusAciklamasi = {
  harf: string;
  hedef: string;
  /** Hattın asıl ucuna giden seferlerin yolu üstünde bitiyor (kısa dönüş); değilse başka bir uca gidiyor. */
  kisa: boolean;
};

const sadeAd = (a: string) =>
  a
    .toLocaleLowerCase('tr-TR')
    .replace(/[^a-z0-9çğıöşü]/g, '');

/**
 * Hattın sonuna gitmeyen seferleri işaretler: Marmaray'da Pendik – Ataköy trenleri,
 * T1'de Cevizlibağ – Eminönü tramvayları Gebze – Halkalı ve Bağcılar – Kabataş
 * seferleriyle aynı tabloda; yolcu hangisinin nerede bittiğini görsün.
 *
 * Asıl uç o günün en çok seferinin gittiği yer; öbür yerlere giden her sefer o yerin baş
 * harfiyle işaretlenir (A = Ataköy). İki yer aynı harfle başlıyorsa iki harf, o da
 * tutmazsa sıra numarası eklenir. Tek bir yere gidiliyorsa işaret yok.
 */
export function kisaDonusleriIsaretle(desenler: DesenTarifesi[]): {
  kalkislar: TarifeKalkisi[];
  anaHedef: string | null;
  aciklamalar: KisaDonusAciklamasi[];
} {
  const sayilar = new Map<string, { ad: string; sayi: number }>();
  for (const d of desenler) {
    const a = sadeAd(d.hedef);
    if (!a) continue;
    const s = sayilar.get(a) ?? { ad: d.hedef, sayi: 0 };
    s.sayi += d.saniyeler.length;
    sayilar.set(a, s);
  }
  const ana = [...sayilar.entries()].sort((x, y) => y[1].sayi - x[1].sayi)[0];
  const tumu = desenler.flatMap((d) => d.saniyeler.map((saniye) => ({ saniye })));
  if (!ana || sayilar.size < 2) return { kalkislar: tumu, anaHedef: ana?.[1].ad ?? null, aciklamalar: [] };

  const anaYolu = new Set(desenler.filter((d) => sadeAd(d.hedef) === ana[0]).flatMap((d) => d.duraklar.map(sadeAd)));
  const harfler = new Map<string, string>();
  const aciklamalar: KisaDonusAciklamasi[] = [];
  const kullanilan = new Set<string>();
  const digerleri = [...sayilar.entries()].filter(([a]) => a !== ana[0]).sort((x, y) => y[1].sayi - x[1].sayi);
  for (const [a, { ad }] of digerleri) {
    const buyuk = ad.toLocaleUpperCase('tr-TR').replace(/[^A-ZÇĞİÖŞÜ0-9]/g, '');
    let harf = buyuk.slice(0, 1) || '?';
    if (kullanilan.has(harf)) harf = buyuk.slice(0, 2);
    for (let i = 2; kullanilan.has(harf); i++) harf = `${buyuk.slice(0, 1)}${i}`;
    kullanilan.add(harf);
    harfler.set(a, harf);
    aciklamalar.push({ harf, hedef: ad, kisa: anaYolu.has(a) });
  }
  const kalkislar = desenler.flatMap((d) => {
    const harf = harfler.get(sadeAd(d.hedef));
    return d.saniyeler.map((saniye) => (harf ? { saniye, isaret: harf } : { saniye }));
  });
  return { kalkislar, anaHedef: ana[1].ad, aciklamalar };
}
