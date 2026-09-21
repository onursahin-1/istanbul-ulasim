// Saat ve süre yardımcılarının testleri.
//
// Toplu taşıma verisinde gün 24 saatten uzundur: gece 01:00 seferi, tarifede
// "25:00" olarak geçer. Buradaki testlerin çoğu o eşiği koruyor.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isodanSaniye, mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '../zaman';

describe('saatYaz', () => {
  it('ISO saatten saat ve dakikayı alır', () => {
    assert.equal(saatYaz('2026-09-17T09:00:49+03:00'), '09:00');
  });

  it('eksik değerde yer tutucu verir', () => {
    assert.equal(saatYaz(null), '--:--');
    assert.equal(saatYaz(''), '--:--');
    assert.equal(saatYaz('tarih değil'), '--:--');
  });
});

describe('saniyedenSaat', () => {
  it('gün başından saniyeyi saate çevirir', () => {
    assert.equal(saniyedenSaat(0), '00:00');
    assert.equal(saniyedenSaat(9 * 3600 + 5 * 60), '09:05');
  });

  it('24 saati aşan tarife saatlerini ertesi güne taşır', () => {
    assert.equal(saniyedenSaat(25 * 3600), '01:00', 'tarifedeki 25:00 gece 01:00 demektir');
    assert.equal(saniyedenSaat(26 * 3600 + 30 * 60), '02:30');
  });
});

describe('isodanSaniye', () => {
  it('ISO saatten gün başından saniyeyi çıkarır', () => {
    assert.equal(isodanSaniye('2026-09-19T18:34:00+03:00'), 18 * 3600 + 34 * 60);
  });

  it('saniyesi olmayan biçimi de okur', () => {
    assert.equal(isodanSaniye('2026-09-19T18:34+03:00'), 18 * 3600 + 34 * 60);
  });

  it('okunamayan girdide null döner', () => {
    assert.equal(isodanSaniye(null), null);
    assert.equal(isodanSaniye('bugün'), null);
  });
});

describe('sureYaz', () => {
  it('bir saatin altını dakika yazar', () => {
    assert.equal(sureYaz(59 * 60), '59 dk');
  });

  it('saat ve dakikayı ayırır', () => {
    assert.equal(sureYaz(65 * 60), '1 sa 5 dk');
    assert.equal(sureYaz(120 * 60), '2 sa');
  });

  it('çok kısa süreyi 1 dakikaya yuvarlar', () => {
    assert.equal(sureYaz(10), '1 dk', 'sıfır dakika yazmak yanıltıcı olur');
  });

  it('eksik değerde boş döner', () => {
    assert.equal(sureYaz(null), '');
    assert.equal(sureYaz(undefined), '');
  });
});

describe('mesafeYaz', () => {
  it('bir kilometrenin altını metre olarak yuvarlar', () => {
    assert.equal(mesafeYaz(234), '230 m');
    assert.equal(mesafeYaz(999), '1000 m');
  });

  it('kilometreyi virgüllü yazar', () => {
    assert.equal(mesafeYaz(1400), '1,4 km');
    assert.equal(mesafeYaz(12_345), '12,3 km');
  });

  it('eksik değerde boş döner', () => {
    assert.equal(mesafeYaz(null), '');
  });
});
