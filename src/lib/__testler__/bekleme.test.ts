// Bekleme seçenekleri, binilen hat ve durak saatleri (bekleme.ts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ayniYoldanMi, beklemeSecenekleri, binilenHatTahmini, durakOranlari, durakSaatleri, paylasimMetni } from '../bekleme';
import type { DurakKalkisi } from '../otp';

const dk = 60_000;
const T = 1_800_000_000_000;

function kalkis(kisaAd: string, dakika: number, ek: Partial<DurakKalkisi> = {}): DurakKalkisi {
  return {
    an: T + dakika * dk,
    serviceDay: 0,
    saniye: 0,
    canli: false,
    seferId: `${kisaAd}-${dakika}`,
    hatId: `r-${kisaAd}`,
    kisaAd,
    uzunAd: `${kisaAd} uzun ad`,
    mode: 'BUS',
    isletmeci: 'IETT',
    yon: null,
    ...ek,
  };
}

const LISTE = [
  kalkis('141M', 11),
  kalkis('97M', 4, { canli: true }),
  kalkis('34', 2),
  kalkis('97M', 18),
  kalkis('97M', 31),
  kalkis('97M', 44),
  kalkis('141M', 26),
  kalkis('97M', -3),
];

describe('beklemeSecenekleri', () => {
  it('her hat kendi satırında, ilk kalkana göre sıralı; başka hatlar ve geçmiş kalkışlar yok', () => {
    const s = beklemeSecenekleri(LISTE, ['97M', '141M'], T);
    assert.deepEqual(
      s.map((x) => [x.kisaAd, x.kalkislar.map((k) => (k.an - T) / dk)]),
      [
        ['97M', [4, 18, 31]],
        ['141M', [11, 26]],
      ],
    );
    assert.equal(s[0].kalkislar[0].canli, true);
    assert.equal(s[0].ad, '97M uzun ad');
  });

  it('planlanan hatta yalnız aynı desen (kısa servis seferi yok); kalkışı olmayan hat sona', () => {
    const liste = [kalkis('97M', 3, { desen: 'kisa' }), kalkis('97M', 9, { desen: 'p1' }), kalkis('141M', 5)];
    const s = beklemeSecenekleri(liste, ['97M', '141M', '41E'], T, { desen: 'p1', yon: 'Mecidiyeköy' });
    assert.deepEqual(
      s.map((x) => [x.kisaAd, x.kalkislar.map((k) => (k.an - T) / dk)]),
      [
        ['141M', [5]],
        ['97M', [9]],
        ['41E', []],
      ],
    );
  });
});

describe('ayniYoldanMi', () => {
  it('aynı hattın başka güzergâh kaydı (başka desen) aynı yöne gidiyorsa aynı yol; kısa servis değil', () => {
    const hat = { kisaAd: '141M', desen: 'p1', yon: 'Mecidiyeköy Metrobüs' };
    assert.equal(ayniYoldanMi(kalkis('141M', 3, { desen: 'p1' }), hat), true);
    assert.equal(ayniYoldanMi(kalkis('141M', 3, { desen: 'p7', yon: 'MECİDİYEKÖY METROBÜS ' }), hat), true);
    assert.equal(ayniYoldanMi(kalkis('141M', 3, { desen: 'p9', yon: 'Mahmutbey' }), hat), false);
    assert.equal(ayniYoldanMi(kalkis('97M', 3, { desen: 'p1' }), hat), false);
  });
});

describe('binilenHatTahmini', () => {
  it('biniş anına en yakın kalkış; 5 dk içinde yoksa bilinmez', () => {
    assert.deepEqual(binilenHatTahmini(LISTE, ['97M', '141M'], T + 10 * dk), { kisaAd: '141M', seferId: '141M-11' });
    assert.equal(binilenHatTahmini(LISTE, ['97M', '141M'], T + 70 * dk), null);
  });
});

describe('durakOranlari / durakSaatleri', () => {
  const n = (e: number, id: string) => ({ latitude: 41 + e, longitude: 29, gtfsId: id });
  // 4 durak, eşit aralıklı (mesafe), ama tarifede ilk ara uzun (trafik).
  const DURAKLAR = [n(0, 'a'), n(0.003, 'b'), n(0.006, 'c'), n(0.009, 'd')];

  it('tarife yoksa mesafeden', () => {
    assert.deepEqual(durakOranlari(DURAKLAR).map((x) => Math.round(x * 100) / 100), [0, 0.33, 0.67, 1]);
  });

  it('tarife varsa saatlerden; bilinmeyen ara durak mesafeyle', () => {
    const saatler = new Map([
      ['a', 1000],
      ['b', 1600],
      ['d', 1900],
    ]);
    assert.deepEqual(durakOranlari(DURAKLAR, saatler).map((x) => Math.round(x * 100) / 100), [0, 0.67, 0.83, 1]);
  });

  it('plan: biniş ile iniş arası oranlara göre', () => {
    const s = durakSaatleri([0, 0.5, 1], T, T + 20 * dk);
    assert.deepEqual(s.map((x) => (x - T) / dk), [0, 10, 20]);
  });

  it('araçta geride kalınca sıradaki duraklar ve iniş kayar; geçilenler kaymaz', () => {
    // 14. dakikada hâlâ 1. durağa yeni varıldı (plan 10): 4 dk gecikme.
    const s = durakSaatleri([0, 0.5, 1], T, T + 20 * dk, 1, T + 14 * dk);
    assert.deepEqual(s.map((x) => (x - T) / dk), [0, 10, 24]);
    // Önde gidiyorsa öne çekilmez.
    const o = durakSaatleri([0, 0.5, 1], T, T + 20 * dk, 1.5, T + 12 * dk);
    assert.deepEqual(o.map((x) => (x - T) / dk), [0, 10, 20]);
  });
});

describe('paylasimMetni', () => {
  it('varış, hedef ve hatlar', () => {
    assert.equal(paylasimMetni('Seyrantepe', '10:05', ['97M', '500L', '27SE']), 'Tahmini varışım 10:05 · Seyrantepe (97M → 500L → 27SE)');
    assert.equal(paylasimMetni(null, '10:05', []), 'Tahmini varışım 10:05');
  });
});
