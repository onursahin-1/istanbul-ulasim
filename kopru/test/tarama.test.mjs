import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aracSayisiGuncelle, geceMi, ILGI_OMRU_MS, istanbulSaati, konumAni, Tarayici } from '../tarama.mjs';

const istanbul = (saat) => Date.UTC(2026, 8, 26, saat - 3, 0, 0);

describe('gece', () => {
  it('İstanbul saati UTC+3', () => {
    assert.equal(istanbulSaati(istanbul(2)), 2);
    assert.equal(istanbulSaati(istanbul(15)), 15);
  });
  it('01:00–05:00 gece', () => {
    assert.equal(geceMi(istanbul(0)), false);
    assert.equal(geceMi(istanbul(1)), true);
    assert.equal(geceMi(istanbul(4)), true);
    assert.equal(geceMi(istanbul(5)), false);
  });
});

describe('araç sayısı', () => {
  it('tek düşük sayım puanı silmez', () => {
    assert.equal(aracSayisiGuncelle(20, 0), 12);
    assert.equal(aracSayisiGuncelle(20, 25), 25);
    assert.equal(aracSayisiGuncelle(undefined, 3), 3);
  });

  it('gece sayılmış hat yüklenirken tarifeden onarılır', () => {
    const t = new Tarayici(null, { tahminiYogunluk: new Map([['500T', 30]]) });
    t.yukle({ hatDurumu: { '500T': { sonBakilan: istanbul(2), aracSayisi: 0 }, '34G': { sonBakilan: istanbul(14), aracSayisi: 0 } } });
    assert.equal(t.hatDurumu.get('500T').aracSayisi, 30);
    assert.equal(t.hatDurumu.get('34G').aracSayisi, 0);
  });
});

describe('ilgi', () => {
  const tarayici = () => {
    const t = new Tarayici(null, { tahminiYogunluk: new Map([['500T', 30], ['34G', 50], ['15F', 5]]) });
    t.hatlariAyarla(['500T', '34G', '15F']);
    const once = istanbul(12) - 3 * 3_600_000;
    for (const h of ['500T', '34G', '15F']) t.isle(h, [], once);
    t.hatDurumu.get('34G').aracSayisi = 50;
    t.hatDurumu.get('500T').aracSayisi = 30;
    return t;
  };

  it('bildirilen hat sıranın önüne geçer; listede olmayan hat yok sayılır', () => {
    const t = tarayici();
    const simdi = istanbul(12);
    assert.equal(t.sıradakiHat(simdi), '34G');
    assert.equal(t.ilgiBildir(['15f', 'M2'], false, simdi), 1);
    assert.equal(t.sıradakiHat(simdi), '15F');
  });

  it('az önce sorulmuş ilgili hat yeniden sorulmaz; gece yalnız ilgi', () => {
    const t = tarayici();
    const simdi = istanbul(12);
    t.ilgiBildir(['15F'], false, simdi);
    t.isle('15F', [], simdi - 60_000);
    assert.equal(t.sıradakiHat(simdi), '34G');
    assert.equal(t.sıradakiHat(simdi, true), null);
  });

  it('favori hat daha sık sorulur ve kaydedilir', () => {
    const t = tarayici();
    const simdi = istanbul(12);
    t.ilgiBildir(['15F'], true, simdi - ILGI_OMRU_MS - 1); // anlık ilgisi geçmiş, kalıcısı sürüyor
    t.hatDurumu.get('15F').aracSayisi = 12; // 13 × 5 = 65 > 51
    assert.equal(t.sıradakiHat(simdi), '15F');
    const u = new Tarayici(null);
    u.yukle(t.disaAktar(), simdi);
    assert.equal(u.kalici.has('15F'), true);
  });
});

