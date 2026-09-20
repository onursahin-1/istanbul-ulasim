// hazirla-gtfs.mjs
// İBB Açık Veri Portalı'ndaki GTFS verilerini (ayrı CSV dosyaları) indirir,
// GTFS standardına (virgül ayraçlı, UTF-8 .txt dosyaları) çevirir, bilinen veri
// hatalarını onarır ve OpenTripPlanner'ın okuyabileceği zip dosyaları hâline getirir.
//
// İki ayrı besleme hazırlanır:
//   1) İETT: otobüs ve Metrobüs (düzenli güncelleniyor)
//   2) Raylı sistemler ve vapur: metro, Marmaray, tramvay, füniküler, vapur
//      (İBB bu veriyi artık güncellemiyor; takvimi güncel döneme kaydırılır)
//
// Kullanım (PowerShell):
//   node hazirla-gtfs.mjs C:\otp\istanbul
//
// Gereksinim: Node.js 20+ ve Windows 10/11 (zip işlemleri için Windows'la gelen tar.exe kullanılır).

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, open, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const IETT_TABAN = 'https://data.ibb.gov.tr/dataset/8540e256-6df5-4719-85bc-e64e91508ede/resource';
const RAY_TABAN = 'https://data.ibb.gov.tr/dataset/121a9892-7945-419a-9b89-49f6083926df/resource';

const BESLEMELER = [
  {
    kod: 'iett',
    ad: 'İETT otobüs ve Metrobüs',
    zip: 'istanbul-iett-gtfs.zip',
    takvimiKaydir: false,
    kaynaklar: [
      { ad: 'agency', url: `${IETT_TABAN}/df13606d-194b-4587-b868-39ecdc5f8769/download/agency.csv` },
      { ad: 'calendar', url: `${IETT_TABAN}/6c9623b1-3858-4b37-b936-8ffa78de2a69/download/calendar.csv` },
      { ad: 'routes', url: `${IETT_TABAN}/46dbe388-c8c2-45c4-ac72-c06953de56a2/download/routes.csv` },
      { ad: 'stops', url: `${IETT_TABAN}/2299bc82-983b-4bdf-8520-5cef8c555e29/download/stops.csv` },
      { ad: 'trips', url: `${IETT_TABAN}/7ff49bdd-b0d2-4a6e-9392-b598f77f5070/download/trips.csv` },
      // stop_times çok büyük olduğu için sıkıştırılmış sürümü indirilir.
      { ad: 'stop_times', url: `${IETT_TABAN}/80401c1c-c240-4a32-8f40-ef697100a681/download/stop_times.zip` },
    ],
  },
  {
    kod: 'ray',
    ad: 'Metro, Marmaray, tramvay ve vapur',
    zip: 'istanbul-ray-vapur-gtfs.zip',
    takvimiKaydir: true,
    kaynaklar: [
      { ad: 'agency', url: `${RAY_TABAN}/42ae499d-ae9c-4906-ac5c-96e0c155e00b/download/agency.csv` },
      { ad: 'calendar', url: `${RAY_TABAN}/c84ca913-29ac-4f15-87cd-076aef3dccd6/download/calendar.csv` },
      { ad: 'frequencies', url: `${RAY_TABAN}/a4c86ce6-64da-41e2-9584-5d83b5fb895c/download/frequencies.csv` },
      { ad: 'routes', url: `${RAY_TABAN}/36b554c7-cae0-4b7e-978f-fc6a43664e88/download/routes.csv` },
      { ad: 'shapes', url: `${RAY_TABAN}/83317085-aa56-41b0-9447-ea579567f2cb/download/shapes.csv` },
      { ad: 'stop_times', url: `${RAY_TABAN}/ac646b83-3b6f-4ca2-afb4-9071ab44d9af/download/stop_times.csv` },
      { ad: 'stops', url: `${RAY_TABAN}/d1f7c258-bbc1-406f-9ab2-7a7c1797c673/download/stops.csv` },
      { ad: 'trips', url: `${RAY_TABAN}/dcee1700-e59f-4a5f-8009-f602045a4507/download/trips.csv` },
    ],
  },
];
const ZORUNLU = ['agency', 'stops', 'routes', 'trips', 'stop_times', 'calendar'];

const HEDEF = path.resolve(process.argv[2] ?? 'C:\\otp\\istanbul');
const GECICI = path.join(HEDEF, '_gtfs_gecici');

// ---------- Yardımcılar ----------

function log(mesaj) {
  console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ${mesaj}`);
}

async function indir(url, dosyaYolu) {
  const yanit = await fetch(url, { redirect: 'follow' });
  if (!yanit.ok) throw new Error(`İndirilemedi (${yanit.status}): ${url}`);
  const yazici = createWriteStream(dosyaYolu);
  for await (const parca of yanit.body) {
    if (!yazici.write(parca)) await new Promise((r) => yazici.once('drain', r));
  }
  await new Promise((r, h) => yazici.end((e) => (e ? h(e) : r())));
  const { size } = await stat(dosyaYolu);
  log(`  indirildi: ${path.basename(dosyaYolu)} (${(size / 1048576).toFixed(1)} MB)`);
}

async function dosyalariBul(klasor) {
  const sonuc = [];
  for (const g of await readdir(klasor, { withFileTypes: true })) {
    const tam = path.join(klasor, g.name);
    if (g.isDirectory()) sonuc.push(...(await dosyalariBul(tam)));
    else sonuc.push(tam);
  }
  return sonuc;
}

// Dosyanın ilk 1 MB'ına bakarak karakter kodlamasını tahmin eder.
// Geçerli UTF-8 değilse Türkçe Windows kodlaması (windows-1254) kabul edilir.
async function kodlamaBul(dosyaYolu) {
  const fh = await open(dosyaYolu, 'r');
  try {
    const tampon = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await fh.read(tampon, 0, tampon.length, 0);
    let ornek = tampon.subarray(0, bytesRead);
    // Örneğin sonunda yarım kalmış çok baytlı bir karakter olabilir; son 4 baytı at.
    if (bytesRead === tampon.length) ornek = ornek.subarray(0, bytesRead - 4);
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(ornek);
      return 'utf-8';
    } catch {
      return 'windows-1254';
    }
  } finally {
    await fh.close();
  }
}

// İlk satırdaki ayraç sayılarına bakarak ayraç karakterini bulur.
function ayracBul(ilkSatir) {
  const adaylar = [',', ';', '\t', '|'];
  let enIyi = ',';
  let enCok = -1;
  for (const a of adaylar) {
    const sayi = ilkSatir.split(a).length - 1;
    if (sayi > enCok) { enCok = sayi; enIyi = a; }
  }
  return enIyi;
}

/** Tek bir CSV satırını sütunlara ayırır (tırnak içindeki ayraçlar bölme yapmaz). */
function satirAyristir(metin, ayrac) {
  const satir = [];
  let alan = '';
  let tirnak = false;
  for (let i = 0; i < metin.length; i++) {
    const c = metin[i];
    if (tirnak) {
      if (c === '"') { if (metin[i + 1] === '"') { alan += '"'; i++; } else tirnak = false; }
      else alan += c;
    } else if (c === '"' && alan === '') tirnak = true;
    else if (c === ayrac) { satir.push(alan); alan = ''; }
    else alan += c;
  }
  satir.push(alan);
  return satir;
}

function alanYaz(deger) {
  if (/[",\r\n]/.test(deger)) return `"${deger.replace(/"/g, '""')}"`;
  return deger;
}

