// Yolculuk hatırlatıcılarının planı: hangi bildirim kaçta, ne diyerek çıkacak.
//
// Dört tür:
//   kalkis    yola çıkmadan (çıkış anında ya da 5/10/15 dk önce)
//   yaklasma  ilk otobüs biniş durağına ~4 dk kala ("97M yaklaşıyor")
//   aktarma   aktarma yapılacak durağa 2 dk kala ("2 dk sonra in: aktarma")
//   inis      son araçtan inilecek durağa 2 dk kala
//
// Metinler tek başına okunduğunda işe yarasın diye hat, durak ve saatle yazılıyor. Saatler
// güzergâhın o anki tahmininden; uygulama açıldıkça yeniden hesaplanıyor
// (hatirlatma-tazele.ts), bu yüzden plan saf bir işlev: aynı güzergâh, aynı sonuç.
//
// Bağımlılıksız: testlerden çağrılabiliyor.

import { hatEtiketi } from './hat-adi';
import { baslikYap } from './metin';
import { saatEkli } from './zaman';

export type HatirlatmaTuru = 'kalkis' | 'yaklasma' | 'aktarma' | 'inis';

export type HatirlatmaAyari = {
  /** Çıkıştan kaç dakika önce; 0 = çıkış anında. */
  once: number;
  yaklasma: boolean;
  aktarma: boolean;
  inis: boolean;
};

export const VARSAYILAN_AYAR: HatirlatmaAyari = { once: 10, yaklasma: true, aktarma: true, inis: false };
export const ONCE_SECENEKLERI = [0, 5, 10, 15];
/** Otobüs yaklaşıyor bildirimi biniş anından bu kadar önce. */
export const YAKLASMA_ONCE_DK = 4;
/** Aktarma ve iniş bildirimi inilecek duraktan bu kadar önce. */
export const INIS_ONCE_DK = 2;

/** Planın ihtiyacı olan en az bacak bilgisi (otp.ts Bacak'ı karşılıyor). */
export type PlanBacagi = {
  transitLeg: boolean | null;
  mode: string | null;
  duration: number | null;
  distance: number | null;
  start: { scheduledTime: string; estimated: { time: string } | null };
  end: { scheduledTime: string; estimated: { time: string } | null };
  from: { name: string | null };
  to: { name: string | null };
  route: { shortName?: string | null; longName?: string | null; mode?: string | null; agency?: { name: string } | null } | null;
};

export type PlanOgesi = {
  /** Aynı yolculukta bildirimin kimliği: "aktarma-1". Yeniden kurulurken eşleştirmek için. */
  anahtar: string;
  tur: HatirlatmaTuru;
  /** Araç bacağının sırası (kalkışta ilk araç bacağı). */
  bacak: number;
  zaman: number;
  baslik: string;
  metin: string;
  /** Saat canlı veriden mi (otobüsün yeri), tarifeden mi. */
  canli: boolean;
};

const an = (z: { scheduledTime: string; estimated: { time: string } | null }) =>
  Date.parse(z.estimated?.time ?? z.scheduledTime);
const sn = (ms: number) => Math.round(ms / 1000);

function hatAdi(b: PlanBacagi, esdeger: string[] = []): string {
  const ana = hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name, b.route?.longName).rozet;
  return [ana, ...esdeger.filter((e) => e && e !== ana)].join(' ya da ');
}

/** "Göztepe Meydanı durağından", "Üsküdar istasyonunda", "Kadıköy iskelesinden". */
const YER_EKLERI = {
  durak: { den: 'durağından', de: 'durağında' },
  istasyon: { den: 'istasyonundan', de: 'istasyonunda' },
  iskele: { den: 'iskelesinden', de: 'iskelesinde' },
};
const RAYLI = ['RAIL', 'SUBWAY', 'TRAM', 'FUNICULAR', 'CABLE_CAR', 'GONDOLA', 'MONORAIL'];

function yerEki(ad: string, mode: string | null, ek: 'den' | 'de'): string {
  const m = (mode ?? '').toUpperCase();
  const tur = m === 'FERRY' ? 'iskele' : RAYLI.includes(m) ? 'istasyon' : 'durak';
  return `${ad} ${YER_EKLERI[tur][ek]}`;
}

function yurumeYaz(b: PlanBacagi | undefined): string {
  if (!b || b.transitLeg) return '';
  const m = Math.round(b.distance ?? 0);
  if (m < 30) return '';
  return m < 1000 ? `${m} m yürü, ` : `${Math.max(1, Math.round((b.duration ?? 0) / 60))} dk yürü, `;
}

