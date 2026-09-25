// Ağ haritasının çizgi ve dokunma hesaplarının testleri.
//
// Son bölüm uygulamayla giden gerçek assets/veri/ag.json'u okuyor: 26 hattın
// hepsi çiziliyor mu, hepsine dokunulabiliyor mu.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { cizgiyeUzaklik, enYakinCizgi, metrePiksel, polylineCoz, type Nokta } from '../cografya';

const n = (latitude: number, longitude: number): Nokta => ({ latitude, longitude });

describe('cizgiyeUzaklik', () => {
  // Kabaca Kadıköy çevresinde, doğu-batı uzanan 1 km'lik bir parça.
  const parca = [n(40.99, 29.02), n(40.99, 29.0319)];

  it('çizginin üstündeki noktada sıfır verir', () => {
    assert.ok(cizgiyeUzaklik(n(40.99, 29.025), parca) < 0.5);
  });

  it('dik uzaklığı metre olarak verir', () => {
    // 0.001 derece enlem ≈ 110 m
    const u = cizgiyeUzaklik(n(40.991, 29.025), parca);
    assert.ok(Math.abs(u - 110.5) < 2, `beklenen ~110 m, çıkan ${u.toFixed(1)}`);
  });

  it('parçanın ucundan ötede uca olan uzaklığı verir', () => {
    const u = cizgiyeUzaklik(n(40.99, 29.019), parca);   // batı ucunun 0.001° batısı
    assert.ok(Math.abs(u - 84) < 3, `beklenen ~84 m, çıkan ${u.toFixed(1)}`);
  });

  it('kırık çizgide en yakın parçayı bulur', () => {
    const kose = [n(41.0, 29.0), n(41.0, 29.01), n(41.01, 29.01)];
    assert.ok(cizgiyeUzaklik(n(41.005, 29.01), kose) < 0.5, 'ikinci parçanın üstü');
  });

  it('boş ve tek noktalı çizgide çökmez', () => {
    assert.equal(cizgiyeUzaklik(n(41, 29), []), Infinity);
    assert.ok(cizgiyeUzaklik(n(41, 29), [n(41, 29)]) < 0.01);
  });
});

describe('enYakinCizgi', () => {
  const kuzey = { anahtar: 'kuzey', noktalar: [n(41.001, 29.0), n(41.001, 29.01)] };   // ~110 m kuzeyde
  const guney = { anahtar: 'guney', noktalar: [n(40.9995, 29.0), n(40.9995, 29.01)] }; // ~55 m güneyde

  it('eşik içindeki en yakın çizgiyi seçer', () => {
    assert.equal(enYakinCizgi(n(41.0, 29.005), [kuzey, guney], 200), 'guney');
  });

  it('eşikten uzaksa null döner — boş yere dokunmak seçimi kapatır', () => {
    assert.equal(enYakinCizgi(n(41.0, 29.005), [kuzey, guney], 30), null);
  });

  it('eşitlikte listede önce geleni seçer', () => {
    const a = { anahtar: 'Marmaray', noktalar: guney.noktalar };
    const b = { anahtar: 'Marmaray1', noktalar: guney.noktalar };
    assert.equal(enYakinCizgi(n(40.9995, 29.005), [a, b], 50), 'Marmaray');
  });

  it('boş listede null döner', () => {
    assert.equal(enYakinCizgi(n(41, 29), [], 100), null);
  });
});

describe('metrePiksel', () => {
  it('bölgenin genişliğini ekrana böler', () => {
    // 0.1° boylam, 41° enlemde ≈ 8.4 km; 390 px ekranda ≈ 21.6 m/px
    const m = metrePiksel({ latitude: 41, longitudeDelta: 0.1 }, 390);
    assert.ok(Math.abs(m - 21.6) < 0.5, `çıkan ${m.toFixed(2)}`);
  });
  it('genişlik yoksa sıfır verir', () => {
    assert.equal(metrePiksel({ latitude: 41, longitudeDelta: 0.1 }, 0), 0);
  });
});

describe('gerçek ağ verisi (assets/veri/ag.json)', () => {
  const ham = JSON.parse(readFileSync(new URL('../../../assets/veri/ag.json', import.meta.url), 'utf8')) as {
    hatlar: { id: string; kod: string; cizgi: string; duraklar: { lat: number; lon: number }[] }[];
  };
  const hatlar = ham.hatlar.map((h) => ({ ...h, noktalar: polylineCoz(h.cizgi) }));

  it('26 hattın hepsi var ve çiziliyor (T5, T6, F4 eklendi; M3A M9 oldu)', () => {
    assert.equal(hatlar.length, 26);
    for (const h of hatlar) assert.ok(h.noktalar.length >= 2, `${h.kod} çizilemiyor`);
  });

  it('bütün noktalar İstanbul ve çevresinde', () => {
    for (const h of hatlar) {
      for (const p of h.noktalar) {
        assert.ok(p.latitude > 40.7 && p.latitude < 41.4 && p.longitude > 28.4 && p.longitude < 29.6, `${h.kod} şehir dışında`);
      }
    }
  });

  it('istasyonlar kendi hattının çizgisine yakın', () => {
    for (const h of hatlar) {
      for (const d of h.duraklar) {
        const u = cizgiyeUzaklik(n(d.lat, d.lon), h.noktalar);
        assert.ok(u < 400, `${h.kod}: bir istasyon çizgiden ${u.toFixed(0)} m uzakta`);
      }
    }
  });

  it('her hatta dokunulabiliyor', () => {
    // Her hattın ortasındaki noktaya, telefondaki gibi ~22 px'lik payla dokun.
    // Kesişen hatlarda başka bir hat seçilebilir; önemli olan seçilenin gerçekten
    // o noktanın üstünden geçmesi ve hiçbir hattın ulaşılamaz olmaması.
    const cizgiler = hatlar.map((h) => ({ anahtar: h.kod, noktalar: h.noktalar }));
    const pay = metrePiksel({ latitude: 41.05, longitudeDelta: 0.08 }, 390) * 22;
    const ulasilamayan: string[] = [];
    for (const h of hatlar) {
      const orta = h.noktalar[Math.floor(h.noktalar.length / 2)];
      const secilen = enYakinCizgi(orta, cizgiler, pay);
      if (!secilen) ulasilamayan.push(h.kod);
      else {
        const secilenHat = hatlar.find((x) => x.kod === secilen)!;
        assert.ok(cizgiyeUzaklik(orta, secilenHat.noktalar) < 1, `${h.kod} ortasında ${secilen} seçildi ama oradan geçmiyor`);
      }
    }
    assert.deepEqual(ulasilamayan, []);
  });
});
