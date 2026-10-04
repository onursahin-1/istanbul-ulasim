// Vasıta türü tercihlerinin testleri: tür tanıma, OTP isteksizliği ve liste sırası.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rotalariSirala } from '../rota-secimi.ts';
import { aramalariYap } from '../sorgular.ts';
import {
  bacakTuru,
  trafiksizSuzgec,
  kapaliTurleriAyikla,
  kapaliTurleriDuzelt,
  kapaliTurKullaniyor,
  kipAcikMi,
  minibussuzSuzgec,
  turuDegistir,
  vasitaSuzgeci,
  VASITA_TURLERI,
} from '../vasita.ts';
import { MINIBUS_BACAK_CEZASI, oneriPuani } from '../rota-secimi.ts';

const bacak = (mode: string, dk: number, kisaAd = 'H', isletmeci = 'İETT') => ({
  mode,
  transitLeg: mode !== 'WALK',
  duration: dk * 60,
  route: mode === 'WALK' ? null : { gtfsId: `1:${kisaAd}`, shortName: kisaAd, agency: { name: isletmeci } },
  from: { stop: { gtfsId: `d-${kisaAd}` }, name: kisaAd },
});
const rota = (start: string, dk: number, ...legs: ReturnType<typeof bacak>[]) => ({
  start,
  duration: dk * 60,
  walkTime: 300,
  numberOfTransfers: Math.max(0, legs.filter((b) => b.transitLeg).length - 1),
  legs,
});

describe('bacakTuru', () => {
  it('araç kipinden türü bulur', () => {
    assert.equal(bacakTuru(bacak('SUBWAY', 10, 'M2')), 'metro');
    assert.equal(bacakTuru(bacak('RAIL', 10, 'Marmaray')), 'marmaray');
    assert.equal(bacakTuru(bacak('TRAM', 10, 'T1')), 'tramvay');
    assert.equal(bacakTuru(bacak('FUNICULAR', 3, 'F1')), 'funikuler');
    assert.equal(bacakTuru(bacak('GONDOLA', 3, 'TF2')), 'funikuler');
    assert.equal(bacakTuru(bacak('FERRY', 20, 'KDK-EMN', 'Şehirhatları A.Ş.')), 'vapur');
    assert.equal(bacakTuru(bacak('WALK', 5)), null);
  });

  it('otobüs kipini Metrobüs, minibüs ve otobüs diye ayırır', () => {
    assert.equal(bacakTuru(bacak('BUS', 30, '34AS')), 'metrobus');
    assert.equal(bacakTuru(bacak('BUS', 30, '500T')), 'otobus');
    assert.equal(bacakTuru(bacak('BUS', 30, 'KADIKÖY-BOSTANCI', 'Minibus')), 'minibus');
    assert.equal(bacakTuru(bacak('BUS', 30, 'TAKSİM-BEŞİKTAŞ', 'Taksi Dolmuş')), 'minibus');
  });
});

describe('kapalı tür listesi', () => {
  it('diskten gelen bozuk kayıtları temizler', () => {
    assert.deepEqual(kapaliTurleriDuzelt(['vapur', 'x', 'metro']), ['metro', 'vapur']);
    assert.deepEqual(kapaliTurleriDuzelt(null), []);
    assert.deepEqual(kapaliTurleriDuzelt(VASITA_TURLERI), [], 'hepsi kapalı olamaz');
  });

  it('son açık tür kapatılamaz', () => {
    const hepsiEksikBir = VASITA_TURLERI.filter((t) => t !== 'metro');
    assert.deepEqual(turuDegistir(hepsiEksikBir, 'metro', false), hepsiEksikBir);
    assert.deepEqual(turuDegistir(['vapur'], 'otobus', false), ['otobus', 'vapur']);
    assert.deepEqual(turuDegistir(['otobus', 'vapur'], 'vapur', true), ['otobus']);
  });
});

const hat = (gtfsId: string, kisaAd: string, mode: string, isletme: string, isletmeAdi: string) => ({
  gtfsId,
  shortName: kisaAd,
  mode,
  agency: { gtfsId: isletme, name: isletmeAdi },
});
const HATLAR = [
  hat('1:500T', '500T', 'BUS', '1:1', 'IETT'),
  hat('1:15F', '15F', 'BUS', '1:1', 'IETT'),
  hat('1:34', '34', 'BUS', '1:1', 'IETT'),
  hat('2:M1', 'M1', 'SUBWAY', '2:11', 'Metro İstanbul'),
  hat('2:MB1', 'KADIKÖY-BOSTANCI', 'BUS', '2:37', 'Minibus'),
  hat('2:TD1', 'TAKSİM-BEŞİKTAŞ', 'BUS', '2:19', 'Taksi Dolmus'),
];

