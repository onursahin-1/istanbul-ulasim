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
import type { AracVarisi, DurakKalkisi, Hat, Kalkis } from './otp';

export type BeklemeSecenegi = {
  kisaAd: string;
  /** Rozet için. */
  hat: { shortName: string; mode: string | null; agency: { name: string } | null };
  /** Hattın adı (uzun ad, yoksa yön). */
  ad: string;
  /** Sıradaki kalkışlar, en çok `enCok`. Araç tabanlı olanlarda kapı no ve kalan durak. */
  kalkislar: { an: number; canli: boolean; seferId: string; kapiNo?: string; kalanDurak?: number; duruyorSn?: number | null }[];
};

/**
 * Duran otobüs: köprü 5 dakikadan uzun kımıldamayan otobüsü (mola, park, arıza) işaretliyor;
 * varışı "hemen kalkarsa en erken". Ne zaman kalkacağı belli olmadığından, arkasından
 * hareket eden bir otobüs varken ana dakika olmaz. Göztepe Meydanı'nda park etmiş dört
 * otobüs 14 dakika boyunca "1–3 dk" ve "Şimdi" görünüyordu (2026-10-07).
 */
export const duruyorMu = (v: { duruyorSn?: number | null }) => v.duruyorSn != null;

/**
 * Bir hattın araçlarından kalkış olarak gösterilecekler: hareket edenler; hiç hareket eden
 * yoksa ilk duran (işaretli, en erken varışıyla). `duran`: varsa ilk duran otobüs (not için).
 */
export function gosterilecekAraclar<T extends { duruyorSn?: number | null }>(liste: T[]): { ana: T[]; duran: T | null } {
  const hareketli = liste.filter((v) => !duruyorMu(v));
  const duranlar = liste.filter(duruyorMu);
  return { ana: hareketli.length ? hareketli : duranlar.slice(0, 1), duran: duranlar[0] ?? null };
}

/** "9 dk'dır", "1 sa 5 dk'dır". */
export function duruyorYaz(sn: number): string {
  const dk = Math.max(1, Math.round(sn / 60));
  if (dk < 60) return `${dk} dk'dır`;
  const sa = Math.floor(dk / 60);
  return dk % 60 ? `${sa} sa ${dk % 60} dk'dır` : `${sa} saattir`;
}

/** Araç tabanlı kalkışın sahte sefer kimliği öneki: tarifede böyle bir sefer yok. */
export const ARAC_ONEKI = 'arac:';
export const aracKalkisiMi = (seferId?: string | null) => !!seferId?.startsWith(ARAC_ONEKI);

/**
 * Köprünün araç tabanlı varışlarını duraktan kalkış listesine katar. Bir hatta durağa gelen
 * otobüs görülüyorsa o hattın son görülen otobüsten önceki (ve onunla aynı dakikalardaki)
 * tarife ya da sefer tabanlı canlı kalkışları atılır: hangi otobüslerin geldiği belli, tarife
 * yalnız onlardan sonrası için. Otobüs görülmeyen hatlar olduğu gibi kalır.
 *
 * @param varislar hat (büyük harf) → durağa gelen araçlar
 */
export function aracVarislariniKat(kalkislar: DurakKalkisi[], varislar: Record<string, AracVarisi[]>): DurakKalkisi[] {
  const anahtar = (s: string) => s.trim().toLocaleUpperCase('tr-TR');
  const hatlar = new Map(Object.entries(varislar).map(([h, l]) => [anahtar(h), l] as const));
  if (![...hatlar.values()].some((l) => l.length)) return kalkislar;
  const sonuc: DurakKalkisi[] = [];
  const eklenen = new Set<string>();
  for (const k of kalkislar) {
    const liste = hatlar.get(anahtar(k.kisaAd));
    if (!liste?.length) {
      sonuc.push(k);
      continue;
    }
    const sonAraç = liste[liste.length - 1].varis;
    if (k.an > sonAraç + AYNI_OTOBUS_MS) sonuc.push(k);
    if (!eklenen.has(k.kisaAd)) {
      eklenen.add(k.kisaAd);
      // Duran otobüs, arkasından hareket eden varken kalkış olmaz (gosterilecekAraclar).
      for (const v of gosterilecekAraclar(liste).ana) {
        // İstanbul gününün başı (sn) ve ondan saniye: tarifeli kalkışlarla aynı biçim.
        const gunBasi = Math.floor((v.varis / 1000 + 3 * 3600) / 86_400) * 86_400 - 3 * 3600;
        sonuc.push({
          ...k,
          an: v.varis,
          serviceDay: gunBasi,
          saniye: Math.round(v.varis / 1000) - gunBasi,
          // Duran otobüsün saati "en erken": canlı varış sayılmaz.
          canli: v.duruyorSn == null,
          seferId: `${ARAC_ONEKI}${v.kapiNo}`,
          desen: undefined,
          kapiNo: v.kapiNo,
          kalanDurak: v.kalanDurak,
          yasSn: v.yasSn,
          konum: { lat: v.enlem, lon: v.boylam },
          duruyorSn: v.duruyorSn ?? null,
        });
      }
    }
  }
  return sonuc.sort((a, b) => a.an - b.an);
}

