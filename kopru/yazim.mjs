// Duyuru metinlerini okunur yapar: BÜYÜK HARFLİ, Türkçe harfleri düşmüş metni
// cümle düzenine çevirir ve kaybolan harfleri geri koyar.
//
//   "HATTIMIZ YOL CALISMASI NEDENIYLE KADIKOYDEN GECICI OLARAK UGRAMAYACAKTIR."
//   → "Hattımız yol çalışması nedeniyle Kadıköy'den geçici olarak uğramayacaktır."
//
// İETT'nin duyuru servisi metni çoğu zaman büyük harfle ve İ/Ş/Ğ gibi harfleri
// ASCII karşılıklarıyla veriyor. Hangi harflerin düştüğünü metnin kendisinden
// anlıyoruz: içinde hiç "İ" geçmeyen bir metinde "I" hem ı hem i olabilir, en az bir
// "İ" varsa "I" gerçekten ı'dır. Aynısı Ş/S, Ğ/G, Ü/U, Ö/O, Ç/C için.
//
// Sözcükler sırayla şuralarda aranıyor:
//   1. Kısaltmalar (İETT, İSKİ, TEM, D-100 …) — büyük harf kalır.
//   2. Duyurularda sık geçen sözcüklerin sözlüğü (aşağıda) — birebir ya da kök + ek.
//      Ekin harfleri ünlü uyumuyla çözülür: KALDIRIL + DI → kaldırıl + dı.
//   3. GTFS'teki durak ve hat adlarının sözcükleri — özel ad, büyük harfle başlar.
//      Özel ada gelen hâl eki kesme işaretiyle ayrılır: Kadıköy'den.
//   4. Hiçbiri tutmazsa ünlü uyumu: bir önceki ünlü inceyse I → i, kalınsa ı.
//
// Yanılabilir: sözlükte olmayan bir sözcükte "S"nin ş mi s mi olduğunu bilemeyiz.
// Amaç kusursuz yazım değil, göze batan "CALISMASI NEDENIYLE"yi gidermek.

