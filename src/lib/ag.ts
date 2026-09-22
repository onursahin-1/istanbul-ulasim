// Ağ haritasının verisi: bütün raylı hatların çizgisi ve istasyonları.
//
// Veri sunucudan değil uygulamayla birlikte gelen dosyadan okunuyor
// (assets/veri/ag.json, veri/ag-cikar.py üretiyor). Ağ haritası bütün hatları
// aynı anda çiziyor; bunu her açılışta OTP'den çekmek hem yavaş olurdu hem de
// sunucuya bağımlı. Dosya 46 KB, çizgiler polyline ile sıkıştırılmış.
//
// Çözme tembel: harita açılana kadar hiçbir çizgi çözülmüyor, çözülen de
// bellekte tutuluyor.

import agVerisi from '@/assets/veri/ag.json';

import { polylineCoz, type Nokta } from './cografya';

export type AgIstasyonu = { id: string; ad: string; lat: number; lon: number };

export type AgHatti = {
  id: string;
  kod: string;
  ad: string;
  /** GTFS route_type. */
  tur: string;
  /** GTFS route_color, '#' olmadan; çoğu hatta boş — renk temadan geliyor. */
  renk: string;
  duraklar: AgIstasyonu[];
};

type HamHat = AgHatti & { cizgi: string; nokta: number };

const HAM = agVerisi as unknown as { surum: number; hatlar: HamHat[] };

export const AG_SURUMU = HAM.surum;

/** Ağdaki bütün raylı hatlar; çizgileri henüz çözülmemiş. */
export const AG_HATLARI: AgHatti[] = HAM.hatlar.map(({ cizgi: _c, nokta: _n, ...h }) => h);

const cozulen = new Map<string, Nokta[]>();

/** Hattın çizgisi. İlk çağrıda çözülür, sonrasında bellekten verilir. */
export function agCizgisi(hatId: string): Nokta[] {
  const hazir = cozulen.get(hatId);
  if (hazir) return hazir;
  const ham = HAM.hatlar.find((h) => h.id === hatId);
  const noktalar = ham ? polylineCoz(ham.cizgi) : [];
  cozulen.set(hatId, noktalar);
  return noktalar;
}

export type AgSuzgeci = { anahtar: string; ad: string; turler: string[] | null };

/** Haritanın üstündeki süzgeçler. GTFS route_type kodlarına göre. */
export const AG_SUZGECLERI: AgSuzgeci[] = [
  { anahtar: 'tumu', ad: 'Tümü', turler: null },
  { anahtar: 'metro', ad: 'Metro', turler: ['1'] },
  { anahtar: 'tren', ad: 'Marmaray', turler: ['2'] },
  { anahtar: 'tramvay', ad: 'Tramvay', turler: ['0', '5'] },
  { anahtar: 'egimli', ad: 'Füniküler', turler: ['6', '7'] },
];

/** Bir hat bu süzgece giriyor mu? */
export function suzgeceUyar(hat: AgHatti, suzgec: AgSuzgeci): boolean {
  return !suzgec.turler || suzgec.turler.includes(hat.tur);
}

/** Haritanın açılışta kapsayacağı alan. */
export function agSiniri(hatlar: AgHatti[] = AG_HATLARI) {
  const noktalar = hatlar.flatMap((h) => h.duraklar);
  if (!noktalar.length) return { latitude: 41.0, longitude: 28.98, latitudeDelta: 0.6, longitudeDelta: 0.6 };
  const enlemler = noktalar.map((n) => n.lat);
  const boylamlar = noktalar.map((n) => n.lon);
  const enAz = Math.min(...enlemler);
  const enCok = Math.max(...enlemler);
  const solda = Math.min(...boylamlar);
  const sagda = Math.max(...boylamlar);
  return {
    latitude: (enAz + enCok) / 2,
    longitude: (solda + sagda) / 2,
    latitudeDelta: Math.max(0.05, (enCok - enAz) * 1.15),
    longitudeDelta: Math.max(0.05, (sagda - solda) * 1.15),
  };
}
