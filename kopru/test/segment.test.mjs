import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dilimAnahtari, EN_AZ_OLCUM, SegmentOgrenici } from '../segment.mjs';

/** 5 duraklı tek sefer: doğuya ~760 m arayla, tarifede her aralık 3 dk. */
function kucukTarife() {
  const n = 5;
  return {
    durakEnlem: new Float64Array(n).fill(41),
    durakBoylam: Float64Array.from({ length: n }, (_, i) => 29 + i * 0.009),
    durakAd: Array.from({ length: n }, (_, i) => `d${i}`),
    sDurak: Int32Array.from({ length: n }, (_, i) => i),
    sSira: Int32Array.from({ length: n }, (_, i) => i + 1),
    sSaniye: Int32Array.from({ length: n }, (_, i) => 8 * 3600 + i * 180),
    sSefer: new Int32Array(n),
    seferBas: Int32Array.from([0, n]),
    seferSatir: Int32Array.from({ length: n }, (_, i) => i),
  };
}

// Çarşamba 10:30 İstanbul
const BAS = Math.floor(Date.parse('2026-09-23T10:30:00+03:00') / 1000);
const e = (kapiNo, s, konum) => ({ kapiNo, seferIdx: 0, konum, sira: Math.ceil(konum + 1e-9), damga: BAS + s });

describe('dilimAnahtari', () => {
  it('hafta içi/sonu ve saat dilimi', () => {
    assert.equal(dilimAnahtari(BAS), 'i2');
    assert.equal(dilimAnahtari(Math.floor(Date.parse('2026-09-26T07:15:00+03:00') / 1000)), 'h1');
    assert.equal(dilimAnahtari(Math.floor(Date.parse('2026-09-23T23:59:00+03:00') / 1000)), 'i4');
  });
});

describe('SegmentOgrenici', () => {
  /** Sabit hızla, her 150 sn'de bir durak geçen otobüs; gözlem 120 sn'de bir. */
  function surdur(o, kapi) {
    for (let s = 0; s <= 480; s += 120) {
      o.gozlem([e(kapi, s, 1 + s / 150)], new Date((BAS + s) * 1000));
    }
  }

  it('geçiş anlarından durak arası süreyi öğrenir', () => {
    const o = new SegmentOgrenici(kucukTarife());
    for (let k = 0; k < EN_AZ_OLCUM; k++) surdur(o, `A${k}`);
    // 2→3 ve 3→4 aralıkları 150 sn (tarifede 180).
    assert.ok(Math.abs(o.sure(1, 2, BAS) - 150) < 1);
    assert.ok(Math.abs(o.sure(2, 3, BAS) - 150) < 1);
    // İlk aralık ölçülemez: ilk gözlemde otobüs zaten durakta.
    assert.equal(o.sure(0, 1, BAS), null);
  });

  it('az ölçümle öğrenilen süre kullanılmaz', () => {
    const o = new SegmentOgrenici(kucukTarife());
    surdur(o, 'A');
    assert.equal(o.sure(1, 2, BAS), null);
  });

  it('varış tahmini öğrenileni, olmayan aralıkta tarifeyi kullanır', () => {
    const o = new SegmentOgrenici(kucukTarife());
    for (let k = 0; k < EN_AZ_OLCUM; k++) surdur(o, `A${k}`);
    // Otobüs 2. ile 3. durak arasının ortasında (konum 2.5), sıradaki durak 3.
    const v = o.varislar({ seferIdx: 0, konum: 2.5, sira: 3, damga: BAS });
    assert.deepEqual(v.map((x) => x.sira), [3, 4, 5]);
    assert.ok(Math.abs(v[0].an - (BAS + 75)) < 1);
    assert.ok(Math.abs(v[1].an - (BAS + 225)) < 1);
    assert.ok(Math.abs(v[2].an - (BAS + 405)) < 1); // 4→5 öğrenilmedi: tarifedeki 180
    assert.deepEqual(v.map((x) => x.ogrenilen), [true, true, false]);
  });

  it('gerçek dışı ölçüm atılır, gün sonunda ağırlık azalır, kayıt geri yüklenir', () => {
    const o = new SegmentOgrenici(kucukTarife());
    o.ekle(1, 2, 3, BAS, 180, 760); // 3 sn: çok hızlı
    assert.equal(o.sayac.elenen, 1);
    for (let k = 0; k < 10; k++) o.ekle(1, 2, 200, BAS, 180, 760);
    o.sonumle();
    const kayit = o.disaAktar();
    const p = new SegmentOgrenici(kucukTarife());
    p.yukle(kayit);
    assert.ok(Math.abs(p.sure(1, 2, BAS) - 200) < 1);
    assert.equal(Object.values(kayit.kayit)[0][0], 8.5);
  });
});