const TR_OZEL = { Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U', Â: 'A', Î: 'I', Û: 'U' };
/** Türkçeye özgü harf → ASCII karşılığı (hangi çiftin düştüğünü bulmak için). */
const CIFTLER = [
  ['İ', 'I'],
  ['Ş', 'S'],
  ['Ğ', 'G'],
  ['Ü', 'U'],
  ['Ö', 'O'],
  ['Ç', 'C'],
];

export function buyuk(s) {
  return String(s ?? '').toLocaleUpperCase('tr-TR');
}
export function kucuk(s) {
  return String(s ?? '').toLocaleLowerCase('tr-TR');
}

/** Karşılaştırma anahtarı: büyük harf, Türkçe harfler ASCII'ye katlanmış. */
export function katla(s) {
  return buyuk(s).replace(/[ÇĞİÖŞÜÂÎÛ]/g, (h) => TR_OZEL[h]);
}

const INCE = new Set(['e', 'i', 'ö', 'ü', 'î', 'û']);
const KALIN = new Set(['a', 'ı', 'o', 'u', 'â']);
const UNLU = new Set([...INCE, ...KALIN]);
const SERT = new Set(['ç', 'f', 'h', 'k', 'p', 's', 'ş', 't']);

// ---------------------------------------------------------------------------
// Sözlük. Kökler küçük harf ve doğru yazımla; "*" ile başlayanlar yer türü
// (cadde, mahalle …): bir özel adın hemen ardından gelince büyük harfle başlar.
// "!" ile başlayanlar (kısaltmalar: cad, sk) yalnız birebir eşleşir, kök sayılmaz.
// Kök yeterli: ekleri ünlü uyumu çözüyor (sefer → seferleri, seferlerimiz).
// ---------------------------------------------------------------------------
const SOZCUKLER = `
ve veya ile ya da de ki mi bu şu o her tüm bütün bazı bir iki üç dört beş altı yedi sekiz dokuz yirmi otuz kırk elli yüz bin
için gibi kadar göre önce sonra sonraki önceki ilk son yeni eski ayrıca ancak fakat ama rağmen dolayı dolayısıyla nedeniyle nedenle
neden sebebiyle sebep itibaren itibariyle sadece yalnızca yalnız dahil hariç haricinde kısmen tamamen tekrar yeniden kademeli
arasında arası ara boyunca süresince sırasında sıra üzere üzerinden üzerinde üzeri karşı karşısı yanı ön önü arka iç dış içinde dışında
çevre civar mevki doğru doğrultusunda istikamet yön taraf tarafından şekilde şekli halinde durum konu hakkında ilgili olarak olup
hat hatt sefer güzergah güzergâh durak durağ istasyon peron iskele vapur otobüs metrobüs metro tramvay teleferik füniküler marmaray
minibüs dolmuş taksi araç aracı taşıt yolcu vatandaş sayın değerli yolcularımız hizmet ulaşım toplu aktarma ücret ücretsiz bilet
yol yolu çalışma çalış yapım yapıl yapılan yapılacak yapılmakta yap kazı asfalt altyapı doğalgaz su elektrik boru kanal onarım bakım
tamir yenileme bakımı arıza kaza trafik yoğunluk yoğun sıkışık kapalı kapat kapan kapanma açıl açık açılış geç geçiş geçici geçerli
gidiş dönüş giriş çıkış iptal kaldır kaldırıl ilave ek takviye uzat kısalt kısa uzun çevir yönlendir yönlendirme değişiklik değiş
alternatif güzergahı uygula uygulama uygulan yürürlük kapsam gerçekleştir gerçekleş düzenle düzenlen etkinlik tören maç miting
yürüyüş maraton bisiklet koşu yarış festival konser kutlama anma gösteri eylem grev
kar yağış yağmur fırtına rüzgar hava şart koşul olumsuz buzlanma sel su baskını taşkın heyelan çökme çöküntü göçük ağaç devril
emniyet polis zabıta ekip belediye müdürlük müdürlüğü işletme idare kurum talep talimat izin müsaade karar
devam ed et edil edecek eder olacak ol olacaktır bulun bulunmakta ver veril sun sunul sağla sağlan başla başlat bit bitir tamamla
tamamlan son sona er sür süre sürecek gecikme gecik bekle bekleme bekletil kullan kullanıl uğra uğramadan gel gelen git gid giden
gidecek kalk kalkış kalkan bin in binecek inecek taşı taşıma yaşan meydana teknik sorun problem aksaklık aksama aksa kesinti kesil çekil müdahale olay
yer yerine yerinde bilgi bilgilendir bilgilerinize duyurulur duyuru duyur ilan özür diler dileriz anlayış teşekkür ederiz rica maalesef
saat saatleri dakika dk süre zaman gün günü hafta ay yıl sabah akşam öğle öğleden gece gündüz bugün yarın
pazartesi salı çarşamba perşembe cuma cumartesi pazar ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık
sık sıklık aralık yaklaşık metre mesafe kavşak kesişim kesiş tünel viyadük köprü üst alt geçit yaya kaldırım şerit sağ sol bölüm kısım kesim bölge
merkez hastane okul üniversite cami camii çarşı pazar park otopark garaj terminal otogar yurt stadyum
*cadde *caddesi !*cad *sokak *sokağı !*sok !*sk *bulvar *bulvarı !*blv !*bul *meydan *meydanı *mahalle *mahallesi !*mah *köprüsü
*kavşağı !*kav !dk *bayram *bayramı *tüneli *istasyonu *iskelesi *garajı *terminali *otogarı *camii *hastanesi *parkı *çarşısı *yolu *caddesinde *sokağında
`;

/** İstanbul'un duyurularda sık geçen, GTFS'te sözcük olarak bulunmayabilecek özel adları. */
const OZEL_ADLAR = 'İstanbul Türkiye Avrupa Anadolu Asya Boğaziçi Haliç Marmara Karadeniz Kurban Ramazan Atatürk Cumhuriyet'.split(' ');

/** Büyük harf kalan kısaltmalar. */
const KISALTMALAR = 'İETT İBB İSKİ İGDAŞ İSPARK İDO TCDD TEM AVM UKOME BEDAŞ AYEDAŞ TEİAŞ ŞUDO TÜYAP İSTAÇ KGM TBMM PTT SGK ÖSYM YKS KPSS LGS'.split(
  ' ',
);

/**
 * Kökten sözlük kurar: katlanmış anahtar → aday biçimler.
 * @returns {Map<string, {bicim:string, yer:boolean}[]>}
 */
function kokleriKur(metin) {
  const m = new Map();
  for (const ham of metin.split(/\s+/).filter(Boolean)) {
    const tam = ham.startsWith('!');
    const yer = ham.replace(/^!/, '').startsWith('*');
    const bicim = ham.replace(/^[!*]+/, '');
    const k = katla(bicim);
    if (!m.has(k)) m.set(k, []);
    const liste = m.get(k);
    const var_ = liste.find((a) => a.bicim === bicim);
    if (!var_) liste.push({ bicim, yer, tam });
    else var_.yer ||= yer;
  }
  return m;
}
const KOKLER = kokleriKur(SOZCUKLER);
const KISALTMA = new Map(KISALTMALAR.map((k) => [katla(k), k]));

/** Metinde hangi Türkçe harf çiftlerinin düştüğü: Set('I','S', …) — ASCII tarafıyla. */
export function dusenHarfler(metin) {
  const b = buyuk(metin);
  return new Set(CIFTLER.filter(([tr]) => !b.includes(tr)).map(([, asc]) => asc));
}

/**
 * Aday biçim, metindeki özgün yazımla uyuşuyor mu? Özgün harf Türkçeye özgüyse
 * aday da aynı olmalı; düşmemiş bir çiftin ASCII harfi de gerçekten o harftir.
 */
function uyar(bicim, ozgun, dusen) {
  const a = buyuk(bicim);
  const o = buyuk(ozgun);
  if (a.length < o.length) return false;
  for (let i = 0; i < o.length; i++) {
    const ah = a[i];
    const oh = o[i];
    if (ah === oh) continue;
    if (katla(ah) !== katla(oh)) return false;
    // Özgünde Türkçe harf var, adayda yok: uymaz.
    if (TR_OZEL[oh]) return false;
    // Özgün ASCII, aday Türkçe: ancak o çift bu metinde düştüyse.
    if (!dusen.has(oh)) return false;
  }
  return true;
}

/** Bir sözcüğün son ünlüsü (küçük harf), yoksa null. */
function sonUnlu(s) {
  const k = kucuk(s);
  for (let i = k.length - 1; i >= 0; i--) if (UNLU.has(k[i])) return k[i];
  return null;
}

/**
 * Büyük harfli, harfleri düşmüş olabilecek bir parçayı ünlü uyumuyla küçük harfe
 * çevirir. `once` parçanın bağlandığı kök (ek çözerken) — yoksa sözcüğün başı.
 */
export function uyumlaCoz(parca, once, dusen) {
  let onceki = once ? kucuk(once) : '';
  let unlu = sonUnlu(onceki);
  const b = buyuk(parca);
  let cikti = '';
  for (let i = 0; i < b.length; i++) {
    const h = b[i];
    const sonraki = b[i + 1];
    const oncekiHarf = (onceki + cikti).slice(-1);
    let k;
    if (h === 'I') {
      if (!dusen.has('I')) k = 'ı';
      else k = unlu == null || INCE.has(unlu) ? 'i' : 'ı';
    } else if (h === 'U' && dusen.has('U')) {
      k = unlu != null && INCE.has(unlu) ? 'ü' : 'u';
    } else if (h === 'S' && dusen.has('S') && once && /m[ıiuü]$/.test(onceki + cikti)) {
      // Öğrenilen geçmiş zaman eki: -mış/-miş/-muş/-müş (edilmiştir, yapılmıştır).
      k = 'ş';
    } else if (h === 'G' && dusen.has('G') && UNLU.has(oncekiHarf) && sonraki && 'AEIİOÖUÜ'.includes(sonraki)) {
      k = 'ğ';
    } else if (h === 'C' && dusen.has('C') && SERT.has(oncekiHarf)) {
      k = 'ç';
    } else {
      k = kucuk(h);
    }
    cikti += k;
    if (UNLU.has(k)) unlu = k;
  }
  return cikti;
}

/** Sertleşen son ünsüzün yumuşamış anahtar biçimi: sokak → sokağ-, durak → durağ-. */
function yumusat(bicim) {
  const son = bicim.slice(-1);
  const yumusak = { k: 'ğ', ç: 'c', t: 'd', p: 'b' }[son];
  return yumusak ? bicim.slice(0, -1) + yumusak : null;
}

/**
 * GTFS'teki bir sözcük sık bir sözcüğün ekli hâli mi (YOLU, CAMİLERİ)? Öyleyse sade.
 * "TAKSİM" = taksi + m gibi rastlantılar özel ad kalsın diye ekler sınırlı.
 */
const ADIN_EKI = /^(Y?[AE]N|Y?[IU]|S[IU]|L[AE]R[IU]?|N?D[AE]N?|N?T[AE]N?|Y?[AE]|S[IU]N?[DT]?[AE]N?|N?IN|N?UN|L[AE]RIN[DI]?[AE]?N?)$/;

/** Özel addan sonra kesmeyle ayrılan hâl ve iyelik ekleri (katlanmış). */
const HAL_EKI =
  /^(DA|DE|TA|TE|DAN|DEN|TAN|TEN|A|E|YA|YE|IN|UN|NIN|NUN|YLA|YLE|LA|LE|DAKI|DEKI|TAKI|TEKI|NA|NE|NDA|NDE|NDAN|NDEN)$/;
// Yalın -ı/-u yok: "BAYRAMI", "PARKI" gibi tamlamalar kesmeyle ayrılmaz.

/**
 * Duyuru sözlüğü kurar. `adlar` GTFS durak ve hat adları (büyük harf, Türkçe harfli).
 * @returns {{ozel: Map<string,{bicim:string,sayi:number}[]>, adlar: Set<string>}}
 */
export function sozlukKur(adlar = []) {
  const ozel = new Map();
  const cokSozcuklu = new Set();
  const ekle = (sozcuk, agirlik) => {
    const k = katla(sozcuk);
    if (k.length < 2 || /\d/.test(k)) return;
    if (!ozel.has(k)) ozel.set(k, []);
    const liste = ozel.get(k);
    const var_ = liste.find((a) => a.bicim === sozcuk);
    if (var_) var_.sayi += agirlik;
    else liste.push({ bicim: sozcuk, sayi: agirlik });
  };
  for (const ad of adlar) {
    const sozcukler = buyuk(ad).match(/[A-ZÇĞİIÖŞÜÂÎÛ]+/g) ?? [];
    for (const s of sozcukler) ekle(s, 1);
    if (sozcukler.length >= 2 && sozcukler.length <= 5) cokSozcuklu.add(sozcukler.map(katla).join(' '));
  }
  for (const a of OZEL_ADLAR) ekle(buyuk(a), 1000);
  // Önce en sık biçim; eşitlikte Türkçe harfi çok olan (SİRKECİ, SIRKECI'den önce).
  const trSayisi = (s) => (s.match(/[ÇĞİÖŞÜ]/g) ?? []).length;
  for (const liste of ozel.values()) liste.sort((a, b) => b.sayi - a.sayi || trSayisi(b.bicim) - trSayisi(a.bicim));
  return { ozel, adlar: cokSozcuklu };
}

/** Sözlükte kök + ek olarak arar. En uzun kök kazanır. */
function kokleAra(ozgun, dusen, sozluk, enAzKok, ekUygun) {
  const k = katla(ozgun);
  for (let n = k.length - 1; n >= enAzKok; n--) {
    const kok = k.slice(0, n);
    const ek = k.slice(n);
    if (!ekUygun(ek, n)) continue;
    const adaylar = sozluk.get(kok);
    if (!adaylar) continue;
    const aday = adaylar.find((a) => !a.tam && uyar(a.bicim, ozgun.slice(0, n), dusen));
    if (aday) return { aday, ekOzgun: ozgun.slice(n) };
  }
  return null;
}

/** Tek sözcüğü çözer: { yazi, tur: 'kisaltma'|'ozel'|'yer'|'sade' }. */
function sozcukCoz(ozgun, dusen, sozluk) {
  const k = katla(ozgun);
  if (KISALTMA.has(k)) return { yazi: KISALTMA.get(k), tur: 'kisaltma' };

  const sozlukteBul = (anahtar, parca) => (KOKLER.get(anahtar) ?? []).find((a) => uyar(a.bicim, parca, dusen));
  const tam = sozlukteBul(k, ozgun);
  if (tam) return { yazi: kucuk(tam.bicim), tur: tam.yer ? 'yer' : 'sade' };

  const ozelTam = sozluk.ozel.get(k)?.find((a) => uyar(a.bicim, ozgun, dusen));
  // Sık sözcüğün ekli hâli (YOLU, CADDESİ) GTFS'te de geçer; kısa ekliyse sade sayılır.
  const sade = kokleAra(ozgun, dusen, KOKLER, 2, (ek, n) => ek.length <= (n <= 3 ? 4 : 12));
  if (sade && (!ozelTam || ADIN_EKI.test(katla(sade.ekOzgun)))) {
    const kok = sade.aday.bicim;
    return { yazi: kucuk(kok) + uyumlaCoz(sade.ekOzgun, kok, dusen), tur: sade.aday.yer ? 'yer' : 'sade' };
  }
  // Yumuşayan kök: DURAĞI, SOKAĞI, DEĞİŞİKLİĞİ. Kısa köklerle (sok → SOĞANLIK) oynamıyoruz.
  for (let n = k.length - 1; n >= 4; n--) {
    const adaylar = KOKLER.get(k.slice(0, n - 1) + (k[n - 1] === 'G' ? 'K' : k[n - 1] === 'C' ? 'C' : k[n - 1] === 'D' ? 'T' : k[n - 1] === 'B' ? 'P' : '#'));
    if (!adaylar || !'AEIOU'.includes(k[n] ?? '')) continue;
    for (const a of adaylar) {
      if (a.tam || (ozelTam && !ADIN_EKI.test(k.slice(n)))) continue;
      const yumusak = yumusat(a.bicim);
      if (!yumusak || katla(yumusak) !== k.slice(0, n) || !uyar(yumusak, ozgun.slice(0, n), dusen)) continue;
      return { yazi: kucuk(yumusak) + uyumlaCoz(ozgun.slice(n), yumusak, dusen), tur: a.yer ? 'yer' : 'sade' };
    }
  }
  if (ozelTam) return { yazi: kucuk(ozelTam.bicim), tur: 'ozel' };

  // Özel ad + hâl eki: KADIKOYDEN → Kadıköy'den.
  const ozelEkli = kokleAra(ozgun, dusen, sozluk.ozel, 4, (ek) => HAL_EKI.test(ek));
  if (ozelEkli) {
    const kok = ozelEkli.aday.bicim;
    return { yazi: `${kucuk(kok)}'${uyumlaCoz(ozelEkli.ekOzgun, kok, dusen)}`, tur: 'ozel' };
  }
  return { yazi: uyumlaCoz(ozgun, null, dusen), tur: 'sade' };
}

/** Noktası cümle bitirmeyen kısaltmalar. */
const KISA_NOKTALI = new Set(['CAD', 'SOK', 'SK', 'MAH', 'BLV', 'BUL', 'KAV', 'DK', 'VB', 'NO', 'MEV', 'ORT', 'SN']);

const AYLAR = new Set('ocak şubat mart nisan mayıs haziran temmuz ağustos eylül ekim kasım aralık'.split(' '));

function basHarfBuyuk(s) {
  return s ? buyuk(s[0]) + s.slice(1) : s;
}

/** Metnin çoğu büyük harfse true: düzeltilmesi gereken metin. */
export function hepsiBuyukMu(metin) {
  const harfler = String(metin ?? '').match(/\p{L}/gu) ?? [];
  if (harfler.length < 4) return false;
  const kucukler = harfler.filter((h) => h !== buyuk(h)).length;
  return kucukler / harfler.length < 0.15;
}

/**
 * Duyuru metnini okunur yapar. Zaten küçük harfli yazılmış metne dokunmaz.
 * @param {string} metin
 * @param {ReturnType<typeof sozlukKur>} [sozluk]
 */
export function metniDuzelt(metin, sozluk = sozlukKur()) {
  const temiz = String(metin ?? '').replace(/\s+/g, ' ').trim();
  if (!hepsiBuyukMu(temiz)) return temiz;
  const dusen = dusenHarfler(temiz);

  // Parçalar: sözcükler ve aradaki her şey. Yol adları (E-5, D-100) önceden korunur.
  const parcalar = temiz.split(/([A-Za-zÇĞİIÖŞÜçğıöşüÂÎÛâîû]+)/);
  const sozcukSira = [];
  const cozulen = parcalar.map((p, i) => {
    if (i % 2 === 0) return { ara: p };
    const sonraki = parcalar[i + 1] ?? '';
    const onceki = parcalar[i - 1] ?? '';
    // E-5, D-100, O-3: tek harf + tire + sayı.
    if (p.length === 1 && /^-\s?\d/.test(sonraki)) return { yazi: buyuk(p), tur: 'kisaltma' };
    // Kesmeden sonra gelen ek: önceki sözcüğün ünlüsüne uyar.
    if (/'$/.test(onceki) && i >= 2) {
      const kok = parcalar[i - 1 - 1] ?? '';
      return { yazi: uyumlaCoz(p, kok, dusen), tur: 'ek' };
    }
    const c = sozcukCoz(p, dusen, sozluk);
    sozcukSira.push(i);
    return c;
  });

  // Birden çok sözcüklü durak adları: "YENİ MAHALLE" → hepsi özel.
  for (let a = 0; a < sozcukSira.length; a++) {
    for (let uz = Math.min(5, sozcukSira.length - a); uz >= 2; uz--) {
      const dilim = sozcukSira.slice(a, a + uz);
      // Arada yalnız boşluk ya da tire olmalı.
      const bitisik = dilim.every((idx, j) => j === 0 || /^[\s-]*$/.test(parcalar[idx - 1]));
      if (!bitisik) continue;
      const anahtar = dilim.map((idx) => katla(parcalar[idx])).join(' ');
      if (sozluk.adlar.has(anahtar)) {
        for (const idx of dilim) if (cozulen[idx].tur !== 'kisaltma') cozulen[idx].tur = 'ozel';
        a += uz - 1;
        break;
      }
    }
  }

  // Büyük harf: özel adlar; özel addan hemen sonra gelen yer türü (Bağdat Caddesi);
  // günü belli tarihte ay adı (29 Ekim).
  let oncekiOzel = false;
  let cikti = '';
  for (const c of cozulen) {
    if (!('ara' in c) && AYLAR.has(c.yazi) && /\d\s+$/.test(cikti)) c.tur = 'ozel';
    if ('ara' in c) {
      cikti += c.ara;
      if (/[^\s'-]/.test(c.ara)) oncekiOzel = false;
      continue;
    }
    let yazi = c.yazi;
    if (c.tur === 'ozel' || (c.tur === 'yer' && oncekiOzel)) {
      yazi = basHarfBuyuk(yazi);
      oncekiOzel = true;
    } else if (c.tur !== 'ek') {
      oncekiOzel = c.tur === 'kisaltma' && oncekiOzel;
    }
    cikti += yazi;
  }

  // Cümle başları: metnin başı ve . ! ? sonrası. "Cad." gibi kısaltmanın noktası sayılmaz.
  return cikti.replace(/(^|([\p{L}\d]*)([.!?])\s+)(\p{Ll})/gu, (hepsi, on, sozcuk, isaret, h) =>
    isaret === '.' && KISA_NOKTALI.has(katla(sozcuk)) ? hepsi : on + buyuk(h),
  );
}
