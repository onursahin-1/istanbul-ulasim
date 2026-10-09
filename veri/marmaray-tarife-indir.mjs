// TCDD'nin Marmaray "Sefer Saatleri" sayfasının gösterdiği tarifeyi marmaray-tarife.json olarak
// indirir: Marmaray, Halkalı–Bahçeşehir, M11, T6. Uygulayan betik: marmaray-tarife-uygula.py.
//
// Sayfanın arka ucu yalnız sitenin kendisine açık (kimlik bilgisi sitenin koduna gömülü); onu
// kullanmıyoruz. Bunun yerine bilgisayarda kurulu Edge'i (yoksa Chrome) görünmez açıp sayfayı
// bir ziyaretçi gibi yüklüyoruz ve sayfanın kendi yüklediği tarifeyi tarayıcının geliştirici
// arayüzünden (DevTools protokolü) alıyoruz. Ayrı istek atılmıyor, kurulacak bir şey yok:
// Edge Windows'la geliyor, WebSocket Node 22'de yerleşik.
//
// Elle yedek yol: marmaray-tarife-al.js (tarayıcı konsoluna yapıştırılır, aynı dosyayı indirir).
//
// Sağlama: en az 300 sefer, Gebze, Gayrettepe (M11) ve Kazlıçeşme (T6) olmalı; değilse eski dosya
// yerinde kalır ve betik 1 ile çıkar (yenile.ps1 o zaman son indirilenle devam eder).
//
// Kullanım (Node 22+):
//   node veri\marmaray-tarife-indir.mjs C:\otp\marmaray-tarife.json
// Ortam değişkeni TARAYICI: Edge/Chrome bulunamazsa tarayıcının yolu.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SAYFA = 'https://www.tcddtasimacilik.gov.tr/marmaray/tr/sefersaatleri';
const ISTEK = 'GetTransportationTrainsGroupwithHours';
const CIKTI = process.argv[2] ?? 'marmaray-tarife.json';
const ZAMAN_ASIMI_MS = 120_000;

