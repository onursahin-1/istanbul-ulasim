// Çevrimdışı yedeğin kurallarının testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { gunBasi, gunTuru, gunuKaydir, kacGun, kullanilabilir, tasanlar, tazelikYaz } from '../onbellek';

// 2026-09-16 Çarşamba 09:00 yerel
const CARSAMBA = new Date(2026, 8, 16, 9, 0, 0).getTime();
const PERSEMBE = new Date(2026, 8, 17, 9, 0, 0).getTime();
const CUMARTESI = new Date(2026, 8, 19, 9, 0, 0).getTime();
const PAZAR = new Date(2026, 8, 20, 9, 0, 0).getTime();

const kayit = <T,>(veri: T, zaman: number) => ({ veri, zaman, gunTuru: gunTuru(zaman) });

describe('gunTuru', () => {
  it('haftanın üç tarife türünü ayırır', () => {
    assert.equal(gunTuru(CARSAMBA), 'haftaici');
    assert.equal(gunTuru(CUMARTESI), 'cumartesi');
    assert.equal(gunTuru(PAZAR), 'pazar');
  });
  it('Date ve epoch aynı sonucu verir', () => {
    assert.equal(gunTuru(new Date(CUMARTESI)), gunTuru(CUMARTESI));
  });
});

describe('kullanilabilir', () => {
  it('aynı gün türünden taze kaydı kabul eder', () => {
    assert.equal(kullanilabilir(kayit('x', CARSAMBA), PERSEMBE), true);
  });

  it('hafta içi kaydını cumartesi göstermez', () => {
    // Asıl koruma bu: cumartesi tarifesi seyrek, hafta içini göstermek yolcuyu yanıltır.
    assert.equal(kullanilabilir(kayit('x', CARSAMBA), CUMARTESI), false);
  });

  it('cumartesi ile pazarı da ayırır', () => {
    assert.equal(kullanilabilir(kayit('x', CUMARTESI), PAZAR), false);
  });

  it('çok eski kaydı atar', () => {
    const eski = CARSAMBA - 40 * 86400000;
    assert.equal(kullanilabilir(kayit('x', eski), CARSAMBA), false);
    assert.equal(kullanilabilir(kayit('x', CARSAMBA - 7 * 86400000), CARSAMBA), true);
  });

  it('ömrü çağıran belirleyebilir', () => {
    const cuma = CARSAMBA - 5 * 86400000;   // 11 Eylül Cuma, yine hafta içi
    assert.equal(gunTuru(cuma), 'haftaici');
    assert.equal(kullanilabilir(kayit('x', cuma), CARSAMBA, 1), false);
    assert.equal(kullanilabilir(kayit('x', cuma), CARSAMBA, 7), true);
  });

  it('ileri tarihli ve bozuk kayda güvenmez', () => {
    assert.equal(kullanilabilir(kayit('x', CARSAMBA + 86400000), CARSAMBA), false);
    assert.equal(kullanilabilir(null, CARSAMBA), false);
    assert.equal(kullanilabilir({ veri: 'x', zaman: NaN, gunTuru: 'haftaici' }, CARSAMBA), false);
  });
});

describe('gunuKaydir', () => {
  it('kaydı gün farkı kadar öteler', () => {
    const dunGunBasi = gunBasi(CARSAMBA);
    assert.equal(gunuKaydir(dunGunBasi, CARSAMBA, PERSEMBE), gunBasi(PERSEMBE));
  });

  it('aynı gün içinde kaydırmaz', () => {
    const g = gunBasi(CARSAMBA);
    assert.equal(gunuKaydir(g, CARSAMBA, CARSAMBA + 3 * 3600000), g);
  });

  it('kaydırma saatleri bozmaz', () => {
    // 08:30 kalkış, bir gün sonra yine 08:30 olmalı.
    const kalkis = gunBasi(CARSAMBA) + 8 * 3600 + 30 * 60;
    const yeni = gunuKaydir(gunBasi(CARSAMBA), CARSAMBA, PERSEMBE) + 8 * 3600 + 30 * 60;
    assert.equal(yeni - kalkis, 86400);
  });
});

describe('kacGun', () => {
  it('gün farkını verir', () => {
    assert.equal(Math.round(kacGun({ zaman: CARSAMBA }, PERSEMBE)), 1);
    assert.equal(kacGun({ zaman: PERSEMBE }, CARSAMBA), 0, 'gelecek kayıt eksi gün vermez');
  });
});

describe('tazelikYaz', () => {
  it('yaşı kullanıcının okuyacağı gibi yazar', () => {
    assert.equal(tazelikYaz({ zaman: CARSAMBA }, CARSAMBA + 20000), 'az önce kaydedildi');
    assert.equal(tazelikYaz({ zaman: CARSAMBA }, CARSAMBA + 7 * 60000), '7 dk önce kaydedildi');
    assert.equal(tazelikYaz({ zaman: CARSAMBA }, CARSAMBA + 3 * 3600000), '3 saat önce kaydedildi');
    assert.equal(tazelikYaz({ zaman: CARSAMBA }, PERSEMBE), 'dün kaydedildi');
    assert.equal(tazelikYaz({ zaman: CARSAMBA }, CARSAMBA + 5 * 86400000), '5 gün önce kaydedildi');
  });
});

describe('tasanlar', () => {
  const k = (a: string, z: number) => ({ anahtar: a, zaman: z });

  it('sınırın altında hiçbir şey atmaz', () => {
    assert.deepEqual(tasanlar([k('a', 3), k('b', 1)], 5), []);
  });

  it('en eskileri atar', () => {
    assert.deepEqual(tasanlar([k('eski', 1), k('yeni', 9), k('orta', 5)], 2), ['eski']);
  });

  it('girdiyi değiştirmez', () => {
    const liste = [k('a', 1), k('b', 9)];
    tasanlar(liste, 1);
    assert.deepEqual(liste.map((x) => x.anahtar), ['a', 'b']);
  });
});
