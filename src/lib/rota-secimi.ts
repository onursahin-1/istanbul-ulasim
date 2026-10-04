// Rota aramasının sonuçlarını birleştirme, yürüme sınırı ve sıralama.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

import { EN_COK_YURUME_RAYLI_SN, EN_COK_YURUME_SN, type RotaTercihi } from './sorgular';
import { bacakTuru, kapaliTurKullaniyor, kapaliTurleriAyikla, minibusPayi, TRAFIKSIZ_TURLER, type VasitaTuru } from './vasita';

/** Burada gereken kadarı: OTP'nin itinerary alanları. */
export type SiralanacakRota = {
  start: string | null;
  duration: number | null;
  walkTime: number | null;
  numberOfTransfers: number;
  legs: {
    mode?: string | null;
    transitLeg?: boolean | null;
    duration?: number | null;
    route?: { gtfsId?: string | null; shortName?: string | null; agency?: { name?: string | null } | null } | null;
    from?: { stop?: { gtfsId?: string | null } | null; name?: string | null } | null;
  }[];
};

/** Aynı kalkışta aynı hatlarla aynı duraklardan binilen rota aynı rotadır. */
export function rotaImzasi(g: SiralanacakRota): string {
  const araclar = g.legs
    .filter((b) => b.transitLeg)
    .map((b) => `${b.route?.gtfsId ?? b.route?.shortName ?? b.mode}@${b.from?.stop?.gtfsId ?? b.from?.name ?? ''}`);
  return `${g.start ?? ''}|${araclar.join('>') || 'yuru'}`;
}

/** Birkaç aramanın sonuçlarını sırayı koruyarak birleştirir, tekrarları atar. */
export function rotalariBirlestir<T extends SiralanacakRota>(listeler: T[][]): T[] {
  const gorulen = new Set<string>();
  const sonuc: T[] = [];
  for (const liste of listeler) {
    for (const g of liste) {
      const imza = rotaImzasi(g);
      if (gorulen.has(imza)) continue;
      gorulen.add(imza);
      sonuc.push(g);
    }
  }
  return sonuc;
}

/**
 * Trafiksiz toplu taşıma var mı: metro, Marmaray, tramvay, füniküler, teleferik, vapur
 * ya da Metrobüs. (Adı eski: Metrobüs de kendi yolunda gittiği için buraya sayılıyor.)
 */
export function rayliMi(g: SiralanacakRota): boolean {
  return g.legs.some((b) => {
    const tur = b.transitLeg ? bacakTuru(b) : null;
    return tur != null && TRAFIKSIZ_TURLER.includes(tur);
  });
}

/**
 * Yürüme sınırı: otobüslü rotalarda 20, raylı rotalarda 30 dakikadan çok yürütenler
 * atılır. Hiçbiri sınırın altında kalmıyorsa (şehir dışı, gece) boş liste vermek yerine
 * en az yürüyen rotalar kalır ve `asildi` işaretlenir; ekran bunu yolcuya söyler.
 */
export function yurumeSiniri<T extends SiralanacakRota>(
  liste: T[],
  sinirSn: number = EN_COK_YURUME_SN,
  rayliSinirSn: number = EN_COK_YURUME_RAYLI_SN,
): { rotalar: T[]; asildi: boolean } {
  const uygun = liste.filter(
    (g) =>
      (g.walkTime ?? 0) <=
      (sadeceYurumeMi(g) ? EN_COK_SADECE_YURUME_SN : rayliMi(g) ? rayliSinirSn : sinirSn),
  );
  if (uygun.length || !liste.length) return { rotalar: uygun, asildi: false };
  const enAz = Math.min(...liste.map((g) => g.walkTime ?? 0));
  // En az yürüyenle arası 5 dakikadan az olanlar: yolcuya birkaç seçenek kalsın.
  return { rotalar: liste.filter((g) => (g.walkTime ?? 0) <= enAz + 5 * 60), asildi: true };
}

