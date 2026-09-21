// GTFS tarifesini bellekte aranabilir hâle getirir.
//
// Köprünün çözmesi gereken asıl soru şu: elimizde bir otobüsün konumu, hattı, yönü ve
// en yakın durağı var — ama **hangi seferi** yaptığı yok. GTFS-RT ise her şeyi sefer
// (trip) düzeyinde ister. O yüzden seferi biz çıkarıyoruz: aracın bulunduğu durakta,
// o hattın hangi seferi şu ana en yakın saate planlanmışsa o.
//
// Veri büyük (6,1 milyon durak-saat satırı) ama yapı basit tutulunca ucuz: satırlar
// durak numarasına göre sıralanmış üç tipli diziye konuyor, aramalar da o durağın
// dilimini taramaktan ibaret oluyor. Ölçüm: ~2,5 sn kurulum, ~230 MB bellek.

import { zipAc, csvAyristir } from './gtfs-oku.mjs';

const GUN = 86_400;

/**
 * "06:40:00" → 24000. Tarifede 24 saati aşan saatler olabilir, onlar da doğru çözülür.
 * Alan boşsa -1 döner: İETT verisinde yalnızca ilk ve son durağın saati yazılı,
 * aradakiler boş bırakılmış ve ara değerlenmesi bekleniyor.
 */
function saniyeCoz(buf, bas, bit) {
  if (bit <= bas) return -1;
  // "SS:DD:SS" biçimi bayt bayt okunuyor; metne çevirmek bu boyutta pahalı.
  let saat = 0;
  let i = bas;
  for (; i < bit && buf[i] !== 0x3a; i++) saat = saat * 10 + (buf[i] - 48);
  let dakika = 0;
  for (i++; i < bit && buf[i] !== 0x3a; i++) dakika = dakika * 10 + (buf[i] - 48);
  let saniye = 0;
  for (i++; i < bit; i++) saniye = saniye * 10 + (buf[i] - 48);
  return saat * 3600 + dakika * 60 + saniye;
}

/** Takvim satırından "bugün çalışıyor mu" sorusunu cevaplayacak bir yapı çıkarır. */
function servisleriCoz(satirlar) {
  const gunAdlari = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return satirlar.map((c) => ({
    id: c.service_id,
    gunler: gunAdlari.map((g) => c[g] === '1'),
    bas: c.start_date,
    bit: c.end_date,
  }));
}

/**
 * GTFS zip'inden arama dizinini kurar.
 * @param {string} zipYolu İETT GTFS zip dosyası
 */
