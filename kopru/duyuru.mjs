// İETT duyuruları: sefer iptali, güzergâh değişikliği, günlük aksaklıklar.
//
// Kaynak İETT'nin Duyurular servisi (tek istek, bütün hatların duyuruları). Köprü
// onları seyrek alıp (DUYURU_ARALIGI) /duyurular adresinden JSON olarak sunuyor;
// uygulama hat ve durak ekranında o hattın duyurusunu gösteriyor.
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
    sonuc.push({ hat, tip: alan(k, 'TIP'), saat: alan(k, 'GUNCELLEME_SAATI'), mesaj });
  }
  return sonuc.sort((a, b) => a.hat.localeCompare(b.hat, 'tr', { numeric: true }));
}