/** Yalnız yürüyüşten oluşan rota bu kadar sürüyorsa da listede kalır (araçlı sınır 20 dk). */
export const EN_COK_SADECE_YURUME_SN = 30 * 60;

/** Toplu taşımalı rota, yalnız yürümeye göre en az bu kadar az yürütmüyorsa anlamsız. */
export const YURUMEYE_GORE_KAZANC_SN = 5 * 60;

/** Rotada hiç araç yoksa: baştan sona yürüyüş. */
export function sadeceYurumeMi(g: SiralanacakRota): boolean {
  return !g.legs.some((b) => b.transitLeg);
}

/**
 * Yürüyerek varılabilecek yerde, neredeyse o kadar yürüten araçlı rotaları atar:
 * 18 dk yürüyüp metroya binip bir durak gittikten sonra 12 dk daha yürütmek, 25 dk
 * yürümekten iyi değil. Araçlı rota yürüyüşe göre en az 5 dk az yürütmeli.
 */
export function yuruyusleKiyasla<T extends SiralanacakRota>(liste: T[]): T[] {
  const yuruyus = liste.filter(sadeceYurumeMi);
  if (!yuruyus.length) return liste;
  const enKisa = Math.min(...yuruyus.map((g) => g.duration ?? Infinity));
  return liste.filter((g) => sadeceYurumeMi(g) || (g.walkTime ?? 0) + YURUMEYE_GORE_KAZANC_SN <= enKisa);
}

/** Bir rotada en çok bu kadar araç (iki aktarma). */
export const EN_COK_ARAC = 3;

/**
 * Üçten çok araç bindiren rotaları atar (sunucu da maximumTransfers ile sınırlıyor; bu
 * ek güvence). Üç araçla hiçbir toplu taşıma rotası kalmıyorsa liste olduğu gibi kalır.
 */
export function aracSiniri<T extends SiralanacakRota>(liste: T[], enCok = EN_COK_ARAC): T[] {
  const uygun = liste.filter((g) => g.legs.filter((b) => b.transitLeg).length <= enCok);
  return uygun.some((g) => g.legs.some((b) => b.transitLeg)) ? uygun : liste;
}

/** Rotanın varış anı (ms); bilinmiyorsa null. */
function varisAni(g: SiralanacakRota): number | null {
  const bas = Date.parse(g.start ?? '');
  return Number.isNaN(bas) || g.duration == null ? null : bas + g.duration * 1000;
}

/** Aktarmalı rotanın daha az aktarmalısına göre gecikebileceği en çok süre. */
export const GEREKSIZ_AKTARMA_PAYI_SN = 3 * 60;

/**
 * Gereksiz aktarmalı rotaları atar: daha az aktarmalı, en çok 3 dk geç varan ve en çok
 * 3 dk fazla yürüten bir rota varken fazladan otobüs bindiren seçenek listede durmaz.
 * Raylı rota yalnız raylı bir rotaya yenilir: metrolu seçenek otobüslüsü yüzünden
 * kaybolmasın (tarife otobüsün trafiğini bilmiyor).
 */
export function gereksizAktarmalariAyikla<T extends SiralanacakRota>(liste: T[]): T[] {
  return liste.filter((a) => {
    const aVaris = varisAni(a);
    if (aVaris == null) return true;
    return !liste.some((b) => {
      if (b === a || b.numberOfTransfers >= a.numberOfTransfers) return false;
      if (rayliMi(a) && !rayliMi(b)) return false;
      if (!b.legs.some((x) => x.transitLeg)) return false;
      const bVaris = varisAni(b);
      return (
        bVaris != null &&
        bVaris <= aVaris + GEREKSIZ_AKTARMA_PAYI_SN * 1000 &&
        (b.walkTime ?? 0) <= (a.walkTime ?? 0) + GEREKSIZ_AKTARMA_PAYI_SN
      );
    });
  });
}

