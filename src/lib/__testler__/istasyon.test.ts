// Arama ve yakın durak listelerinin istasyon düzeyine inmesinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adTekrariniEle,
  aramayiIndir,
  ayniAdliSaatsizHatlar,
  saatsizHatlariKatla,
  temsilci,
  yakinlariIndir,
} from '../istasyon';

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

  it('iki peron da listedeyse istasyonun aynı kalkışı bir kez sayılır', () => {
    // Her peron istasyonun (bütün peronların) kalkışlarını getiriyor: aynı liste iki kez.
    const ortak = [k(5), k(20), k(40)];
    const sonuc = yakinlariIndir(
      [
        { mesafe: 10, durak: { ...d('ist:1', 'A', ANA), kalkislar: ortak } },
        { mesafe: 30, durak: { ...d('ist:2', 'A', ANA), kalkislar: ortak } },
      ],
      sirala,
      3,
      (x) => String(x.an),
    );
    assert.deepEqual(sonuc[0].durak.kalkislar.map((x) => x.an), [5, 20, 40]);
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

describe('yakinlariIndir · hatlar', () => {
  it('peronların hatlarını tekilleştirerek birleştirir', () => {
    const sonuc = yakinlariIndir(
      [
        { mesafe: 10, durak: { ...d('ist:1', 'A', ANA), kalkislar: [], routes: [{ gtfsId: 'h1' }, { gtfsId: 'h2' }] } },
        { mesafe: 20, durak: { ...d('ist:2', 'B', ANA), kalkislar: [], routes: [{ gtfsId: 'h2' }, { gtfsId: 'h3' }] } },
      ],
      () => 0,
    );
    assert.deepEqual(sonuc[0].durak.routes.map((h) => h.gtfsId), ['h1', 'h2', 'h3']);
  });

  it('hat bilgisi gelmeyen durakta boş liste verir', () => {
    const sonuc = yakinlariIndir([{ mesafe: 10, durak: { ...d('ist:8', 'Çengelköy'), kalkislar: [] } }], () => 0);
    assert.deepEqual(sonuc[0].durak.routes, []);
  });
});

describe('saatsizHatlariKatla', () => {
  type H = { gtfsId: string; minibus?: boolean };
  const minibusMu = (h: H) => !!h.minibus;
  const MB1 = { gtfsId: 'mb1', minibus: true };
  const MB2 = { gtfsId: 'mb2', minibus: true };
  const IETT = { gtfsId: 'iett-89C' };
  // Göztepe Meydanı: İETT istasyonu ve ~30 m ötede aynı adlı minibüs istasyonu.
  const y = (id: string, ad: string, lat: number, kalkis: number, hatlar: H[], mesafe = 90) => ({
    mesafe,
    durak: { gtfsId: id, name: ad, code: null, desc: null, lat, lon: 28.8389, kalkislar: Array(kalkis).fill(0), routes: hatlar },
  });

  it('kalkışsız minibüs durağını aynı adlı yakın durağa katlar', () => {
    const sonuc = saatsizHatlariKatla(
      [y('mb', 'GÖZTEPE MEYDANI', 41.05443, 0, [MB1, MB2]), y('iett', 'GÖZTEPE MEYDANI', 41.05446, 2, [IETT])],
      minibusMu,
    );
    assert.deepEqual(sonuc.map((x) => x.durak.gtfsId), ['iett']);
    assert.deepEqual(sonuc[0].durak.saatsiz.map((h) => h.gtfsId), ['mb1', 'mb2']);
  });

  it('adı tutmayan minibüs durağını kendi satırında bırakır', () => {
    const sonuc = saatsizHatlariKatla(
      [y('mb', 'MALAZGİRT İLK Ö.O', 41.05354, 0, [MB1]), y('iett', 'MALAZGİRT ORTAOKULU', 41.05337, 2, [IETT])],
      minibusMu,
    );
    assert.deepEqual(sonuc.map((x) => x.durak.gtfsId), ['mb', 'iett']);
    assert.deepEqual(sonuc[0].durak.saatsiz.map((h) => h.gtfsId), ['mb1']);
  });

  it('aynı adlı ama uzaktaki durağa katlamaz', () => {
    const sonuc = saatsizHatlariKatla(
      [y('mb', 'KADIKÖY', 41.0, 0, [MB1]), y('iett', 'KADIKÖY', 41.01, 2, [IETT])],   // ~1,1 km
      minibusMu,
    );
    assert.equal(sonuc.length, 2);
  });

  it('ne kalkışı ne saatsiz hattı olan durağı gizler', () => {
    const sonuc = saatsizHatlariKatla([y('bos', 'X', 41.0, 0, [IETT]), y('dolu', 'Y', 41.001, 1, [IETT])], minibusMu);
    assert.deepEqual(sonuc.map((x) => x.durak.gtfsId), ['dolu']);
  });

  it('hiçbir durakta kalkış yoksa (gece) hiçbirini gizlemez', () => {
    const sonuc = saatsizHatlariKatla([y('a', 'X', 41.0, 0, [IETT]), y('b', 'Y', 41.001, 0, [])], minibusMu);
    assert.deepEqual(sonuc.map((x) => x.durak.gtfsId), ['a', 'b']);
  });

  it('kalkışlı durağın kendi minibüs hatlarını da saatsiz olarak işaretler', () => {
    const sonuc = saatsizHatlariKatla([y('karma', 'Z', 41.0, 2, [IETT, MB1])], minibusMu);
    assert.deepEqual(sonuc[0].durak.saatsiz.map((h) => h.gtfsId), ['mb1']);
  });

  it('aynı hattı iki kez eklemez', () => {
    const sonuc = saatsizHatlariKatla(
      [y('iett', 'A', 41.0, 1, [MB1]), y('mb', 'A', 41.0002, 0, [MB1, MB2])],
      minibusMu,
    );
    assert.deepEqual(sonuc[0].durak.saatsiz.map((h) => h.gtfsId), ['mb1', 'mb2']);
  });
});

describe('ayniAdliSaatsizHatlar', () => {
  type H = { gtfsId: string; minibus?: boolean };
  const minibusMu = (h: H) => !!h.minibus;
  const MB1 = { gtfsId: 'mb1', minibus: true };
  const MB2 = { gtfsId: 'mb2', minibus: true };
  const IETT = { gtfsId: 'iett-89C' };
  const IETT_ISTASYON = { gtfsId: 'iett:ana-579100', name: 'GÖZTEPE MEYDANI', lat: 41.05446, lon: 28.83894 };
  const aday = (gtfsId: string, name: string, hatlar: H[], ana?: { gtfsId: string; name: string }) => ({
    durak: {
      gtfsId,
      name,
      lat: 41.0544,
      lon: 28.8387,
      routes: hatlar,
      ...(ana ? { parentStation: { ...ana, lat: 41.0544, lon: 28.8387 } } : {}),
    },
  });

  it('İETT istasyonunun ekranına aynı adlı minibüs istasyonunun hatlarını getirir', () => {
    const hatlar = ayniAdliSaatsizHatlar({ ...IETT_ISTASYON, routes: [IETT] }, [
      aday('iett:579099', 'GÖZTEPE MEYDANI', [IETT], IETT_ISTASYON),
      aday('rv:93942', 'GÖZTEPE MEYDANI', [MB1], { gtfsId: 'rv:ana-90455', name: 'GÖZTEPE MEYDANI' }),
      aday('rv:90455', 'GÖZTEPE MEYDANI', [MB1, MB2], { gtfsId: 'rv:ana-90455', name: 'GÖZTEPE MEYDANI' }),
    ], minibusMu);
    assert.deepEqual(hatlar.map((h) => h.gtfsId), ['mb1', 'mb2']);
  });

  it('başka adlı yakın durağın minibüslerini almaz', () => {
    const hatlar = ayniAdliSaatsizHatlar({ ...IETT_ISTASYON, routes: [] }, [
      aday('rv:90990', 'MALAZGİRT İLK Ö.O', [MB1]),
    ], minibusMu);
    assert.deepEqual(hatlar, []);
  });

  it('durağın kendi minibüs hatlarını da sayar', () => {
    const hatlar = ayniAdliSaatsizHatlar({ gtfsId: 'rv:90990', name: 'MALAZGİRT İLK Ö.O', routes: [MB2, IETT] }, [], minibusMu);
    assert.deepEqual(hatlar.map((h) => h.gtfsId), ['mb2']);
  });
});
