import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  yuruyusleKiyasla,
  benzerleriAyikla,
  otobusPayi,
  aktarmaBeklemesi,
  aracSiniri,
  aktarmaCezasi,
  AYNI_HAT_CEZASI,
  gereksizAktarmalariAyikla,
  oneriPuani,
  otobusSuresi,
  rotalariBirlestir,
  rotalariSirala,
  rotaImzasi,
  yurumeSiniri,
} from '../rota-secimi.ts';
import { aramalariYap, EN_COK_YURUME_SN, secenekleriDuzelt } from '../sorgular.ts';

const bacak = (mode: string, dk: number, hat = 'H') => ({
  mode,
  transitLeg: mode !== 'WALK',
  duration: dk * 60,
  route: mode === 'WALK' ? null : { gtfsId: `1:${hat}`, shortName: hat },
  from: { stop: { gtfsId: `d-${hat}` }, name: hat },
});
const rota = (start: string, dk: number, yuruDk: number, aktarma: number, ...legs: ReturnType<typeof bacak>[]) => ({
  start,
  duration: dk * 60,
  walkTime: yuruDk * 60,
  numberOfTransfers: aktarma,
  legs,
});

describe('rotalariBirlestir', () => {
  it('aynı kalkış ve aynı hatlar tekrar etmez, sıra korunur', () => {
    const a = rota('10:00', 30, 5, 0, bacak('BUS', 25, '500T'));
    const b = rota('10:05', 32, 8, 0, bacak('SUBWAY', 24, 'M2'));
    const aKopya = { ...a };
    const sonuc = rotalariBirlestir([[a, b], [aKopya, rota('10:10', 30, 5, 0, bacak('BUS', 25, '500T'))]]);
    assert.equal(sonuc.length, 3);
    assert.equal(rotaImzasi(sonuc[0]), rotaImzasi(a));
  });
});

describe('yurumeSiniri', () => {
  it('20 dakikadan çok yürütenleri atar', () => {
    const otobus = bacak('BUS', 15, 'A');
    const { rotalar, asildi } = yurumeSiniri([rota('a', 30, 10, 0, otobus), rota('b', 25, 21, 0, otobus), rota('c', 40, 20, 1, otobus)]);
    assert.deepEqual(rotalar.map((r) => r.start), ['a', 'c']);
    assert.equal(asildi, false);
    assert.equal(EN_COK_YURUME_SN, 1200);
  });

  it('hepsi aşıyorsa en az yürüyenleri (5 dk içinde) işaretleyip bırakır', () => {
    const otobus = bacak('BUS', 10, 'A');
    const { rotalar, asildi } = yurumeSiniri([rota('a', 30, 35, 0, otobus), rota('b', 25, 24, 0, otobus), rota('c', 40, 28, 1, otobus)]);
    assert.deepEqual(rotalar.map((r) => r.start), ['b', 'c']);
    assert.equal(asildi, true);
  });

  it('boş liste boş kalır', () => {
    assert.deepEqual(yurumeSiniri([]), { rotalar: [], asildi: false });
  });

  it('yalnız yürüyüş 30 dakikaya kadar listede kalır', () => {
    const { rotalar } = yurumeSiniri([rota('y', 25, 25, 0), rota('u', 35, 35, 0), rota('o', 30, 10, 0, bacak('BUS', 20, 'A'))]);
    assert.deepEqual(rotalar.map((r) => r.start), ['y', 'o']);
  });
});

describe('rotalariSirala', () => {
  const otobuslu = rota('1', 40, 5, 0, bacak('BUS', 35, '500T'));
  const metrolu = rota('2', 42, 8, 0, bacak('SUBWAY', 32, 'M2'));
  const cokYuruyen = rota('3', 38, 18, 0, bacak('BUS', 20, '19F'));
  const aktarmali = rota('4', 36, 6, 1, bacak('BUS', 12, '15F'), bacak('BUS', 16, '34G'));

  it('önerilen: süre yakınken trafiğe bağlı olmayanı öne alır', () => {
    assert.ok(oneriPuani(metrolu) < oneriPuani(otobuslu));
    assert.equal(rotalariSirala([otobuslu, metrolu], 'dengeli')[0].start, '2');
  });

  it('en hızlı yalnız süreye bakar', () => {
    assert.deepEqual(rotalariSirala([otobuslu, metrolu, cokYuruyen], 'hizli').map((r) => r.start), ['3', '1', '2']);
  });

  it('az yürüme, az aktarma, raylı', () => {
    assert.equal(rotalariSirala([cokYuruyen, metrolu, otobuslu], 'azYurume')[0].start, '1');
    assert.equal(rotalariSirala([aktarmali, otobuslu], 'azAktarma')[0].start, '1');
    assert.equal(rotalariSirala([otobuslu, aktarmali], 'hizli')[0].start, '4');
    assert.equal(rotalariSirala([otobuslu, cokYuruyen, metrolu], 'rayli')[0].start, '2');
    assert.equal(otobusSuresi(metrolu), 0);
  });
});

