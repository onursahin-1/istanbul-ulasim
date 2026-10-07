// Araç tabanlı varış tahmini (varis.mjs).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AracVarislari, capaPenceresi, ilerleyenVaryantlar, yoldakiYer } from '../varis.mjs';

// Doğu-batı cadde, 6 durak ~500 m arayla. Rota 0 batıdan doğuya, rota 1 karşı yakadan geri.
const ENLEM = 41.0;
const boylam = (i) => 29.0 + i * 0.006;
function sahteTarife() {
  const durakEnlem = [];
  const durakBoylam = [];
  const rotaDuraklari = new Map();
  const ekle = (rota, noktalar) =>
    rotaDuraklari.set(
      rota,
      noktalar.map(([e, b], sira) => {
        durakEnlem.push(e);
        durakBoylam.push(b);
        return { durak: durakEnlem.length - 1, sira: sira + 1 };
      }),
    );
  ekle(0, [0, 1, 2, 3, 4, 5].map((i) => [ENLEM, boylam(i)]));
  ekle(1, [5, 4, 3, 2, 1, 0].map((i) => [ENLEM + 0.00018, boylam(i)]));
  return {
    durakEnlem,
    durakBoylam,
    rotaDuraklari,
    rotaEsik: new Map(),
    kisaAdtanRotalar: new Map([['141M', [0, 1]]]),
    guzergahtanRota: new Map([['141M_G_D0', 0], ['141M_D_D0', 1]]),
  };
}
const T = sahteTarife();
// Tarife: duraklar arası 120 sn.
const yolBul = (rota) => T.rotaDuraklari.get(rota).map((d, i) => ({ durak: d.durak, saniye: 36000 + i * 120 }));
const SIMDI = new Date('2026-10-06T14:00:00Z');
const arac = (kapiNo, i, kuzey = 0, yasSn = 30) => ({
  kapiNo,
  enlem: ENLEM + kuzey,
  boylam: boylam(i),
  tarih: new Date(SIMDI.getTime() - yasSn * 1000),
});
const bilgi = (guzergah) => () => ({ hat: '141M', guzergah, an: SIMDI.getTime() - 60_000 });

describe('yoldakiYer', () => {
  it('iki durak arasındaki kesirli yer; yoldan uzaksa null', () => {
    const yol = yolBul(0);
    assert.equal(Math.round(yoldakiYer(T, yol, ENLEM, boylam(2.5), 400).yer * 10) / 10, 2.5);
    assert.equal(yoldakiYer(T, yol, ENLEM + 0.02, boylam(2.5), 400), null);
  });
});

