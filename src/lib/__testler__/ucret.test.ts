// İstanbulkart ücret hesabının testleri.
//
// Buradaki tutarlar İBB'nin 20.07.2026 tarifesinden elle okundu. Tarife değişince
// bu sayılar da değişmeli — testin amacı zaten bunu fark ettirmek.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Bacak } from '../otp';
import { ucretKisa, ucretYaz, yolculukUcreti } from '../ucret';

type Secenek = {
  kod?: string;
  mod?: string;
  durak?: number;
  saat?: string;
  bitis?: string;
  yon?: string;
  varis?: string;
};

/** Testler için en az alanla bir toplu taşıma bacağı üretir. */
function bacak(s: Secenek = {}): Bacak {
  const durakSayisi = s.durak ?? 5;
  const duraklar = Array.from({ length: durakSayisi + 1 }, (_, i) => ({
    gtfsId: `d${i}`,
    name: `Durak ${i}`,
    lat: 41 + i / 1000,
    lon: 29 + i / 1000,
  }));
  return {
    mode: s.mod ?? 'BUS',
    duration: 600,
    distance: 4000,
    transitLeg: true,
    headsign: s.yon ?? '',
    start: { scheduledTime: s.saat ?? '2026-09-22T09:00:00+03:00', estimated: null },
    end: { scheduledTime: s.bitis ?? '2026-09-22T09:20:00+03:00', estimated: null },
    from: { name: 'Durak 0', lat: 41, lon: 29, stop: { gtfsId: 'd0' } },
    to: { name: s.varis ?? `Durak ${durakSayisi}`, lat: 41.1, lon: 29.1, stop: { gtfsId: `d${durakSayisi}` } },
    route: { gtfsId: `r:${s.kod ?? '500T'}`, shortName: s.kod ?? '500T', longName: null, mode: s.mod ?? 'BUS', color: null, textColor: null },
    legGeometry: null,
    trip: { gtfsId: 't1', pattern: { stops: duraklar } },
  } as unknown as Bacak;
}

const yuru = { transitLeg: false } as unknown as Bacak;