/**
 * Güzergâhın bildirim planı. `esdeger`: bacak sırasıyla aynı yolu giden öbür hatlar
 * (rota listesindeki "97M / 97GE"); yalnız ilk biniş metninde kullanılıyor.
 * Geçmiş anlar da plana giriyor; hangisinin kurulacağına çağıran karar veriyor.
 */
export function hatirlatmaPlani(
  bacaklar: PlanBacagi[],
  cikis: number,
  ayar: HatirlatmaAyari,
  esdeger: Record<number, string[]> = {},
): PlanOgesi[] {
  const araclar = bacaklar.map((b, i) => ({ b, i })).filter((x) => x.b.transitLeg);
  const plan: PlanOgesi[] = [];
  const ilk = araclar[0];

  // Yola çıkış.
  if (Number.isFinite(cikis)) {
    let metin = '';
    if (ilk) {
      const bas = an(ilk.b.start);
      const canli = !!ilk.b.start.estimated;
      metin = `${hatAdi(ilk.b, esdeger[ilk.i])} ${yerEki(baslikYap(ilk.b.from.name), ilk.b.mode, 'den')} ${saatEkli(sn(bas))} kalkıyor${canli ? ' (canlı)' : ''}.`;
      const yurume = bacaklar.slice(0, ilk.i).reduce((t, b) => t + (b.transitLeg ? 0 : b.duration ?? 0), 0);
      if (yurume >= 60) metin += ` Durağa ${Math.round(yurume / 60)} dk yürüme.`;
    }
    plan.push({
      anahtar: 'kalkis-0',
      tur: 'kalkis',
      bacak: ilk?.i ?? 0,
      zaman: cikis - ayar.once * 60_000,
      baslik: ayar.once > 0 ? `${ayar.once} dk sonra yola çık` : 'Yola çıkma vakti',
      metin: metin || 'Yolculuğun başlıyor.',
      canli: !!ilk?.b.start.estimated,
    });
  }

  // İlk otobüs yaklaşıyor (yalnız otobüs, metrobüs, minibüs: rayda "3 durak uzakta" anlamsız).
  if (ilk && (ilk.b.mode ?? '').toUpperCase() === 'BUS') {
    const durak = baslikYap(ilk.b.from.name);
    plan.push({
      anahtar: `yaklasma-${ilk.i}`,
      tur: 'yaklasma',
      bacak: ilk.i,
      zaman: an(ilk.b.start) - YAKLASMA_ONCE_DK * 60_000,
      baslik: `${hatAdi(ilk.b, esdeger[ilk.i])} yaklaşıyor`,
      metin: `${yerEki(durak, ilk.b.mode, 'de')} ol: yaklaşık ${YAKLASMA_ONCE_DK} dk sonra durakta.`,
      canli: !!ilk.b.start.estimated,
    });
  }

  // Aktarmalar ve iniş.
  araclar.forEach(({ b, i }, k) => {
    const sonraki = araclar[k + 1];
    const durak = baslikYap(b.to.name);
    const bit = an(b.end);
    if (sonraki) {
      const yurume = bacaklar.slice(i + 1, sonraki.i).map(yurumeYaz).join('');
      plan.push({
        anahtar: `aktarma-${i}`,
        tur: 'aktarma',
        bacak: i,
        zaman: bit - INIS_ONCE_DK * 60_000,
        baslik: `${INIS_ONCE_DK} dk sonra in: aktarma`,
        metin: `${hatAdi(b)} ile ${yerEki(durak, b.mode, 'de')} in, ${yurume}${hatAdi(sonraki.b)} hattına bin (${saatEkli(sn(an(sonraki.b.start)))}).`,
        canli: !!b.end.estimated,
      });
    } else {
      const sonYurume = bacaklar.slice(i + 1).reduce((t, x) => t + (x.transitLeg ? 0 : x.duration ?? 0), 0);
      plan.push({
        anahtar: `inis-${i}`,
        tur: 'inis',
        bacak: i,
        zaman: bit - INIS_ONCE_DK * 60_000,
        baslik: 'İneceğin durak yaklaşıyor',
        metin: `${INIS_ONCE_DK} dk sonra ${yerEki(durak, b.mode, 'de')} in.${sonYurume >= 60 ? ` Varışa ${Math.round(sonYurume / 60)} dk yürüme kaldı.` : ''}`,
        canli: !!b.end.estimated,
      });
    }
  });

  return plan.sort((a, b) => a.zaman - b.zaman);
}

/** Planın ayara göre açık gelen öğeleri (kalkış hep açık). */
export function varsayilanSecim(plan: PlanOgesi[], ayar: HatirlatmaAyari): Set<string> {
  return new Set(plan.filter((p) => p.tur === 'kalkis' || ayar[p.tur]).map((p) => p.anahtar));
}
