// Canlı kalkış sınıflandırmasının testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bacakCanli, canliBilgi, kalkisCanli } from '../canli';

describe('canliBilgi', () => {
  it('bir dakikanın altındaki sapmayı zamanında sayar', () => {
    for (const sn of [0, 29, -29, 40, -40]) {
      const b = canliBilgi(sn);
      assert.equal(b.sinif, 'zamaninda', `${sn} sn`);
      assert.equal(b.metin, 'zamanında');
    }
  });

  it('1–4 dk geç', () => {
    assert.deepEqual([canliBilgi(180).sinif, canliBilgi(180).metin], ['gec', '3 dk gecikmeli']);
    assert.equal(canliBilgi(4 * 60 + 20).sinif, 'gec');
  });

  it('5 dk ve üstü çok geç', () => {
    assert.equal(canliBilgi(5 * 60).sinif, 'cokGec');
    assert.equal(canliBilgi(4 * 60 + 40).sinif, 'cokGec', '4 dk 40 sn → 5 dk');
    assert.equal(canliBilgi(12 * 60).metin, '12 dk gecikmeli');
  });

  it('erken', () => {
    const b = canliBilgi(-70);
    assert.deepEqual([b.sinif, b.metin, b.dakika], ['erken', '1 dk erken', -1]);
  });
});

describe('kalkisCanli', () => {
  it('canlı kalkışın gecikmesini planlı ile canlı saatin farkından çıkarır', () => {
    const b = kalkisCanli({ realtime: true, scheduledDeparture: 27720, realtimeDeparture: 27900 });
    assert.equal(b?.metin, '3 dk gecikmeli');
  });

  it('canlı olmayan kalkışa "zamanında" demez', () => {
    // OTP canlı verisi olmayan kalkışta realtimeDeparture'ı planlıya eşit veriyor.
    assert.equal(kalkisCanli({ realtime: false, scheduledDeparture: 100, realtimeDeparture: 100 }), null);
    assert.equal(kalkisCanli({ realtime: null, scheduledDeparture: 100, realtimeDeparture: 100 }), null);
  });

  it('eksik saatte null döner', () => {
    assert.equal(kalkisCanli({ realtime: true, scheduledDeparture: null, realtimeDeparture: 100 }), null);
    assert.equal(kalkisCanli(null), null);
  });
});

describe('bacakCanli', () => {
  it('ISO saatlerden gecikmeyi hesaplar', () => {
    const b = bacakCanli('2026-09-23T07:42:00+03:00', '2026-09-23T07:45:00+03:00');
    assert.equal(b?.metin, '3 dk gecikmeli');
  });

  it('tahmini saat yoksa canlı değildir', () => {
    assert.equal(bacakCanli('2026-09-23T07:42:00+03:00', null), null);
    assert.equal(bacakCanli('2026-09-23T07:42:00+03:00', undefined), null);
  });

  it('bozuk saatte null döner', () => {
    assert.equal(bacakCanli('saçma', '2026-09-23T07:45:00+03:00'), null);
  });
});
