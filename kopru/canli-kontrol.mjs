// Canlı verinin köprüden OTP'ye, OTP'den uygulamanın kullandığı API'ye
// gerçekten ulaştığını gösterir.
//
// Köprünün o anda yayımladığı seferlerden birkaçını alır, aynı seferleri OTP'ye
// sorar ve sıradaki durak için planlı saatle canlı saati yan yana yazar. Uygulama
// canlı saati "realtimeDeparture" alanından okuyor; burada o alan dolu ve
// planlıdan farklıysa zincir baştan sona çalışıyor demektir.
//
// Kullanım (köprü ve OTP açıkken):
//   node kopru\canli-kontrol.mjs [kaç-sefer] [besleme-kimliği]
// Varsayılanlar: 8 sefer · besleme 1

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const ADET = Number(process.argv[2] ?? 8);
const BESLEME = process.argv[3] ?? '1';
const KOPRU = 'http://localhost:8082';
const OTP = 'http://localhost:8080';

const SORGU = `query Sefer($id: String!) {
  trip(id: $id) {
    gtfsId tripHeadsign
    route { shortName }
    stoptimes { stop { name } scheduledDeparture realtimeDeparture departureDelay realtime realtimeState serviceDay }
  }
}`;

const saat = (gun, sn) => {
  const d = new Date((gun + sn) * 1000);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
};
const dakika = (sn) => `${sn >= 0 ? '+' : ''}${Math.round(sn / 60)} dk`;

let ham;
try {
  ham = new Uint8Array(await (await fetch(`${KOPRU}/sefer-guncellemeleri`)).arrayBuffer());
} catch (e) {
  console.error(`Köprüye ulaşılamadı (${KOPRU}): ${e.message}\nKöprü açık mı? (kopru klasöründe npm start)`);
  process.exit(1);
}
const mesaj = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(ham);
const guncellemeler = mesaj.entity.map((e) => e.tripUpdate).filter(Boolean);
console.log(`Köprü şu an ${guncellemeler.length} sefer için gecikme yayımlıyor.\n`);
if (!guncellemeler.length) {
  console.log('Henüz yayımlanan sefer yok. Tarama hatları öğrendikçe gelecek; birkaç dakika sonra tekrar dene.');
  process.exit(0);
}

let canli = 0;
let sorulan = 0;
for (const g of guncellemeler.slice(0, ADET)) {
  sorulan++;
  const kimlik = `${BESLEME}:${g.trip.tripId}`;
  let sefer;
  try {
    const yanit = await fetch(`${OTP}/otp/gtfs/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: SORGU, variables: { id: kimlik } }),
    });
    sefer = (await yanit.json())?.data?.trip;
  } catch (e) {
    console.error(`OTP'ye ulaşılamadı (${OTP}): ${e.message}`);
    process.exit(1);
  }
  if (!sefer) {
    console.log(`✗ ${kimlik}: OTP bu seferi tanımıyor (besleme kimliği yanlış olabilir)`);
    continue;
  }
  const simdi = Date.now() / 1000;
  // Sıradaki durak: canlı kalkışı henüz geçmemiş ilk durak.
  const sirada = sefer.stoptimes.find((s) => s.serviceDay + (s.realtimeDeparture ?? s.scheduledDeparture) >= simdi)
    ?? sefer.stoptimes.at(-1);
  const hat = sefer.route?.shortName ?? '?';
  const yon = sefer.tripHeadsign ?? '';
  const planli = saat(sirada.serviceDay, sirada.scheduledDeparture);
  const gercek = saat(sirada.serviceDay, sirada.realtimeDeparture);
  const isaret = sirada.realtime ? '●' : '○';
  if (sirada.realtime) canli++;
  console.log(
    `${isaret} ${hat.padEnd(6)} ${yon.slice(0, 26).padEnd(26)} ${sirada.stop.name.slice(0, 24).padEnd(24)} ` +
      `planlı ${planli} → ${sirada.realtime ? `canlı ${gercek} (${dakika(sirada.departureDelay)})` : 'canlı veri yok'}`,
  );
}
console.log(`\n${canli}/${sorulan} seferde OTP canlı saat veriyor.`);
console.log(canli ? 'Zincir çalışıyor: köprü → OTP → uygulamanın kullandığı API.' : 'OTP seferleri tanıyor ama canlı saat yok; çıktıyı paylaş.');
