// durak-izle kayıt özeti (durak-izle-ozet.mjs).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { anlikGoruntu, aracCizelgesi, kaydiAyristir, saattenAn } from '../durak-izle-ozet.mjs';

const dk = 60_000;
// 2026-10-07 17:30:00 İstanbul
const T = Date.UTC(2026, 9, 7, 14, 30, 0);
const D = '579099';

function ornek(dakika, araclar, otp = []) {
  return {
    t: T + dakika * dk,
    tur: 'ornek',
    kopru: { nabiz: null, bayat: false, duraklar: { [D]: araclar } },
    otp: { [D]: otp },
  };
}

describe('saattenAn', () => {
  it('kaydın gününde İstanbul saatini mutlak ana çevirir', () => {
    assert.equal(saattenAn('17:34', T), T + 4 * dk);
    assert.equal(saattenAn('17:34:30', T), T + 4.5 * dk);
    assert.equal(saattenAn('bozuk', T), null);
  });
});

describe('anlikGoruntu', () => {
  const olaylar = [
    { t: T, tur: 'basla' },
    ornek(0, { '141M': [{ kapi: 'B-1', varis: T + 6 * dk, kalan: 4 }] }),
    ornek(1, { '141M': [{ kapi: 'B-1', varis: T + 6 * dk, kalan: 3 }] }, [
      { hat: '141M', tahmin: T + 11 * dk, planli: T + 9 * dk, canli: true },
      { hat: '97GE', tahmin: T + 4 * dk, planli: T + 4 * dk, canli: false },
    ]),
  ];

  it('o ana en yakın örnek; dakikalar o ana göre', () => {
    const g = anlikGoruntu(olaylar, T + 2 * dk);
    assert.equal(g.ornekAn, T + dk);
    assert.deepEqual(g.duraklar[D]['141M'].arac, [{ dk: 4, kalan: 3, kapi: 'B-1' }]);
    assert.deepEqual(g.duraklar[D]['141M'].otp, [{ dk: 9, canli: true, planliDk: 7 }]);
    assert.deepEqual(g.duraklar[D]['97GE'], { arac: [], otp: [{ dk: 2, canli: false, planliDk: 2 }] });
  });

  it('örnek çok eskiyse ya da hiç yoksa null', () => {
    assert.equal(anlikGoruntu(olaylar, T + 10 * dk), null);
    assert.equal(anlikGoruntu(olaylar, T - 5 * dk), null);
  });
});

describe('aracCizelgesi', () => {
  it('her otobüsün tahminleri ve listeden düştüğü an', () => {
    const olaylar = [
      ornek(0, { '141M': [{ kapi: 'B-1', varis: T + 3 * dk, kalan: 2 }, { kapi: 'B-2', varis: T + 15 * dk, kalan: 9 }] }),
      ornek(1, { '141M': [{ kapi: 'B-1', varis: T + 4 * dk, kalan: 1 }, { kapi: 'B-2', varis: T + 15 * dk, kalan: 8 }] }),
      ornek(2, { '141M': [{ kapi: 'B-2', varis: T + 16 * dk, kalan: 8 }] }),
    ];
    const c = aracCizelgesi(olaylar);
    assert.deepEqual(
      c.map((a) => [a.kapi, a.tahminler.length, a.dustu]),
      [
        ['B-1', 2, T + 2 * dk],
        ['B-2', 3, null],
      ],
    );
  });

  it('bayat örnekler sayılmaz', () => {
    const bayat = ornek(1, {});
    bayat.kopru.bayat = true;
    const c = aracCizelgesi([ornek(0, { '141M': [{ kapi: 'B-1', varis: T + 3 * dk, kalan: 2 }] }), bayat]);
    assert.equal(c[0].dustu, null);
  });
});

describe('kaydiAyristir', () => {
  it('kesik son satırı atlar', () => {
    assert.equal(kaydiAyristir('{"tur":"basla"}\n{"tur":"orn').length, 1);
  });
});
