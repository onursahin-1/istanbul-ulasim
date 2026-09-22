import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HAREKET_ESIGI_M, IZ_OMRU_MS, KonumIzi, koridorFarki, koridoraGoreSuz, yonluAdaylar } from '../yon.mjs';

// Doğu-batı uzanan bir cadde; beş durak ~500 m arayla. Gidiş batıdan doğuya,
// dönüş aynı caddenin karşı yakasından (20 m kuzey) doğudan batıya.
const ENLEM = 41.0;
const boylam = (i) => 29.0 + i * 0.006;   // ~500 m
function sahteTarife() {
  const durakEnlem = [];
  const durakBoylam = [];
  const rotaDuraklari = new Map();
  const ekle = (rota, noktalar) => {
    rotaDuraklari.set(rota, noktalar.map(([e, b], sira) => {
      durakEnlem.push(e);
      durakBoylam.push(b);
      return { durak: durakEnlem.length - 1, sira: sira + 1 };
    }));
  };
  ekle(0, [0, 1, 2, 3, 4].map((i) => [ENLEM, boylam(i)]));                 // gidiş
  ekle(1, [4, 3, 2, 1, 0].map((i) => [ENLEM + 0.00018, boylam(i)]));       // dönüş
  ekle(2, [0, 1, 2].map((i) => [ENLEM, boylam(i)]));                       // gidişin kısa varyantı
  return { durakEnlem, durakBoylam, rotaDuraklari, rotaEsik: new Map() };
}
const T = sahteTarife();
const nokta = (i, kuzey = 0) => ({ enlem: ENLEM + kuzey, boylam: boylam(i) });

describe('yonluAdaylar', () => {
  it('batıdan doğuya giden aracı gidiş varyantlarına koyar, dönüşü eler', () => {
    const r = yonluAdaylar(T, [0, 1, 2], nokta(0.1), nokta(1.9));
    assert.deepEqual(r.map((x) => x.rota).sort(), [0, 2]);
  });

  it('doğudan batıya giden aracı dönüşe koyar', () => {
    const r = yonluAdaylar(T, [0, 1, 2], nokta(3.9, 0.00018), nokta(2.1, 0.00018));
    assert.deepEqual(r.map((x) => x.rota), [1]);
  });

  it('duran araçta karar vermez', () => {
    assert.deepEqual(yonluAdaylar(T, [0, 1, 2], nokta(2), nokta(2.02)), []);
  });

  it('güzergâhın çok dışındaki araçta aday bulmaz', () => {
    const uzak = { enlem: ENLEM + 0.05, boylam: boylam(2) };   // ~5,5 km kuzeyde
    assert.deepEqual(yonluAdaylar(T, [0, 1, 2], uzak, { ...uzak, boylam: boylam(3) }), []);
  });

  it('şimdiki durağı ve sırasını döndürür', () => {
    const [ilk] = yonluAdaylar(T, [0], nokta(0.1), nokta(2.9));
    assert.equal(ilk.sira, 4);
  });

  it('boş aday listesinde çökmez', () => {
    assert.deepEqual(yonluAdaylar(T, undefined, nokta(0), nokta(1)), []);
  });
});

describe('KonumIzi', () => {
  it('duran aracın eski konumunu korur, hareket edince yeniler', () => {
    const iz = new KonumIzi();
    iz.guncelle('A', ENLEM, boylam(0), 0);
    iz.guncelle('A', ENLEM, boylam(0) + 0.0005, 60_000);      // ~40 m: duruyor sayılır
    assert.equal(iz.onceki('A', 60_000).boylam, boylam(0));
    iz.guncelle('A', ENLEM, boylam(1), 120_000);               // ~500 m: hareket
    assert.equal(iz.onceki('A', 120_000).boylam, boylam(1));
  });

  it('eskimiş konumu karşılaştırmaya vermez', () => {
    const iz = new KonumIzi();
    iz.guncelle('A', ENLEM, boylam(0), 0);
    assert.equal(iz.onceki('A', IZ_OMRU_MS + 1), null);
  });

  it('hareket eşiği makul', () => {
    assert.ok(HAREKET_ESIGI_M >= 100 && HAREKET_ESIGI_M <= 300);
  });
});

describe('koridorFarki', () => {
  it('ters yöndeki ikizi aynı koridorda sayar', () => {
    // Gidiş 0→4, dönüş 4→0 (karşı yaka, 20 m): uçlar yer değiştirmiş.
    assert.ok(koridorFarki(T, 1, 0) < 50);
  });
  it('kısa varyantı uzak sayar', () => {
    // Kısa varyant 0→2: bir ucu ~1 km uzakta.
    assert.ok(koridorFarki(T, 2, 0) > 900);
  });
});

describe('koridoraGoreSuz', () => {
  const aday = (rota) => ({ rota, durak: 0, sira: 1, metre: 5 });

  it('araç tarandığı güzergâhta ilerliyorsa yalnız onu bırakır', () => {
    assert.deepEqual(koridoraGoreSuz(T, [aday(0), aday(2)], 0).map((a) => a.rota), [0]);
  });

  it('araç dönmüşse ikizin koridorundakileri bırakır, kısa varyantı eler', () => {
    // Tarama dönüşteyken görmüş (1); araç şimdi gidişte ilerliyor: adaylar 0 ve 2.
    assert.deepEqual(koridoraGoreSuz(T, [aday(0), aday(2)], 1).map((a) => a.rota), [0]);
  });

  it('bilinen güzergâh yoksa dokunmaz', () => {
    assert.equal(koridoraGoreSuz(T, [aday(0), aday(2)], undefined).length, 2);
  });

  it('tek adayı süzmez', () => {
    assert.equal(koridoraGoreSuz(T, [aday(2)], 1).length, 1);
  });
});