describe('aramalariYap', () => {
  it('önerilen: ilk arama otobüsü hafifçe pahalı sayar', () => {
    const a = aramalariYap({ tercih: 'dengeli', erisilebilir: false });
    assert.equal(a.length, 3);
    const kipler = (a[0].modlar as any).transit.transit as { mode: string; cost: { reluctance: number } }[];
    assert.ok(kipler.find((k) => k.mode === 'BUS')!.cost.reluctance > 1);
    assert.equal(kipler.find((k) => k.mode === 'SUBWAY')!.cost.reluctance, 1);
    assert.ok(kipler.some((k) => k.mode === 'FERRY'), 'listede olmayan kip tamamen yasaklanır; vapur listede olmalı');
    assert.equal(a[1].modlar, null);
  });

  it('en hızlıda yalnız aktarma tercihleri; raylıda otobüs güçlü biçimde pahalı', () => {
    assert.deepEqual(aramalariYap({ tercih: 'hizli', erisilebilir: false }), [
      {
        tercihler: { street: { walk: { reluctance: 3 } }, transit: { transfer: { cost: 300, maximumTransfers: 2 } } },
        modlar: null,
      },
    ]);
    const r = aramalariYap({ tercih: 'rayli', erisilebilir: false });
    const bus = (r[0].modlar as any).transit.transit.find((k: any) => k.mode === 'BUS');
    assert.ok(bus.cost.reluctance >= 2);
  });
});

describe('secenekleriDuzelt', () => {
  it('bilinmeyen ya da bozuk kayıt varsayılana döner', () => {
    assert.deepEqual(secenekleriDuzelt({ tercih: 'eski' as any, erisilebilir: true }), {
      tercih: 'dengeli',
      erisilebilir: true,
      kapali: [],
    });
    assert.deepEqual(secenekleriDuzelt(null), { tercih: 'dengeli', erisilebilir: false, kapali: [] });
    assert.deepEqual(secenekleriDuzelt({ tercih: 'rayli', erisilebilir: false }), {
      tercih: 'rayli',
      erisilebilir: false,
      kapali: [],
    });
  });

  it('kapalı vasıta türlerini temizler, sırasını Ayarlar sırasına getirir', () => {
    assert.deepEqual(secenekleriDuzelt({ tercih: 'dengeli', kapali: ['vapur', 'uçak', 'otobus', 'vapur'] as any }).kapali, [
      'otobus',
      'vapur',
    ]);
    assert.deepEqual(secenekleriDuzelt({ tercih: 'dengeli', kapali: 'vapur' as any }).kapali, []);
  });
});

describe('raylı rotalar', () => {
  const otobus = (s: string, dk: number, yuru: number) => rota(s, dk, yuru, 0, bacak('BUS', dk - yuru, `B${s}`));
  const metro = (s: string, dk: number, yuru: number) => rota(s, dk, yuru, 0, bacak('SUBWAY', dk - yuru, 'M7'));

  it('raylı rotada 30 dk yürüme kabul, otobüste 20', () => {
    const { rotalar } = yurumeSiniri([otobus('a', 40, 22), metro('b', 57, 25), metro('c', 60, 31)]);
    assert.deepEqual(rotalar.map((r) => r.start), ['b']);
  });

  it('önerilende en iyi raylı ilk üçe girer', () => {
    const liste = [otobus('1', 32, 8), otobus('2', 33, 10), otobus('3', 34, 8), otobus('4', 36, 5), metro('m', 57, 25)];
    const sonuc = rotalariSirala(liste, 'dengeli');
    assert.equal(sonuc[2].start, 'm');
    assert.equal(sonuc.length, 5);
  });

  it('raylı zaten öndeyse sıra değişmez', () => {
    const liste = [metro('m', 30, 5), otobus('1', 45, 5)];
    assert.equal(rotalariSirala(liste, 'dengeli')[0].start, 'm');
  });

  it('önerilen üç arama yapar, üçüncüsü raylıyı güçlü kayırır', () => {
    const a = aramalariYap({ tercih: 'dengeli', erisilebilir: false });
    assert.equal(a.length, 3);
    const bus = (a[2].modlar as any).transit.transit.find((k: any) => k.mode === 'BUS');
    assert.ok(bus.cost.reluctance >= 2);
  });
});