/** Durağı az önce geçmiş sayılan otobüs: köprünün son verisi biraz eski olabilir. */
const GECMIS_VARIS_MS = 60_000;

/**
 * Yakındaki duraklar listesi için aracVarislariniKat: OTP'nin ham kalkışlarına köprünün
 * araç tabanlı varışlarını katar. Durak ekranı ve bekleme kartı otobüsleri araçtan
 * gösteriyor, liste ise yalnız OTP'nin sefer tabanlı tahmininden gösteriyordu; aynı durak
 * için iki ekran farklı otobüs ve dakika söylüyordu (97GE listede "Şimdi", durakta 4 dk).
 *
 * Kural aynı: otobüsü görülen hatta son görülen otobüse kadarki (ve onunla aynı
 * dakikalardaki) OTP kalkışları atılır, yerine otobüsler girer. Listede kalkışı olmayan
 * ama otobüsü gelen hat da eklenir (OTP yalnız ilk üç kalkışı veriyor). Hat bilgisi
 * durağın hatlarından; aracın güzergâh kaydı (rotaId) tutuyorsa o varyant.
 *
 * @param varislar hat kısa adı → bu durağa gelen araçlar (köprü)
 */
export function kalkislaraAracKat(
  kalkislar: Kalkis[],
  hatlar: Hat[],
  varislar: Record<string, AracVarisi[]>,
  simdi: number,
): Kalkis[] {
  const anahtar = (s?: string | null) => (s ?? '').trim().toLocaleUpperCase('tr-TR');
  const kimlik = (g?: string | null) => (g ?? '').slice((g ?? '').lastIndexOf(':') + 1);
  const gecerli = new Map<string, AracVarisi[]>();
  for (const [h, l] of Object.entries(varislar)) {
    const taze = l.filter((v) => v.varis >= simdi - GECMIS_VARIS_MS).sort((a, b) => a.varis - b.varis);
    if (taze.length) gecerli.set(anahtar(h), taze);
  }
  if (!gecerli.size) return kalkislar;
  const anMs = (k: Kalkis) => ((k.serviceDay ?? 0) + (k.realtimeDeparture ?? k.scheduledDeparture ?? 0)) * 1000;
  const sonuc = kalkislar.filter((k) => {
    const l = gecerli.get(anahtar(k.trip?.route?.shortName));
    return !l || anMs(k) > l[l.length - 1].varis + AYNI_OTOBUS_MS;
  });
  for (const [kod, liste] of gecerli) {
    const ayniHat = (h?: Hat | null) => !!h && anahtar(h.shortName) === kod;
    const ornek = kalkislar.find((k) => ayniHat(k.trip?.route));
    for (const v of gosterilecekAraclar(liste).ana) {
      const rota =
        (v.rotaId ? hatlar.find((h) => ayniHat(h) && kimlik(h.gtfsId) === v.rotaId) : undefined) ??
        ornek?.trip?.route ??
        hatlar.find(ayniHat);
      if (!rota) continue;
      // Yön etiketi aynı güzergâh kaydının OTP kalkışından; yoksa güzergâhın adı (başka
      // varyantın yön adı yanlış yönü söyleyebilir).
      const ayniRota = kalkislar.find((k) => k.trip?.route?.gtfsId === rota.gtfsId);
      const gunBasi = Math.floor((v.varis / 1000 + 3 * 3600) / 86_400) * 86_400 - 3 * 3600;
      const saniye = Math.round(v.varis / 1000) - gunBasi;
      sonuc.push({
        scheduledDeparture: saniye,
        realtimeDeparture: saniye,
        // Duran otobüsün saati "en erken": canlı varış sayılmaz.
        realtime: v.duruyorSn == null,
        serviceDay: gunBasi,
        headsign: ayniRota?.headsign ?? rota.longName ?? null,
        stop: ayniRota?.stop ?? null,
        trip: {
          gtfsId: `${ARAC_ONEKI}${v.kapiNo}`,
          route: rota,
          pattern: ayniRota?.trip?.pattern ?? { code: '', headsign: rota.longName ?? null },
        },
        duruyorSn: v.duruyorSn ?? null,
      });
    }
  }
  return sonuc.sort((a, b) => anMs(a) - anMs(b));
}

