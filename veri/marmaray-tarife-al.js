// TCDD'nin Marmaray "Sefer Saatleri" sayfasının gösterdiği tarifeyi marmaray-tarife.json
// olarak indirir (Marmaray, Halkalı–Bahçeşehir, M11, T6). Bkz. README 4c2.
//
// Elle yedek yol: normalde marmaray-tarife-indir.mjs bunu Edge'le kendisi yapıyor (yenile.ps1).
// O çalışmazsa (Edge yok, sayfa değişti) bu dosya tarayıcı konsolunda aynı çıktıyı verir.
//
// Kullanım: tarayıcıda https://www.tcddtasimacilik.gov.tr/marmaray/tr/sefersaatleri sayfasını
// aç, F12 → Console, bu dosyanın içeriğini yapıştır, Enter. Birkaç saniye sonra dosya iner.
//
// Sayfa tarifeyi kendi arka ucundan bir kez yüklüyor; betik o isteği dinleyip sayfanın
// yeniden yüklemesini sağlıyor (aynı sitede başka sayfaya gidip geri dönerek). Sayfanın
// kimlik bilgilerine dokunmuyor, ayrı bir istek atmıyor.
(async () => {
  const yakalanan = {};
  const acik = XMLHttpRequest.prototype.open;
  const gonder = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__adres = u; return acik.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      if (/GetTransportationTrainsGroupwithHours/.test(this.__adres)) yakalanan.saatler = this.responseText;
    });
    return gonder.apply(this, arguments);
  };
  const git = (yol) => { history.pushState({}, '', yol); dispatchEvent(new PopStateEvent('popstate')); };
  git('/marmaray/tr/gunluk_tren_saatleri');
  await new Promise((r) => setTimeout(r, 2500));
  git('/marmaray/tr/sefersaatleri');
  for (let i = 0; i < 60 && !yakalanan.saatler; i++) await new Promise((r) => setTimeout(r, 500));
  XMLHttpRequest.prototype.open = acik;
  XMLHttpRequest.prototype.send = gonder;
  if (!yakalanan.saatler) { console.error('Tarife yüklenmedi; sayfayı yenileyip tekrar dene.'); return; }

  const trenler = JSON.parse(yakalanan.saatler);
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
  const cikti = {
    kaynak: 'https://www.tcddtasimacilik.gov.tr/marmaray/tr/sefersaatleri (sayfanın kendi gösterdiği tarife)',
    alindi: new Date().toISOString().slice(0, 10),
    aciklama: 'desen: s=istasyon sırası, o=ilk kalkıştan dakika (tek sayı ya da [varış,kalkış]); kosular: [desen, gun01..gun06 (Pzt..Cmt; hepsi X ise her gün), ilk kalkış dk, aralık dk, adet]',
    istasyonlar, desenler, kosular,
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(cikti)], { type: 'application/json' }));
  a.download = 'marmaray-tarife.json';
  a.click();
  console.log(`${ist.length} sefer, ${desenler.length} desen, ${kosular.length} koşu → marmaray-tarife.json`);
})();
