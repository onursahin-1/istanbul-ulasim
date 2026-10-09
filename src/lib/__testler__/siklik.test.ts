// Minibüs ve dolmuş sıklık bilgisinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dakikadanSaat,
  gununPencereleri,
  istanbulAni,
  siklikBul,
  siklikDurumu,
  siklikOzeti,
  siklikSimdi,
  siklikYaz,
  type Pencere,
} from '../siklik';

// 2026-09-23 çarşamba. İstanbul saati = UTC + 3.
const an = (saat: string, gun = '2026-09-23') => Date.parse(`${gun}T${saat}:00+03:00`);

const HAT: Pencere[] = [
  ['1111110', 390, 420, 15], // 06:30–07:00 her 15
  ['1111110', 420, 1215, 10], // 07:00–20:15 her 10
  ['0000001', 480, 1200, 20], // pazar 08:00–20:00 her 20
];

describe('istanbulAni', () => {
  it('İstanbul saatine göre gün ve dakika', () => {
    assert.deepEqual(istanbulAni(an('10:05')), { gun: 2, dakika: 605 });
    // UTC'de hâlâ salı ama İstanbul'da çarşamba 01:30
    assert.deepEqual(istanbulAni(Date.parse('2026-09-22T22:30:00Z')), { gun: 2, dakika: 90 });
  });
});

describe('siklikDurumu', () => {
  it('çalışan penceredeki aralık ve günün son seferi', () => {
    assert.deepEqual(siklikDurumu(HAT, an('10:00')), { tur: 'calisiyor', aralik: 10, sonSefer: 1215 });
    assert.deepEqual(siklikDurumu(HAT, an('06:40')), { tur: 'calisiyor', aralik: 15, sonSefer: 1215 });
  });

  it('başlamadan önce ilk sefer, bittikten sonra bitti', () => {
    assert.deepEqual(siklikDurumu(HAT, an('05:00')), { tur: 'baslayacak', ilkSefer: 390 });
    assert.deepEqual(siklikDurumu(HAT, an('21:00')), { tur: 'bitti' });
  });

  it('günün maskesine bakar', () => {
    // 2026-09-27 pazar
    assert.deepEqual(siklikDurumu(HAT, an('10:00', '2026-09-27')), { tur: 'calisiyor', aralik: 20, sonSefer: 1200 });
  });

  it('gece yarısını aşan pencere ertesi günün başında da geçerli', () => {
    const gece: Pencere[] = [['1111111', 1320, 1530, 30]]; // 22:00–01:30
    assert.equal(siklikDurumu(gece, an('01:00'))?.tur, 'calisiyor');
  });

  it('veri yoksa null', () => {
    assert.equal(siklikDurumu(null, an('10:00')), null);
    assert.equal(siklikDurumu([['0000000', 0, 10, 5]], an('10:00')), null);
  });
});

describe('yazım', () => {
  it('saat', () => {
    assert.equal(dakikadanSaat(1380), '23:00');
    assert.equal(dakikadanSaat(1470), '00:30');
  });

  it('tek hat', () => {
    assert.equal(siklikYaz({ tur: 'calisiyor', aralik: 5, sonSefer: 1380 }), 'Her 5 dk · son sefer 23:00');
    assert.equal(siklikYaz({ tur: 'baslayacak', ilkSefer: 390 }), 'İlk sefer 06:30');
    assert.equal(siklikYaz({ tur: 'bitti' }), 'Bugünlük seferler bitti');
    assert.equal(siklikYaz(null), null);
  });

  it('özet', () => {
    const c = (aralik: number) => ({ tur: 'calisiyor' as const, aralik, sonSefer: 1380 });
    assert.equal(siklikOzeti([c(3), c(10), null]), '3–10 dk arayla');
    assert.equal(siklikOzeti([c(5), c(5)]), 'her 5 dk');
    assert.equal(siklikOzeti([{ tur: 'bitti' }]), 'şu an sefer yok');
    assert.equal(siklikOzeti([null]), null);
  });
});

