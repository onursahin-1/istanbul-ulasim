// İstanbulkart ücret hesabının testleri.
//
// Buradaki tutarlar İBB'nin 20.07.2026 tarifesinden elle okundu. Tarife değişince
// bu sayılar da değişmeli — testin amacı zaten bunu fark ettirmek.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Bacak } from '../otp';
import { minibusUcreti, ucretKisa, ucretYaz, yolculukUcreti } from '../ucret';

type Secenek = {
  kod?: string;
  mod?: string;
  durak?: number;
  saat?: string;
  bitis?: string;
  yon?: string;
  varis?: string;
  binis?: string;
  isletmeci?: string;
  /** Bacağın yol uzunluğu, metre. */
  metre?: number | null;
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
    distance: s.metre === undefined ? 4000 : s.metre,
    transitLeg: true,
    headsign: s.yon ?? '',
    start: { scheduledTime: s.saat ?? '2026-09-22T09:00:00+03:00', estimated: null },
    end: { scheduledTime: s.bitis ?? '2026-09-22T09:20:00+03:00', estimated: null },
    from: { name: s.binis ?? 'Durak 0', lat: 41, lon: 29, stop: { gtfsId: 'd0' } },
    to: { name: s.varis ?? `Durak ${durakSayisi}`, lat: 41.1, lon: 29.1, stop: { gtfsId: `d${durakSayisi}` } },
    route: {
      gtfsId: `r:${s.kod ?? '500T'}`,
      shortName: s.kod ?? '500T',
      longName: null,
      mode: s.mod ?? 'BUS',
      color: null,
      textColor: null,
      agency: s.isletmeci ? { name: s.isletmeci } : null,
    },
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
  const vapur = (o: Secenek) => bacak({ mod: 'FERRY', durak: 1, ...o });

  it('Şehir Hatları hattını kesin tutarla hesaplar', () => {
    const u = yolculukUcreti(
      [vapur({ kod: 'KDK-KRK', binis: 'KADIKÖY', varis: 'KARAKÖY', isletmeci: 'Şehirhatları A.Ş.' })],
      'tam',
    );
    assert.equal(u.toplam, 6521);
    assert.equal(u.yaklasik, false);
    assert.equal(ucretKisa(u), '65,21 ₺', 'kesin tutarda ≈ işareti olmamalı');
  });

  it('Turyol şehir hattında tarife kesin', () => {
    const u = yolculukUcreti(
      [vapur({ kod: 'KRK-KDK', binis: 'KARAKÖY', varis: 'KADIKÖY (METRO)', isletmeci: 'Turyol' })],
      'tam',
    );
    assert.equal(u.toplam, 6521);
    assert.equal(u.yaklasik, false);
  });

  it('Turyol Adalar bileti aktarma merdivenine girmez', () => {
    const u = yolculukUcreti(
      [
        vapur({ kod: 'EMN-ADALAR', binis: 'Karaköy Turyol', varis: 'Büyükada Turyol', isletmeci: 'Turyol' }),
        bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T09:25:00+03:00' }),
      ],
      'tam',
    );
    assert.equal(u.bacaklar[0]?.tutar, 23000);
    assert.equal(u.bacaklar[0]?.etiket, 'Ayrı bilet');
    assert.equal(u.bacaklar[1]?.etiket, 'İlk biniş', 'sonraki İstanbulkart binişi ilk biniş sayılır');
    const ogr = yolculukUcreti([vapur({ binis: 'Karaköy Turyol', varis: 'Büyükada Turyol', isletmeci: 'Turyol' })], 'ogrenci');
    assert.equal(ogr.yaklasik, true, 'öğrenci fiyatı yayımlanmıyor');
  });

  it('tanınmayan iskelede yaklaşık kalır', () => {
    const u = yolculukUcreti([vapur({ kod: 'KDK-BSK', isletmeci: 'Şehirhatları A.Ş.' })], 'tam');
    assert.equal(u.yaklasik, true);
  });

  it('Adalar hattını ayrı tarifeden hesaplar', () => {
    const normal = yolculukUcreti(
      [vapur({ binis: 'KADIKÖY', varis: 'KARAKÖY', isletmeci: 'Şehirhatları A.Ş.' })],
      'tam',
    );
    const ada = yolculukUcreti(
      [vapur({ binis: 'KABATAŞ', varis: 'BÜYÜKADA', isletmeci: 'Şehirhatları A.Ş.' })],
      'tam',
    );
    assert.ok(ada.toplam > normal.toplam * 2, 'Adalar tarifesi belirgin biçimde yüksek olmalı');
    assert.match(ada.bacaklar[0]?.aciklama ?? '', /Adalar/);
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

describe('yolculukUcreti: özel günler', () => {
  const gunler = [
    { tarih: '2026-10-29', ad: 'Cumhuriyet Bayramı', tarife: 'pazar' as const, ucretsiz: { ibb: true, tcdd: true } },
  ];
  const bayramda = '2026-10-29T10:00:00+03:00';

  it('İBB ve TCDD hatları ücretsiz, kişiselleştirilmiş kart notu', () => {
    const u = yolculukUcreti(
      [bacak({ saat: bayramda, isletmeci: 'IETT' }), yuru, bacak({ saat: bayramda, kod: 'Marmaray', mod: 'RAIL', isletmeci: 'TCDD' })],
      'tam',
      gunler,
    );
    assert.equal(u.toplam, 0);
    assert.equal(u.ucretsizGun, 'Cumhuriyet Bayramı');
    assert.equal(u.kisiselKart, true);
    assert.equal(ucretKisa(u), 'Ücretsiz');
    assert.equal(u.bacaklar[0]?.aciklama, 'Ücretsiz · Cumhuriyet Bayramı');
  });

  it('ücretsiz bacak aktarma sırasını ilerletmez: sonraki otobüs ilk biniş sayılır', () => {
    const u = yolculukUcreti(
      [
        bacak({ saat: bayramda, kod: 'M4', mod: 'SUBWAY', isletmeci: 'Metro Istanbul' }),
        bacak({ saat: bayramda, kod: 'X', isletmeci: 'Minibus' }),
        bacak({ saat: bayramda, isletmeci: 'Özel Halk Otobüsü' }),
      ],
      'tam',
      gunler,
    );
    assert.equal(u.bacaklar[0]?.tutar, 0);
    assert.equal(u.bacaklar[1]?.tutar, 4300, 'minibüs bayramda da ücretli');
    assert.equal(u.bacaklar[2]?.etiket, 'İlk biniş');
  });

  it('olağan günde değişen bir şey yok', () => {
    const u = yolculukUcreti([bacak({ isletmeci: 'IETT' })], 'tam', gunler);
    assert.equal(u.toplam, 4620);
    assert.equal(u.ucretsizGun, null);
  });
});

describe('minibusUcreti', () => {
  it('20.07.2026 tarifesinin kademeleri; sınır alttaki kademede', () => {
    const km = [0.5, 4, 4.01, 7, 7.5, 11, 12, 15, 15.2, 20];
    const beklenen = [4300, 4300, 4500, 4500, 4600, 4600, 4700, 4700, 5200, 5200];
    assert.deepEqual(km.map((k) => minibusUcreti(k, 'tam')), beklenen);
  });
  it('20 km üzerinde başlanan her km 1,50 ₺', () => {
    assert.equal(minibusUcreti(20.3, 'tam'), 5350);
    assert.equal(minibusUcreti(23, 'tam'), 5650);
  });
  it('öğrenci mesafeden bağımsız 28 ₺; indirimli kart minibüste tam öder', () => {
    assert.equal(minibusUcreti(3, 'ogrenci'), 2800);
    assert.equal(minibusUcreti(18, 'ogrenci30'), 2800);
    assert.equal(minibusUcreti(9, 'indirimli'), 4600);
  });
});

describe('yolculukUcreti · minibüs', () => {
  const minibus = (s: Secenek = {}) => bacak({ kod: 'Kadıköy-Pendik', isletmeci: 'Minibus', ...s });

  it('İETT tarifesiyle değil, mesafeyle ücretlenir', () => {
    const u = yolculukUcreti([minibus({ metre: 9500 })], 'tam');
    assert.equal(u.toplam, 4600);
    assert.equal(u.minibus, true);
    assert.equal(u.yaklasik, true);
    assert.equal(u.bacaklar[0]?.etiket, 'Ayrı ödeme');
    assert.equal(u.bacaklar[0]?.aciklama, 'Minibüs · 9,5 km · İstanbulkart geçmez');
    assert.equal(ucretKisa(u), '≈46,00 ₺');
  });

  it('aktarma sayısı fiyatı değiştirmez ve İstanbulkart merdivenini ilerletmez', () => {
    const u = yolculukUcreti(
      [
        bacak({ isletmeci: 'IETT' }),
        yuru,
        minibus({ saat: '2026-09-22T09:25:00+03:00', metre: 3000 }),
        yuru,
        bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T09:50:00+03:00' }),
      ],
      'tam',
    );
    assert.equal(u.bacaklar[2]?.tutar, 4300, 'ikinci biniş de olsa minibüs tam tarife');
    assert.equal(u.bacaklar[4]?.etiket, '1. aktarma', 'metro, otobüsten sonraki ilk aktarma');
    assert.equal(u.toplam, 4620 + 4300 + 3440);
  });

  it('ilk binişse İstanbulkart penceresini başlatmaz', () => {
    const u = yolculukUcreti(
      [
        minibus({ saat: '2026-09-22T07:00:00+03:00', metre: 3000 }),
        bacak({ saat: '2026-09-22T08:30:00+03:00' }),
        bacak({ kod: 'M4', mod: 'SUBWAY', saat: '2026-09-22T09:10:00+03:00' }),
      ],
      'tam',
    );
    assert.equal(u.bacaklar[1]?.etiket, 'İlk biniş');
    assert.equal(u.bacaklar[2]?.etiket, '1. aktarma', 'pencere otobüsle 08:30\'da başladı, dolmadı');
    assert.equal(u.yeniYolculuk, 0);
  });

  it('gece tarifesi minibüse uygulanmaz', () => {
    const u = yolculukUcreti([minibus({ saat: '2026-09-22T01:30:00+03:00', metre: 3000 })], 'tam');
    assert.equal(u.toplam, 4300);
    assert.equal(u.geceTarifesi, false);
  });

  it('yol uzunluğu yoksa kuş uçuşu mesafeden tahmin eder', () => {
    const u = yolculukUcreti([minibus({ metre: null })], 'tam');
    // Test bacağında biniş-iniş arası ~13,9 km kuş uçuşu; ×1,3 → ~18 km.
    assert.equal(u.toplam, 5200);
  });

  it('öğrenci kartıyla 28 ₺', () => {
    assert.equal(yolculukUcreti([minibus({ metre: 16000 })], 'ogrenci').toplam, 2800);
  });

  it('dolmuş minibüs sayılmaz', () => {
    const u = yolculukUcreti([bacak({ isletmeci: 'Taksi Dolmus' })], 'tam');
    assert.equal(u.minibus, false);
  });
});
