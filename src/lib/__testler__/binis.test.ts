// Binişin konum izinden anlaşılması ve kaba konumla ilerleme (yolculuk.ts).
//
// İzler gerçek yolculuğa benzetiliyor: otobüs 8 m/sn, yürüyüş 1,4 m/sn, iPhone'un otobüs
// içinde ve istasyonda verdiği 65–100 m doğruluklu "kaba" konumlar.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adimlariKur,
  binisiAlgila,
  durumuIlerlet,
  durumuZamanla,
  elleBin,
  elleVar,
  hattaBekliyor,
  ISTASYONDA_KABA_MS,
  konumlaIlerleme,
  SINYAL_KAYBI_MS,
  type BacakOzeti,
  type KonumOrnegi,
  type YolculukDurumu,
} from '../yolculuk';

// Kuzeye giden hat: 0.001° enlem ≈ 111 m. Duraklar ~333 m arayla.
const n = (enlem: number, boylam = 29) => ({ latitude: 41 + enlem, longitude: boylam });
const M = 1 / 111_000; // bir metre, derece enlem
const DURAKLAR = [0, 0.003, 0.006, 0.009, 0.012].map((e) => n(e));
const CIZGI = Array.from({ length: 49 }, (_, i) => n(i * 0.00025));

const BACAKLAR: BacakOzeti[] = [
  { arac: false, mesafe: 200, bitis: n(0), duraklar: [] },
  { arac: true, mesafe: 1330, bitis: n(0.012), duraklar: DURAKLAR, cizgi: CIZGI },
  { arac: false, mesafe: 100, bitis: n(0.012, 29.001), duraklar: [] },
];
const ADIMLAR = adimlariKur(BACAKLAR);
const BEKLE: YolculukDurumu = { adim: 1, faz: 'bekle', kalanDurak: null, durakta: false };

/** Duraktan `bas` saniyede kalkıp `hiz` m/sn ile kuzeye giden iz; her `ara` saniyede bir ölçüm. */
function iz(o: {
  sure: number;
  hiz: number;
  bas?: number;
  ara?: number;
  dogruluk?: number;
  doppler?: boolean;
  t0?: number;
}): KonumOrnegi[] {
  const { sure, hiz, bas = 0, ara = 2, dogruluk = 10, doppler = true, t0 = 1_000_000 } = o;
  const liste: KonumOrnegi[] = [];
  for (let s = 0; s <= sure; s += ara) {
    const yol = Math.max(0, s - bas) * hiz;
    liste.push({
      an: t0 + s * 1000,
      konum: n(yol * M),
      dogruluk,
      hiz: doppler ? (s > bas ? hiz : 0) : null,
    });
  }
  return liste;
}

/** İzi baştan sona durumuIlerlet'ten geçirir; değiştiği ilk anı ve son durumu döner. */
function oynat(d0: YolculukDurumu, liste: KonumOrnegi[]) {
  let d = d0;
  let ilkIcinde: number | null = null;
  for (let k = 0; k < liste.length; k++) {
    d = durumuIlerlet(d, liste[k].konum, ADIMLAR, BACAKLAR, { dogruluk: liste[k].dogruluk, iz: liste.slice(0, k + 1) });
    if (d.faz === 'icinde' && ilkIcinde == null) ilkIcinde = liste[k].an;
  }
  return { d, ilkIcinde };
}

