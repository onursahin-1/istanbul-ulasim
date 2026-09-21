// Köprü sunucusu: İETT'yi izler, GTFS-RT üretir, OTP'ye sunar.
//
// İki hızda çalışıyor:
//   • Nabız (varsayılan 40 sn, TEK istek) — bütün filonun taze konumu.
//   • Tarama (arka planda, yavaş) — hangi aracın hangi güzergâhta olduğu.
//
// Bu ayrım bir zorunluluk: İBB'nin ağ geçidi hız sınırlı ve hat hat sormak pahalı.
// İlk tasarım 784 hattı 45 saniyede bir tarıyordu ve kapıyı kapattırdı.
//
// Kullanım (OTP'nin yanında):
//   node kopru/sunucu.mjs
//
// Ortam değişkenleri:
//   GTFS_ZIP        İETT GTFS zip yolu
//   PORT            dinlenecek kapı (8082)
//   NABIZ           filo konumu tazeleme aralığı, saniye (40)
//   DAKIKADA        İBB'ye dakikada en fazla kaç istek (18)
//
// Uç noktalar:
//   /arac-konumlari        GTFS-RT VehiclePosition  → OTP "vehicle-positions"
//   /sefer-guncellemeleri  GTFS-RT TripUpdate       → OTP "stop-time-updater"
//   /durum                 insan için JSON özet

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

import { filoKonumlari, hatKodlari, Kapi, SinirHatasi } from './iett.mjs';
import { araclariEslestir, gecikmeAkisi, konumAkisi, SeferHafizasi } from './kopru.mjs';
import { Tarayici } from './tarama.mjs';
import { tarifeyiKur } from './tarife.mjs';

const ZIP = process.env.GTFS_ZIP ?? 'C:\\otp\\istanbul\\istanbul-iett-gtfs.zip';
// 8080 OTP, 8081 Expo Metro. Köprü 8082'de duruyor.
const PORT = Number(process.env.PORT ?? 8082);
const NABIZ = Number(process.env.NABIZ ?? 40) * 1000;
const DAKIKADA = Number(process.env.DAKIKADA ?? 18);

if (!existsSync(ZIP)) {
  console.error(`GTFS zip bulunamadı: ${ZIP}\nGTFS_ZIP ortam değişkeniyle yolu verebilirsin.`);
  process.exit(1);
}

console.log(`tarife okunuyor: ${ZIP}`);
const tarife = tarifeyiKur(ZIP);
console.log(`  ${tarife.kurulumMs} ms · ${JSON.stringify(tarife.sayilar)}`);

const kapi = new Kapi({ dakikadaEnFazla: DAKIKADA });
const tarayici = new Tarayici(kapi);
const hafiza = new SeferHafizasi();

const durum = {
  baslatildi: new Date().toISOString(),
  sonNabiz: null,
  filoAraci: 0,
  sayac: null,
  eslesenSefer: 0,
  tarama: null,
  kapi: null,
  hata: null,
};

let konumlar = konumAkisi([], new Date());
let gecikmeler = gecikmeAkisi([], new Date());
let hatlarAlindi = 0;

async function hatlariTazele() {
  // Hat listesi seyrek değişir; günde bir yenilemek yeterli.
  if (tarayici.hatlar.length && Date.now() - hatlarAlindi < 24 * 3600 * 1000) return;
  const hatlar = await hatKodlari(kapi);
  tarayici.hatlariAyarla(hatlar);
  hatlarAlindi = Date.now();
  console.log(`hat listesi: ${hatlar.length} hat`);
}

async function nabiz() {
  try {
    await hatlariTazele();
    const araclar = await filoKonumlari(kapi);
    const simdi = new Date();
    const { eslesenler, sayac } = araclariEslestir(tarife, araclar, hafiza, tarayici, simdi);

    konumlar = konumAkisi(eslesenler, simdi);
    gecikmeler = gecikmeAkisi(eslesenler, simdi);

    durum.sonNabiz = simdi.toISOString();
    durum.filoAraci = araclar.length;
    durum.sayac = sayac;
    durum.eslesenSefer = new Set(eslesenler.map((e) => e.seferId)).size;
    durum.hata = null;

    const gec = eslesenler.filter((e) => e.gecikme > 120).length;
    const erken = eslesenler.filter((e) => e.gecikme < -120).length;
    const t = tarayici.ozet();
    console.log(
      `${simdi.toLocaleTimeString('tr-TR')} · filo ${araclar.length} · hattı bilinen ${t.bilinenArac} · ` +
        `${eslesenler.length} eşleşti (${durum.eslesenSefer} sefer) · ${gec} geç, ${erken} erken · ` +
        `tarama ${t.hatSoruldu} hat${t.sinir ? ` · ${t.sinir} sınır` : ''}`,
    );
  } catch (e) {
    durum.hata = e instanceof SinirHatasi ? 'hız sınırı — geri çekiliyoruz' : e.message;
    const kalan = Math.round(kapi.kalanCeza() / 1000);
    console.error(`nabız: ${durum.hata}${kalan ? ` (${kalan} sn bekleniyor)` : ''}`);
  } finally {
    durum.tarama = tarayici.ozet();
    durum.kapi = { ...kapi.sayac, kalanCezaSn: Math.round(kapi.kalanCeza() / 1000) };
  }
}

function yanitla(cevap, govde, tur) {
  cevap.writeHead(200, { 'Content-Type': tur, 'Content-Length': govde.length, 'Cache-Control': 'no-store' });
  cevap.end(govde);
}

createServer((istek, cevap) => {
  const yol = (istek.url ?? '/').split('?')[0];
  if (yol === '/arac-konumlari') return yanitla(cevap, konumlar, 'application/x-protobuf');
  if (yol === '/sefer-guncellemeleri') return yanitla(cevap, gecikmeler, 'application/x-protobuf');
  if (yol === '/durum' || yol === '/') {
    return yanitla(cevap, Buffer.from(JSON.stringify(durum, null, 2)), 'application/json; charset=utf-8');
  }
  cevap.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  cevap.end('Bilinmeyen adres. /durum, /arac-konumlari, /sefer-guncellemeleri\n');
}).listen(PORT, () => {
  console.log(`köprü http://localhost:${PORT} · nabız ${NABIZ / 1000} sn · İBB'ye dakikada en fazla ${DAKIKADA} istek`);
});

// Tarama arka planda kendi hızında döner; nabızla yarışmaz, ikisi de aynı kapıdan geçer.
tarayici.basla();
await nabiz();
setInterval(nabiz, NABIZ);

for (const sinyal of ['SIGINT', 'SIGTERM']) {
  process.on(sinyal, () => {
    tarayici.dur();
    process.exit(0);
  });
}
