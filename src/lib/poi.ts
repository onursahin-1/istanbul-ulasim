// İlgi noktası (hastane, okul, eczane, benzinlik, kırtasiye…) ve adres araması.
//
// Adresler de aynı veritabanında: sokak ve caddeler (mahalle mahalle), kapı numaraları,
// adı olan bina, apartman ve siteler (veri/adres-cikar.py). Her kaydın altında içinde
// bulunduğu mahalle ve ilçe yazıyor ("Caferağa Mah., Kadıköy").
//
// Veri OpenStreetMap'ten çıkarıldı ve uygulamanın içinde SQLite dosyası olarak taşınıyor:
// arama tamamen telefonda yapılır, internete ya da rota sunucusuna ihtiyaç duymaz.
// Veritabanı veri/cikar.py ve veri/kur.py ile üretilir.

import { importDatabaseFromAssetAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { mesafeMetre, type Nokta } from '@/lib/cografya';

import { ADRES_TURLERI, onekSonu, puanla, sadelestir, sorguyuAyristir, YER_ONEKI_EN_AZ, type Sorgu } from './adres-sorgu';

export { ADRES_TURLERI, sadelestir, sorguyuAyristir } from './adres-sorgu';

// Veri her yenilendiğinde bu numara artar. Dosya adı numarayı taşıdığı için telefondaki
// eski kopya kullanılmaya devam etmez; yeni sürüm ilk açılışta varlıktan kopyalanır.
const SURUM = 3;
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

function siralaVeKes(satirlar: HamSatir[], merkez: Nokta, aranan: string, sinir: number, sorgu?: Sorgu): PoiSonuc[] {
  return satirlar
    .map((r) => {
      const mesafe = mesafeMetre(merkez, { latitude: r.lat, longitude: r.lon });
      return { ...r, mesafe, puan: puanla(r, mesafe / 1000, aranan, sorgu) };
    })
    .sort((a, b) => b.puan - a.puan)
    .slice(0, sinir)
    .map(({ puan, agirlik, ...geri }) => geri);
}

const SUTUNLAR = 'p.id, p.ad, p.tur, t.ad AS turAdi, p.lat, p.lon, y.ad AS semt, p.agirlik';
const KAYNAK = 'poi p JOIN tur t ON t.anahtar = p.tur LEFT JOIN yer y ON y.id = p.yer';
/** Bir sözcüğün tuttuğu kayıtlar: adında ya da mahalle/ilçesinde o sözcükle başlayan. */
const SOZCUK_KUMESI =
  '(SELECT poi FROM sozcuk WHERE sozcuk >= ? AND sozcuk < ? UNION SELECT id FROM poi WHERE yer IN (SELECT yer FROM yersozcuk WHERE sozcuk >= ? AND sozcuk < ?))';

/** Sözcüklerin hepsini (adında ya da yerinde) taşıyan kayıtlar; yakın ve önemli olanlar önce. */
async function sozcuklerleAra(db: SQLiteDatabase, sozcukler: string[], merkez: Nokta): Promise<HamSatir[]> {
  if (!sozcukler.length) return [];
  const degerler: (string | number)[] = [];
  for (const s of sozcukler) degerler.push(s, onekSonu(s), s, s.length >= YER_ONEKI_EN_AZ ? onekSonu(s) : `${s}\u0001`);
  degerler.push(merkez.latitude, merkez.longitude);
  const satirlar = await db.getAllAsync<HamSatir>(
    `SELECT ${SUTUNLAR} FROM ${KAYNAK}
     WHERE p.id IN (${sozcukler.map(() => `SELECT * FROM ${SOZCUK_KUMESI}`).join(' INTERSECT ')})
     ORDER BY p.agirlik - (ABS(p.lat - ?) * 111 + ABS(p.lon - ?) * 84) * 2.5 DESC
     LIMIT 800`,
    degerler,
  );
  // Yalnız mahalle ya da ilçe adıyla tutan kayıt sonuç değil: "kadıköy" yazınca Kadıköy'deki
  // her dükkân gelmesin. En az bir sözcük adın içinde olmalı.
  return satirlar.filter((r) => {
    const ad = sadelestir(r.ad).split(' ');
    return sozcukler.some((s) => ad.some((w) => w.startsWith(s)));
  });
}

/**
 * Ada ve adrese göre arama: "şişli etfal", "boğaziçi üniv", "bağdat cad 312", "1543 sk bağcılar".
 * Sondaki sayı kapı numarası olabileceği için ("bağdat 312") o sayı olmadan da aranır: cadde
 * de, adındaki başka şeyler de sonuçta kalsın.
 */
export async function poiAra(metin: string, merkez: Nokta, sinir = 20): Promise<PoiSonuc[]> {
  const sorgu = sorguyuAyristir(metin);
  if (!sorgu.sozcukler.length) return [];
  const db = await veritabani();
  const tam = await sozcuklerleAra(db, sorgu.sozcukler, merkez);
  const sayisiz = sorgu.kapiNo ? await sozcuklerleAra(db, sorgu.sozcukler.slice(0, -1), merkez) : [];
  const gorulen = new Set<number>();
  const hepsi = [...tam, ...sayisiz].filter((r) => (gorulen.has(r.id) ? false : (gorulen.add(r.id), true)));
  return siralaVeKes(hepsi, merkez, sorgu.sozcukler.join(' '), sinir, sorgu);
}

/** Kategoriye göre arama: "yakınımdaki eczaneler". Önce 12 km, sonuç azsa 45 km taranır. */
export async function poiTureGore(tur: string, merkez: Nokta, sinir = 20): Promise<PoiSonuc[]> {
  const db = await veritabani();
  for (const yaricap of [0.11, 0.45]) {
    const satirlar = await db.getAllAsync<HamSatir>(
      `SELECT ${SUTUNLAR} FROM ${KAYNAK}
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
  const turler = (await poiTurleri()).filter((t) => !ADRES_TURLERI.has(t.anahtar));
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
  adres: 'home', sokak: 'trail-sign', bina: 'business-outline', apartman: 'home-outline', ishani: 'business',
  site: 'grid-outline',
};

/** Kategoriye karşılık gelen Ionicons adı. */
export function poiSimgesi(tur: string): string {
  return SIMGELER[tur] ?? 'pin';
}

/** Veritabanındaki kayıt sayısı ve kaynak bilgisi (Ayarlar ekranında gösterilir). */
export async function poiBilgisi(): Promise<{ nokta: number; kaynak: string } | null> {
  try {
    const db = await veritabani();
    const satirlar = await db.getAllAsync<{ anahtar: string; deger: string }>('SELECT anahtar, deger FROM bilgi');
    const harita = Object.fromEntries(satirlar.map((r) => [r.anahtar, r.deger]));
    return { nokta: Number(harita.nokta ?? 0), kaynak: harita.kaynak ?? 'OpenStreetMap' };
  } catch {
    return null;
  }
}
