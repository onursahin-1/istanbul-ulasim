// Canlı kalkışların sınıflandırılması ve yazımı.
//
// Canlı veri İETT araç konumundan geliyor (kopru/). OTP bir kalkışı canlı veriyle
// güncellediğinde `realtime` doğru oluyor ve `realtimeDeparture` planlıdan sapıyor.
// Yolcuya iki şey söylüyoruz: bu saat canlı mı, ve tarifeden ne kadar sapmış.
//
// Renk sınıfları: zamanında, 1–4 dk geç, 5+ dk geç, erken. Bir dakikanın altındaki
// sapma "zamanında": 40 saniyelik sapmayı "1 dk geç" diye göstermek gürültü olur.
// Üstü en yakın dakikaya yuvarlanıyor (4 dk 40 sn → 5 dk).
//
// Bağımlılıksız: React Native'e dokunmuyor, testlerden çağrılabiliyor.

export type CanliSinif = 'zamaninda' | 'gec' | 'cokGec' | 'erken';

/** Bu dakikadan itibaren gecikme "çok geç" sayılır. */
export const COK_GEC_DK = 5;

export type CanliBilgi = {
  /** Gecikme, saniye. Artı = geç. */
  gecikme: number;
  /** Dakikaya yuvarlanmış gecikme. */
  dakika: number;
  sinif: CanliSinif;
  /** "3 dk gecikmeli", "zamanında", "1 dk erken" */
  metin: string;
};

export function canliBilgi(gecikmeSn: number): CanliBilgi {
  // Bir dakikanın altı "zamanında"; üstü en yakın dakikaya.
  const dakika = Math.abs(gecikmeSn) < 60 ? 0 : Math.round(gecikmeSn / 60);
  if (dakika === 0) return { gecikme: gecikmeSn, dakika, sinif: 'zamaninda', metin: 'zamanında' };
  if (dakika < 0) return { gecikme: gecikmeSn, dakika, sinif: 'erken', metin: `${-dakika} dk erken` };
  return {
    gecikme: gecikmeSn,
    dakika,
    sinif: dakika >= COK_GEC_DK ? 'cokGec' : 'gec',
    metin: `${dakika} dk gecikmeli`,
  };
}

type Kalkisi = {
  realtime?: boolean | null;
  realtimeDeparture?: number | null;
  scheduledDeparture?: number | null;
};

/**
 * Bir kalkışın canlı bilgisi; canlı değilse null.
 *
 * Yalnız `realtime` bayrağına bakılıyor: canlı veri gelmemiş bir kalkışta
 * `realtimeDeparture` planlıya eşit gelir, ondan "zamanında" çıkarmak yanlış
 * olurdu — bilmediğimiz bir şeyi biliyormuş gibi göstermek.
 */
export function kalkisCanli(k: Kalkisi | null | undefined): CanliBilgi | null {
  if (!k?.realtime) return null;
  const planli = k.scheduledDeparture;
  const canli = k.realtimeDeparture;
  if (planli == null || canli == null) return null;
  return canliBilgi(canli - planli);
}

/**
 * Rota bacağının kalkışı için: planConnection planlı saati ve (varsa) tahmini
 * saati ISO metin olarak veriyor. Tahmini saat yoksa bacak canlı değil.
 */
export function bacakCanli(planli?: string | null, tahmini?: string | null): CanliBilgi | null {
  if (!planli || !tahmini) return null;
  const p = Date.parse(planli);
  const t = Date.parse(tahmini);
  if (Number.isNaN(p) || Number.isNaN(t)) return null;
  return canliBilgi(Math.round((t - p) / 1000));
}
