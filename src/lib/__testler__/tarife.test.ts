// Durak tarifesinin testleri: hangi gün sorulur, saat satırları, sıradaki kalkış.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bugununTarifesi, gunTuru, saatlereBol, siradakiKalkis, tarifeTarihleri } from '../tarife.ts';

describe('tarife günleri', () => {
  it('haftanın gününden türü bulur', () => {
    assert.equal(gunTuru('2026-10-05'), 'haftaici'); // Pazartesi
    assert.equal(gunTuru('2026-10-10'), 'cumartesi');
    assert.equal(gunTuru('2026-10-11'), 'pazar');
  });

  it('her tür için bugünden sonraki ilk günü seçer', () => {
    // 3 Ekim 2026 Cumartesi
    assert.deepEqual(tarifeTarihleri('2026-10-03', []), {
      haftaici: '20261005',
      cumartesi: '20261003',
      pazar: '20261004',
    });
  });

  it('resmî tatili atlar', () => {
    // 29 Ekim 2026 Perşembe, Cumhuriyet Bayramı
    const t = tarifeTarihleri('2026-10-29', [{ tarih: '2026-10-29' }]);
    assert.equal(t.haftaici, '20261030');
  });

  it('bugün tatilse bugünün tarifesi tatilin tarifesi', () => {
    assert.equal(bugununTarifesi('2026-10-29', [{ tarih: '2026-10-29', tarife: 'pazar' }]), 'pazar');
    assert.equal(bugununTarifesi('2026-10-28', [{ tarih: '2026-10-29', tarife: 'pazar' }]), 'haftaici');
  });
});

describe('saat satırları', () => {
  const s = (saat: number, dk: number) => saat * 3600 + dk * 60;

  it('kalkışları saatlere böler, tekrarları atar, gece yarısı sonrasını sona koyar', () => {
    const satirlar = saatlereBol([s(7, 14), s(6, 50), s(7, 3), s(7, 3) + 20, s(24, 10), s(23, 55)]);
    assert.deepEqual(
      satirlar.map((x) => [x.saat, x.kalkislar.map((k) => k.dakika)]),
      [
        [6, [50]],
        [7, [3, 14]],
        [23, [55]],
        [0, [10]],
      ],
    );
  });

  it('sıradaki kalkış', () => {
    const satirlar = saatlereBol([s(14, 10), s(14, 25), s(14, 40)]);
    assert.equal(siradakiKalkis(satirlar, s(14, 20)), s(14, 25));
    assert.equal(siradakiKalkis(satirlar, s(15, 0)), null);
  });

  it('boş listede boş tablo', () => {
    assert.deepEqual(saatlereBol([]), []);
  });
});