/**
 * Rotadaki tuhaf aktarmalar (saniye ceza): aynı hattan inip aynı hatta yeniden binmek
 * ve bir-iki dakikalık araç bacakları (bir durak sonra inip başka araca geçmek).
 */
export function aktarmaCezasi(g: SiralanacakRota): number {
  const araclar = g.legs.filter((b) => b.transitLeg);
  if (araclar.length < 2) return 0;
  let ceza = 0;
  araclar.forEach((b, i) => {
    const onceki = araclar[i - 1];
    const hat = (x: typeof b) => x.route?.gtfsId ?? x.route?.shortName ?? null;
    if (onceki && hat(b) != null && hat(b) === hat(onceki)) ceza += AYNI_HAT_CEZASI;
    if ((b.duration ?? Infinity) <= KISA_BACAK_SN) ceza += KISA_BACAK_CEZASI;
  });
  return ceza;
}

/** Aynı hattan inip aynı hatta yeniden binmenin cezası (saniye). */
export const AYNI_HAT_CEZASI = 900;
/** Bundan kısa araç bacağı (bir durak) aktarmalı rotada cezalı. */
export const KISA_BACAK_SN = 150;
export const KISA_BACAK_CEZASI = 420;

/** Rotadaki otobüs (ve minibüs, dolmuş) süresi: trafiğe takılabilen kısım. Metrobüs hariç. */
export function otobusSuresi(g: SiralanacakRota): number {
  return turSuresi(g, (t) => t === 'otobus' || t === 'minibus');
}

/** Rotada belli türlerdeki araçlarda geçen süre (saniye). */
function turSuresi(g: SiralanacakRota, uyar: (tur: VasitaTuru) => boolean): number {
  return g.legs.reduce((t, b) => {
    const tur = b.transitLeg ? bacakTuru(b) : null;
    return tur != null && uyar(tur) ? t + (b.duration ?? 0) : t;
  }, 0);
}

/** Aktarmalarda durakta bekleme (saniye): toplam süreden bacakların süreleri çıkınca kalan. */
export function aktarmaBeklemesi(g: SiralanacakRota): number {
  const bacaklar = g.legs.reduce((t, b) => t + (b.duration ?? 0), 0);
  return Math.max(0, (g.duration ?? 0) - bacaklar);
}

/**
 * Önerilen sıralamanın puanı: "en rahat" rota. Saniye gibi okunur, küçük olan iyi.
 *
 *   süre                         kapıdan kapıya
 * + yürümenin yarısı             yürümek araçta oturmaktan yorucu
 * + aktarmada beklemenin yarısı  durakta ayakta beklemek
 * + evde beklemenin yarısı       daha geç kalkan rota: listedeki en erken kalkışa göre
 * + aktarma başına 5 dk          (+ aynı hatta yeniden binme, bir duraklık bacak: aktarmaCezasi)
 * + otobüste geçen sürenin %30'u trafik: tarife bunu bilmiyor, otobüs gecikir ve sarsar
 *                                (iş çıkışı ve sabah yoğunluğunda %60: tarifeli süre en çok
 *                                o saatlerde tutmuyor)
 * + Metrobüste geçen sürenin %10'u kendi yolu var ama kalabalık
 *   metro, Marmaray, tramvay, vapur: ek yok
 *
 * Minibüs ve dolmuş ayrıca cezalı: her bacak 10 dk, içinde geçen süre yarı yarıya fazla
 * sayılıyor. Saatleri yok (sıklıkla tanımlı), duraktan ne zaman geçeceği belli değil.
 *
 * @param enErkenKalkis listedeki en erken kalkış (ms); verilmezse evde bekleme sayılmaz
 */
