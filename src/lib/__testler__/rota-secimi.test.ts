import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oneriPuani, otobusSuresi, rotalariBirlestir, rotalariSirala, rotaImzasi, yurumeSiniri } from '../rota-secimi.ts';
import { aramalariYap, EN_COK_YURUME_SN, secenekleriDuzelt } from '../sorgular.ts';

const bacak = (mode: string, dk: number, hat = 'H') => ({
  mode,
  transitLeg: mode !== 'WALK',
  duration: dk * 60,
  route: mode === 'WALK' ? null : { gtfsId: `1:${hat}`, shortName: hat },
  from: { stop: { gtfsId: `d-${hat}` }, name: hat },
});
const rota = (start: string, dk: number, yuruDk: number, aktarma: number, ...legs: ReturnType<typeof bacak>[]) => ({
  start,
  duration: dk * 60,
  walkTime: yuruDk * 60,
  numberOfTransfers: aktarma,
  legs,
});

describe('rotalariBirlestir', () => {
  it('aynı kalkış ve aynı hatlar tekrar etmez, sıra korunur', () => {
    const a = rota('10:00', 30, 5, 0, bacak('BUS', 25, '500T'));
    const b = rota('10:05', 32, 8, 0, bacak('SUBWAY', 24, 'M2'));
    const aKopya = { ...a };
    const sonuc = rotalariBirlestir([[a, b], [aKopya, rota('10:10', 30, 5, 0, bacak('BUS', 25, '500T'))]]);
    assert.equal(sonuc.length, 3);
    assert.equal(rotaImzasi(sonuc[0]), rotaImzasi(a));
  });
});

describe('yurumeSiniri', () => {
  it('20 dakikadan çok yürütenleri atar', () => {
    const { rotalar, asildi } = yurumeSiniri([rota('a', 30, 10, 0), rota('b', 25, 21, 0), rota('c', 40, 20, 1)]);
    assert.deepEqual(rotalar.map((r) => r.start), ['a', 'c']);
    assert.equal(asildi, false);
    assert.equal(EN_COK_YURUME_SN, 1200);
  });

  it('hepsi aşıyorsa en az yürüyenleri (5 dk içinde) işaretleyip bırakır', () => {
    const { rotalar, asildi } = yurumeSiniri([rota('a', 30, 35, 0), rota('b', 25, 24, 0), rota('c', 40, 28, 1)]);
    assert.deepEqual(rotalar.map((r) => r.start), ['b', 'c']);
    assert.equal(asildi, true);
  });

  it('boş liste boş kalır', () => {
    assert.deepEqual(yurumeSiniri([]), { rotalar: [], asildi: false });
  });
});

describe('rotalariSirala', () => {
  const otobuslu = rota('1', 40, 5, 0, bacak('BUS', 35, '500T'));
  const metrolu = rota('2', 42, 8, 0, bacak('SUBWAY', 32, 'M2'));
  const cokYuruyen = rota('3', 38, 18, 0, bacak('BUS', 20, '34G'));
  const aktarmali = rota('4', 36, 6, 1, bacak('BUS', 12, '15F'), bacak('BUS', 16, '34G'));

  it('önerilen: süre yakınken trafiğe bağlı olmayanı öne alır', () => {
    assert.ok(oneriPuani(metrolu) < oneriPuani(otobuslu));
    assert.equal(rotalariSirala([otobuslu, metrolu], 'dengeli')[0].start, '2');
  });

  it('en hızlı yalnız süreye bakar', () => {
    assert.deepEqual(rotalariSirala([otobuslu, metrolu, cokYuruyen], 'hizli').map((r) => r.start), ['3', '1', '2']);
  });

  it('az yürüme, az aktarma, raylı', () => {
    assert.equal(rotalariSirala([cokYuruyen, metrolu, otobuslu], 'azYurume')[0].start, '1');
    assert.equal(rotalariSirala([aktarmali, otobuslu], 'azAktarma')[0].start, '1');
    assert.equal(rotalariSirala([otobuslu, aktarmali], 'hizli')[0].start, '4');
    assert.equal(rotalariSirala([otobuslu, cokYuruyen, metrolu], 'rayli')[0].start, '2');
    assert.equal(otobusSuresi(metrolu), 0);
  });
});

describe('aramalariYap', () => {
  it('önerilen iki arama: biri otobüsü hafifçe pahalı sayar', () => {
    const a = aramalariYap({ tercih: 'dengeli', erisilebilir: false });
    assert.equal(a.length, 2);
    const kipler = (a[0].modlar as any).transit.transit as { mode: string; cost: { reluctance: number } }[];
    assert.ok(kipler.find((k) => k.mode === 'BUS')!.cost.reluctance > 1);
    assert.equal(kipler.find((k) => k.mode === 'SUBWAY')!.cost.reluctance, 1);
    assert.ok(kipler.some((k) => k.mode === 'FERRY'), 'listede olmayan kip tamamen yasaklanır; vapur listede olmalı');
    assert.equal(a[1].modlar, null);
  });

  it('en hızlı sunucuya bir şey göndermez; raylıda otobüs güçlü biçimde pahalı', () => {
    assert.deepEqual(aramalariYap({ tercih: 'hizli', erisilebilir: false }), [{ tercihler: null, modlar: null }]);
    const r = aramalariYap({ tercih: 'rayli', erisilebilir: false });
    const bus = (r[0].modlar as any).transit.transit.find((k: any) => k.mode === 'BUS');
    assert.ok(bus.cost.reluctance >= 2);
  });
});

describe('secenekleriDuzelt', () => {
  it('bilinmeyen ya da bozuk kayıt varsayılana döner', () => {
    assert.deepEqual(secenekleriDuzelt({ tercih: 'eski' as any, erisilebilir: true }), { tercih: 'dengeli', erisilebilir: true });
    assert.deepEqual(secenekleriDuzelt(null), { tercih: 'dengeli', erisilebilir: false });
    assert.deepEqual(secenekleriDuzelt({ tercih: 'rayli', erisilebilir: false }), { tercih: 'rayli', erisilebilir: false });
  });
});