describe('AracVarislari', () => {
  it('durağa arkadan gelen aracın varışı: kalan yol × aralık süresi, konum yaşından düşülür', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('B-1799', 1.5, 0, 30)], [], bilgi('141M_G_D0'), SIMDI);
    const durak4 = T.rotaDuraklari.get(0)[4].durak;
    const r = v.durakVarislari(durak4, SIMDI.getTime())['141M'];
    assert.equal(r.length, 1);
    assert.equal(r[0].kapiNo, 'B-1799');
    assert.equal(r[0].kalanDurak, 3);
    // 1,5 → 4: 2,5 aralık × 120 sn = 300 sn, konum 30 sn önce → 270 sn sonra.
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 270);
  });

  it('öğrenilen süre varsa tarifeden önce o', () => {
    const v = new AracVarislari(T, yolBul, () => 60);
    v.guncelle([arac('B-1799', 2, 0, 0)], [], bilgi('141M_G_D0'), SIMDI);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'];
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 120);
    assert.equal(r[0].ogrenilen, 1);
  });

  it('durağı geçmiş araç yok; durağın dibindeki "durakta" (0 durak, şimdi)', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('A', 4.5), arac('B', 3.95, 0, 0)], [], bilgi('141M_G_D0'), SIMDI);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'];
    assert.deepEqual(r.map((x) => [x.kapiNo, x.kalanDurak]), [['B', 0]]);
  });

  it('karşı yöndeki (öbür güzergâh) araç bu durağa sayılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('D', 1.5, 0.00018)], [], bilgi('141M_D_D0'), SIMDI);
    assert.equal(v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'], undefined);
  });

  it('güzergâh kodu bayatsa yön iki konumdan; duran araçta son bilinen yön', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    const bayat = () => ({ hat: '141M', guzergah: '141M_D_D0', an: 0 });
    v.guncelle([arac('E', 0.2, 0, 0)], [], bayat, new Date(SIMDI.getTime() - 120_000));
    v.guncelle([arac('E', 1.2, 0, 0)], [], bayat, SIMDI);
    const durak4 = T.rotaDuraklari.get(0)[4].durak;
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime())['141M']?.[0].kapiNo, 'E');
    // Sonraki nabızda yerinde (trafik): yön hafızadan.
    v.guncelle([arac('E', 1.21, 0, 0)], [], bayat, new Date(SIMDI.getTime() + 75_000));
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime() + 75_000)['141M']?.[0].kapiNo, 'E');
  });

  it('hattı bilinmeyen ya da konumu eski araç sayılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.guncelle([arac('X', 1), arac('Y', 1, 0, 3600)], [], (k) => (k === 'Y' ? bilgi('141M_G_D0')() : null), SIMDI);
    assert.equal(v.araclar.length, 0);
  });

  it('hat başında bekleyen otobüs tarifedeki kalkışı bekler', () => {
    const kalkis = Math.floor(SIMDI.getTime() / 1000) + 8 * 60;
    const v = new AracVarislari(T, yolBul, () => null, () => kalkis);
    v.guncelle([arac('A-303', 0, 0, 0)], [], bilgi('141M_G_D0'), SIMDI);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[2].durak, SIMDI.getTime())['141M'];
    // 8 dk kalkış + 2 aralık × 120 sn.
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 8 * 60 + 240);
  });
});

describe('kendini ölçme', () => {
  it('otobüsler tarifenin 2 katı yavaş gidiyorsa çarpan 2ye yaklaşır, tahmin düzelir', () => {
    // Uzun bir hat: 30 durak, tarifede 120 sn arayla; gerçekte 240 sn.
    const uzun = sahteTarife();
    const duraklar = [];
    for (let i = 0; i < 30; i++) {
      uzun.durakEnlem.push(ENLEM + 0.01);
      uzun.durakBoylam.push(boylam(i));
      duraklar.push({ durak: uzun.durakEnlem.length - 1, sira: i + 1 });
    }
    uzun.rotaDuraklari.set(5, duraklar);
    uzun.kisaAdtanRotalar.set('UZUN', [5]);
    uzun.guzergahtanRota.set('UZUN_G', 5);
    const yb = () => duraklar.map((d, i) => ({ durak: d.durak, saniye: i * 120 }));
    const v = new AracVarislari(uzun, yb, () => null);
    const bilgiU = (an) => () => ({ hat: 'UZUN', guzergah: 'UZUN_G', an });
    // 40 araç, her biri 75 sn'de bir konum; 240 sn'de bir durak.
    const t0 = SIMDI.getTime();
    for (let adim = 0; adim < 60; adim++) {
      const an = t0 + adim * 75_000;
      const araclar = [];
      for (let k = 0; k < 40; k++) {
        const yer = 0.5 + (adim * 75) / 240 - (k % 5) * 0.1;
        if (yer > 28) continue;
        araclar.push({ kapiNo: `K${k}`, enlem: ENLEM + 0.01, boylam: boylam(yer), tarih: new Date(an) });
      }
      v.guncelle(araclar, [], bilgiU(an), new Date(an));
    }
    const ozet = v.ozet();
    assert.ok(ozet.olcum > 100, `ölçüm: ${ozet.olcum}`);
    assert.ok(Math.abs(ozet.carpan.tarife - 2) < 0.25, `çarpan: ${ozet.carpan.tarife}`);
    const h = ozet.hata['6 durak'];
    assert.ok(Math.abs(h.duzeltilmisOrtalamaSn) < Math.abs(h.hamOrtalamaSn) / 2, JSON.stringify(h));
  });
});

