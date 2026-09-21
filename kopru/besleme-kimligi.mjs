// OTP'ye hangi beslemelerin yüklü olduğunu sorar.
//
// PowerShell'de curl ile JSON göndermek tırnak işkencesi; bu betik onu atlatıyor.
// Kullanım: node kopru/besleme-kimligi.mjs [otp-adresi]

const ADRES = process.argv[2] ?? 'http://localhost:8080';

const yanit = await fetch(`${ADRES}/otp/gtfs/v1`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: '{ feeds { feedId agencies { name } } }' }),
}).catch((e) => {
  console.error(`${ADRES} adresine ulaşılamadı: ${e.message}\nOTP açık mı?`);
  process.exit(1);
});

const veri = await yanit.json();
const beslemeler = veri?.data?.feeds ?? [];
if (!beslemeler.length) {
  console.log('Besleme bulunamadı. Ham cevap:', JSON.stringify(veri).slice(0, 400));
  process.exit(1);
}
for (const b of beslemeler) {
  const kurumlar = (b.agencies ?? []).map((a) => a.name).join(', ');
  console.log(`feedId ${b.feedId}  ←  ${kurumlar || '(kurum yok)'}`);
}
