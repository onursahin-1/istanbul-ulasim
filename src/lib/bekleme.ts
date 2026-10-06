// Canlı yol tarifinde durakta bekleme ve araçta durak saatleri (saf hesaplar).
//
// • Bekleme seçenekleri: aynı duraktan aynı iniş durağına giden birden çok hat varsa
//   (97M / 141M) her biri ayrı satır: sıradaki kalkışlar ve canlı mı. Moovit'teki
//   "Bu seçeneklerden birini bekle" gibi.
// • Hangi hatta binildi: biniş anına en yakın kalkışı olan hat (yolcu düzeltebilir).
// • Durak saatleri: otobüsteyken her durağın tahmini saati. Duraklar arası oran seferin
//   tarifesinden (İETT'de ölçülen yol sürelerinden), yoksa mesafeden; mutlak saat biniş
//   anından ve yolda gerçek ilerlemeden.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

import { mesafeMetre, type Nokta } from './cografya';
import type { DurakKalkisi } from './otp';

export type BeklemeSecenegi = {
  kisaAd: string;
  /** Rozet için. */
  hat: { shortName: string; mode: string | null; agency: { name: string } | null };
  /** Hattın adı (uzun ad, yoksa yön). */
  ad: string;
  /** Sıradaki kalkışlar, en çok `enCok`. */
  kalkislar: { an: number; canli: boolean; seferId: string }[];
};

/** Durakta beklerken bu kadar önce kalkmış görünen sefer listede kalır (tarife payı). */
export const LISTE_PAYI_MS = 60_000;

/**
 * Bekleme kartının satırları: verilen hatların (ilki planlanan) duraktan sıradaki
 * kalkışları, ilk kalkana göre sıralı. Kalkışı görünmeyen hat sona, boş listeyle.
 *
 * @param desen Planlanan hattın deseni: o hatta yalnız aynı durak dizisindeki seferler
 *   (kısa servis seferi "bin" diye gösterilmesin). Öbür hatlar için bilinmiyor.
 */
export function beklemeSecenekleri(
  kalkislar: DurakKalkisi[],
  hatlar: string[],
  simdi: number,
  desen?: string | null,
  enCok = 3,
): BeklemeSecenegi[] {
  const secenekler = [...new Set(hatlar.filter(Boolean))].map((kisaAd, i) => {
    const uygun = kalkislar.filter(
      (k) => k.kisaAd === kisaAd && k.an >= simdi - LISTE_PAYI_MS && (i > 0 || !desen || !k.desen || k.desen === desen),
    );
    const ilk = kalkislar.find((k) => k.kisaAd === kisaAd);
    return {
      kisaAd,
      hat: { shortName: kisaAd, mode: ilk?.mode ?? null, agency: ilk?.isletmeci ? { name: ilk.isletmeci } : null },
      ad: ilk?.uzunAd || ilk?.yon || '',
      kalkislar: uygun.slice(0, enCok).map((k) => ({ an: k.an, canli: k.canli, seferId: k.seferId })),
    };
  });
  return secenekler.sort((a, b) => (a.kalkislar[0]?.an ?? Infinity) - (b.kalkislar[0]?.an ?? Infinity));
}

/**
 * Konumdan anlaşılan binişte hangi hatta binildi: biniş anına en yakın kalkışı olan.
 * Kalkışlar 5 dakikadan uzaksa tahmin yok (null).
 */
export function binilenHatTahmini(
  kalkislar: DurakKalkisi[],
  hatlar: string[],
  binisAn: number,
): { kisaAd: string; seferId: string } | null {
  let enIyi: { kisaAd: string; seferId: string; fark: number } | null = null;
  for (const k of kalkislar) {
    if (!hatlar.includes(k.kisaAd)) continue;
    const fark = Math.abs(k.an - binisAn);
    if (fark <= 5 * 60_000 && (!enIyi || fark < enIyi.fark)) enIyi = { kisaAd: k.kisaAd, seferId: k.seferId, fark };
  }
  return enIyi ? { kisaAd: enIyi.kisaAd, seferId: enIyi.seferId } : null;
}

