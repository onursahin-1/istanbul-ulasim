// Yolculuk kaydını masada yeniden oynatır: uygulamanın takip hesabını (yolculuk.ts) kayıttaki
// konumlarla adım adım çalıştırır, her durum değişikliğini ve konum doğruluğunun dağılımını
// yazar. "Otobüse bindim, anlamadı" gibi bir yolculuğun nerede takıldığını görmek için.
//
// Kayıt: geliştirme sürümünde "Yolculuğu başlat" deyince köprü açıksa
// kopru/kayit/yolculuklar/<tarih-saat>.jsonl dosyasına yazılıyor.
//
// Kullanım:
//   npm run yolculuk-oynat                  (en yeni kayıt)
//   npm run yolculuk-oynat -- <dosya.jsonl>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { bacakDuraklari } from '../src/lib/bacak.ts';
import { polylineCoz, type Nokta } from '../src/lib/cografya.ts';
import type { Bacak, Guzergah } from '../src/lib/otp.ts';
import {
  adimlariKur,
  baslangicDurumu,
  durumuIlerlet,
  durumuZamanla,
  KABA_DOGRULUK_M,
  type BacakOzeti,
  type KonumOrnegi,
  type YolculukDurumu,
} from '../src/lib/yolculuk.ts';

type Olay = { t: number; tur: string; [k: string]: unknown };

const KLASOR = join('kopru', 'kayit', 'yolculuklar');
const RAYLI = new Set(['SUBWAY', 'RAIL', 'FUNICULAR', 'MONORAIL', 'TRAM', 'CABLE_CAR', 'GONDOLA']);

function dosyaBul(): string {
  const verilen = process.argv[2];
  if (verilen) return verilen;
  const dosyalar = readdirSync(KLASOR)
    .filter((d) => d.endsWith('.jsonl'))
    .map((d) => join(KLASOR, d))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!dosyalar.length) throw new Error(`${KLASOR} içinde kayıt yok`);
  return dosyalar[0];
}

const saat = (ms: number) => new Date(ms + 3 * 3_600_000).toISOString().slice(11, 19);
const anOku = (iso?: string | null) => {
  const an = Date.parse(iso ?? '');
  return Number.isNaN(an) ? null : an;
};

function ozetler(bacaklar: Bacak[]): BacakOzeti[] {
  return bacaklar.map((b) => {
    const cizgi = polylineCoz(b.legGeometry?.points);
    const duraklar = b.transitLeg ? bacakDuraklari(b).map((d) => ({ latitude: d.lat, longitude: d.lon })) : [];
    return {
      arac: !!b.transitLeg,
      mesafe: b.distance ?? null,
      bitis: { latitude: b.to.lat, longitude: b.to.lon },
      duraklar,
      binisMs: anOku(b.start.estimated?.time ?? b.start.scheduledTime),
      inisMs: anOku(b.end.estimated?.time ?? b.end.scheduledTime),
      ...(b.transitLeg ? { cizgi: cizgi.length > 1 ? cizgi : duraklar, rayli: RAYLI.has((b.route?.mode ?? b.mode ?? '').toUpperCase()) } : {}),
    };
  });
}

function durumYaz(d: YolculukDurumu, bacaklar: Bacak[], adimlar: ReturnType<typeof adimlariKur>): string {
  const a = adimlar[d.adim];
  const b = a ? bacaklar[a.bacak] : null;
  const ne = !a ? '—' : a.tur === 'yuru' ? `yürü → ${b?.to.name ?? ''}` : `${b?.route?.shortName ?? b?.mode} (${b?.from.name} → ${b?.to.name})`;
  const ek = [
    d.kalanDurak != null ? `kalan ${d.kalanDurak} durak` : '',
    d.ilerleme != null ? `ilerleme ${d.ilerleme.toFixed(2)}` : '',
    d.binisAn != null ? `biniş ${saat(d.binisAn)}` : '',
    d.durakta ? 'inişte' : '',
  ].filter(Boolean);
  return `adım ${d.adim + 1} ${d.faz.padEnd(6)} ${ne}${ek.length ? ` · ${ek.join(' · ')}` : ''}`;
}

