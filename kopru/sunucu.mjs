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
//   NABIZ        filo konumu tazeleme aralığı, saniye (75)
//   OGRENILEN    öğrenilenlerin dosyası (kopru\ogrenilen.json)
//   TAHMIN       varış tahmini: ogrenilen | sabit (boş: ölçüme göre kendiliğinden; /durum'da `tahmin`)
//   VARIS_YONTEMI  durak ekranındaki araç tabanlı varış: tarife (varsayılan) | ogrenilen
//
// Uç noktalar:
//   /arac-konumlari        GTFS-RT VehiclePosition  → OTP VEHICLE_POSITIONS
//   /sefer-guncellemeleri  GTFS-RT TripUpdate       → OTP STOP_TIME_UPDATER
//   /duyurular             İETT hat duyuruları, JSON → uygulama
//   POST /ilgi             uygulamanın baktığı hatlar; hat taraması onları öne alır
//   POST /yolculuk-kaydi   geliştirme: yolculuk takibinin konum ve adım kaydı → kayit/yolculuklar/
//                          (köprünün o yolculuktaki hatlar için araç eşlemesi de her nabızda eklenir)
//   /araclar?hat=141M      bir hattın şu an eşlenen araçları: kapı no, sefer, gecikme (tanı için)
//   /durak-varislari?durak=ID[,ID]&hat=141M,97M
//                          araç tabanlı varış: durağa gelen her otobüs kaç dakikada (varis.mjs)
//   /teshis?durak=ID       tanı: bu duraktan geçen hatların her aracı sayıldı mı, sayılmadıysa
//                          neden; hatların taranma durumu; yakındaki hattı başka sanılan araçlar
//   /durum                 insan için JSON özet (varış doğruluğu ölçümü `kalite`de)
//
// Doğruluk ölçümü: kayit/kalite-YYYY-MM-DD.json, özet için `node kalite-rapor.mjs`.

import { createServer } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { butceyiBol, SaatlikButce } from './butce.mjs';
import { KaliteOlcer } from './kalite.mjs';
import { SegmentOgrenici } from './segment.mjs';
import { duyurulariDuzenle, duyurulariEslestir } from './duyuru.mjs';
import { sozlukKur } from './yazim.mjs';
import { ArizaHatasi, duyurular as duyurulariIste, filoKonumlari, hatlar as hatlariIste, Kapi, SinirHatasi } from './iett.mjs';
import { araclariEslestir, gecikmeAkisi, konumAkisi, SeferHafizasi, zamaniCoz } from './kopru.mjs';
import { oku, yaz } from './ogrenilen.mjs';
import { Tarayici, yogunlukTahmini } from './tarama.mjs';
import { seferDuraklari, tarifeyiKur } from './tarife.mjs';
import { AracVarislari, tarifedenKalkisBul, tarifedenYolBul } from './varis.mjs';
import { KonumIzi } from './yon.mjs';

const KLASOR = dirname(fileURLToPath(import.meta.url));
const ZIP = process.env.GTFS_ZIP ?? 'C:\\otp\\istanbul\\istanbul-iett-gtfs.zip';
// 8080 OTP, 8081 Expo Metro. Köprü 8082'de duruyor.
const PORT = Number(process.env.PORT ?? 8082);
const BUTCE = Number(process.env.BUTCE ?? 80);
// 75 sn: konum en fazla ~1,5 dk geride. Saatte 48 nabız, kalan ~26 istek hat taramasına
// (hangi araç hangi hatta). Araç–hat eşleşmesi bir hafta tutulduğu ve filonun çoğu birkaç
// günde öğrenildiği için tarama payı azalınca kapsama düşmüyor; konum tazeliği artıyor.
// Eski değer 120 sn idi (saatte 30 nabız + 44 tarama).
const NABIZ = Number(process.env.NABIZ ?? 75) * 1000;
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
// Araç tabanlı varış (sefer eşleştirmesinden bağımsız): durak ekranı ve bekleme kartı için.
// VARIS_YONTEMI: tarife (varsayılan; "Otobüsüm Nerede?" ile aynı) | ogrenilen (varis.mjs).
const VARIS_YONTEMI = process.env.VARIS_YONTEMI === 'ogrenilen' ? 'ogrenilen' : 'tarife';
const varislar = new AracVarislari(
  tarife,
  tarifedenYolBul(tarife, seferDuraklari),
  (a, b, anSn) => segment.sure(a, b, anSn),
  tarifedenKalkisBul(tarife),
  { yontem: VARIS_YONTEMI },
);
console.log(`varış tahmini: ${VARIS_YONTEMI === 'tarife' ? 'planlanan durak arası süreler' : 'öğrenilen süreler ve canlı trafik'}`);
// Varış tahmininin kendi ölçümü (gerçeğe uyan çarpanlar): diskten sürer.
const VARIS_DOSYASI = join(KAYIT_KLASORU, 'varis-olcumu.json');
if (existsSync(VARIS_DOSYASI)) {
  try {
    varislar.yukle(JSON.parse(readFileSync(VARIS_DOSYASI, 'utf8')));
  } catch (e) {
    console.error(`varış ölçümü okunamadı: ${e.message}`);
  }
}
/** GTFS durak kimliği → tarife sırası (uygulama "1:12345" gibi besleme önekiyle soruyor). */
const durakSirasi = new Map(tarife.durakAd.map((ad, i) => [ad, i]));