// Akış hâlinde (dosyanın tamamını belleğe almadan) CSV okuyup GTFS .txt yazar.
async function donustur(girdi, cikti, gtfsAdi) {
  const kodlama = await kodlamaBul(girdi);
  const cozucu = new TextDecoder(kodlama);
  const yazici = createWriteStream(cikti, { encoding: 'utf-8' });

  let ayrac = null;
  let basliklar = null;
  let alan = '';
  let satir = [];
  let tirnakIcinde = false;
  let tirnakSonrasi = false;
  let bekleyenCR = false;
  let ilkParca = true;
  let satirSayisi = 0;
  let icIceSatir = 0;
  const bitisSutunu = { index: -1, enKucuk: null, enBuyuk: null };
  let tampon = '';
  let koordinatSutunlari = [];

  const satirBitir = async () => {
    satir.push(alan);
    alan = '';
    const bos = satir.length === 1 && satir[0].trim() === '';
    // Kaynakta bazı satırlar bütünüyle tırnak içine alınmış; bunlar tek bir alan gibi okunur.
    // Alanın içinde ayraç varsa satır bir kez daha çözülerek sütunlarına ayrılır.
    if (!bos && basliklar && satir.length === 1 && basliklar.length > 1 && satir[0].includes(ayrac)) {
      satir = satirAyristir(satir[0], ayrac);
      icIceSatir++;
    }
    if (!bos) {
      if (!basliklar) {
        basliklar = satir.map((b) => b.trim().toLowerCase());
        satir = basliklar;
        if (gtfsAdi === 'calendar') bitisSutunu.index = basliklar.indexOf('end_date');
        koordinatSutunlari = basliklar
          .map((b, i) => (/(^|_)(lat|lon)$/.test(b) ? i : -1))
          .filter((i) => i >= 0);
      } else {
        satirSayisi++;
        // Noktalı virgül ayraçlı Türkçe dosyalarda koordinatlar "41,06" gibi virgüllü olabilir.
        for (const i of koordinatSutunlari) {
          if (/^-?\d+,\d+$/.test((satir[i] ?? '').trim())) satir[i] = satir[i].trim().replace(',', '.');
        }
        if (bitisSutunu.index >= 0) {
          const d = (satir[bitisSutunu.index] ?? '').trim();
          if (/^\d{8}$/.test(d)) {
            if (!bitisSutunu.enKucuk || d < bitisSutunu.enKucuk) bitisSutunu.enKucuk = d;
            if (!bitisSutunu.enBuyuk || d > bitisSutunu.enBuyuk) bitisSutunu.enBuyuk = d;
          }
        }
      }
      tampon += satir.map(alanYaz).join(',') + '\n';
      if (tampon.length > 1 << 20) {
        if (!yazici.write(tampon)) await new Promise((r) => yazici.once('drain', r));
        tampon = '';
      }
    }
    satir = [];
  };

  const okuyucu = createReadStream(girdi);
  for await (const bayt of okuyucu) {
    let metin = cozucu.decode(bayt, { stream: true });
    if (ilkParca) {
      if (metin.charCodeAt(0) === 0xfeff) metin = metin.slice(1); // BOM temizliği
      const ilkSatirSonu = metin.search(/\r|\n/);
      ayrac = ayracBul(ilkSatirSonu === -1 ? metin : metin.slice(0, ilkSatirSonu));
      ilkParca = false;
    }
    for (let i = 0; i < metin.length; i++) {
      const c = metin[i];
      if (bekleyenCR) {
        bekleyenCR = false;
        if (c === '\n') continue;
      }
      if (tirnakIcinde) {
        if (c === '"') { tirnakIcinde = false; tirnakSonrasi = true; }
        else alan += c;
        continue;
      }
      if (tirnakSonrasi && c === '"') { alan += '"'; tirnakIcinde = true; tirnakSonrasi = false; continue; }
      tirnakSonrasi = false;
      if (c === '"' && alan.trim() === '') { alan = ''; tirnakIcinde = true; }
      else if (c === ayrac) { satir.push(alan); alan = ''; }
      else if (c === '\n') await satirBitir();
      else if (c === '\r') { bekleyenCR = true; await satirBitir(); }
      else alan += c;
    }
  }
  const kalan = cozucu.decode();
  if (kalan) alan += kalan;
  if (alan !== '' || satir.length > 0) await satirBitir();
  yazici.write(tampon);
  await new Promise((r, h) => yazici.end((e) => (e ? h(e) : r())));

  const ayracAdi = { ',': 'virgül', ';': 'noktalı virgül', '\t': 'sekme', '|': 'dikey çizgi' }[ayrac];
  log(
    `  ${gtfsAdi}.txt: ${satirSayisi.toLocaleString('tr-TR')} satır (kodlama: ${kodlama}, ayraç: ${ayracAdi})` +
      (icIceSatir ? `, ${icIceSatir} satır tırnak içinden çıkarıldı` : ''),
  );
  return { satirSayisi, basliklar, bitisSutunu };
}

function tarihYaz(d) {
  return `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}`;
}