function main() {
  const dosya = dosyaBul();
  const olaylar: Olay[] = readFileSync(dosya, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s) as Olay)
    .sort((a, b) => a.t - b.t);
  const basla = olaylar.find((o) => o.tur === 'basla');
  const g = basla?.guzergah as Guzergah | undefined;
  if (!g) throw new Error('kayıtta güzergâh yok (basla olayı)');
  console.log(`${dosya}\n${saat(olaylar[0].t)}–${saat(olaylar[olaylar.length - 1].t)} · ${olaylar.length} olay`);
  console.log(`Güzergâh: ${g.legs.map((b) => (b.transitLeg ? `${b.route?.shortName ?? b.mode} ${b.start.scheduledTime.slice(11, 16)}` : `yürü ${Math.round((b.duration ?? 0) / 60)} dk`)).join(' › ')}`);

  // Konum doğruluğu: kötü konum takip kararlarına nasıl giriyor, ne kadarı kaba.
  const konumlar = olaylar.filter((o) => o.tur === 'konum');
  const dogruluklar = konumlar.map((o) => (o.d as number | null) ?? 0);
  const say = (f: (x: number) => boolean) => dogruluklar.filter(f).length;
  console.log(
    `Konum: ${konumlar.length} ölçüm · ≤50 m ${say((x) => x <= 50)} · 50–300 m ${say((x) => x > 50 && x <= 300)} · >300 m ${say((x) => x > 300)}`,
  );
  const sinyaller = olaylar.filter((o) => o.tur === 'konum' || o.tur === 'sinyal');
  const bosluklar = sinyaller
    .slice(1)
    .map((o, k) => ({ bas: sinyaller[k].t, sure: o.t - sinyaller[k].t }))
    .filter((x) => x.sure > 30_000);
  for (const x of bosluklar) console.log(`  konum gelmedi: ${saat(x.bas)}'ten ${Math.round(x.sure / 1000)} sn`);
  console.log('');

  let bacaklar = g.legs;
  let oz = ozetler(bacaklar);
  const adimlar = adimlariKur(oz);
  let d = baslangicDurumu(adimlar);
  let iz: KonumOrnegi[] = [];
  let gps: { an: number; dogruluk: number | null; konum: Nokta } | null = null;
  let sonYazilan = '';
  // Yalnız adım, faz, kalan durak ya da biniş değişince (kesirli ilerleme her konumda değişir).
  const yaz = (an: number, kaynak: string) => {
    const anahtar = `${d.adim}|${d.faz}|${d.kalanDurak}|${d.durakta}|${d.binisAn}`;
    if (anahtar === sonYazilan) return;
    sonYazilan = anahtar;
    console.log(`${saat(an)}  hesap      ${durumYaz(d, bacaklar, adimlar)}  (${kaynak})`);
  };
  yaz(olaylar[0].t, 'başlangıç');

  let saatAni = olaylar[0].t;
  for (const o of olaylar) {
    // Konum gelmezken uygulama 3 sn'de bir saate göre ilerletiyor; aynısı.
    for (; saatAni + 3_000 <= o.t; saatAni += 3_000) {
      d = durumuZamanla(d, saatAni + 3_000, adimlar, oz, gps);
      yaz(saatAni + 3_000, 'saat');
    }
    if (o.tur === 'konum' || o.tur === 'sinyal') {
      if (o.tur === 'konum') {
        const konum = { latitude: o.lat as number, longitude: o.lon as number };
        const dogruluk = (o.d as number | null) ?? null;
        gps = { an: o.t, dogruluk, konum };
        if (dogruluk != null && dogruluk > KABA_DOGRULUK_M) continue;
        iz = [...iz.filter((x) => o.t - x.an <= 20 * 60_000), { an: o.t, konum, dogruluk, hiz: (o.h as number | null) ?? null }].slice(-400);
        d = durumuIlerlet(d, konum, adimlar, oz, { dogruluk, iz });
        yaz(o.t, `konum ±${dogruluk == null ? '?' : Math.round(dogruluk)} m`);
      } else if (gps) {
        gps = { ...gps, an: o.t, dogruluk: (o.d as number | null) ?? gps.dogruluk };
      }
    } else if (o.tur === 'zamanlama' && Array.isArray(o.bacaklar)) {
      const yeni = o.bacaklar as [string, string, string | null][];
      bacaklar = bacaklar.map((b, i) =>
        yeni[i]
          ? {
              ...b,
              start: { scheduledTime: yeni[i][0], estimated: null },
              end: { scheduledTime: yeni[i][1], estimated: null },
            }
          : b,
      );
      oz = ozetler(bacaklar);
      console.log(`${saat(o.t)}  zamanlama  ${bacaklar.map((b) => (b.transitLeg ? `${b.route?.shortName} ${b.start.scheduledTime.slice(11, 16)}` : '')).filter(Boolean).join(' › ')}`);
    } else if (o.tur === 'durum') {
      const u = o as unknown as YolculukDurumu;
      console.log(`${saat(o.t)}  uygulama   ${durumYaz(u, bacaklar, adimlar)}`);
    } else if (o.tur === 'bindim-dugmesi') {
      console.log(`${saat(o.t)}  "Bindim" düğmesine basıldı`);
    }
  }
}

main();
