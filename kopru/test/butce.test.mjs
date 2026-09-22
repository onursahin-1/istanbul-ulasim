import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { butceyiBol, SAAT_MS, SaatlikButce } from '../butce.mjs';

describe('SaatlikButce', () => {
  it('boşken hemen izin verir', () => {
    assert.equal(new SaatlikButce().bekleme(1_000_000), 0);
  });

  it('iki istek arasında en az aralığı korur', () => {
    const b = new SaatlikButce({ enAzAralikMs: 7000 });
    b.kaydet(0);
    assert.equal(b.bekleme(2000), 5000);
    assert.equal(b.bekleme(7000), 0);
  });

  it('saatlik sınır dolunca en eski istek pencereden çıkana kadar bekletir', () => {
    const b = new SaatlikButce({ saatte: 3, enAzAralikMs: 0 });
    b.kaydet(0);
    b.kaydet(10_000);
    b.kaydet(20_000);
    assert.equal(b.bekleme(30_000), SAAT_MS - 30_000 + 1);
    assert.equal(b.bekleme(SAAT_MS + 1), 0, 'ilk istek çıkınca yer açılır');
  });

  it('hiçbir 60 dakikalık pencerede sınırı aşmaz — 6 saatlik benzetim', () => {
    // Açgözlü bir istemci: izin verildiği anda istek atıyor.
    const b = new SaatlikButce({ saatte: 80, enAzAralikMs: 7000 });
    const anlar = [];
    let t = 0;
    while (t < 6 * SAAT_MS) {
      const w = b.bekleme(t);
      t += w;
      b.kaydet(t);
      anlar.push(t);
      t += 1;
    }
    let enCok = 0;
    for (let i = 0, j = 0; i < anlar.length; i++) {
      while (anlar[i] - anlar[j] >= SAAT_MS) j++;
      enCok = Math.max(enCok, i - j + 1);
    }
    assert.ok(enCok <= 80, `bir pencerede ${enCok} istek`);
    assert.ok(anlar.length >= 6 * 80 - 1, 'bütçe boşa da harcanmıyor');
  });

  it('önceki çalışmanın isteklerini sayar — yeniden başlatma kotayı sıfırlamaz', () => {
    const b = new SaatlikButce({ saatte: 2, enAzAralikMs: 0, gecmis: [100, 200] });
    assert.equal(b.kullanilan(1000), 2);
    assert.ok(b.bekleme(1000) > 0);
  });

  it('bir saatten eski geçmişi atar', () => {
    const b = new SaatlikButce({ gecmis: [0, 1, 2] });
    assert.equal(b.kullanilan(SAAT_MS + 10), 0);
    assert.deepEqual(b.disaAktar(SAAT_MS + 10), []);
  });
});

describe('butceyiBol', () => {
  it('80 bütçe, 2 dakikalık nabız: 30 nabız, 48 tarama, 75 sn arayla', () => {
    assert.deepEqual(butceyiBol(80, 120_000), { nabizSaatte: 30, taramaSaatte: 48, taramaAralikMs: 75_000 });
  });

  it('nabız bütçeyi yerse tarama durur, eksiye düşmez', () => {
    const b = butceyiBol(20, 60_000);
    assert.equal(b.taramaSaatte, 0);
    assert.equal(b.taramaAralikMs, Infinity);
  });
});
