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

// Harf sınıfı. \p{L} yerine açık liste: Hermes'in eski sürümleri Unicode özellik
// kaçışlarını ve geriye bakan (lookbehind) ifadeleri desteklemiyordu.
const HARF = 'A-Za-zÇĞİIÖŞÜçğıöşüÂâÎîÛû';
const ONCE = `(^|[^${HARF}])`; // kelime başı; yakalanan karakter yerine geri konuyor
const SONRA = `(?![${HARF}])`; // kelime sonu

/**
 * İBB verisindeki kısaltma ve kesik yazımları düzelten kurallar. Büyük harfli metne,
 * kelimelere ayırmadan önce uygulanıyor; sıra önemli (özel olan önce).
 *
 * Neden bu kadar çok biçim: İETT durak adları 20 karakterde kesiliyor, uzun okul adları
 * "HASAN GÜREL İLK ÖĞRE", "TUNA İLKÖĞRETİM OKUL" gibi yarım kalıyor; aynı kısaltma da
 * "İÖO", "İ.Ö.O.", "İ.Ö.OKL.", "İ.Ö. OKULU" diye her durakta başka yazılmış.
 */
const DUZELTMELER: [RegExp, string][] = [
  // "50.Y.İÖO" → "50.YIL İÖO"; "ORHONİÖO" (bitişik) → "ORHON İÖO"
  [/(\d\.)\s?Y\.\s?/g, '$1YIL '],
  [new RegExp(`([${HARF}]{3})(İ\\.?Ö\\.?O)${SONRA}`, 'g'), '$1 $2'],
  [new RegExp(`${ONCE}M\\.\\s?TEK\\.\\s?A\\.\\s?LİS\\.?${SONRA}`, 'g'), '$1MESLEKİ VE TEKNİK ANADOLU LİSESİ'],
  // İlköğretim okulu: İÖO, İ.Ö.O., İ.Ö.OKL., İÖOKULU, İ.Ö. OKULU, "İÖ" (kesik)
  [new RegExp(`${ONCE}İ\\.?\\s?Ö\\.?\\s?(?:OKULU|OKUL|OKL\\.?|O\\.?)?${SONRA}`, 'g'), '$1İLKÖĞRETİM OKULU'],
  // İLK Ö.O, İLK ÖĞRE (kesik), İLKÖĞ., İLKOĞRETİM (yazım hatası), İLKÖĞRETİM O / OKUL
  [new RegExp(`${ONCE}İLK\\.?\\s?Ö\\.?\\s?O\\.?${SONRA}`, 'g'), '$1İLKÖĞRETİM OKULU'],
  [new RegExp(`${ONCE}İLK\\.?\\s?[ÖO]Ğ[RETİM]*\\.?\\s?(?:OKULU|OKUL|OKL\\.?|O\\.?)${SONRA}`, 'g'), '$1İLKÖĞRETİM OKULU'],
  [new RegExp(`${ONCE}İLK\\.?\\s?[ÖO]Ğ[RETİM]*\\.?\\s*$`, 'g'), '$1İLKÖĞRETİM OKULU'],
  [new RegExp(`${ONCE}İLK\\.?\\s?[ÖO]Ğ[RETİM]*\\.?${SONRA}`, 'g'), '$1İLKÖĞRETİM'],
  [new RegExp(`${ONCE}İLK\\.\\s?(OKULU|OKUL)${SONRA}`, 'g'), '$1İLKOKULU'],
  // İmam hatip, lise, meslek, ticaret, Anadolu, teknik, endüstri
  [new RegExp(`${ONCE}İ\\.?\\s?H\\.?\\s?L\\.?${SONRA}`, 'g'), '$1İMAM HATİP LİSESİ'],
  [new RegExp(`${ONCE}HAT\\.\\s?(?=LİS)`, 'g'), '$1HATİP '],
  [/MSL\.L$/g, 'MSL.LİSESİ'],
  [new RegExp(`${ONCE}(?:LİSES|LİS|LS)\\.?${SONRA}`, 'g'), '$1LİSESİ'],
  [new RegExp(`${ONCE}(?:MSLK|MSL|MES)\\.\\s?`, 'g'), '$1MESLEK '],
  [new RegExp(`${ONCE}TİC\\.\\s?`, 'g'), '$1TİCARET '],
  [new RegExp(`${ONCE}AND\\.\\s?`, 'g'), '$1ANADOLU '],
  [new RegExp(`${ONCE}TEK\\.\\s?(?=END|LİS|ÜNV)`, 'g'), '$1TEKNİK '],
  [new RegExp(`${ONCE}END\\.\\s?`, 'g'), '$1ENDÜSTRİ '],
  [new RegExp(`${ONCE}PROG\\.\\s?`, 'g'), '$1PROGRAMLI '],
  [new RegExp(`${ONCE}MRK\\.\\s?ÜNV\\.\\s?KMP\\.?${SONRA}`, 'g'), '$1MERKEZ ÜNİVERSİTE KAMPÜSÜ'],
  // "ÜNİV.MAH." Üniversite Mahallesi, "MARMARA ÜNV." Marmara Üniversitesi
  [new RegExp(`${ONCE}(?:ÜNİV|ÜNİ|ÜNV)\\.\\s?(?=MAH|MH|KAMP|KMP)`, 'g'), '$1ÜNİVERSİTE '],
  [new RegExp(`${ONCE}(?:ÜNİV|ÜNİ|ÜNV)\\.\\s?`, 'g'), '$1ÜNİVERSİTESİ '],
  [new RegExp(`${ONCE}(?:HAST|HST)\\.?${SONRA}`, 'g'), '$1HASTANESİ'],
  [new RegExp(`${ONCE}(?:MRKZ|MRK)\\.?${SONRA}`, 'g'), '$1MERKEZİ'],
  [new RegExp(`${ONCE}(?:EĞİT|EĞT)\\.\\s?`, 'g'), '$1EĞİTİM '],
  [new RegExp(`${ONCE}ARŞ\\.\\s?`, 'g'), '$1ARAŞTIRMA '],
  [new RegExp(`${ONCE}ŞHT\\.\\s?`, 'g'), '$1ŞEHİT '],
  [new RegExp(`${ONCE}KÖP\\.?${SONRA}`, 'g'), '$1KÖPRÜSÜ'],
  [/MESLEK L\.?$/g, 'MESLEK LİSESİ'],
  [/ L\.$/g, ' LİSESİ'],
  [new RegExp(`${ONCE}(?:MUHT|MUH)\\s?\\.${SONRA}`, 'g'), '$1MUHTARLIĞI'],
  [new RegExp(`${ONCE}(?:KAMP|KMP)\\.?${SONRA}`, 'g'), '$1KAMPÜSÜ'],
  [new RegExp(`${ONCE}AVC\\.\\s?`, 'g'), '$1AVCILAR '],
  [new RegExp(`${ONCE}HİS\\.\\s?`, 'g'), '$1HİSARI '],
  // Kesik kalmış sık adlar
  [new RegExp(`${ONCE}(?:ÖĞR\\.?\\s?|ÖĞRENCİ\\s+)YUR(?:DU|D)?\\.?${SONRA}`, 'g'), '$1ÖĞRENCİ YURDU'],
  [new RegExp(`${ONCE}POLİS\\s+(?:MERKEZ|MERK|MER|MRK)\\.?${SONRA}`, 'g'), '$1POLİS MERKEZİ'],
  [new RegExp(`${ONCE}BLOKL${SONRA}`, 'g'), '$1BLOKLARI'],
  // Semt kısaltmaları (anlamı tek olanlar; "B.ŞEHİR" Başakşehir de Büyükşehir de olabilir)
  [new RegExp(`${ONCE}ÜMR\\.\\s?`, 'g'), '$1ÜMRANİYE '],
  [new RegExp(`${ONCE}K\\.\\s?HANE${SONRA}`, 'g'), '$1KAĞITHANE'],
  [new RegExp(`${ONCE}B\\.\\s?PAŞA${SONRA}`, 'g'), '$1BAYRAMPAŞA'],
  [new RegExp(`${ONCE}B\\.\\s?ÇEKMECE${SONRA}`, 'g'), '$1BÜYÜKÇEKMECE'],
  [new RegExp(`${ONCE}K\\.\\s?ÇEKMECE${SONRA}`, 'g'), '$1KÜÇÜKÇEKMECE'],
  [new RegExp(`${ONCE}S\\.\\s?GAZİ${SONRA}`, 'g'), '$1SULTANGAZİ'],
  [new RegExp(`${ONCE}(?:G|GAZİ)\\.\\s?O\\.\\s?PAŞA${SONRA}`, 'g'), '$1GAZİOSMANPAŞA'],
  [new RegExp(`${ONCE}K\\.\\s?M\\.\\s?PAŞA${SONRA}`, 'g'), '$1KOCAMUSTAFAPAŞA'],
  [new RegExp(`${ONCE}Z\\.\\s?KUYU${SONRA}`, 'g'), '$1ZİNCİRLİKUYU'],
  [new RegExp(`${ONCE}Y\\.\\s?BOSNA${SONRA}`, 'g'), '$1YENİBOSNA'],
  // Vapur iskeleleri: "KABATAŞ ŞH." → Şehir Hatları
  [new RegExp(`${ONCE}ŞH\\.?${SONRA}`, 'g'), '$1ŞEHİR HATLARI'],
];

