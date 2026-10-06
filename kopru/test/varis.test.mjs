// Araç tabanlı varış tahmini (varis.mjs).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AracVarislari, yoldakiYer } from '../varis.mjs';

// Doğu-batı cadde, 6 durak ~500 m arayla. Rota 0 batıdan doğuya, rota 1 karşı yakadan geri.
const ENLEM = 41.0;
const boylam = (i) => 29.0 + i * 0.006;
function sahteTarife() {
  const durakEnlem = [];
  const durakBoylam = [];
  const rotaDuraklari = new Map();
  const ekle = (rota, noktalar) =>
    rotaDuraklari.set(
      rota,
      noktalar.map(([e, b], sira) => {
        durakEnlem.push(e);
        durakBoylam.push(b);
        return { durak: durakEnlem.length - 1, sira: sira + 1 };
      }),
    );
  ekle(0, [0, 1, 2, 3, 4, 5].map((i) => [ENLEM, boylam(i)]));
  ekle(1, [5, 4, 3, 2, 1, 0].map((i) => [ENLEM + 0.00018, boylam(i)]));
  return {
    durakEnlem,
    durakBoylam,
    rotaDuraklari,
    rotaEsik: new Map(),
    kisaAdtanRotalar: new Map([['141M', [0, 1]]]),
    guzergahtanRota: new Map([['141M_G_D0', 0], ['141M_D_D0', 1]]),
  };
}
const T = sahteTarife();
// Tarife: duraklar arası 120 sn.
const yolBul = (rota) => T.rotaDuraklari.get(rota).map((d, i) => ({ durak: d.durak, saniye: 36000 + i * 120 }));
const SIMDI = new Date('2026-10-06T14:00:00Z');
const arac = (kapiNo, i, kuzey = 0, yasSn = 30) => ({
  kapiNo,
  enlem: ENLEM + kuzey,
  boylam: boylam(i),
  tarih: new Date(SIMDI.getTime() - yasSn * 1000),
});
const bilgi = (guzergah) => () => ({ hat: '141M', guzergah, an: SIMDI.getTime() - 60_000 });

describe('yoldakiYer', () => {
  it('iki durak arasındaki kesirli yer; yoldan uzaksa null', () => {
    const yol = yolBul(0);
    assert.equal(Math.round(yoldakiYer(T, yol, ENLEM, boylam(2.5), 400).yer * 10) / 10, 2.5);
    assert.equal(yoldakiYer(T, yol, ENLEM + 0.02, boylam(2.5), 400), null);
  });
});

describe('AracVarislari', () => {
  it('durağa arkadan gelen aracın varışı: kalan yol × aralık süresi, konum yaşından düşülür', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('B-1799', 1.5, 0, 30)], [], bilgi('141M_G_D0'), SIMDI);
    const durak4 = T.rotaDuraklari.get(0)[4].durak;
    const r = v.durakVarislari(durak4, SIMDI.getTime())['141M'];
    assert.equal(r.length, 1);
    assert.equal(r[0].kapiNo, 'B-1799');
    assert.equal(r[0].kalanDurak, 3);
    // 1,5 → 4: 2,5 aralık × 120 sn = 300 sn, konum 30 sn önce → 270 sn sonra.
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 270);
  });

  it('öğrenilen süre varsa tarifeden önce o', () => {
    const v = new AracVarislari(T, yolBul, () => 60);
    v.guncelle([arac('B-1799', 2, 0, 0)], [], bilgi('141M_G_D0'), SIMDI);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'];
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 120);
    assert.equal(r[0].ogrenilen, 1);
  });

  it('durağı geçmiş araç yok; durağın dibindeki "durakta" (0 durak, şimdi)', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('A', 4.5), arac('B', 3.95, 0, 0)], [], bilgi('141M_G_D0'), SIMDI);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'];
    assert.deepEqual(r.map((x) => [x.kapiNo, x.kalanDurak]), [['B', 0]]);
  });

  it('karşı yöndeki (öbür güzergâh) araç bu durağa sayılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('D', 1.5, 0.00018)], [], bilgi('141M_D_D0'), SIMDI);
    assert.equal(v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'], undefined);
  });

  it('güzergâh kodu bayatsa yön iki konumdan; duran araçta son bilinen yön', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    const bayat = () => ({ hat: '141M', guzergah: '141M_D_D0', an: 0 });
    v.guncelle([arac('E', 0.2, 0, 0)], [], bayat, new Date(SIMDI.getTime() - 120_000));
    v.guncelle([arac('E', 1.2, 0, 0)], [], bayat, SIMDI);
    const durak4 = T.rotaDuraklari.get(0)[4].durak;
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime())['141M']?.[0].kapiNo, 'E');
    // Sonraki nabızda yerinde (trafik): yön hafızadan.
    v.guncelle([arac('E', 1.21, 0, 0)], [], bayat, new Date(SIMDI.getTime() + 75_000));
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime() + 75_000)['141M']?.[0].kapiNo, 'E');
  });

  it('hattı bilinmeyen ya da konumu eski araç sayılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('X', 1), arac('Y', 1, 0, 3600)], [], (k) => (k === 'Y' ? bilgi('141M_G_D0')() : null), SIMDI);
    assert.equal(v.araclar.length, 0);
  });
});
