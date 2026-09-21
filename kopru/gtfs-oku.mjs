// GTFS zip dosyasını bağımlılıksız okur.
//
// Neden kendi okuyucumuz: köprünün tek bağımlılığı GTFS-RT protobuf kütüphanesi olsun
// istiyorum. Zip biçiminin ihtiyacımız olan kısmı küçük — merkezi dizini okuyup
// gereken üç dosyayı açmak yeterli.

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD = 0x06054b50; // merkezi dizin sonu imzası
const MERKEZ = 0x02014b50; // merkezi dizin kaydı
const YEREL = 0x04034b50; // yerel dosya başlığı

/** Zip içindeki dosyaları {ad: Buffer} olarak açar. İstenen adlar verilirse yalnızca onları. */
export function zipAc(yol, istenenler) {
  const d = readFileSync(yol);

  // EOCD sondan aranır: yorum alanı olabileceği için son 64 KB taranır.
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 65_557); i--) {
    if (d.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${yol}: zip sonu bulunamadı`);

  const kayitSayisi = d.readUInt16LE(eocd + 10);
  let p = d.readUInt32LE(eocd + 16);

  const sonuc = {};
  for (let i = 0; i < kayitSayisi; i++) {
    if (d.readUInt32LE(p) !== MERKEZ) throw new Error(`${yol}: merkezi dizin bozuk`);
    const yontem = d.readUInt16LE(p + 10);
    const sikismis = d.readUInt32LE(p + 20);
    const adUzunluk = d.readUInt16LE(p + 28);
    const ekUzunluk = d.readUInt16LE(p + 30);
    const yorumUzunluk = d.readUInt16LE(p + 32);
    const yerelKonum = d.readUInt32LE(p + 42);
    const ad = d.toString('utf8', p + 46, p + 46 + adUzunluk);
    p += 46 + adUzunluk + ekUzunluk + yorumUzunluk;

    if (istenenler && !istenenler.includes(ad)) continue;
    if (d.readUInt32LE(yerelKonum) !== YEREL) throw new Error(`${ad}: yerel başlık bozuk`);
    const yerelAd = d.readUInt16LE(yerelKonum + 26);
    const yerelEk = d.readUInt16LE(yerelKonum + 28);
    const bas = yerelKonum + 30 + yerelAd + yerelEk;
    const ham = d.subarray(bas, bas + sikismis);
    sonuc[ad] = yontem === 8 ? inflateRawSync(ham) : Buffer.from(ham);
  }
  return sonuc;
}

/** Tırnaklı alanları da doğru ayıran küçük bir CSV okuyucu. */
export function csvAyristir(metin) {
  const satirlar = [];
  let alan = '';
  let satir = [];
  let tirnakta = false;
  for (let i = 0; i < metin.length; i++) {
    const h = metin[i];
    if (tirnakta) {
      if (h === '"') {
        if (metin[i + 1] === '"') {
          alan += '"';
          i++;
        } else tirnakta = false;
      } else alan += h;
      continue;
    }
    if (h === '"') tirnakta = true;
    else if (h === ',') {
      satir.push(alan);
      alan = '';
    } else if (h === '\n') {
      satir.push(alan.replace(/\r$/, ''));
      satirlar.push(satir);
      satir = [];
      alan = '';
    } else alan += h;
  }
  if (alan || satir.length) {
    satir.push(alan.replace(/\r$/, ''));
    satirlar.push(satir);
  }
  if (!satirlar.length) return [];
  const basliklar = satirlar[0].map((b) => b.replace(/^﻿/, '').trim());
  return satirlar.slice(1).filter((s) => s.length > 1).map((s) => Object.fromEntries(basliklar.map((b, i) => [b, s[i] ?? ''])));
}

/**
 * Köprünün ihtiyaç duyduğu dizinleri kurar.
 *
 * İETT'nin canlı verisindeki `guzergahkodu` bizim `route_code` alanımızla birebir
 * aynı (ölçüldü: %100). `yakinDurakKodu` ise `stop_code` ile eşleşiyor.
 */
export function gtfsDizini(zipYolu) {
  const dosyalar = zipAc(zipYolu, ['routes.txt', 'stops.txt', 'trips.txt']);
  for (const ad of ['routes.txt', 'stops.txt']) {
    if (!dosyalar[ad]) throw new Error(`${zipYolu}: ${ad} yok`);
  }

  const rotalar = csvAyristir(dosyalar['routes.txt'].toString('utf8'));
  const duraklar = csvAyristir(dosyalar['stops.txt'].toString('utf8'));
  const seferler = dosyalar['trips.txt'] ? csvAyristir(dosyalar['trips.txt'].toString('utf8')) : [];

  const guzergahtanRota = new Map(); // "34G_G_D0" → route_id
  const rotaYonu = new Map(); // route_id → direction_id (güzergâh kodundaki D/G'den değil, seferlerden)
  for (const r of rotalar) {
    const kod = (r.route_code ?? '').trim().toUpperCase();
    if (kod) guzergahtanRota.set(kod, r.route_id);
  }

  const kodaGoreRota = new Map(); // "34G" → [route_id]
  for (const r of rotalar) {
    const kisa = (r.route_short_name ?? '').trim().toUpperCase();
    if (!kisa) continue;
    if (!kodaGoreRota.has(kisa)) kodaGoreRota.set(kisa, []);
    kodaGoreRota.get(kisa).push(r.route_id);
  }

  const durakKodundanId = new Map(); // "100022" → stop_id
  for (const s of duraklar) {
    const kod = (s.stop_code ?? '').trim();
    if (kod) durakKodundanId.set(kod, s.stop_id);
  }

  // Bir rotanın yönlerini seferlerden öğren: canlı araç yön bilgisi veriyor, ona bağlayacağız.
  const rotaSeferleri = new Map(); // route_id → { direction_id → [trip_id] }
  for (const t of seferler) {
    if (!rotaSeferleri.has(t.route_id)) rotaSeferleri.set(t.route_id, new Map());
    const yonler = rotaSeferleri.get(t.route_id);
    const yon = t.direction_id ?? '0';
    if (!yonler.has(yon)) yonler.set(yon, []);
    yonler.get(yon).push(t.trip_id);
  }

  return {
    guzergahtanRota,
    kodaGoreRota,
    durakKodundanId,
    rotaSeferleri,
    rotaYonu,
    sayilar: {
      rota: rotalar.length,
      guzergah: guzergahtanRota.size,
      durak: durakKodundanId.size,
      sefer: seferler.length,
    },
  };
}
