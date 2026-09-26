import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aracSayisiGuncelle, geceMi, ILGI_OMRU_MS, istanbulSaati, Tarayici } from '../tarama.mjs';

const istanbul = (saat) => Date.UTC(2026, 8, 26, saat - 3, 0, 0);

describe('gece', () => {
  it('İstanbul saati UTC+3', () => {
    assert.equal(istanbulSaati(istanbul(2)), 2);
    assert.equal(istanbulSaati(istanbul(15)), 15);
  });
  it('01:00–05:00 gece', () => {
    assert.equal(geceMi(istanbul(0)), false);
    assert.equal(geceMi(istanbul(1)), true);
    assert.equal(geceMi(istanbul(4)), true);
    assert.equal(geceMi(istanbul(5)), false);
  });
});

describe('araç sayısı', () => {
  it('tek düşük sayım puanı silmez', () => {
    assert.equal(aracSayisiGuncelle(20, 0), 12);
    assert.equal(aracSayisiGuncelle(20, 25), 25);
    assert.equal(aracSayisiGuncelle(undefined, 3), 3);
  });

  it('gece sayılmış hat yüklenirken tarifeden onarılır', () => {
    const t = new Tarayici(null, { tahminiYogunluk: new Map([['500T', 30]]) });
    t.yukle({ hatDurumu: { '500T': { sonBakilan: istanbul(2), aracSayisi: 0 }, '34G': { sonBakilan: istanbul(14), aracSayisi: 0 } } });
    assert.equal(t.hatDurumu.get('500T').aracSayisi, 30);
    assert.equal(t.hatDurumu.get('34G').aracSayisi, 0);
  });
});

describe('ilgi', () => {
  const tarayici = () => {
    const t = new Tarayici(null, { tahminiYogunluk: new Map([['500T', 30], ['34G', 50], ['15F', 5]]) });
    t.hatlariAyarla(['500T', '34G', '15F']);
    const once = istanbul(12) - 3 * 3_600_000;
    for (const h of ['500T', '34G', '15F']) t.isle(h, [], once);
    t.hatDurumu.get('34G').aracSayisi = 50;
    t.hatDurumu.get('500T').aracSayisi = 30;
    return t;
  };

  it('bildirilen hat sıranın önüne geçer; listede olmayan hat yok sayılır', () => {
    const t = tarayici();
    const simdi = istanbul(12);
    assert.equal(t.sıradakiHat(simdi), '34G');
    assert.equal(t.ilgiBildir(['15f', 'M2'], false, simdi), 1);
    assert.equal(t.sıradakiHat(simdi), '15F');
  });

  it('az önce sorulmuş ilgili hat yeniden sorulmaz; gece yalnız ilgi', () => {
    const t = tarayici();
    const simdi = istanbul(12);
    t.ilgiBildir(['15F'], false, simdi);
    t.isle('15F', [], simdi - 60_000);
    assert.equal(t.sıradakiHat(simdi), '34G');
    assert.equal(t.sıradakiHat(simdi, true), null);
  });

  it('favori hat daha sık sorulur ve kaydedilir', () => {
    const t = tarayici();
    const simdi = istanbul(12);
    t.ilgiBildir(['15F'], true, simdi - ILGI_OMRU_MS - 1); // anlık ilgisi geçmiş, kalıcısı sürüyor
    t.hatDurumu.get('15F').aracSayisi = 12; // 13 × 5 = 65 > 51
    assert.equal(t.sıradakiHat(simdi), '15F');
    const u = new Tarayici(null);
    u.yukle(t.disaAktar(), simdi);
    assert.equal(u.kalici.has('15F'), true);
  });
});
