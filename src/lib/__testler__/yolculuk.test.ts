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
  durumuIlerlet,
  siradakiDuraklar,
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
    assert.deepEqual(ilerlet(bekle, n(0.01)), { adim: 1, faz: 'icinde', kalanDurak: 2, durakta: false });
  });

  it('kalan durak geri saymaz; inişe varıp uzaklaşınca aktarmaya geçer', () => {
    const icinde = ilerlet(baslangicDurumu(ADIMLAR), n(0), n(0.02));
    assert.equal(icinde.kalanDurak, 1);
    assert.equal(ilerlet(icinde, n(0.01)).kalanDurak, 1); // GPS geri kaydı
    const inis = ilerlet(icinde, n(0.03));
    assert.deepEqual(inis, { adim: 1, faz: 'icinde', kalanDurak: 0, durakta: true });
    assert.deepEqual(ilerlet(inis, n(0.03, 29.001)), { adim: 2, faz: 'yuru', kalanDurak: null, durakta: false });
  });

  it('arada konum gelmediyse sıradaki aracın duraklarına atlar', () => {
    const d0 = baslangicDurumu(ADIMLAR);
    assert.deepEqual(ilerlet(d0, n(0.02)), { adim: 1, faz: 'icinde', kalanDurak: 1, durakta: false });
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
