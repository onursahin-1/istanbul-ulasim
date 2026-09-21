// Türkçe metin ve hat kodu yardımcıları.
//
// Bu dosya bilerek bağımlılıksız: React Native'e dokunmuyor, böylece hem uygulamada
// hem de Node altında çalışan testlerde kullanılabiliyor.

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

/** Marmaray1 / Marmaray2 gibi şube kodlarını ana hatla eşleştirir. */
export function hatAnahtari(kisaAd: string): string {
  const buyuk = trBuyuk(kisaAd.trim());
  return buyuk.startsWith('MARMARAY') ? 'MARMARAY' : buyuk;
}

/** İETT verisinde Metrobüs hatları 34, 34A, 34AS, 34BZ, 34C, 34G, 34Z gibi kodlarla gelir. */
export function metrobusMu(kisaAd?: string | null): boolean {
  return !!kisaAd && /^34[A-ZÇĞİÖŞÜ]{0,2}$/.test(kisaAd.trim());
}
