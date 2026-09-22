// Hat etiketi ve renk türevlerinin testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aracAdi, aracModu, hatEtiketi } from '../hat-adi';
import { karistir, karsitlik, okunurYap, parlaklik, renkCoz, renkYaz } from '../renk';

describe('hatEtiketi', () => {
  it('kısa kodu olduğu gibi yazar', () => {
    assert.deepEqual(hatEtiketi('M4', 'SUBWAY'), { rozet: 'M4', ayrinti: '' });
    assert.deepEqual(hatEtiketi('34G', 'BUS'), { rozet: '34G', ayrinti: '' });
    assert.deepEqual(hatEtiketi('500T', 'BUS'), { rozet: '500T', ayrinti: '' });
  });

  it('Marmaray şubelerini tek ada indirir', () => {
    for (const ad of ['Marmaray', 'Marmaray1', 'Marmaray2', 'MARMARAY1']) {
      assert.equal(hatEtiketi(ad, 'RAIL').rozet, 'Marmaray', `${ad} → Marmaray olmalı`);
    }
  });

  it('uzun minibüs adını rozetten alt satıra indirir', () => {
    const uzun = 'İKİTELLİ ORG.S-MEHMET AKİF MH.-GÖZTEPE MH.-OTOGAR';
    const e = hatEtiketi(uzun, 'BUS', 'Minibus');
    assert.equal(e.rozet, 'Minibüs');
    assert.match(e.ayrinti, /İkitelli/);
    assert.ok(e.ayrinti.length > 20, 'güzergâh metni korunmalı');
  });

  it('taksi dolmuşu minibüsten ayırır', () => {
    const uzun = 'ÜSKÜDAR-ÜMRANİYE-TAVUKÇUYOLU-ALEMDAĞ';
    assert.equal(hatEtiketi(uzun, 'BUS', 'Taksi Dolmus').rozet, 'Dolmuş');
    assert.equal(hatEtiketi(uzun, 'BUS', 'Minibus').rozet, 'Minibüs');
  });

  it('işletmeci bilinmiyorsa araç tipine düşer', () => {
    assert.equal(hatEtiketi('KBTŞ-EMN-KDK-ADA', 'FERRY').rozet, 'Vapur');
  });

  it('tam sınırdaki kodu rozette bırakır', () => {
    assert.equal(hatEtiketi('12345678', 'BUS').rozet, '12345678');
    assert.notEqual(hatEtiketi('123456789', 'BUS').rozet, '123456789');
  });

  it('boş kısa adda araç tipini yazar', () => {
    assert.equal(hatEtiketi('', 'TRAM').rozet, 'Tramvay');
    assert.equal(hatEtiketi(null, null).rozet, '?');
  });

  it('kodu büyük harfe çevirirken Türkçe kuralını uygular', () => {
    assert.equal(hatEtiketi('mi1', 'BUS').rozet, 'Mİ1');
  });
});

describe('aracAdi', () => {
  it('bilinen tipleri çevirir', () => {
    assert.equal(aracAdi('SUBWAY'), 'Metro');
    assert.equal(aracAdi('ferry'), 'Vapur');
  });
  it('bilinmeyen tipte boş döner', () => {
    assert.equal(aracAdi('UZAY_MEKIGI'), '');
    assert.equal(aracAdi(null), '');
  });
});

describe('aracModu', () => {
  it('GTFS araç tipi kodunu rota motorunun adına çevirir', () => {
    assert.equal(aracModu('1'), 'SUBWAY');
    assert.equal(aracModu('2'), 'RAIL');
    assert.equal(aracModu('4'), 'FERRY');
    assert.equal(aracModu('7'), 'FUNICULAR');
  });

  it('nostaljik tramvayı da tramvay sayar', () => {
    assert.equal(aracModu('5'), aracModu('0'));
  });

  it('sayı da kabul eder', () => {
    assert.equal(aracModu(1), 'SUBWAY');
  });

  it('bilinmeyen kodda boş döner', () => {
    assert.equal(aracModu('99'), '');
    assert.equal(aracModu(null), '');
    assert.equal(aracModu(''), '');
  });
});

describe('renk yardımcıları', () => {
  it('renk kodunu çözer ve geri yazar', () => {
    assert.deepEqual(renkCoz('#de1c72'), { k: 222, y: 28, m: 114 });
    assert.deepEqual(renkCoz('de1c72'), { k: 222, y: 28, m: 114 });
    assert.equal(renkYaz({ k: 222, y: 28, m: 114 }), '#de1c72');
  });

  it('geçersiz kodda null döner', () => {
    assert.equal(renkCoz('kırmızı'), null);
    assert.equal(renkCoz('#fff'), null);
    assert.equal(renkCoz(null), null);
  });

  it('karıştırma uçlarda saf rengi verir', () => {
    assert.equal(karistir('#000000', '#ffffff', 0), '#000000');
    assert.equal(karistir('#000000', '#ffffff', 1), '#ffffff');
    assert.equal(karistir('#000000', '#ffffff', 0.5), '#808080');
  });

  it('karıştırma oranını sınırların içinde tutar', () => {
    assert.equal(karistir('#000000', '#ffffff', -3), '#000000');
    assert.equal(karistir('#000000', '#ffffff', 9), '#ffffff');
  });

  it('parlaklığı doğru sıralar', () => {
    assert.ok(parlaklik('#ffffff') > parlaklik('#808080'));
    assert.ok(parlaklik('#808080') > parlaklik('#000000'));
  });

  it('siyah–beyaz karşıtlığı 21 çıkar', () => {
    assert.equal(Math.round(karsitlik('#000000', '#ffffff')), 21);
    assert.equal(Math.round(karsitlik('#777777', '#777777')), 1);
  });

  it('zaten okunur olan rengi değiştirmez', () => {
    assert.equal(okunurYap('#000000', '#ffffff'), '#000000');
  });

  it('okunmayan rengi eşiğe ulaşana kadar iter', () => {
    // Açık zeminde sarı okunmuyor; koyulaştırılmalı.
    const zemin = '#fffbe6';
    const sonuc = okunurYap('#ffd300', zemin);
    assert.notEqual(sonuc, '#ffd300');
    assert.ok(karsitlik(sonuc, zemin) >= 4.5, 'WCAG AA eşiğini geçmeli');
  });

  it('koyu zeminde rengi açarak okunur yapar', () => {
    const zemin = '#101820';
    const sonuc = okunurYap('#00296b', zemin);
    assert.ok(karsitlik(sonuc, zemin) >= 4.5);
    assert.ok(parlaklik(sonuc) > parlaklik('#00296b'), 'koyu zeminde yazı açılmalı');
  });

  it('bütün hat renkleri türetilen zeminde okunur çıkıyor', () => {
    const hatRenkleri = ['#e2261c', '#019a44', '#05a8e2', '#e72177', '#693064', '#cbaa77',
      '#f39ec0', '#447abe', '#ffd300', '#ab548f', '#00529b', '#0075c9', '#00a3a1', '#a6093d'];
    for (const renk of hatRenkleri) {
      const zemin = karistir(renk, '#ffffff', 0.86);
      const yazi = okunurYap(karistir(renk, '#000000', 0.2), zemin);
      assert.ok(karsitlik(yazi, zemin) >= 4.5, `${renk} için karşıtlık yetersiz`);
    }
  });
});
