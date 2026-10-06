// Canlı yol tarifinin adım hesabının testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adimlariKur,
  aktarmaPayi,
  baslangicDurumu,
  binmeIfadesi,
  kalanSureYaz,
  yolaCikisAni,
  yuruyusKonumu,
  durakSozcugu,
  durumuIlerlet,
  siradakiDuraklar,
  yenidenCizilmeli,
  durumuZamanla,
  zamanlaIlerleme,
  konumlaIlerleme,
  KALKIS_PAYI_MS,
  INIS_PAYI_MS,
  YENIDEN_CIZ_ARA_MS,
  type BacakOzeti,
} from '../yolculuk';

// Kuzeye giden bir hat: 0.001° enlem ≈ 111 m.
const n = (enlem: number, boylam = 29) => ({ latitude: 41 + enlem, longitude: boylam });

// Yürü → 89T (4 durak) → aktarma yürüyüşü → 28T (3 durak) → varışa yürü
const BACAKLAR: BacakOzeti[] = [
  { arac: false, mesafe: 90, bitis: n(0), duraklar: [] },
  { arac: true, mesafe: 3000, bitis: n(0.03), duraklar: [n(0), n(0.01), n(0.02), n(0.03)] },
  { arac: false, mesafe: 150, bitis: n(0.03, 29.002), duraklar: [] },
  { arac: true, mesafe: 2000, bitis: n(0.03, 29.04), duraklar: [n(0.03, 29.002), n(0.03, 29.02), n(0.03, 29.04)] },
  { arac: false, mesafe: 240, bitis: n(0.032, 29.04), duraklar: [] },
];
const ADIMLAR = adimlariKur(BACAKLAR);

describe('adimlariKur', () => {
  it('yürüyüşlerin rolünü ayırır', () => {
    assert.deepEqual(ADIMLAR, [
      { bacak: 0, tur: 'yuru', rol: 'baslangic' },
      { bacak: 1, tur: 'arac' },
      { bacak: 2, tur: 'yuru', rol: 'aktarma' },
      { bacak: 3, tur: 'arac' },
      { bacak: 4, tur: 'yuru', rol: 'varis' },
    ]);
  });

  it('kısa yürüyüşleri atlar, baştan sona yürüyüşü tek adım sayar', () => {
    assert.deepEqual(
      adimlariKur([
        { arac: true, mesafe: 1000 },
        { arac: false, mesafe: 12 },
        { arac: true, mesafe: 1000 },
      ]).map((a) => a.tur),
      ['arac', 'arac'],
    );
    assert.deepEqual(adimlariKur([{ arac: false, mesafe: 800 }]), [{ bacak: 0, tur: 'yuru', rol: 'tek' }]);
  });
});

/** Durumu karşılaştırmak için: kesirli ilerleme iki basamağa yuvarlanır. */
const yuvarla = (d: ReturnType<typeof baslangicDurumu>) =>
  d.ilerleme == null ? d : { ...d, ilerleme: Math.round(d.ilerleme * 100) / 100 };