/** Canlı akışa hangi varış tahmini: TAHMIN ortam değişkeni ya da ölçüme göre kendiliğinden. */
function tahminKarari() {
  const elle = (process.env.TAHMIN ?? '').toLowerCase();
  if (elle === 'ogrenilen') return { ogrenilen: true, neden: 'TAHMIN=ogrenilen (elle)' };
  if (elle === 'sabit') return { ogrenilen: false, neden: 'TAHMIN=sabit (elle)' };
  return kalite.karar();
}
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
  /** Canlı akıştaki varış tahmini yöntemi ve nedeni. */
  tahmin: null,
  hata: null,
};

let duyuruListesi = { alindi: null, duyurular: [] };

const BOS_KONUM = () => konumAkisi([], new Date());
const BOS_GECIKME = () => gecikmeAkisi([], new Date());
let konumlar = BOS_KONUM();
/** Son nabzın eşlemesi ve anı: tanı uç noktası ve yolculuk kaydı için. */
let sonEslesenler = [];
/** Son nabzın ham filo konumları (teşhis: yakındaki araçlar). */
let sonFilo = [];
let sonNabizAn = 0;
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
    yaz(VARIS_DOSYASI, varislar.disaAktar());
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
  durum.varis = varislar.ozet();
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
    varislar.guncelle(
      araclar.map((a) => ({ ...a, tarih: zamaniCoz(a.saat, simdi)?.tarih ?? null })),
      eslesenler,
      (k) => tarayici.bilgi(k),
      simdi,
    );
    sonEslesenler = eslesenler;
    sonFilo = araclar;
    sonNabizAn = simdi.getTime();
    // Varış tahmini: öğrenilen yol süreleri, ölçüm onları sabit gecikmeden iyi bulduysa
    // (kalite.mjs, yontemKarari). TAHMIN=ogrenilen|sabit ile elle de seçilebilir.
    const karar = tahminKarari();
    gecikmeler = gecikmeAkisi(eslesenler, simdi, karar.ogrenilen ? (e) => segment.varislar(e) : null);
    durum.tahmin = karar;
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

/**
 * Uygulamanın ilgilendiği hatlar: { hatlar: ["500T", "34G"], kalici: false }. Hat
 * taraması bunları öne alıyor (tarama.mjs). Gövde küçük; büyüğü reddediliyor.
 */
function ilgiAl(istek, cevap) {
  let govde = '';
  istek.setEncoding('utf8');
  istek.on('data', (parca) => {
    govde += parca;
    if (govde.length > 8_000) istek.destroy();
  });
  istek.on('end', () => {
    let kabul = 0;
    try {
      const { hatlar, kalici } = JSON.parse(govde || '{}');
      kabul = tarayici.ilgiBildir(hatlar, kalici === true);
    } catch {
      cevap.writeHead(400);
      return cevap.end();
    }
    yanitla(cevap, Buffer.from(JSON.stringify({ kabul })), 'application/json; charset=utf-8');
  });
}

/** Yakındaki araç taraması için yarıçap (metre). */
const TESHIS_YARICAP_M = 1500;

/**
 * Bir durak için tanı: "Otobüsüm Nerede?"de görünen bir otobüs bizde neden yok ya da
 * neden farklı. Üç katman: (1) duraktan geçen hatların taranma durumu (ne zaman soruldu,
 * ilgide mi), (2) bu hatlara atanmış her aracın sonucu (varış ya da neden), (3) durağın
 * yakınında olup hattı başka bir hat sanılan ya da hiç bilinmeyen araçlar (bayat atama).
 */
