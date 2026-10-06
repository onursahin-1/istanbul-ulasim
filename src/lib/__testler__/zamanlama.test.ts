// Yolda saatlerin yeniden kurulması (zamanlama.ts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Bacak, Guzergah } from '../otp';
import { gecikmeyiYansit, istanbulIso, yenidenZamanla, zamanlamayiUygula, type ZamanlanacakBacak } from '../zamanlama';

const dk = 60_000;
const sn = 1_000;
const T = Date.parse('2026-10-06T07:30:00+03:00');

// Plan: 07:40'ta çık, 14 dk yürü → 07:54 otobüsü (20 dk) → 3 dk aktarma → 08:20 metrosu (10 dk).
const PLAN: ZamanlanacakBacak[] = [
  { arac: false, baslangic: T + 10 * dk, bitis: T + 24 * dk },
  { arac: true, baslangic: T + 24 * dk, bitis: T + 44 * dk },
  { arac: false, baslangic: T + 44 * dk, bitis: T + 47 * dk },
  { arac: true, baslangic: T + 50 * dk, bitis: T + 60 * dk },
];
// Otobüs on dakikada bir (07:34, 07:44, 07:54...), metro beş dakikada bir (07:35, 07:40...).
const OTOBUS = Array.from({ length: 8 }, (_, k) => ({ an: T + (4 + 10 * k) * dk, seferId: `o${k}` }));
const METRO = Array.from({ length: 16 }, (_, k) => ({ an: T + (5 + 5 * k) * dk, seferId: `m${k}` }));
const KALKISLAR = { 1: OTOBUS, 3: METRO };

describe('yenidenZamanla', () => {
  it('hızlı yürürken kalan yürüyüşe göre daha önceki otobüs seçilir', () => {
    // 07:33, durağa 2 dk kaldı: 07:35 varış + 1 dk yetişme payı → 07:44 (plan 07:54).
    const yeni = yenidenZamanla(PLAN, 0, T + 3 * dk, KALKISLAR, { kalanYuruyusMs: 2 * dk });
    assert.equal(yeni[0].bitis, T + 5 * dk);
    assert.equal(yeni[0].baslangic, T + 3 * dk, 'plan 07:40 diyordu, 07:33\'te yürüyordu');
    assert.equal(yeni[1].baslangic, T + 14 * dk);
    assert.equal(yeni[1].seferId, 'o1');
    assert.equal(yeni[1].bitis - yeni[1].baslangic, 20 * dk, 'yol süresi planınki');
  });

  it('durakta: 30 sn önce kalkmış görünen sefer hâlâ yakalanabilir, daha eskisi gitmiş', () => {
    assert.equal(yenidenZamanla(PLAN, 1, T + 4 * dk + 20 * sn, KALKISLAR)[1].baslangic, T + 4 * dk);
    assert.equal(yenidenZamanla(PLAN, 1, T + 5 * dk, KALKISLAR)[1].baslangic, T + 14 * dk);
  });

  it('otobüste durak payı ayrı verilebilir (ara durak saati tahmin)', () => {
    const uzun = PLAN.map((b) => ({ ...b, durakPayiMs: 2 * dk }));
    assert.equal(yenidenZamanla(uzun, 1, T + 5 * dk, KALKISLAR)[1].baslangic, T + 4 * dk);
  });

  it('kalanı zincirle kurar: aktarma yürüyüşü inişte başlar, metro ondan sonraki ilk sefer', () => {
    const yeni = yenidenZamanla(PLAN, 1, T + 14 * dk, KALKISLAR);
    assert.deepEqual([yeni[2].baslangic, yeni[2].bitis], [T + 34 * dk, T + 37 * dk]);
    assert.equal(yeni[3].baslangic, T + 40 * dk, '07:37 + 1 dk pay → 07:40 metrosu');
  });

  it('binince: biniş gerçek an, iniş bacağın süresi kadar sonra', () => {
    const yeni = yenidenZamanla(PLAN, 1, T + 21 * dk, KALKISLAR, { kesin: true });
    assert.deepEqual([yeni[1].baslangic, yeni[1].bitis], [T + 21 * dk, T + 41 * dk]);
    assert.equal(yeni[1].seferId, undefined);
  });

  it('kalkış listesi yoksa plandaki sefer; ona yetişilemiyorsa varış anı', () => {
    assert.equal(yenidenZamanla(PLAN, 1, T, {})[1].baslangic, T + 24 * dk);
    assert.equal(yenidenZamanla(PLAN, 1, T + 30 * dk, {})[1].baslangic, T + 30 * dk);
  });

  it('yürüyüş baştan (kalanı bilinmiyor): şimdi başlar, planlanan süre kadar', () => {
    const yeni = yenidenZamanla(PLAN, 0, T, KALKISLAR);
    assert.deepEqual([yeni[0].baslangic, yeni[0].bitis], [T, T + 14 * dk]);
    assert.equal(yeni[1].baslangic, T + 24 * dk, '07:44 varış + 1 dk → 07:54');
  });
});