describe('rota motoru süzgeci', () => {
  it('kapalı türün kipi aramaya girmez; otobüs kipi üç türü de kapanınca çıkar', () => {
    assert.equal(kipAcikMi('FERRY', ['vapur']), false);
    assert.equal(kipAcikMi('SUBWAY', ['vapur']), true);
    assert.equal(kipAcikMi('GONDOLA', ['funikuler']), false);
    assert.equal(kipAcikMi('BUS', ['minibus']), true);
    assert.equal(kipAcikMi('BUS', ['otobus', 'metrobus', 'minibus']), false);
  });

  it('minibüs kapalıysa minibüs ve dolmuş işletmecileri dışarıda', () => {
    assert.deepEqual(vasitaSuzgeci(['minibus'], HATLAR), [{ exclude: [{ agencies: ['2:37', '2:19'] }] }]);
  });

  it('Metrobüs kapalıysa yalnız Metrobüs hatları dışarıda', () => {
    assert.deepEqual(vasitaSuzgeci(['metrobus'], HATLAR), [{ exclude: [{ routes: ['1:34'] }] }]);
  });

  it('otobüs kapalı, Metrobüs açıksa İETT yerine izin verilenler listelenir', () => {
    const [s] = vasitaSuzgeci(['otobus'], HATLAR)!;
    assert.deepEqual(s.include, [{ agencies: ['2:11', '2:37', '2:19'] }, { routes: ['1:34'] }]);
    assert.equal(s.exclude, undefined);
  });

  it('yalnız kip düzeyinde türler kapalıysa süzgeç gerekmez', () => {
    assert.equal(vasitaSuzgeci(['vapur', 'metro'], HATLAR), null);
    assert.equal(vasitaSuzgeci([], HATLAR), null);
  });

  it('minibüssüz süzgeç', () => {
    assert.deepEqual(minibussuzSuzgec(HATLAR), [{ exclude: [{ agencies: ['2:37', '2:19'] }] }]);
  });

  it('aramalara işlenir; kapalı tür yoksa sunucunun varsayılanı kalır', () => {
    assert.deepEqual(aramalariYap({ tercih: 'hizli', erisilebilir: false, kapali: [] }), [
      { tercihler: { transit: { transfer: { cost: 300, maximumTransfers: 2 } } }, modlar: null },
    ]);
    const suzgecler = { kapali: vasitaSuzgeci(['minibus', 'vapur'], HATLAR), minibussuz: minibussuzSuzgec(HATLAR) };
    const aramalar = aramalariYap({ tercih: 'dengeli', erisilebilir: false, kapali: ['minibus', 'vapur'] }, suzgecler);
    for (const a of aramalar) {
      const kipler = (a.modlar as any).transit.transit.map((k: any) => k.mode);
      assert.ok(!kipler.includes('FERRY'), 'vapur kipi aramada olmamalı');
      assert.deepEqual((a.tercihler as any).transit.filters[0], { exclude: [{ agencies: ['2:37', '2:19'] }] });
    }
  });

  it('minibüs açıkken önerilen aramaların ikisi minibüssüz', () => {
    const suzgecler = { kapali: null, minibussuz: minibussuzSuzgec(HATLAR) };
    const aramalar = aramalariYap({ tercih: 'dengeli', erisilebilir: false, kapali: [] }, suzgecler);
    const minibussuz = aramalar.filter((a) => (a.tercihler as any)?.transit?.filters);
    assert.equal(aramalar.length, 3);
    assert.equal(minibussuz.length, 2);
  });
});

describe('liste', () => {
  const vapurlu = rota('vapur', 35, bacak('FERRY', 20, 'KDK-EMN', 'Şehirhatları A.Ş.'));
  const metrolu = rota('metro', 42, bacak('SUBWAY', 25, 'M4'), bacak('RAIL', 10, 'Marmaray'));

  it('kapalı türü kullanan rota listede hiç yer almaz', () => {
    assert.deepEqual(kapaliTurleriAyikla([vapurlu, metrolu], ['vapur']).map((r) => r.start), ['metro']);
    assert.ok(kapaliTurKullaniyor(vapurlu, ['vapur']));
    assert.deepEqual(rotalariSirala([vapurlu, metrolu], 'hizli', ['vapur']).map((r) => r.start), ['metro']);
    assert.deepEqual(rotalariSirala([vapurlu, metrolu], 'hizli').map((r) => r.start), ['vapur', 'metro']);
  });

  it('önerilen sıralamada minibüs geride kalır', () => {
    const minibuslu = rota('minibus', 30, bacak('BUS', 25, 'KADIKÖY-BOSTANCI', 'Minibus'));
    const otobuslu = rota('otobus', 36, bacak('BUS', 30, '16D'));
    assert.ok(oneriPuani(minibuslu) > oneriPuani(otobuslu), 'altı dakika kısa minibüs, otobüsün önüne geçmemeli');
    assert.ok(MINIBUS_BACAK_CEZASI >= 300);
    assert.deepEqual(rotalariSirala([minibuslu, otobuslu], 'dengeli').map((r) => r.start), ['otobus', 'minibus']);
  });
});

describe('trafiksiz arama', () => {
  it('yalnız metro, Marmaray, tramvay, vapur ve Metrobüs hatları; kapalı türler dışarıda', () => {
    assert.deepEqual(trafiksizSuzgec([], HATLAR), [{ include: [{ routes: ['1:34', '2:M1'] }] }]);
    assert.deepEqual(trafiksizSuzgec(['metrobus'], HATLAR), [{ include: [{ routes: ['2:M1'] }] }]);
    assert.equal(trafiksizSuzgec(['metrobus', 'metro'], HATLAR), null);
  });

  it('her tercihte aramalara eklenir', () => {
    const suzgecler = { kapali: null, minibussuz: null, trafiksiz: trafiksizSuzgec([], HATLAR) };
    for (const tercih of ['dengeli', 'rayli', 'hizli', 'azYurume', 'azAktarma'] as const) {
      const a = aramalariYap({ tercih, erisilebilir: false, kapali: [] }, suzgecler);
      const son = a[a.length - 1].tercihler as any;
      assert.deepEqual(son.transit.filters, [{ include: [{ routes: ['1:34', '2:M1'] }] }], tercih);
    }
  });
});
