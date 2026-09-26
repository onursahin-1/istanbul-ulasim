import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { seferleriAyristir } from '../kopru.mjs';

/**
 * Tek durak, aynı rotada üç sefer: durağa 08:00, 08:02 ve 08:04'te uğruyorlar
 * (Metrobüs gibi sık bir hat). seferBul'un baktığı alanlar yeterli.
 */
function tarife() {
  return {
    durakBas: Int32Array.from([0, 3]),
    sSefer: Int32Array.from([0, 1, 2]),
    sSaniye: Int32Array.from([8 * 3600, 8 * 3600 + 120, 8 * 3600 + 240]),
    sSira: Int32Array.from([5, 5, 5]),
    seferRota: Int32Array.from([0, 0, 0]),
    seferServis: Int32Array.from([0, 0, 0]),
  };
}
const aktif = [true];
const aday = (kapiNo, saniye, sefer = 0, kayit = null) => ({
  kapiNo,
  zaman: { saniye },
  secilen: { sefer, planlanan: 8 * 3600 + sefer * 120, sira: 5 },
  rotaIdx: 0,
  durakIdx: 0,
  kayit,
});

describe('seferleriAyristir', () => {
  it('aynı sefere düşen ikinci araç alınmamış en yakın sefere geçer', () => {
    const sayac = {};
    const liste = [aday('A', 8 * 3600 + 30), aday('B', 8 * 3600 + 100)];
    seferleriAyristir(tarife(), liste, aktif, sayac);
    assert.deepEqual(liste.map((x) => [x.kapiNo, x.secilen.sefer]), [['A', 0], ['B', 1]]);
    assert.equal(sayac.ayrilan, 1);
  });

  it('başka araca verilmiş sefer atlanır', () => {
    const liste = [aday('A', 8 * 3600 + 30), aday('B', 8 * 3600 + 60), aday('C', 8 * 3600 + 125, 1)];
    seferleriAyristir(tarife(), liste, aktif);
    const sefer = Object.fromEntries(liste.map((x) => [x.kapiNo, x.secilen.sefer]));
    assert.equal(sefer.A, 0);
    assert.equal(sefer.C, 1);
    assert.equal(sefer.B, 2);
  });

  it('fark küçükse önceki nabızda da o seferde olan kalır', () => {
    const liste = [aday('A', 8 * 3600 + 20), aday('B', 8 * 3600 + 50, 0, { sefer: 0 })];
    seferleriAyristir(tarife(), liste, aktif);
    const sefer = Object.fromEntries(liste.map((x) => [x.kapiNo, x.secilen.sefer]));
    assert.equal(sefer.B, 0);
    assert.equal(sefer.A, 1);
  });

  it('boş sefer kalmazsa araç düşer', () => {
    const sayac = {};
    const liste = [aday('A', 8 * 3600), aday('B', 8 * 3600 + 1), aday('C', 8 * 3600 + 2), aday('D', 8 * 3600 + 3)];
    seferleriAyristir(tarife(), liste, aktif, sayac);
    assert.equal(liste.length, 3);
    assert.equal(new Set(liste.map((x) => x.secilen.sefer)).size, 3);
    assert.equal(sayac.cakisan, 1);
  });
});
