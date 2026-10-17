// Adres araması: sorgu ayrıştırma ve sıralama testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { puanla, sorguyuAyristir, yerTutar } from '../adres-sorgu.ts';

describe('sorguyuAyristir', () => {
  it('kısaltmaları açar, kapı numarasını ayırır', () => {
    assert.deepEqual(sorguyuAyristir('Bağdat Cd. 312'), { sozcukler: ['bagdat', 'cad', '312'], kapiNo: '312' });
    assert.deepEqual(sorguyuAyristir('1543 sk'), { sozcukler: ['1543', 'sok'], kapiNo: null });
    assert.deepEqual(sorguyuAyristir('atatürk blv no: 12a'), { sozcukler: ['ataturk', 'bulv', '12a'], kapiNo: '12a' });
  });

  it('"mah", "no" gibi sözcükleri aramaz', () => {
    assert.deepEqual(sorguyuAyristir('Caferağa Mah.').sozcukler, ['caferaga']);
    assert.equal(sorguyuAyristir('taksim').kapiNo, null);
  });
});

describe('yerTutar', () => {
  it('kısa sözcük mahallede tam tutmalı, uzunu baştan', () => {
    assert.equal(yerTutar('gultepe', 'gul'), false);
    assert.equal(yerTutar('gul', 'gul'), true);
    assert.equal(yerTutar('bagcilar', 'bagci'), true);
  });
});

describe('puanla', () => {
  const r = (ad: string, tur: string, agirlik: number, semt = '') => ({ ad, tur, agirlik, semt });

  it('kapı numarası birebir tutan adres caddenin önünde', () => {
    const s = sorguyuAyristir('bağdat cad 312');
    const adres = puanla(r('Bağdat Caddesi No: 312', 'adres', 45), 4, 'bagdat cad 312', s);
    const cadde = puanla(r('Bağdat Caddesi', 'sokak', 80), 1, 'bagdat cad 312', s);
    const baska = puanla(r('Bağdat Caddesi No: 3120', 'adres', 45), 4, 'bagdat cad 312', s);
    assert.ok(adres > cadde && adres > baska, `${adres} ${cadde} ${baska}`);
  });

  it('adı tam tutan, adının bir kısmı mahalleyle tutandan önce', () => {
    const s = sorguyuAyristir('gül apartmanı');
    const gul = puanla(r('Gül Apartmanı', 'apartman', 42, 'Rami Yeni Mah., Eyüpsultan'), 6.7, 'gul apartmani', s);
    const guladiye = puanla(r('Güladiye Hanım Apartmanı', 'apartman', 42, 'Göztepe Mah., Bağcılar'), 0.2, 'gul apartmani', s);
    assert.ok(gul > guladiye);
  });

  it('sözcüklerden biri yalnız mahalle ya da ilçeyle tutunca küçük bir öncelik', () => {
    const s = sorguyuAyristir('1543 sk bağcılar');
    const ile = puanla(r('1543. Sokak', 'sokak', 52, 'Yenimahalle Mah., Bağcılar'), 5, '1543 sok bagcilar', s);
    const ilcesiz = puanla(r('1543. Sokak', 'sokak', 52, ''), 5, '1543 sok bagcilar', s);
    assert.equal(ile - ilcesiz, 12);
  });
});