describe('binisiAlgila', () => {
  it('otobüs duraktan kalkınca sıradaki durağa varmadan anlar; biniş anı duraktan ayrılış', () => {
    // 60 sn durakta bekle, sonra 8 m/sn.
    const liste = iz({ sure: 120, hiz: 8, bas: 60 });
    const { d, ilkIcinde } = oynat(BEKLE, liste);
    assert.equal(d.faz, 'icinde');
    assert.ok(ilkIcinde! - 1_000_000 <= 60_000 + 25_000, `kalkıştan ≤ 25 sn sonra (oldu: ${(ilkIcinde! - 1_060_000) / 1000} sn)`);
    assert.ok(Math.abs(d.binisAn! - 1_060_000) <= 5_000, `biniş anı kalkışa ≤ 5 sn (oldu ${(d.binisAn! - 1_060_000) / 1000})`);
  });

  it('telefonun hızı (Doppler) gelmese de çizgi boyunca ilerlemeden anlar', () => {
    const { d } = oynat(BEKLE, iz({ sure: 120, hiz: 8, bas: 60, doppler: false }));
    assert.equal(d.faz, 'icinde');
  });

  it('durakta beklerken hat boyunca yürüyen binmiş sayılmaz', () => {
    const { d } = oynat(BEKLE, iz({ sure: 400, hiz: 1.4, bas: 30 }));
    assert.equal(d.faz, 'bekle', '~520 m yürüdü, araç değil');
  });

  it('koşarak 100 m yürüse de sayılmaz (yetişmeye çalışan)', () => {
    const { d } = oynat(BEKLE, iz({ sure: 60, hiz: 4.5, bas: 30 }).slice(0, 13));
    assert.equal(d.faz, 'bekle');
  });

  it('otobüs içinde iPhone 65 m doğruluk verse de anlar (eskiden bu konumlar atılıyordu)', () => {
    const { d, ilkIcinde } = oynat(BEKLE, iz({ sure: 150, hiz: 8, bas: 60, ara: 5, dogruluk: 65, doppler: false }));
    assert.equal(d.faz, 'icinde');
    assert.ok(ilkIcinde! - 1_060_000 <= 45_000, 'kalkıştan ≤ 45 sn sonra');
  });

  it('trafikte kalkıp hemen duran otobüs: kısa bir hızlanma yeter', () => {
    // 8 m/sn ile 25 sn (200 m), sonra yerinde.
    const hareket = iz({ sure: 85, hiz: 8, bas: 60 });
    const duran = Array.from({ length: 30 }, (_, k) => ({ ...hareket[hareket.length - 1], an: 1_086_000 + k * 2000, hiz: 0 }));
    const { d } = oynat(BEKLE, [...hareket, ...duran]);
    assert.equal(d.faz, 'icinde');
  });

  it('metro: istasyon girişinden sonra konum yok, sonraki istasyonda kaba konum gelince anlar', () => {
    // Giriş istasyonun 150 m yanında (hattın yanında değil); 4 dk sonra 1 km ilerde kaba konum.
    const giris: KonumOrnegi = { an: 1_760_000, konum: n(0, 29.0018), dogruluk: 10 };
    const istasyon: KonumOrnegi = { an: 2_000_000, konum: n(0.009), dogruluk: 100 };
    assert.equal(binisiAlgila([giris, istasyon], CIZGI), 1_760_000, 'biniş anı girişte görülen son an');
    const { d } = oynat(BEKLE, [giris, istasyon]);
    assert.equal(d.faz, 'icinde');
    assert.ok(d.kalanDurak! >= 1, 'kaba konum doğruluğu kadar geride sayılır');
  });

  it('hattın yanında oturan, yolculuğu evden başlatınca binmiş sayılmaz (videodaki hata)', () => {
    // Ev, biniş istasyonundan 700 m ilerde hattın 60 m yanında; bina içi konum 30–200 m sıçrıyor.
    const ev = (k: number, dogruluk: number, sapma: number) => ({
      an: 3_000_000 + k * 5_000,
      konum: n(0.0063 + sapma, 29.0007),
      dogruluk,
    });
    const liste = [ev(0, 30, 0), ev(1, 200, 0.0015), ev(2, 120, -0.001), ev(3, 65, 0.0008), ev(4, 200, 0.002)];
    const { d } = oynat({ adim: 0, faz: 'yuru', kalanDurak: null, durakta: false }, liste);
    assert.equal(d.adim, 0);
    assert.equal(d.faz, 'yuru');
  });

  it('hattın çizgisinden uzaktaki hızlı hareket (başka yoldaki taksi) biniş değil', () => {
    const yan = iz({ sure: 120, hiz: 8, bas: 60 }).map((o) => ({ ...o, konum: { ...o.konum, longitude: 29.004 } }));
    assert.equal(oynat(BEKLE, yan).d.faz, 'bekle');
  });

  it('yürüyüş adımındayken (durağa varış anlaşılmadan) gelen otobüse binince de anlar', () => {
    const yuru: YolculukDurumu = { adim: 0, faz: 'yuru', kalanDurak: null, durakta: false };
    // Durağa 70 m kala konum kaba (65 m): varış sayılmadı; sonra otobüs.
    const liste = iz({ sure: 120, hiz: 8, bas: 60, dogruluk: 10 });
    const { d } = oynat(yuru, [{ an: 990_000, konum: n(-70 * M), dogruluk: 65 }, ...liste]);
    assert.equal(d.adim, 1);
    assert.equal(d.faz, 'icinde');
  });
});

