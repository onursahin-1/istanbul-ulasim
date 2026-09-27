// Turyol ve Dentur Avrasya'nın güncel vapur tarifelerini kendi sitelerinden indirir.
//
// Beslemedeki Turyol ve Dentur seferleri İBB'nin yıllardır güncellenmeyen verisinden:
// Dentur'un Üsküdar–Kabataş seferleri Beşiktaş'a gidiyor, kalkmış hatlar (Eminönü–Bebek,
// Avcılar–Adalar) duruyor, Adalar seferlerinin saatleri eski. Bu betik iki sitenin
// tarifesini okuyup tek bir JSON'a yazar; GTFS'e ozel-vapur-uygula.py işler.
//
// Turyol (turyol.com/Home/Tarifeler): kalkış iskelesi seçilince /Tarife/GetVarislar2
// varış iskelelerini veriyor, form gönderilince HAFTAİÇİ | CUMARTESİ | PAZAR sütunlu bir
// tabloda o iskeleden o varışa **kalkış** saatleri geliyor. Ara iskeleler ve varış
// saatleri yok; seferleri ozel-vapur-uygula.py kalkış saatlerini güzergâh boyunca
// zincirleyerek kuruyor. Kalkış seçeneklerinin önekindeki grup: 1 şehir hatları,
// 3 Adalar, 2 Çınarcık (Yalova; alınmıyor), 4 Boğaz turu (alınmıyor).
//
// Dentur (denturavrasya.com/tr-TR/hatlarimiz/…): her hat sayfasında tarife elle yazılmış
// bir HTML parçası, iframe'in srcdoc'unda. Sayfaların biçimi birbirinden farklı:
//   kalkis   "ÜSKÜDAR KALKIŞ" başlıklı, HAFTA İÇİ | CUMARTESİ | PAZAR sütunlu tablo; ara
//            satırda "16:00 - 18:30 Arası Sürekli Sefer". Üsküdar–Beşiktaş'ta satır başı
//            iskele, hücrede "06:10-00:45 arası sürekli sefer".
//   liste    gün türü başlığı altında saat listesi, iskele belirtilmeden (iki uçtan aynı
//            saatlerde kalkıyor).
//   durak    iskele sütunlu tablo ("BEŞİKTAŞ | KABATAŞ | SİRKECİ | HEYBELİADA | BÜYÜKADA"),
//            üstünde "HAFTA İÇİ GİDİŞ" gibi başlık; her satır bir sefer.
//   sirali   "Yalova Kalkış / 10:30 / Büyükada Varış / 11:45 …" alt alta; "Dönüş" başlığı
//            ikinci seferi başlatıyor.
// Biçim değişirse betik o hattı boş bulur ve hata verir: tahmin yürütmek yerine durur.
//
// Kullanım:
//   node ozel-vapur-indir.mjs C:\otp\ozel-vapur-tarife.json

import { writeFileSync } from 'node:fs';

const TURYOL = 'https://www.turyol.com';
const DENTUR = 'https://www.denturavrasya.com/tr-TR/hatlarimiz/';
const TURYOL_GRUPLARI = new Set(['1', '3']);

// Dentur'un şehir içi hatları. uclar: 'kalkis' ve 'liste' biçiminde seferin iki ucu.
export const DENTUR_HATLARI = [
  { sayfa: 'uskudar-kabatas', kod: 'ÜSK-KBT', bicim: 'kalkis', uclar: ['Üsküdar', 'Kabataş'] },
  { sayfa: 'uskudar-besiktas', kod: 'ÜSK-BŞK', bicim: 'kalkis', uclar: ['Üsküdar', 'Beşiktaş'] },
  { sayfa: 'besiktaskadikoy', kod: 'BŞK-KDK', bicim: 'liste', uclar: ['Beşiktaş', 'Kadıköy'] },
  { sayfa: 'adalar', kod: 'KBT-ADALAR', bicim: 'durak' },
  { sayfa: 'yalova-adalar', kod: 'YALOVA-ADALAR', bicim: 'sirali' },
];

