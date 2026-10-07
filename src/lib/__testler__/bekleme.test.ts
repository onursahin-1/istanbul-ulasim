// Bekleme seçenekleri, binilen hat ve durak saatleri (bekleme.ts).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aracVarislariniKat, ayniYoldanMi, duruyorYaz, gosterilecekAraclar, kalkislaraAracKat, beklemeSecenekleri, binilenHatTahmini, durakOranlari, durakSaatleri, paylasimMetni } from '../bekleme';
import type { DurakKalkisi, Hat, Kalkis } from '../otp';

const dk = 60_000;
const T = 1_800_000_000_000;

function kalkis(kisaAd: string, dakika: number, ek: Partial<DurakKalkisi> = {}): DurakKalkisi {
  return {
    an: T + dakika * dk,
    serviceDay: 0,
    saniye: 0,
    canli: false,
    seferId: `${kisaAd}-${dakika}`,
    hatId: `r-${kisaAd}`,
    kisaAd,
    uzunAd: `${kisaAd} uzun ad`,
    mode: 'BUS',
    isletmeci: 'IETT',
    yon: null,
    ...ek,
  };
}

const LISTE = [
  kalkis('141M', 11),
  kalkis('97M', 4, { canli: true }),
  kalkis('34', 2),
  kalkis('97M', 18),
  kalkis('97M', 31),
  kalkis('97M', 44),
  kalkis('141M', 26),
  kalkis('97M', -3),
];

describe('beklemeSecenekleri', () => {
  it('her hat kendi satırında, ilk kalkana göre sıralı; başka hatlar ve geçmiş kalkışlar yok', () => {
    const s = beklemeSecenekleri(LISTE, ['97M', '141M'], T);
    assert.deepEqual(
      s.map((x) => [x.kisaAd, x.kalkislar.map((k) => (k.an - T) / dk)]),
      [
        ['97M', [4, 18, 31]],
        ['141M', [11, 26]],
      ],
    );
    assert.equal(s[0].kalkislar[0].canli, true);
    assert.equal(s[0].ad, '97M uzun ad');
  });

  it('birkaç dakika arayla canlı ve tarife iki kalkış tek otobüs (canlı kalır)', () => {
    const liste = [kalkis('141M', 2), kalkis('141M', 3, { canli: true }), kalkis('141M', 17)];
    const s = beklemeSecenekleri(liste, ['141M'], T);
    assert.deepEqual(s[0].kalkislar.map((k) => [(k.an - T) / dk, k.canli]), [
      [3, true],
      [17, false],
    ]);
  });

  it('planlanan hatta yalnız aynı desen (kısa servis seferi yok); kalkışı olmayan hat sona', () => {
    const liste = [kalkis('97M', 3, { desen: 'kisa' }), kalkis('97M', 9, { desen: 'p1' }), kalkis('141M', 5)];
    const s = beklemeSecenekleri(liste, ['97M', '141M', '41E'], T, { desen: 'p1', yon: 'Mecidiyeköy' });
    assert.deepEqual(
      s.map((x) => [x.kisaAd, x.kalkislar.map((k) => (k.an - T) / dk)]),
      [
        ['141M', [5]],
        ['97M', [9]],
        ['41E', []],
      ],
    );
  });
});

describe('ayniYoldanMi', () => {
  it('aynı hattın başka güzergâh kaydı (başka desen) aynı yöne gidiyorsa aynı yol; kısa servis değil', () => {
    const hat = { kisaAd: '141M', desen: 'p1', yon: 'Mecidiyeköy Metrobüs' };
    assert.equal(ayniYoldanMi(kalkis('141M', 3, { desen: 'p1' }), hat), true);
    assert.equal(ayniYoldanMi(kalkis('141M', 3, { desen: 'p7', yon: 'MECİDİYEKÖY METROBÜS ' }), hat), true);
    assert.equal(ayniYoldanMi(kalkis('141M', 3, { desen: 'p9', yon: 'Mahmutbey' }), hat), false);
    assert.equal(ayniYoldanMi(kalkis('97M', 3, { desen: 'p1' }), hat), false);
  });
});

describe('aracVarislariniKat', () => {
  const arac = (kapiNo: string, dakika: number, kalanDurak: number) => ({
    kapiNo,
    varis: T + dakika * dk,
    kalanDurak,
    yasSn: 20,
    enlem: 41,
    boylam: 29,
    ogrenilen: 1,
  });

  it('gelen otobüsler canlı kalkış olur; onlardan önceki tarife ve yanlış sefer tabanlı canlı atılır', () => {
    // Tarife: 141M 1, 21, 41 dk; sefer tabanlı "canlı" 38 dk (yanlış sefere bağlanmış).
    // Gerçekte iki otobüs 5 ve 11 dk uzakta (Otobüsüm Nerede'deki gibi).
    const liste = [kalkis('141M', 1), kalkis('141M', 21), kalkis('141M', 38, { canli: true }), kalkis('97M', 13)];
    const sonuc = aracVarislariniKat(liste, { '141M': [arac('B-1799', 5, 3), arac('A-1715', 11, 7)] });
    assert.deepEqual(
      sonuc.map((k) => [k.kisaAd, (k.an - T) / dk, k.kapiNo ?? null, k.canli]),
      [
        ['141M', 5, 'B-1799', true],
        ['141M', 11, 'A-1715', true],
        ['97M', 13, null, false],
        ['141M', 21, null, false],
        ['141M', 38, null, true],
      ],
    );
    assert.ok(sonuc[0].seferId.startsWith('arac:'));
  });

  it('otobüs görülmeyen hat olduğu gibi kalır', () => {
    const liste = [kalkis('97M', 13)];
    assert.equal(aracVarislariniKat(liste, {}), liste);
  });
});

