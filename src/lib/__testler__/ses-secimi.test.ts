// Türkçe ses seçimi ve okunacak metnin düzeltilmesi.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cinsiyetSecenekleri, sesAdi, sesCinsiyeti, sesSec, soylenecekMetin, type SesBilgisi } from '../ses-secimi.ts';

const ses = (identifier: string, name: string, language = 'tr-TR', quality = 'Default'): SesBilgisi => ({
  identifier,
  name,
  language,
  quality,
});

const yeldaKucuk = ses('com.apple.voice.compact.tr-TR.Yelda', 'Yelda');
const yeldaGelismis = ses('com.apple.voice.enhanced.tr-TR.Yelda', 'Yelda', 'tr-TR', 'Enhanced');
const cem = ses('com.apple.voice.compact.tr-TR.Cem', 'Cem');
const ingilizce = ses('com.apple.voice.compact.en-US.Samantha', 'Samantha', 'en-US');

describe('sesSec', () => {
  it('istenen cinsiyette en kaliteli Türkçe sesi seçer', () => {
    assert.deepEqual(sesSec([yeldaKucuk, yeldaGelismis, cem, ingilizce], 'kadin'), { ses: yeldaGelismis, uydu: true });
    assert.deepEqual(sesSec([yeldaKucuk, yeldaGelismis, cem, ingilizce], 'erkek'), { ses: cem, uydu: true });
  });

  it('o cinsiyette ses yoksa en iyi Türkçe sesi verir ama uymadığını söyler', () => {
    assert.deepEqual(sesSec([yeldaKucuk, yeldaGelismis, ingilizce], 'erkek'), { ses: yeldaGelismis, uydu: false });
  });

  it('Türkçe ses yoksa null', () => {
    assert.equal(sesSec([ingilizce], 'kadin'), null);
  });
});

describe('sesCinsiyeti ve sesAdi', () => {
  it('bilinen adlardan cinsiyet çıkarır, "female"i erkek sanmaz', () => {
    assert.equal(sesCinsiyeti(yeldaKucuk), 'kadin');
    assert.equal(sesCinsiyeti(cem), 'erkek');
    assert.equal(sesCinsiyeti(ses('tr-tr-x-tmc-local', 'tr-tr-x-female-local')), 'kadin');
    assert.equal(sesCinsiyeti(ses('tr-tr-x-efu-local', 'tr-tr-x-male-local')), 'erkek');
    assert.equal(sesCinsiyeti(ses('x', 'Bilinmeyen')), null);
  });

  it('kaliteyi ada ekler', () => {
    assert.equal(sesAdi(yeldaGelismis), 'Yelda (gelişmiş)');
    assert.equal(sesAdi(yeldaKucuk), 'Yelda (sıkıştırılmış)');
  });
});

describe('soylenecekMetin', () => {
  it('kısaltmaları açar', () => {
    assert.equal(soylenecekMetin('Şimdi sağa dön, Bağdat Cad.'), 'Şimdi sağa dön, Bağdat Caddesi');
    assert.equal(soylenecekMetin('Göztepe Mah. durağında in.'), 'Göztepe Mahallesi durağında in.');
    assert.equal(soylenecekMetin('100 metre sonra sola dön, Akasya Sk.'), '100 metre sonra sola dön, Akasya Sokak');
    assert.equal(soylenecekMetin('Boğaziçi Üniv. durağında in.'), 'Boğaziçi Üniversitesi durağında in.');
    assert.equal(soylenecekMetin('Şişli Etfal (Hast.)'), 'Şişli Etfal (Hastanesi)');
  });

  it('sözcük içindeki harflere dokunmaz', () => {
    assert.equal(soylenecekMetin('Mahmutbey, Cadde, Sokullu'), 'Mahmutbey, Cadde, Sokullu');
  });

  it('tire ve bölü işaretini duraklamaya çevirir', () => {
    assert.equal(soylenecekMetin('Veysel Karani – Akşemsettin / Fatih'), 'Veysel Karani, Akşemsettin, Fatih');
  });
});

describe('cinsiyetSecenekleri', () => {
  it('iPhone gibi yalnız Yelda varsa yalnız kadın', () => {
    assert.deepEqual(cinsiyetSecenekleri([yeldaKucuk, yeldaGelismis, ingilizce]), ['kadin']);
  });
  it('iki cinsiyet de varsa ikisi', () => {
    assert.deepEqual(cinsiyetSecenekleri([cem, yeldaKucuk]), ['kadin', 'erkek']);
  });
  it('İngilizce erkek ses Türkçe seçeneği saymaz', () => {
    assert.deepEqual(cinsiyetSecenekleri([yeldaKucuk, ses('com.apple.eloquence.en-US.Reed', 'Reed', 'en-US')]), ['kadin']);
  });
});