describe('halka hat: gidiş ve dönüş aynı caddenin iki yakasında', () => {
  // Rota 9: batıdan doğuya güney yakada 6 durak, sonra kuzey yakadan geri 6 durak (halka).
  // Hedef durak dönüşte, 5. sırada (x = 1). Otobüs dönüşte x = 2,5'te, batıya gidiyor (önünde
  // x = 2 ve x = 1: 2 durak);
  // GPS onu caddenin ortasına, gidiş yakasına biraz daha yakın koyuyor.
  function halka() {
    const t = sahteTarife();
    const duraklar = [];
    const ekle = (e, b) => {
      t.durakEnlem.push(e);
      t.durakBoylam.push(b);
      duraklar.push({ durak: t.durakEnlem.length - 1, sira: duraklar.length + 1 });
    };
    for (const i of [0, 1, 2, 3, 4, 5]) ekle(ENLEM, boylam(i));
    for (const i of [5, 4, 3, 2, 1, 0]) ekle(ENLEM + 0.0003, boylam(i));
    t.rotaDuraklari.set(9, duraklar);
    t.kisaAdtanRotalar.set('91E', [9]);
    t.guzergahtanRota.set('91E_G_D4952', 9);
    t.durakAd = t.durakEnlem.map((_, i) => `d${i}`);
    return { t, duraklar };
  }
  const { t: H, duraklar: HD } = halka();
  const yb = () => HD.map((d, i) => ({ durak: d.durak, saniye: 36000 + i * 120 }));
  const hedef = HD[10].durak; // dönüşte x = 1
  const bilgiH = () => ({ hat: '91E', guzergah: '91E_G_D4952', an: SIMDI.getTime() - 60_000 });
  const konum = (x, an) => ({ kapiNo: 'A-304', enlem: ENLEM + 0.00013, boylam: boylam(x), tarih: new Date(an) });

  it('yönü bilinen otobüs dönüş yakasına yerleşir: durağa 2 durak', () => {
    const v = new AracVarislari(H, yb, () => null);
    v.guncelle([konum(3.2, SIMDI.getTime() - 75_000)], [], bilgiH, new Date(SIMDI.getTime() - 75_000));
    v.guncelle([konum(2.5, SIMDI.getTime())], [], bilgiH, SIMDI);
    const r = v.durakVarislari(hedef, SIMDI.getTime())['91E'];
    assert.equal(r?.[0].kalanDurak, 2);
    assert.equal(r?.[0].sonrakiDurak, `d${HD[11].durak}`);
  });

  it('yön bilinmezse en yakın parça (eski davranış): gidiş yakası, durağa çok uzak', () => {
    const yer = yoldakiYer(H, yb(), ENLEM + 0.00013, boylam(2.5), 400);
    assert.ok(yer.yer < 5, `gidişte bekleniyordu: ${yer.yer}`);
    const yonlu = yoldakiYer(H, yb(), ENLEM + 0.00013, boylam(2.5), 400, { dx: -0.001, dy: 0 });
    assert.ok(yonlu.yer > 6, `dönüşte bekleniyordu: ${yonlu.yer}`);
  });

  it('yönü tutan parça çok uzaktaysa en yakın parça (paralel sokak, viraj)', () => {
    // Dönüş yakasını 300 m kuzeye al: artık "karşı yaka" değil, başka bir sokak.
    const t = halka().t;
    for (let i = 18; i < 24; i++) t.durakEnlem[i] = ENLEM + 0.0027;
    const yer = yoldakiYer(t, yb(), ENLEM + 0.00005, boylam(2.5), 400, { dx: -0.001, dy: 0 });
    assert.ok(yer.yer < 5, `gidişte bekleniyordu: ${yer.yer}`);
  });

  describe('İETT çapası (en yakın durak)', () => {
    // Taramada İETT otobüsün en yakın durağını dönüş yakasındaki x = 3 (HD[8]) diye verdi.
    const capaKodu = 'K8';
    const capali = () => {
      const t = halka().t;
      t.kodtanDurak = new Map([[capaKodu, HD[8].durak]]);
      return t;
    };
    const bilgiC = (konumAn) => () => ({ ...bilgiH(), yakinDurak: capaKodu, konumAn });

    it('yön bilinmese de otobüs çapanın penceresine (dönüş yakasına) yerleşir', () => {
      const t = capali();
      const v = new AracVarislari(t, yb, () => null);
      // Tek konum: iki konumdan yön çıkmıyor, en yakın parça gidiş yakası olurdu.
      v.guncelle([konum(2.5, SIMDI.getTime())], [], bilgiC(SIMDI.getTime() - 30_000), SIMDI);
      const r = v.durakVarislari(hedef, SIMDI.getTime())['91E'];
      assert.equal(r?.[0].kalanDurak, 2);
      assert.equal(v.teshis(hedef, SIMDI.getTime()).araclar[0].iettYakinDurak, `d${HD[8].durak}`);
    });

    it('çapasız yerleştirme İETT ile uyuşmazsa ölçülür (/durum capa)', () => {
      const v = new AracVarislari(capali(), yb, () => null);
      v.guncelle([konum(2.5, SIMDI.getTime())], [], bilgiC(SIMDI.getTime() - 30_000), SIMDI);
      // Aynı tarama ikinci nabızda yeniden sayılmaz.
      v.guncelle([konum(2.5, SIMDI.getTime() + 75_000)], [], bilgiC(SIMDI.getTime() - 30_000), new Date(SIMDI.getTime() + 75_000));
      const c = v.ozet().capa;
      assert.equal(c.uyumsuz, 1);
      assert.equal(c.uyumlu, 0);
      assert.equal(c.sonUyumsuzlar[0].iettDurak, `d${HD[8].durak}`);
    });

    it('güzergâh kodu aracın varyantını göstermiyorsa ya da eskiyse çapa yok', () => {
      const v = new AracVarislari(capali(), yb, () => null);
      v.guncelle([konum(2.5, SIMDI.getTime())], [], bilgiC(SIMDI.getTime() - 25 * 60_000), SIMDI);
      assert.equal(v.ozet().capa.kullanan, 0);
    });

    it('pencere: bir durak geriden, geçen sürenin iki katı + 5 dk planlanan süre ilerisine', () => {
      // Aralık 120 sn: 0 sn geçtiyse +300 sn → 2 durak ileri; 300 sn geçtiyse +900 sn → 7 durak.
      assert.deepEqual(capaPenceresi(yb(), HD[8].durak, 0), [[7, 10]]);
      assert.deepEqual(capaPenceresi(yb(), HD[2].durak, 300), [[1, 9]]);
      assert.equal(capaPenceresi(yb(), 999, 0), null);
    });
  });

  it('yerinde sayan otobüs son yönünü korur', () => {
    const v = new AracVarislari(H, yb, () => null);
    v.guncelle([konum(3.2, SIMDI.getTime() - 150_000)], [], bilgiH, new Date(SIMDI.getTime() - 150_000));
    v.guncelle([konum(2.5, SIMDI.getTime() - 75_000)], [], bilgiH, new Date(SIMDI.getTime() - 75_000));
    v.guncelle([konum(2.5, SIMDI.getTime())], [], bilgiH, SIMDI);
    assert.equal(v.durakVarislari(hedef, SIMDI.getTime())['91E']?.[0].kalanDurak, 2);
  });
});