describe('binilenHatTahmini', () => {
  it('biniş anına en yakın kalkış; 5 dk içinde yoksa bilinmez', () => {
    assert.deepEqual(binilenHatTahmini(LISTE, ['97M', '141M'], T + 10 * dk), { kisaAd: '141M', seferId: '141M-11' });
    assert.equal(binilenHatTahmini(LISTE, ['97M', '141M'], T + 70 * dk), null);
  });
});

describe('durakOranlari / durakSaatleri', () => {
  const n = (e: number, id: string) => ({ latitude: 41 + e, longitude: 29, gtfsId: id });
  // 4 durak, eşit aralıklı (mesafe), ama tarifede ilk ara uzun (trafik).
  const DURAKLAR = [n(0, 'a'), n(0.003, 'b'), n(0.006, 'c'), n(0.009, 'd')];

  it('tarife yoksa mesafeden', () => {
    assert.deepEqual(durakOranlari(DURAKLAR).map((x) => Math.round(x * 100) / 100), [0, 0.33, 0.67, 1]);
  });

  it('tarife varsa saatlerden; bilinmeyen ara durak mesafeyle', () => {
    const saatler = new Map([
      ['a', 1000],
      ['b', 1600],
      ['d', 1900],
    ]);
    assert.deepEqual(durakOranlari(DURAKLAR, saatler).map((x) => Math.round(x * 100) / 100), [0, 0.67, 0.83, 1]);
  });

  it('plan: biniş ile iniş arası oranlara göre', () => {
    const s = durakSaatleri([0, 0.5, 1], T, T + 20 * dk);
    assert.deepEqual(s.map((x) => (x - T) / dk), [0, 10, 20]);
  });

  it('araçta geride kalınca sıradaki duraklar ve iniş kayar; geçilenler kaymaz', () => {
    // 14. dakikada hâlâ 1. durağa yeni varıldı (plan 10): 4 dk gecikme.
    const s = durakSaatleri([0, 0.5, 1], T, T + 20 * dk, 1, T + 14 * dk);
    assert.deepEqual(s.map((x) => (x - T) / dk), [0, 10, 24]);
    // Önde gidiyorsa öne çekilmez.
    const o = durakSaatleri([0, 0.5, 1], T, T + 20 * dk, 1.5, T + 12 * dk);
    assert.deepEqual(o.map((x) => (x - T) / dk), [0, 10, 20]);
  });
});

describe('paylasimMetni', () => {
  it('varış, hedef ve hatlar', () => {
    assert.equal(paylasimMetni('Seyrantepe', '10:05', ['97M', '500L', '27SE']), 'Tahmini varışım 10:05 · Seyrantepe (97M → 500L → 27SE)');
    assert.equal(paylasimMetni(null, '10:05', []), 'Tahmini varışım 10:05');
  });
});