function tarayiciBul() {
  if (process.env.TARAYICI) return process.env.TARAYICI;
  const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const yerel = process.env.LOCALAPPDATA ?? '';
  const adaylar = [
    path.win32.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.win32.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.win32.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
    path.win32.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.win32.join(yerel, 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  return adaylar.find((a) => existsSync(a));
}

/** Tarayıcıyı görünmez açar; DevTools adresini ve süreci döndürür. */
async function tarayiciAc(yol, klasor) {
  const surec = spawn(yol, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${klasor}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--disable-features=msEdgeSidebarV2,EdgeCollections', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let hata = '';
  const adres = await new Promise((coz, reddet) => {
    const sure = setTimeout(() => reddet(new Error(`tarayıcı açılmadı: ${hata.slice(-300)}`)), 30_000);
    surec.stderr.on('data', (p) => {
      hata += p;
      const m = hata.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(sure); coz(m[1]); }
    });
    surec.on('exit', (kod) => { clearTimeout(sure); reddet(new Error(`tarayıcı kapandı (${kod}): ${hata.slice(-300)}`)); });
  });
  return { surec, adres };
}

/** En küçük DevTools istemcisi: komut gönder, olay dinle. */
function baglan(adres) {
  return new Promise((coz, reddet) => {
    const ws = new WebSocket(adres);
    let no = 0;
    const bekleyen = new Map();
    const dinleyiciler = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && bekleyen.has(m.id)) {
        const { coz: c, reddet: r } = bekleyen.get(m.id);
        bekleyen.delete(m.id);
        m.error ? r(new Error(`${m.error.message} (${m.error.code})`)) : c(m.result);
      } else if (m.method) {
        for (const d of dinleyiciler) d(m);
      }
    };
    ws.onerror = () => reddet(new Error('DevTools bağlantısı kurulamadı'));
    ws.onopen = () => coz({
      gonder: (method, params = {}, sessionId) => new Promise((c, r) => {
        const id = ++no;
        bekleyen.set(id, { coz: c, reddet: r });
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
      dinle: (d) => dinleyiciler.push(d),
      kapat: () => ws.close(),
    });
  });
}

// Sayfa açılmadan önce yüklenen kanca: sayfanın tarife isteğinin cevabını saklar. (Cevap 7-8 MB;
// DevTools üzerinden olduğu gibi çekmek Node'un WebSocket ileti sınırına takılıyor. Bu yüzden
// küçültme sayfanın içinde yapılıp yalnız ~10 KB'lık sonuç alınıyor.)
const KANCA = `(() => {
  const acik = XMLHttpRequest.prototype.open, gonder = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__adres = String(u); return acik.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      if (this.__adres.includes('${ISTEK}') && this.status === 200) window.__tcddTarife = this.responseText;
    });
    return gonder.apply(this, arguments);
  };
})();`;

/** Sayfayı açar; sayfanın yüklediği tarifeyi sayfanın içinde küçültüp döndürür. */
async function tarifeyiAl(cdp) {
  const { targetId } = await cdp.gonder('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.gonder('Target.attachToTarget', { targetId, flatten: true });
  const { userAgent } = await cdp.gonder('Browser.getVersion');
  // Görünmez tarayıcı kendini "HeadlessChrome" diye tanıtıyor; sıradan tarayıcı gibi görünsün.
  await cdp.gonder('Emulation.setUserAgentOverride', { userAgent: userAgent.replace('HeadlessChrome', 'Chrome') }, sessionId);
  await cdp.gonder('Page.enable', {}, sessionId);
  await cdp.gonder('Page.addScriptToEvaluateOnNewDocument', { source: KANCA }, sessionId);
  await cdp.gonder('Page.navigate', { url: SAYFA }, sessionId);
  const degerlendir = async (ifade) => {
    const r = await cdp.gonder('Runtime.evaluate', { expression: ifade, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`sayfada hata: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const bitis = Date.now() + ZAMAN_ASIMI_MS;
  while (!(await degerlendir('!!window.__tcddTarife'))) {
    if (Date.now() > bitis) throw new Error(`sayfa ${ZAMAN_ASIMI_MS / 1000} sn içinde tarifeyi yüklemedi`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return degerlendir(`(${donustur.toString()})(JSON.parse(window.__tcddTarife))`);
}

/** TCDD'nin tren listesi → küçük biçim (bkz. marmaray-tarife-uygula.py). Sayfanın içinde çalışır
 * (toString ile gönderiliyor): dışarıdaki değişkenlere dokunmamalı. marmaray-tarife-al.js ile aynı. */
function donustur(trenler) {
  const sn = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
  // Yalnız banliyö (9BANL) ve İstanbul'a uğrayan trenler.
  const ist = trenler.filter((t) => t.alttt === '9BANL' && t.hours.some((h) => /İSTANBUL/.test(h.stationCity || '')));
  const istasyonlar = [], istNo = {}, desenler = [], desenNo = {}, seferler = [];
  for (const t of ist) {
    const hs = [...t.hours].sort((a, b) => a.stationOrderNumber - b.stationOrderNumber);
    const n = hs.length;
    // originTime varış, destinationTime kalkış (ilk istasyonun varışı ve sonun kalkışı 00:00).
    let onceki = null, ek = 0;
    const T = hs.map((h, i) => {
      let a = sn(i === 0 ? h.destinationTime : h.originTime) + ek;
      if (onceki !== null && a < onceki - 6 * 3600) { ek += 86400; a += 86400; }
      let d = sn(i === n - 1 ? h.originTime : h.destinationTime) + ek;
      if (d < a) { ek += 86400; d += 86400; }
      onceki = d;
      return [a, d];
    });
    const s0 = T[0][1];
    const s = hs.map((h) => {
      const k = `${h.station}|${h.stationCity || ''}`;
      if (!(k in istNo)) { istNo[k] = istasyonlar.length; istasyonlar.push(k); }
      return istNo[k];
    });
    const o = T.map(([a, d]) => (a === d ? (a - s0) / 60 : [(a - s0) / 60, (d - s0) / 60]));
    const anahtar = JSON.stringify([s, o]);
    if (!(anahtar in desenNo)) { desenNo[anahtar] = desenler.length; desenler.push({ s, o }); }
    const gun = [1, 2, 3, 4, 5, 6].map((i) => (t['gun0' + i] ? '1' : '0')).join('');
    seferler.push([desenNo[anahtar], gun, s0 / 60]);
  }
  // Aynı desen ve günlerdeki seferler: eşit aralıklı koşulara.
  const gruplar = {};
  for (const [d, g, t] of seferler) (gruplar[`${d}|${g}`] ??= []).push(t);
  const kosular = [];
  for (const [k, liste] of Object.entries(gruplar)) {
    const [d, g] = k.split('|');
    liste.sort((a, b) => a - b);
    let i = 0;
    while (i < liste.length) {
      let j = i + 1;
      if (j < liste.length) {
        const ara = liste[j] - liste[i];
        while (j + 1 < liste.length && liste[j + 1] - liste[j] === ara) j++;
        if (j - i >= 2) { kosular.push([+d, g, liste[i], ara, j - i + 1]); i = j + 1; continue; }
      }
      kosular.push([+d, g, liste[i], 0, 1]);
      i++;
    }
  }
  return { istasyonlar, desenler, kosular };
}

const seferSayisi = (v) => (v?.kosular ?? []).reduce((t, k) => t + k[4], 0);

async function main() {
  if (typeof WebSocket === 'undefined') throw new Error(`Node 22 ya da üstü gerekiyor (bu ${process.version})`);
  const yol = tarayiciBul();
  if (!yol) throw new Error('Edge ya da Chrome bulunamadı; TARAYICI ortam değişkeniyle yolu ver.');
  const klasor = mkdtempSync(path.join(tmpdir(), 'tcdd-'));
  let surec;
  try {
    const t = await tarayiciAc(yol, klasor);
    surec = t.surec;
    const cdp = await baglan(t.adres);
    const kucuk = await tarifeyiAl(cdp);
    await cdp.gonder('Browser.close').catch(() => {});
    cdp.kapat();
    const veri = {
      kaynak: `${SAYFA} (sayfanın kendi gösterdiği tarife)`,
      alindi: new Date().toISOString().slice(0, 10),
      aciklama: 'desen: s=istasyon sırası, o=ilk kalkıştan dakika (tek sayı ya da [varış,kalkış]); kosular: [desen, gun01..gun06 (Pzt..Cmt; hepsi X ise her gün), ilk kalkış dk, aralık dk, adet]',
      ...kucuk,
    };
    const n = seferSayisi(veri);
    const adlar = veri.istasyonlar.join(' ');
    for (const gerekli of ['Gebze', 'Gayrettepe', 'Kazlıçeşme']) {
      if (!adlar.includes(gerekli)) throw new Error(`tarifede ${gerekli} yok; sayfa değişmiş olabilir`);
    }
    if (n < 300) throw new Error(`yalnız ${n} sefer geldi (beklenen ~530); sayfa değişmiş olabilir`);
    const eski = existsSync(CIKTI) ? JSON.parse(readFileSync(CIKTI, 'utf8')) : null;
    const gecici = `${CIKTI}.yeni`;
    writeFileSync(gecici, JSON.stringify(veri));
    renameSync(gecici, CIKTI);
    const ayni = eski && JSON.stringify([eski.istasyonlar, eski.desenler, eski.kosular]) ===
      JSON.stringify([veri.istasyonlar, veri.desenler, veri.kosular]);
    console.log(`TCDD tarifesi: ${n} sefer, ${veri.desenler.length} desen → ${CIKTI}` +
      (eski ? (ayni ? ' (öncekiyle aynı)' : ` (önceki ${eski.alindi}: ${seferSayisi(eski)} sefer — DEĞİŞTİ)`) : ''));
  } finally {
    try { surec?.kill(); } catch { /* zaten kapandı */ }
    await new Promise((r) => setTimeout(r, 1000));
    try { rmSync(klasor, { recursive: true, force: true }); } catch { /* Windows kilidi: geçici klasör kalır */ }
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(`Hata: ${e.message}`);
  process.exit(1);
});