describe('duran otobüs', () => {
  const durak4 = T.rotaDuraklari.get(0)[4].durak;
  // 75 sn arayla nabızlar; otobüs x = 1,5'te kımıldamıyor (GPS 10 m oynuyor).
  function nabizlar(v, kac, x = 1.5) {
    for (let i = kac; i >= 0; i--) {
      const an = new Date(SIMDI.getTime() - i * 75_000);
      const oynama = (i % 2) * 0.0001;
      v.guncelle([{ kapiNo: 'A-1627', enlem: ENLEM, boylam: boylam(x) + oynama, tarih: an }], [], bilgi('141M_G_D0'), an);
    }
  }

  it('5 dakikadan uzun duran otobüs "duruyor"; varışı hemen kalkarsa', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    nabizlar(v, 6); // 7,5 dk
    const r = v.durakVarislari(durak4, SIMDI.getTime())['141M'];
    assert.equal(r[0].duruyorSn, 450);
    // 1,5 → 4: 2,5 aralık × 120 sn = 300 sn, şimdiden.
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 300);
  });

  it('20 dakikadan uzun duran otobüs servis dışı: listede yok', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    nabizlar(v, 18); // 22,5 dk
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime())['141M'], undefined);
  });

  it('kısa duruş (ışık, trafik) duruyor sayılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    nabizlar(v, 2); // 2,5 dk
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime())['141M'][0].duruyorSn, null);
  });

  it('hareket edince sayım sıfırlanır', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    nabizlar(v, 6);
    const sonra = new Date(SIMDI.getTime() + 75_000);
    v.guncelle([{ kapiNo: 'A-1627', enlem: ENLEM, boylam: boylam(1.8), tarih: sonra }], [], bilgi('141M_G_D0'), sonra);
    assert.equal(v.durakVarislari(durak4, sonra.getTime())['141M'][0].duruyorSn, null);
  });

  it('konumu eskiyse duruyor denmez (bilinmiyor)', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    nabizlar(v, 6);
    assert.equal(v.durakVarislari(durak4, SIMDI.getTime() + 4 * 60_000)['141M'][0].duruyorSn, null);
  });

  it('hat başında bekleyen otobüs duruyor sayılmaz (tarifedeki kalkış kullanılır)', () => {
    const kalkis = Math.floor(SIMDI.getTime() / 1000) + 4 * 60;
    const v = new AracVarislari(T, yolBul, () => null, () => kalkis);
    nabizlar(v, 6, 0);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[2].durak, SIMDI.getTime())['141M'];
    assert.equal(r[0].duruyorSn, null);
    assert.equal((r[0].varis - SIMDI.getTime()) / 1000, 4 * 60 + 240);
  });
});