describe('durumuIlerlet', () => {
  const ilerlet = (d: ReturnType<typeof baslangicDurumu>, ...konumlar: ReturnType<typeof n>[]) =>
    konumlar.reduce((x, k) => durumuIlerlet(x, k, ADIMLAR, BACAKLAR), d);

  it('yürüyüş bitince binişi beklemeye geçer', () => {
    const d0 = baslangicDurumu(ADIMLAR);
    assert.equal(d0.faz, 'yuru');
    assert.equal(ilerlet(d0, n(-0.002)), d0); // durağa ~220 m: değişmez, aynı nesne
    assert.deepEqual(ilerlet(d0, n(-0.0003)), { adim: 1, faz: 'bekle', kalanDurak: null, durakta: false });
  });

  it('biniş durağında beklerken "içinde" sayılmaz, sonraki durağa gelince sayılır', () => {
    const bekle = ilerlet(baslangicDurumu(ADIMLAR), n(0));
    assert.equal(ilerlet(bekle, n(0.0002)).faz, 'bekle');
    assert.deepEqual(yuvarla(ilerlet(bekle, n(0.01))), { adim: 1, faz: 'icinde', kalanDurak: 2, durakta: false, ilerleme: 1 });
  });

  it('kalan durak geri saymaz; inişe varıp uzaklaşınca aktarmaya geçer', () => {
    const icinde = ilerlet(baslangicDurumu(ADIMLAR), n(0), n(0.02));
    assert.equal(icinde.kalanDurak, 1);
    assert.equal(ilerlet(icinde, n(0.01)).kalanDurak, 1); // GPS geri kaydı
    const inis = ilerlet(icinde, n(0.03));
    assert.deepEqual(yuvarla(inis), { adim: 1, faz: 'icinde', kalanDurak: 0, durakta: true, ilerleme: 3 });
    assert.deepEqual(ilerlet(inis, n(0.03, 29.001)), { adim: 2, faz: 'yuru', kalanDurak: null, durakta: false });
  });

  it('arada konum gelmediyse sıradaki aracın duraklarına atlar', () => {
    const d0 = baslangicDurumu(ADIMLAR);
    assert.deepEqual(yuvarla(ilerlet(d0, n(0.02))), { adim: 1, faz: 'icinde', kalanDurak: 1, durakta: false, ilerleme: 2 });
  });

  it('duraklar arasında kesirli ilerler; durağa varmadan o durak sayılmaz', () => {
    const icinde = ilerlet(baslangicDurumu(ADIMLAR), n(0), n(0.01));
    const arada = ilerlet(icinde, n(0.014));
    assert.equal(yuvarla(arada).ilerleme, 1.4);
    assert.equal(arada.kalanDurak, 2, '2. duraktan %40 ileride: kalan hâlâ 2');
    const yaklasti = ilerlet(icinde, n(0.0188));
    assert.equal(yaklasti.kalanDurak, 1, '%88: sıradaki durakta sayılır');
    assert.equal(ilerlet(arada, n(0.012)).ilerleme, arada.ilerleme, 'geri gitmez');
  });

  it('son yürüyüş bitince varıldı', () => {
    const son = { adim: 4, faz: 'yuru' as const, kalanDurak: null, durakta: false };
    assert.equal(ilerlet(son, n(0.032, 29.04)).faz, 'vardi');
  });
});

describe('aktarmaPayi', () => {
  it('dakika, aşağı yuvarlanır', () => {
    assert.equal(aktarmaPayi(0, 4.5 * 60_000), 4);
    assert.equal(aktarmaPayi(0, -30_000), -1);
  });
});

describe('siradakiDuraklar', () => {
  it('az kaldıysa hepsini, çoksa ilk ikisini, boşluğu ve inişi verir', () => {
    assert.deepEqual(siradakiDuraklar(10, 2), [8, 9]);
    assert.deepEqual(siradakiDuraklar(10, 3), [7, 8, 9]);
    assert.deepEqual(siradakiDuraklar(10, 6), [4, 5, -1, 9]);
    assert.deepEqual(siradakiDuraklar(10, 0), []);
  });
});

describe('binmeIfadesi', () => {
  it('araç tipine ve işletmeciye göre', () => {
    assert.equal(binmeIfadesi('BUS'), 'otobüsüne bin');
    assert.equal(binmeIfadesi('SUBWAY'), 'metrosuna bin');
    assert.equal(binmeIfadesi('FERRY'), 'vapuruna bin');
    assert.equal(binmeIfadesi('BUS', 'Minibus'), 'minibüsüne bin');
    assert.equal(binmeIfadesi(null), 'hattına bin');
  });
});

describe('yuruyusKonumu', () => {
  // Kuzeye ~100 m, sonra doğuya ~100 m (L şeklinde bir yürüyüş); ikinci adım "sağa dön".
  const cizgi = [
    { latitude: 41, longitude: 29 },
    { latitude: 41.0009, longitude: 29 },
    { latitude: 41.0009, longitude: 29.0012 },
  ];
  const adimlar = [{ metre: 100 }, { metre: 100 }];

  it('bulunulan adım ve dönüşe yol boyunca kalan metre', () => {
    const r = yuruyusKonumu(adimlar, cizgi, { latitude: 41.0005, longitude: 29.00005 });
    assert.equal(r?.simdiki, 0);
    assert.ok(r && r.sonrakine > 40 && r.sonrakine < 55, `${r?.sonrakine}`);
    assert.ok(r && r.rotadan < 10);
  });

  it('dönüşü geçince sonraki adım; kalan bacağın sonuna', () => {
    const r = yuruyusKonumu(adimlar, cizgi, { latitude: 41.0009, longitude: 29.0006 });
    assert.equal(r?.simdiki, 1);
    assert.ok(r && r.sonrakine > 45 && r.sonrakine < 55, `${r?.sonrakine}`);
  });

  it('köşeyi kuş uçuşu kesmez: dönüşe 5 m kala hâlâ ilk adımdayız', () => {
    const r = yuruyusKonumu(adimlar, cizgi, { latitude: 41.00085, longitude: 29 });
    assert.equal(r?.simdiki, 0);
    assert.ok(r && r.sonrakine <= 10, `${r?.sonrakine}`);
  });

  it('adım mesafeleri çizgiyle tutmasa da ölçekler', () => {
    const r = yuruyusKonumu([{ metre: 60 }, { metre: 60 }], cizgi, { latitude: 41.0005, longitude: 29 });
    assert.equal(r?.simdiki, 0);
  });

  it('çizgiden uzaklaşınca sapmayı verir', () => {
    const r = yuruyusKonumu(adimlar, cizgi, { latitude: 41.0003, longitude: 29.0008 });
    assert.ok(r && r.rotadan > 55, `${r?.rotadan}`);
  });

  it('çizgi ya da adım yoksa null', () => {
    assert.equal(yuruyusKonumu([], cizgi, cizgi[0]), null);
    assert.equal(yuruyusKonumu(adimlar, [cizgi[0]], cizgi[0]), null);
  });
});