export function oneriPuani(g: SiralanacakRota, enErkenKalkis?: number): number {
  const minibus = minibusPayi(g);
  const kalkis = kalkisAni(g);
  const evdeBekleme =
    enErkenKalkis != null && !Number.isNaN(kalkis) ? Math.max(0, (kalkis - enErkenKalkis) / 1000) : 0;
  return (
    (g.duration ?? Infinity) +
    0.5 * (g.walkTime ?? 0) +
    0.5 * aktarmaBeklemesi(g) +
    0.5 * evdeBekleme +
    300 * g.numberOfTransfers +
    aktarmaCezasi(g) +
    otobusPayi(g) * otobusSuresi(g) +
    METROBUS_PAYI * turSuresi(g, (t) => t === 'metrobus') +
    0.5 * minibus.sure +
    MINIBUS_BACAK_CEZASI * minibus.bacak
  );
}

/** Rotanın kalkış anı (ms); başlangıç saatli bir ISO zamanı değilse NaN. */
function kalkisAni(g: SiralanacakRota): number {
  return /T\d{2}:/.test(g.start ?? '') ? Date.parse(g.start!) : NaN;
}

/** Otobüste ve Metrobüste geçen sürenin puana eklenen payı. */
export const OTOBUS_PAYI = 0.3;
export const OTOBUS_YOGUN_PAYI = 0.6;
export const METROBUS_PAYI = 0.1;

/** Hafta içi trafiğin en yoğun saatleri (İstanbul saati, [başlangıç, bitiş)). */
const YOGUN_SAATLER: [number, number][] = [
  [7, 10],
  [17, 20],
];

/**
 * Rotanın kalkış saatine göre otobüs payı. Saat, OTP'nin verdiği yerel zamandan
 * ("2026-10-04T18:04:00+03:00") okunuyor; hafta sonu yoğun sayılmıyor.
 */
export function otobusPayi(g: SiralanacakRota): number {
  const e = (g.start ?? '').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):/);
  if (!e) return OTOBUS_PAYI;
  const gun = new Date(`${e[1]}T12:00:00Z`).getUTCDay();
  if (gun === 0 || gun === 6) return OTOBUS_PAYI;
  const saat = Number(e[2]);
  return YOGUN_SAATLER.some(([b, s]) => saat >= b && saat < s) ? OTOBUS_YOGUN_PAYI : OTOBUS_PAYI;
}

/** Önerilen sıralamada her minibüs ya da dolmuş bacağının cezası (saniye). */
export const MINIBUS_BACAK_CEZASI = 600;

/**
 * Listeyi seçilen tercihe göre sıralar (yeni dizi). Kapalı vasıta türünü kullanan
 * rota listede yer almaz (bkz. vasita.ts).
 */
export function rotalariSirala<T extends SiralanacakRota>(
  liste: T[],
  tercih: RotaTercihi,
  kapali: VasitaTuru[] = [],
): T[] {
  return tercihSirasi(kapaliTurleriAyikla(liste, kapali), tercih, kapali);
}

function tercihSirasi<T extends SiralanacakRota>(liste: T[], tercih: RotaTercihi, kapali: VasitaTuru[]): T[] {
  const sure = (g: T) => g.duration ?? Infinity;
  const erken = (g: T) => Date.parse(g.start ?? '') || 0;
  const kopya = [...liste];
  switch (tercih) {
    case 'hizli':
      return kopya.sort((a, b) => sure(a) - sure(b) || erken(a) - erken(b));
    case 'azYurume':
      return kopya.sort((a, b) => (a.walkTime ?? 0) - (b.walkTime ?? 0) || sure(a) - sure(b));
    case 'azAktarma':
      return kopya.sort((a, b) => a.numberOfTransfers - b.numberOfTransfers || sure(a) - sure(b));
    case 'rayli':
      return kopya.sort((a, b) => otobusSuresi(a) - otobusSuresi(b) || sure(a) - sure(b));
    default: {
      const enErken = Math.min(...kopya.map(kalkisAni).filter((x) => !Number.isNaN(x)));
      const ref = Number.isFinite(enErken) ? enErken : undefined;
      const puan = new Map(kopya.map((g) => [g, oneriPuani(g, ref)]));
      const sirali = kopya.sort((a, b) => puan.get(a)! - puan.get(b)! || erken(a) - erken(b));
      return rayliyiOneAl(sirali, kapali);
    }
  }
}