describe('siklikBul', () => {
  it('kısa adı büyük harfe çevirip arar', () => {
    const veri = { 'İSTOÇ-BAĞCILAR DEVLET HASTANESİ': HAT };
    assert.equal(siklikBul(veri, 'İstoç-Bağcılar Devlet Hastanesi '), HAT);
    assert.equal(siklikBul(veri, 'yok'), null);
  });
});

describe('gununPencereleri', () => {
  // F2 (Tünel), gerçek veri: hafta içi üç pencere, pazar tek.
  const F2: Pencere[] = [
    ['0000001', 450, 1365, 7],
    ['1111100', 420, 476, 7],
    ['1111100', 476, 1260, 5],
    ['1111100', 1260, 1365, 7],
  ];

  it('seçilen günün pencereleri sıralı', () => {
    assert.deepEqual(gununPencereleri(F2, 2), [
      { bas: 420, bit: 476, aralik: 7 },
      { bas: 476, bit: 1260, aralik: 5 },
      { bas: 1260, bit: 1365, aralik: 7 },
    ]);
    assert.deepEqual(gununPencereleri(F2, 6), [{ bas: 450, bit: 1365, aralik: 7 }]);
  });

  it('o gün çalışmıyorsa boş', () => {
    assert.deepEqual(gununPencereleri(F2, 5), []);
    assert.deepEqual(gununPencereleri(null, 0), []);
  });

  it('aynı aralıkla bitişik pencereleri ve iki desenden gelen aynı pencereyi birleştirir', () => {
    const P: Pencere[] = [
      ['1111111', 600, 900, 10],
      ['1111111', 360, 600, 10],
      ['1111111', 900, 1200, 6],
      ['1111111', 900, 1200, 8],
    ];
    assert.deepEqual(gununPencereleri(P, 0), [
      { bas: 360, bit: 900, aralik: 10 },
      { bas: 900, bit: 1200, aralik: 6 },
    ]);
  });
});

describe('siklikSimdi', () => {
  const bugun = [
    { bas: 420, bit: 476, aralik: 7 },
    { bas: 476, bit: 1260, aralik: 5 },
    { bas: 1260, bit: 1365, aralik: 7 },
  ];

  it('çalışırken aralık, sıradaki değişiklik ve son sefer', () => {
    assert.deepEqual(siklikSimdi(bugun, [], 860), {
      ana: 'Şu an her 5 dk',
      ek: '21:00 sonrası her 7 dk · son sefer 22:45',
      simdiki: 1,
    });
  });

  it('son pencerede yalnız son sefer', () => {
    assert.deepEqual(siklikSimdi(bugun, [], 1300), { ana: 'Şu an her 7 dk', ek: 'son sefer 22:45', simdiki: 2 });
  });

  it('başlamadan önce ilk sefer, aradaki boşlukta sonraki sefer', () => {
    assert.equal(siklikSimdi(bugun, [], 300)?.ana, 'İlk sefer 07:00');
    const bosluklu = [
      { bas: 360, bit: 600, aralik: 10 },
      { bas: 960, bit: 1200, aralik: 10 },
    ];
    assert.deepEqual(siklikSimdi(bosluklu, [], 700), {
      ana: 'Sonraki sefer 16:00',
      ek: 'her 10 dk · son sefer 20:00',
      simdiki: -1,
    });
  });

  it('bittiyse bitti; bugün hiç yoksa null', () => {
    assert.equal(siklikSimdi(bugun, [], 1400)?.ana, 'Bugünlük seferler bitti');
    assert.equal(siklikSimdi([], [], 600), null);
  });

  it('dünden gece yarısını aşan pencere sürüyorsa çalışıyor', () => {
    const dun = [{ bas: 1380, bit: 1530, aralik: 15 }]; // 23:00 – 01:30
    assert.deepEqual(siklikSimdi(bugun, dun, 30), {
      ana: 'Şu an her 15 dk',
      ek: '07:00 sonrası her 7 dk · son sefer 22:45',
      simdiki: -1,
    });
  });
});