describe('İETT en yakın durak', () => {
  it('konum zamanı İstanbul saatinden; okunamaz ya da çok uzaksa null', () => {
    const sorgu = Date.UTC(2026, 9, 7, 16, 6, 0); // 19:06 İstanbul
    assert.equal(konumAni('2026-10-07 19:05:12', sorgu), Date.UTC(2026, 9, 7, 16, 5, 12));
    assert.equal(konumAni('2026-10-07T19:05:12', sorgu), Date.UTC(2026, 9, 7, 16, 5, 12));
    assert.equal(konumAni('2026-10-07 17:05:12', sorgu), null);
    assert.equal(konumAni('', sorgu), null);
  });

  it('taramada en yakın durak ve konumun anı araçla birlikte saklanır', () => {
    const t = new Tarayici(null);
    const an = Date.UTC(2026, 9, 7, 16, 6, 0);
    t.isle('141M', [{ kapiNo: 'A-1', hat: '141M', guzergah: '141M_G_D0', yakinDurak: '125181', zaman: '2026-10-07 19:05:12' }], an);
    assert.deepEqual(t.bilgi('A-1'), {
      hat: '141M',
      tarananHat: '141M',
      guzergah: '141M_G_D0',
      an,
      yakinDurak: '125181',
      konumAn: Date.UTC(2026, 9, 7, 16, 5, 12),
      gorevde: true,
    });
    t.isle('141M', [{ kapiNo: 'A-2', hat: '141M', guzergah: '141M_G_D0', yakinDurak: '', zaman: '' }], an);
    assert.deepEqual(t.bilgi('A-2'), { hat: '141M', tarananHat: '141M', guzergah: '141M_G_D0', an, gorevde: true });
  });
});

describe('görevde mi (hattın son taramasında var mı)', () => {
  it('seferi biten otobüs bir sonraki taramada yoksa görevde değil; yeniden görülünce görevde', () => {
    const t = new Tarayici(null);
    const an = Date.UTC(2026, 9, 7, 21, 0, 0);
    const arac = (kapiNo) => ({ kapiNo, hat: '97GE', guzergah: '97GE_D_D0', yakinDurak: '', zaman: '' });
    t.isle('97GE', [arac('A-1725'), arac('A-1523')], an);
    assert.equal(t.bilgi('A-1523', an).gorevde, true);
    t.isle('97GE', [arac('A-1725')], an + 20 * 60_000);
    assert.equal(t.bilgi('A-1725', an + 21 * 60_000).gorevde, true);
    assert.equal(t.bilgi('A-1523', an + 21 * 60_000).gorevde, false, 'garaja çekildi');
    assert.equal(t.bilgi('A-1523', an + 21 * 60_000).hat, '97GE', 'hattı unutulmaz (sabah yine çıkabilir)');
    t.isle('97GE', [arac('A-1523')], an + 9 * 3_600_000);
    assert.equal(t.bilgi('A-1523', an + 9 * 3_600_000).gorevde, true);
  });

  it('başarısız sorgu (hata) görevden düşürmez; tarama zamanı bilinmeyen eski kayıtta karar yok', () => {
    const t = new Tarayici(null);
    const an = Date.UTC(2026, 9, 7, 21, 0, 0);
    t.isle('89C', [{ kapiNo: 'T1005', hat: '89C', guzergah: '89C_D_D0' }], an);
    // Hata yolu yalnız sonBakilan'ı ilerletiyor (basla()); sonTarama değişmez.
    t.hatDurumu.get('89C').sonBakilan = an + 10 * 60_000;
    assert.equal(t.bilgi('T1005', an + 11 * 60_000).gorevde, true);
    const u = new Tarayici(null);
    u.yukle({ atama: { T1001: { hat: '89C', an: Date.now() - 60_000 } }, hatDurumu: { '89C': { sonBakilan: Date.now(), aracSayisi: 4 } } });
    assert.equal(u.bilgi('T1001').gorevde, true);
  });
});

describe('görevde mi: bayat tarama', () => {
  it('hattın son taraması yarım saatten eskiyse karar verilmez (bilgisayar uykudan uyandı)', () => {
    const t = new Tarayici(null);
    const gece = Date.UTC(2026, 9, 7, 22, 56, 0); // 01:56 İstanbul
    t.isle('141M', [{ kapiNo: 'A-1719', hat: '141M', guzergah: '141M_D_D0' }], gece);
    t.isle('141M', [{ kapiNo: 'A-1724', hat: '141M', guzergah: '141M_D_D0' }], gece + 60_000);
    assert.equal(t.bilgi('A-1719', gece + 2 * 60_000).gorevde, false, 'taze tarama: görevde değil');
    assert.equal(t.bilgi('A-1719', gece + 39 * 3_600_000).gorevde, true, '39 saat sonra: bilinmiyor');
  });
});
