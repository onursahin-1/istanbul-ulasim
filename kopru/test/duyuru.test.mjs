import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { duyurulariDuzenle } from '../duyuru.mjs';

describe('duyurulariDuzenle', () => {
  it('alanları okur, boşları ve tekrarları atar, hatta göre sıralar', () => {
    const sonuc = duyurulariDuzenle([
      { HAT: '98A', TIP: 'Günlük', GUNCELLEME_SAATI: '08:10', MESAJ: '  Yol çalışması   nedeniyle… ' },
      { HAT: '98A', TIP: 'Günlük', GUNCELLEME_SAATI: '08:10', MESAJ: 'Yol çalışması nedeniyle…' },
      { HAT: '14', TIP: 'Sefere Ait', GUNCELLEME_SAATI: '07:00', MESAJ: '07:30 seferi iptal' },
      { HAT: '', MESAJ: 'hatsız' },
      { HAT: '500T', MESAJ: '' },
    ]);
    assert.deepEqual(sonuc, [
      { hat: '14', tip: 'Sefere Ait', saat: '07:00', mesaj: '07:30 seferi iptal' },
      { hat: '98A', tip: 'Günlük', saat: '08:10', mesaj: 'Yol çalışması nedeniyle…' },
    ]);
  });

  it('küçük harfli alan adlarını ve tek kaydı da kabul eder', () => {
    assert.deepEqual(duyurulariDuzenle({ hat: 'm1a', mesaj: 'x' }), [{ hat: 'M1A', tip: '', saat: '', mesaj: 'x' }]);
  });

  it('beklenmeyen gövdede boş liste', () => {
    assert.deepEqual(duyurulariDuzenle(null), []);
    assert.deepEqual(duyurulariDuzenle('metin'), []);
  });
});
