// Sefer sıklığı çıkarımının testleri.
//
// OTP'nin GTFS API'sinde frekans alanı yok; sıklığı ardışık kalkışların arasındaki
// farktan çıkarıyoruz. Bu çıkarımın kenar durumları (servis boşluğu, tek kalkış,
// kopya kayıt) burada sabitleniyor.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { seferBilgisi, sikliktanYazi, type Kalkis } from '../sefer';

const GUN = 1_800_000_000; // servis gününün başlangıcı; mutlak değeri önemsiz
const dk = (n: number) => n * 60;

/** Verilen dakikalardan kalkış listesi üretir. */
function kalkislar(...dakikalar: number[]): Kalkis[] {
  return dakikalar.map((d) => ({ saniye: dk(d), serviceDay: GUN }));
}

describe('seferBilgisi', () => {
  it('düzenli aralıkta ortanca sıklığı bulur', () => {
    const b = seferBilgisi(kalkislar(600, 605, 610, 615, 620), null);
    assert.equal(b.aralikDk, 5);
  });

  it('dalgalı aralıkta alt ve üst sınır verir', () => {
    const b = seferBilgisi(kalkislar(600, 604, 610, 616, 620), null);
    assert.equal(b.aralikDk, 5);
    assert.equal(b.altDk, 4);
    assert.equal(b.ustDk, 6);
  });

  it('90 dakikadan uzun boşlukları sıklığa katmaz', () => {
    // Gece servisi: akşam sık, sonra uzun boşluk, sonra yine sık.
    const b = seferBilgisi(kalkislar(600, 605, 610, 900, 905, 910), null);
    assert.equal(b.aralikDk, 5, 'aradaki 290 dakikalık boşluk ortancayı bozmamalı');
  });

  it('tek kalkıştan sıklık çıkarmaz', () => {
    const b = seferBilgisi(kalkislar(600), null);
    assert.equal(b.aralikDk, null);
  });

  it('boş listede her alan boş döner', () => {
    const b = seferBilgisi([], dk(600));
    assert.equal(b.aralikDk, null);
    assert.equal(b.sonrakiSaniye, null);
    assert.equal(b.sonSefer, false);
  });

  it('aynı seferin kopyası aralığı sıfırlamaz', () => {
    const b = seferBilgisi(kalkislar(600, 600, 610, 620, 630), null);
    assert.equal(b.aralikDk, 10);
  });

  it('bindiğin seferden sonraki kalkışı bulur', () => {
    const b = seferBilgisi(kalkislar(600, 610, 620), dk(610));
    assert.equal(b.sonrakiSaniye, dk(620));
    assert.equal(b.sonSefer, false);
  });

  it('son seferi işaretler', () => {
    const b = seferBilgisi(kalkislar(600, 610, 620), dk(620));
    assert.equal(b.sonrakiSaniye, null);
    assert.equal(b.sonSefer, true);
    assert.equal(b.sonSaniye, dk(620));
  });

  it('30 dakikadan seyrek hatlarda sıklık iddiasında bulunmaz', () => {
    const b = seferBilgisi(kalkislar(600, 645, 690, 735), null);
    assert.equal(b.aralikDk, null, '45 dakikalık aralık "her N dakikada bir" demeye uygun değil');
  });
});

describe('sikliktanYazi', () => {
  it('tek değerde yaklaşık der', () => {
    assert.equal(sikliktanYazi(seferBilgisi(kalkislar(600, 605, 610, 615), null)), 'Yaklaşık her 5 dakikada bir');
  });

  it('dalgalıysa aralık verir', () => {
    assert.equal(sikliktanYazi(seferBilgisi(kalkislar(600, 604, 610, 616, 620), null)), 'Her 4–6 dakikada bir');
  });

  it('sıklık yoksa boş döner', () => {
    assert.equal(sikliktanYazi(seferBilgisi(kalkislar(600), null)), '');
  });
});