function durakTeshisi(sira) {
  const simdi = Date.now();
  const { hatlar, araclar } = varislar.teshis(sira, simdi);
  const dk = (an) => (an ? Math.round((simdi - an) / 60_000) : null);
  const hatDurumu = Object.fromEntries(
    hatlar.map((h) => {
      const kanonik = tarayici.hatlar.find((x) => String(x).toLocaleUpperCase('tr-TR') === h) ?? h;
      const d = tarayici.hatDurumu.get(kanonik);
      const ilgi = tarayici.ilgi.get(kanonik);
      return [
        h,
        {
          sonTaramaDkOnce: d?.soruldu ? dk(d.sonBakilan) : null,
          aracSayisi: d?.aracSayisi ?? null,
          ilgide: ilgi != null && simdi - ilgi <= 45 * 60_000,
          kalici: tarayici.kalici.has(kanonik),
        },
      ];
    }),
  );
  const listede = new Set(araclar.map((a) => a.kapiNo));
  const enlem = tarife.durakEnlem[sira];
  const boylam = tarife.durakBoylam[sira];
  const olcek = Math.cos((enlem * Math.PI) / 180);
  const yakindaki = [];
  for (const a of sonFilo) {
    if (!a.kapiNo || listede.has(a.kapiNo) || !Number.isFinite(a.enlem)) continue;
    const metre = Math.hypot(a.enlem - enlem, (a.boylam - boylam) * olcek) * 111_320;
    if (metre > TESHIS_YARICAP_M) continue;
    const b = tarayici.bilgi(a.kapiNo);
    yakindaki.push({
      kapiNo: a.kapiNo,
      metre: Math.round(metre),
      bilinenHat: b?.hat ?? null,
      guzergah: b?.guzergah ?? null,
      ogrenmeDkOnce: b ? dk(b.an) : null,
    });
  }
  yakindaki.sort((x, y) => x.metre - y.metre);
  return {
    nabiz: sonNabizAn ? new Date(sonNabizAn).toISOString() : null,
    durak: tarife.durakAd[sira],
    hatlar: hatDurumu,
    araclar: araclar.map((a) => {
      const b = tarayici.bilgi(a.kapiNo);
      return { ...a, guzergah: b?.guzergah ?? null, ogrenmeDkOnce: b ? dk(b.an) : null };
    }),
    yakindakiBaskaHat: yakindaki,
  };
}

const saatYaz = (sn) => {
  const g = ((Math.round(sn) % 86400) + 86400) % 86400;
  return `${String(Math.floor(g / 3600)).padStart(2, '0')}:${String(Math.floor((g % 3600) / 60)).padStart(2, '0')}`;
};

/**
 * Bir hattın son nabızda eşlenen araçları: hangi kapı numarası hangi sefere bağlandı,
 * seferin o noktadaki tarife saati ve gecikme. "22 dk gecikmeli" gibi bir tahminin
 * gerçek mi yoksa aracın yanlış (önceki) sefere bağlanması mı olduğunu görmek için.
 */
function hatAraclari(kisaAd) {
  const rotalar = new Set(tarife.kisaAdtanRotalar.get(String(kisaAd ?? '').trim().toUpperCase()) ?? []);
  return sonEslesenler
    .filter((e) => rotalar.has(e.rotaIdx))
    .map((e) => ({
      kapiNo: e.kapiNo,
      seferId: e.seferId,
      rotaId: e.rotaId,
      yon: e.yon,
      durakId: e.durakId,
      sira: e.sira,
      tarifeSaati: saatYaz(e.planlanan),
      gecikmeDk: Math.round(e.gecikme / 60),
      eslesme: e.yoldan,
      konumSaati: new Date(e.damga * 1000).toISOString(),
      enlem: e.enlem,
      boylam: e.boylam,
    }));
}

/** Yolculuk kaydı başına: hangi hatlar izleniyor, en son hangi nabız yazıldı. */
const yolculukHatlari = new Map();

