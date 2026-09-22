// Alt yaprağın durak seçiminin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dokununcaDurak, durakOfseti, hedefDurak, sinirla, yukseklikleriHesapla } from '../yaprak';

// iPhone 15 benzeri: sekme çubuğu hariç ~760 pt alan, arama kutusu ~180 pt.
const Y = yukseklikleriHesapla(760, 180, 76, 0.48);

describe('yukseklikleriHesapla', () => {
  it('üç durağı sıralı üretir', () => {
    assert.deepEqual(Y, { kapali: 76, orta: 365, acik: 580 });
  });

  it('küçük ekranda orta, açıktan büyük olamaz', () => {
    const k = yukseklikleriHesapla(300, 250, 76, 0.48);
    assert.ok(k.orta <= k.acik);
    assert.ok(k.acik >= k.kapali);
  });

  it('henüz ölçülmemiş (0) alanda çökmez', () => {
    const k = yukseklikleriHesapla(0, 0, 76, 0.48);
    assert.deepEqual(k, { kapali: 76, orta: 76, acik: 76 });
  });
});

describe('durakOfseti', () => {
  it('açıkta sıfır, kapalıda en büyük', () => {
    assert.equal(durakOfseti(Y, 'acik'), 0);
    assert.equal(durakOfseti(Y, 'orta'), 215);
    assert.equal(durakOfseti(Y, 'kapali'), 504);
  });
});

describe('hedefDurak', () => {
  it('yavaş bırakılınca en yakın durağa oturur', () => {
    assert.equal(hedefDurak(20, 0, Y), 'acik');
    assert.equal(hedefDurak(250, 0.1, Y), 'orta');
    assert.equal(hedefDurak(450, -0.1, Y), 'kapali');
  });

  it('ortadan kısa ama hızlı bir aşağı çekiş yaprağı kapatır', () => {
    // Yalnızca 40 pt çekildi, en yakın durak hâlâ orta — ama fiske yönü aşağı.
    assert.equal(hedefDurak(255, 1.2, Y), 'kapali');
  });

  it('kapalıdan hızlı yukarı fiske ortaya çıkar, bir anda tam açılmaz', () => {
    assert.equal(hedefDurak(480, -1.2, Y), 'orta');
  });

  it('ortadan hızlı yukarı fiske tam açar', () => {
    assert.equal(hedefDurak(200, -1.0, Y), 'acik');
  });

  it('uçlarda fiske dışarı taşmaz', () => {
    assert.equal(hedefDurak(0, -2, Y), 'acik');
    assert.equal(hedefDurak(504, 2, Y), 'kapali');
  });
});

describe('dokununcaDurak', () => {
  it('başlığa dokunmak kapalıyı açar, ortayı kapatır, açığı küçültür', () => {
    assert.equal(dokununcaDurak('kapali'), 'orta');
    assert.equal(dokununcaDurak('orta'), 'kapali');
    assert.equal(dokununcaDurak('acik'), 'orta');
  });
});

describe('sinirla', () => {
  it('sınırlar içinde olduğu gibi bırakır', () => {
    assert.equal(sinirla(100, Y), 100);
  });
  it('yukarı taşmada direnir', () => {
    assert.equal(sinirla(-60, Y), -20);
  });
  it('aşağı taşmada direnir', () => {
    assert.equal(sinirla(504 + 90, Y), 534);
  });
});
