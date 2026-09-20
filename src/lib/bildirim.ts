// Yolculuk hatırlatıcıları: telefonun kendi bildirim sistemine önceden zamanlanan
// yerel bildirimler.
//
// "Arka plan" burada şu demek: bildirimi uygulama kurar, ama saati gelince telefon
// gösterir. Uygulamanın o sırada açık olması, hatta arka planda çalışıyor olması
// gerekmez — iOS uygulamayı uyuttuğunda bile bildirim çıkar. Bunun karşılığında
// bildirimin metni kurulduğu anda sabitlenir; sefer gecikirse metin değişmez.
//
// Gerçekten canlı bir uyarı (aracın anlık konumuna göre "şimdi in") ancak GTFS-RT
// beslemesi ve sunucu tarafında bir itme servisi olursa mümkün; o iş sırada.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type HatirlaticiTuru = 'kalkis' | 'inis' | 'aktarma';

export type Hatirlatici = {
  /** Telefonun verdiği bildirim kimliği; iptal etmek için kullanılır. */
  id: string;
  tur: HatirlaticiTuru;
  baslik: string;
  metin: string;
  /** Bildirimin çıkacağı an, Unix milisaniye. */
  zaman: number;
  /** Aynı yolculuğa ait hatırlatıcıları birlikte iptal etmek için etiket. */
  grup?: string;
};

export type Taslak = Omit<Hatirlatici, 'id'>;

const ANAHTAR = 'hatirlaticilar-v1';
const KANAL = 'yolculuk';
/** Bu kadar yakın bir an için bildirim kurmak anlamsız: kullanıcı zaten ekranda. */
const EN_AZ_SANIYE = 45;

let hazirlandi = false;

/** Uygulama açılırken bir kez çağrılır: bildirimin uygulama açıkken de görünmesini sağlar. */
export function bildirimleriHazirla(): void {
  if (hazirlandi) return;
  hazirlandi = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync(KANAL, {
        name: 'Yolculuk hatırlatıcıları',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 150, 250],
      }).catch(() => {});
    }
  } catch {
    // Bildirim modülü yoksa uygulama bildirimsiz çalışmaya devam eder.
  }
}

// ---------- izin ----------

/** Bildirim izni verilmiş mi? Sormaz, sadece bakar. */
export async function izinVarMi(): Promise<boolean> {
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/** İzin yoksa sistem penceresini açar. Kullanıcı daha önce reddettiyse iOS tekrar sormaz. */
export async function izinIste(): Promise<boolean> {
  try {
    const mevcut = await Notifications.getPermissionsAsync();
    if (mevcut.granted) return true;
    if (!mevcut.canAskAgain) return false;
    const sonuc = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    return sonuc.granted;
  } catch {
    return false;
  }
}

// ---------- saklama ----------

const dinleyiciler = new Set<() => void>();
const haberVer = () => dinleyiciler.forEach((f) => f());

async function oku(): Promise<Hatirlatici[]> {
  try {
    const ham = await AsyncStorage.getItem(ANAHTAR);
    const liste = ham ? (JSON.parse(ham) as Hatirlatici[]) : [];
    // Saati geçenler listede durmasın: telefon onları zaten gösterdi.
    return liste.filter((h) => h.zaman > Date.now() - 60_000).sort((a, b) => a.zaman - b.zaman);
  } catch {
    return [];
  }
}

async function yaz(liste: Hatirlatici[]): Promise<void> {
  try {
    await AsyncStorage.setItem(ANAHTAR, JSON.stringify(liste));
  } catch {
    // Kayıt başarısız olsa bile bildirim telefonda kurulu kalır.
  }
  haberVer();
}

// ---------- kurma ve iptal ----------

/**
 * Tek bir hatırlatıcı kurar. Zamanı geçmişse ya da çok yakınsa kurmaz ve null döner.
 * İzin isteme işi çağıranın sorumluluğunda: birden çok hatırlatıcı kurarken
 * kullanıcıya üst üste izin penceresi çıkmasın diye.
 */
export async function hatirlaticiKur(taslak: Taslak): Promise<Hatirlatici | null> {
  const tarih = new Date(taslak.zaman);
  if (taslak.zaman - Date.now() < EN_AZ_SANIYE * 1000) return null;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: taslak.baslik, body: taslak.metin, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: tarih, channelId: KANAL },
    });
    const kayit: Hatirlatici = { ...taslak, id };
    await yaz([...(await oku()), kayit]);
    return kayit;
  } catch {
    return null;
  }
}

/** Bir yolculuğun bütün hatırlatıcılarını tek seferde kurar. Kurulanları döner. */
export async function hatirlaticilariKur(taslaklar: Taslak[]): Promise<Hatirlatici[]> {
  const kurulan: Hatirlatici[] = [];
  for (const t of taslaklar) {
    const k = await hatirlaticiKur(t);
    if (k) kurulan.push(k);
  }
  return kurulan;
}

export async function hatirlaticiIptal(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Zaten gösterilmiş olabilir; listeden düşmesi yeterli.
  }
  await yaz((await oku()).filter((h) => h.id !== id));
}

export async function grubuIptal(grup: string): Promise<number> {
  const liste = await oku();
  const gidecek = liste.filter((h) => h.grup === grup);
  for (const h of gidecek) {
    try {
      await Notifications.cancelScheduledNotificationAsync(h.id);
    } catch {
      // yoksay
    }
  }
  await yaz(liste.filter((h) => h.grup !== grup));
  return gidecek.length;
}

export async function hepsiniIptal(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // yoksay
  }
  await yaz([]);
}

// ---------- ekranlar için ----------

export function useHatirlaticilar() {
  const [hatirlaticilar, setHatirlaticilar] = useState<Hatirlatici[]>([]);
  const [izin, setIzin] = useState<boolean | null>(null);

  const yukle = useCallback(async () => {
    const liste = await oku();
    setHatirlaticilar(liste);
    setIzin(await izinVarMi());
  }, []);

  useEffect(() => {
    yukle();
    dinleyiciler.add(yukle);
    return () => {
      dinleyiciler.delete(yukle);
    };
  }, [yukle]);

  return { hatirlaticilar, izin, yenile: yukle };
}

/** "14:32" — hatırlatıcı listesinde gösterilen saat. */
export function hatirlaticiSaati(zaman: number): string {
  return new Date(zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}
