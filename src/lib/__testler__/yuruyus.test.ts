// Yürüme yol tarifinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adimlariYaz, type HamAdim } from '../yuruyus';

function adim(s: Partial<HamAdim> = {}): HamAdim {
  return {
    distance: 100,
    relativeDirection: 'CONTINUE',
    absoluteDirection: null,
    streetName: 'Bağdat Caddesi',
    bogusName: false,
    stayOn: false,
    area: false,
    exit: null,
    ...s,
  };
}

describe('adimlariYaz', () => {
  it('boş girdide boş döner', () => {
    assert.deepEqual(adimlariYaz([]), []);
    assert.deepEqual(adimlariYaz(null), []);
    assert.deepEqual(adimlariYaz(undefined), []);
  });

  it('ilk adımı yönüyle birlikte yazar', () => {
    const [a] = adimlariYaz([adim({ relativeDirection: 'DEPART', absoluteDirection: 'NORTH', distance: 240 })]);
    assert.equal(a.donus, 'basla');
    assert.match(a.metin, /Bağdat Caddesi boyunca kuzeye doğru yürü/);
    assert.equal(a.mesafe, '240 m');
  });

  it('sokak adı yoksa ilk adımda yalnızca yönü söyler', () => {
    const [a] = adimlariYaz([
      adim({ relativeDirection: 'DEPART', absoluteDirection: 'SOUTHWEST', streetName: null, distance: 60 }),
    ]);
    assert.equal(a.metin, 'Güneybatıya doğru yürü');
  });

  it('dönüşü ve sokağı birlikte yazar', () => {
    const [a] = adimlariYaz([adim({ relativeDirection: 'RIGHT', streetName: 'Fahrettin Kerim Gökay Caddesi' })]);
    assert.equal(a.donus, 'sag');
    assert.equal(a.metin, 'Sağa dön · Fahrettin Kerim Gökay Caddesi');
  });

  it('aynı sokakta süren adımları tek satırda toplar', () => {
    const satirlar = adimlariYaz([
      adim({ relativeDirection: 'DEPART', distance: 120 }),
      adim({ relativeDirection: 'CONTINUE', distance: 80 }),
      adim({ relativeDirection: 'CONTINUE', distance: 50 }),
    ]);
    assert.equal(satirlar.length, 1, 'üç adım da aynı caddede, tek satır olmalı');
    assert.equal(satirlar[0].mesafe, '250 m');
  });

  it('sokak değişince yeni satır açar', () => {
    const satirlar = adimlariYaz([
      adim({ relativeDirection: 'DEPART', distance: 120 }),
      adim({ relativeDirection: 'LEFT', streetName: 'Tütüncü Mehmet Efendi Caddesi', distance: 90 }),
    ]);
    assert.equal(satirlar.length, 2);
    assert.equal(satirlar[1].donus, 'sol');
  });

  it('uydurma sokak adlarını yazmaz', () => {
    const [a] = adimlariYaz([adim({ relativeDirection: 'LEFT', streetName: 'path', bogusName: true })]);
    assert.equal(a.metin, 'Sola dön');
  });

  it('motorun genel geçer adlarını da eler', () => {
    const [a] = adimlariYaz([adim({ relativeDirection: 'RIGHT', streetName: 'sidewalk', bogusName: false })]);
    assert.equal(a.metin, 'Sağa dön');
  });

  it('kavşak çıkışını sayıyla yazar', () => {
    const [a] = adimlariYaz([
      adim({ relativeDirection: 'CIRCLE_CLOCKWISE', exit: '2', streetName: 'Minibüs Caddesi' }),
    ]);
    assert.equal(a.donus, 'kavsak');
    assert.match(a.metin, /Kavşakta 2\. çıkış/);
  });

  it('U dönüşünün iki yönünü de aynı şekilde yazar', () => {
    const sol = adimlariYaz([adim({ relativeDirection: 'UTURN_LEFT' })])[0];
    const sag = adimlariYaz([adim({ relativeDirection: 'UTURN_RIGHT' })])[0];
    assert.equal(sol.donus, 'geri');
    assert.equal(sag.donus, 'geri');
  });

  it('istasyon giriş ve çıkışını ayırır', () => {
    assert.equal(adimlariYaz([adim({ relativeDirection: 'ENTER_STATION' })])[0].donus, 'giris');
    assert.equal(adimlariYaz([adim({ relativeDirection: 'EXIT_STATION' })])[0].donus, 'cikis');
  });

  it('bilinmeyen yönü düz kabul eder', () => {
    const [a] = adimlariYaz([adim({ relativeDirection: 'BİLİNMEYEN' })]);
    assert.equal(a.donus, 'duz');
  });

  it('mesafesiz adımda mesafe alanını boş bırakır', () => {
    const [a] = adimlariYaz([adim({ relativeDirection: 'LEFT', distance: 0 })]);
    assert.equal(a.mesafe, '');
  });
});

describe('OTP\'nin uydurduğu yol adları', () => {
  it('yürüyen merdiveni Türkçe cümleye çevirir, "escalator boyunca" demez', () => {
    const [a] = adimlariYaz([adim({ streetName: 'escalator', relativeDirection: 'CONTINUE' })]);
    assert.equal(a.metin, 'Yürüyen merdivenle devam et');
    assert.doesNotMatch(a.metin, /escalator|boyunca/i);
  });

  it('dönüşle birlikte: "Sağa dön, merdivenleri kullan"', () => {
    const [a] = adimlariYaz([adim({ streetName: 'steps', relativeDirection: 'RIGHT' })]);
    assert.equal(a.metin, 'Sağa dön, merdivenleri kullan');
    assert.equal(a.eylem, 'Sağa dön');
    assert.equal(a.sokak, 'Merdiven');
  });

  it('üst geçit, alt geçit, yaya geçidi', () => {
    assert.equal(adimlariYaz([adim({ streetName: 'footbridge' })])[0].metin, 'Üst geçitten karşıya geç');
    assert.equal(adimlariYaz([adim({ streetName: 'underpass' })])[0].metin, 'Alt geçitten karşıya geç');
    const [g] = adimlariYaz([adim({ streetName: 'crosswalk over Maslak Caddesi', relativeDirection: 'LEFT' })]);
    assert.equal(g.metin, 'Sola dön, yaya geçidinden karşıya geç');
    assert.equal(g.sokak, 'Yaya geçidi · Maslak Caddesi');
  });

  it('genel yol türlerini adsız sayar', () => {
    for (const ad of ['sidewalk', 'path', 'service road', 'open area', 'road', 'unnamed', 'corridor', 'bike path']) {
      const [a] = adimlariYaz([adim({ streetName: ad, relativeDirection: 'CONTINUE' })]);
      assert.equal(a.metin, 'Düz devam et', ad);
      assert.equal(a.sokak, '', ad);
    }
  });

  it('"part of" ve "corner of" kalıplarını düzeltir', () => {
    assert.equal(adimlariYaz([adim({ streetName: 'Bağdat Caddesi (part of D100)' })])[0].sokak, 'Bağdat Caddesi');
    assert.equal(
      adimlariYaz([adim({ streetName: 'corner of Bağdat Caddesi and Sahil Yolu', relativeDirection: 'RIGHT' })])[0].metin,
      'Sağa dön · Bağdat Caddesi ile Sahil Yolu köşesi',
    );
  });

  it('adsız sayılan yapı bogusName olsa da cümlesini korur', () => {
    const [a] = adimlariYaz([adim({ streetName: 'escalator', bogusName: true })]);
    assert.equal(a.metin, 'Yürüyen merdivenle devam et');
  });
});