/** Bir bacağın hattını tanıtan bilgi: kısa ad, desen ve yön. */
export type BacakHatti = { kisaAd: string; desen?: string | null; yon?: string | null };

const yonAnahtari = (s: string) => s.trim().toLocaleUpperCase('tr-TR');

/**
 * Bu kalkış bacağın yolundan mı gidiyor? Kısa ad aynı ve desen aynı; desen farklıysa yönü
 * aynı olmalı. İETT aynı hattın her varyantını ayrı güzergâh kaydı (ayrı kimlik, ayrı desen)
 * olarak yayımlıyor: kimliğe ya da desene bakınca aynı yoldan giden seferler kaçıyordu
 * (bekleme kartı "3 dk" derken durak listesi 16:32'deki sefere göre kalıyordu). Kısa
 * servis seferi ise başka yöne yazılı olduğu için yine dışarıda kalıyor.
 */
export function ayniYoldanMi(k: DurakKalkisi, hat: BacakHatti): boolean {
  if (k.kisaAd !== hat.kisaAd) return false;
  if (!hat.desen || !k.desen || k.desen === hat.desen) return true;
  return !!k.yon && !!hat.yon && yonAnahtari(k.yon) === yonAnahtari(hat.yon);
}

/** Durakta beklerken bu kadar önce kalkmış görünen sefer listede kalır (tarife payı). */
export const LISTE_PAYI_MS = 60_000;

/**
 * Bekleme kartının satırları: verilen hatların (ilki planlanan) duraktan sıradaki
 * kalkışları, ilk kalkana göre sıralı. Kalkışı görünmeyen hat sona, boş listeyle.
 *
 * @param ana Planlanan hattın deseni ve yönü: o hatta yalnız aynı yoldan giden seferler
 *   (kısa servis seferi "bin" diye gösterilmesin). Öbür hatlar için bilinmiyor.
 */
export function beklemeSecenekleri(
  kalkislar: DurakKalkisi[],
  hatlar: string[],
  simdi: number,
  ana?: { desen?: string | null; yon?: string | null },
  enCok = 3,
): BeklemeSecenegi[] {
  const secenekler = [...new Set(hatlar.filter(Boolean))].map((kisaAd, i) => {
    const uygun = kalkislar.filter(
      (k) =>
        k.kisaAd === kisaAd &&
        k.an >= simdi - LISTE_PAYI_MS &&
        (i > 0 || ayniYoldanMi(k, { kisaAd, desen: ana?.desen, yon: ana?.yon })),
    );
    const ilk = kalkislar.find((k) => k.kisaAd === kisaAd);
    return {
      kisaAd,
      hat: { shortName: kisaAd, mode: ilk?.mode ?? null, agency: ilk?.isletmeci ? { name: ilk.isletmeci } : null },
      ad: ilk?.uzunAd || ilk?.yon || '',
      kalkislar: tekillestir(uygun)
        .slice(0, enCok)
        .map((k) => ({
          an: k.an,
          canli: k.canli,
          seferId: k.seferId,
          kapiNo: k.kapiNo,
          kalanDurak: k.kalanDurak,
          duruyorSn: k.duruyorSn ?? null,
        })),
    };
  });
  return secenekler.sort((a, b) => (a.kalkislar[0]?.an ?? Infinity) - (b.kalkislar[0]?.an ?? Infinity));
}

/** Aynı hattın bu kadar yakın iki kalkışı tek otobüs sayılır. */
export const AYNI_OTOBUS_MS = 3 * 60_000;

