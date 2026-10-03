// Saat ve süre yardımcılarının testleri.
//
// Toplu taşıma verisinde gün 24 saatten uzundur: gece 01:00 seferi, tarifede
// "25:00" olarak geçer. Buradaki testlerin çoğu o eşiği koruyor.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  andanSecim,
  durakVarisMetni,
  saatEkli,
  sayiBulunmaEki,
  istanbulSaatiYaz,
  isodanSaniye,
  kalkisGosterimi,
  mesafeYaz,
  saatYaz,
  saniyedenSaat,
  secimdenAn,
  sureYaz,
} from '../zaman';

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

describe('saat çarkı dönüşümü', () => {
  // İstanbul'da 27 Eylül Pazar 02:07 (UTC 26 Eylül 23:07): telefon ekranındaki an.
  const simdi = Date.UTC(2026, 8, 26, 23, 7);

  it('seçimi İstanbul saatine göre mutlak ana çevirir', () => {
    assert.equal(secimdenAn(0, 2, 7, simdi).toISOString(), '2026-09-26T23:07:00.000Z');
    assert.equal(secimdenAn(1, 9, 30, simdi).toISOString(), '2026-09-28T06:30:00.000Z');
  });

  it('çarkın anını gün farkına ve saate geri çevirir', () => {
    assert.deepEqual(andanSecim(new Date('2026-09-27T20:45:00Z'), simdi), { gun: 0, saat: 23, dakika: 45 });
    assert.deepEqual(andanSecim(new Date('2026-09-27T21:10:00Z'), simdi), { gun: 1, saat: 0, dakika: 10 });
    assert.deepEqual(andanSecim(new Date('2026-10-03T05:00:00Z'), simdi), { gun: 6, saat: 8, dakika: 0 });
  });

  it('gidiş-dönüş aynı seçimi verir', () => {
    for (const [g, h, d] of [[0, 0, 0], [3, 23, 59], [6, 12, 1]]) {
      assert.deepEqual(andanSecim(secimdenAn(g, h, d, simdi), simdi), { gun: g, saat: h, dakika: d });
    }
  });
});

describe('sayiBulunmaEki', () => {
  it('birler basamağının okunuşuna uyuyor', () => {
    const beklenen = ['da', 'de', 'de', 'te', 'te', 'te', 'da', 'de', 'de', 'da'];
    beklenen.forEach((ek, n) => assert.equal(sayiBulunmaEki(n), ek, String(n)));
  });
  it('onlar: on, yirmi, otuz, kırk, elli', () => {
    assert.deepEqual([10, 20, 30, 40, 50].map(sayiBulunmaEki), ['da', 'de', 'da', 'ta', 'de']);
  });
  it('iki basamaklı sayılarda son okunan kelime belirliyor', () => {
    assert.equal(sayiBulunmaEki(13), 'te'); // on üç
    assert.equal(sayiBulunmaEki(16), 'da'); // on altı
    assert.equal(sayiBulunmaEki(47), 'de'); // kırk yedi
    assert.equal(sayiBulunmaEki(59), 'da'); // elli dokuz
  });
});

describe('saatEkli / durakVarisMetni', () => {
  // İstanbul UTC+3: 16:02 UTC → 19:02.
  const an = (s: number, d: number) => Date.UTC(2026, 9, 3, s - 3, d) / 1000;
  it('dakika sıfır değilse ek dakikaya uyar', () => {
    assert.equal(saatEkli(an(19, 2)), "19:02'de");
    assert.equal(saatEkli(an(19, 6)), "19:06'da");
    assert.equal(saatEkli(an(8, 43)), "08:43'te");
    assert.equal(saatEkli(an(8, 40)), "08:40'ta");
  });
  it('tam saatte ek saate uyar', () => {
    assert.equal(saatEkli(an(19, 0)), "19:00'da"); // on dokuz
    assert.equal(saatEkli(an(13, 0)), "13:00'te"); // on üç
    assert.equal(saatEkli(an(20, 0)), "20:00'de"); // yirmi
    assert.equal(saatEkli(an(4, 0)), "04:00'te"); // dört
    assert.equal(saatEkli(an(3, 0) + 24 * 3600 - 3 * 3600), "00:00'da"); // sıfır
  });
  it('tam metin', () => {
    assert.equal(durakVarisMetni(an(19, 2)), "19:02'de durakta");
  });
});
