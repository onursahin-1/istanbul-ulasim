// Köprü sunucusu: İETT'yi izler, GTFS-RT üretir, OTP'ye sunar.
//
// İBB'nin kotası saatte 100 istek. Köprü kendine saatte 80 istek ayırıyor ve
// bunu bölüyor:
//   • Nabız (2 dakikada bir, tek istek) — bütün filonun taze konumu.
//   • Duyurular (15 dakikada bir, tek istek) — sefer iptali, güzergâh değişikliği.
//   • Tarama (kalan bütçe, ~80 saniyede bir hat) — hangi aracın hangi hatta olduğu.
// Öğrenilen "araç → hat" bilgisi diske yazılıyor; kapsama günden güne büyüyor.
//
// Kullanım (OTP'nin yanında):
//   npm start      (kopru klasöründe)
//
// Ortam değişkenleri:
//   GTFS_ZIP     İETT GTFS zip yolu (C:\otp\istanbul\istanbul-iett-gtfs.zip)
//   PORT         dinlenecek kapı (8082)
//   BUTCE        İBB'ye saatte en fazla istek (80; İBB'nin sınırı 100)
//   NABIZ        filo konumu tazeleme aralığı, saniye (120)
//   OGRENILEN    öğrenilenlerin dosyası (kopru\ogrenilen.json)
//
// Uç noktalar:
//   /arac-konumlari        GTFS-RT VehiclePosition  → OTP VEHICLE_POSITIONS
//   /sefer-guncellemeleri  GTFS-RT TripUpdate       → OTP STOP_TIME_UPDATER
//   /duyurular             İETT hat duyuruları, JSON → uygulama
//   /durum                 insan için JSON özet (varış doğruluğu ölçümü `kalite`de)
//
// Doğruluk ölçümü: kayit/kalite-YYYY-MM-DD.json, özet için `node kalite-rapor.mjs`.

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { butceyiBol, SaatlikButce } from './butce.mjs';
import { KaliteOlcer } from './kalite.mjs';
import { SegmentOgrenici } from './segment.mjs';
import { duyurulariDuzenle, duyurulariEslestir } from './duyuru.mjs';
import { sozlukKur } from './yazim.mjs';
import { ArizaHatasi, duyurular as duyurulariIste, filoKonumlari, hatlar as hatlariIste, Kapi, SinirHatasi } from './iett.mjs';
import { araclariEslestir, gecikmeAkisi, konumAkisi, SeferHafizasi } from './kopru.mjs';
import { oku, yaz } from './ogrenilen.mjs';
import { Tarayici, yogunlukTahmini } from './tarama.mjs';
import { tarifeyiKur } from './tarife.mjs';
import { KonumIzi } from './yon.mjs';

const KLASOR = dirname(fileURLToPath(import.meta.url));
const ZIP = process.env.GTFS_ZIP ?? 'C:\\otp\\istanbul\\istanbul-iett-gtfs.zip';
// 8080 OTP, 8081 Expo Metro. Köprü 8082'de duruyor.
const PORT = Number(process.env.PORT ?? 8082);
const BUTCE = Number(process.env.BUTCE ?? 80);
const NABIZ = Number(process.env.NABIZ ?? 120) * 1000;
const OGRENILEN = process.env.OGRENILEN ?? join(KLASOR, 'ogrenilen.json');
/** Son başarılı nabız bundan eskiyse boş akış yayımlanır: bayat gecikme, hiç gecikme göstermemekten kötü. */
const BAYAT_MS = 5 * 60_000;
const KAYIT_ARALIGI = 5 * 60_000;
const HAT_LISTESI_OMRU = 24 * 3_600_000;
const DUYURU_ARALIGI = 15 * 60_000;

if (BUTCE > 95) {
  console.error(`BUTCE=${BUTCE} çok yüksek: İBB'nin sınırı saatte 100 istek ve bizim görmediğimiz istekleri de sayıyor.`);
  process.exit(1);
}
if (!existsSync(ZIP)) {
  console.error(`GTFS zip bulunamadı: ${ZIP}\nGTFS_ZIP ortam değişkeniyle yolu verebilirsin.`);
  process.exit(1);
}

