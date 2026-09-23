// İETT duyuruları: sefer iptali, güzergâh değişikliği, günlük aksaklıklar.
//
// Kaynak İETT'nin Duyurular servisi (tek istek, bütün hatların duyuruları). Köprü
// onları seyrek alıp (DUYURU_ARALIGI) /duyurular adresinden JSON olarak sunuyor;
// uygulama hat ve durak ekranında o hattın duyurusunu gösteriyor.
//
// Duyurudaki "hat" hattın kodu değil, adı ("IETT IKITELLI GARAJI-TAKSIM"), üstelik
// Türkçe harflerin bir kısmı düşürülmüş (İ→I, Ş→S, Ğ→G). Uygulama hattı koduyla
// tanıyor; kodu burada buluyoruz:
//   1. İETT'nin kendi hat listesindeki ad (GetHat_json, SHATADI) birebir tutarsa o hat.
//   2. Tutmazsa GTFS'teki güzergâh adları: duyuru adının bütün sözcükleri bir güzergâh
//      adında geçiyorsa o güzergâhın hattı. Beşten çok hatta tutan ad belirsiz sayılıyor.
//
// Servisin belgelenmiş bir kotası yok (100/saat sınırı Sefer Gerçekleşme servisi
// için), ama İBB ağ geçidi istekleri ortak sayıyor olabilir: duyuru istekleri de
// aynı kapıdan ve aynı saatlik bütçeden geçiyor.

/** Alan adının büyük/küçük harfine bakmadan oku: servis belgesi büyük harf diyor, emin değiliz. */
function alan(kayit, ad) {
  if (!kayit || typeof kayit !== 'object') return '';
  const anahtar = Object.keys(kayit).find((k) => k.toLowerCase() === ad.toLowerCase());
  return anahtar == null ? '' : String(kayit[anahtar] ?? '').trim();
}

/**
 * Servisin ham listesini düzenler: boşları atar, aynı hattın aynı mesajını teke
 * indirir, hat koduna göre sıralar.
 *
 * @returns {{hat:string, tip:string, saat:string, mesaj:string}[]}
 */
export function duyurulariDuzenle(ham) {
  const liste = Array.isArray(ham) ? ham : ham ? [ham] : [];
  const gorulen = new Set();
  const sonuc = [];
  for (const k of liste) {
    const hat = alan(k, 'HAT').toLocaleUpperCase('tr-TR');
    const mesaj = alan(k, 'MESAJ').replace(/\s+/g, ' ');
    if (!hat || !mesaj) continue;
    const anahtar = `${hat}\u0000${mesaj}`;
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    // "Kayit Saati: 06:35" → "06:35"
    const saat = alan(k, 'GUNCELLEME_SAATI').replace(/^[^0-9]*(?=\d{1,2}:\d{2})/, '');
    sonuc.push({ hat, tip: alan(k, 'TIP'), saat, mesaj });
  }
  return sonuc.sort((a, b) => a.hat.localeCompare(b.hat, 'tr', { numeric: true }));
}

/**
 * Ad karşılaştırma anahtarı: büyük harf, Türkçe harfler katlanmış, noktalama boşluk.
 * "İETT İKİTELLİ GARAJI - TAKSİM" ile "IETT IKITELLI GARAJI-TAKSIM" aynı anahtara düşer.
 */
export function adAnahtari(ad) {
  const kat = { Ç: 'C', Ğ: 'G', İ: 'I', I: 'I', Ö: 'O', Ş: 'S', Ü: 'U', Â: 'A', Î: 'I', Û: 'U' };
  return String(ad ?? '')
    .toLocaleUpperCase('tr-TR')
    .replace(/[ÇĞİIÖŞÜÂÎÛ]/g, (h) => kat[h])
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Belirsiz sayılmadan önce bir adın tutabileceği en çok hat. */
const EN_COK_HAT = 5;

/**
 * Duyurulara hat kodlarını ekler (`kodlar`). Bulunamayanlar boş listeyle kalır.
 *
 * @param duyurular duyurulariDuzenle çıktısı
 * @param iettAdlari [{kod, ad}] İETT hat listesinden
 * @param gtfsAdlari [{kisa, uzun}] GTFS güzergâh adları
 */
export function duyurulariEslestir(duyurular, iettAdlari = [], gtfsAdlari = []) {
  const adla = new Map();
  for (const { kod, ad } of iettAdlari) {
    const a = adAnahtari(ad);
    if (!a || !kod) continue;
    if (!adla.has(a)) adla.set(a, new Set());
    adla.get(a).add(String(kod).trim().toUpperCase());
  }
  const guzergahlar = gtfsAdlari.map(({ kisa, uzun }) => ({ kisa, sozcukler: new Set(adAnahtari(uzun).split(' ')) }));

  return duyurular.map((d) => {
    const anahtar = adAnahtari(d.hat);
    let kodlar = [...(adla.get(anahtar) ?? [])];
    if (!kodlar.length && anahtar) {
      const aranan = anahtar.split(' ');
      const bulunan = new Set(guzergahlar.filter((g) => aranan.every((s) => g.sozcukler.has(s))).map((g) => g.kisa));
      if (bulunan.size <= EN_COK_HAT) kodlar = [...bulunan];
    }
    return { ...d, kodlar: kodlar.sort() };
  });
}
