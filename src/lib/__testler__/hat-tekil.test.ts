import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { desenleriBirlestir, hatGrubu, hatlariTekille, kardesKimlikleri } from '../hat-tekil.ts';

const iett = { name: 'İETT' };
const T2a = { gtfsId: '1:23531', shortName: 'T2', longName: 'TAKSİM MEYDAN - BEYOĞLU TÜNEL', mode: 'TRAM', agency: iett };
const T2b = { gtfsId: '1:23532', shortName: 'T2', longName: 'BEYOĞLU TÜNEL - TAKSİM MEYDAN', mode: 'TRAM', agency: iett };
const T1 = { gtfsId: '2:4065', shortName: 'T1', longName: 'BAĞCILAR - KABATAŞ', mode: 'TRAM', agency: { name: 'Metro İstanbul' } };

describe('hatlariTekille', () => {
  it('iki yönü ayrı yayımlanan hattı tek satıra indirir', () => {
    const sonuc = hatlariTekille([T2a, T2b, T1]);
    assert.equal(sonuc.length, 2);
    assert.deepEqual(sonuc[0].kardesler, ['1:23531', '1:23532']);
    assert.equal(sonuc[0].longName, T2a.longName);
  });

  it('kısa adı aynı ama işletmecisi ya da tipi farklı hatlar ayrı kalır', () => {
    const vapur = { ...T2a, gtfsId: 'x', mode: 'FERRY' };
    const baska = { ...T2a, gtfsId: 'y', agency: { name: 'Metro İstanbul' } };
    assert.equal(hatlariTekille([T2a, vapur, baska]).length, 3);
  });

  it('kısa adı olmayan hatlar birleşmez', () => {
    const a = { gtfsId: 'a', shortName: null };
    const b = { gtfsId: 'b', shortName: '' };
    assert.notEqual(hatGrubu(a), hatGrubu(b));
    assert.equal(hatlariTekille([a, b]).length, 2);
  });
});

describe('kardesKimlikleri', () => {
  it('kendisi hariç aynı hattın güzergâhları', () => {
    assert.deepEqual(kardesKimlikleri(T2b, [T2a, T2b, T1]), ['1:23531']);
    assert.deepEqual(kardesKimlikleri(T1, [T2a, T2b, T1]), []);
  });
});

describe('desenleriBirlestir', () => {
  const k = (trip: string, saat: number) => ({ trip: { gtfsId: trip }, serviceDay: 0, scheduledDeparture: saat });
  it('aynı kodlu desenleri birleştirir, aynı kalkışı bir kez yazar, sıralar', () => {
    const sonuc = desenleriBirlestir([
      { pattern: { code: '1:23813:0:01' }, stoptimes: [k('a', 600), k('b', 1800)] },
      { pattern: { code: '1:5:0:01' }, stoptimes: [k('x', 100)] },
      { pattern: { code: '1:23813:0:01' }, stoptimes: [k('a', 600), k('a', 1200)] },
    ]);
    assert.equal(sonuc.length, 2);
    assert.deepEqual(
      sonuc[0].stoptimes!.map((x) => `${x.trip.gtfsId}${x.scheduledDeparture}`),
      ['a600', 'a1200', 'b1800'],
    );
  });

  it('girdiyi değiştirmez', () => {
    const girdi = [
      { pattern: { code: 'p' }, stoptimes: [k('a', 1)] },
      { pattern: { code: 'p' }, stoptimes: [k('b', 2)] },
    ];
    desenleriBirlestir(girdi);
    assert.equal(girdi[0].stoptimes.length, 1);
  });
});
