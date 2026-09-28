// Vasıta türü tercihlerinin testleri: tür tanıma, OTP isteksizliği ve liste sırası.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rotalariSirala } from '../rota-secimi.ts';
import { aramalariYap } from '../sorgular.ts';
import {
  bacakTuru,
  KAPALI_ISTEKSIZLIK,
  kapaliTurleriDuzelt,
  kapaliTurleriGeriAl,
  kapaliTurKullaniyor,
  kipCarpani,
  turuDegistir,
  VASITA_TURLERI,
} from '../vasita.ts';

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

describe('OTP isteksizliği', () => {
  it('kapalı türün kipi pahalanır, öbürleri değişmez', () => {
    assert.equal(kipCarpani('FERRY', ['vapur']), KAPALI_ISTEKSIZLIK);
    assert.equal(kipCarpani('SUBWAY', ['vapur']), 1);
    assert.equal(kipCarpani('GONDOLA', ['funikuler']), KAPALI_ISTEKSIZLIK);
  });

  it('otobüs kipi, Metrobüs açıkken yarım ceza alır; üçü kapalıysa tam', () => {
    assert.ok(kipCarpani('BUS', ['otobus']) > 1 && kipCarpani('BUS', ['otobus']) < KAPALI_ISTEKSIZLIK);
    assert.equal(kipCarpani('BUS', ['metrobus']), 1);
    assert.equal(kipCarpani('BUS', ['otobus', 'metrobus', 'minibus']), KAPALI_ISTEKSIZLIK);
  });

  it('aramalara işlenir; kapalı tür yoksa sunucunun varsayılanı kalır', () => {
    assert.deepEqual(aramalariYap({ tercih: 'hizli', erisilebilir: false, kapali: [] }), [
      { tercihler: null, modlar: null },
    ]);
    const [a] = aramalariYap({ tercih: 'hizli', erisilebilir: false, kapali: ['vapur'] });
    const kipler = (a.modlar as any).transit.transit as { mode: string; cost: { reluctance: number } }[];
    assert.equal(kipler.find((k) => k.mode === 'FERRY')!.cost.reluctance, KAPALI_ISTEKSIZLIK);
    assert.equal(kipler.find((k) => k.mode === 'SUBWAY')!.cost.reluctance, 1);
    const d = aramalariYap({ tercih: 'dengeli', erisilebilir: false, kapali: ['vapur'] });
    assert.ok(d.every((x) => x.modlar), 'önerilenin üç aramasında da vapur pahalı');
  });
});

describe('liste sırası', () => {
  const vapurlu = rota('vapur', 35, bacak('FERRY', 20, 'KDK-EMN', 'Şehirhatları A.Ş.'));
  const metrolu = rota('metro', 42, bacak('SUBWAY', 25, 'M4'), bacak('RAIL', 10, 'Marmaray'));
  const uzun = rota('uzun', 95, bacak('BUS', 80, '500T'));

  it('kapalı türü kullanan rota makul seçeneğin arkasına geçer', () => {
    const sonuc = kapaliTurleriGeriAl([vapurlu, metrolu], ['vapur']);
    assert.deepEqual(sonuc.map((r) => r.start), ['metro', 'vapur']);
    assert.ok(kapaliTurKullaniyor(vapurlu, ['vapur']));
  });

  it('makul olmayan (çok uzun) seçenek kapalı türlünün önüne geçmez', () => {
    const sonuc = kapaliTurleriGeriAl([vapurlu, uzun], ['vapur']);
    assert.deepEqual(sonuc.map((r) => r.start), ['vapur', 'uzun']);
  });

  it('bütün rotalar kapalı türü kullanıyorsa sıra değişmez (adalara vapursuz yol yok)', () => {
    const ikinci = rota('vapur2', 50, bacak('FERRY', 40, 'ADALAR', 'Turyol'));
    assert.deepEqual(kapaliTurleriGeriAl([vapurlu, ikinci], ['vapur']).map((r) => r.start), ['vapur', 'vapur2']);
  });

  it('tercih sıralamasıyla birlikte çalışır', () => {
    const sonuc = rotalariSirala([vapurlu, metrolu], 'hizli', ['vapur']);
    assert.deepEqual(sonuc.map((r) => r.start), ['metro', 'vapur']);
    assert.deepEqual(rotalariSirala([vapurlu, metrolu], 'hizli').map((r) => r.start), ['vapur', 'metro']);
  });
});
