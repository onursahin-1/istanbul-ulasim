import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { KaliteOlcer } from '../kalite.mjs';
import { konumdakiPlan } from '../kopru.mjs';

/**
 * Tek seferli küçük tarife: doğu yönünde 5 durak, aralar ~1 km (0.009° boylam ≈ 760 m
 * 41° enlemde), her durak arası 3 dakika. Sefer 08:00'de kalkıyor.
 */
function kucukTarife() {
  const n = 5;
  const durakEnlem = new Float64Array(n).fill(41);
  const durakBoylam = Float64Array.from({ length: n }, (_, i) => 29 + i * 0.009);
  const sDurak = Int32Array.from({ length: n }, (_, i) => i);
  const sSira = Int32Array.from({ length: n }, (_, i) => i + 1);
  const sSaniye = Int32Array.from({ length: n }, (_, i) => 8 * 3600 + i * 180);
  return {
    durakEnlem,
    durakBoylam,
    sDurak,
    sSira,
    sSaniye,
    sSefer: new Int32Array(n),
    seferBas: Int32Array.from([0, n]),
    seferSatir: Int32Array.from({ length: n }, (_, i) => i),
    durakBas: Int32Array.from({ length: n + 1 }, (_, i) => i),
    rotaDuraklari: new Map([[0, Array.from({ length: n }, (_, i) => ({ durak: i, sira: i + 1 }))]]),
  };
}

describe('konumdakiPlan', () => {
  const t = kucukTarife();

  it('iki durağın ortasındaki aracın planı iki saatin ortası', () => {
    // 2. ve 3. durağın (0.009, 0.018) ortasının biraz ötesi: en yakın durak 3.
    const p = konumdakiPlan(t, 0, 2, 41, 29.0140);
    assert.equal(p.sira, 3);
    assert.ok(Math.abs(p.t - 0.556) < 0.01);
    assert.ok(Math.abs(p.planlanan - (8 * 3600 + 180 + 100)) <= 1);
  });

  it('durağa varmadan önceki araç "erken" sayılmaz', () => {
    // Araç 3. durağa 300 m kala; gözlem planın tam zamanında (bu noktadaki plan).
    const p = konumdakiPlan(t, 0, 2, 41, 29.018 - 0.0036);
    const gozlem = p.planlanan;
    // Eski yöntem: en yakın durağın (3.) saati 08:06 → gözlem ondan ~70 sn önce: "erken".
    assert.ok(gozlem - (8 * 3600 + 360) < -60);
    // Yeni yöntem: gecikme 0, güncelleme 3. durak için.
    assert.equal(p.sira, 3);
    assert.equal(gozlem - p.planlanan, 0);
  });

  it('durağı geçmiş araç sıradaki durağa yazılır', () => {
    const p = konumdakiPlan(t, 0, 2, 41, 29.018 + 0.001);
    assert.equal(p.sira, 4);
    assert.ok(p.konum > 3 && p.konum < 3.2);
  });

  it('son duraktaki araç', () => {
    const p = konumdakiPlan(t, 0, 4, 41, 29.036);
    assert.equal(p.sira, 5);
    assert.equal(p.planlanan, 8 * 3600 + 720);
  });
});

describe('KaliteOlcer', () => {
  it('geçiş anını ara değerler, tahmini gerçekle karşılaştırır', () => {
    const t = kucukTarife();
    const olcer = new KaliteOlcer(t);
    const gun = new Date('2026-09-26T08:00:00+03:00');
    const saniye = (s) => Math.floor(gun.getTime() / 1000) + s;
    // Araç 1. durakta, planına göre 60 sn geç; sıradaki durak 2.
    const e = (s, konum, sira, planlanan, yakinPlan) => ({
      kapiNo: 'A1',
      seferIdx: 0,
      rotaIdx: 0,
      sira,
      konum,
      planlanan,
      yakinPlan,
      gecikme: 60,
      eskiGecikme: 60,
      damga: saniye(s),
    });
    olcer.gozlem([e(60, 1, 2, 8 * 3600, 8 * 3600)], new Date(saniye(60) * 1000));
    // 2. durağı tam 08:04'te geçiyor (tahmin 08:04 = 180 + 60): konum 1.5 → 2.5 arası.
    olcer.gozlem([e(150, 1.5, 2, 8 * 3600 + 90, 8 * 3600)], new Date(saniye(150) * 1000));
    olcer.gozlem([e(330, 2.5, 3, 8 * 3600 + 270, 8 * 3600 + 360)], new Date(saniye(330) * 1000));
    const r = olcer.rapor();
    const ilk = r.varisHatasi['1. durak'];
    assert.equal(ilk.yeni.n, 1);
    assert.equal(ilk.yeni.ortalamaSn, 0);
  });

  it('sefer değişince bekleyen tahminler atılır', () => {
    const olcer = new KaliteOlcer(kucukTarife());
    const s = Math.floor(Date.now() / 1000);
    const temel = { kapiNo: 'B', rotaIdx: 0, sira: 2, konum: 1, planlanan: 28800, yakinPlan: 28800, gecikme: 0, eskiGecikme: 0 };
    olcer.gozlem([{ ...temel, seferIdx: 0, damga: s }]);
    olcer.gozlem([{ ...temel, seferIdx: 1, damga: s + 120 }]);
    assert.equal(olcer.rapor().sayac.seferDegisti, 1);
  });
});
