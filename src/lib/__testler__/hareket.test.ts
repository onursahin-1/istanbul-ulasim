// Ortak efektlerin hesaplarının testleri: basılıyken ölçek, kayan rakamın hücreleri ve yönü.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { basiliOlcek, bayatlik, cizgileriKes, degisimYonu, enKisaAci, hucreler, koniOlcusu, pusulaYonu, renkKaristir } from '../hareket.ts';

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

describe('bayatlik', () => {
  it('ilk dakika taze, etiketsiz', () => {
    const b = bayatlik(40);
    assert.equal(b.oran, 0);
    assert.equal(b.etiket, null);
    assert.equal(b.saydamlik, 1);
    assert.equal(b.eski, false);
  });
  it('2 dakikadan sonra yaşı yazar, solmaya başlamıştır', () => {
    const b = bayatlik(200);
    assert.equal(b.etiket, '3 dk');
    assert.ok(b.oran > 0.5 && b.oran < 0.6);
    assert.ok(b.saydamlik < 1);
  });
  it('5 dakikada eski: gri ve "önce"', () => {
    const b = bayatlik(360);
    assert.equal(b.eski, true);
    assert.equal(b.oran, 1);
    assert.equal(b.etiket, '6 dk önce');
  });
  it('bozuk yaş taze sayılır', () => {
    assert.equal(bayatlik(Number.NaN).eski, false);
  });
});

describe('renkKaristir', () => {
  it('uçlar ve orta', () => {
    assert.equal(renkKaristir('#000000', '#ffffff', 0), '#000000');
    assert.equal(renkKaristir('#000000', '#ffffff', 1), '#ffffff');
    assert.equal(renkKaristir('#000000', '#ffffff', 0.5), '#808080');
  });
  it('kısa hex okunur', () => {
    assert.equal(renkKaristir('#f00', '#00f', 0), '#ff0000');
  });
  it('okunamayan renk', () => {
    assert.equal(renkKaristir('red', '#000000', 0.2), 'red');
    assert.equal(renkKaristir('red', '#000000', 0.8), '#000000');
  });
});

describe('enKisaAci', () => {
  it('350 → 10 ileri 20 derece', () => {
    assert.equal(enKisaAci(350, 10), 370);
  });
  it('10 → 350 geri 20 derece', () => {
    assert.equal(enKisaAci(10, 350), -10);
  });
  it('sarılmış açıdan devam', () => {
    assert.equal(enKisaAci(370, 20), 380);
  });
});

describe('cizgileriKes', () => {
  const a = { latitude: 41, longitude: 29 };
  const b = { latitude: 41.001, longitude: 29 };
  const c = { latitude: 41.002, longitude: 29 };
  const cizgiler = [[a, b], [b, c]];
  it('oran 1 aynısını döner', () => {
    assert.equal(cizgileriKes(cizgiler, 1), cizgiler);
  });
  it('oran 0 hepsi boş (ilk nokta yok)', () => {
    assert.deepEqual(cizgileriKes(cizgiler, 0), [[], []]);
  });
  it('dörtte bir: ilk bacağın yarısı, ikinci boş', () => {
    const k = cizgileriKes(cizgiler, 0.25);
    assert.ok(Math.abs(k[0][1].latitude - 41.0005) < 1e-6);
    assert.equal(k[1].length, 0);
  });
  it('dörtte üç: ikinci bacağın yarısı', () => {
    const k = cizgileriKes(cizgiler, 0.75);
    assert.equal(k[1].length, 2);
    assert.ok(Math.abs(k[1][1].latitude - 41.0015) < 1e-6);
  });
});

describe('yön konisi', () => {
  it('pusula emin oldukça koni daralır ve uzar; bilinmiyorsa yok', () => {
    const iyi = koniOlcusu(3)!;
    const orta = koniOlcusu(2)!;
    const zayif = koniOlcusu(1)!;
    assert.ok(iyi.aci < orta.aci && orta.aci < zayif.aci);
    assert.ok(iyi.boy > orta.boy && orta.boy > zayif.boy);
    assert.equal(koniOlcusu(0), null);
  });
  it('yön: coğrafi, yoksa manyetik, o da yoksa null', () => {
    assert.equal(pusulaYonu(90, 85), 90);
    assert.equal(pusulaYonu(-1, 85), 85);
    assert.equal(pusulaYonu(-1, -1), null);
    assert.equal(pusulaYonu(360, 0), 0);
  });
});
