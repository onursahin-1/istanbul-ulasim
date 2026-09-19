// İlgi noktası (hastane, okul, eczane, benzinlik, kırtasiye…) araması.
//
// Veri OpenStreetMap'ten çıkarıldı ve uygulamanın içinde SQLite dosyası olarak taşınıyor:
// arama tamamen telefonda yapılır, internete ya da rota sunucusuna ihtiyaç duymaz.
// Veritabanı veri/cikar.py ve veri/kur.py ile üretilir.

import { importDatabaseFromAssetAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { mesafeMetre, type Nokta } from '@/lib/cografya';

// Veri her yenilendiğinde bu numara artar. Dosya adı numarayı taşıdığı için telefondaki
// eski kopya kullanılmaya devam etmez; yeni sürüm ilk açılışta varlıktan kopyalanır.
const SURUM = 2;
const DOSYA = `istanbul-poi-${SURUM}.db`;

export type PoiSonuc = {
  id: number;
  ad: string;
  tur: string;
  turAdi: string;
  lat: number;
  lon: number;
  semt: string;
  mesafe: number;
};

export type PoiTuru = { anahtar: string; ad: string; duz: string };

/**
 * Türkçe arama için sade biçim: 'Şişli Etfal' → 'sisli etfal'.
 * Veritabanındaki `duz` sütunu da aynı kuralla üretildi, iki taraf birebir eşleşir.
 */
const AKSAN: Record<string, string> = {
  ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c',
  â: 'a', î: 'i', û: 'u', ê: 'e', ô: 'o', é: 'e', ñ: 'n',
};

export function sadelestir(metin: string): string {
  const kucuk = metin.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
  let cikan = '';
  for (const harf of kucuk) {
    const d = AKSAN[harf] ?? harf;
    cikan += /[0-9a-z]/.test(d) ? d : ' ';
  }
  return cikan.split(/\s+/).filter(Boolean).join(' ');
}

/** 'eczane' → 'eczanf': önek aralığının üst sınırı (sozcuk >= x AND sozcuk < y). */
function onekSonu(onek: string): string {
  return onek.slice(0, -1) + String.fromCharCode(onek.charCodeAt(onek.length - 1) + 1);
}

let baglanti: Promise<SQLiteDatabase> | null = null;

/**
 * Veritabanını açar. İlk çağrıda uygulamanın içindeki dosya telefonun SQLite klasörüne
 * kopyalanır (varsa kopyalanmaz), sonraki çağrılar aynı bağlantıyı kullanır.
 */
async function veritabani(): Promise<SQLiteDatabase> {
  if (!baglanti) {
    baglanti = (async () => {
      await importDatabaseFromAssetAsync(DOSYA, {
        assetId: require('../../assets/veri/istanbul-poi.db'),
      });
      return openDatabaseAsync(DOSYA);
    })().catch((hata) => {
      baglanti = null;
      throw hata;
    });
  }
  return baglanti;
}

/** Arama ekranı açılır açılmaz veritabanını hazırlar; ilk aramada bekleme olmasın. */
export function poiHazirla(): void {
  veritabani().catch(() => {});
}

let turlerOnbellek: PoiTuru[] | null = null;

/** Veritabanındaki kategoriler ("Eczane", "Hastane", "Benzin istasyonu"…). */
export async function poiTurleri(): Promise<PoiTuru[]> {
  if (turlerOnbellek) return turlerOnbellek;
  const db = await veritabani();
  turlerOnbellek = await db.getAllAsync<PoiTuru>('SELECT anahtar, ad, duz FROM tur ORDER BY agirlik DESC');
  return turlerOnbellek;
}

type HamSatir = Omit<PoiSonuc, 'mesafe'> & { agirlik: number };

function siralaVeKes(satirlar: HamSatir[], merkez: Nokta, aranan: string, sinir: number): PoiSonuc[] {
  return satirlar
    .map((r) => {
      const mesafe = mesafeMetre(merkez, { latitude: r.lat, longitude: r.lon });
      // Puan: kategorinin önemi + adın baştan eşleşmesi − uzaklık cezası.
      // Uzaklık ağır basar; yoksa 90 km ötedeki Şile'deki bir yer listenin başına geçiyor.
      const bastanEslesme = aranan && r.ad && sadelestir(r.ad).startsWith(aranan) ? 25 : 0;
      const km = Math.min(mesafe / 1000, 40);
      return { ...r, mesafe, puan: r.agirlik + bastanEslesme - km * 2.5 };
    })
    .sort((a, b) => b.puan - a.puan)
    .slice(0, sinir)
    .map(({ puan, agirlik, ...geri }) => geri);
}

const SUTUNLAR = 'p.id, p.ad, p.tur, t.ad AS turAdi, p.lat, p.lon, p.semt, p.agirlik';

/** Ada göre arama: "şişli etfal", "boğaziçi üniv". */
export async function poiAra(metin: string, merkez: Nokta, sinir = 20): Promise<PoiSonuc[]> {
  const aranan = sadelestir(metin);
  const sozcukler = aranan.split(' ').filter((s) => s.length >= 2).slice(0, 4);
  if (!sozcukler.length) return [];
  const db = await veritabani();

  const parcalar = sozcukler.map(() => 'SELECT poi FROM sozcuk WHERE sozcuk >= ? AND sozcuk < ?');
  const degerler: string[] = [];
  for (const s of sozcukler) degerler.push(s, onekSonu(s));

  const satirlar = await db.getAllAsync<HamSatir>(
    `SELECT ${SUTUNLAR} FROM poi p JOIN tur t ON t.anahtar = p.tur
     WHERE p.id IN (${parcalar.join(' INTERSECT ')}) LIMIT 400`,
    degerler,
  );
  return siralaVeKes(satirlar, merkez, aranan, sinir);
}

/** Kategoriye göre arama: "yakınımdaki eczaneler". Önce 12 km, sonuç azsa 45 km taranır. */
export async function poiTureGore(tur: string, merkez: Nokta, sinir = 20): Promise<PoiSonuc[]> {
  const db = await veritabani();
  for (const yaricap of [0.11, 0.45]) {
    const satirlar = await db.getAllAsync<HamSatir>(
      `SELECT ${SUTUNLAR} FROM poi p JOIN tur t ON t.anahtar = p.tur
       WHERE p.tur = ? AND p.lat BETWEEN ? AND ? AND p.lon BETWEEN ? AND ?
       LIMIT 600`,
      [tur, merkez.latitude - yaricap, merkez.latitude + yaricap, merkez.longitude - yaricap * 1.35, merkez.longitude + yaricap * 1.35],
    );
    const sonuc = siralaVeKes(satirlar, merkez, '', sinir);
    if (sonuc.length >= Math.min(sinir, 8) || yaricap > 0.4) return sonuc;
  }
  return [];
}

/**
 * Yazılan metin bir kategori adıysa onu verir: "eczane" → eczane kategorisi.
 * Böylece kullanıcı "eczane" yazınca tek tek eczane adları değil, yakındaki eczaneler çıkar.
 */
export async function kategoriEslesmesi(metin: string): Promise<PoiTuru | null> {
  const aranan = sadelestir(metin);
  if (aranan.length < 3) return null;
  const turler = await poiTurleri();
  // Yalnızca tam eşleşme: "eczane" kategoriyi açar, "ecz" isim araması olarak kalır.
  // Önek kabul edilseydi "par" yazan biri parkların listesine düşerdi.
  return (
    turler.find((t) => t.duz === aranan) ??
    turler.find((t) => t.duz.split(' ').includes(aranan)) ??
    null
  );
}

// Kategorilere göre Ionicons simgeleri. Listede yazmayan türler için genel bir işaret kullanılır.
const SIMGELER: Record<string, string> = {
  hastane: 'medkit', klinik: 'medkit-outline', doktor: 'medkit-outline', dis: 'medkit-outline',
  eczane: 'medical', veteriner: 'paw', saglik: 'medkit-outline', laboratuvar: 'flask',
  okul: 'school', anaokulu: 'school-outline', yuksekokul: 'school', universite: 'school',
  kutuphane: 'library', kultur: 'library-outline',
  banka: 'card', atm: 'card-outline',
  benzinlik: 'car-sport', sarj: 'flash', otopark: 'car', tamirci: 'construct',
  polis: 'shield', itfaiye: 'flame', postane: 'mail', belediye: 'business', adliye: 'business', resmi: 'business',
  ibadet: 'moon',
  restoran: 'restaurant', kafe: 'cafe', bufe: 'fast-food', bar: 'wine', firin: 'pizza',
  market: 'cart', bakkal: 'cart-outline', avm: 'storefront', magaza: 'storefront', dukkan: 'pricetag',
  kirtasiye: 'pencil', kitapci: 'book', giyim: 'shirt', kuafor: 'cut', hirdavat: 'hammer',
  mobilya: 'bed', elektronik: 'hardware-chip',
  sinema: 'film', tiyatro: 'musical-notes', muze: 'color-palette', gezi: 'camera', manzara: 'eye',
  anit: 'flag', kale: 'flag', harabe: 'flag',
  park: 'leaf', bahce: 'leaf', stadyum: 'football', spor: 'basketball', spor_salonu: 'barbell',
  otel: 'bed', hostel: 'bed-outline',
  otogar: 'bus', iskele: 'boat', marina: 'boat-outline', havalimani: 'airplane', pazar: 'basket',
  sehir: 'map', ilce: 'map', semt: 'location', mahalle: 'location', koy: 'location',
};

/** Kategoriye karşılık gelen Ionicons adı. */
export function poiSimgesi(tur: string): string {
  return SIMGELER[tur] ?? 'pin';
}
