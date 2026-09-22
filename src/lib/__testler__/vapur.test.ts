// Vapur ücretlerinin testleri.
//
// Tutarlar İBB'nin 20.07.2026 tarifesinden, "Şehir İçi Vapurları" bölümünden
// elle okundu. Tarife değişince bu testler kırılmalı.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { iskeleAnahtari, sehirHatlariMi, vapurUcreti } from '../vapur';

const SEHIR = 'Şehirhatları A.Ş.';

describe('iskeleAnahtari', () => {
  it('aynı iskelenin farklı yazımlarını tek anahtara indirir', () => {
    for (const ad of ['KADIKÖY', 'KADIKÖY (METRO)', 'YENİKADIKÖY', 'KADIKÖY2 (ÇAYIRBAŞI)', 'Kadıköy İskelesi']) {
      assert.equal(iskeleAnahtari(ad), 'kadikoy', `${ad} → kadikoy olmalı`);
    }
  });

  it('Türkçe harfleri sadeleştirir', () => {
    assert.equal(iskeleAnahtari('ÜSKÜDAR'), 'uskudar');
    assert.equal(iskeleAnahtari('Beşiktaş'), 'besiktas');
    assert.equal(iskeleAnahtari('EMİNÖNÜ'), 'eminonu');
  });

  it('bütün ada iskelelerini adalar sayar', () => {
    for (const ad of ['Büyükada', 'HEYBELİADA', 'Burgazada', 'Kınalıada', 'ADALAR']) {
      assert.equal(iskeleAnahtari(ad), 'adalar');
    }
  });

  it('tanımadığı iskelede null döner', () => {
    assert.equal(iskeleAnahtari('Tuzla Tersane'), null);
    assert.equal(iskeleAnahtari(''), null);
    assert.equal(iskeleAnahtari(null), null);
  });
});

describe('sehirHatlariMi', () => {
  it('Şehir Hatları\'nı tanır', () => {
    assert.equal(sehirHatlariMi('Şehirhatları A.Ş.'), true);
    assert.equal(sehirHatlariMi('ŞEHİR HATLARI'), true);
  });
  it('özel işletmecileri ayırır', () => {
    for (const o of ['Turyol', 'Dentur Avrasya', 'IDO', null]) {
      assert.equal(sehirHatlariMi(o), false, `${o} Şehir Hatları sayılmamalı`);
    }
  });
});

describe('vapurUcreti', () => {
  it('tarifedeki hattı kesin tutarla verir', () => {
    const u = vapurUcreti('ÜSKÜDAR', 'EMİNÖNÜ', SEHIR);
    assert.equal(u.tam, 5852);
    assert.equal(u.ogrenci, 2844);
    assert.equal(u.yaklasik, false);
    assert.equal(u.aciklama, 'Vapur');
  });

  it('yön fark etmez', () => {
    const a = vapurUcreti('EMİNÖNÜ', 'KADIKÖY', SEHIR);
    const b = vapurUcreti('KADIKÖY', 'EMİNÖNÜ', SEHIR);
    assert.equal(a.tam, b.tam);
    assert.equal(a.tam, 6521);
  });

  it('tarifedeki bütün hatları farklı fiyatlandırır', () => {
    const ornekler: [string, string, number][] = [
      ['Ortaköy', 'Üsküdar', 5181],
      ['Ortaköy', 'Kadıköy', 7107],
      ['Üsküdar', 'Kadıköy', 6270],
      ['Kadıköy', 'Karaköy', 6521],
      ['Beşiktaş', 'Üsküdar', 5015],
      ['Kabataş', 'Üsküdar', 5181],
      ['Kadıköy', 'Beşiktaş', 6521],
      ['Kadıköy', 'Kabataş', 6270],
      ['Beykoz', 'Yeniköy', 5097],
      ['Karaköy', 'Bostancı', 7690],
      ['Aşiyan', 'Üsküdar', 6853],
      ['Beykoz', 'Sarıyer', 6104],
      ['Çengelköy', 'Kabataş', 6185],
    ];
    for (const [a, b, beklenen] of ornekler) {
      assert.equal(vapurUcreti(a, b, SEHIR).tam, beklenen, `${a}–${b}`);
    }
  });

  it('Adalar hattını ayrı tarifeden hesaplar', () => {
    const u = vapurUcreti('Kabataş', 'Büyükada', SEHIR);
    assert.equal(u.tam, 15123);
    assert.equal(u.yaklasik, false);
    assert.match(u.aciklama, /Adalar/);
  });

  it('Adalar, normal hatlardan belirgin biçimde pahalı', () => {
    assert.ok(vapurUcreti('Kabataş', 'Heybeliada', SEHIR).tam > vapurUcreti('Kadıköy', 'Karaköy', SEHIR).tam * 2);
  });

  it('özel işletmeciyi yaklaşık işaretler', () => {
    const t = vapurUcreti('KARAKÖY', 'KADIKÖY (METRO)', 'Turyol');
    assert.equal(t.tam, 6521, 'aynı geçişin Şehir Hatları fiyatı tahmin olarak kullanılır');
    assert.equal(t.yaklasik, true);
    assert.match(t.aciklama, /özel işletmeci/);
  });

  it('tarifede olmayan hatta temsilî değere düşer ve işaretler', () => {
    const u = vapurUcreti('Tuzla', 'Bandırma', SEHIR);
    assert.equal(u.yaklasik, true);
    assert.match(u.aciklama, /tarifede yok/);
  });

  it('aynı iskeleden aynı iskeleye tarifede yok sayılır', () => {
    assert.equal(vapurUcreti('Kadıköy', 'Kadıköy', SEHIR).yaklasik, true);
  });

  it('öğrenci tutarı tam biletin altında', () => {
    for (const [a, b] of [['Üsküdar', 'Eminönü'], ['Kadıköy', 'Karaköy'], ['Kabataş', 'Büyükada']]) {
      const u = vapurUcreti(a, b, SEHIR);
      assert.ok(u.ogrenci < u.tam, `${a}–${b}`);
    }
  });
});
