// Özel günlerde tarife ve ücretsizlik.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import gercekVeri from '../../../assets/veri/ozel-gunler.json' with { type: 'json' };
import { hatUcretsizMi, istanbulTarihi, ozelGunBul, ozelGunNotu, type OzelGun } from '../ozel-gunler.ts';

const cumhuriyet: OzelGun = { tarih: '2026-10-29', ad: 'Cumhuriyet Bayramı', tarife: 'pazar', ucretsiz: { ibb: true, tcdd: true } };
const temmuz: OzelGun = { tarih: '2027-07-15', ad: 'Demokrasi ve Millî Birlik Günü', tarife: 'pazar', ucretsiz: { ibb: false, tcdd: true } };
const GUNLER = [cumhuriyet, temmuz];

const hat = (shortName: string, agency: string, mode = 'BUS', longName = '') => ({ shortName, longName, mode, agency: { name: agency } });

describe('ozelGunBul', () => {
  it('İstanbul tarihine göre bulur (UTC gece yarısı kayması yok)', () => {
    assert.equal(istanbulTarihi(Date.parse('2026-10-28T22:30:00Z')), '2026-10-29');
    assert.equal(ozelGunBul(GUNLER, Date.parse('2026-10-29T00:30:00+03:00'))?.ad, 'Cumhuriyet Bayramı');
    assert.equal(ozelGunBul(GUNLER, Date.parse('2026-10-28T23:59:00+03:00')), null);
    assert.equal(ozelGunBul(GUNLER, NaN), null);
  });
});

describe('hatUcretsizMi', () => {
  it('İBB hatları ve TCDD millî bayramda ücretsiz', () => {
    assert.equal(hatUcretsizMi(hat('500T', 'IETT'), cumhuriyet), 'ibb');
    assert.equal(hatUcretsizMi(hat('M4', 'Metro İstanbul', 'SUBWAY'), cumhuriyet), 'ibb');
    assert.equal(hatUcretsizMi(hat('KDK-EMN', 'Şehirhatları A.Ş.', 'FERRY'), cumhuriyet), 'ibb');
    assert.equal(hatUcretsizMi(hat('Marmaray', 'TCDD', 'RAIL'), cumhuriyet), 'tcdd');
    assert.equal(hatUcretsizMi(hat('M11', 'TCDD Taşımacılık', 'SUBWAY'), cumhuriyet), 'tcdd');
  });

  it('minibüs, dolmuş, özel vapur ve hariç tutulan İETT hatları ücretli', () => {
    assert.equal(hatUcretsizMi(hat('X', 'Minibus'), cumhuriyet), null);
    assert.equal(hatUcretsizMi(hat('KBT-KDK', 'Dentur Avrasya', 'FERRY'), cumhuriyet), null);
    assert.equal(hatUcretsizMi(hat('T2', 'IETT', 'TRAM'), cumhuriyet), null);
    assert.equal(hatUcretsizMi(hat('139A', 'IETT'), cumhuriyet), null);
    assert.equal(hatUcretsizMi(hat('SG-2', 'IETT'), cumhuriyet), null);
    assert.equal(hatUcretsizMi(hat('ADA1', 'IETT', 'BUS', 'BÜYÜKADA-NİZAM'), cumhuriyet), null);
  });

  it('15 Temmuz\'da yalnız TCDD; olağan günde hiçbiri', () => {
    assert.equal(hatUcretsizMi(hat('500T', 'IETT'), temmuz), null);
    assert.equal(hatUcretsizMi(hat('Marmaray', 'TCDD', 'RAIL'), temmuz), 'tcdd');
    assert.equal(hatUcretsizMi(hat('500T', 'IETT'), null), null);
  });

  it('notu yazar', () => {
    assert.match(ozelGunNotu(cumhuriyet), /^Cumhuriyet Bayramı: toplu taşıma pazar tarifesiyle çalışır\. İETT/);
    assert.equal(ozelGunNotu(temmuz), 'Demokrasi ve Millî Birlik Günü: toplu taşıma pazar tarifesiyle çalışır. Marmaray, T6 ve M11 ücretsiz.');
  });
});

describe('gerçek veri (assets/veri/ozel-gunler.json)', () => {
  const gunler = (gercekVeri as { gunler: OzelGun[] }).gunler;
  it('tarihler geçerli, sıralı ve tekrarsız; tarife pazar ya da cumartesi', () => {
    const tarihler = gunler.map((g) => g.tarih);
    assert.deepEqual([...tarihler].sort(), tarihler);
    assert.equal(new Set(tarihler).size, tarihler.length);
    for (const g of gunler) {
      assert.ok(!Number.isNaN(Date.parse(`${g.tarih}T12:00:00+03:00`)), g.tarih);
      assert.ok(g.tarife === 'pazar' || g.tarife === 'cumartesi', g.tarih);
    }
  });
  it('29 Ekim 2026 listede', () => {
    assert.equal(gunler.find((g) => g.tarih === '2026-10-29')?.ucretsiz.ibb, true);
  });
});