describe('kaba konumla ilerleme', () => {
  it('konumlaIlerleme: pay kadar geride sayar', () => {
    assert.equal(Math.round(konumlaIlerleme(DURAKLAR, n(0.0045))! * 100) / 100, 1.5);
    const temkinli = konumlaIlerleme(DURAKLAR, n(0.0045), 100, 200)!;
    assert.ok(temkinli < 1.5 && temkinli > 1.1, `~1,2 (oldu ${temkinli})`);
  });

  it('kıvrılan yolda aracın gerçek çizgisine göre ilerler (duraklar arası düz çizgiden uzakta da)', () => {
    // İki durak 666 m arayla kuzeyde; otobüs 400 m doğuya kıvrılan bir yoldan gidiyor.
    const duraklar = [n(0), n(0.006)];
    const yol = [n(0), n(0, 29.0048), n(0.006, 29.0048), n(0.006)];
    const ortada = n(0.003, 29.0048);
    assert.equal(konumlaIlerleme(duraklar, ortada), null, 'düz çizgiye 400 m: eskiden ilerlemiyordu');
    const ilerleme = konumlaIlerleme(duraklar, ortada, 0, 120, yol)!;
    assert.ok(Math.abs(ilerleme - 0.5) < 0.02, `yolun yarısı (oldu ${ilerleme})`);
  });

  it('araçtayken kaba konum ilerletir ama inişe karar vermez', () => {
    const icinde: YolculukDurumu = { adim: 1, faz: 'icinde', kalanDurak: 4, durakta: false, ilerleme: 0 };
    const ilerledi = durumuIlerlet(icinde, n(0.006), ADIMLAR, BACAKLAR, { dogruluk: 65 });
    assert.ok(ilerledi.ilerleme! > 1.5 && ilerledi.ilerleme! < 2, 'ikinci durağa varmadan');
    const inis: YolculukDurumu = { adim: 1, faz: 'icinde', kalanDurak: 0, durakta: true, ilerleme: 4 };
    assert.equal(durumuIlerlet(inis, n(0.012, 29.001), ADIMLAR, BACAKLAR, { dogruluk: 80 }), inis, 'kaba: inilmedi');
    assert.equal(durumuIlerlet(inis, n(0.012, 29.001), ADIMLAR, BACAKLAR, { dogruluk: 10 }).adim, 2, 'iyi: inildi');
  });

  it('300 m\'den kötü konum hiçbir şeyi değiştirmez', () => {
    assert.equal(durumuIlerlet(BEKLE, n(0.009), ADIMLAR, BACAKLAR, { dogruluk: 1200 }), BEKLE);
  });
});

describe('yürüyüşün sonu yol boyunca', () => {
  // İstasyon evin 40 m yanında ama giriş otoyolun öbür yakasında: 880 m dolaşan yürüyüş.
  const yol = [n(0.0004), n(0.0004, 29.004), n(-0.002, 29.004), n(-0.002), n(0)];
  const bacaklar: BacakOzeti[] = [{ ...BACAKLAR[0], cizgi: yol }, BACAKLAR[1], BACAKLAR[2]];
  const yuru: YolculukDurumu = { adim: 0, faz: 'yuru', kalanDurak: null, durakta: false };

  it('yürüyüşün başında, istasyona kuş uçuşu 40 m iken varılmış sayılmaz', () => {
    assert.equal(durumuIlerlet(yuru, n(0.0004), ADIMLAR, bacaklar, { dogruluk: 10 }), yuru);
    assert.equal(durumuIlerlet(yuru, n(0.0004), ADIMLAR, bacaklar, { dogruluk: 90 }), yuru);
  });

  it('yolun sonuna gelince varılmış sayılır', () => {
    assert.equal(durumuIlerlet(yuru, n(-0.0002), ADIMLAR, bacaklar, { dogruluk: 10 }).faz, 'bekle');
  });
});

