// Köprü sunucusu: İETT'yi düzenli tarar, GTFS-RT üretir, OTP'ye sunar.
//
// Kullanım (bilgisayarda, OTP'nin yanında):
//   node kopru/sunucu.mjs
//
// Ortam değişkenleri:
//   GTFS_ZIP   İETT GTFS zip yolu (varsayılan C:\otp\istanbul\istanbul-iett-gtfs.zip)
//   PORT       dinlenecek kapı (varsayılan 8082 — 8081 Expo'nun, 8080 OTP'nin)
//   ARALIK     tarama aralığı, saniye (varsayılan 45)
//   ESZAMANLI  aynı anda kaç İETT isteği (varsayılan 10)
//
// Uç noktalar:
//   /arac-konumlari        GTFS-RT VehiclePosition  → OTP "vehicle-positions"
//   /sefer-guncellemeleri  GTFS-RT TripUpdate       → OTP "stop-time-updater"
//   /durum                 insan için JSON özet

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

import { butunFilo, hatKodlari } from './iett.mjs';
import { araclariEslestir, gecikmeAkisi, konumAkisi, SeferHafizasi } from './kopru.mjs';
import { tarifeyiKur } from './tarife.mjs';

const ZIP = process.env.GTFS_ZIP ?? 'C:\\otp\\istanbul\\istanbul-iett-gtfs.zip';
// 8080 OTP, 8081 Expo Metro. Köprü 8082'de duruyor.
const PORT = Number(process.env.PORT ?? 8082);
const ARALIK = Number(process.env.ARALIK ?? 45) * 1000;
const ESZAMANLI = Number(process.env.ESZAMANLI ?? 10);

if (!existsSync(ZIP)) {
  console.error(`GTFS zip bulunamadı: ${ZIP}\nGTFS_ZIP ortam değişkeniyle yolu verebilirsin.`);
  process.exit(1);
}

console.log(`tarife okunuyor: ${ZIP}`);
const tarife = tarifeyiKur(ZIP);
console.log(`  ${tarife.kurulumMs} ms · ${JSON.stringify(tarife.sayilar)}`);

const hafiza = new SeferHafizasi();

const durum = {
  baslatildi: new Date().toISOString(),
  sonTarama: null,
  sonSure: null,
  hatSayisi: 0,
  hataliHat: 0,
  hatalar: [],
  sayac: null,
  eslesenSefer: 0,
  hata: null,
};

let konumlar = konumAkisi([], new Date());
let gecikmeler = gecikmeAkisi([], new Date());
let hatlar = [];
let hatlarAlindi = 0;

async function hatlariTazele() {
  // Hat listesi seyrek değişir; günde bir yenilemek yeterli.
  if (hatlar.length && Date.now() - hatlarAlindi < 24 * 3600 * 1000) return;
  hatlar = await hatKodlari();
  hatlarAlindi = Date.now();
  durum.hatSayisi = hatlar.length;
  console.log(`hat listesi yenilendi: ${hatlar.length} hat`);
}

async function tara() {
  try {
    await hatlariTazele();
    const { araclar, hata, hatalar, sure } = await butunFilo(hatlar, ESZAMANLI);
    const simdi = new Date();
    const { eslesenler, sayac } = araclariEslestir(tarife, araclar, hafiza, simdi);

    konumlar = konumAkisi(eslesenler, simdi);
    gecikmeler = gecikmeAkisi(eslesenler, simdi);

    durum.sonTarama = simdi.toISOString();
    durum.sonSure = sure;
    durum.hataliHat = hata;
    durum.hatalar = hatalar;
    durum.sayac = sayac;
    durum.eslesenSefer = new Set(eslesenler.map((e) => e.seferId)).size;
    durum.hata = null;

    const gec = eslesenler.filter((e) => e.gecikme > 120).length;
    const erken = eslesenler.filter((e) => e.gecikme < -120).length;
    console.log(
      `${simdi.toLocaleTimeString('tr-TR')} · ${sayac.toplam} araç → ${eslesenler.length} eşleşti ` +
        `(${durum.eslesenSefer} sefer) · ${gec} geç, ${erken} erken · ${Math.round(sure / 1000)} sn` +
        (hata ? ` · ${hata} hatlı hata` : ''),
    );
    // Hata varsa sebebini de yaz: sessizce boş dönen bir köprü teşhis edilemez.
    for (const h of hatalar.slice(0, 3)) {
      console.log(`   ↳ ${h.sayi} hatta: ${h.sebep}   (örnek hat: ${h.ornekHat})`);
    }
  } catch (e) {
    durum.hata = e.message;
    console.error('tarama hatası:', e.message);
  }
}

function yanitla(cevap, govde, tur) {
  cevap.writeHead(200, {
    'Content-Type': tur,
    'Content-Length': govde.length,
    'Cache-Control': 'no-store',
  });
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
  console.log(`köprü http://localhost:${PORT} · her ${ARALIK / 1000} saniyede bir tarıyor`);
});

await tara();
setInterval(tara, ARALIK);
