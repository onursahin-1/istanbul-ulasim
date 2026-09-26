// Sesli yol tarifi: yolculuğun o anki durumundan ne söyleneceği.
//
// Yaya navigasyonundaki alışkanlık: dönüşü iki kez söyle — yaklaşırken ("80 metre
// sonra sağa dön, Bağdat Caddesi") ve gelince ("Şimdi sağa dön"). Her cümle bir
// anahtarla bir kez söylenir; konum her güncellendiğinde bu işlev yeniden çağrılır,
// söylenmiş anahtarlar atlanır. Rotadan çıkma uyarısı çizgiye dönülünce unutulur,
// yeniden çıkılırsa yeniden söylenir.
//
// Araçta: binince nerede inileceği, iki durak kala, bir durak kala ve inilecek durakta.
//
// Bağımlılıksız: React Native'e ve konuşma motoruna dokunmuyor, testlerden çağrılabiliyor.

import type { Faz, YuruRolu } from './yolculuk';

/** Dönüş bu kadar yaklaşınca "Şimdi …". */
export const SES_SIMDI_M = 20;
/** Dönüş bu kadar yaklaşınca "… metre sonra …" (ondan önce söylenmez). */
export const SES_YAKLASIRKEN_M = 120;
/** Rotadan bu kadar uzaklaşınca uyarı; bunun yarısına dönülünce uyarı unutulur. */
export const SES_SAPMA_M = 40;

export type SesGirdisi = {
  adim: number;
  tur: 'yuru' | 'arac';
  faz: Faz;
  rol?: YuruRolu;
  // Yürürken:
  /** Tarif adımları: eylem ("Sağa dön"), sokak. */
  tarif?: { eylem: string; sokak: string }[];
  /** Tarifte neredeyiz (yuruyusKonumu); konum yoksa null. */
  yer?: { simdiki: number; sonrakine: number; rotadan: number } | null;
  /** "Göztepe Meydanı durağı" ya da "varış noktası". */
  hedefAdi?: string;
  toplamMetre?: number | null;
  toplamDakika?: number | null;
  // Araçta:
  /** "89T otobüsüne bin" */
  binme?: string;
  hat?: string;
  inisAdi?: string;
  kalanDurak?: number | null;
  durakta?: boolean;
  /** Aracın kalkışına kaç dakika; bilinmiyorsa null. */
  kalkisaDakika?: number | null;
};

export type Duyuru = { anahtar: string; metin: string; oncelikli: boolean };

/** 37 → "40 metre", 180 → "200 metre", 1240 → "1,2 kilometre". */
export function mesafeSoyle(metre: number): string {
  if (metre >= 1000) return `${(Math.round(metre / 100) / 10).toLocaleString('tr-TR')} kilometre`;
  const yuvarla = metre < 100 ? 10 : 50;
  return `${Math.max(yuvarla, Math.round(metre / yuvarla) * yuvarla)} metre`;
}

const kucukBasla = (s: string) => (s ? s.charAt(0).toLocaleLowerCase('tr-TR') + s.slice(1) : s);
const sokakla = (sokak?: string) => (sokak ? `, ${sokak}` : '');

/**
 * Şimdi söylenecekler ve unutulacak anahtarlar. Birden çok duyuru dönerse sırayla
 * birleştirilip tek cümle olarak söylenir.
 */
export function sesliDuyurular(g: SesGirdisi, soylenen: ReadonlySet<string>): { soyle: Duyuru[]; unut: string[] } {
  const soyle: Duyuru[] = [];
  const unut: string[] = [];
  const ekle = (anahtar: string, metin: string, oncelikli = false) => {
    if (!soylenen.has(anahtar) && metin) soyle.push({ anahtar, metin, oncelikli });
  };
  const k = (ek: string) => `a${g.adim}-${ek}`;

  if (g.faz === 'vardi') {
    ekle('vardi', 'Vardın. İyi günler.', true);
    return { soyle, unut };
  }

  if (g.tur === 'yuru' && g.faz === 'yuru') {
    const sure = g.toplamDakika && g.toplamDakika >= 1 ? `, yaklaşık ${Math.round(g.toplamDakika)} dakika` : '';
    const mesafe = g.toplamMetre ? `${mesafeSoyle(g.toplamMetre)} yürü${sure}.` : 'Yürümeye başla.';
    const hedef = g.rol === 'varis' || g.rol === 'tek' ? 'Varış noktası yönünde' : `${g.hedefAdi ?? 'Durak'} yönünde`;
    ekle(k('basla'), `${hedef} ${mesafe}`);

    const yer = g.yer;
    if (yer && g.tarif?.length) {
      // Rotadan çıkma: bir kez uyar; çizgiye yaklaşınca unut ki yeniden çıkarsa yine uyarsın.
      if (yer.rotadan > SES_SAPMA_M) ekle(k('sapma'), 'Rotadan çıktın. Haritadaki çizgiye geri dön.', true);
      else if (yer.rotadan < SES_SAPMA_M / 2 && soylenen.has(k('sapma'))) unut.push(k('sapma'));

      const i = yer.simdiki + 1;
      const sonraki = g.tarif[i];
      if (sonraki) {
        const eylem = kucukBasla(sonraki.eylem);
        if (yer.sonrakine <= SES_SIMDI_M) {
          ekle(k(`m${i}-simdi`), `Şimdi ${eylem}${sokakla(sonraki.sokak)}.`, true);
        } else if (yer.sonrakine <= SES_YAKLASIRKEN_M && !soylenen.has(k(`m${i}-simdi`))) {
          ekle(k(`m${i}-yakin`), `${mesafeSoyle(yer.sonrakine)} sonra ${eylem}${sokakla(sonraki.sokak)}.`);
        }
      } else if (yer.sonrakine <= 40) {
        ekle(k('son'), g.rol === 'varis' || g.rol === 'tek' ? 'Varış noktasına geldin.' : `${g.hedefAdi ?? 'Durak'} karşında.`);
      }
    }
    return { soyle, unut };
  }

  if (g.tur === 'arac') {
    const hat = g.hat ?? '';
    if (g.faz === 'bekle' || g.faz === 'yuru') {
      const zaman =
        g.kalkisaDakika == null ? '' : g.kalkisaDakika <= 0 ? ' Araç şimdi kalkıyor.' : ` Kalkışa ${Math.round(g.kalkisaDakika)} dakika var.`;
      ekle(k('bekle'), `${hat} ${g.binme ?? 'hattına bin'}.${zaman}`);
      return { soyle, unut };
    }
    if (g.faz === 'icinde') {
      const kalan = g.kalanDurak;
      const inis = g.inisAdi ?? 'inilecek durak';
      if (g.durakta || kalan === 0) {
        ekle(k('in'), `İn. ${inis}.`, true);
      } else if (kalan === 1) {
        ekle(k('bir'), `Sonraki durakta ineceksin: ${inis}.`, true);
      } else if (kalan === 2) {
        ekle(k('iki'), `İki durak sonra ineceksin: ${inis}.`);
      } else if (kalan != null) {
        ekle(k('bindi'), `${inis} durağında ineceksin, ${kalan} durak var.`);
      }
    }
  }
  return { soyle, unut };
}