console.log(`tarife okunuyor: ${ZIP}`);
const tarife = tarifeyiKur(ZIP);
// Duyuru metinlerindeki özel adların doğru yazımı GTFS'teki durak ve hat adlarından.
const yazimSozlugu = sozlukKur([...tarife.durakAdlari, ...tarife.uzunAdlar.map((u) => u.uzun)]);
console.log(`  ${tarife.kurulumMs} ms · ${JSON.stringify(tarife.sayilar)}`);

const onceki = oku(OGRENILEN);
// Pay: günde bir hat listesi (2) + saatte dört duyuru isteği.
const pay = butceyiBol(BUTCE, NABIZ, 2 + Math.ceil(3_600_000 / DUYURU_ARALIGI));
const butce = new SaatlikButce({ saatte: BUTCE, gecmis: onceki.istekler ?? [] });
const kapi = new Kapi({ butce, kapaliyaKadar: onceki.kapaliyaKadar ?? 0 });
const tarayici = new Tarayici(kapi, { aralikMs: pay.taramaAralikMs, tahminiYogunluk: yogunlukTahmini(tarife) });
tarayici.yukle(onceki);
const hafiza = new SeferHafizasi();
// Varış tahminlerinin gerçekle karşılaştırması. Günlük dosyası kayit/ klasöründe.
const KAYIT_KLASORU = join(KLASOR, 'kayit');
// Otobüslerin durak arası gerçek yol süreleri (segment.mjs); diskten sürer.
const SEGMENT_DOSYASI = join(KAYIT_KLASORU, 'segment-sureleri.json');
const segment = new SegmentOgrenici(tarife);
if (existsSync(SEGMENT_DOSYASI)) {
  try {
    segment.yukle(JSON.parse(readFileSync(SEGMENT_DOSYASI, 'utf8')));
    console.log(`öğrenilen yol süreleri yüklendi: ${segment.ozet().kullanilir} durak arası kullanılabilir`);
  } catch (e) {
    console.error(`yol süreleri okunamadı: ${e.message}`);
  }
}
const kalite = new KaliteOlcer(tarife, segment);
const kaliteyiYaz = (veri = kalite.disaAktar()) => {
  if (!veri.gun) return;
  try {
    mkdirSync(KAYIT_KLASORU, { recursive: true });
    yaz(join(KAYIT_KLASORU, `kalite-${veri.gun}.json`), veri);
  } catch (e) {
    console.error(`kalite ölçümü yazılamadı: ${e.message}`);
  }
};
kalite.onGunBitti = () => kaliteyiYaz();
{
  // Gün içinde yeniden başlatılınca bugünün ölçümü kaldığı yerden sürsün.
  const bugun = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  const dosya = join(KAYIT_KLASORU, `kalite-${bugun}.json`);
  if (existsSync(dosya)) {
    try {
      if (kalite.yukle(JSON.parse(readFileSync(dosya, 'utf8')))) {
        console.log(`bugünün doğruluk ölçümü sürdürülüyor (${kalite.sayac.gozlem} gözlem)`);
      }
    } catch (e) {
      console.error(`doğruluk ölçümü okunamadı: ${e.message}`);
    }
  }
}
const iz = new KonumIzi();
let hatListesi = onceki.hatListesi ?? null;

console.log(
  `bütçe: saatte ${BUTCE} istek → ${pay.nabizSaatte} nabız + ${pay.taramaSaatte} hat taraması ` +
    `(${Math.round(pay.taramaAralikMs / 1000)} sn arayla)`,
);
if (tarayici.atama.size) console.log(`öğrenilenler yüklendi: ${tarayici.atama.size} aracın hattı biliniyor`);
const kullanilan = butce.kullanilan();
if (kullanilan) console.log(`son 60 dakikada zaten ${kullanilan} istek gitmiş; bütçe ona göre işliyor`);
if (kapi.kalanCeza()) console.log(`önceki çalışmadan kalan ceza: ${Math.round(kapi.kalanCeza() / 60_000)} dk`);

const durum = {
  baslatildi: new Date().toISOString(),
  sonNabiz: null,
  bayat: true,
  filoAraci: 0,
  sayac: null,
  eslesenSefer: 0,
  tarama: null,
  kapi: null,
  duyuru: null,
  kalite: null,
  segment: null,
  hata: null,
};

