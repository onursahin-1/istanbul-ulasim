// Ortak efektlerin hesaplarının testleri: basılıyken ölçek, kayan rakamın hücreleri ve yönü.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { basiliOlcek, degisimYonu, hucreler } from '../hareket.ts';

describe('basiliOlcek', () => {
  it('küçük öğe en fazla %6 küçülür', () => {
    assert.equal(basiliOlcek(40), 0.94);
  });
  it('geniş satır en az %1,5 küçülür', () => {
    assert.equal(basiliOlcek(400), 0.985);
  });
  it('arada genişlikle orantılı: aşağı yukarı 6 piksel', () => {
    assert.ok(Math.abs(basiliOlcek(200) - 0.97) < 1e-9);
  });
  it('ölçülmemiş öğe için orta değer', () => {
    assert.equal(basiliOlcek(0), 0.97);
    assert.equal(basiliOlcek(Number.NaN), 0.97);
  });
});

describe('degisimYonu', () => {
  it('azalan sayı -1, artan 1', () => {
    assert.equal(degisimYonu('12', '11'), -1);
    assert.equal(degisimYonu('9', '12'), 1);
  });
  it('saatleri sayı olarak karşılaştırır', () => {
    assert.equal(degisimYonu('16:53', '16:44'), -1);
    assert.equal(degisimYonu('16:44', '16:53'), 1);
  });
  it('sayı yoksa 1', () => {
    assert.equal(degisimYonu('şimdi', '3'), 1);
  });
});

describe('hucreler', () => {
  const anahtarlar = (m: string) => new Map(hucreler(m).map((h) => [h.anahtar, h.karakter]));

  it('yalnız değişen hane farklı anahtarda farklı karakter', () => {
    const a = anahtarlar('12 dk');
    const b = anahtarlar('11 dk');
    const degisen = [...a].filter(([k, c]) => b.get(k) !== c).map(([k]) => k);
    assert.equal(degisen.length, 1);
  });

  it('basamak sayısı azalınca birler basamağı aynı hücrede kalır', () => {
    const a = anahtarlar('10 durak');
    const b = anahtarlar('9 durak');
    const birler = hucreler('10 durak')[1].anahtar;
    assert.equal(a.get(birler), '0');
    assert.equal(b.get(birler), '9');
    // " durak" parçası aynı anahtarlarla duruyor.
    assert.equal(b.get(hucreler('9 durak')[2].anahtar), 'd');
    assert.equal(a.get(hucreler('9 durak')[2].anahtar), 'd');
  });

  it('saatte iki nokta yerinde durur', () => {
    const a = hucreler('16:53');
    const b = hucreler('16:54');
    assert.deepEqual(
      a.map((h) => h.anahtar),
      b.map((h) => h.anahtar),
    );
    assert.equal(a.filter((h, i) => h.karakter !== b[i].karakter).length, 1);
  });

  it('boş metin', () => {
    assert.deepEqual(hucreler(''), []);
  });
});
