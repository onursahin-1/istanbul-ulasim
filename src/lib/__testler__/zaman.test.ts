// Saat ve süre yardımcılarının testleri.
//
// Toplu taşıma verisinde gün 24 saatten uzundur: gece 01:00 seferi, tarifede
// "25:00" olarak geçer. Buradaki testlerin çoğu o eşiği koruyor.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { istanbulSaatiYaz, isodanSaniye, kalkisGosterimi, mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '../zaman';

describe('saatYaz', () => {
  it('ISO saatten saat ve dakikayı alır', () => {
    assert.equal(saatYaz('2026-09-17T09:00:49+03:00'), '09:00');
  });

  it('eksik değerde yer tutucu verir', () => {
    assert.equal(saatYaz(null), '--:--');
    assert.equal(saatYaz(''), '--:--');
    assert.equal(saatYaz('tarih değil'), '--:--');
  });
});

describe('saniyedenSaat', () => {
  it('gün başından saniyeyi saate çevirir', () => {
    assert.equal(saniyedenSaat(0), '00:00');
    assert.equal(saniyedenSaat(9 * 3600 + 5 * 60), '09:05');
  });

  it('24 saati aşan tarife saatlerini ertesi güne taşır', () => {
    assert.equal(saniyedenSaat(25 * 3600), '01:00', 'tarifedeki 25:00 gece 01:00 demektir');
    assert.equal(saniyedenSaat(26 * 3600 + 30 * 60), '02:30');
  });
});

describe('isodanSaniye', () => {
  it('ISO saatten gün başından saniyeyi çıkarır', () => {
    assert.equal(isodanSaniye('2026-09-19T18:34:00+03:00'), 18 * 3600 + 34 * 60);
  });

  it('saniyesi olmayan biçimi de okur', () => {
    assert.equal(isodanSaniye('2026-09-19T18:34+03:00'), 18 * 3600 + 34 * 60);
  });

  it('okunamayan girdide null döner', () => {
    assert.equal(isodanSaniye(null), null);
    assert.equal(isodanSaniye('bugün'), null);
  });
});

describe('sureYaz', () => {
  it('bir saatin altını dakika yazar', () => {
    assert.equal(sureYaz(59 * 60), '59 dk');
  });

  it('saat ve dakikayı ayırır', () => {
    assert.equal(sureYaz(65 * 60), '1 sa 5 dk');
    assert.equal(sureYaz(120 * 60), '2 sa');
  });

  it('çok kısa süreyi 1 dakikaya yuvarlar', () => {
    assert.equal(sureYaz(10), '1 dk', 'sıfır dakika yazmak yanıltıcı olur');
  });

  it('eksik değerde boş döner', () => {
    assert.equal(sureYaz(null), '');
    assert.equal(sureYaz(undefined), '');
  });
});

describe('mesafeYaz', () => {
  it('bir kilometrenin altını metre olarak yuvarlar', () => {
    assert.equal(mesafeYaz(234), '230 m');
    assert.equal(mesafeYaz(999), '1000 m');
  });

  it('kilometreyi virgüllü yazar', () => {
    assert.equal(mesafeYaz(1400), '1,4 km');
    assert.equal(mesafeYaz(12_345), '12,3 km');
  });

  it('eksik değerde boş döner', () => {
    assert.equal(mesafeYaz(null), '');
  });
});

describe('kalkisGosterimi', () => {
  // 2026-09-22 00:00:00 İstanbul = 2026-09-21 21:00:00 UTC
  const GECE_YARISI = Date.UTC(2026, 8, 21, 21, 0, 0);
  const an = (saat: number, dakika: number, saniye = 0) => GECE_YARISI / 1000 + saat * 3600 + dakika * 60 + saniye;

  it('bir saatten yakın kalkışı dakika olarak yazar', () => {
    const g = kalkisGosterimi(an(0, 7), GECE_YARISI);
    assert.deepEqual([g.metin, g.birim, g.dakika], ['7', 'dk', 7]);
    assert.equal(g.seslendirme, '7 dakika sonra');
  });

  it('bir saat ve ötesini saat olarak yazar — "351 dk" değil "05:51"', () => {
    const g = kalkisGosterimi(an(5, 51), GECE_YARISI);
    assert.deepEqual([g.metin, g.birim], ['05:51', null]);
    assert.equal(g.dakika, 351, 'sıralama için dakika yine de dönüyor');
    assert.equal(g.seslendirme, 'saat 05:51');
  });

  it('sınırda: 59 dakika dakika, 60 dakika saat', () => {
    assert.equal(kalkisGosterimi(an(0, 59), GECE_YARISI).birim, 'dk');
    assert.equal(kalkisGosterimi(an(1, 0), GECE_YARISI).metin, '01:00');
  });

  it('saati dakikadan geri hesaplamaz, kaymaz', () => {
    // Şu an 00:00:40; kalkış 05:51:00. Dakika 350.3 → 350'ye yuvarlanıyor;
    // şimdiden 350 dk ileri gitmek 05:50:40 verirdi ve "05:50" yazardı.
    const g = kalkisGosterimi(an(5, 51), GECE_YARISI + 40_000);
    assert.equal(g.metin, '05:51');
  });

  it('geçmiş ve şimdiki kalkışta "Şimdi" yazar', () => {
    assert.equal(kalkisGosterimi(an(0, 0, 20), GECE_YARISI).metin, 'Şimdi');
    assert.equal(kalkisGosterimi(an(0, 0), GECE_YARISI + 90_000).metin, 'Şimdi');
    assert.equal(kalkisGosterimi(an(0, 0), GECE_YARISI).birim, null);
  });

  it('ertesi güne taşan kalkışı da doğru saatle yazar', () => {
    // 23:30'da, ertesi sabah 06:10'daki sefer
    assert.equal(kalkisGosterimi(an(30, 10), GECE_YARISI + 23.5 * 3600_000).metin, '06:10');
  });
});

describe('istanbulSaatiYaz', () => {
  it('UTC+3 ile yazar ve sıfırla doldurur', () => {
    assert.equal(istanbulSaatiYaz(Date.UTC(2026, 8, 22, 2, 51) / 1000), '05:51');
    assert.equal(istanbulSaatiYaz(Date.UTC(2026, 8, 22, 21, 5) / 1000), '00:05');
  });
});