describe('süre yazımı', () => {
  it('saat ve dakika', () => {
    assert.equal(kalanSureYaz(45), '45 dk');
    assert.equal(kalanSureYaz(120), '2 sa');
    assert.equal(kalanSureYaz(590), '9 sa 50 dk');
  });

  it('yola çıkış: kalkıştan yürüme ve 2 dk pay düşülür', () => {
    assert.equal(yolaCikisAni(60 * 60_000, 300), 60 * 60_000 - 300_000 - 120_000);
  });
});

describe('yenidenCizilmeli', () => {
  // Kuzeye 300 m'lik yürüyüş; sonunda durak.
  const cizgi = [n(0), n(0.0027)];
  const temel = {
    durum: { adim: 0, faz: 'yuru' as const, kalanDurak: null, durakta: false },
    adim: { bacak: 0, tur: 'yuru' as const, rol: 'baslangic' as const },
    ilkKonum: false,
    konum: n(0.001),
    cizgi,
    bitis: n(0.0027),
    dogruluk: 10,
    simdi: 1_000_000,
    sonCizim: null,
  };
  // 0.0005° boylam ≈ 42 m (41. enlemde).
  const yanda = (enlem: number, boylamFarki: number) => n(enlem, 29 + boylamFarki);

  it('çizginin üstünde yürürken çizilmez', () => {
    assert.equal(yenidenCizilmeli(temel), false);
  });
  it('yolculuğun ilk konumu başlangıçtan uzaksa çizgi oradan başlar', () => {
    assert.equal(yenidenCizilmeli({ ...temel, ilkKonum: true, konum: yanda(0, 0.0005) }), true);
    assert.equal(yenidenCizilmeli({ ...temel, ilkKonum: true, konum: n(0.00005) }), false, '~6 m: aynı yer');
  });
  it('ilk konum değilse yalnız çizgiden sapma sayılır', () => {
    assert.equal(yenidenCizilmeli({ ...temel, konum: n(0.0015) }), false);
    assert.equal(yenidenCizilmeli({ ...temel, konum: yanda(0.0015, 0.0005) }), true);
  });
  it('kötü doğrulukta, kısa arayla ya da durağa varmışken çizilmez', () => {
    const sapmis = { ...temel, konum: yanda(0.0015, 0.0005) };
    assert.equal(yenidenCizilmeli({ ...sapmis, dogruluk: 60 }), false);
    assert.equal(yenidenCizilmeli({ ...sapmis, sonCizim: temel.simdi - YENIDEN_CIZ_ARA_MS + 1 }), false);
    assert.equal(yenidenCizilmeli({ ...sapmis, sonCizim: temel.simdi - YENIDEN_CIZ_ARA_MS }), true);
    assert.equal(yenidenCizilmeli({ ...temel, ilkKonum: true, konum: yanda(0.0027, 0.0003) }), false);
  });
  it('araçtayken ya da beklerken çizilmez', () => {
    const sapmis = { ...temel, konum: yanda(0.0015, 0.0005) };
    assert.equal(yenidenCizilmeli({ ...sapmis, durum: { ...temel.durum, faz: 'bekle' } }), false);
    assert.equal(yenidenCizilmeli({ ...sapmis, adim: { bacak: 0, tur: 'arac' } }), false);
  });
});

describe('durakSozcugu', () => {
  it('otobüs durak, raylı istasyon, vapur iskele', () => {
    assert.equal(durakSozcugu('BUS').desin, 'durağındasın');
    assert.equal(durakSozcugu('SUBWAY').desin, 'istasyonundasın');
    assert.equal(durakSozcugu('RAIL').e, 'istasyonuna');
    assert.equal(durakSozcugu('TRAM').de, 'istasyonunda');
    assert.equal(durakSozcugu('FERRY').desin, 'iskelesindesin');
    assert.equal(durakSozcugu('FERRY').ad, 'iskelesi');
    assert.equal(durakSozcugu(null).e, 'durağına');
  });
});