describe('aynı yönde birkaç varyant', () => {
  it('güzergâh kodu bayatlayınca otobüs bilinen varyantında kalır (kısa varyanta kaymaz)', () => {
    // Rota 2: rota 0 ile aynı duraklardan geçen kısa varyant, 3. durakta biter (4. durağa gitmez).
    const t = sahteTarife();
    t.rotaDuraklari.set(2, t.rotaDuraklari.get(0).slice(0, 4));
    t.kisaAdtanRotalar.set('141M', [2, 0, 1]);
    const yb2 = (rota) => t.rotaDuraklari.get(rota).map((d, i) => ({ durak: d.durak, saniye: 36000 + i * 120 }));
    const v = new AracVarislari(t, yb2, () => null);
    const t0 = SIMDI.getTime() - 30 * 60_000;
    const taramaAni = t0 - 60_000;
    const b = () => ({ hat: '141M', guzergah: '141M_G_D0', an: taramaAni });
    // Tarama tazeyken rota 0; sonra 25 dk boyunca güzergâh kodu bayat, otobüs ilerliyor.
    const konumlar = [0.2, 0.5, 0.9, 1.3, 1.7, 2.1];
    konumlar.forEach((x, i) => {
      const an = new Date(t0 + i * 5 * 60_000);
      v.guncelle([{ kapiNo: 'A-1857', enlem: ENLEM, boylam: boylam(x), tarih: an }], [], b, an);
    });
    const son = t0 + 25 * 60_000;
    const r = v.durakVarislari(t.rotaDuraklari.get(0)[4].durak, son)['141M'];
    assert.equal(r?.[0].kapiNo, 'A-1857');
  });
});