// ---------- İETT verisine özel onarımlar ----------
// İBB'nin yayımladığı dosyalarda bilinen üç sorun var:
//  1) stops: koordinatlar Excel'den geçerken bozulmuş ("41.0191700005564" -> "410.191.700.005.564"),
//     birkaç satır kaymış ve bazılarının koordinatı kurtarılamayacak biçimde ("4,10E+14").
//  2) routes: Türkçe karakterler iki kez kodlanmış ("KADIKÖY" -> "KADIKÃ–Y"), boş ve tekrar eden satırlar var.
//  3) Dosya sonlarında başlığı boş fazladan sütunlar var.

import { readFile as dosyaOku, writeFile as dosyaYaz } from 'node:fs/promises';
import readline from 'node:readline';

function csvCoz(metin) {
  const satirlar = [];
  let satir = [];
  let alan = '';
  let tirnak = false;
  for (let i = 0; i < metin.length; i++) {
    const c = metin[i];
    if (tirnak) {
      if (c === '"') {
        if (metin[i + 1] === '"') { alan += '"'; i++; } else tirnak = false;
      } else alan += c;
    } else if (c === '"') tirnak = true;
    else if (c === ',') { satir.push(alan); alan = ''; }
    else if (c === '\n') { satir.push(alan); satirlar.push(satir); satir = []; alan = ''; }
    else if (c !== '\r') alan += c;
  }
  if (alan !== '' || satir.length) { satir.push(alan); satirlar.push(satir); }
  return satirlar;
}

function csvYaz(satirlar) {
  return satirlar.map((s) => s.map((a) => alanYaz(String(a ?? ''))).join(',')).join('\n') + '\n';
}

function bosSutunlariAt(satirlar) {
  const baslik = satirlar[0];
  while (baslik.length && baslik[baslik.length - 1].trim() === '') {
    const i = baslik.length - 1;
    for (const s of satirlar) if (s.length > i) s.splice(i, 1);
  }
  for (const s of satirlar.slice(1)) while (s.length < baslik.length) s.push('');
  return satirlar;
}

const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function mojibakeDuzelt(metin) {
  if (!/[ÃÄÅ]/.test(metin)) return metin;
  const baytlar = [];
  for (const ch of metin) {
    const kod = ch.codePointAt(0);
    if (kod < 0x100) baytlar.push(kod);
    else if (CP1252[ch] !== undefined) baytlar.push(CP1252[ch]);
    else return metin;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(baytlar));
  } catch {
    return metin;
  }
}

function koordinatCoz(deger, enAz, enCok) {
  const v = (deger ?? '').trim();
  let n = null;
  if (/^\d{1,3}(\.\d{3})+$/.test(v)) {
    // Excel'in binlik ayracı eklediği değer: İstanbul'da enlem ve boylamın tam kısmı iki basamaklıdır.
    const rakamlar = v.replace(/\./g, '');
    n = Number(rakamlar.slice(0, 2) + '.' + rakamlar.slice(2));
  } else {
    const m = v.match(/^-?\d{1,3}[.,]\d+/);
    if (m) n = Number(m[0].replace(',', '.'));
  }
  return n !== null && Number.isFinite(n) && n >= enAz && n <= enCok ? n : null;
}

/** agency.txt içindeki işletmecileri okur: [{ id: "METRO", ad: "Metro Istanbul" }, ...] */
async function ajanslariOku(klasor) {
  try {
    const satirlar = bosSutunlariAt(csvCoz(await dosyaOku(path.join(klasor, 'agency.txt'), 'utf-8')));
    const iId = satirlar[0].indexOf('agency_id');
    const iAd = satirlar[0].indexOf('agency_name');
    if (iId < 0) return [];
    return satirlar
      .slice(1)
      .map((r) => ({ id: (r[iId] ?? '').trim(), ad: (r[iAd] ?? '').trim() }))
      .filter((a) => a.id);
  } catch {
    return [];
  }
}

// GTFS'in tanıdığı araç tipleri. (5: tarihi tramvay, 6: teleferik, 7: füniküler)
const GECERLI_TURLER = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '11', '12']);

/**
 * Araç türünü işletmeciden belirler. İBB verisindeki tür kodları güvenilir değil:
 * minibüs hatlarının bir kısmı vapur (4), bir kısmı metro (1) olarak işaretlenmiş.
 * İşletmeci ise kesin bilgi: Şehir Hatları vapur işletir, Metro İstanbul raylı sistem.
 * Karar verilemeyen hatlar için null döner.
 */
function ajanstanTur(ajansAdi, kisaAd) {
  const ajans = trKucukGuvenli(ajansAdi ?? '');
  if (!ajans) return null;
  if (/(şehir ?hatları|sehir ?hatlari|ido|turyol|dentur|deniz ?otobüs|deniz ?otobus|mavi marmara)/.test(ajans)) return '4';
  if (/(tcdd|marmaray|banliyö|banliyo)/.test(ajans)) return '2';
  if (/(iett|İett|otobüs|otobus|minibus|minibüs|dolmus|dolmuş|taksi|halk otobüs)/.test(ajans)) return '3';
  // Metro İstanbul hem metro hem tramvay, füniküler ve teleferik işletir; hat kodu ayırır.
  if (/(metro ?istanbul|metro ?İstanbul|ulaşım a\.ş)/.test(ajans)) return koddanTur(kisaAd);
  return null;
}

/** "M4" → metro, "T1" → tramvay, "F1" → füniküler, "TF2" → teleferik. */
function koddanTur(kisaAd) {
  const kod = (kisaAd ?? '').trim();
  if (/^TF\s?\d/i.test(kod)) return '6';
  if (/^F\s?\d/i.test(kod)) return '7';
  if (/^T\s?\d/i.test(kod)) return '0';
  if (/^M\d/i.test(kod)) return '1';
  if (/^marmaray/i.test(kod)) return '2';
  return null;
}

/**
 * İşletmeciden karar çıkmadığında son çare. Yalnızca hat kodunu ve işletmeci adındaki
 * anahtar kelimeleri kullanır; hat adının içindeki "METRO" gibi kelimelere bakmaz,
 * çünkü "BEŞİKTAŞ - ETİLER METRO" bir minibüs hattıdır.
 */
function turTahminEt(ajansAdi, kisaAd) {
  return ajanstanTur(ajansAdi, kisaAd) ?? koddanTur(kisaAd) ?? '3';
}

