// Haritada seçilen noktanın adres satırlarının testleri.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { adresYaz } from '../adres.ts';

describe('adresYaz', () => {
  it('sokak ve kapı numarasını, semt ve ilçeyi yazar', () => {
    assert.deepEqual(
      adresYaz({ street: '1543. Sk.', streetNumber: '21', district: 'Yenimahalle', subregion: 'Bağcılar', city: 'İstanbul' }),
      { baslik: '1543. Sk. No: 21', alt: 'Yenimahalle, Bağcılar' },
    );
  });

  it('kapı numarası yoksa yalnız sokak', () => {
    assert.equal(adresYaz({ street: 'Bağdat Caddesi', district: 'Suadiye', subregion: 'Kadıköy' })?.baslik, 'Bağdat Caddesi');
  });

  it('sokak yoksa yerin adı; ilçe yoksa şehir', () => {
    assert.deepEqual(adresYaz({ name: 'Maçka Parkı', district: 'Teşvikiye', city: 'İstanbul' }), {
      baslik: 'Maçka Parkı',
      alt: 'Teşvikiye, İstanbul',
    });
  });

  it('aynı adı iki kez yazmaz', () => {
    assert.equal(adresYaz({ street: 'Moda Cd.', district: 'Kadıköy', subregion: 'Kadıköy' })?.alt, 'Kadıköy');
  });

  it('yalnız semt bilinirse başlık semt olur', () => {
    assert.deepEqual(adresYaz({ district: 'Yenimahalle', subregion: 'Bağcılar' }), { baslik: 'Yenimahalle, Bağcılar', alt: '' });
  });

  it('boş sonuçta null', () => {
    assert.equal(adresYaz(null), null);
    assert.equal(adresYaz({ name: '21', streetNumber: '21' }), null);
  });
});