/**
 * Duraklar arası yolun oranları: 0 biniş, 1 iniş. Seferin durak saatleri biliniyorsa
 * onlardan (bilinmeyen ara durak iki bilinen arasında mesafeyle), yoksa mesafeden.
 */
export function durakOranlari(duraklar: (Nokta & { gtfsId?: string })[], saatler?: Map<string, number>): number[] {
  const n = duraklar.length;
  if (n < 2) return n ? [0] : [];
  const yol = [0];
  for (let k = 1; k < n; k++) yol.push(yol[k - 1] + mesafeMetre(duraklar[k - 1], duraklar[k]));
  const bas = saatler?.get(duraklar[0].gtfsId ?? '');
  const son = saatler?.get(duraklar[n - 1].gtfsId ?? '');
  if (bas == null || son == null || son <= bas) return yol.map((m) => (yol[n - 1] > 0 ? m / yol[n - 1] : 0));
  // Bilinen duraklar (sıralı, geri gitmeyen) arasında mesafeyle doldur.
  const bilinen: number[] = [];
  const zaman: number[] = [];
  for (let k = 0; k < n; k++) {
    const s = saatler!.get(duraklar[k].gtfsId ?? '');
    if (s != null && s >= bas && s <= son && (!zaman.length || s >= zaman[zaman.length - 1])) {
      bilinen.push(k);
      zaman.push(s);
    }
  }
  if (bilinen[bilinen.length - 1] !== n - 1) {
    bilinen.push(n - 1);
    zaman.push(son);
  }
  const oran: number[] = new Array(n).fill(0);
  for (let j = 0; j + 1 < bilinen.length; j++) {
    const a = bilinen[j];
    const b = bilinen[j + 1];
    for (let k = a; k <= b; k++) {
      const pay = yol[b] > yol[a] ? (yol[k] - yol[a]) / (yol[b] - yol[a]) : 0;
      oran[k] = (zaman[j] + pay * (zaman[j + 1] - zaman[j]) - bas) / (son - bas);
    }
  }
  return oran;
}

/** Kesirli durak sırasındaki oran (1.4 = ikinci duraktan %40 ileride). */
function orandaki(oranlar: number[], ilerleme: number): number {
  const k = Math.max(0, Math.min(oranlar.length - 1, Math.floor(ilerleme)));
  const kalan = ilerleme - k;
  return k + 1 < oranlar.length ? oranlar[k] + kalan * (oranlar[k + 1] - oranlar[k]) : oranlar[k];
}

/**
 * Her durağın tahmini saati (ms). Biniş ile iniş arası oranlara göre bölüşülür; araçta
 * gidilirken (ilerleme ve şimdi verilirse) sıradaki duraklar bulunulan yerden hesaplanır:
 * otobüs trafikte beklerse saatler (iniş dahil) kayar.
 */
export function durakSaatleri(
  oranlar: number[],
  binisMs: number,
  inisMs: number,
  ilerleme?: number | null,
  simdi?: number,
): number[] {
  const sure = Math.max(0, inisMs - binisMs);
  const plan = oranlar.map((o) => binisMs + o * sure);
  if (ilerleme == null || simdi == null || !oranlar.length) return plan;
  const burada = orandaki(oranlar, ilerleme);
  // Gecikme yalnız ileri: plandan önde gidiliyorsa saatler öne çekilmez (konum geride sayılıyor).
  const kayma = Math.max(0, simdi - (binisMs + burada * sure));
  return plan.map((t, k) => (k > ilerleme ? t + kayma : t));
}

/**
 * Varış saatini paylaşma metni: "Tahmini varışım 10:05 · Seyrantepe Yolu
 * (97M → 500L → 27SE)". Yalın; ek gerektiren cümle kurulmuyor.
 */
export function paylasimMetni(hedef: string | null | undefined, varis: string, hatlar: string[]): string {
  const yol = hatlar.filter(Boolean).join(' → ');
  return `Tahmini varışım ${varis}${hedef ? ` · ${hedef}` : ''}${yol ? ` (${yol})` : ''}`;
}
