// Metro İstanbul'un gerçek sefer tarifelerini indirir.
//
// İBB'nin raylı sistem GTFS'i 2023'ten beri güncellenmiyor; metro saatleri o yüzden
// yaklaşık. Metro İstanbul'un mobil uygulamasının kullandığı servis istasyon istasyon
// gerçek kalkış saatlerini veriyor. Bu betik hat, istasyon, yön ve her istasyonun her
// yöndeki kalkışlarını (hafta içi, cumartesi, pazar) tek bir JSON'a indirir.
// Tarifeyi GTFS'e işleyen ayrı betik: metro-tarife-uygula.py.
//
// Servis yalnız bu bilgisayardan erişilebiliyor (bulut ortamından 403), bu yüzden
// senin çalıştırman gerekiyor. ~2000 istek, istekler arasında kısa bekleme: 10 dk kadar.
//
// Kullanım (Node 18+):
//   node veri\metro-tarife-indir.mjs C:\otp\metro-tarife.json

import { writeFileSync } from 'node:fs';

const TABAN = 'https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile';
const CIKTI = process.argv[2] ?? 'metro-tarife.json';
const ARALIK_MS = 250;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

let istekSayisi = 0;
async function iste(yol, govde) {
  for (let deneme = 1; ; deneme++) {
    istekSayisi++;
    await bekle(ARALIK_MS);
    try {
      const yanit = await fetch(`${TABAN}${yol}`, {
        method: govde ? 'POST' : 'GET',
        headers: govde ? { 'Content-Type': 'application/json' } : {},
        body: govde ? JSON.stringify(govde) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (yanit.status >= 500 && deneme < 4) throw new Error(`HTTP ${yanit.status}`);
      const veri = await yanit.json();
      return veri?.Success ? veri.Data : null;
    } catch (e) {
      if (deneme >= 4) {
        console.error(`  ${yol}: ${e.message}`);
        return null;
      }
      await bekle(2000 * deneme);
    }
  }
}

/** Tarifesi alınacak günler: gelecek pazartesi, cumartesi ve pazar (öğle, İstanbul). */
function gunler() {
  const bugun = new Date();
  const sonraki = (haftaGunu) => {
    const d = new Date(bugun);
    d.setDate(d.getDate() + ((haftaGunu - d.getDay() + 7) % 7 || 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00`;
  };
  return { haftaici: sonraki(1), cumartesi: sonraki(6), pazar: sonraki(0) };
}

async function main() {
  const baslangic = Date.now();
  const hatlar = (await iste('/V2/GetLines')) ?? [];
  if (!hatlar.length) throw new Error('Hat listesi alınamadı. İnternet bağlantısını ve servisin açık olduğunu kontrol et.');
  const gun = gunler();
  const sonuc = { indirildi: new Date().toISOString(), gunler: gun, hatlar: [] };
  const durumlar = (await iste('/V2/GetServiceStatuses')) ?? [];

  for (const h of hatlar) {
    const istasyonlar = ((await iste(`/V2/GetStationById/${h.Id}`)) ?? []).map((s) => ({
      id: s.Id,
      ad: s.Description ?? s.Name,
      kod: s.Name,
      sira: s.Order,
      aktif: s.IsActive,
      lat: Number(s.DetailInfo?.Latitude),
      lon: Number(s.DetailInfo?.Longitude),
    }));
    const yonler = ((await iste(`/V2/GetDirectionById/${h.Id}`)) ?? []).map((y) => ({
      id: y.DirectionId,
      ad: y.DirectionName,
      deger: y.DirectionValue,
    }));
    const hat = {
      id: h.Id,
      ad: h.Name,
      durum: durumlar.filter((d) => d.LineId === h.Id && d.IsActive).map((d) => d.Description),
      istasyonlar,
      yonler: [],
    };
    process.stdout.write(`${h.Name}: ${istasyonlar.length} istasyon, ${yonler.length} yön `);
    for (const y of yonler) {
      const yon = { ...y, kalkislar: {} };
      for (const ist of istasyonlar) {
        for (const [gunAdi, tarih] of Object.entries(gun)) {
          const veri = await iste('/V3/GetTimeTable', { boardingStationId: ist.id, directionId: y.id, dateTime: tarih });
          const t = veri?.[0];
          const saatler = t?.TimeInfos?.Times ?? [];
          // Bu yönde bu istasyondan kalkış yoksa (yönün dışında) öbür günleri sormaya gerek yok.
          if (!saatler.length && gunAdi === 'haftaici') break;
          if (!saatler.length) continue;
          yon.kalkislar[ist.id] ??= { ilk: t.FirstStation, son: t.LastStation };
          yon.kalkislar[ist.id][gunAdi] = saatler;
        }
      }
      hat.yonler.push(yon);
      process.stdout.write('.');
    }
    process.stdout.write('\n');
    sonuc.hatlar.push(hat);
    // Ara kayıt: yarıda kesilirse emek boşa gitmesin.
    writeFileSync(CIKTI, JSON.stringify(sonuc));
  }
  writeFileSync(CIKTI, JSON.stringify(sonuc));
  const dk = Math.round((Date.now() - baslangic) / 60_000);
  console.log(`\n${sonuc.hatlar.length} hat, ${istekSayisi} istek, ${dk} dk → ${CIKTI}`);
}

main().catch((e) => {
  console.error(`Hata: ${e.message}`);
  process.exitCode = 1;
});