describe('elleBin', () => {
  it('beklerken ya da öncesindeki yürüyüşte "Bindim" araca bindirir', () => {
    const d = elleBin(BEKLE, ADIMLAR, BACAKLAR, 5_000);
    assert.deepEqual(d, { adim: 1, faz: 'icinde', kalanDurak: 4, durakta: false, ilerleme: 0, binisAn: 5_000 });
    const yuru: YolculukDurumu = { adim: 0, faz: 'yuru', kalanDurak: null, durakta: false };
    assert.equal(elleBin(yuru, ADIMLAR, BACAKLAR, 5_000).adim, 1);
    const icinde = { ...d };
    assert.equal(elleBin(icinde, ADIMLAR, BACAKLAR, 9_000), icinde, 'zaten araçta');
  });
});

describe('araçta saatle ilerleme', () => {
  it('kaba konum geliyorsa saat ilerletmez (trafikteki otobüs ileri kaçmasın)', () => {
    const zamanli = BACAKLAR.map((b, i) => (i === 1 ? { ...b, binisMs: 0, inisMs: 600_000 } : b));
    const icinde: YolculukDurumu = { adim: 1, faz: 'icinde', kalanDurak: 4, durakta: false, ilerleme: 0 };
    const kaba = { an: 300_000, dogruluk: 65, konum: n(0) };
    assert.equal(durumuZamanla(icinde, 305_000, ADIMLAR, zamanli, kaba), icinde);
    assert.ok(durumuZamanla(icinde, 305_000, ADIMLAR, zamanli, null).ilerleme! > 1.5, 'konum yoksa saatle');
  });

  it('metroda tünelde gelen kaba (eski) konum saati durdurmaz; beklerken durdurur', () => {
    const metro = BACAKLAR.map((b, i) => (i === 1 ? { ...b, rayli: true, binisMs: 0, inisMs: 600_000 } : b));
    const icinde: YolculukDurumu = { adim: 1, faz: 'icinde', kalanDurak: 4, durakta: false, ilerleme: 0 };
    // Binilen istasyonda kalmış eski konum, ±176 m.
    const eski = { an: 300_000, dogruluk: 176, konum: n(0) };
    assert.ok(durumuZamanla(icinde, 305_000, ADIMLAR, metro, eski).ilerleme! > 1.5, 'saatle ilerler');
    // İyi konum gelirse yine konum karar verir.
    const iyi = { ...eski, dogruluk: 12 };
    assert.equal(durumuZamanla(icinde, 305_000, ADIMLAR, metro, iyi), icinde);
    // Peronda beklerken kaba konum varken kalkış saati geçti diye binilmiş sayılmaz.
    const bekle: YolculukDurumu = { adim: 1, faz: 'bekle', kalanDurak: null, durakta: false };
    assert.equal(durumuZamanla(bekle, 60_000, ADIMLAR, metro, { ...eski, an: 55_000 }), bekle);
  });
});