describe('gecikmeyiYansit', () => {
  it('otobüs geç inecekse aktarma yürüyüşü ve sonraki metro ondan kurulur', () => {
    // 07:44'te bindi, plan 08:04 iniş; trafikte, tahmini iniş 08:12.
    const yeni = yenidenZamanla(PLAN, 1, T + 14 * dk, KALKISLAR, { kesin: true });
    const sonra = gecikmeyiYansit(yeni, PLAN, 1, T + 42 * dk, KALKISLAR);
    assert.deepEqual([sonra[1].baslangic, sonra[1].bitis], [yeni[1].baslangic, yeni[1].bitis], 'bindiği bacak aynen');
    assert.deepEqual([sonra[2].baslangic, sonra[2].bitis], [T + 42 * dk, T + 45 * dk]);
    assert.equal(sonra[3].baslangic, T + 50 * dk, '08:15 + 1 dk pay → 08:20 metrosu');
  });

  it('gecikme yarım dakikadan azsa aynen', () => {
    const yeni = yenidenZamanla(PLAN, 1, T + 14 * dk, KALKISLAR, { kesin: true });
    assert.equal(gecikmeyiYansit(yeni, PLAN, 1, yeni[1].bitis + 20_000, KALKISLAR), yeni);
  });
});

function bacak(arac: boolean, bas: number, bit: number, sefer?: string): Bacak {
  return {
    mode: arac ? 'BUS' : 'WALK',
    duration: (bit - bas) / 1000,
    distance: 100,
    transitLeg: arac,
    headsign: null,
    start: { scheduledTime: istanbulIso(bas - dk), estimated: arac ? { time: istanbulIso(bas) } : null },
    end: { scheduledTime: istanbulIso(bit - dk), estimated: arac ? { time: istanbulIso(bit) } : null },
    from: { name: 'A', lat: 41, lon: 29, stop: null },
    to: { name: 'B', lat: 41, lon: 29, stop: null },
    route: null,
    legGeometry: null,
    steps: null,
    trip: sefer ? { gtfsId: sefer, pattern: null } : null,
  };
}

describe('zamanlamayiUygula', () => {
  const g: Guzergah = {
    start: istanbulIso(T),
    end: istanbulIso(T + 30 * dk),
    duration: 1800,
    walkTime: 600,
    walkDistance: 800,
    numberOfTransfers: 0,
    legs: [
      { ...bacak(false, T, T + 10 * dk), start: { scheduledTime: istanbulIso(T), estimated: null }, end: { scheduledTime: istanbulIso(T + 10 * dk), estimated: null } },
      bacak(true, T + 10 * dk, T + 30 * dk, 'o2'),
    ],
  };

  it('değişiklik yoksa aynı nesne (ekran boşuna yenilenmez); canlı tahmin korunur', () => {
    const ayni = zamanlamayiUygula(g, [
      { baslangic: T, bitis: T + 10 * dk },
      { baslangic: T + 10 * dk + 5 * sn, bitis: T + 30 * dk, seferId: 'o2' },
    ]);
    assert.equal(ayni, g);
  });

  it('değişen bacağa yeni saat ve sefer; canlı tahmin düşer; güzergâhın başı ve sonu güncellenir', () => {
    const yeni = zamanlamayiUygula(g, [
      { baslangic: T, bitis: T + 5 * dk },
      { baslangic: T + 6 * dk, bitis: T + 26 * dk, seferId: 'o1' },
    ]);
    assert.notEqual(yeni, g);
    assert.equal(yeni.legs[1].start.scheduledTime, istanbulIso(T + 6 * dk));
    assert.equal(yeni.legs[1].start.estimated, null);
    assert.equal(yeni.legs[1].trip?.gtfsId, 'o1');
    assert.equal(yeni.end, istanbulIso(T + 26 * dk));
    assert.equal(yeni.duration, 26 * 60);
    assert.equal(istanbulIso(T), '2026-10-06T07:30:00+03:00');
  });
});
