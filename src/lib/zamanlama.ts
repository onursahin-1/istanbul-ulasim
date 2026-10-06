// Yolculuk sürerken saatleri gerçeğe göre yeniden kurmak.
//
// Rota, arandığı anın varsayımlarıyla planlanıyor: "14 dakika yürürsün, 07:54 otobüsüne
// binersin". Yolda bunlar tutmuyor: hızlı yürüyüp 5 dakikada varılıyor (07:44'teki
// otobüse yetişilir), metro planlanandan önce geliyor, otobüs geç kalıyor. Takip
// sırasında üç anda yolculuğun kalanı baştan zamanlanıyor:
//   • yürürken ve durakta beklerken: durağa varış anına göre yetişilebilecek ilk sefer,
//   • binince: biniş gerçek an, iniş ondan bacağın süresi kadar sonra,
//   • inince: aktarma yürüyüşü şimdi başlar, sonraki araç ondan sonraki ilk sefer.
// Sefer seçimi biniş durağının o hatta (aynı desen) kalkış listesinden; liste yoksa
// plandaki sefer, ona da yetişilemiyorsa varış anı (tahmin) kullanılır.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

import type { Guzergah } from './otp';

/** Bir bacağın planlanan başlangıç ve bitişi (ms). */
export type ZamanlanacakBacak = {
  arac: boolean;
  baslangic: number;
  bitis: number;
  /** Durakta beklerken kaç ms önce "kalkmış" sefer hâlâ yakalanabilir; verilmezse DURAKTA_PAY_MS. */
  durakPayiMs?: number;
};
/** Biniş durağından bir kalkış: an (ms), seferin kimliği ve canlı mı (otobüs görülüyor). */
export type SecilenKalkis = { an: number; seferId?: string; canli?: boolean };
export type YeniZaman = { baslangic: number; bitis: number; seferId?: string; canli?: boolean };

/**
 * Durakta beklerken bu kadar önce kalkmış görünen sefer hâlâ yakalanabilir (tarife payı).
 * Otobüsün ara duraklardaki saati tahmin olduğu için uygulama otobüste daha uzun veriyor.
 */
export const DURAKTA_PAY_MS = 30_000;
/**
 * Yürüyerek ya da aktarmayla varılacak araçta, varış tahmininden bu oranda durak payı
 * kadar önce kalkan sefer de yetişilebilir sayılır (otobüste 1 dk, raylıda 15 sn). Eskiden
 * tersine 1 dk sonrası isteniyordu: 3 dk yürüyüp 16:39'da varacak yolcuya 16:39'da gelen
 * 141M "yetişilmez" sayılıp 16:54'teki seçiliyordu. Yürüme süresi de otobüsün saati de
 * tahmin; sınırdakini göstermek (kart "yetişmek zor" der) 15 dk sonrasını göstermekten iyi.
 */
export const VARIS_PAYI_ORANI = 0.5;

export type ZamanlamaSecenegi = {
  /** `bas` bir araç bacağı ve `an` ona binilen gerçek an. */
  kesin?: boolean;
  /** `bas` bir yürüyüş bacağı ve yürüyüş sürüyor: bitmesine bu kadar var (ms). */
  kalanYuruyusMs?: number;
  /** `an` bir önceki araçtan iniş anı: `bas` araçsa ona aktarmayla yetişilecek (varış payı). */
  aktarma?: boolean;
};

/**
 * Yolculuğu `bas` bacağından başlayarak `an` anından (şimdi ya da biniş anı) itibaren
 * yeniden zamanlar.
 *
 * @returns Bütün bacakların zamanı; `bas`tan öncekiler aynen.
 */
export function yenidenZamanla(
  bacaklar: ZamanlanacakBacak[],
  bas: number,
  an: number,
  kalkislar: Record<number, SecilenKalkis[] | undefined>,
  secenek: ZamanlamaSecenegi = {},
): YeniZaman[] {
  const sonuc: YeniZaman[] = bacaklar.map((b) => ({ baslangic: b.baslangic, bitis: b.bitis }));
  let t = an;
  for (let i = Math.max(0, bas); i < bacaklar.length; i++) {
    const b = bacaklar[i];
    const sure = Math.max(0, b.bitis - b.baslangic);
    if (!b.arac) {
      // Süren yürüyüş: başı olduğu gibi (yola çıkılmış), sonu kalanına göre.
      const kalan = i === bas && secenek.kalanYuruyusMs != null ? secenek.kalanYuruyusMs : null;
      sonuc[i] = kalan != null ? { baslangic: Math.min(b.baslangic, t), bitis: t + kalan } : { baslangic: t, bitis: t + sure };
      t += kalan ?? sure;
      continue;
    }
    let baslangic: number;
    let seferId: string | undefined;
    let canli = false;
    if (i === bas && secenek.kesin) {
      baslangic = an;
    } else {
      // Duraktaysak (yeniden zamanlama bu bacaktan başlıyor) tarife payı kadar geçmişteki
      // sefer de olur; yürüyüp ya da aktarıp varacaksak yetişme payı gerekir.
      const pay = b.durakPayiMs ?? DURAKTA_PAY_MS;
      const enErken = i === bas && !secenek.aktarma ? t - pay : t - pay * VARIS_PAYI_ORANI;
      const uygun = kalkislar[i]?.find((k) => k.an >= enErken);
      if (uygun) {
        baslangic = uygun.an;
        seferId = uygun.seferId;
        canli = !!uygun.canli;
      } else {
        baslangic = Math.max(b.baslangic, t);
      }
    }
    sonuc[i] = { baslangic, bitis: baslangic + sure, ...(seferId ? { seferId } : {}), ...(canli ? { canli } : {}) };
    t = baslangic + sure;
  }
  return sonuc;
}