const AKSAN = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };

export function sade(metin) {
  const k = (metin ?? '').replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
  return [...k].map((h) => AKSAN[h] ?? h).filter((h) => /[a-z0-9]/.test(h)).join('');
}

/** Gün türü başlığı → Pzt..Paz maskesi; tanınmazsa null. */
export function gunMaskesi(metin) {
  const s = sade(metin);
  if (s.includes('hergun')) return '1111111';
  if (s.includes('haftaicivecumartesi')) return '1111110';
  if (s.includes('haftaici')) return '1111100';
  if (s.includes('haftasonu')) return '0000011';
  if (s.includes('cumartesi')) return '0000010';
  if (s.includes('pazar')) return '0000001';
  return null;
}

const HTML_VARLIK = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function varlikCoz(metin) {
  return metin.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (tam, v) => {
    if (v[0] === '#') return String.fromCodePoint(v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : Number(v.slice(1)));
    return HTML_VARLIK[v.toLowerCase()] ?? tam;
  });
}

/** HTML parçası → satırlar; her satır hücre dizisi (tablo satırı, liste ögesi ya da blok). */
export function satirlar(html) {
  const duz = html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+/g, ' ') // kaynaktaki satır sonları anlamsız; satırları etiketler belirliyor
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<\/?(tr|li|div|p|h\d|ul|ol|table|thead|tbody|section|header|footer|article)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return varlikCoz(duz)
    .split('\n')
    .map((s) => s.replace(/[ \u00a0]+/g, ' ').replace(/\t ?$/, '')) // son </td>'nin sekmesi; boş hücreler kalsın
    .filter((s) => s.trim())
    .map((s) => s.split('\t').map((h) => h.trim()));
}

const SAAT = /^(\d{1,2})[:.](\d{2})$/;
const ARALIK = /(\d{1,2})[:.](\d{2})\s*-\s*(\d{1,2})[:.](\d{2})\s*aras[ıi]\s*s[üu]rekli/i;

function saatDuzelt(s, d) {
  return `${String(Number(s)).padStart(2, '0')}:${d}`;
}

export function saatMi(h) {
  const m = SAAT.exec(h.trim());
  return m ? saatDuzelt(m[1], m[2]) : null;
}

export function aralikMi(h) {
  const m = ARALIK.exec(h);
  return m ? [saatDuzelt(m[1], m[2]), saatDuzelt(m[3], m[4])] : null;
}

function kalkisEkle(liste, iskele, gunler) {
  let k = liste.find((x) => x.iskele === iskele && x.gunler === gunler);
  if (!k) liste.push((k = { iskele, gunler, saatler: [], araliklar: [] }));
  return k;
}

/** Yalnız büyük harfli kısa bir ad ("ÜSKÜDAR", "BÜYÜKADA"): tablo başlığındaki iskele. */
export function iskeleMi(metin) {
  return /^[A-ZÇĞİÖŞÜ .]{3,30}$/.test(metin.trim());
}

function iskeleAdi(metin) {
  const temiz = metin.replace(/\s*(kalk[ıi][şs]|var[ıi][şs])\s*$/i, '').trim();
  return temiz
    .split(/\s+/)
    .map((k) => k.slice(0, 1) + k.slice(1).replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase())
    .join(' ');
}

