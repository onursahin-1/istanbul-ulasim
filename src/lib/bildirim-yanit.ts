// Bildirime dokununca ne olacağı.
//
//   • Bildirimin kendisine dokunmak: o yolculuğun ekranı açılır (kayıtlı güzergâhtan).
//   • "Yolculuğu başlat": ekran açılır ve yolculuk takibi başlar.
//   • "5 dk ertele": aynı bildirim beş dakika sonra yeniden kurulur, uygulama açılmaz.
//
// Uygulama kapalıyken dokunulduysa açılışta son yanıt okunuyor; aynı yanıt iki kez
// işlenmesin diye kimliği tutuluyor.

import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { ertele, yolculukGetir } from './bildirim';
import { guzergahEkle } from './secim';

const islenen = new Set<string>();

async function isle(yanit: Notifications.NotificationResponse): Promise<void> {
  const istek = yanit.notification.request;
  const kimlik = `${istek.identifier}|${yanit.actionIdentifier}`;
  if (islenen.has(kimlik)) return;
  islenen.add(kimlik);
  const veri = (istek.content.data ?? {}) as { grup?: string | null };
  const grup = veri.grup ?? undefined;
  if (yanit.actionIdentifier === 'ertele') {
    await ertele(istek.content.title ?? 'Yola çıkma vakti', istek.content.body ?? '', grup);
    return;
  }
  if (grup) await yolculuguAc(grup, yanit.actionIdentifier === 'baslat');
}

/** Hatırlatıcısı kurulu yolculuğun ekranını açar (bildirimden ya da Ayarlar'dan). */
export async function yolculuguAc(grup: string, baslat = false): Promise<boolean> {
  const kayit = await yolculukGetir(grup);
  if (!kayit) return false;
  const sira = guzergahEkle(kayit.guzergah);
  router.push({
    pathname: '/rota-detay',
    params: {
      sira: String(sira),
      ...(kayit.hedef ? { hedef: kayit.hedef } : {}),
      ...(kayit.esdeger ? { esdeger: kayit.esdeger } : {}),
      ...(baslat ? { baslat: '1' } : {}),
    },
  });
  return true;
}

/** Kök düzende bir kez. */
export function useBildirimYanitlari(): void {
  useEffect(() => {
    // Soğuk açılış: gezinme hazır olsun diye kısa bir bekleme.
    const t = setTimeout(() => {
      Notifications.getLastNotificationResponseAsync()
        .then((y) => (y ? isle(y) : undefined))
        .catch(() => {});
    }, 800);
    const abone = Notifications.addNotificationResponseReceivedListener((y) => {
      isle(y).catch(() => {});
    });
    return () => {
      clearTimeout(t);
      abone.remove();
    };
  }, []);
}
