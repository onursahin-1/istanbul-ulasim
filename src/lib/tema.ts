// Uygulamanın renkleri ve metin yardımcıları.
// Taslaktaki kararlar: tek vurgu rengi (Boğaz turkuazı), Metrobüs her yerde kırmızı,
// diğer hatlar numaralarına göre sabit bir renk alır.

export const renk = {
  zemin: '#f4f6f3',
  yuzey: '#ffffff',
  yazi: '#14201b',
  soluk: '#66756e',
  cizgi: '#e3e8e4',
  vurgu: '#0a7b74',
  vurguAcik: '#e6f3f1',
  metrobus: '#d71a28',
  yurume: '#8c9993',
  konum: '#2a7df0',
  hata: '#b3261e',
  hataAcik: '#fbe9e7',
} as const;

const HAT_RENKLERI = ['#2456c8', '#178a4c', '#d9660f', '#7443b8', '#0f7fa6', '#b0406e'];

/** İETT verisinde Metrobüs hatları 34, 34A, 34AS, 34BZ, 34C, 34G, 34Z gibi kodlarla gelir. */
export function metrobusMu(kisaAd?: string | null): boolean {
  return !!kisaAd && /^34[A-ZÇĞİÖŞÜ]{0,2}$/.test(kisaAd.trim());
}

/** Aynı hat her ekranda aynı rengi alsın diye hat kodundan renk üretir. */
export function hatRengi(kisaAd?: string | null): string {
  if (!kisaAd) return renk.soluk;
  if (metrobusMu(kisaAd)) return renk.metrobus;
  let ozet = 0;
  for (const harf of kisaAd) ozet = (ozet * 31 + (harf.codePointAt(0) ?? 0)) >>> 0;
  return HAT_RENKLERI[ozet % HAT_RENKLERI.length];
}

/** Türkçe kurallarına göre küçük harf (I → ı, İ → i). */
export function trKucuk(metin: string): string {
  return metin.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

/** Türkçe kurallarına göre büyük harf (i → İ, ı → I). */
export function trBuyuk(metin: string): string {
  return metin.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
}

// Kısaltmalar ve bağlaçlar başlık düzenine çevrilirken olduğu gibi kalır.
const BUYUK_KALANLAR = new Set(['İETT', 'İDO', 'AVM', 'SGK', 'PTT', 'TEM', 'E-5', 'D-100', 'İSPARK', 'İBB', 'İTÜ', 'YTÜ', 'MEB']);
const KUCUK_KALANLAR = new Set(['ve', 'ile', 'de', 'da']);

/**
 * İETT durak adları büyük harfle gelir ("KADIKÖY BELEDİYESİ - METROBÜS").
 * Ekranda daha rahat okunsun diye "Kadıköy Belediyesi - Metrobüs" biçimine çevirir.
 */
export function baslikYap(metin?: string | null): string {
  if (!metin) return '';
  return metin
    .trim()
    .split(/(\s+|-|\/|\(|\))/)
    .map((parca, sira) => {
      if (!parca.trim() || /^[-/()]$/.test(parca)) return parca;
      if (BUYUK_KALANLAR.has(parca)) return parca;
      const kucuk = trKucuk(parca);
      if (sira > 0 && KUCUK_KALANLAR.has(kucuk)) return kucuk;
      return trBuyuk(kucuk.charAt(0)) + kucuk.slice(1);
    })
    .join('');
}

/** "direction: AVCILAR METROBÜS" → "Avcılar Metrobüs yönü" */
export function yonYaz(aciklama?: string | null): string {
  if (!aciklama) return '';
  const temiz = aciklama.replace(/^direction:\s*/i, '').trim();
  return temiz ? `${baslikYap(temiz)} yönü` : '';
}