/** "ÜSKÜDAR KALKIŞ" + gün sütunları; ya da satır başı iskele + "… arası sürekli sefer". */
export function kalkisCoz(satirListesi) {
  const kalkislar = [];
  let iskele = null, sutunlar = null, bastaIskele = false, birikim = null;
  const isle = (bu, dizi) => {
    dizi.forEach((h, i) => {
      const saat = saatMi(h), aralik = aralikMi(h);
      if (saat) kalkisEkle(kalkislar, bu, sutunlar[i]).saatler.push(saat);
      else if (aralik) kalkisEkle(kalkislar, bu, sutunlar[i]).araliklar.push(aralik);
    });
  };
  for (const hucreler of satirListesi) {
    const gunler = hucreler.map(gunMaskesi);
    if (hucreler.length > 1 && gunler.filter(Boolean).length >= hucreler.length - 1 && gunler.some(Boolean)) {
      bastaIskele = !gunler[0];
      sutunlar = bastaIskele ? gunler.slice(1) : gunler;
      continue;
    }
    if (hucreler.length === 1 && sade(hucreler[0]).endsWith('kalkis')) {
      iskele = iskeleAdi(hucreler[0]);
      continue;
    }
    if (!sutunlar) continue;
    if (bastaIskele) {
      // Hücrelerin içi bloklu olunca (div) her hücre ayrı satıra düşüyor: satırı biriktir.
      if (hucreler.length === 1) {
        if (iskeleMi(hucreler[0])) birikim = [hucreler[0]];
        else if (birikim) birikim.push(hucreler[0]);
        if (birikim && birikim.length === sutunlar.length + 1) {
          isle(iskeleAdi(birikim[0]), birikim.slice(1));
          birikim = null;
        }
        continue;
      }
      if (hucreler.length === sutunlar.length + 1) isle(iskeleAdi(hucreler[0]), hucreler.slice(1));
      continue;
    }
    if (iskele && hucreler.length === sutunlar.length) isle(iskele, hucreler);
  }
  return kalkislar;
}

/** Gün türü başlığı altında tek sütun saat listesi; iki uçtan da aynı saatlerde. */
export function listeCoz(satirListesi, uclar) {
  const kalkislar = [];
  let gunler = null;
  for (const hucreler of satirListesi) {
    if (hucreler.length !== 1) continue;
    const saat = saatMi(hucreler[0]);
    if (!saat) {
      gunler = gunMaskesi(hucreler[0]) ?? gunler;
      continue;
    }
    if (!gunler) continue;
    for (const uc of uclar) kalkisEkle(kalkislar, uc, gunler).saatler.push(saat);
  }
  return kalkislar;
}

/** İskele sütunlu tablo: başlık satırı iskeleler, her saat satırı bir sefer. */
export function durakCoz(satirListesi) {
  const seferler = [];
  let gunler = null, iskeleler = null;
  for (const hucreler of satirListesi) {
    if (hucreler.length === 1) {
      const m = gunMaskesi(hucreler[0]);
      if (m && /gidis|donus/.test(sade(hucreler[0]))) gunler = m;
      continue;
    }
    const saatler = hucreler.map(saatMi);
    if (saatler.every((s) => !s) && hucreler.every(iskeleMi)) {
      iskeleler = hucreler.map(iskeleAdi);
      continue;
    }
    if (gunler && iskeleler && saatler.length === iskeleler.length && saatler.some(Boolean)) {
      seferler.push({ gunler, duraklar: iskeleler.map((isk, i) => [isk, saatler[i]]).filter(([, s]) => s) });
    }
  }
  return seferler;
}

/** "Yalova Kalkış", "10:30" … (ya da bitişik "Yalova Kalkış10:30"); "… Hareket Saatimiz" yeni sefer. */
export function siraliCoz(satirListesi) {
  const metin = sade(satirListesi.map((h) => h.join(' ')).join(' '));
  const gunler = metin.includes('haftasonu') ? '0000011' : '1111111';
  const seferler = [];
  let sefer = null, bekleyen = null;
  for (const hucreler of satirListesi) {
    const h = hucreler.join(' ').trim();
    if (sade(h).includes('hareketsaat')) {
      sefer = { gunler, duraklar: [] };
      seferler.push(sefer);
      bekleyen = null;
      continue;
    }
    if (!sefer) continue;
    const bitisik = /^(.{2,30}?)\s*(kalk[ıi][şs]|var[ıi][şs])\s*(\d{1,2}[:.]\d{2})$/i.exec(h);
    const saat = saatMi(h);
    if (bitisik) {
      sefer.duraklar.push([iskeleAdi(bitisik[1]), saatMi(bitisik[3])]);
      bekleyen = null;
    } else if (saat && bekleyen) {
      sefer.duraklar.push([bekleyen, saat]);
      bekleyen = null;
    } else if (/(kalkis|varis)$/.test(sade(h)) && h.length < 40) {
      bekleyen = iskeleAdi(h);
    } else if (!saat) {
      bekleyen = null;
    }
  }
  return seferler.filter((s) => s.duraklar.length >= 2);
}