describe('az hareketle yön', () => {
  it('iki durak arasında 80 m ilerleyen otobüsün varyantı bulunur (en yakın durak değişmeden)', () => {
    // x = 1,40 → 1,55: ikisi de 1. ile 2. durak arasında, en yakın durak aynı kalıyor.
    const r = ilerleyenVaryantlar(T, [0, 1], { enlem: ENLEM, boylam: boylam(1.4) }, { enlem: ENLEM, boylam: boylam(1.55) });
    assert.deepEqual(r.map((x) => x.rota), [0]);
  });

  it('köprü yeniden başlayınca yön hafızadan: yerinde sayan otobüs hemen sayılır', () => {
    const TR = { ...T, rotaAd: ['714', '716'] };
    const v = new AracVarislari(TR, yolBul, () => null);
    const bayat = () => ({ hat: '141M', guzergah: '141M_D_D0', an: 0 });
    v.guncelle([arac('E', 0.2, 0, 0)], [], bayat, new Date(SIMDI.getTime() - 150_000));
    v.guncelle([arac('E', 1.2, 0, 0)], [], bayat, new Date(SIMDI.getTime() - 75_000));
    // Diske yazılıp okunuyor (JSON), yeni köprü boş başlıyor.
    const yeni = new AracVarislari(TR, yolBul, () => null);
    yeni.yukle(JSON.parse(JSON.stringify(v.disaAktar())), SIMDI.getTime());
    // Yeniden başladıktan sonraki ilk nabız: otobüs yerinde sayıyor, yön ancak hafızadan.
    yeni.guncelle([arac('E', 1.21, 0, 0)], [], bayat, SIMDI);
    assert.equal(yeni.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M']?.[0].kapiNo, 'E');
    // Hafızasız köprü bu otobüsü sayamaz.
    const bos = new AracVarislari(TR, yolBul, () => null);
    bos.guncelle([arac('E', 1.21, 0, 0)], [], bayat, SIMDI);
    assert.equal(bos.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'], undefined);
  });
});

describe('canlı trafik', () => {
  it('önden geçen otobüslerin gerçek süreleri arkadan gelene uygulanır (tarifenin 2 katı yavaş)', () => {
    // Tarife durak arası 120 sn; bugün trafik var, otobüsler 240 sn'de geçiyor.
    const v = new AracVarislari(T, yolBul, () => null);
    const t0 = SIMDI.getTime() - 30 * 60_000;
    const bilgiG = (an) => () => ({ hat: '141M', guzergah: '141M_G_D0', an });
    // İki otobüs 0 → 4,9 arası, dakikada çeyrek durak (240 sn/durak).
    for (let dk = 0; dk <= 20; dk++) {
      const an = t0 + dk * 60_000;
      const araclar = [
        { kapiNo: 'O-1', enlem: ENLEM, boylam: boylam(Math.min(4.9, 0.1 + dk * 0.25)), tarih: new Date(an) },
        { kapiNo: 'O-2', enlem: ENLEM, boylam: boylam(Math.min(4.9, 0.05 + dk * 0.25)), tarih: new Date(an) },
      ];
      v.guncelle(araclar, [], bilgiG(an), new Date(an));
    }
    // Arkadan gelen otobüs 1,5'te: 4. durağa 2,5 aralık; canlı 240 sn ile 600 sn (tarifeyle 300 sn olurdu).
    const simdi = t0 + 21 * 60_000;
    v.guncelle([{ kapiNo: 'A-1', enlem: ENLEM, boylam: boylam(1.5), tarih: new Date(simdi) }], [], bilgiG(simdi), new Date(simdi));
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, simdi)['141M'].find((x) => x.kapiNo === 'A-1');
    const sure = (r.varis - simdi) / 1000;
    assert.ok(Math.abs(sure - 600) < 30, `600 sn bekleniyordu: ${sure}`);
    assert.equal(r.canli, 1);
  });

  it('yarım saatten eski ölçüm kullanılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    v.canliEkle(T.rotaDuraklari.get(0)[1].durak, T.rotaDuraklari.get(0)[2].durak, 500, SIMDI.getTime() - 40 * 60_000, 120);
    assert.equal(v.canliSure(T.rotaDuraklari.get(0)[1].durak, T.rotaDuraklari.get(0)[2].durak, SIMDI.getTime()), null);
  });
});

