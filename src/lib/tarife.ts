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

export type SaatSatiri = { saat: number; kalkislar: { saniye: number; dakika: number }[] };

/**
 * Kalkış saniyelerini saat satırlarına böler. Aynı dakikadaki tekrarlar (iki desenden
 * gelen aynı sefer) bir kez yazılır. Sıra saniyeye göre: 24:10 (gece 00:10) en sonda.
 */
export function saatlereBol(saniyeler: number[]): SaatSatiri[] {
  const sirali = [...new Set(saniyeler.filter((s) => Number.isFinite(s) && s >= 0).map((s) => Math.floor(s / 60) * 60))].sort(
    (a, b) => a - b,
  );
  const satirlar: SaatSatiri[] = [];
  for (const saniye of sirali) {
    const saatSirasi = Math.floor(saniye / 3600);
    const son = satirlar[satirlar.length - 1];
    const kalkis = { saniye, dakika: Math.floor((saniye % 3600) / 60) };
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