export function srcdocBul(sayfa) {
  const m = /srcdoc="([^"]*)"/i.exec(sayfa);
  return m ? varlikCoz(m[1]) : null;
}

export function denturCoz(hat, srcdoc) {
  const liste = satirlar(srcdoc);
  const baslik = liste.slice(0, 3).map((h) => h.join(' ')).find((s) => /tarife|ge[çc]erli/i.test(s)) ?? null;
  const gecerlilik = liste.map((h) => h.join(' ')).find((s) => /itibar[ıi]yla|ge[çc]erlidir/i.test(s)) ?? null;
  const sonuc = { ...hat, baslik, gecerlilik };
  if (hat.bicim === 'kalkis') sonuc.kalkislar = kalkisCoz(liste);
  else if (hat.bicim === 'liste') sonuc.kalkislar = listeCoz(liste, hat.uclar);
  else if (hat.bicim === 'durak') sonuc.seferler = durakCoz(liste);
  else if (hat.bicim === 'sirali') sonuc.seferler = siraliCoz(liste);
  const sayi = (sonuc.kalkislar ?? []).reduce((t, k) => t + k.saatler.length + k.araliklar.length, 0) + (sonuc.seferler ?? []).length;
  return { ...sonuc, sayi };
}

async function getir(url, secenek = {}, deneme = 3) {
  for (let i = 1; ; i++) {
    try {
      const yanit = await fetch(url, { ...secenek, headers: { 'User-Agent': 'Mozilla/5.0 (istanbul-ulasim veri betigi)', ...(secenek.headers ?? {}) } });
      if (!yanit.ok) throw new Error(`HTTP ${yanit.status}`);
      return yanit;
    } catch (hata) {
      if (i >= deneme) throw new Error(`${url}: ${hata.message}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
}

// ---------- Turyol ----------

export function turyolKalkislari(sayfa) {
  const secim = /<select[^>]*id="TarifeKalkisId"[\s\S]*?<\/select>/i.exec(sayfa)?.[0] ?? '';
  return [...secim.matchAll(/<option[^>]*value="([^"]+)"[^>]*>([^<]*)</gi)]
    .map(([, deger, ad]) => ({ deger, ad: varlikCoz(ad).replace(/\s*İskele\s*$/i, '').trim(), grup: deger.split('_')[0] }))
    .filter((k) => /^\d+_\d+_\d+_\d+$/.test(k.deger));
}

/** Tarife sayfasının tablosu → { gunler: { '1111100': [...], '0000010': [...], '0000001': [...] }, notlar }. */
export function turyolTablosu(sayfa) {
  const tablo = /<table[^>]*id="datatable-responsive"[\s\S]*?<\/table>/i.exec(sayfa)?.[0];
  if (!tablo) return null;
  const liste = satirlar(tablo);
  const baslik = liste.find((h) => h.length > 1 && h.every((x) => gunMaskesi(x)));
  if (!baslik) return null;
  const sutunlar = baslik.map(gunMaskesi);
  const gunler = Object.fromEntries(sutunlar.map((m) => [m, []]));
  const notlar = [];
  for (const hucreler of liste) {
    if (hucreler === baslik) continue;
    hucreler.forEach((h, i) => {
      const saat = saatMi(h);
      if (saat && hucreler.length === sutunlar.length) gunler[sutunlar[i]].push(saat);
      else if (h && h !== '-') notlar.push(h);
    });
  }
  return { gunler, notlar };
}

async function turyolIndir() {
  const ana = await (await getir(`${TURYOL}/Home/Tarifeler`)).text();
  const kalkislar = turyolKalkislari(ana).filter((k) => TURYOL_GRUPLARI.has(k.grup));
  if (!kalkislar.length) throw new Error('Turyol: kalkış iskelesi listesi bulunamadı (sayfa biçimi değişmiş olabilir).');
  const ciftler = [];
  for (const k of kalkislar) {
    const [, hatTuru, , kalkisId] = k.deger.split('_');
    const varislar = await (
      await getir(`${TURYOL}/Tarife/GetVarislar2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: `{'hatTuruId':'${hatTuru}','kalkisId':'${kalkisId}','langId':'1'}`,
      })
    ).json();
    for (const v of varislar.filter((x) => x.Key)) {
      const govde = new URLSearchParams({ MainHatTuruId: k.grup, TarifeKalkisId: k.deger, TarifeVarisId: String(v.Key) });
      const sayfa = await (await getir(`${TURYOL}/Home/Tarifeler`, { method: 'POST', body: govde })).text();
      const tablo = turyolTablosu(sayfa);
      const varis = String(v.Value).replace(/\s*İskele\s*$/i, '').trim();
      if (!tablo) {
        console.log(`  Turyol ${k.ad} → ${varis}: tarife yok, atlandı`);
        continue;
      }
      const { gunler, notlar } = tablo;
      ciftler.push({ grup: k.grup, kalkis: k.ad, varis, gunler, ...(notlar.length ? { notlar } : {}) });
      if (notlar.length) console.log(`    not: ${notlar.join(' | ')}`);
      const sayilar = Object.values(gunler).map((s) => s.length).join('/');
      console.log(`  Turyol ${k.grup === '3' ? 'Adalar' : 'şehir'} ${k.ad} → ${varis}: ${sayilar}`);
    }
  }
  return ciftler;
}

