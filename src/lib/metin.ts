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
const BUYUK_KALANLAR = new Set([
  'İETT', 'İDO', 'AVM', 'SGK', 'PTT', 'TEM', 'E-5', 'D-100', 'İSPARK', 'İBB', 'İTÜ', 'YTÜ', 'MEB', 'TRT', 'İMKB', 'TOKİ', 'İSKİ', 'İGDAŞ',
]);
const KUCUK_KALANLAR = new Set(['ve', 'ile', 'de', 'da']);

// Durak adlarında sık geçen, okurken takılan kısaltmaların açılımları. Anahtar noktasız
// büyük harf: "İ.Ö.O", "İÖO.", "İ.Ö.OKL." hepsi "İÖO"/"İÖOKL" olarak aranıyor. Yalnız
// anlamı tek olanlar burada; "B.ŞEHİR" hem Başakşehir hem Büyükşehir olabildiği için yok.
const ACILIMLAR: Record<string, string> = {
  İÖO: 'İlköğretim Okulu',
  İÖOKL: 'İlköğretim Okulu',
  İÖ: 'İlköğretim',
  ÖO: 'Öğretim Okulu',
  İHL: 'İmam Hatip Lisesi',
  ŞH: 'Şehir Hatları',
  KHANE: 'Kağıthane',
  BPAŞA: 'Bayrampaşa',
  BÇEKMECE: 'Büyükçekmece',
  KÇEKMECE: 'Küçükçekmece',
  SGAZİ: 'Sultangazi',
  GOPAŞA: 'Gaziosmanpaşa',
};

/** Tek kelime: bağlaç küçük, kısaltma büyük, gerisi baş harfi büyük. */
function kelimeYap(kelime: string, bastaMi: boolean): string {
  if (!kelime) return kelime;
  if (BUYUK_KALANLAR.has(kelime)) return kelime;
  const kucuk = trKucuk(kelime);
  if (!bastaMi && KUCUK_KALANLAR.has(kucuk)) return kucuk;
  return trBuyuk(kucuk.charAt(0)) + kucuk.slice(1);
}

/** Tek harf (baş harf kısaltması: "İ.Ü.", "F.S. Mehmet"). */
const basHarfMi = (parca: string) => /^\p{L}$/u.test(parca);

/**
 * Noktalı bir parça: "İ.Ö.O" → "İlköğretim Okulu", "M.Ü." → "M.Ü.",
 * "DR.SADIK" → "Dr. Sadık", "4.LEVENT" → "4. Levent", "PROF.DR.CEMİL" → "Prof. Dr. Cemil".
 */
function noktaliYap(parca: string, bastaMi: boolean): string {
  const acilim = ACILIMLAR[trBuyuk(parca).replace(/\./g, '')];
  if (acilim) return acilim;
  const bolumler = parca.split('.');
  let sonuc = '';
  bolumler.forEach((b, i) => {
    if (i > 0) {
      sonuc += '.';
      // Noktadan sonra boşluk: iki baş harfin arasına ("İ.Ü.") ve sayının içine ("3.5") değil.
      const onceki = bolumler[i - 1];
      if (b && /^\p{L}/u.test(b) && !(basHarfMi(onceki) && basHarfMi(b))) sonuc += ' ';
    }
    sonuc += basHarfMi(b) ? trBuyuk(b) : kelimeYap(b, bastaMi && i === 0);
  });
  return sonuc;
}

/**
 * İETT durak adları büyük harfle gelir ("KADIKÖY BELEDİYESİ - METROBÜS").
 * Ekranda daha rahat okunsun diye "Kadıköy Belediyesi - Metrobüs" biçimine çevirir.
 * Noktalı kısaltmalar bozulmuyor: "MALAZGİRT İ.Ö.O" → "Malazgirt İlköğretim Okulu".
 */
export function baslikYap(metin?: string | null): string {
  if (!metin) return '';
  return metin
    .trim()
    .split(/(\s+|-|\/|\(|\))/)
    .map((parca, sira) => {
      if (!parca.trim() || /^[-/()]$/.test(parca)) return parca;
      const acilim = ACILIMLAR[trBuyuk(parca)];
      if (acilim) return acilim;
      if (parca.includes('.')) return noktaliYap(parca, sira === 0);
      return kelimeYap(parca, sira === 0);
    })
    .join('');
}

/**
 * "direction: AVCILAR METROBÜS" → "Avcılar Metrobüs yönü"
 *
 * Yalnız "direction:" önekli açıklama yöndür (İETT). Raylı/vapur beslemesindeki açıklama
 * durağın başka adı ("Karaköy ŞH.", "Dentur Bebek"); onu yön diye yazmak yanlıştı.
 */
export function yonYaz(aciklama?: string | null): string {
  const yon = yonAdi(aciklama);
  return yon ? `${baslikYap(yon)} yönü` : '';
}

/** Açıklamadaki yön, büyük harfli ham hâliyle ("AKSARAY"); yön değilse boş. */
export function yonAdi(aciklama?: string | null): string {
  const m = /^\s*direction:\s*(.*)$/i.exec(aciklama ?? '');
  return m ? m[1].trim() : '';
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