// Geliştirme: uygulamanın yolculuk takibi kaydı. Her olay bir satır; dosya yolculuk başına.
function yolculukKaydiAl(istek, cevap) {
  let govde = '';
  istek.setEncoding('utf8');
  istek.on('data', (parca) => {
    govde += parca;
    if (govde.length > 4_000_000) istek.destroy();
  });
  istek.on('end', () => {
    try {
      const { kimlik, olaylar } = JSON.parse(govde || '{}');
      if (typeof kimlik !== 'string' || !/^[0-9-]{10,24}$/.test(kimlik) || !Array.isArray(olaylar)) throw new Error();
      const klasor = join(KAYIT_KLASORU, 'yolculuklar');
      mkdirSync(klasor, { recursive: true });
      // Yolculuğun hatları: başlangıçtaki güzergâhtan, yolda değişen hattan.
      const kayit = yolculukHatlari.get(kimlik) ?? { hatlar: new Set(), nabiz: 0 };
      for (const o of olaylar) {
        if (o?.tur === 'basla') {
          for (const b of o.guzergah?.legs ?? []) if (b?.transitLeg && b.route?.shortName) kayit.hatlar.add(b.route.shortName);
        }
        if (o?.tur === 'hat-degisti' && o.kisaAd) kayit.hatlar.add(o.kisaAd);
      }
      const satirlar = olaylar.map((o) => JSON.stringify(o));
      // Köprünün o andaki eşlemesi (nabız değiştiyse): kayıt masada köprüyle birlikte okunsun.
      if (kayit.hatlar.size && sonNabizAn && sonNabizAn !== kayit.nabiz) {
        kayit.nabiz = sonNabizAn;
        const hatlar = Object.fromEntries([...kayit.hatlar].map((h) => [h, hatAraclari(h)]));
        satirlar.push(JSON.stringify({ t: Date.now(), tur: 'kopru-araclar', nabiz: new Date(sonNabizAn).toISOString(), hatlar }));
      }
      yolculukHatlari.set(kimlik, kayit);
      if (yolculukHatlari.size > 50) yolculukHatlari.delete(yolculukHatlari.keys().next().value);
      appendFileSync(join(klasor, `${kimlik}.jsonl`), satirlar.join('\n') + '\n');
      yanitla(cevap, Buffer.from(JSON.stringify({ kabul: olaylar.length })), 'application/json; charset=utf-8');
    } catch {
      cevap.writeHead(400);
      cevap.end();
    }
  });
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
  if (yol === '/ilgi' && istek.method === 'POST') return ilgiAl(istek, cevap);
  if (yol === '/yolculuk-kaydi' && istek.method === 'POST') return yolculukKaydiAl(istek, cevap);
  if (yol === '/durak-varislari') {
    const sorgu = new URL(istek.url ?? '/', 'http://x').searchParams;
    const hatlar = (sorgu.get('hat') ?? '')
      .split(',')
      .map((h) => h.trim().toUpperCase())
      .filter(Boolean);
    const simdiMs = Date.now();
    const bayatMi = !sonBasari || simdiMs - sonBasari > BAYAT_MS;
    const duraklar = {};
    for (const id of (sorgu.get('durak') ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12)) {
      const sira = durakSirasi.get(id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : id);
      duraklar[id] = sira == null || bayatMi ? {} : varislar.durakVarislari(sira, simdiMs, hatlar.length ? new Set(hatlar) : null);
    }
    const govde = { nabiz: sonNabizAn ? new Date(sonNabizAn).toISOString() : null, bayat: bayatMi, duraklar };
    return yanitla(cevap, Buffer.from(JSON.stringify(govde)), 'application/json; charset=utf-8');
  }
  if (yol === '/teshis') {
    const id = new URL(istek.url ?? '/', 'http://x').searchParams.get('durak') ?? '';
    const sira = durakSirasi.get(id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : id);
    const govde = sira == null ? { hata: 'durak bulunamadı' } : durakTeshisi(sira);
    return yanitla(cevap, Buffer.from(JSON.stringify(govde, null, 2)), 'application/json; charset=utf-8');
  }
  if (yol === '/araclar') {
    const hat = new URL(istek.url ?? '/', 'http://x').searchParams.get('hat') ?? '';
    const govde = { hat, nabiz: sonNabizAn ? new Date(sonNabizAn).toISOString() : null, araclar: hatAraclari(hat) };
    return yanitla(cevap, Buffer.from(JSON.stringify(govde, null, 2)), 'application/json; charset=utf-8');
  }
  if (yol === '/duyurular') {
    return yanitla(cevap, Buffer.from(JSON.stringify(duyuruListesi)), 'application/json; charset=utf-8');
  }
  if (yol === '/durum' || yol === '/') {
    durumuTazele();
    return yanitla(cevap, Buffer.from(JSON.stringify(durum, null, 2)), 'application/json; charset=utf-8');
  }
  cevap.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  cevap.end('Bilinmeyen adres. /durum, /araclar?hat=141M, /durak-varislari?durak=ID, /arac-konumlari, /sefer-guncellemeleri, /duyurular\n');
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