describe('yolculukUcreti', () => {
  it('tek binişte tam bilet alır', () => {
    const u = yolculukUcreti([bacak()], 'tam');
    assert.equal(u.toplam, 4620);
    assert.equal(u.bacaklar[0]?.aciklama, 'İlk biniş');
    assert.equal(u.yaklasik, false);
  });

  it('aktarmada merdivenin ikinci basamağını uygular', () => {
    const u = yolculukUcreti(
      [bacak(), yuru, bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T09:25:00+03:00' })],
      'tam',
    );
    assert.equal(u.toplam, 4620 + 3440);
    assert.equal(u.bacaklar[2]?.aciklama, '1. aktarma');
  });

  it('üç aktarmada merdiven 3. basamakta sabitlenir', () => {
    const saatler = ['09:00', '09:20', '09:40', '10:00'].map((s) => `2026-09-22T${s}:00+03:00`);
    const u = yolculukUcreti(
      [
        bacak({ saat: saatler[0] }),
        yuru,
        bacak({ kod: 'M4', mod: 'SUBWAY', saat: saatler[1] }),
        yuru,
        bacak({ kod: 'M2', mod: 'SUBWAY', saat: saatler[2] }),
        yuru,
        bacak({ kod: '99A', saat: saatler[3] }),
      ],
      'tam',
    );
    assert.equal(u.toplam, 4620 + 3440 + 2642 + 1718);
  });

  it('yürüme bacaklarını ücretlendirmez', () => {
    const u = yolculukUcreti([yuru, bacak(), yuru], 'tam');
    assert.equal(u.bacaklar.filter(Boolean).length, 1);
  });

  it('120 dakikalık aktarma penceresi dolunca ücret baştan başlar', () => {
    const u = yolculukUcreti(
      [bacak({ saat: '2026-09-22T09:00:00+03:00' }), yuru, bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T11:20:00+03:00' })],
      'tam',
    );
    assert.equal(u.toplam, 4620 * 2);
    assert.equal(u.yeniYolculuk, 1);
  });

  it('pencerenin tam sınırında aktarma sayar', () => {
    const u = yolculukUcreti(
      [bacak({ saat: '2026-09-22T09:00:00+03:00' }), yuru, bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T10:59:00+03:00' })],
      'tam',
    );
    assert.equal(u.yeniYolculuk, 0);
    assert.equal(u.toplam, 4620 + 3440);
  });

  it('gece tarifesinde ücret ikiye katlanır', () => {
    const gunduz = yolculukUcreti([bacak({ saat: '2026-09-22T09:00:00+03:00' })], 'tam');
    const gece = yolculukUcreti([bacak({ saat: '2026-09-22T01:00:00+03:00' })], 'tam');
    assert.equal(gece.toplam, gunduz.toplam * 2);
    assert.equal(gece.geceTarifesi, true);
  });

  it('gece tarifesi 05:30\'da biter', () => {
    const u = yolculukUcreti([bacak({ saat: '2026-09-22T05:30:00+03:00' })], 'tam');
    assert.equal(u.geceTarifesi, false);
  });

  it('öğrenci tarifesi ayrı merdiven kullanır', () => {
    const u = yolculukUcreti([bacak(), yuru, bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T09:25:00+03:00' })], 'ogrenci');
    assert.equal(u.toplam, 2255 + 1121);
  });
});

describe('mesafeli tarifeler', () => {
  it('metrobüsü durak sayısına göre kademelendirir', () => {
    const kademe = (durak: number) => yolculukUcreti([bacak({ kod: '34', durak })], 'tam').toplam;
    assert.equal(kademe(1), 3308);
    assert.equal(kademe(3), 4620);
    assert.equal(kademe(12), 5800); // 10–15 kademesi
    assert.equal(kademe(40), 6859); // 34+ kademesi
  });

  it('Marmaray\'da aktarma indirimini tam bilet farkı kadar düşer', () => {
    const u = yolculukUcreti(
      [bacak({ kod: 'M2', mod: 'SUBWAY' }), yuru, bacak({ kod: 'Marmaray', mod: 'RAIL', durak: 12, saat: '2026-09-22T09:25:00+03:00' })],
      'tam',
    );
    // 12 istasyon → 47,74; indirim = tam bilet − 1. aktarma = 46,20 − 34,40 = 11,80
    assert.equal(u.toplam, 4620 + (4774 - (4620 - 3440)));
    assert.match(u.bacaklar[2]?.aciklama ?? '', /Marmaray · 12 istasyon · 1\. aktarma indirimi/);
  });

  it('M11\'i kendi kademesinden ücretlendirir', () => {
    const u = yolculukUcreti([bacak({ kod: 'M11', mod: 'SUBWAY', durak: 15 })], 'tam');
    assert.equal(u.toplam, 7319);
  });

  it('indirimli kartlarda mesafeli tarifeyi tahmin olarak işaretler', () => {
    const u = yolculukUcreti([bacak({ kod: '34', durak: 12 })], 'indirimli');
    assert.equal(u.yaklasik, true);
  });
});

describe('vapur', () => {
  it('vapuru yaklaşık olarak işaretler', () => {
    const u = yolculukUcreti([bacak({ kod: 'KDK-BSK', mod: 'FERRY', durak: 1 })], 'tam');
    assert.equal(u.yaklasik, true);
    assert.equal(ucretKisa(u).startsWith('≈'), true);
  });

  it('Adalar hattını ayrı tarifeden hesaplar', () => {
    const normal = yolculukUcreti([bacak({ kod: 'KDK-BSK', mod: 'FERRY', durak: 1 })], 'tam');
    const ada = yolculukUcreti([bacak({ kod: 'ADA', mod: 'FERRY', durak: 1, varis: 'BÜYÜKADA' })], 'tam');
    assert.ok(ada.toplam > normal.toplam * 2, 'Adalar tarifesi belirgin biçimde yüksek olmalı');
    assert.equal(ada.bacaklar[0]?.aciklama, 'Adalar vapuru');
  });
});

describe('gösterim', () => {
  it('kuruşu Türkçe biçimde yazar', () => {
    assert.equal(ucretYaz(4620), '46,20 ₺');
    assert.equal(ucretYaz(0), '0,00 ₺');
  });

  it('ücretsiz yolculuğu ayrı yazar', () => {
    assert.equal(ucretKisa(yolculukUcreti([yuru], 'tam')), 'Ücretsiz');
  });
});