describe('gereksiz aktarmalar', () => {
  // Kalkış ve süreden varış: '2026-10-04T20:00:00+03:00' + dk.
  const saat = (dk: number) => new Date(Date.parse('2026-10-04T20:00:00+03:00') + dk * 60_000).toISOString();
  const r = (basDk: number, sureDk: number, yuruDk: number, aktarma: number, ...legs: ReturnType<typeof bacak>[]) =>
    rota(saat(basDk), sureDk, yuruDk, aktarma, ...legs);

  it('daha az aktarmayla aynı vakitte varılıyorsa aktarmalısı atılır', () => {
    const direkt = r(0, 40, 8, 0, bacak('BUS', 32, '89T'));
    const aktarmali = r(0, 38, 8, 2, bacak('BUS', 10, 'MB'), bacak('BUS', 14, '97M'), bacak('BUS', 6, '30M'));
    const gecVaran = r(0, 50, 8, 0, bacak('BUS', 42, '28T'));
    const sonuc = gereksizAktarmalariAyikla([direkt, aktarmali, gecVaran]);
    assert.deepEqual(sonuc, [direkt, gecVaran]);
  });

  it('daha az aktarmalı 3 dakikadan çok geç varıyorsa aktarmalı kalır', () => {
    const direkt = r(0, 45, 8, 0, bacak('BUS', 37, '89T'));
    const aktarmali = r(0, 38, 8, 1, bacak('BUS', 15, 'A'), bacak('BUS', 15, 'B'));
    assert.equal(gereksizAktarmalariAyikla([direkt, aktarmali]).length, 2);
  });

  it('metrolu rota otobüslüsü yüzünden atılmaz', () => {
    const otobus = r(0, 40, 8, 0, bacak('BUS', 32, '89T'));
    const metrolu = r(0, 41, 8, 1, bacak('SUBWAY', 20, 'M1B'), bacak('BUS', 13, '30D'));
    assert.equal(gereksizAktarmalariAyikla([otobus, metrolu]).length, 2);
  });

  it('aynı hattan inip yeniden binmek ve bir duraklık bacak cezalı', () => {
    const ayniHat = rota('1', 40, 8, 1, bacak('BUS', 15, '30M'), bacak('BUS', 15, '30M'));
    assert.equal(aktarmaCezasi(ayniHat), AYNI_HAT_CEZASI);
    const kisa = rota('2', 40, 8, 1, bacak('BUS', 2, '59N'), bacak('BUS', 30, '30A'));
    assert.ok(aktarmaCezasi(kisa) > 0);
    assert.equal(aktarmaCezasi(rota('3', 40, 8, 0, bacak('BUS', 2, '59N'))), 0, 'tek araçlı rota cezasız');
    assert.ok(oneriPuani(ayniHat) > oneriPuani(rota('4', 40, 8, 1, bacak('BUS', 15, 'A'), bacak('BUS', 15, 'B'))));
  });
});

describe('aracSiniri', () => {
  it('üçten çok araçlı rotalar atılır; başka rota yoksa kalır', () => {
    const dort = rota('1', 60, 10, 3, bacak('BUS', 10, 'A'), bacak('BUS', 10, 'B'), bacak('BUS', 10, 'C'), bacak('BUS', 10, 'D'));
    const uc = rota('2', 62, 10, 2, bacak('BUS', 10, 'A'), bacak('BUS', 10, 'B'), bacak('BUS', 10, 'C'));
    assert.deepEqual(aracSiniri([dort, uc]), [uc]);
    assert.deepEqual(aracSiniri([dort]), [dort]);
  });
});

describe('en rahat rota (önerilen puan)', () => {
  const saat = (dk: number) => new Date(Date.parse('2026-10-04T20:00:00+03:00') + dk * 60_000).toISOString();

  it('Metrobüs trafiksiz sayılır: otobüsle aynı sürede öne geçer', () => {
    const otobus = rota(saat(0), 50, 8, 0, bacak('BUS', 42, '500T'));
    const metrobus = rota(saat(0), 50, 8, 0, bacak('BUS', 42, '34'));
    assert.ok(oneriPuani(metrobus) < oneriPuani(otobus));
    assert.equal(otobusSuresi(metrobus), 0);
  });

  it('aktarmada uzun bekleme ve daha geç kalkış puanı artırır', () => {
    const bekleyen = { ...rota(saat(0), 50, 8, 1, bacak('BUS', 15, 'A'), bacak('BUS', 15, 'B')) };
    assert.equal(aktarmaBeklemesi(bekleyen), 20 * 60);
    const gec = rota(saat(20), 40, 8, 0, bacak('SUBWAY', 32, 'M2'));
    const erken = rota(saat(0), 40, 8, 0, bacak('SUBWAY', 32, 'M2'));
    const ref = Date.parse(saat(0));
    assert.ok(oneriPuani(gec, ref) > oneriPuani(erken, ref));
    assert.equal(oneriPuani(gec), oneriPuani(erken), 'referans yoksa evde bekleme sayılmaz');
  });

  it('metro + kısa yürüyüş, aynı süreli üç otobüslü rotanın önünde', () => {
    const metrolu = rota(saat(0), 55, 12, 1, bacak('SUBWAY', 25, 'M1B'), bacak('SUBWAY', 15, 'M2'));
    const otobuslu = rota(saat(0), 52, 8, 2, bacak('BUS', 15, 'A'), bacak('BUS', 15, 'B'), bacak('BUS', 12, 'C'));
    assert.equal(rotalariSirala([otobuslu, metrolu], 'dengeli')[0], metrolu);
  });
});