let duyuruListesi = { alindi: null, duyurular: [] };

const BOS_KONUM = () => konumAkisi([], new Date());
const BOS_GECIKME = () => gecikmeAkisi([], new Date());
let konumlar = BOS_KONUM();
let gecikmeler = BOS_GECIKME();
let sonBasari = 0;

async function hatlariTazele() {
  // Hat listesi seyrek değişir; günde bir yeter. Diskteki listeyle açılışta istek harcanmaz.
  // Eski kayıtlarda hat adları yok (duyurular için sonradan eklendi); onlar bir kez yenilenir.
  if (hatListesi?.adlar && Date.now() - hatListesi.alindi < HAT_LISTESI_OMRU) {
    if (!tarayici.hatlar.length) tarayici.hatlariAyarla(hatListesi.hatlar);
    return;
  }
  const liste = await hatlariIste(kapi);
  const hatlar = liste.map((h) => h.kod);
  hatListesi = { alindi: Date.now(), hatlar, adlar: liste.filter((h) => h.ad) };
  tarayici.hatlariAyarla(hatlar);
  console.log(`hat listesi: ${hatlar.length} hat (${hatListesi.adlar.length} adıyla)`);
}

function kaydet() {
  kaliteyiYaz();
  try {
    mkdirSync(KAYIT_KLASORU, { recursive: true });
    yaz(SEGMENT_DOSYASI, segment.disaAktar());
  } catch (e) {
    console.error(`yol süreleri yazılamadı: ${e.message}`);
  }
  try {
    yaz(OGRENILEN, {
      ...tarayici.disaAktar(),
      hatListesi,
      istekler: butce.disaAktar(),
      kapaliyaKadar: kapi.kapaliyaKadar,
    });
  } catch (e) {
    console.error(`öğrenilenler yazılamadı: ${e.message}`);
  }
}

function durumuTazele() {
  durum.tarama = tarayici.ozet();
  durum.kapi = {
    ...kapi.sayac,
    son60dk: butce.kullanilan(),
    butce: BUTCE,
    kalanCezaSn: Math.round(kapi.kalanCeza() / 1000),
    kalanArizaSn: Math.round(kapi.kalanAriza() / 1000),
    arizaNedeni: kapi.arizaNedeni || null,
  };
  durum.bayat = !sonBasari || Date.now() - sonBasari > BAYAT_MS;
  durum.kalite = kalite.rapor();
  durum.segment = segment.ozet();
}

let arizaYazildi = false;
let sonArizaSayisi = 0;

async function nabiz() {
  try {
    await hatlariTazele();
    const araclar = await filoKonumlari(kapi);
    const simdi = new Date();
    const { eslesenler, sayac } = araclariEslestir(tarife, araclar, hafiza, tarayici, simdi, iz);

    konumlar = konumAkisi(eslesenler, simdi);
    gecikmeler = gecikmeAkisi(eslesenler, simdi);
    sonBasari = simdi.getTime();
    segment.gozlem(eslesenler, simdi);
    kalite.gozlem(eslesenler, simdi);

    durum.sonNabiz = simdi.toISOString();
    durum.filoAraci = araclar.length;
    durum.sayac = sayac;
    durum.eslesenSefer = new Set(eslesenler.map((e) => e.seferId)).size;
    durum.hata = null;

    const t = tarayici.ozet();
    console.log(
      `${simdi.toLocaleTimeString('tr-TR')} · filo ${araclar.length} · hattı bilinen ${t.bilinenArac} · ` +
        `${eslesenler.length} eşleşti (${durum.eslesenSefer} sefer) · ` +
        `taranan hat ${t.sorulanHat}/${t.toplamHat} · son 60 dk ${butce.kullanilan()}/${BUTCE} istek`,
    );
    if (arizaYazildi) {
      console.log(`${simdi.toLocaleTimeString('tr-TR')} · İBB yeniden yanıt veriyor`);
      arizaYazildi = false;
    }
  } catch (e) {
    durum.hata = e instanceof SinirHatasi ? 'hız sınırı — geri çekiliyoruz' : e.message;
    const saat = new Date().toLocaleTimeString('tr-TR');
    if (e instanceof ArizaHatasi) {
      // Arıza beklemesinde nabız istek göndermeden düşüyor; her iki dakikada bir aynı
      // satırı yazmamak için yalnız gerçekten gönderilip düşen istekten sonra yazılır.
      if (kapi.sayac.ariza !== sonArizaSayisi) {
        sonArizaSayisi = kapi.sayac.ariza;
        arizaYazildi = true;
        console.error(`${saat} · nabız alınamadı: ${e.message}`);
      }
    } else {
      const kalan = Math.round(kapi.kalanCeza() / 60_000);
      console.error(`${saat} · nabız alınamadı: ${durum.hata}${kalan ? ` (${kalan} dk bekleniyor)` : ''}`);
    }
  } finally {
    durumuTazele();
  }
}

