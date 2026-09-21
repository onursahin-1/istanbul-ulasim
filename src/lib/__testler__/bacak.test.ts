// Bacak durak listesi ve rota tercihlerinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bacakDuraklari } from '../bacak';
import type { Bacak } from '../otp';
import { tercihleriYap } from '../sorgular';

const nokta = (id: string, i: number) => ({ gtfsId: id, name: id, lat: 41 + i / 1000, lon: 29 + i / 1000 });

function bacak(desen: string[], binis: string, inis: string): Bacak {
  return {
    transitLeg: true,
    from: { name: binis, lat: 41, lon: 29, stop: { gtfsId: binis } },
    to: { name: inis, lat: 41.1, lon: 29.1, stop: { gtfsId: inis } },
    trip: { gtfsId: 't', pattern: { stops: desen.map(nokta) } },
  } as unknown as Bacak;
}

describe('bacakDuraklari', () => {
  it('biniş ve iniş arasındaki durakları sırasıyla verir', () => {
    const b = bacak(['a', 'b', 'c', 'd', 'e'], 'b', 'd');
    assert.deepEqual(
      bacakDuraklari(b).map((d) => d.gtfsId),
      ['b', 'c', 'd'],
    );
  });

  it('ring hatta aynı durağın ikinci geçişini iniş sayar', () => {
    // Ring: a → b → c → a. "a"dan binip yine "a"da inmek ring turu demektir.
    const b = bacak(['a', 'b', 'c', 'a'], 'a', 'a');
    assert.deepEqual(
      bacakDuraklari(b).map((d) => d.gtfsId),
      ['a', 'b', 'c'],
      'iniş durağı biniş durağından sonra aranmalı',
    );
  });

  it('desen yoksa en azından biniş ve inişi verir', () => {
    const b = {
      transitLeg: true,
      from: { name: 'A', lat: 41, lon: 29, stop: { gtfsId: 'a' } },
      to: { name: 'B', lat: 41.1, lon: 29.1, stop: { gtfsId: 'b' } },
      trip: null,
    } as unknown as Bacak;
    assert.deepEqual(
      bacakDuraklari(b).map((d) => d.gtfsId),
      ['a', 'b'],
    );
  });

  it('aynı durağı iki kez listelemez', () => {
    const b = bacak(['a', 'b'], 'a', 'b');
    assert.equal(bacakDuraklari(b).length, 2);
  });
});

describe('tercihleriYap', () => {
  it('dengeli tercihte sunucuya hiçbir şey göndermez', () => {
    assert.equal(tercihleriYap({ tercih: 'dengeli', erisilebilir: false }), null);
  });

  it('az yürüme tercihinde yürüme isteksizliğini yükseltir', () => {
    const t = tercihleriYap({ tercih: 'azYurume', erisilebilir: false }) as Record<string, any>;
    assert.ok(t.street.walk.reluctance > 2, 'OTP varsayılanı 2.0; bundan yüksek olmalı');
    assert.equal('transit' in t, false);
  });

  it('az aktarma tercihinde aktarma bedeli koyar', () => {
    const t = tercihleriYap({ tercih: 'azAktarma', erisilebilir: false }) as Record<string, any>;
    assert.ok(t.transit.transfer.cost > 0);
    assert.equal('street' in t, false);
  });

  it('erişilebilirlik diğer tercihlerle birlikte gönderilebilir', () => {
    const t = tercihleriYap({ tercih: 'azYurume', erisilebilir: true }) as Record<string, any>;
    assert.equal(t.accessibility.wheelchair.enabled, true);
    assert.ok(t.street.walk.reluctance > 2);
  });
});
