// Metrobüs yön adı ve satır birleştirme testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adinSonParcasi, metrobusKalkislariniTopla, metrobusSatirlariniBirlestir, metrobusYonu } from '../metrobus';

describe('metrobusYonu', () => {
  it('İETT kısaltmalarını araçtaki yazıya çevirir', () => {
    assert.equal(metrobusYonu('B.SONDURAK'), 'Beylikdüzü');
    assert.equal(metrobusYonu('AVCILAR MRK.ÜNV.KMP.'), 'Avcılar');
    assert.equal(metrobusYonu('ÜNİV.MAH.'), 'Avcılar');
    assert.equal(metrobusYonu('SÖĞÜTLÜÇEŞME'), 'Söğütlüçeşme');
    assert.equal(metrobusYonu('ZİNCİRLİKUYU'), 'Zincirlikuyu');
    assert.equal(metrobusYonu('CEVİZLİBAĞ'), 'Cevizlibağ');
    assert.equal(metrobusYonu('EDİRNEKAPI GARAJI'), 'Edirnekapı');
  });

  it('tabela boşsa yedeği kullanır, tanımadığını başlık yapar', () => {
    assert.equal(metrobusYonu('', null, adinSonParcasi('SÖĞÜTLÜÇEŞME - B.SONDURAK')), 'Beylikdüzü');
    assert.equal(metrobusYonu('BURHANİYE'), 'Burhaniye');
    assert.equal(metrobusYonu(null), '');
  });
});

describe('metrobusSatirlariniBirlestir', () => {
  const satir = (hatKodu: string, yon: string, anlar: number[], ek: object = {}) => ({
    anahtar: `${hatKodu}|p`,
    hatKodu,
    yon,
    guzergah: 'x',
    kalkislar: anlar.map((an) => ({ an, kimlik: `${hatKodu}-${an}` })),
    ...ek,
  });

  it('aynı yere giden metrobüsleri tek satırda toplar, saatleri sıralar', () => {
    const sonuc = metrobusSatirlariniBirlestir([
      satir('34BZ', 'Beylikdüzü', [120, 480], { yaklasan: 'bz' }),
      satir('34', 'Avcılar', [180]),
      satir('34G', 'Beylikdüzü', [240, 600], { yaklasan: 'g' }),
    ]);
    assert.equal(sonuc.length, 2);
    assert.deepEqual(sonuc[0].kodlar, ['34BZ', '34G']);
    assert.deepEqual(sonuc[0].kalkislar.map((k) => k.an), [120, 240, 480, 600]);
    assert.equal((sonuc[0] as { yaklasan?: string }).yaklasan, 'bz'); // ilk gelenin bilgisi
    assert.equal(sonuc[0].guzergah, '');
    assert.deepEqual(sonuc[1].kodlar, ['34']);
  });

  it('ilk kalkışı en erken olan satırın bilgisini taşır', () => {
    const sonuc = metrobusSatirlariniBirlestir([
      satir('34G', 'Beylikdüzü', [300], { yaklasan: 'g' }),
      satir('34BZ', 'Beylikdüzü', [60], { yaklasan: 'bz' }),
    ]);
    assert.equal((sonuc[0] as { yaklasan?: string }).yaklasan, 'bz');
    assert.equal(sonuc[0].kalkislar[0].an, 60);
  });

  it('otobüs satırlarına dokunmaz', () => {
    const sonuc = metrobusSatirlariniBirlestir([satir('89C', 'İkitelli', [60]), satir('89C', 'İkitelli', [90])]);
    assert.equal(sonuc.length, 2);
    assert.equal((sonuc[0] as { kodlar?: string[] }).kodlar, undefined);
  });
});

describe('metrobusKalkislariniTopla', () => {
  const k = (kod: string, yon: string) => ({ kod, yon });
  it('her yerden yalnız ilk metrobüs kalır, kodlar toplanır', () => {
    const sonuc = metrobusKalkislariniTopla(
      [k('34BZ', 'Beylikdüzü'), k('34', 'Avcılar'), k('34G', 'Beylikdüzü'), k('89C', 'İkitelli'), k('34AS', 'Avcılar')],
      (x) => x,
    );
    assert.deepEqual(
      sonuc.map((x) => [x.k.kod, x.kodlar]),
      [
        ['34BZ', ['34BZ', '34G']],
        ['34', ['34', '34AS']],
        ['89C', null],
      ],
    );
  });
});