async function denturIndir() {
  const hatlar = [];
  for (const hat of DENTUR_HATLARI) {
    const sayfa = await (await getir(DENTUR + hat.sayfa)).text();
    const srcdoc = srcdocBul(sayfa);
    if (!srcdoc) throw new Error(`Dentur ${hat.sayfa}: sayfada tarife parçası (iframe srcdoc) yok; biçim değişmiş olabilir.`);
    const sonuc = denturCoz(hat, srcdoc);
    if (!sonuc.sayi) throw new Error(`Dentur ${hat.sayfa}: tarifede saat bulunamadı; biçim değişmiş olabilir (beklenen: ${hat.bicim}).`);
    console.log(`  Dentur ${hat.kod}: ${sonuc.sayi} ${sonuc.seferler ? 'sefer' : 'kalkış/aralık'}${sonuc.gecerlilik ? ` (${sonuc.gecerlilik})` : ''}`);
    hatlar.push({ ...sonuc, adres: DENTUR + hat.sayfa });
  }
  return hatlar;
}

async function main() {
  const cikti = process.argv[2];
  if (!cikti) {
    console.error('kullanım: node ozel-vapur-indir.mjs <çıktı.json>');
    process.exit(2);
  }
  console.log('Turyol tarifesi indiriliyor…');
  const turyol = await turyolIndir();
  console.log('Dentur Avrasya tarifesi indiriliyor…');
  const dentur = await denturIndir();
  writeFileSync(cikti, JSON.stringify({ indirildi: new Date().toISOString(), turyol, dentur }, null, 1));
  console.log(`\n${turyol.length} Turyol iskele çifti, ${dentur.length} Dentur hattı → ${cikti}`);
}

// Doğrudan çalıştırılınca indir; içe aktarılınca (test) yalnız çözümleyiciler.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main().catch((hata) => {
    console.error(hata.message);
    process.exit(1);
  });
}