/**
 * Araçtayken gecikme: aracın tahmini iniş anı (yolda geride kalındıysa) plandakinden
 * geçse, sonraki bacaklar o andan yeniden kurulur: aktarma yürüyüşü geç başlar, sonraki
 * araç ona yetişilecek ilk sefer olur. Gecikme yoksa (ya da yarım dakikadan azsa) aynen.
 */
export function gecikmeyiYansit(
  yeni: YeniZaman[],
  bacaklar: ZamanlanacakBacak[],
  bas: number,
  tahminiInis: number,
  kalkislar: Record<number, SecilenKalkis[] | undefined>,
): YeniZaman[] {
  if (bas + 1 >= yeni.length || tahminiInis <= yeni[bas].bitis + 30_000) return yeni;
  const zaman = yeni.map((z, i) => ({ ...bacaklar[i], baslangic: z.baslangic, bitis: z.bitis }));
  const sonra = yenidenZamanla(zaman, bas + 1, tahminiInis, kalkislar, { aktarma: true });
  return sonra.map((z, i) => (i <= bas ? yeni[i] : z));
}

/** Türkiye saatiyle ISO zaman (OTP'nin verdiği biçim): 2026-10-06T07:48:00+03:00. */
export function istanbulIso(ms: number): string {
  return `${new Date(ms + 3 * 3_600_000).toISOString().slice(0, 19)}+03:00`;
}

const anOku = (iso?: string | null) => {
  const an = Date.parse(iso ?? '');
  return Number.isNaN(an) ? null : an;
};

/** Güzergâhın bacak zamanları (canlı tahmin varsa o); biri okunamazsa null. */
export function bacakZamanlari(g: Guzergah): ZamanlanacakBacak[] | null {
  const liste: ZamanlanacakBacak[] = [];
  for (const b of g.legs) {
    const baslangic = anOku(b.start.estimated?.time ?? b.start.scheduledTime);
    const bitis = anOku(b.end.estimated?.time ?? b.end.scheduledTime);
    if (baslangic == null || bitis == null) return null;
    liste.push({ arac: !!b.transitLeg, baslangic, bitis });
  }
  return liste;
}

/** Bundan küçük kayma yok sayılır: canlı tahmin ve sefer korunur. */
const KUCUK_KAYMA_MS = 20_000;

/**
 * Yeni zamanları güzergâha yazar. Hiçbir bacak değişmediyse aynı nesneyi döner (ekran
 * boşuna yenilenmesin). Değişen bacağın canlı tahmini düşer (artık o sefer olmayabilir);
 * sefer değiştiyse bacağın seferi de değişir: canlı otobüs doğru seferden aransın.
 */
export function zamanlamayiUygula(g: Guzergah, yeni: YeniZaman[]): Guzergah {
  const eski = bacakZamanlari(g);
  if (!eski) return g;
  let degisti = false;
  const legs = g.legs.map((b, i) => {
    const y = yeni[i];
    if (!y) return b;
    const ayniSefer = !y.seferId || y.seferId === b.trip?.gtfsId;
    if (
      ayniSefer &&
      Math.abs(y.baslangic - eski[i].baslangic) < KUCUK_KAYMA_MS &&
      Math.abs(y.bitis - eski[i].bitis) < KUCUK_KAYMA_MS
    ) {
      return b;
    }
    degisti = true;
    // Canlı (otobüsü görülen) kalkış: tahmini saat de o, kart "Canlı" desin.
    const tahmini = y.canli ? { time: istanbulIso(y.baslangic) } : null;
    return {
      ...b,
      start: { scheduledTime: istanbulIso(y.baslangic), estimated: tahmini },
      end: { scheduledTime: istanbulIso(y.bitis), estimated: null },
      ...(y.seferId && b.trip && y.seferId !== b.trip.gtfsId ? { trip: { ...b.trip, gtfsId: y.seferId } } : {}),
    };
  });
  if (!degisti) return g;
  const ilk = anOku(legs[0]?.start.scheduledTime);
  const son = anOku(legs[legs.length - 1]?.end.scheduledTime);
  return {
    ...g,
    legs,
    end: son != null ? istanbulIso(son) : g.end,
    duration: ilk != null && son != null ? Math.round((son - ilk) / 1000) : g.duration,
  };
}