describe('kalkislaraAracKat (yakındaki duraklar)', () => {
  // Göztepe Meydanı, İkitelli yönü (2026-10-07 17:34): OTP 97GE'yi "şimdi", 141M'yi 7 dk
  // diyordu; durak ekranı (araçtan) 91E şimdi, 141M 2 dk, 97GE 4 dk.
  const hat = (kisa: string, id: string, uzun: string): Hat => ({ gtfsId: `1:${id}`, shortName: kisa, longName: uzun, mode: 'BUS' });
  const HATLAR = [
    hat('97GE', '501', '15 TEMMUZ MAH. - SELEN SOKAK'),
    hat('141M', '502', 'MECİDİYEKÖY - KANUNİ SULTAN SÜLEYMAN'),
    hat('91E', '503', 'GÖZTEPE MAHALLESİ - AKSARAY RİNG'),
    hat('91E', '504', 'AKSARAY RİNG - GÖZTEPE MAHALLESİ'),
  ];
  const gun = Math.floor(T / 1000) - 10 * 3600;
  const otp = (h: Hat, dakika: number, yon: string): Kalkis => {
    const sn = Math.floor(T / 1000) - gun + dakika * 60;
    return {
      scheduledDeparture: sn,
      realtimeDeparture: sn,
      realtime: true,
      serviceDay: gun,
      headsign: yon,
      trip: { gtfsId: `sefer-${h.shortName}-${dakika}`, route: h, pattern: { code: `d-${h.gtfsId}`, headsign: yon } },
    };
  };
  const arac = (kapiNo: string, dakika: number, rotaId?: string) => ({
    kapiNo,
    rotaId,
    varis: T + dakika * dk,
    kalanDurak: 3,
    yasSn: 20,
    enlem: 41,
    boylam: 29,
    ogrenilen: 1,
  });
  const ozet = (l: Kalkis[]) =>
    l.map((k) => [k.trip?.route.shortName, Math.round(((k.serviceDay ?? 0) + (k.realtimeDeparture ?? 0) - T / 1000) / 60), k.trip?.gtfsId.startsWith('arac:')]);

  it('otobüsü görülen hatta OTP kalkışı otobüsle değişir, OTP\'de olmayan hat da eklenir', () => {
    const liste = [otp(HATLAR[0], 0, 'SELEN SOKAK'), otp(HATLAR[1], 7, 'KANUNİ SULTAN SÜLEYMAN'), otp(HATLAR[1], 27, 'KANUNİ SULTAN SÜLEYMAN')];
    const sonuc = kalkislaraAracKat(
      liste,
      HATLAR,
      { '97GE': [arac('A-1', 4)], '141M': [arac('B-2', 2)], '91E': [arac('C-3', 0, '503')] },
      T,
    );
    assert.deepEqual(ozet(sonuc), [
      ['91E', 0, true],
      ['141M', 2, true],
      ['97GE', 4, true],
      // Son görülen otobüsten 3 dk'dan sonraki OTP kalkışı kalır (durak ekranındaki kural):
      // henüz yola çıkmamış bir otobüs olabilir.
      ['141M', 7, false],
      ['141M', 27, false],
    ]);
    // 91E OTP'de yoktu: hat aracın güzergâh kaydından, yön güzergâhın adından.
    assert.equal(sonuc[0].trip?.route.gtfsId, '1:503');
    assert.equal(sonuc[0].trip?.pattern?.headsign, 'GÖZTEPE MAHALLESİ - AKSARAY RİNG');
    // Aynı güzergâhın OTP kalkışı varsa yön etiketi ondan.
    assert.equal(sonuc[1].trip?.pattern?.headsign, 'KANUNİ SULTAN SÜLEYMAN');
  });

  it('köprüde veri yoksa ya da otobüs durağı çoktan geçmişse liste olduğu gibi', () => {
    const liste = [otp(HATLAR[1], 7, 'KANUNİ SULTAN SÜLEYMAN')];
    assert.equal(kalkislaraAracKat(liste, HATLAR, {}, T), liste);
    assert.equal(kalkislaraAracKat(liste, HATLAR, { '141M': [arac('B-2', -5)] }, T), liste);
  });

  it('durağın hatlarında olmayan araç eklenmez', () => {
    const liste = [otp(HATLAR[1], 7, 'KANUNİ SULTAN SÜLEYMAN')];
    assert.deepEqual(ozet(kalkislaraAracKat(liste, HATLAR, { '500T': [arac('X-9', 1)] }, T)), [['141M', 7, false]]);
  });
});

describe('duran otobüs', () => {
  const arac = (kapiNo: string, dakika: number, duruyorSn: number | null = null, kalanDurak = 2) => ({
    kapiNo,
    varis: T + dakika * dk,
    kalanDurak,
    yasSn: 20,
    enlem: 41,
    boylam: 29,
    ogrenilen: 1,
    duruyorSn,
  });

  it('gosterilecekAraclar: hareket eden varken duran ana olmaz; yalnız duran varsa o', () => {
    const d = arac('A-1627', 0, 540);
    const h = arac('A-1612', 11);
    assert.deepEqual(gosterilecekAraclar([d, h]), { ana: [h], duran: d });
    assert.deepEqual(gosterilecekAraclar([d]), { ana: [d], duran: d });
    assert.deepEqual(gosterilecekAraclar([h]), { ana: [h], duran: null });
  });

  it('duruyorYaz', () => {
    assert.equal(duruyorYaz(540), "9 dk'dır");
    assert.equal(duruyorYaz(20), "1 dk'dır");
    assert.equal(duruyorYaz(65 * 60), "1 sa 5 dk'dır");
    assert.equal(duruyorYaz(120 * 60), '2 saattir');
  });

  it('bekleme kartı: duran otobüs kalkış olmaz, arkasındaki gelir; tarife ikisinden sonra', () => {
    const liste = [kalkis('97GE', 3), kalkis('97GE', 25)];
    const sonuc = aracVarislariniKat(liste, { '97GE': [arac('A-1627', 0, 540), arac('A-1612', 11)] });
    assert.deepEqual(
      sonuc.map((k) => [(k.an - T) / dk, k.kapiNo ?? null, k.canli]),
      [
        [11, 'A-1612', true],
        [25, null, false],
      ],
    );
  });

  it('bekleme kartı: tek otobüs duruyorsa en erken varışıyla, canlı sayılmadan', () => {
    const sonuc = aracVarislariniKat([kalkis('89T', 30)], { '89T': [arac('B5021', 4, 720, 3)] });
    assert.equal(sonuc[0].kapiNo, 'B5021');
    assert.equal(sonuc[0].canli, false);
    assert.equal(sonuc[0].duruyorSn, 720);
  });
});