describe('otobüsün kendi hızı', () => {
  it('içinde bulunduğu aralıkta sürünen otobüsün tahmini uzar (kuyruk)', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    const b = (an) => () => ({ hat: '141M', guzergah: '141M_G_D0', an });
    // 4 dakikada yalnız 0,1 durak aralığı (yaklaşık 50 m) ilerliyor.
    for (let dk = 0; dk <= 4; dk++) {
      const an = SIMDI.getTime() - (4 - dk) * 60_000;
      v.guncelle([{ kapiNo: 'K-1', enlem: ENLEM, boylam: boylam(1.1 + dk * 0.025), tarih: new Date(an) }], [], b(an), new Date(an));
    }
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'][0];
    const sure = (r.varis - SIMDI.getTime()) / 1000;
    // Ortalama hızla 0,8 × 120 + 2 × 120 = 336 sn olurdu; kuyrukta çok daha uzun.
    assert.ok(sure > 900, `uzun bekleniyordu: ${sure}`);
  });

  it('normal hızda giden otobüse dokunmaz', () => {
    const v = new AracVarislari(T, yolBul, () => null);
    const b = (an) => () => ({ hat: '141M', guzergah: '141M_G_D0', an });
    // Dakikada yarım aralık (tarife 120 sn'de bir aralık): tam zamanında.
    for (let dk = 0; dk <= 4; dk++) {
      const an = SIMDI.getTime() - (4 - dk) * 60_000;
      v.guncelle([{ kapiNo: 'K-2', enlem: ENLEM, boylam: boylam(0.1 + dk * 0.5), tarih: new Date(an) }], [], b(an), new Date(an));
    }
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'][0];
    // 2,1 → 4: 1,9 aralık × 120 sn = 228 sn.
    assert.ok(Math.abs((r.varis - SIMDI.getTime()) / 1000 - 228) < 20);
  });
});

describe('tarife yöntemi (Otobüsüm Nerede? ile aynı)', () => {
  it('yalnız planlanan süreler: öğrenilen süre, canlı trafik ve kendi hızı kullanılmaz', () => {
    const v = new AracVarislari(T, yolBul, () => 999, () => null, { yontem: 'tarife' });
    const b = (an) => () => ({ hat: '141M', guzergah: '141M_G_D0', an });
    // Sürünen otobüs (öğrenilen yöntemde kendi hızı devreye girerdi).
    for (let dk = 0; dk <= 4; dk++) {
      const an = SIMDI.getTime() - (4 - dk) * 60_000;
      v.guncelle([{ kapiNo: 'K-1', enlem: ENLEM, boylam: boylam(1.4 + dk * 0.025), tarih: new Date(an) }], [], b(an), new Date(an));
    }
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'][0];
    // 1,5 → 4: 2,5 aralık × 120 sn = 300 sn.
    assert.equal(Math.round((r.varis - SIMDI.getTime()) / 1000), 300);
  });
});

describe('konumun yaşı kadar ilerletme', () => {
  it('eski konumla durağa 1 durak görünen otobüs, ilerletilince durağı geçmiş sayılır', () => {
    // 3,7'de, 150 sn önce görülmüş; aralık 120 sn: 3,7 → 4 (36 sn) → 4,95 (114 sn). Durak 4 geçildi.
    const v = new AracVarislari(T, yolBul, () => null, () => null, { yontem: 'tarife' });
    v.guncelle([arac('E', 3.7, 0, 150)], [], bilgi('141M_G_D0'), SIMDI);
    const d = v.teshis(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime()).araclar.find((x) => x.kapiNo === 'E');
    assert.match(d.neden, /tahminen durağı geçti/);
  });

  it('taze konumda kalan durak değişmez; yaşlı konumda azalır', () => {
    const v = new AracVarislari(T, yolBul, () => null, () => null, { yontem: 'tarife' });
    v.guncelle([arac('T', 1.5, 0, 0), arac('Y', 1.5, 0.00001, 140)], [], bilgi('141M_G_D0'), SIMDI);
    const r = v.durakVarislari(T.rotaDuraklari.get(0)[4].durak, SIMDI.getTime())['141M'];
    const k = Object.fromEntries(r.map((x) => [x.kapiNo, x.kalanDurak]));
    // 1,5'ten 4. durağa: 2, 3, 4 → 3 durak.
    assert.equal(k.T, 3);
    // 140 sn: 1,5 → 2 (60 sn) → 2,67 (80 sn): 3, 4 → 2 durak.
    assert.equal(k.Y, 2);
  });
});

