// İBB'nin kapısı açık mı? TEK istekle bakar.
//
// İBB'nin kotası saatte 100 istek ve bu betiğin istekleri de sayılıyor. Eski
// sürüm her çalıştırmada 21 istek atıyordu, yani kotanın beşte birini; kapının
// neden kapandığını anlamaya çalışırken kapanmasına katkıda bulunuyordu.
//
// Köprü açıkken çalıştırma: köprü bu isteği göremez, ikisinin toplamı kotayı
// aşabilir. Köprünün durumu için http://localhost:8082/durum yeter.
//
// Kullanım: node kopru\hiz-siniri.mjs

import { filoKonumlari, Kapi, SinirHatasi } from './iett.mjs';

console.log(new Date().toLocaleString('tr-TR'));
const kapi = new Kapi();
const bas = Date.now();
try {
  const araclar = await filoKonumlari(kapi);
  console.log(`AÇIK · ${Date.now() - bas} ms · filoda ${araclar.length} araç`);
  console.log('Köprüyü başlatabilirsin (kopru klasöründe npm start).');
} catch (e) {
  if (e instanceof SinirHatasi) {
    console.log('KAPALI · İBB hız sınırı uyguluyor.');
    console.log('Kota saatlik: en az bir saat bekleyip yeniden dene. Sık denemek kapanmayı uzatır.');
  } else {
    console.log(`HATA · ${e.message}`);
  }
  process.exit(1);
}
