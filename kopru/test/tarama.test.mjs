import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aracSayisiGuncelle, geceMi, istanbulSaati, Tarayici } from '../tarama.mjs';

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
