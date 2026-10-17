// Yer ve adres aramasının saf kısmı: metni sadeleştirme, sorguyu ayrıştırma ("bağdat cd
// 312" → sözcükler ve kapı numarası), sonuç puanı. Veritabanına dokunmuyor (poi.ts), testlerden
// doğrudan çağrılabiliyor.

/**
 * Türkçe arama için sade biçim: 'Şişli Etfal' → 'sisli etfal'.
 * Veritabanının sözcük dizini de aynı kuralla üretildi (veri/kur.py), iki taraf birebir eşleşir.
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

/**
 * Mahalle ve ilçe adında kısa sözcük (5 harften az) tam tutmalı: "gül" Gültepe'yi getirmesin,
 * "bağcı" Bağcılar'ı getirsin.
 */
export const YER_ONEKI_EN_AZ = 5;
export function yerTutar(kelime: string, sozcuk: string): boolean {
  return sozcuk.length >= YER_ONEKI_EN_AZ ? kelime.startsWith(sozcuk) : kelime === sozcuk;
}

/** Adres araması türleri: kategori olarak açılmazlar ("sokak" yazınca yakındaki sokaklar listelenmez). */
export const ADRES_TURLERI = new Set(['adres', 'sokak', 'bina', 'apartman', 'ishani', 'site']);

/**
 * Adres yazımındaki kısaltmalar → veritabanındaki sözcüğün başı (önekle aranıyor):
 * "cd", "cad" → caddesi; "sk", "sok" → sokak, sokağı; "blv", "bul" → bulvarı.
 */
const KISALTMALAR: Record<string, string> = {
  cd: 'cad', cadde: 'cad', sk: 'sok', sokak: 'sok', sokagi: 'sok', blv: 'bulv', bulvar: 'bulv', bul: 'bulv',
};
/** Sorguda tek başına bir şey söylemeyen adres sözcükleri: aranmaz ("Caferağa mah", "no 12"). */
const YOK_SAYILAN = new Set(['mah', 'mh', 'mahalle', 'mahallesi', 'no', 'numara', 'kat', 'daire', 'd', 'k']);

export type Sorgu = {
  /** Aranacak sözcükler (kısaltmalar açılmış). */
  sozcukler: string[];
  /** Sondaki sayı kapı numarası olabilir ("bağdat cad 312" → "312"). */
  kapiNo: string | null;
};

/** "Bağdat Cd. No: 312" → { sozcukler: ['bagdat', 'cad', '312'], kapiNo: '312' }. */
export function sorguyuAyristir(metin: string): Sorgu {
  const ham = sadelestir(metin).split(' ').filter(Boolean);
  const sozcukler = ham.filter((s) => !YOK_SAYILAN.has(s)).map((s) => KISALTMALAR[s] ?? s);
  const son = sozcukler[sozcukler.length - 1];
  // Kapı numarası: sondaki sayı ("312", "12a"), önünde en az bir sözcük daha varsa.
  const kapiNo = sozcukler.length >= 2 && son && /^\d+[a-z]?$/.test(son) ? son : null;
  return { sozcukler: sozcukler.filter((s) => s.length >= 2 || /^\d$/.test(s)).slice(0, 5), kapiNo };
}

/** 'eczane' → 'eczanf': önek aralığının üst sınırı (sozcuk >= x AND sozcuk < y). */
export function onekSonu(onek: string): string {
  return onek.slice(0, -1) + String.fromCharCode(onek.charCodeAt(onek.length - 1) + 1);
}

/**
 * Sonuçların puanı: kategorinin önemi + adın baştan eşleşmesi − uzaklık cezası. Uzaklık ağır
 * basar; yoksa 90 km ötedeki Şile'deki bir yer listenin başına geçiyor. Adres aramasında:
 * kapı numarası birebir tutan adres en üste; sözcüklerden biri yalnız mahalle ya da ilçeyle
 * tuttuysa ("1543 sk bağcılar") o ilçedekiler öne.
 */
export function puanla(
  r: { ad: string; tur: string; agirlik: number; semt?: string | null },
  km: number,
  aranan: string,
  sorgu?: Sorgu,
): number {
  const ad = sadelestir(r.ad);
  let puan = r.agirlik - Math.min(km, 40) * 2.5;
  if (aranan && ad.startsWith(aranan)) puan += 25;
  if (sorgu) {
    const adSozcukleri = ad.split(' ');
    const yerSozcukleri = sadelestir(r.semt ?? '').split(' ');
    // Bütün sözcükler adda: "gül apartmanı" için Gül Apartmanı, Gültepe'deki bir apartmandan önce.
    if (sorgu.sozcukler.every((s) => adSozcukleri.some((w) => w.startsWith(s)))) puan += 30;
    // Sözcük adda tam kelime olarak: "gül" Gül Apartmanı'nda tam, Güladiye'de yalnız baş.
    puan += 12 * sorgu.sozcukler.filter((s) => adSozcukleri.includes(s)).length;
    const yerdenTutan = sorgu.sozcukler.filter(
      (s) => !adSozcukleri.some((w) => w.startsWith(s)) && yerSozcukleri.some((w) => yerTutar(w, s)),
    );
    if (yerdenTutan.length) puan += 12;
    if (sorgu.kapiNo && r.tur === 'adres') {
      const no = /no\s+(\S+)/.exec(ad)?.[1] ?? '';
      if (no === sorgu.kapiNo) puan += 60;
      else if (no.startsWith(sorgu.kapiNo)) puan += 15;
    }
  }
  return puan;
}
