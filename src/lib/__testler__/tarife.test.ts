// Durak tarifesinin testleri: hangi gün sorulur, saat satırları, sıradaki kalkış.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bugununTarifesi, gunTuru, kisaDonusleriIsaretle, saatlereBol, siradakiKalkis, tarifeTarihleri } from '../tarife.ts';

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

describe('kısa dönüş işaretleri', () => {
  const s = (saat: number, dk: number) => saat * 3600 + dk * 60;
  // Bostancı → Halkalı yönü: Gebze – Halkalı ve Pendik – Ataköy trenleri sırayla.
  const HALKALI = ['Gebze', 'Pendik', 'Bostancı', 'Ataköy', 'Zeytinburnu', 'Halkalı'];
  const desenler = [
    { kod: 'g', hedef: 'Halkalı', duraklar: HALKALI, saniyeler: [s(7, 10), s(7, 25), s(7, 40)] },
    { kod: 'a', hedef: 'Ataköy', duraklar: ['Pendik', 'Bostancı', 'Ataköy'], saniyeler: [s(7, 3), s(7, 18)] },
    { kod: 'z', hedef: 'Zeytinburnu', duraklar: ['Pendik', 'Bostancı', 'Zeytinburnu'], saniyeler: [s(7, 33)] },
  ];

  it('en çok seferin gittiği yer asıl uç; öbürleri baş harfiyle işaretli', () => {
    const r = kisaDonusleriIsaretle(desenler);
    assert.equal(r.anaHedef, 'Halkalı');
    assert.deepEqual(r.aciklamalar, [
      { harf: 'A', hedef: 'Ataköy', kisa: true },
      { harf: 'Z', hedef: 'Zeytinburnu', kisa: true },
    ]);
    const satir = saatlereBol(r.kalkislar)[0];
    assert.deepEqual(
      satir.kalkislar.map((k) => `${k.dakika}${k.isaret ?? ''}`),
      ['3A', '10', '18A', '25', '33Z', '40'],
    );
  });

  it('tek yere gidiliyorsa işaret yok', () => {
    const r = kisaDonusleriIsaretle([desenler[0]]);
    assert.deepEqual(r.aciklamalar, []);
    assert.ok(r.kalkislar.every((k) => !k.isaret));
  });

  it('aynı harfle başlayan iki yer iki harf alır; asıl yolun dışındaki yer kısa dönüş sayılmaz', () => {
    const r = kisaDonusleriIsaretle([
      { kod: 'k', hedef: 'Kabataş', duraklar: ['Bağcılar', 'Eminönü', 'Kabataş'], saniyeler: [1, 2, 3] },
      { kod: 'e', hedef: 'Eminönü', duraklar: ['Cevizlibağ', 'Eminönü'], saniyeler: [4, 5] },
      { kod: 'x', hedef: 'Esenler', duraklar: ['Cevizlibağ', 'Esenler'], saniyeler: [6] },
    ]);
    assert.deepEqual(r.aciklamalar, [
      { harf: 'E', hedef: 'Eminönü', kisa: true },
      { harf: 'ES', hedef: 'Esenler', kisa: false },
    ]);
  });

  it('aynı dakikada iki farklı yere giden sefer ikisi de yazılır', () => {
    const satir = saatlereBol([{ saniye: s(8, 16) }, { saniye: s(8, 16), isaret: 'E' }, { saniye: s(8, 16) + 30 }])[0];
    assert.deepEqual(satir.kalkislar.map((k) => k.isaret ?? ''), ['', 'E']);
  });
});