/**
 * Aynı hattın birkaç dakika arayla iki kalkışı çoğu zaman tek otobüs: geç kalan bir seferin
 * canlı saati ile sonraki seferin tarife saati üst üste biniyor ("2 dk, sonra 2 dk"). Canlı
 * olan kalır; ikisi de tarifeyse ilki.
 */
export function tekillestir(liste: DurakKalkisi[]): DurakKalkisi[] {
  const sonuc: DurakKalkisi[] = [];
  for (const k of liste) {
    const onceki = sonuc[sonuc.length - 1];
    if (onceki && k.an - onceki.an < AYNI_OTOBUS_MS && onceki.canli !== k.canli) {
      if (k.canli) sonuc[sonuc.length - 1] = k;
      continue;
    }
    sonuc.push(k);
  }
  return sonuc;
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

/**
 * Durak ekranının satırları OTP'den 24 saatlik kalkışla geliyor (yakındaki duraklar listesi
 * gibi; eskiden 3 saatti ve gece Göztepe Meydanı'nda liste "89C 05:17" ve canlı 97GE
 * gösterirken durak ekranı hiç satır göstermiyordu, 2026-10-08 00:15). Bir hattın
 * UZAK_SATIR_DK'dan sonraki satırları yalnız o hattın daha yakın satırı yoksa kalır, o da
 * yalnız en erkeni: gece hattın sabahki ilk seferi görünsün, gündüz seyrek bir varyantın
 * yarınki seferi listeyi doldurmasın.
 */
export const UZAK_SATIR_DK = 180;

export function uzakSatirlariAyikla<T extends { hatKodu: string; ilkDakika: number }>(
  satirlar: T[],
  uzakDk: number = UZAK_SATIR_DK,
): T[] {
  const yakin = new Set(satirlar.filter((s) => s.ilkDakika <= uzakDk).map((s) => s.hatKodu));
  const enErken = new Map<string, T>();
  for (const s of satirlar) {
    if (s.ilkDakika <= uzakDk || yakin.has(s.hatKodu)) continue;
    const e = enErken.get(s.hatKodu);
    if (!e || s.ilkDakika < e.ilkDakika) enErken.set(s.hatKodu, s);
  }
  return satirlar.filter((s) => s.ilkDakika <= uzakDk || enErken.get(s.hatKodu) === s);
}

/**
 * Durak ekranında hiçbir satıra girmeyen otobüsler: hattın bu durakta OTP satırı yok (ör.
 * gece gecikmeli son sefer; tarifedeki bir sonraki sefer 24 saatin dışında). Köprü onları
 * görüyorsa yakındaki duraklar listesi gösteriyor; durak ekranı da kendi satırıyla göstersin.
 * Hat (güzergâh kaydı tutan, yoksa kısa adı tutan) başına, varışa göre sıralı; geçmiş
 * (bir dakikadan eski) varış sayılmaz.
 */
export function satirsizAraclar(
  varislar: Record<string, Record<string, AracVarisi[]>>,
  atanan: Set<string>,
  hatlar: Hat[],
  simdi: number,
): { hat: Hat; araclar: AracVarisi[] }[] {
  const anahtar = (s?: string | null) => (s ?? '').trim().toLocaleUpperCase('tr-TR');
  const kimlik = (g?: string | null) => (g ?? '').slice((g ?? '').lastIndexOf(':') + 1);
  const gruplar = new Map<string, { hat: Hat; araclar: AracVarisi[] }>();
  const gorulen = new Set<string>();
  for (const durak of Object.values(varislar)) {
    for (const [kod, liste] of Object.entries(durak ?? {})) {
      for (const v of liste ?? []) {
        if (atanan.has(v.kapiNo) || gorulen.has(v.kapiNo) || v.varis < simdi - 60_000) continue;
        const hat =
          (v.rotaId ? hatlar.find((h) => kimlik(h.gtfsId) === v.rotaId) : undefined) ??
          hatlar.find((h) => anahtar(h.shortName) === anahtar(kod));
        if (!hat) continue;
        gorulen.add(v.kapiNo);
        const g = gruplar.get(hat.gtfsId) ?? { hat, araclar: [] };
        g.araclar.push(v);
        gruplar.set(hat.gtfsId, g);
      }
    }
  }
  for (const g of gruplar.values()) g.araclar.sort((a, b) => a.varis - b.varis);
  return [...gruplar.values()];
}