export function tarifeyiKur(zipYolu) {
  const t0 = Date.now();
  const dosyalar = zipAc(zipYolu, ['routes.txt', 'stops.txt', 'trips.txt', 'calendar.txt', 'stop_times.txt']);
  for (const ad of ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt']) {
    if (!dosyalar[ad]) throw new Error(`${zipYolu}: ${ad} yok`);
  }

  // ---- rotalar ----
  const rotalar = csvAyristir(dosyalar['routes.txt'].toString('utf8'));
  const rotaNo = new Map(); // route_id → sıra
  const rotaAd = [];
  const guzergahtanRota = new Map(); // "34G_G_D0" → sıra
  const kisaAdtanRotalar = new Map(); // "34G" → [sıra]
  for (const r of rotalar) {
    const no = rotaAd.length;
    rotaNo.set(r.route_id, no);
    rotaAd.push(r.route_id);
    const guzergah = (r.route_code ?? '').trim().toUpperCase();
    if (guzergah) guzergahtanRota.set(guzergah, no);
    const kisa = (r.route_short_name ?? '').trim().toUpperCase();
    if (kisa) {
      if (!kisaAdtanRotalar.has(kisa)) kisaAdtanRotalar.set(kisa, []);
      kisaAdtanRotalar.get(kisa).push(no);
    }
  }

  // ---- duraklar ----
  const duraklar = csvAyristir(dosyalar['stops.txt'].toString('utf8'));
  const durakNo = new Map(); // stop_id → sıra
  const durakAd = [];
  const kodtanDurak = new Map(); // "100022" → sıra
  for (const s of duraklar) {
    const no = durakAd.length;
    durakNo.set(s.stop_id, no);
    durakAd.push(s.stop_id);
    const kod = (s.stop_code ?? '').trim();
    if (kod) kodtanDurak.set(kod, no);
  }

  // ---- servisler ----
  const servisler = dosyalar['calendar.txt'] ? servisleriCoz(csvAyristir(dosyalar['calendar.txt'].toString('utf8'))) : [];
  const servisNo = new Map(servisler.map((s, i) => [s.id, i]));

  // ---- seferler ----
  const seferler = csvAyristir(dosyalar['trips.txt'].toString('utf8'));
  const seferNo = new Map();
  const seferAd = [];
  const seferRota = new Int32Array(seferler.length);
  const seferServis = new Int32Array(seferler.length);
  const seferYon = new Uint8Array(seferler.length);
  for (const t of seferler) {
    const no = seferAd.length;
    seferNo.set(t.trip_id, no);
    seferAd.push(t.trip_id);
    seferRota[no] = rotaNo.get(t.route_id) ?? -1;
    seferServis[no] = servisNo.get(t.service_id) ?? -1;
    seferYon[no] = t.direction_id === '1' ? 1 : 0;
  }

  // ---- durak saatleri ----
  // Ham tamponu satır satır geziyoruz: 150 MB'lık metni dizgeye çevirmek gereksiz pahalı.
  const buf = dosyalar['stop_times.txt'];
  const tahmin = Math.ceil(buf.length / 24) + 16;
  let n = 0;
  const gSefer = new Int32Array(tahmin);
  const gDurak = new Int32Array(tahmin);
  const gSaniye = new Int32Array(tahmin);
  const gSira = new Int32Array(tahmin);

  let satirBasi = buf.indexOf(0x0a) + 1; // başlık satırını atla
  const metin = (bas, bit) => buf.toString('latin1', bas, bit);
  while (satirBasi < buf.length) {
    let satirSonu = buf.indexOf(0x0a, satirBasi);
    if (satirSonu < 0) satirSonu = buf.length;
    let bit = satirSonu;
    if (bit > satirBasi && buf[bit - 1] === 0x0d) bit--;

    if (bit > satirBasi) {
      // trip_id,stop_id,stop_sequence,arrival_time,departure_time,…
      const v1 = buf.indexOf(0x2c, satirBasi);
      const v2 = buf.indexOf(0x2c, v1 + 1);
      const v3 = buf.indexOf(0x2c, v2 + 1);
      const v4 = buf.indexOf(0x2c, v3 + 1);
      let v5 = buf.indexOf(0x2c, v4 + 1);
      if (v5 < 0 || v5 > bit) v5 = bit;
      if (v4 > 0 && v4 < bit) {
        const si = seferNo.get(metin(satirBasi, v1));
        const di = durakNo.get(metin(v1 + 1, v2));
        if (si !== undefined && di !== undefined) {
          gSefer[n] = si;
          gDurak[n] = di;
          gSira[n] = Number(metin(v2 + 1, v3));
          // kalkış saati (v4+1..v5); yoksa varış saatine düşülür
          const kalkis = saniyeCoz(buf, v4 + 1, v5);
          gSaniye[n] = kalkis >= 0 ? kalkis : saniyeCoz(buf, v3 + 1, v4);
          n++;
        }
      }
    }
    satirBasi = satirSonu + 1;
  }

  // Ara duraklara saat üret.
  //
  // İETT beslemesinde bir seferin yalnızca ilk ve son durağında saat var; aradakiler
  // boş. OTP bunları durak sırasına göre doğrusal ara değerliyor, biz de aynısını
  // yapıyoruz — yoksa aracın bulunduğu durakta karşılaştıracağımız bir plan olmuyor.
  // (İlk denemede seferlerin ancak %7'si eşleşmişti; sebebi buydu.)
  let aradeger = 0;
  let grupBas = 0;
  const grubuDoldur = (bas, bit) => {
    let onceki = -1; // bilinen son satırın indeksi
    for (let i = bas; i < bit; i++) {
      if (gSaniye[i] < 0) continue;
      if (onceki >= 0 && i - onceki > 1) {
        const adim = (gSaniye[i] - gSaniye[onceki]) / (gSira[i] - gSira[onceki]);
        for (let j = onceki + 1; j < i; j++) {
          gSaniye[j] = Math.round(gSaniye[onceki] + adim * (gSira[j] - gSira[onceki]));
          aradeger++;
        }
      }
      onceki = i;
    }
  };
  for (let i = 1; i <= n; i++) {
    if (i === n || gSefer[i] !== gSefer[grupBas]) {
      grubuDoldur(grupBas, i);
      grupBas = i;
    }
  }
  // İki ucundan biri bile bilinmeyen satırlar elenir: yanlış saatle eşleşmektense hiç eşleşmesin.
  let elenen = 0;
  {
    let yaz = 0;
    for (let i = 0; i < n; i++) {
      if (gSaniye[i] < 0) {
        elenen++;
        continue;
      }
      gSefer[yaz] = gSefer[i];
      gDurak[yaz] = gDurak[i];
      gSaniye[yaz] = gSaniye[i];
      gSira[yaz] = gSira[i];
      yaz++;
    }
    n = yaz;
  }

  // Durak numarasına göre sırala: CSR düzeni, her durağın satırları bitişik olsun.
  const durakSayac = new Int32Array(durakAd.length + 1);
  for (let i = 0; i < n; i++) durakSayac[gDurak[i] + 1]++;
  for (let i = 0; i < durakAd.length; i++) durakSayac[i + 1] += durakSayac[i];
  const durakBas = durakSayac; // kümülatif: [i, i+1) aralığı i. durağın satırları
  const yaz = Int32Array.from(durakBas.subarray(0, durakAd.length));
  const sSefer = new Int32Array(n);
  const sSaniye = new Int32Array(n);
  const sSira = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const yer = yaz[gDurak[i]]++;
    sSefer[yer] = gSefer[i];
    sSaniye[yer] = gSaniye[i];
    sSira[yer] = gSira[i];
  }

  return {
    guzergahtanRota,
    kisaAdtanRotalar,
    kodtanDurak,
    rotaAd,
    durakAd,
    seferAd,
    seferRota,
    seferServis,
    seferYon,
    servisler,
    durakBas,
    sSefer,
    sSaniye,
    sSira,
    sayilar: {
      rota: rotaAd.length,
      durak: durakAd.length,
      sefer: seferAd.length,
      durakSaati: n,
      aradeger,
      elenen,
    },
    kurulumMs: Date.now() - t0,
  };
}

