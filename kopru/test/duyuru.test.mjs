import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adAnahtari, duyurulariDuzenle, duyurulariEslestir } from '../duyuru.mjs';

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


describe('adAnahtari', () => {
  it('Türkçe harfleri ve noktalamayı katlar', () => {
    assert.equal(adAnahtari('İETT İKİTELLİ GARAJI - TAKSİM'), 'IETT IKITELLI GARAJI TAKSIM');
    assert.equal(adAnahtari('IETT IKITELLI GARAJI-TAKSIM'), 'IETT IKITELLI GARAJI TAKSIM');
    assert.equal(adAnahtari('YENI MAHALLE METRO / KIRAZLI - AKSARAY'), 'YENI MAHALLE METRO KIRAZLI AKSARAY');
  });
});

describe('duyurulariEslestir', () => {
  const d = (hat) => ({ hat, tip: 'Günlük', saat: '09:46', mesaj: 'x' });

  it('İETT hat listesindeki adla birebir eşleştirir', () => {
    const [s] = duyurulariEslestir([d('IETT IKITELLI GARAJI-TAKSIM')], [
      { kod: '89C', ad: 'İETT İKİTELLİ GARAJI - TAKSİM' },
      { kod: '89T', ad: 'İETT İKİTELLİ GARAJI - TAKSİM' },
      { kod: '98A', ad: 'GÖZTEPE MAHALLESİ - BAKIRKÖY' },
    ]);
    assert.deepEqual(s.kodlar, ['89C', '89T']);
  });

  it('bulamazsa GTFS güzergâh adlarında bütün sözcükleri arar', () => {
    const [s] = duyurulariEslestir([d('GÖZTEPE MAHALLESI - AKSARAY')], [], [
      { kisa: '91E', uzun: 'GÖZTEPE MAHALLESİ - AKSARAY RİNG' },
      { kisa: '91E', uzun: 'AKSARAY - GÖZTEPE MAHALLESİ' },
      { kisa: '98A', uzun: 'GÖZTEPE MAHALLESİ - BAKIRKÖY' },
    ]);
    assert.deepEqual(s.kodlar, ['91E']);
  });

  it('çok hatta tutan ad belirsiz: bağlamaz', () => {
    const gtfs = Array.from({ length: 6 }, (_, i) => ({ kisa: `H${i}`, uzun: `AKSARAY - YER ${i}` }));
    const [s] = duyurulariEslestir([d('AKSARAY')], [], gtfs);
    assert.deepEqual(s.kodlar, []);
  });

  it('hiç tutmazsa boş liste', () => {
    assert.deepEqual(duyurulariEslestir([d('BÜYÜKADA TAKSI')])[0].kodlar, []);
  });
});

describe('kayıt saati', () => {
  it('"Kayit Saati: 06:35" → "06:35"', () => {
    assert.equal(duyurulariDuzenle([{ HAT: 'X', MESAJ: 'm', GUNCELLEME_SAATI: 'Kayit Saati: 06:35' }])[0].saat, '06:35');
  });
});