/** Kısaltma ve kesik yazımları açar; büyük harfli metin alır, büyük harfli verir. */
function duzelt(buyuk: string): string {
  // Tireden önce ya da sonra boşluk varsa iki yanında da olsun: "BLOKLAR- ŞEHİT" → "BLOKLAR - ŞEHİT".
  let metin = buyuk.replace(/\s+/g, ' ').replace(/ -\s*|\s*- /g, ' - ').trim();
  for (const [kalip, yerine] of DUZELTMELER) metin = metin.replace(kalip, yerine);
  return metin.replace(/\s+/g, ' ').trim();
}

/** Tek kelime: bağlaç küçük, kısaltma büyük, gerisi baş harfi büyük. */
function kelimeYap(kelime: string, bastaMi: boolean): string {
  if (!kelime) return kelime;
  if (BUYUK_KALANLAR.has(kelime)) return kelime;
  const kucuk = trKucuk(kelime);
  if (!bastaMi && KUCUK_KALANLAR.has(kucuk)) return kucuk;
  return trBuyuk(kucuk.charAt(0)) + kucuk.slice(1);
}

/** Tek harf (baş harf kısaltması: "İ.Ü.", "F.S. Mehmet"). */
const basHarfMi = (parca: string) => new RegExp(`^[${HARF}]$`).test(parca);