/** Verilen tarihte çalışan servislerin bayrak dizisi. */
export function gununServisleri(tarife, tarih = new Date()) {
  const ymd =
    `${tarih.getFullYear()}` +
    `${String(tarih.getMonth() + 1).padStart(2, '0')}` +
    `${String(tarih.getDate()).padStart(2, '0')}`;
  const gun = tarih.getDay();
  return tarife.servisler.map((s) => s.gunler[gun] && s.bas <= ymd && ymd <= s.bit);
}

/**
 * Bir aracın hangi seferi yaptığını çıkarır.
 *
 * @param rotaIdx  güzergâh kodundan bulunan rota
 * @param durakIdx aracın en yakın durağı
 * @param saniye   gözlem anı (gün başından saniye)
 * @param aktif    gününServisleri() çıktısı
 * @param enFazlaSapma bu kadar saniyeden uzak bir eşleşme kabul edilmez
 * @returns {{sefer:number, planlanan:number, sira:number, sapma:number}|null}
 */
export function seferBul(tarife, rotaIdx, durakIdx, saniye, aktif, enFazlaSapma = 45 * 60) {
  const bas = tarife.durakBas[durakIdx];
  const bit = tarife.durakBas[durakIdx + 1];
  let enIyi = null;
  for (let i = bas; i < bit; i++) {
    const sefer = tarife.sSefer[i];
    if (tarife.seferRota[sefer] !== rotaIdx) continue;
    const servis = tarife.seferServis[sefer];
    if (servis < 0 || !aktif[servis]) continue;
    const planlanan = tarife.sSaniye[i];
    // Gece yarısını aşan tarife saatleri: 24:30 ile 00:30 aynı ana denk gelir.
    let sapma = planlanan - saniye;
    if (sapma > GUN / 2) sapma -= GUN;
    else if (sapma < -GUN / 2) sapma += GUN;
    if (Math.abs(sapma) > enFazlaSapma) continue;
    if (!enIyi || Math.abs(sapma) < Math.abs(enIyi.sapma)) {
      enIyi = { sefer, planlanan, sira: tarife.sSira[i], sapma };
    }
  }
  return enIyi;
}
