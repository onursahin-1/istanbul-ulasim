import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { hatGrubu, hatlariTekille, kardesKimlikleri } from '../hat-tekil.ts';

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
