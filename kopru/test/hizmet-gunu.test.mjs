import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

import { konumAkisi } from '../kopru.mjs';
import { hizmetGunleri, seferBul } from '../tarife.mjs';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

/**
 * 89C'nin gerçek durumu: aynı duraktan hafta içi servisi 25:00'te, pazar servisi 25:05'te
 * kalkıyor (gece yarısını aşan son seferler). Pazartesi 01:10'da yoldaki araç pazar
 * servisinin seferindedir; hafta içi servisinin 25:00'i salı gecesi.
 */
const GUN = 86_400;
const HAFTAICI = { gunler: [false, true, true, true, true, true, false], bas: '20260101', bit: '20271231' };
const PAZAR = { gunler: [true, false, false, false, false, false, false], bas: '20260101', bit: '20271231' };
function tarife() {
  return {
    servisler: [HAFTAICI, PAZAR],
    durakBas: Int32Array.from([0, 2]),
    sSefer: Int32Array.from([0, 1]),
    sSaniye: Int32Array.from([25 * 3600, 25 * 3600 + 5 * 60]),
    sSira: Int32Array.from([1, 1]),
    seferRota: Int32Array.from([0, 0]),
    seferServis: Int32Array.from([0, 1]),
  };
}
// Pazartesi 28 Eylül 2026, 01:10 (yerel saat)
const simdi = new Date(2026, 8, 28, 1, 10);
const saniye = 1 * 3600 + 10 * 60;

describe('hizmet günü', () => {
  it('dün, bugün, yarın: tarih ve saniye farkı', () => {
    const g = hizmetGunleri(tarife(), simdi);
    assert.deepEqual(g.map((x) => [x.tarih, x.ek]), [['20260927', GUN], ['20260928', 0], ['20260929', -GUN]]);
    assert.deepEqual(g[0].aktif, [false, true], 'pazar: yalnız pazar servisi');
    assert.deepEqual(g[1].aktif, [true, false], 'pazartesi: yalnız hafta içi');
  });

  it("gece yarısından sonra dünün servisindeki sefere bağlanır", () => {
    const b = seferBul(tarife(), 0, 0, saniye, hizmetGunleri(tarife(), simdi));
    assert.equal(b.sefer, 1, "pazar servisinin 25:05'i");
    assert.equal(b.gun, '20260927');
    assert.equal(b.sapma, 25 * 3600 + 5 * 60 - (saniye + GUN), '5 dk sonra kalkacak');
  });

  it('eski biçim (yalnız bugünün servisleri) yanlış günün seferini seçiyordu', () => {
    const eski = seferBul(tarife(), 0, 0, saniye, hizmetGunleri(tarife(), simdi)[1].aktif);
    assert.equal(eski.sefer, 0, "hafta içi 25:00 — aslında salı gecesi");
    assert.equal(eski.gun, null);
  });

  it("canlı akışta start_date yazılır", () => {
    const akis = konumAkisi(
      [{ kapiNo: 'T1045', seferId: 's1', rotaId: '3404', yon: 0, hizmetGunu: '20260927', enlem: 41.06, boylam: 28.86, sira: 18, durakId: 'd', damga: 1 }],
      simdi,
    );
    const mesaj = FeedMessage.decode(akis);
    assert.equal(mesaj.entity[0].vehicle.trip.startDate, '20260927');
  });
});
