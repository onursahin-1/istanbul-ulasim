// Türkçe metin ve hat kodu yardımcılarının testleri.
//
// Buradaki asıl mesele Türkçenin i/I ayrımı: JavaScript'in kendi toLowerCase'i
// "ISTANBUL" → "istanbul" yapar, doğrusu "ıstanbul"dur.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { baslikYap, hatAnahtari, metrobusMu, trBuyuk, trKucuk, yonYaz } from '../metin';

describe('Türkçe harf dönüşümü', () => {
  it('I harfini noktasız ı yapar', () => {
    assert.equal(trKucuk('KADIKÖY'), 'kadıköy');
    assert.equal(trKucuk('ISPARTA'), 'ısparta');
  });

  it('İ harfini noktalı i yapar', () => {
    assert.equal(trKucuk('İSTANBUL'), 'istanbul');
  });

  it('büyütürken i harfini noktalı tutar', () => {
    assert.equal(trBuyuk('istanbul'), 'İSTANBUL');
    assert.equal(trBuyuk('ısparta'), 'ISPARTA');
  });

  it('gidip gelince metni bozmaz', () => {
    for (const kelime of ['İSTANBUL', 'KADIKÖY', 'ŞİŞLİ', 'ÜSKÜDAR']) {
      assert.equal(trBuyuk(trKucuk(kelime)), kelime);
    }
  });
});

describe('baslikYap', () => {
  it('büyük harfli durak adını başlık düzenine çevirir', () => {
    assert.equal(baslikYap('KADIKÖY BELEDİYESİ'), 'Kadıköy Belediyesi');
  });

  it('tireli ve eğik çizgili adlarda ayraçları korur', () => {
    assert.equal(baslikYap('HASTANE - ADLİYE'), 'Hastane - Adliye');
    assert.equal(baslikYap('ATAKÖY/ŞİRİNEVLER'), 'Ataköy/Şirinevler');
  });

  it('kısaltmaları büyük bırakır', () => {
    assert.equal(baslikYap('İETT GARAJI'), 'İETT Garajı');
    assert.equal(baslikYap('D-100 KÖPRÜSÜ'), 'D-100 Köprüsü');
  });

  it('bağlaçları küçük yazar ama başta büyütür', () => {
    assert.equal(baslikYap('SÜTLÜCE VE EYÜP'), 'Sütlüce ve Eyüp');
    assert.equal(baslikYap('VE SONRASI'), 'Ve Sonrası');
  });

  it('boş girdide boş döner', () => {
    assert.equal(baslikYap(''), '');
    assert.equal(baslikYap(null), '');
    assert.equal(baslikYap(undefined), '');
  });
});

describe('yonYaz', () => {
  it('direction önekini atıp yön ekler', () => {
    assert.equal(yonYaz('direction: AVCILAR METROBÜS'), 'Avcılar Metrobüs yönü');
  });

  it('önek yoksa da çalışır', () => {
    assert.equal(yonYaz('ZİNCİRLİKUYU'), 'Zincirlikuyu yönü');
  });

  it('boş açıklamada boş döner', () => {
    assert.equal(yonYaz('direction:'), '');
    assert.equal(yonYaz(null), '');
  });
});

describe('metrobusMu', () => {
  it('metrobüs kodlarını tanır', () => {
    for (const kod of ['34', '34A', '34AS', '34BZ', '34C', '34G', '34Z']) {
      assert.equal(metrobusMu(kod), true, `${kod} metrobüs sayılmalı`);
    }
  });

  it('metrobüs olmayan kodları ayırt eder', () => {
    for (const kod of ['34E5', '340', '3', 'M4', '500T', '']) {
      assert.equal(metrobusMu(kod), false, `${kod} metrobüs sayılmamalı`);
    }
  });

  it('boş değerde çökmez', () => {
    assert.equal(metrobusMu(null), false);
    assert.equal(metrobusMu(undefined), false);
  });
});

describe('hatAnahtari', () => {
  it('Marmaray şubelerini tek anahtarda toplar', () => {
    assert.equal(hatAnahtari('Marmaray'), 'MARMARAY');
    assert.equal(hatAnahtari('Marmaray1'), 'MARMARAY');
    assert.equal(hatAnahtari('MARMARAY2'), 'MARMARAY');
  });

  it('diğer kodları büyük harfe çevirip bırakır', () => {
    assert.equal(hatAnahtari('m4'), 'M4');
    assert.equal(hatAnahtari(' t1 '), 'T1');
  });
});