describe('metroya yürürken istasyona inilmesi', () => {
  const rayli = BACAKLAR.map((b, i) => (i === 1 ? { ...b, rayli: true } : b));
  const yuru: YolculukDurumu = { adim: 0, faz: 'yuru', kalanDurak: null, durakta: false };
  const gps = { an: 1_000_000, dogruluk: 10, konum: n(-120 * M) };

  it('konum istasyonun yanında kesilirse bir dakika sonra yürüyüş biter', () => {
    assert.equal(durumuZamanla(yuru, gps.an + 30_000, ADIMLAR, rayli, gps), yuru);
    assert.equal(durumuZamanla(yuru, gps.an + SINYAL_KAYBI_MS + 1, ADIMLAR, rayli, gps).faz, 'bekle');
  });

  it('otobüse yürürken ya da istasyondan uzakta kesilirse bitmez', () => {
    assert.equal(durumuZamanla(yuru, gps.an + SINYAL_KAYBI_MS + 1, ADIMLAR, BACAKLAR, gps), yuru, 'otobüs');
    const uzak = { ...gps, konum: n(-600 * M) };
    assert.equal(durumuZamanla(yuru, gps.an + SINYAL_KAYBI_MS + 1, ADIMLAR, rayli, uzak), yuru, 'uzak');
  });
});

describe('yolculuk yeraltı istasyonun içinde başlatıldı', () => {
  // Rota istasyondaki kaba konumdan çizildi: yürüyüş oradan girişe dolaşıyor (330 m), konum
  // kesilmiyor, istasyona 80 m görünüyor ve doğruluk 100 m.
  const rayli = BACAKLAR.map((b, i) => (i === 1 ? { ...b, rayli: true } : b));
  const yol = [n(-80 * M), n(-80 * M, 29.0015), n(0, 29.0015), n(0)];
  const bacaklar: BacakOzeti[] = [{ ...rayli[0], cizgi: yol }, rayli[1], rayli[2]];
  const yuru: YolculukDurumu = { adim: 0, faz: 'yuru', kalanDurak: null, durakta: false };
  const kaba = (an: number) => ({ an, dogruluk: 100, konum: n(-80 * M) });

  it('kaba konum istasyonun dibinde sürerse 30 sn sonra istasyondayız', () => {
    // Konumla tek başına anlaşılmıyor (yol boyunca 330 m kalmış görünüyor).
    assert.equal(durumuIlerlet(yuru, n(-80 * M), ADIMLAR, bacaklar, { dogruluk: 100 }), yuru);
    const t0 = 5_000_000;
    const d1 = durumuZamanla(yuru, t0, ADIMLAR, bacaklar, kaba(t0));
    assert.equal(d1.kabaYakin, t0);
    const d2 = durumuZamanla(d1, t0 + 10_000, ADIMLAR, bacaklar, kaba(t0 + 9_000));
    assert.equal(d2.faz, 'yuru');
    const d3 = durumuZamanla(d2, t0 + ISTASYONDA_KABA_MS, ADIMLAR, bacaklar, kaba(t0 + ISTASYONDA_KABA_MS - 1_000));
    assert.equal(d3.faz, 'bekle');
    assert.equal(d3.kabaYakin, undefined);
  });

  it('arada iyi konum gelirse sayaç sıfırlanır (evde, sokakta)', () => {
    const t0 = 5_000_000;
    const d1 = durumuZamanla(yuru, t0, ADIMLAR, bacaklar, kaba(t0));
    const iyi = { an: t0 + 15_000, dogruluk: 12, konum: n(-80 * M) };
    const d2 = durumuZamanla(d1, t0 + 15_000, ADIMLAR, bacaklar, iyi);
    assert.equal(d2.kabaYakin, undefined);
    const d3 = durumuZamanla(d2, t0 + ISTASYONDA_KABA_MS + 1, ADIMLAR, bacaklar, kaba(t0 + ISTASYONDA_KABA_MS));
    assert.equal(d3.faz, 'yuru', 'sayaç baştan başladı');
  });

  it('otobüse yürürken ya da istasyon doğruluk dairesinin dışındayken olmaz', () => {
    const t0 = 5_000_000;
    const otobus = [{ ...bacaklar[0] }, BACAKLAR[1], BACAKLAR[2]];
    assert.equal(durumuZamanla(yuru, t0, ADIMLAR, otobus, kaba(t0)).kabaYakin, undefined);
    const uzak = { an: t0, dogruluk: 100, konum: n(-400 * M) };
    assert.equal(durumuZamanla(yuru, t0, ADIMLAR, bacaklar, uzak).kabaYakin, undefined);
  });

  it('kaba konum gelip sonra kesilirse (iPhone dururken yenilemiyor) bir dakika sonra istasyondayız', () => {
    const t0 = 5_000_000;
    const d = durumuZamanla(yuru, t0 + SINYAL_KAYBI_MS + 1, ADIMLAR, bacaklar, kaba(t0));
    assert.equal(d.faz, 'bekle');
    // İyi konumla aynı yerde kesilirse (evde) yol boyunca bakılır: varılmamış.
    const iyi = { an: t0, dogruluk: 10, konum: n(-80 * M) };
    assert.equal(durumuZamanla(yuru, t0 + SINYAL_KAYBI_MS + 1, ADIMLAR, bacaklar, iyi).faz, 'yuru');
  });

  it('"İstasyondayım" yürüyüşü bitirir', () => {
    assert.equal(elleVar(yuru, ADIMLAR).faz, 'bekle');
    assert.equal(elleVar(BEKLE, ADIMLAR), BEKLE);
  });
});