describe('konumlaIlerleme / zamanlaIlerleme', () => {
  const duraklar = [n(0), n(0.01), n(0.03)]; // ilk ara 1,1 km, ikinci 2,2 km
  it('konum duraklar çizgisine izdüşer; çizgiden uzaksa null', () => {
    assert.equal(Math.round(konumlaIlerleme(duraklar, n(0.005))! * 100) / 100, 0.5);
    assert.equal(Math.round(konumlaIlerleme(duraklar, n(0.02, 29.0005))! * 100) / 100, 1.5);
    assert.equal(konumlaIlerleme(duraklar, n(0.02, 29.01)), null);
  });
  it('saatle tahmin mesafeye göre bölüşür', () => {
    // Toplam 3,3 km, 30 dk: 10. dakikada 1,1 km → tam 1. durak.
    const t0 = 1_000_000;
    assert.equal(zamanlaIlerleme(duraklar, t0, t0 + 30 * 60_000, t0 - 60_000), 0);
    assert.equal(Math.round(zamanlaIlerleme(duraklar, t0, t0 + 30 * 60_000, t0 + 10 * 60_000) * 100) / 100, 1);
    assert.equal(Math.round(zamanlaIlerleme(duraklar, t0, t0 + 30 * 60_000, t0 + 20 * 60_000) * 100) / 100, 1.5);
    assert.equal(zamanlaIlerleme(duraklar, t0, t0 + 30 * 60_000, t0 + 40 * 60_000), 2);
  });
});

describe('durumuZamanla', () => {
  const t0 = 5_000_000;
  // BACAKLAR'ın 89T bacağı: 3,3 km, 15 dakika.
  const zamanli = BACAKLAR.map((b, i) => (i === 1 ? { ...b, binisMs: t0, inisMs: t0 + 15 * 60_000 } : b));
  const bekle = { adim: 1, faz: 'bekle' as const, kalanDurak: null, durakta: false };

  it('kalkış geçip konum gelmiyorsa binilmiş sayar ve saate göre ilerletir', () => {
    assert.equal(durumuZamanla(bekle, t0 + 10_000, ADIMLAR, zamanli, null), bekle, 'kalkışa daha var');
    const d = durumuZamanla(bekle, t0 + KALKIS_PAYI_MS + 1, ADIMLAR, zamanli, null);
    assert.equal(d.faz, 'icinde');
    const yarisi = durumuZamanla(d, t0 + 7.5 * 60_000, ADIMLAR, zamanli, null);
    assert.equal(Math.round(yarisi.ilerleme! * 100) / 100, 1.5);
    assert.equal(yarisi.kalanDurak, 2);
  });

  it('taze ve iyi konum varken karışmaz (durakta bekleyen metroyu kaçırmış olabilir)', () => {
    const gps = { an: t0 + KALKIS_PAYI_MS - 5_000, dogruluk: 10 };
    assert.equal(durumuZamanla(bekle, t0 + KALKIS_PAYI_MS + 1, ADIMLAR, zamanli, gps), bekle);
    // Kaba konum da gelmeye devam ediyorsa (bina içi) saat "bindin" demez; konum kararı verir.
    const kaba = { ...gps, dogruluk: 80 };
    assert.equal(durumuZamanla(bekle, t0 + KALKIS_PAYI_MS + 1, ADIMLAR, zamanli, kaba), bekle);
    // Konum kesildi: durağın yanında kesildiyse binilmiş sayılır, uzakta kesildiyse sayılmaz.
    const kesik = { an: t0 - 60_000, dogruluk: 10, konum: n(0) };
    assert.equal(durumuZamanla(bekle, t0 + KALKIS_PAYI_MS + 1, ADIMLAR, zamanli, kesik).faz, 'icinde');
    const uzakta = { ...kesik, konum: n(-0.01) };
    assert.equal(durumuZamanla(bekle, t0 + KALKIS_PAYI_MS + 1, ADIMLAR, zamanli, uzakta), bekle);
  });

  it('inişe varınca durakta; konum hiç gelmezse bir süre sonra sonraki adıma geçer', () => {
    const icinde = durumuZamanla(bekle, t0 + 15 * 60_000, ADIMLAR, zamanli, null);
    assert.equal(icinde.durakta, true);
    assert.equal(durumuZamanla(icinde, t0 + 15 * 60_000 + 30_000, ADIMLAR, zamanli, null), icinde);
    assert.equal(durumuZamanla(icinde, t0 + 15 * 60_000 + INIS_PAYI_MS + 1, ADIMLAR, zamanli, null).adim, 2);
  });
});
