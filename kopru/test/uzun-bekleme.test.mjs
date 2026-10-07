// Uzun bekleyen istek (uzun-bekleme.mjs).

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';

import { NabizBeklemesi } from '../uzun-bekleme.mjs';

describe('NabizBeklemesi', () => {
  const T = Date.UTC(2026, 9, 7, 16, 0, 0);
  const iso = (ms) => new Date(ms).toISOString();

  it('sonra yoksa ya da daha yeni nabız varsa hemen cevaplar', () => {
    const b = new NabizBeklemesi(1000);
    b.nabiz(T);
    let n = 0;
    b.bekle(null, () => n++);
    b.bekle(iso(T - 75_000), () => n++);
    assert.equal(n, 2);
    assert.equal(b.bekleyenler.size, 0);
  });

  it('son nabız istendiyse yeni nabza kadar bekletir', () => {
    const b = new NabizBeklemesi(60_000);
    b.nabiz(T);
    let n = 0;
    b.bekle(iso(T), () => n++);
    assert.equal(n, 0);
    b.nabiz(T + 75_000);
    assert.equal(n, 1);
    assert.equal(b.bekleyenler.size, 0);
  });

  it('nabız gecikirse süre dolunca aynı veriyle cevaplar; iptal edilen cevaplanmaz', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const b = new NabizBeklemesi(50_000);
      b.nabiz(T);
      let dolan = 0;
      let iptal = 0;
      b.bekle(iso(T), () => dolan++);
      const birak = b.bekle(iso(T), () => iptal++);
      birak();
      mock.timers.tick(49_999);
      assert.equal(dolan, 0);
      mock.timers.tick(1);
      assert.equal(dolan, 1);
      b.nabiz(T + 75_000);
      assert.deepEqual([dolan, iptal], [1, 0]);
    } finally {
      mock.timers.reset();
    }
  });
});