describe('otobüs durağında bekleme (tabela verideki noktadan ötede)', () => {
  // Otobüs hattı kuzeye; durağın verideki noktası n(0). Tabela 100 m ileride, hattın 20 m yanında.
  const DOGU = 1 / 84_000; // bir metre, derece boylam (41° enlemde)
  const yuru: YolculukDurumu = { adim: 0, faz: 'yuru', kalanDurak: null, durakta: false };
  const bekleyen = (yer: { latitude: number; longitude: number }, sure = 25, dogruluk = 6): KonumOrnegi[] =>
    Array.from({ length: Math.floor(sure / 5) + 1 }, (_, i) => ({ an: 1_000_000 + i * 5_000, konum: yer, dogruluk }));
  const tabela = n(100 * M, 29 + 20 * DOGU);

  it('hattın yanında 20+ sn kıpırdamadan bekleyen durağa gelmiştir', () => {
    const z = bekleyen(tabela);
    assert.equal(hattaBekliyor(z, BACAKLAR[1]), true);
    const d = durumuIlerlet(yuru, tabela, ADIMLAR, BACAKLAR, { dogruluk: 6, iz: z });
    assert.equal(d.faz, 'bekle');
  });

  it('kısa süre ya da kaba konum yetmez', () => {
    assert.equal(hattaBekliyor(bekleyen(tabela, 10), BACAKLAR[1]), false, '10 sn');
    assert.equal(hattaBekliyor(bekleyen(tabela, 25, 90), BACAKLAR[1]), false, 'kaba');
  });

  it('evde (hattın 60 m yanında) beklemek durağa gelmek değildir', () => {
    const ev = n(20 * M, 29 + 60 * DOGU);
    assert.equal(hattaBekliyor(bekleyen(ev), BACAKLAR[1]), false);
  });

  it('hat boyunca yürüyen beklemiyor; biniş durağından çok ileride de değil', () => {
    const yuruyen: KonumOrnegi[] = Array.from({ length: 6 }, (_, i) => ({
      an: 1_000_000 + i * 5_000,
      konum: n(i * 7 * M, 29 + 15 * DOGU),
      dogruluk: 6,
    }));
    assert.equal(hattaBekliyor(yuruyen, BACAKLAR[1]), false, 'yürüyor');
    assert.equal(hattaBekliyor(bekleyen(n(600 * M, 29 + 10 * DOGU)), BACAKLAR[1]), false, '600 m ileride');
  });

  it('önceki duraktan gelen kısımda (biniş durağının gerisinde) bekleyen de sayılır', () => {
    const b = { ...BACAKLAR[1], oncekiDurak: n(-300 * M) };
    const geride = n(-80 * M, 29 + 15 * DOGU);
    assert.equal(hattaBekliyor(bekleyen(geride), b), true);
    assert.equal(hattaBekliyor(bekleyen(geride), BACAKLAR[1]), false, 'önceki durak bilinmiyorsa');
  });

  it('metroda kullanılmaz', () => {
    assert.equal(hattaBekliyor(bekleyen(tabela), { ...BACAKLAR[1], rayli: true }), false);
  });
});