describe('hat ekranı araçları (rotaAraclari)', () => {
  it('güzergâh kimliğine göre son nabzın otobüsleri; gidiş yönü var, uzun duran yok', () => {
    const t = { ...sahteTarife(), rotaAd: ['R0', 'R1'] };
    const yb0 = (rota) => t.rotaDuraklari.get(rota).map((d, i) => ({ durak: d.durak, saniye: 36000 + i * 120 }));
    const v = new AracVarislari(t, yb0, () => null);
    const bilgiK = (k) => ({ hat: '141M', guzergah: k === 'D' ? '141M_D_D0' : '141M_G_D0', an: SIMDI.getTime() - 60_000 });
    const an = SIMDI.getTime();
    const konumK = (kapiNo, x, ms, kuzey = 0) => ({ kapiNo, enlem: ENLEM + kuzey, boylam: boylam(x), tarih: new Date(ms) });
    const once = an - 25 * 60_000;
    // A doğuya, D dönüş yakasında batıya ilerliyor; P 25 dakikadır yolun ortasında duruyor (servis dışı).
    v.guncelle([konumK('A', 1, once), konumK('P', 2.5, once), konumK('D', 3, once, 0.00018)], [], bilgiK, new Date(once));
    v.guncelle([konumK('A', 1.2, an - 75_000), konumK('P', 2.5, an - 75_000), konumK('D', 2.8, an - 75_000, 0.00018)], [], bilgiK, new Date(an - 75_000));
    v.guncelle([konumK('A', 1.5, an), konumK('P', 2.5, an), konumK('D', 2.5, an, 0.00018)], [], bilgiK, SIMDI);
    const r = v.rotaAraclari(new Set(['R0', 'R1']), an);
    assert.deepEqual(r.R0.map((x) => [x.kapiNo, x.yon, x.duruyorSn]), [['A', 90, null]]);
    assert.deepEqual(r.R1.map((x) => [x.kapiNo, x.yon]), [['D', 270]]);
    assert.equal(r.R0[0].an, an);
    assert.deepEqual(Object.keys(v.rotaAraclari(new Set(['R1']), an)), ['R1']);
  });
});

describe('durağı olmayan uzun aralık (otoyol)', () => {
  // Duraklar x = 0, 1, 2, 3, sonra 5 km boşluk (x = 13), 14, 15. Gerçek yol "L" biçiminde:
  // otobüs aralığın ortasında düz çizgiden ~1,2 km kuzeyde (89C Topkapı → Atışalanı gibi).
  function otoyol() {
    const t = sahteTarife();
    const duraklar = [];
    for (const x of [0, 1, 2, 3, 13, 14, 15]) {
      t.durakEnlem.push(ENLEM - 0.01);
      t.durakBoylam.push(boylam(x));
      duraklar.push({ durak: t.durakEnlem.length - 1, sira: duraklar.length + 1 });
    }
    t.rotaDuraklari.set(7, duraklar);
    t.kisaAdtanRotalar.set('89C', [7]);
    t.guzergahtanRota.set('89C_D_D0', 7);
    return { t, duraklar };
  }
  const { t: O, duraklar: OD } = otoyol();
  const yb = () => OD.map((d, i) => ({ durak: d.durak, saniye: 36000 + i * 120 + (i >= 4 ? 1000 : 0) }));

  it('uzun aralıkta düz çizgiden 1,2 km uzaktaki otobüs aralığa yerleşir; kısa aralıkta yerleşmez', () => {
    const yer = yoldakiYer(O, yb(), ENLEM - 0.01 + 0.011, boylam(8), 400);
    assert.ok(yer && yer.yer > 3 && yer.yer < 4, `uzun aralıkta bekleniyordu: ${yer?.yer}`);
    assert.equal(yoldakiYer(O, yb(), ENLEM - 0.01 + 0.011, boylam(1.5), 400), null);
  });

  it('otoyoldaki otobüs durak listesinden düşmez', () => {
    const v = new AracVarislari(O, yb, () => null, () => null, { yontem: 'tarife' });
    const b = () => ({ hat: '89C', guzergah: '89C_D_D0', an: SIMDI.getTime() - 60_000 });
    v.guncelle([{ kapiNo: 'T1001', enlem: ENLEM - 0.01 + 0.011, boylam: boylam(8), tarih: SIMDI }], [], b, SIMDI);
    const r = v.durakVarislari(OD[6].durak, SIMDI.getTime())['89C'];
    assert.equal(r?.[0].kalanDurak, 3);
  });
});
