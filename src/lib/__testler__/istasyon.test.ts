// Arama ve yakın durak listelerinin istasyon düzeyine inmesinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adTekrariniEle, aramayiIndir, temsilci, yakinlariIndir } from '../istasyon';

const d = (gtfsId: string, name: string, ana?: { gtfsId: string; name: string }) => ({
  gtfsId, name, code: null, desc: null, lat: 41, lon: 29,
  ...(ana ? { parentStation: { gtfsId: ana.gtfsId, name: ana.name, code: null, desc: null, lat: 41, lon: 29 } } : {}),
});

const ANA = { gtfsId: 'ist:ana-1', name: 'Üsküdar' };

describe('temsilci', () => {
  it('ebeveyni olan durağın yerine istasyonu koyar', () => {
    assert.equal(temsilci(d('ist:1', 'Üsküdar ŞH.', ANA)).gtfsId, 'ist:ana-1');
  });

  it('ebeveyni olmayan durağı olduğu gibi bırakır', () => {
    assert.equal(temsilci(d('ist:9', 'Çengelköy')).gtfsId, 'ist:9');
  });

  it('adsız ebeveyne güvenmez', () => {
    const bozuk = { ...d('ist:1', 'Üsküdar ŞH.'), parentStation: { gtfsId: 'ist:ana-1', name: '' } };
    assert.equal(temsilci(bozuk).gtfsId, 'ist:1');
  });

  it('döndürdüğü kayıtta parentStation taşımaz', () => {
    assert.equal('parentStation' in temsilci(d('ist:9', 'Çengelköy')), false);
  });
});

describe('aramayiIndir', () => {
  it('aynı istasyonun peronlarını tek satıra indirir', () => {
    const sonuc = aramayiIndir([
      d('ist:1', 'Üsküdar ŞH.', ANA),
      d('ist:2', 'Üsküdar', ANA),
      d('ist:3', 'Üsküdar Turyol', ANA),
    ]);
    assert.equal(sonuc.length, 1);
    assert.deepEqual([sonuc[0].gtfsId, sonuc[0].name], ['ist:ana-1', 'Üsküdar']);
  });

  it('istasyonu olmayan durakları korur', () => {
    const sonuc = aramayiIndir([d('ist:1', 'Üsküdar ŞH.', ANA), d('ist:9', 'Çengelköy')]);
    assert.deepEqual(sonuc.map((s) => s.gtfsId), ['ist:ana-1', 'ist:9']);
  });

  it('stations() ile gelen istasyonu iki kez yazmaz', () => {
    const sonuc = aramayiIndir([d('ist:1', 'Üsküdar ŞH.', ANA)], [{ ...ANA, code: null, desc: null, lat: 41, lon: 29 }]);
    assert.equal(sonuc.length, 1);
  });

  it('yalnız stations() ile gelen istasyonu da gösterir', () => {
    const sonuc = aramayiIndir([], [{ ...ANA, code: null, desc: null, lat: 41, lon: 29 }]);
    assert.deepEqual(sonuc.map((s) => s.gtfsId), ['ist:ana-1']);
  });

  it('boş ve eksik veriyle çökmez', () => {
    assert.deepEqual(aramayiIndir(null, null), []);
    assert.deepEqual(aramayiIndir(undefined), []);
  });
});

describe('yakinlariIndir', () => {
  const k = (an: number) => ({ an });
  const sirala = (a: { an: number }, b: { an: number }) => a.an - b.an;

  it('peronları birleştirip en yakın mesafeyi tutar', () => {
    const sonuc = yakinlariIndir([
      { mesafe: 180, durak: { ...d('ist:1', 'Üsküdar ŞH.', ANA), kalkislar: [k(30)] } },
      { mesafe: 40, durak: { ...d('ist:2', 'Üsküdar', ANA), kalkislar: [k(10)] } },
    ], sirala);
    assert.equal(sonuc.length, 1);
    assert.equal(sonuc[0].mesafe, 40);
    assert.deepEqual(sonuc[0].durak.kalkislar.map((x) => x.an), [10, 30]);
  });

  it('birleşen kalkışları sıralar ve sayısını sınırlar', () => {
    const sonuc = yakinlariIndir([
      { mesafe: 10, durak: { ...d('ist:1', 'A', ANA), kalkislar: [k(50), k(90)] } },
      { mesafe: 20, durak: { ...d('ist:2', 'B', ANA), kalkislar: [k(5), k(70)] } },
    ], sirala, 3);
    assert.deepEqual(sonuc[0].durak.kalkislar.map((x) => x.an), [5, 50, 70]);
  });

  it('listeyi mesafeye göre yeniden sıralar', () => {
    const sonuc = yakinlariIndir([
      { mesafe: 300, durak: { ...d('ist:1', 'Uzak', ANA), kalkislar: [] } },
      { mesafe: 500, durak: { ...d('ist:9', 'Tek başına'), kalkislar: [] } },
      { mesafe: 20, durak: { ...d('ist:2', 'Yakın', ANA), kalkislar: [] } },
    ], sirala);
    assert.deepEqual(sonuc.map((s) => s.mesafe), [20, 500]);
  });

  it('istasyonsuz durakları ayrı tutar', () => {
    const sonuc = yakinlariIndir([
      { mesafe: 10, durak: { ...d('ist:8', 'Çengelköy'), kalkislar: [] } },
      { mesafe: 20, durak: { ...d('ist:9', 'Beylerbeyi'), kalkislar: [] } },
    ], sirala);
    assert.equal(sonuc.length, 2);
  });
});

describe('adTekrariniEle', () => {
  const y = (gtfsId: string, name: string, lat: number, lon: number) =>
    ({ gtfsId, name, code: null, desc: null, lat, lon });

  it('beslemeler arası aynı yeri teke indirir', () => {
    const sonuc = adTekrariniEle([
      y('ray:1', 'Mecidiyeköy', 41.0672, 28.9946),
      y('iett:2', 'MECİDİYEKÖY', 41.0674, 28.9949),
    ]);
    assert.deepEqual(sonuc.map((d) => d.gtfsId), ['ray:1']);
  });

  it('uzaktaki aynı adlı durağı elemez', () => {
    // Şile'de de "KADIKÖY" adında bir durak var.
    const sonuc = adTekrariniEle([
      y('a', 'Kadıköy', 40.9902, 29.0245),
      y('b', 'KADIKÖY', 41.1755, 29.6128),
    ]);
    assert.equal(sonuc.length, 2);
  });

  it('ilk gireni tutar — liste mesafeye göre sıralı gelmeli', () => {
    const sonuc = adTekrariniEle([y('yakin', 'Levent', 41.0, 29.0), y('uzak', 'Levent', 41.0008, 29.0)]);
    assert.deepEqual(sonuc.map((d) => d.gtfsId), ['yakin']);
  });

  it('konumu olmayan kaydı atar', () => {
    const sonuc = adTekrariniEle([{ gtfsId: 'x', name: 'Bilinmez', lat: null, lon: null }]);
    assert.deepEqual(sonuc, []);
  });

  it('eşiği çağıran belirleyebilir', () => {
    const iki = [y('a', 'Levent', 41.0, 29.0), y('b', 'Levent', 41.004, 29.0)];   // ~445 m
    assert.equal(adTekrariniEle(iki, 500).length, 1);
    assert.equal(adTekrariniEle(iki, 300).length, 2);
  });
});