/**
 * Noktalı bir parça: "M.Ü." → "M.Ü.", "DR.SADIK" → "Dr. Sadık", "4.LEVENT" → "4. Levent",
 * "PROF.DR.CEMİL" → "Prof. Dr. Cemil".
 */
function noktaliYap(parca: string, bastaMi: boolean): string {
  const bolumler = parca.split('.');
  let sonuc = '';
  bolumler.forEach((b, i) => {
    if (i > 0) {
      sonuc += '.';
      // Noktadan sonra boşluk: iki baş harfin arasına ("İ.Ü.") ve sayının içine ("3.5") değil.
      const onceki = bolumler[i - 1];
      if (b && new RegExp(`^[${HARF}]`).test(b) && !(basHarfMi(onceki) && basHarfMi(b))) sonuc += ' ';
    }
    sonuc += basHarfMi(b) ? b : kelimeYap(b, bastaMi && i === 0);
  });
  return sonuc;
}

/**
 * İETT durak adları büyük harfle gelir ("KADIKÖY BELEDİYESİ - METROBÜS").
 * Ekranda daha rahat okunsun diye "Kadıköy Belediyesi - Metrobüs" biçimine çevirir.
 * Kısaltma ve kesik yazımlar açılıyor: "MALAZGİRT İ.Ö.O" ve "MALAZGİRT İLK Ö.O" →
 * "Malazgirt İlköğretim Okulu".
 */
export function baslikYap(metin?: string | null): string {
  if (!metin) return '';
  return duzelt(trBuyuk(metin))
    .split(/(\s+|-|\/|\(|\))/)
    .map((parca, sira) => {
      if (!parca.trim() || /^[-/()]$/.test(parca)) return parca;
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