async function duyurulariTazele() {
  try {
    const liste = duyurulariEslestir(
      duyurulariDuzenle(await duyurulariIste(kapi), yazimSozlugu),
      hatListesi?.adlar ?? [],
      tarife.uzunAdlar,
    );
    duyuruListesi = { alindi: new Date().toISOString(), duyurular: liste };
    durum.duyuru = {
      alindi: duyuruListesi.alindi,
      sayi: liste.length,
      hattaBaglanamayan: liste.filter((d) => !d.kodlar.length).map((d) => d.hat),
    };
  } catch (e) {
    // Duyuru süs: alınamazsa eldeki liste kalır, nabız etkilenmez.
    durum.duyuru = { ...(durum.duyuru ?? {}), hata: e instanceof SinirHatasi ? 'hız sınırı' : e.message };
  }
}

function yanitla(cevap, govde, tur) {
  cevap.writeHead(200, { 'Content-Type': tur, 'Content-Length': govde.length, 'Cache-Control': 'no-store' });
  cevap.end(govde);
}

createServer((istek, cevap) => {
  const yol = (istek.url ?? '/').split('?')[0];
  const bayat = !sonBasari || Date.now() - sonBasari > BAYAT_MS;
  if (yol === '/arac-konumlari') return yanitla(cevap, bayat ? BOS_KONUM() : konumlar, 'application/x-protobuf');
  if (yol === '/sefer-guncellemeleri') return yanitla(cevap, bayat ? BOS_GECIKME() : gecikmeler, 'application/x-protobuf');
  if (yol === '/duyurular') {
    return yanitla(cevap, Buffer.from(JSON.stringify(duyuruListesi)), 'application/json; charset=utf-8');
  }
  if (yol === '/durum' || yol === '/') {
    durumuTazele();
    return yanitla(cevap, Buffer.from(JSON.stringify(durum, null, 2)), 'application/json; charset=utf-8');
  }
  cevap.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  cevap.end('Bilinmeyen adres. /durum, /arac-konumlari, /sefer-guncellemeleri, /duyurular\n');
}).listen(PORT, () => {
  console.log(`köprü http://localhost:${PORT} · nabız ${NABIZ / 1000} sn`);
});

// Nabzın kendi zamanlaması: bir nabız bütçe yüzünden beklerken yenisi üst üste binmesin.
async function nabizDongusu() {
  for (let ilk = true; ; ilk = false) {
    const bas = Date.now();
    await nabiz();
    // İlk duyuru turu ilk nabızdan sonra: hat adları (duyuruyu hatta bağlamak için) o zaman hazır.
    if (ilk) duyurulariTazele();
    await new Promise((r) => setTimeout(r, Math.max(5_000, NABIZ - (Date.now() - bas))));
  }
}

// Tarama arka planda kendi hızında döner; ikisi de aynı kapıdan, aynı bütçeden geçer.
tarayici.basla();
nabizDongusu();
setInterval(duyurulariTazele, DUYURU_ARALIGI);
setInterval(kaydet, KAYIT_ARALIGI);

for (const sinyal of ['SIGINT', 'SIGTERM']) {
  process.on(sinyal, () => {
    tarayici.dur();
    kaydet();
    console.log('öğrenilenler kaydedildi, köprü kapanıyor');
    process.exit(0);
  });
}
