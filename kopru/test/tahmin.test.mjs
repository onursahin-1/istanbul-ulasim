// Canlı akışta öğrenilen yol süreleriyle varış tahmini (2. aşama).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

import { KARAR_EN_AZ, KaliteOlcer, yontemKarari } from '../kalite.mjs';
import { durakGuncellemeleri, gecikmeAkisi } from '../kopru.mjs';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

/** Kalite özetinin karar için gereken kısmı: n tahmin, ortalama mutlak hata. */
const ozet = (n, ortMutlak) => ({ n, mutlak: n * ortMutlak });

describe('yontemKarari', () => {
  it('ölçüm azsa sabit gecikme', () => {
    const k = yontemKarari(ozet(10, 200), ozet(10, 100), ozet(10, 40), ozet(10, 30));
    assert.equal(k.ogrenilen, false);
    assert.match(k.neden, /ölçüm az/);
  });

  it('4 durakta daha iyiyse ve 1 durakta belirgin kötü değilse öğrenilen', () => {
    assert.equal(yontemKarari(ozet(123, 199), ozet(123, 165), ozet(447, 39), ozet(447, 31)).ogrenilen, true);
    // 1 durakta %10'dan ve 15 sn'den fazla kötüyse hayır
    assert.equal(yontemKarari(ozet(123, 199), ozet(123, 165), ozet(447, 39), ozet(447, 60)).ogrenilen, false);
    // 4 durakta kötüyse hayır
    assert.equal(yontemKarari(ozet(123, 150), ozet(123, 165), ozet(447, 39), ozet(447, 31)).ogrenilen, false);
  });

  it('gün dönünce, yeni günün ölçümü yetene kadar dünkü karar geçerli', () => {
    const k = new KaliteOlcer({});
    k.yeni[3] = { ...k.yeni[3], n: KARAR_EN_AZ, mutlak: KARAR_EN_AZ * 200 };
    k.ogrenilen[3] = { ...k.ogrenilen[3], n: KARAR_EN_AZ, mutlak: KARAR_EN_AZ * 150 };
    assert.equal(k.karar().ogrenilen, true);
    k.sifirla('2026-09-28');
    const ertesi = k.karar();
    assert.equal(ertesi.ogrenilen, true);
    assert.match(ertesi.neden, /dünkü/);
  });
});

const arac = { seferId: 's1', rotaId: 'r1', yon: 0, kapiNo: 'A-1', sira: 5, durakId: 'd5', gecikme: 120, damga: 1_000_000 };

describe('durakGuncellemeleri', () => {
  it('öğrenilen varış yoksa yalnız sıradaki durak ve gecikme', () => {
    assert.deepEqual(
      durakGuncellemeleri(arac, null).map((u) => [u.stopSequence, u.arrival.delay]),
      [[5, 120]],
    );
    // Hiçbiri öğrenilmemişse de sabit gecikme (varislar tarifeyle aynı şeyi söylüyor).
    const planli = [{ sira: 5, an: 1_000_060, ogrenilen: false }];
    assert.equal(durakGuncellemeleri(arac, planli)[0].arrival.delay, 120);
  });

  it('öğrenilen varışlarla her durağa mutlak an, azalmayan', () => {
    const varislar = [
      { sira: 5, an: 1_000_060.4, ogrenilen: false },
      { sira: 6, an: 1_000_200, ogrenilen: true },
      { sira: 7, an: 1_000_190, ogrenilen: true }, // geriye düşen: bir öncekine eşitlenir
    ];
    assert.deepEqual(
      durakGuncellemeleri(arac, varislar).map((u) => [u.stopSequence, u.arrival.time]),
      [
        [5, 1_000_060],
        [6, 1_000_200],
        [7, 1_000_200],
      ],
    );
  });

  it('akışa kodlanıp çözülebiliyor', () => {
    const varislar = [
      { sira: 5, an: 1_000_060, ogrenilen: true },
      { sira: 6, an: 1_000_200, ogrenilen: true },
    ];
    const akis = FeedMessage.decode(gecikmeAkisi([arac], new Date(1_000_000_000), () => varislar));
    const st = akis.entity[0].tripUpdate.stopTimeUpdate;
    assert.equal(st.length, 2);
    assert.equal(Number(st[1].arrival.time), 1_000_200);
  });
});
