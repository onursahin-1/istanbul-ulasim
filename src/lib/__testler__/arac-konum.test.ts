// Canlı otobüs konumlarının durak sırasına yerleştirilmesinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  araclariYerlestir,
  durakSirasindaYer,
  gecikmeKisa,
  kalanYaz,
  yaklasanOtobus,
  seferGecikmesi,
  yasSinifi,
  yasYaz,
} from '../arac-konum';

// Kuzeye giden düz bir hat: duraklar arası ~222 m (0.002° enlem).
const D = [0, 1, 2, 3].map((i) => ({ gtfsId: `d${i}`, name: `Durak ${i}`, lat: 41 + i * 0.002, lon: 29 }));
const SIMDI = Date.parse('2026-09-23T10:00:00Z');
const once = (sn: number) => new Date(SIMDI - sn * 1000).toISOString();

describe('yaş', () => {
  it('5 dk altı taze, 5–10 dk eski, 10 dk ve üstü gizli', () => {
    assert.equal(yasSinifi(299), 'taze');
    assert.equal(yasSinifi(300), 'eski');
    assert.equal(yasSinifi(599), 'eski');
    assert.equal(yasSinifi(600), 'gizli');
  });

  it('yazımı', () => {
    assert.equal(yasYaz(20), 'az önce');
    assert.equal(yasYaz(61), '1 dk önce');
    assert.equal(yasYaz(419), '6 dk önce');
  });
});

describe('gecikmeKisa', () => {
  it('bir dakikanın altı zamanında, üstü yuvarlanır', () => {
    assert.equal(gecikmeKisa(45), 'zamanında');
    assert.equal(gecikmeKisa(170), '+3 dk');
    assert.equal(gecikmeKisa(-130), '2 dk erken');
  });
});

describe('durakSirasindaYer', () => {
  it('durağa 40 m içindeyse durakta', () => {
    assert.deepEqual(durakSirasindaYer(D, 41.0021, 29), { konum: 1, durum: 'durakta', durak: 1 });
  });

  it('en yakın durağı geçmişse sonrakine yaklaşıyor', () => {
    // 1. durağın biraz kuzeyi: 2'ye 0'dan daha yakın.
    assert.deepEqual(durakSirasindaYer(D, 41.0026, 29), { konum: 1.5, durum: 'yaklasiyor', durak: 2 });
  });

  it('en yakın durağa henüz gelmemişse ona yaklaşıyor', () => {
    assert.deepEqual(durakSirasindaYer(D, 41.0014, 29), { konum: 0.5, durum: 'yaklasiyor', durak: 1 });
  });

  it('ilk durağın gerisindeyse başta bekliyor sayılır', () => {
    assert.deepEqual(durakSirasindaYer(D, 40.999, 29), { konum: 0, durum: 'durakta', durak: 0 });
  });

  it('son durağın ötesindeyse sonda', () => {
    assert.deepEqual(durakSirasindaYer(D, 41.0075, 29), { konum: 3, durum: 'durakta', durak: 3 });
  });

  it('koordinatı olmayan duraklarda null', () => {
    assert.equal(durakSirasindaYer([{ gtfsId: 'x' }], 41, 29), null);
  });
});

describe('seferGecikmesi', () => {
  const st = [
    { stop: { gtfsId: 'd1' }, departureDelay: 120, realtime: true },
    { stop: { gtfsId: 'd2' }, departureDelay: 180, realtime: true },
    { stop: { gtfsId: 'd3' }, departureDelay: 0, realtime: false },
  ];

  it('yaklaştığı duraktaki canlı gecikmeyi alır', () => {
    assert.equal(seferGecikmesi(st, 'd1'), 120);
  });

  it('o durakta canlı değer yoksa seferin son canlı değerini alır', () => {
    assert.equal(seferGecikmesi(st, 'd3'), 180);
  });

  it('hiç canlı değer yoksa null', () => {
    assert.equal(seferGecikmesi([{ stop: { gtfsId: 'd1' }, departureDelay: 0, realtime: false }], 'd1'), null);
    assert.equal(seferGecikmesi(null), null);
  });
});

describe('araclariYerlestir', () => {
  const arac = (id: string, lat: number, yas: number) => ({
    vehicleId: `1:${id}`,
    label: id,
    lat,
    lon: 29,
    heading: 0,
    lastUpdate: once(yas),
  });

  it('sıraya dizer, yaşı ve sınıfı ekler', () => {
    const sonuc = araclariYerlestir(D, [arac('B', 41.0045, 60), arac('A', 41.0014, 30)], SIMDI);
    assert.deepEqual(sonuc.map((a) => [a.etiket, a.konum, a.sinif]), [
      ['A', 0.5, 'taze'],
      ['B', 2.5, 'taze'],
    ]);
  });

  it('5 dk eskiyi soluk işaretler, 10 dk eskiyi atar', () => {
    const sonuc = araclariYerlestir(D, [arac('A', 41.0014, 360), arac('B', 41.0045, 700)], SIMDI);
    assert.deepEqual(sonuc.map((a) => [a.etiket, a.sinif]), [['A', 'eski']]);
  });

  it('konumu ya da zamanı olmayanı ve aynı aracın tekrarını atar', () => {
    const sonuc = araclariYerlestir(
      D,
      [
        { ...arac('A', 41.0014, 30), lat: null },
        { ...arac('B', 41.0014, 30), lastUpdate: null },
        arac('C', 41.0014, 30),
        arac('C', 41.0014, 30),
        null,
      ],
      SIMDI,
    );
    assert.deepEqual(sonuc.map((a) => a.etiket), ['C']);
  });

  it('gecikmeyi yaklaştığı duraktan alır', () => {
    const a = {
      ...arac('A', 41.0014, 30),
      trip: { stoptimesForDate: [{ stop: { gtfsId: 'd1' }, departureDelay: 190, realtime: true }] },
    };
    assert.equal(araclariYerlestir(D, [a], SIMDI)[0].gecikme, 190);
  });
});

describe('yaklasanOtobus', () => {
  const o = (etiket: string, konum: number, sefer: string | null = null) => ({
    kimlik: etiket,
    etiket,
    konum,
    durum: 'yaklasiyor' as const,
    durak: Math.ceil(konum),
    yasSn: 30,
    sinif: 'taze' as const,
    gecikme: null,
    sefer,
    lat: 41,
    lon: 29,
    heading: null,
  });

  it('durağın gerisindeki en yakın otobüsü seçer', () => {
    const r = yaklasanOtobus([o('A', 1.5), o('B', 3.5), o('C', 6)], 5);
    assert.equal(r?.otobus.etiket, 'B');
    assert.equal(r?.kalan, 2);
  });

  it('kalkışın seferini yapan otobüsü öne alır', () => {
    const r = yaklasanOtobus([o('A', 1.5, 's1'), o('B', 3.5, 's2')], 5, 's1');
    assert.equal(r?.otobus.etiket, 'A');
    assert.equal(r?.kalan, 4);
  });

  it('durakta olanın kalanı 0', () => {
    assert.equal(yaklasanOtobus([o('A', 5)], 5)?.kalan, 0);
  });

  it('durağı geçmiş ya da çok uzaktaki otobüs yaklaşan sayılmaz', () => {
    assert.equal(yaklasanOtobus([o('A', 6)], 5), null);
    assert.equal(yaklasanOtobus([o('A', 6), o('B', 0)], 30), null);
    assert.equal(yaklasanOtobus([o('A', 1)], -1), null);
  });

  it('yazımı', () => {
    assert.equal(kalanYaz(0), 'durakta');
    assert.equal(kalanYaz(2), '2 durak uzakta');
  });
});
