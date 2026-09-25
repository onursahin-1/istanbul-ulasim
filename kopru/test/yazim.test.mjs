import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dusenHarfler, hepsiBuyukMu, katla, metniDuzelt, sozlukKur, uyumlaCoz } from '../yazim.mjs';

const SOZLUK = sozlukKur([
  'KADIKÖY',
  'GÖZTEPE MAHALLESİ',
  'BAĞDAT CADDESİ',
  'YENİ MAHALLE',
  'ALTUNİZADE',
  'İKİTELLİ GARAJI',
  'TAKSİM',
  'ÜSKÜDAR',
  'BEŞİKTAŞ',
  'MECİDİYEKÖY',
  'SİRKECİ',
  'ÇAMLICA YOLU',
]);
const d = (m) => metniDuzelt(m, SOZLUK);

describe('metniDuzelt', () => {
  it('büyük harfli, harfleri düşmüş metni cümle düzenine çevirir', () => {
    assert.equal(
      d('HATTIMIZ YOL CALISMASI NEDENIYLE KADIKOYDEN GECICI OLARAK UGRAMAYACAKTIR.'),
      "Hattımız yol çalışması nedeniyle Kadıköy'den geçici olarak uğramayacaktır.",
    );
  });

  it('özel ad + yer türü büyük harfle, her cümle büyük harfle başlar', () => {
    assert.equal(
      d('BAGDAT CADDESI UZERINDE ASFALT CALISMASI VAR. SEFERLERIMIZ ALTUNIZADE ISTIKAMETINE YONLENDIRILMISTIR.'),
      'Bağdat Caddesi üzerinde asfalt çalışması var. Seferlerimiz Altunizade istikametine yönlendirilmiştir.',
    );
  });

  it('kısaltmalar ve yol adları büyük kalır', () => {
    assert.equal(
      d('E-5 VE TEM UZERINDE YOGUNLUK NEDENIYLE IETT SEFERLERINDE GECIKME YASANMAKTADIR'),
      'E-5 ve TEM üzerinde yoğunluk nedeniyle İETT seferlerinde gecikme yaşanmaktadır',
    );
  });

  it('yumuşayan kökler ve çok sözcüklü durak adları', () => {
    assert.equal(
      d('YENI MAHALLE DURAGINA ARAC UGRAMAYACAKTIR. DEGISIKLIK ICIN ANLAYISINIZA TESEKKUR EDERIZ.'),
      'Yeni Mahalle durağına araç uğramayacaktır. Değişiklik için anlayışınıza teşekkür ederiz.',
    );
  });

  it("kesmeli ekler önceki sözcüğe uyar: MECIDIYEKOY'DEN BESIKTAS'A", () => {
    assert.equal(d("MECIDIYEKOY'DEN BESIKTAS'A GIDEN SEFERLER"), "Mecidiyeköy'den Beşiktaş'a giden seferler");
  });

  it('Türkçe harfleri yerinde olan büyük harfli metinde I gerçekten ı', () => {
    assert.equal(d('SİRKECİ İSTASYONU KAPALI OLDUĞUNDAN'), 'Sirkeci İstasyonu kapalı olduğundan');
  });

  it('"TAKSİM" taksi + m sanılmaz', () => {
    assert.equal(d('IKITELLI GARAJI-TAKSIM HATTI'), 'İkitelli Garajı-Taksim hattı');
  });

  it('düzgün yazılmış metne dokunmaz', () => {
    assert.equal(d('Yol çalışması nedeniyle  sefer iptal.'), 'Yol çalışması nedeniyle sefer iptal.');
  });
});

describe('yardımcılar', () => {
  it('katla Türkçe harfleri ASCII yapar', () => {
    assert.equal(katla('Güzergâh İŞÇİ çığ'), 'GUZERGAH ISCI CIG');
  });

  it('dusenHarfler metinde hiç geçmeyen Türkçe harflerin ASCII karşılığı', () => {
    assert.deepEqual([...dusenHarfler('ÜSKÜDAR SEFERİ')].sort(), ['C', 'G', 'O', 'S']);
  });

  it('uyumlaCoz eki kökün son ünlüsüne göre çözer', () => {
    const hepsi = new Set(['I', 'S', 'G', 'U', 'O', 'C']);
    assert.equal(uyumlaCoz('LERI', 'sefer', hepsi), 'leri');
    assert.equal(uyumlaCoz('MISTIR', 'edil', hepsi), 'miştir');
    assert.equal(uyumlaCoz('DUGUNDAN', 'ol', hepsi), 'duğundan');
    assert.equal(uyumlaCoz('CI', 'yolcu', hepsi), 'cı');
    assert.equal(uyumlaCoz('CI', 'bilet', hepsi), 'çi'); // sert ünsüzden sonra ç
  });

  it('hepsiBuyukMu', () => {
    assert.equal(hepsiBuyukMu('YOL CALISMASI'), true);
    assert.equal(hepsiBuyukMu('Yol çalışması'), false);
    assert.equal(hepsiBuyukMu('M1A'), false);
  });
});

describe('noktalı kısaltmalar', () => {
  it('"Cad." cümle bitirmez, ay adı günle büyük harf', () => {
    const s = sozlukKur(['ESKİ TOPKAPI', 'MİLLET', 'VATAN CADDESİ']);
    assert.equal(
      metniDuzelt('ESKI TOPKAPI CAD. ILE MILLET CAD. KESISIMINDE 29 EKIM ONCESI CALISMA VAR.', s),
      'Eski Topkapı Cad. ile Millet Cad. kesişiminde 29 Ekim öncesi çalışma var.',
    );
  });
});