/** Önerilen listede en iyi raylı rotanın en geç bulunacağı sıra (0'dan). */
export const RAYLI_EN_GEC_SIRA = 2;

/**
 * En iyi raylı rota listenin ilk üçünde değilse üçüncü sıraya alınır. Otobüsün tarifesi
 * trafiği bilmiyor ve İETT'de ara durak saatleri uydurma; metrolu seçenek puanda geride
 * kalsa bile yolcu onu görmeli.
 */
export function rayliyiOneAl<T extends SiralanacakRota>(liste: T[], kapali: VasitaTuru[] = []): T[] {
  // Kapalı türü kullanan raylı rota öne alınmaz (metroyu kapatan metrolu rota görmek istemez).
  const i = liste.findIndex((g) => rayliMi(g) && !kapaliTurKullaniyor(g, kapali));
  if (i <= RAYLI_EN_GEC_SIRA) return liste;
  const sonuc = [...liste];
  const [rayli] = sonuc.splice(i, 1);
  sonuc.splice(RAYLI_EN_GEC_SIRA, 0, rayli);
  return sonuc;
}

/** Aynı hatlarla bu kadar dakika içinde kalkan iki seçenek "aynı" sayılır. */
export const BENZER_KALKIS_DK = 10;

/**
 * Sıralı listeden neredeyse aynı seçenekleri atar: aynı hatlar aynı sırayla ve
 * kalkışlar 10 dakikadan yakınsa bir tanesi kalır. OTP aynı yolculuğu bir hatta iki
 * ayrı duraktan binerek ya da aktarmayı iki ayrı durakta yaparak iki kez veriyordu
 * ("141M › 41ST" 31 ve 32 dk: biri aynı otobüse yetişmek için ileriki durağa yürütüyor,
 * öbürü aktarmayı bir önceki durakta inip yürüyerek yaptırıyor).
 *
 * Kalan, sıradaki yerini korur; ama ikisinden daha az yürüteni (aynı ya da en çok 3 dk
 * geç varıyorsa) seçilir: birkaç dakika için fazladan yürümek rahat değil.
 * Aynı duraklardan farklı saatlerde kalkanlar zaten "sonraki kalkışlar" olarak toplanıyor.
 */
export function benzerleriAyikla<T extends SiralanacakRota>(sirali: T[]): T[] {
  const hatlar = (g: T) =>
    g.legs
      .filter((b) => b.transitLeg)
      .map((b) => b.route?.shortName ?? b.route?.gtfsId ?? b.mode)
      .join('>');
  const kalanlar: T[] = [];
  for (const g of sirali) {
    const anahtar = hatlar(g);
    const kalkis = kalkisAni(g);
    const i = kalanlar.findIndex(
      (k) =>
        anahtar !== '' &&
        hatlar(k) === anahtar &&
        !Number.isNaN(kalkis) &&
        Math.abs(kalkisAni(k) - kalkis) <= BENZER_KALKIS_DK * 60_000,
    );
    if (i < 0) {
      kalanlar.push(g);
      continue;
    }
    const k = kalanlar[i];
    const gVaris = varisAni(g);
    const kVaris = varisAni(k);
    const azYurur = (g.walkTime ?? 0) + 60 <= (k.walkTime ?? 0);
    const gecKalmaz = gVaris != null && kVaris != null && gVaris <= kVaris + GEREKSIZ_AKTARMA_PAYI_SN * 1000;
    if (azYurur && gecKalmaz) kalanlar[i] = g;
  }
  return kalanlar;
}
