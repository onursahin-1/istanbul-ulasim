// Kurulu hatırlatıcıların saatlerini canlı veriyle tazeler.
//
// Bildirimler telefona önceden zamanlanıyor; otobüs gecikirse telefon bunu bilmez.
// Uygulama her açıldığında (ve açık kaldıkça iki dakikada bir) kayıtlı her yolculuğun
// araç bacaklarının bugünkü canlı saatleri rota motorundan soruluyor; plan yeniden
// hesaplanıp kayan bildirimler yeni saatle kuruluyor (bildirim.ts, planiGuncelle).

import { useEffect } from 'react';
import { AppState } from 'react-native';

import { hatirlaticilariOku, planiGuncelle, yolculuklariOku, type YolculukKaydi } from './bildirim';
import { hatirlatmaPlani, type PlanOgesi } from './hatirlatma-plan';
import { seferCanliSaatleri, type Bacak, type Guzergah } from './otp';

const ARALIK_MS = 2 * 60_000;
const an = (z: Bacak['start']) => Date.parse(z.estimated?.time ?? z.scheduledTime);
const kaydir = (z: Bacak['start'], ms: number): Bacak['start'] => ({ ...z, estimated: { time: new Date(an(z) + ms).toISOString() } });

/** Rota listesinin eşdeğer hatları ("97GE|" — araç bacağı sırasıyla) → bacak sırasıyla tablo. */
export function esdegerTablosu(esdeger: string | undefined, bacaklar: { transitLeg: boolean | null }[]): Record<number, string[]> {
  const parcalar = (esdeger ?? '').split('|');
  const tablo: Record<number, string[]> = {};
  let arac = 0;
  bacaklar.forEach((b, i) => {
    if (!b.transitLeg) return;
    const ek = (parcalar[arac++] ?? '').split(',').filter(Boolean);
    if (ek.length) tablo[i] = ek;
  });
  return tablo;
}

/** Yolculuğun planı: çıkış ilk bacağın başı (yürüyüşün başladığı an). */
export function yolculukPlani(guzergah: Guzergah, kayit: Pick<YolculukKaydi, 'ayar' | 'esdeger'>): PlanOgesi[] {
  const ilk = guzergah.legs[0];
  const cikis = ilk ? an(ilk.start) : Date.parse(guzergah.start ?? '');
  return hatirlatmaPlani(guzergah.legs, cikis, kayit.ayar, esdegerTablosu(kayit.esdeger, guzergah.legs));
}

/**
 * Araç bacaklarına bugünkü canlı saatleri yazar. Canlı veri yoksa bacak olduğu gibi
 * kalır. İlk araçtan önceki yürüyüş, ilk aracın kaydığı kadar kaydırılır: otobüs 3 dk geç
 * gelecekse yola da 3 dk geç çıkılır.
 */
export async function guzergahiTazele(g: Guzergah): Promise<Guzergah> {
  const legs = await Promise.all(
    g.legs.map(async (b) => {
      if (!b.transitLeg || !b.trip?.gtfsId || !b.serviceDate) return b;
      try {
        const saatler = await seferCanliSaatleri(b.trip.gtfsId, b.serviceDate);
        const bin = saatler.get(b.from.stop?.gtfsId ?? '');
        const in_ = saatler.get(b.to.stop?.gtfsId ?? '');
        if (!bin?.canli && !in_?.canli) return b;
        return {
          ...b,
          start: bin?.canli ? { ...b.start, estimated: { time: new Date(bin.kalkis).toISOString() } } : b.start,
          end: in_?.canli ? { ...b.end, estimated: { time: new Date(in_.varis).toISOString() } } : b.end,
        };
      } catch {
        return b;
      }
    }),
  );
  const ilkArac = legs.findIndex((b) => b.transitLeg);
  if (ilkArac > 0) {
    const fark = an(legs[ilkArac].start) - an(g.legs[ilkArac].start);
    if (fark) for (let i = 0; i < ilkArac; i++) legs[i] = { ...legs[i], start: kaydir(legs[i].start, fark), end: kaydir(legs[i].end, fark) };
  }
  return { ...g, legs };
}

let calisiyor = false;
let son = 0;

/** Kayıtlı bütün yolculukların bildirimlerini tazeler. Sık çağrılırsa yalnız biri çalışır. */
export async function hatirlaticilariTazele(zorla = false): Promise<void> {
  if (calisiyor || (!zorla && Date.now() - son < 60_000)) return;
  calisiyor = true;
  son = Date.now();
  try {
    const simdi = Date.now();
    const gruplar = new Set((await hatirlaticilariOku()).filter((h) => h.zaman > simdi && h.grup).map((h) => h.grup!));
    if (!gruplar.size) return;
    const kayitlar = await yolculuklariOku();
    for (const grup of gruplar) {
      const kayit = kayitlar[grup];
      if (!kayit) continue;
      const yeni = await guzergahiTazele(kayit.guzergah);
      await planiGuncelle(grup, yolculukPlani(yeni, kayit), yeni);
    }
  } catch {
    // Sunucuya ulaşılamazsa bildirimler kuruldukları saatte çıkar.
  } finally {
    calisiyor = false;
  }
}

/** Kök düzende bir kez: açılışta, öne gelince ve açık kaldıkça düzenli tazele. */
export function useHatirlaticiTazeleme(): void {
  useEffect(() => {
    hatirlaticilariTazele(true);
    const abone = AppState.addEventListener('change', (d) => {
      if (d === 'active') hatirlaticilariTazele(true);
    });
    const z = setInterval(() => {
      if (AppState.currentState === 'active') hatirlaticilariTazele();
    }, ARALIK_MS);
    return () => {
      abone.remove();
      clearInterval(z);
    };
  }, []);
}
