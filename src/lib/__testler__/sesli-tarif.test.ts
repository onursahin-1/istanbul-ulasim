// Sesli yol tarifinin ne zaman ne söylediği.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mesafeSoyle, sesliDuyurular, type SesGirdisi } from '../sesli-tarif.ts';

const tarif = [
  { eylem: 'Başla', sokak: 'Göztepe Caddesi' },
  { eylem: 'Sağa dön', sokak: 'Bağdat Caddesi' },
  { eylem: 'Sola dön', sokak: '' },
];

function yuruyus(yer: SesGirdisi['yer'], ek: Partial<SesGirdisi> = {}): SesGirdisi {
  return {
    adim: 0,
    tur: 'yuru',
    faz: 'yuru',
    rol: 'baslangic',
    tarif,
    yer,
    hedefAdi: 'Mahmutbey durağı',
    toplamMetre: 640,
    toplamDakika: 8,
    ...ek,
  };
}

/** Konum akışını baştan sona çalıştırıp söylenen cümleleri toplar. */
function akis(girdiler: SesGirdisi[]): string[] {
  const soylenen = new Set<string>();
  const cumleler: string[] = [];
  for (const g of girdiler) {
    const { soyle, unut } = sesliDuyurular(g, soylenen);
    for (const a of unut) soylenen.delete(a);
    for (const d of soyle) {
      soylenen.add(d.anahtar);
      cumleler.push(d.metin);
    }
  }
  return cumleler;
}

describe('mesafeSoyle', () => {
  it('yuvarlar', () => {
    assert.equal(mesafeSoyle(37), '40 metre');
    assert.equal(mesafeSoyle(4), '10 metre');
    assert.equal(mesafeSoyle(180), '200 metre');
    assert.equal(mesafeSoyle(1240), '1,2 kilometre');
  });
});

describe('sesliDuyurular: yürürken', () => {
  it('başta yönü ve mesafeyi, dönüşü yaklaşırken ve gelince birer kez söyler', () => {
    const cumleler = akis([
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 5 }),
      yuruyus({ simdiki: 0, sonrakine: 110, rotadan: 5 }),
      yuruyus({ simdiki: 0, sonrakine: 90, rotadan: 5 }),
      yuruyus({ simdiki: 0, sonrakine: 15, rotadan: 5 }),
      yuruyus({ simdiki: 0, sonrakine: 8, rotadan: 5 }),
      yuruyus({ simdiki: 1, sonrakine: 60, rotadan: 5 }),
    ]);
    assert.deepEqual(cumleler, [
      'Mahmutbey durağı yönünde 650 metre yürü, yaklaşık 8 dakika.',
      '100 metre sonra sağa dön, Bağdat Caddesi.',
      'Şimdi sağa dön, Bağdat Caddesi.',
      '60 metre sonra sola dön.',
    ]);
  });

  it('kısa adımda "yaklaşırken" atlanır, yalnız "şimdi" söylenir', () => {
    const cumleler = akis([yuruyus({ simdiki: 0, sonrakine: 12, rotadan: 0 }), yuruyus({ simdiki: 0, sonrakine: 60, rotadan: 0 })]);
    assert.deepEqual(cumleler.slice(1), ['Şimdi sağa dön, Bağdat Caddesi.']);
  });

  it('rotadan çıkınca bir kez uyarır, dönünce unutur, yeniden çıkınca yine uyarır', () => {
    const cumleler = akis([
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 60 }),
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 70 }),
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 10 }),
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 55 }),
    ]);
    assert.equal(cumleler.filter((c) => c.startsWith('Rotadan')).length, 2);
  });

  it('son adımda varışı söyler', () => {
    const cumleler = akis([yuruyus({ simdiki: 2, sonrakine: 30, rotadan: 0 }, { rol: 'varis' })]);
    assert.deepEqual(cumleler, ['Varış noktası yönünde 650 metre yürü, yaklaşık 8 dakika.', 'Varış noktasına geldin.']);
  });
});

describe('sesliDuyurular: raylı istasyona son yaklaşma', () => {
  it('dönüşler ve sapma söylenmez; bir kez "herhangi bir girişten gir"', () => {
    const istasyon = { hedefAdi: 'Mahmutbey istasyonu' };
    const cumleler = akis([
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 5 }, istasyon),
      yuruyus({ simdiki: 0, sonrakine: 15, rotadan: 60 }, { ...istasyon, sonYaklasma: 140 }),
      yuruyus({ simdiki: 0, sonrakine: 8, rotadan: 70 }, { ...istasyon, sonYaklasma: 90 }),
    ]);
    assert.deepEqual(cumleler, [
      'Mahmutbey istasyonu yönünde 650 metre yürü, yaklaşık 8 dakika.',
      'Mahmutbey istasyonu 150 metre ileride. Herhangi bir girişten gir.',
    ]);
  });
});

describe('sesliDuyurular: raylı istasyona giderken yoldan çıkınca', () => {
  it('dönüşler yerine istasyonun yönü; yola dönünce unutulur', () => {
    const istasyon = { hedefAdi: 'Mahmutbey istasyonu' };
    const cumleler = akis([
      yuruyus({ simdiki: 0, sonrakine: 300, rotadan: 5 }, istasyon),
      yuruyus({ simdiki: 0, sonrakine: 15, rotadan: 60 }, { ...istasyon, istasyonYonu: { metre: 260, yer: 'kuzeydoğuda' } }),
      yuruyus({ simdiki: 0, sonrakine: 15, rotadan: 70 }, { ...istasyon, istasyonYonu: { metre: 240, yer: 'kuzeydoğuda' } }),
      yuruyus({ simdiki: 0, sonrakine: 15, rotadan: 5 }, istasyon),
    ]);
    assert.deepEqual(cumleler, [
      'Mahmutbey istasyonu yönünde 650 metre yürü, yaklaşık 8 dakika.',
      'Rotadan çıktın. Mahmutbey istasyonu kuzeydoğuda, 250 metre.',
      'Şimdi sağa dön, Bağdat Caddesi.',
    ]);
  });
});

describe('sesliDuyurular: araçta', () => {
  const arac = (ek: Partial<SesGirdisi>): SesGirdisi => ({
    adim: 1,
    tur: 'arac',
    faz: 'icinde',
    binme: 'otobüsüne bin',
    hat: '89T',
    inisAdi: 'Taksim',
    ...ek,
  });

  it('beklerken hattı ve kalkışı, binince inişi, yaklaşırken iki ve bir durak kala söyler', () => {
    const cumleler = akis([
      arac({ faz: 'bekle', kalkisaDakika: 4 }),
      arac({ kalanDurak: 9 }),
      arac({ kalanDurak: 5 }),
      arac({ kalanDurak: 2 }),
      arac({ kalanDurak: 1 }),
      arac({ kalanDurak: 0, durakta: true }),
    ]);
    assert.deepEqual(cumleler, [
      '89T otobüsüne bin. Kalkışa 4 dakika var.',
      'Taksim durağında ineceksin, 9 durak var.',
      'İki durak sonra ineceksin: Taksim.',
      'Sonraki durakta ineceksin: Taksim.',
      'İn. Taksim.',
    ]);
  });

  it('varışta bir kez söyler', () => {
    assert.deepEqual(akis([arac({ faz: 'vardi' }), arac({ faz: 'vardi' })]), ['Vardın. İyi günler.']);
  });
});