describe('yoğun saatte otobüs', () => {
  const r = (start: string) => rota(start, 50, 8, 0, bacak('BUS', 42, '500T'));
  it('hafta içi 07–10 ve 17–20 arası otobüs payı yüksek, hafta sonu değil', () => {
    assert.equal(otobusPayi(r('2026-10-05T18:04:00+03:00')), 0.6, 'pazartesi akşam');
    assert.equal(otobusPayi(r('2026-10-05T08:30:00+03:00')), 0.6, 'pazartesi sabah');
    assert.equal(otobusPayi(r('2026-10-05T13:00:00+03:00')), 0.3, 'öğle');
    assert.equal(otobusPayi(r('2026-10-04T18:04:00+03:00')), 0.3, 'pazar akşam');
    assert.equal(otobusPayi(r('1')), 0.3);
  });
});

describe('benzerleriAyikla', () => {
  const saat = (dk: number) => new Date(Date.parse('2026-10-04T18:00:00+03:00') + dk * 60_000).toISOString();
  it('aynı hatlar ve yakın kalkış: yalnız öndeki kalır', () => {
    const a = rota(saat(0), 66, 23, 2, bacak('SUBWAY', 18, 'M1B'), bacak('BUS', 14, '41ST'), bacak('BUS', 5, '62G'));
    const b = rota(saat(0), 66, 24, 2, bacak('SUBWAY', 18, 'M1B'), bacak('BUS', 13, '41ST'), bacak('BUS', 3, '62G'));
    const c = rota(saat(16), 65, 25, 1, bacak('SUBWAY', 21, 'M1B'), bacak('BUS', 13, '28T'));
    const d = rota(saat(32), 66, 21, 2, bacak('SUBWAY', 18, 'M1B'), bacak('BUS', 12, '41ST'), bacak('BUS', 6, '62G'));
    assert.deepEqual(benzerleriAyikla([a, b, c, d]), [a, c, d]);
  });

  it('ikisinden daha az yürüten kalır, öndekinin yerinde', () => {
    // 141M › 41ST: biri ileriki durağa 8 dk yürütüp 09:07'de, öbürü 6 dk yürütüp 09:07'de varıyor.
    const cokYuruten = rota(saat(36), 31, 8, 1, bacak('BUS', 22, '141M'), bacak('BUS', 6, '41ST'));
    const azYuruten = rota(saat(35), 32, 6, 1, bacak('BUS', 22, '141M'), bacak('BUS', 6, '41ST'));
    const baska = rota(saat(40), 50, 20, 1, bacak('SUBWAY', 20, 'M7'), bacak('BUS', 10, '50N'));
    assert.deepEqual(benzerleriAyikla([cokYuruten, baska, azYuruten]), [azYuruten, baska]);
  });
});

describe('yuruyusleKiyasla', () => {
  it('yürüyerek 25 dk ise, 29 dk yürüten metrolu rota anlamsız; 15 dk yürüten kalır', () => {
    const yuruyus = rota('y', 25, 25, 0);
    const anlamsiz = rota('m', 31, 29, 0, bacak('SUBWAY', 2, 'M3'));
    const iyi = rota('o', 25, 6, 0, bacak('BUS', 19, '97M'));
    const sinirda = rota('s', 28, 20, 0, bacak('BUS', 8, '89C'));
    assert.deepEqual(yuruyusleKiyasla([yuruyus, anlamsiz, iyi, sinirda]).map((r) => r.start), ['y', 'o', 's']);
  });
  it('yürüyüş seçeneği yoksa dokunmaz', () => {
    const liste = [rota('m', 31, 29, 0, bacak('SUBWAY', 2, 'M3'))];
    assert.equal(yuruyusleKiyasla(liste), liste);
  });
});