function trKucukGuvenli(metin) {
  return metin.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

async function hatlariOnar(dosya, ajanslar) {
  const satirlar = bosSutunlariAt(csvCoz(await dosyaOku(dosya, 'utf-8')));
  const b = satirlar[0];
  const iId = b.indexOf('route_id');
  const iTur = b.indexOf('route_type');
  const iAjans = b.indexOf('agency_id');
  const iKisaAd = b.indexOf('route_short_name');
  const iUzunAd = b.indexOf('route_long_name');
  const gorulen = new Set();
  const sonuc = [b];
  let atilan = 0, turDuzeltilen = 0, ajansiDegisen = 0, adiEksik = 0;
  const turSayaci = new Map();
  for (const s of satirlar.slice(1)) {
    const id = (s[iId] ?? '').trim();
    if (!id || gorulen.has(id)) { atilan++; continue; }
    gorulen.add(id);
    const yeni = s.map(mojibakeDuzelt);
    // Adı olmayan hat, rota motorunu çökertir: en azından bir ad garanti edilir.
    if (iKisaAd >= 0 && !(yeni[iKisaAd] ?? '').trim()) {
      yeni[iKisaAd] = (yeni[iUzunAd] ?? '').trim().slice(0, 20) || id;
      adiEksik++;
    }
    if (iUzunAd >= 0 && !(yeni[iUzunAd] ?? '').trim()) yeni[iUzunAd] = (yeni[iKisaAd] ?? '').trim() || id;

    const tur = (yeni[iTur] ?? '').trim();
    const ajansAdi = ajanslar.find((a) => a.id === (yeni[iAjans] ?? '').trim())?.ad ?? '';
    const gecerli = GECERLI_TURLER.has(tur) || (Number(tur) >= 100 && Number(tur) <= 1799);
    // İşletmeciden kesin bir tür çıkıyorsa, dosyadaki kod geçerli olsa bile o kullanılır:
    // kaynak veride minibüs hatları vapur ya da metro olarak işaretlenmiş durumda.
    const kesinTur = ajanstanTur(ajansAdi, yeni[iKisaAd]);
    if (kesinTur && kesinTur !== tur) {
      yeni[iTur] = kesinTur;
      turDuzeltilen++;
      turSayaci.set(`${tur || '(boş)'}→${kesinTur}`, (turSayaci.get(`${tur || '(boş)'}→${kesinTur}`) ?? 0) + 1);
    } else if (!kesinTur && !gecerli) {
      yeni[iTur] = turTahminEt(ajansAdi, yeni[iKisaAd]);
      turDuzeltilen++;
      turSayaci.set(`${tur || '(boş)'}→${yeni[iTur]}`, (turSayaci.get(`${tur || '(boş)'}→${yeni[iTur]}`) ?? 0) + 1);
    }
    // Boş ya da tanınmayan işletmeci kimliği, dosyadaki ilk işletmeciye bağlanır;
    // aksi hâlde rota motoru "could not find Agency" hatasıyla durur.
    if (iAjans >= 0 && ajanslar.length) {
      const mevcut = (yeni[iAjans] ?? '').trim();
      if (!mevcut || !ajanslar.some((a) => a.id === mevcut)) {
        if (mevcut) ajansiDegisen++;
        yeni[iAjans] = ajanslar[0].id;
      }
    }
    sonuc.push(yeni);
  }
  await dosyaYaz(dosya, csvYaz(sonuc), 'utf-8');
  const turOzeti = [...turSayaci.entries()].map(([t, n]) => `${t}: ${n}`).join(', ');
  log(
    `  routes: ${sonuc.length - 1} hat, ${atilan} bozuk/tekrarlı satır atıldı` +
      (turDuzeltilen ? `, ${turDuzeltilen} hattın araç türü düzeltildi (${turOzeti})` : '') +
      (adiEksik ? `, ${adiEksik} hattın adı tamamlandı` : '') +
      (ajansiDegisen ? `, ${ajansiDegisen} hattın işletmecisi ${ajanslar[0].ad || ajanslar[0].id} olarak düzeltildi` : ''),
  );
}

async function duraklariOnar(duraklarDosyasi, seferSaatleriDosyasi) {
  const satirlar = bosSutunlariAt(csvCoz(await dosyaOku(duraklarDosyasi, 'utf-8')));
  const b = satirlar[0];
  const i = Object.fromEntries(['stop_id', 'stop_name', 'stop_desc', 'stop_lat', 'stop_lon', 'location_type'].map((a) => [a, b.indexOf(a)]));
  const konum = new Map();
  const bozuk = new Set();
  let kayan = 0;
  for (const s of satirlar.slice(1)) {
    if ((s[i.stop_lat] ?? '').trim().startsWith('direction:')) {
      // Satır bir sütun kaymış: açıklama enlem sütununa düşmüş, koordinatlar kurtarılamıyor.
      kayan++;
      const ekAd = (s[i.stop_desc] ?? '').trim();
      if (ekAd) s[i.stop_name] = `${s[i.stop_name].trim()} - ${ekAd}`;
      s[i.stop_desc] = s[i.stop_lat].trim();
      s[i.stop_lat] = '';
      s[i.stop_lon] = '';
    }
    const lat = koordinatCoz(s[i.stop_lat], 40.5, 41.8);
    const lon = koordinatCoz(s[i.stop_lon], 27.5, 30.5);
    if (i.location_type >= 0 && !/^[0-4]?$/.test((s[i.location_type] ?? '').trim())) s[i.location_type] = '0';
    const id = s[i.stop_id].trim();
    if (lat === null || lon === null) {
      bozuk.add(id);
      s[i.stop_lat] = '';
      s[i.stop_lon] = '';
    } else {
      s[i.stop_lat] = lat.toFixed(7);
      s[i.stop_lon] = lon.toFixed(7);
      konum.set(id, [lat, lon]);
    }
  }

  // Koordinatı kurtarılamayan duraklar için, aynı seferde önceki ve sonraki durakların ortası kullanılır.
  const adaylar = new Map([...bozuk].map((id) => [id, []]));
  if (bozuk.size) {
    const okuyucu = readline.createInterface({ input: createReadStream(seferSaatleriDosyasi, { encoding: 'utf-8' }), crlfDelay: Infinity });
    let baslik = null, iTrip = -1, iStop = -1, iSira = -1;
    let seferId = null;
    let tampon = [];
    const seferiIsle = () => {
      if (!tampon.some(([, d]) => bozuk.has(d))) return;
      tampon.sort((a, b2) => a[0] - b2[0]);
      tampon.forEach(([, d], k) => {
        if (!bozuk.has(d) || adaylar.get(d).length >= 20) return;
        let once = null, sonra = null;
        for (let j = k - 1; j >= 0 && !once; j--) once = konum.get(tampon[j][1]) ?? null;
        for (let j = k + 1; j < tampon.length && !sonra; j++) sonra = konum.get(tampon[j][1]) ?? null;
        if (once && sonra) adaylar.get(d).push([(once[0] + sonra[0]) / 2, (once[1] + sonra[1]) / 2]);
        else if (once || sonra) adaylar.get(d).push(once ?? sonra);
      });
    };
    for await (const satir of okuyucu) {
      const p = satir.split(',');
      if (!baslik) { baslik = p; iTrip = p.indexOf('trip_id'); iStop = p.indexOf('stop_id'); iSira = p.indexOf('stop_sequence'); continue; }
      if (p[iTrip] !== seferId) { seferiIsle(); seferId = p[iTrip]; tampon = []; }
      tampon.push([Number(p[iSira]), p[iStop]]);
    }
    seferiIsle();
  }

  const cikti = [b];
  let tahmin = 0;
  const bulunamayan = [];
  for (const s of satirlar.slice(1)) {
    const id = s[i.stop_id].trim();
    if (bozuk.has(id)) {
      const a = adaylar.get(id);
      if (!a.length) { bulunamayan.push(id); continue; }
      s[i.stop_lat] = (a.reduce((t, x) => t + x[0], 0) / a.length).toFixed(7);
      s[i.stop_lon] = (a.reduce((t, x) => t + x[1], 0) / a.length).toFixed(7);
      tahmin++;
    }
    cikti.push(s);
  }
  await dosyaYaz(duraklarDosyasi, csvYaz(cikti), 'utf-8');
  log(`  stops: ${cikti.length - 1} durak, ${kayan} kaymış satır düzeltildi, ${tahmin} durağın konumu komşu duraklardan tahmin edildi`);
  if (bulunamayan.length) log(`  UYARI: ${bulunamayan.length} durağın konumu bulunamadı ve çıkarıldı: ${bulunamayan.join(', ')}`);
}


/** "20230109" → Date (UTC) */
function tariheCevir(metin) {
  return new Date(Date.UTC(+metin.slice(0, 4), +metin.slice(4, 6) - 1, +metin.slice(6, 8)));
}

function tarihMetni(tarih) {
  return tarih.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * İBB'nin raylı sistem ve vapur verisinde sefer takvimi 2021–2023 arasında bitiyor.
 * Takvim geçmişte kaldığı için rota motoru bugüne ait tek bir sefer bulamaz.
 * Bu işlev bütün hizmet dönemlerini tam hafta katları kadar ileri kaydırır; böylece
 * haftanın günleri (pazartesi, cumartesi...) aynı kalır, seferler bugün de geçerli olur.
 * Saatler ve duraklar değişmez; yani eski tarifedeki saatler kullanılmaya devam eder.
 */
/**
 * frequencies.txt'te gece yarısını aşan pencereler.
 *
 * GTFS'te bir servis gününün 02:00'si "26:00:00" diye yazılır. İBB verisinde bunlar
 * "02:00:00" olarak yazılmış, yani bitiş başlangıçtan küçük kalıyor ve o pencere hiç
 * çalışmıyor. Gece metrosunun (M1A, M2, M4… 23:50–02:00) yarısı tam olarak böyle kayboluyordu.
 */
async function frekanslariOnar(klasor) {
  const dosya = path.join(klasor, 'frequencies.txt');
  let satirlar;
  try {
    satirlar = bosSutunlariAt(csvCoz(await dosyaOku(dosya, 'utf-8')));
  } catch {
    return null; // bu beslemede frequencies.txt yok
  }
  const b = satirlar[0];
  const iBas = b.indexOf('start_time');
  const iBit = b.indexOf('end_time');
  const iAralik = b.indexOf('headway_secs');
  if (iBas < 0 || iBit < 0) return null;

  const saniye = (t) => {
    const p = (t ?? '').trim().split(':').map(Number);
    return p.length === 3 && p.every((x) => Number.isFinite(x)) ? p[0] * 3600 + p[1] * 60 + p[2] : null;
  };
  const yaz = (sn) => {
    const iki = (n) => String(n).padStart(2, '0');
    return `${iki(Math.floor(sn / 3600))}:${iki(Math.floor((sn % 3600) / 60))}:${iki(sn % 60)}`;
  };

  const sonuc = [b];
  let duzeltilen = 0;
  let atilan = 0;
  for (const r of satirlar.slice(1)) {
    const bas = saniye(r[iBas]);
    let bit = saniye(r[iBit]);
    const aralik = iAralik >= 0 ? Number(r[iAralik]) : NaN;
    if (bas === null || bit === null || !Number.isFinite(aralik) || aralik <= 0) { atilan++; continue; }
    if (bit <= bas) {
      bit += 24 * 3600;
      r[iBit] = yaz(bit);
      duzeltilen++;
    }
    if (bit - bas < aralik) { atilan++; continue; } // pencereye tek sefer bile sığmıyor
    sonuc.push(r);
  }
  await dosyaYaz(dosya, csvYaz(sonuc), 'utf-8');
  if (duzeltilen || atilan) {
    log(
      `  frequencies: ${duzeltilen} pencerenin bitişi gece yarısını aşacak biçimde düzeltildi` +
        (atilan ? `, ${atilan} geçersiz satır atıldı` : ''),
    );
  }
  return { duzeltilen, atilan };
}

async function takvimiGuncelDonemeKaydir(klasor) {
  const dosya = path.join(klasor, 'calendar.txt');
  const satirlar = csvCoz(await dosyaOku(dosya, 'utf-8'));
  const b = satirlar[0];
  const iBas = b.indexOf('start_date');
  const iBit = b.indexOf('end_date');
  if (iBas < 0 || iBit < 0) return null;

  const iId = b.indexOf('service_id');
  const gecerli = (v) => /^\d{8}$/.test((v ?? '').trim());
  const gun = 86400000;
  const bugun = new Date();
  const bugunUtc = new Date(Date.UTC(bugun.getFullYear(), bugun.getMonth(), bugun.getDate()));
  const hedef = new Date(bugunUtc.getTime() + 365 * gun);

  // Süresi bu kadar günden kısa olan servisler mevsimlik sayılır (Lale Festivali vapuru,
  // Erguvan Turu gibi); onları kaydırmak seferi yanlış mevsime taşır, oldukları yerde bırakılır.
  const MEVSIMLIK_SINIRI = 60;

  // Her servis KENDİ süresine göre kaydırılır. Tek bir ortak kaydırma kullanılırsa, en yeni
  // takvimi güncel döneme getiren miktar daha eski takvimleri geçmişte bırakıyor: gece metrosu
  // (Cmt+Paz seferleri olan servis) tam olarak böyle kaybolmuştu.
  const kaydirmalar = new Map();
  let kaydirilan = 0;
  let mevsimlik = 0;
  let zatenGecerli = 0;

  for (const r of satirlar.slice(1)) {
    if (!gecerli(r[iBas]) || !gecerli(r[iBit])) continue;
    const bas = tariheCevir(r[iBas].trim());
    const bit = tariheCevir(r[iBit].trim());
    if (bit >= bugunUtc) { zatenGecerli++; continue; }
    if ((bit - bas) / gun < MEVSIMLIK_SINIRI) { mevsimlik++; continue; }
    // Tam hafta katı kaydırılır ki hafta içi/hafta sonu düzeni bozulmasın.
    const kaydirmaGunu = Math.ceil((hedef - bit) / (7 * gun)) * 7;
    r[iBas] = tarihMetni(new Date(bas.getTime() + kaydirmaGunu * gun));
    r[iBit] = tarihMetni(new Date(bit.getTime() + kaydirmaGunu * gun));
    if (iId >= 0) kaydirmalar.set((r[iId] ?? '').trim(), kaydirmaGunu);
    kaydirilan++;
  }

  if (!kaydirilan) return null;
  await dosyaYaz(dosya, csvYaz(satirlar), 'utf-8');

  // İstisna günleri, ait oldukları servisin kaydırma miktarıyla taşınır.
  const istisnaDosyasi = path.join(klasor, 'calendar_dates.txt');
  try {
    const istisna = csvCoz(await dosyaOku(istisnaDosyasi, 'utf-8'));
    const iTarih = istisna[0].indexOf('date');
    const iIstisnaId = istisna[0].indexOf('service_id');
    if (iTarih >= 0) {
      for (const r of istisna.slice(1)) {
        const kaydirmaGunu = kaydirmalar.get((r[iIstisnaId] ?? '').trim());
        if (kaydirmaGunu && gecerli(r[iTarih])) {
          r[iTarih] = tarihMetni(new Date(tariheCevir(r[iTarih].trim()).getTime() + kaydirmaGunu * gun));
        }
      }
      await dosyaYaz(istisnaDosyasi, csvYaz(istisna), 'utf-8');
    }
  } catch {
    // calendar_dates.txt bu veride yok; sorun değil.
  }

  return { kaydirilan, mevsimlik, zatenGecerli };
}


/**
 * Dosyalar arası tutarlılığı sağlar: rota motoru, var olmayan bir hatta/sefere/durağa
 * atıf yapan satır bulduğunda tüm derlemeyi durdurur. Bu işlev öksüz satırları atar.
 */
/** Rota motorunun zorunlu saydığı boş alanları doldurur (durak adı, işletmeci saat dilimi vb.). */
async function zorunluAlanlariDoldur(klasor) {
  const durakDosyasi = path.join(klasor, 'stops.txt');
  const duraklar = bosSutunlariAt(csvCoz(await dosyaOku(durakDosyasi, 'utf-8')));
  const iAd = duraklar[0].indexOf('stop_name');
  const iId = duraklar[0].indexOf('stop_id');
  let durakAdi = 0;
  if (iAd >= 0 && iId >= 0) {
    for (const r of duraklar.slice(1)) {
      if (!(r[iAd] ?? '').trim()) {
        r[iAd] = `Durak ${(r[iId] ?? '').trim()}`;
        durakAdi++;
      }
    }
    if (durakAdi) await dosyaYaz(durakDosyasi, csvYaz(duraklar), 'utf-8');
  }

  const ajansDosyasi = path.join(klasor, 'agency.txt');
  const ajanslar = bosSutunlariAt(csvCoz(await dosyaOku(ajansDosyasi, 'utf-8')));
  const varsayilanlar = { agency_name: 'İBB', agency_url: 'https://www.ibb.istanbul', agency_timezone: 'Europe/Istanbul' };
  let ajansAlani = 0;
  for (const [alan, varsayilan] of Object.entries(varsayilanlar)) {
    const i = ajanslar[0].indexOf(alan);
    if (i < 0) continue;
    for (const r of ajanslar.slice(1)) {
      if (!(r[i] ?? '').trim()) {
        r[i] = varsayilan;
        ajansAlani++;
      }
    }
  }
  if (ajansAlani) await dosyaYaz(ajansDosyasi, csvYaz(ajanslar), 'utf-8');
  if (durakAdi || ajansAlani) log(`  zorunlu alanlar: ${durakAdi} durak adı, ${ajansAlani} işletmeci alanı tamamlandı`);
}

async function butunlukOnar(klasor) {
  const dosyaYolu = (ad) => path.join(klasor, ad);
  const oku = async (ad) => {
    try {
      return bosSutunlariAt(csvCoz(await dosyaOku(dosyaYolu(ad), 'utf-8')));
    } catch {
      return null;
    }
  };
  const sutun = (satirlar, ad) => satirlar[0].indexOf(ad);
  const kume = (satirlar, ad) => {
    const i = sutun(satirlar, ad);
    return i < 0 ? new Set() : new Set(satirlar.slice(1).map((r) => (r[i] ?? '').trim()));
  };

  const duraklar = await oku('stops.txt');
  const hatlar = await oku('routes.txt');
  const takvim = await oku('calendar.txt');
  const istisna = await oku('calendar_dates.txt');
  const seferler = await oku('trips.txt');
  const cizgiler = await oku('shapes.txt');
  if (!duraklar || !hatlar || !takvim || !seferler) return;

  const durakIdleri = kume(duraklar, 'stop_id');
  const hatIdleri = kume(hatlar, 'route_id');
  const hizmetIdleri = new Set([...kume(takvim, 'service_id'), ...(istisna ? kume(istisna, 'service_id') : [])]);
  const cizgiIdleri = cizgiler ? kume(cizgiler, 'shape_id') : new Set();

  // Üst istasyonu artık var olmayan duraklarda bağlantı temizlenir.
  const iUst = sutun(duraklar, 'parent_station');
  let ustTemizlenen = 0;
  if (iUst >= 0) {
    for (const r of duraklar.slice(1)) {
      const ust = (r[iUst] ?? '').trim();
      if (ust && !durakIdleri.has(ust)) {
        r[iUst] = '';
        ustTemizlenen++;
      }
    }
    if (ustTemizlenen) await dosyaYaz(dosyaYolu('stops.txt'), csvYaz(duraklar), 'utf-8');
  }

  // Hattı ya da hizmet günü olmayan seferler atılır; eksik güzergâh çizgisi temizlenir.
  const iSeferId = sutun(seferler, 'trip_id');
  const iHat = sutun(seferler, 'route_id');
  const iHizmet = sutun(seferler, 'service_id');
  const iCizgi = sutun(seferler, 'shape_id');
  const gecerliSeferler = [seferler[0]];
  let atilanSefer = 0;
  let cizgiTemizlenen = 0;
  for (const r of seferler.slice(1)) {
    if (!hatIdleri.has((r[iHat] ?? '').trim()) || !hizmetIdleri.has((r[iHizmet] ?? '').trim())) {
      atilanSefer++;
      continue;
    }
    if (iCizgi >= 0) {
      const c = (r[iCizgi] ?? '').trim();
      if (c && !cizgiIdleri.has(c)) {
        r[iCizgi] = '';
        cizgiTemizlenen++;
      }
    }
    gecerliSeferler.push(r);
  }
  const seferIdleri = new Set(gecerliSeferler.slice(1).map((r) => (r[iSeferId] ?? '').trim()));

  // stop_times çok büyük olabildiği için satır satır süzülür.
  const durakSayaci = new Map();
  const uclar = new Map(); // sefer → { ilkSira, sonSira, ilkSaatVar, sonSaatVar }
  const atilanDurakSaati = await satirSuz(dosyaYolu('stop_times.txt'), (alanlar, basliklar) => {
    const sefer = (alanlar[basliklar.indexOf('trip_id')] ?? '').trim();
    const durak = (alanlar[basliklar.indexOf('stop_id')] ?? '').trim();
    if (!seferIdleri.has(sefer) || !durakIdleri.has(durak)) return false;
    durakSayaci.set(sefer, (durakSayaci.get(sefer) ?? 0) + 1);

    // Rota motoru, seferin ilk ve son durağında saat bekler; eksikse o seferi atarız.
    const sira = Number((alanlar[basliklar.indexOf('stop_sequence')] ?? '').trim());
    const saatVar =
      !!(alanlar[basliklar.indexOf('departure_time')] ?? '').trim() ||
      !!(alanlar[basliklar.indexOf('arrival_time')] ?? '').trim();
    const u = uclar.get(sefer) ?? { ilkSira: Infinity, sonSira: -Infinity, ilkSaatVar: false, sonSaatVar: false };
    if (sira <= u.ilkSira) {
      u.ilkSira = sira;
      u.ilkSaatVar = saatVar;
    }
    if (sira >= u.sonSira) {
      u.sonSira = sira;
      u.sonSaatVar = saatVar;
    }
    uclar.set(sefer, u);
    return true;
  });

  // En az iki durağı kalmayan ya da uçlarında saat bulunmayan seferler kullanılamaz.
  const seferGecerli = (id) => {
    const u = uclar.get(id);
    return (durakSayaci.get(id) ?? 0) >= 2 && !!u?.ilkSaatVar && !!u?.sonSaatVar;
  };
  const kalanSeferler = [gecerliSeferler[0], ...gecerliSeferler.slice(1).filter((r) => seferGecerli((r[iSeferId] ?? '').trim()))];
  const eksikDurakli = gecerliSeferler.length - kalanSeferler.length;
  if (atilanSefer || cizgiTemizlenen || eksikDurakli) await dosyaYaz(dosyaYolu('trips.txt'), csvYaz(kalanSeferler), 'utf-8');
  const sonSeferIdleri = new Set(kalanSeferler.slice(1).map((r) => (r[iSeferId] ?? '').trim()));

  // İkinci geçiş: artık kullanılmayan seferlerin durak saatleri de temizlenir.
  let ikinciGecis = 0;
  if (eksikDurakli) {
    ikinciGecis = await satirSuz(dosyaYolu('stop_times.txt'), (alanlar, basliklar) =>
      sonSeferIdleri.has((alanlar[basliklar.indexOf('trip_id')] ?? '').trim()),
    );
  }

  let atilanSiklik = 0;
  try {
    atilanSiklik = await satirSuz(dosyaYolu('frequencies.txt'), (alanlar, basliklar) =>
      sonSeferIdleri.has((alanlar[basliklar.indexOf('trip_id')] ?? '').trim()),
    );
  } catch {
    // frequencies.txt her beslemede bulunmuyor.
  }

  const atilanSaat = atilanDurakSaati + ikinciGecis;
  const toplam = atilanSefer + eksikDurakli + atilanSaat + atilanSiklik + cizgiTemizlenen + ustTemizlenen;
  if (toplam === 0) {
    log('  bütünlük: öksüz satır bulunmadı');
    return;
  }
  log(
    `  bütünlük: ${atilanSefer + eksikDurakli} sefer, ${atilanSaat} durak saati, ${atilanSiklik} sıklık satırı atıldı` +
      `${cizgiTemizlenen ? `, ${cizgiTemizlenen} seferin güzergâh çizgisi temizlendi` : ''}` +
      `${ustTemizlenen ? `, ${ustTemizlenen} durağın üst istasyonu temizlendi` : ''}`,
  );
}

/** Bir dosyayı satır satır okuyup koşulu sağlamayan satırları atar; atılan satır sayısını döndürür. */
async function satirSuz(dosya, koşul) {
  const gecici = dosya + '.suzulmus';
  const okuyucu = readline.createInterface({ input: createReadStream(dosya, { encoding: 'utf-8' }), crlfDelay: Infinity });
  const yazici = createWriteStream(gecici, { encoding: 'utf-8' });
  let basliklar = null;
  let atilan = 0;
  for await (const satir of okuyucu) {
    if (!satir.trim()) continue;
    if (!basliklar) {
      basliklar = satir.split(',').map((a) => a.trim());
      yazici.write(satir + '\n');
      continue;
    }
    if (koşul(satir.split(','), basliklar)) {
      if (!yazici.write(satir + '\n')) await new Promise((r) => yazici.once('drain', r));
    } else atilan++;
  }
  await new Promise((r, h) => yazici.end((e) => (e ? h(e) : r())));
  await rm(dosya, { force: true });
  await rename(gecici, dosya);
  return atilan;
}

async function iettVerisiniOnar(klasor) {
  await hatlariOnar(path.join(klasor, 'routes.txt'), await ajanslariOku(klasor));
  await duraklariOnar(path.join(klasor, 'stops.txt'), path.join(klasor, 'stop_times.txt'));
  for (const ad of ['agency', 'calendar', 'trips']) {
    const dosya = path.join(klasor, ad + '.txt');
    await dosyaYaz(dosya, csvYaz(bosSutunlariAt(csvCoz(await dosyaOku(dosya, 'utf-8')))), 'utf-8');
  }
}

export { iettVerisiniOnar, butunlukOnar, zorunluAlanlariDoldur, frekanslariOnar, takvimiGuncelDonemeKaydir, koordinatCoz, mojibakeDuzelt };

// ---------- Ana akış ----------

async function beslemeHazirla(besleme, sira, toplam) {
  const ham = path.join(GECICI, besleme.kod, 'ham');
  const cikti = path.join(GECICI, besleme.kod, 'gtfs');
  await mkdir(ham, { recursive: true });
  await mkdir(cikti, { recursive: true });

  log(`[${sira}/${toplam}] ${besleme.ad}`);

  log('  1/5 Dosyalar indiriliyor...');
  for (const k of besleme.kaynaklar) {
    const uzanti = k.url.endsWith('.zip') ? '.zip' : '.csv';
    await indir(k.url, path.join(ham, k.ad + uzanti));
  }

  log('  2/5 Sıkıştırılmış dosyalar açılıyor...');
  for (const k of besleme.kaynaklar.filter((k) => k.url.endsWith('.zip'))) {
    const zipYolu = path.join(ham, k.ad + '.zip');
    const acKlasor = path.join(ham, k.ad + '_acilan');
    await mkdir(acKlasor, { recursive: true });
    execFileSync('tar', ['-xf', zipYolu, '-C', acKlasor], { stdio: 'inherit' });
    const icerik = (await dosyalariBul(acKlasor)).filter((f) => /\.(csv|txt)$/i.test(f));
    if (icerik.length === 0) throw new Error(`${k.ad}.zip içinde CSV/TXT dosyası bulunamadı.`);
    // Birden fazla dosya varsa en büyüğünü kullan.
    let enBuyuk = icerik[0];
    for (const f of icerik) if ((await stat(f)).size > (await stat(enBuyuk)).size) enBuyuk = f;
    k.yerelYol = enBuyuk;
  }

  log('  3/5 GTFS biçimine dönüştürülüyor...');
  const ozet = {};
  for (const k of besleme.kaynaklar) {
    const girdi = k.yerelYol ?? path.join(ham, k.ad + '.csv');
    ozet[k.ad] = await donustur(girdi, path.join(cikti, k.ad + '.txt'), k.ad);
  }

  const eksik = ZORUNLU.filter((ad) => !ozet[ad] || ozet[ad].satirSayisi === 0);
  if (eksik.length) throw new Error(`${besleme.ad}: şu dosyalar boş veya eksik: ${eksik.join(', ')}`);

  const takvim = ozet.calendar.bitisSutunu;
  if (takvim.enBuyuk) log(`  Sefer takvimi: ${tarihYaz(takvim.enKucuk)} – ${tarihYaz(takvim.enBuyuk)}`);

  log('  4/5 Bilinen veri hataları onarılıyor...');
  await iettVerisiniOnar(cikti);
  await zorunluAlanlariDoldur(cikti);
  await frekanslariOnar(cikti);
  await butunlukOnar(cikti);

  if (besleme.takvimiKaydir) {
    const kaydirma = await takvimiGuncelDonemeKaydir(cikti);
    if (kaydirma) {
      log(
        `  Takvim: ${kaydirma.kaydirilan} servis güncel döneme kaydırıldı` +
          (kaydirma.zatenGecerli ? `, ${kaydirma.zatenGecerli} servis zaten geçerliydi` : '') +
          (kaydirma.mevsimlik ? `, ${kaydirma.mevsimlik} kısa süreli (mevsimlik) servis olduğu gibi bırakıldı` : ''),
      );
      log('  NOT: Saatler eski tarifeden geliyor; gerçek seferlerden birkaç dakika sapabilir.');
    }
  } else if (takvim.enBuyuk) {
    const bugun = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (takvim.enBuyuk < bugun) log('  UYARI: Takvimdeki bütün hizmet dönemleri bugünden önce bitiyor.');
  }

  log('  5/5 Zip dosyası oluşturuluyor...');
  const zipYolu = path.join(HEDEF, besleme.zip);
  await rm(zipYolu, { force: true });
  const txtler = besleme.kaynaklar.map((k) => k.ad + '.txt');
  execFileSync('tar', ['-a', '-cf', zipYolu, '-C', cikti, ...txtler], { stdio: 'inherit' });
  const { size } = await stat(zipYolu);
  log(`  Hazır: ${besleme.zip} (${(size / 1048576).toFixed(1)} MB)`);
}

async function main() {
  log(`Hedef klasör: ${HEDEF}`);
  await rm(GECICI, { recursive: true, force: true });
  await mkdir(HEDEF, { recursive: true });

  const secilen = process.argv[3]
    ? BESLEMELER.filter((b) => b.kod === process.argv[3])
    : BESLEMELER;
  if (!secilen.length) throw new Error(`Bilinmeyen besleme: ${process.argv[3]} (iett veya ray yazabilirsin)`);

  for (const [i, besleme] of secilen.entries()) {
    await beslemeHazirla(besleme, i + 1, secilen.length);
  }

  await rm(GECICI, { recursive: true, force: true });
  log('Tamamlandı. Rota ağını yeniden oluşturmayı unutma:');
  log('  java -Xmx8G -jar otp-shaded-SÜRÜM.jar --build --save istanbul');
}

if (!process.env.GTFS_ONAR_TEST) {
  main().catch((hata) => {
    console.error(`\nHATA: ${hata.message}`);
    process.exit(1);
  });
}
