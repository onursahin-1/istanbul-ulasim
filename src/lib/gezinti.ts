// Ekranlar arası geçiş: çift dokunmaya karşı korumalı açma ve her durumda çalışan geri.
//
// iPhone'da bir satıra hızlıca iki kez dokununca ekran bir kez açılır. React Navigation'da
// ise router.push iki kez çalışıp aynı ekranı üst üste iki kez açıyordu (geri tuşuna iki
// kez basmak gerekiyordu). Geçiş animasyonu sürerken gelen ikinci açma isteği yok sayılıyor.
//
// Geri: ekran bildirimden ya da bağlantıdan doğrudan açıldıysa yığında geri gidilecek ekran
// yok; router.back() orada hata veriyordu. O durumda ana ekrana dönülüyor.

import { router, type Href } from 'expo-router';

/** iOS'un itme geçişi ~350 ms; bu süre içindeki ikinci açma isteği çift dokunmadır. */
const GECIS_SURESI = 450;
let sonAcilis = 0;

export function ekranAc(hedef: Href): void {
  const simdi = Date.now();
  if (simdi - sonAcilis < GECIS_SURESI) return;
  sonAcilis = simdi;
  router.push(hedef);
}

export function geriDon(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/(sekmeler)');
}
