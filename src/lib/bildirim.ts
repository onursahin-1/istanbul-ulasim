// Yolculuk hatırlatıcıları: telefonun kendi bildirim sistemine önceden zamanlanan
// yerel bildirimler.
//
// "Arka plan" burada şu demek: bildirimi uygulama kurar, ama saati gelince telefon
// gösterir. Uygulamanın o sırada açık olması gerekmez. Bunun karşılığında bildirim
// kurulduğu anki tahmine göre çıkar; otobüs gecikirse telefon bunu bilmez. Bu yüzden:
//   • Her bildirim yolculuğuyla birlikte telefona kaydediliyor (YolculukKaydi).
//   • Uygulama açıldıkça kayıtlı yolculukların saatleri canlı veriyle yeniden
//     hesaplanıyor (hatirlatma-tazele.ts) ve kayan bildirimler yeni saatle yeniden
//     kuruluyor (planiGuncelle). Ne kadar kaydığı kurulu listede görünüyor.
//   • Bildirime dokununca o yolculuğun ekranı açılıyor (bildirim-yanit.ts).
//
// Uygulama hiç açılmadan otobüsün gerçek yerine göre uyarı, sunucudan itme bildirimi
// ister (köprü otobüsü izleyip telefona yollar); o iş sırada.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { VARSAYILAN_AYAR, type HatirlatmaAyari, type HatirlatmaTuru, type PlanOgesi } from './hatirlatma-plan';
import type { Guzergah } from './otp';

export type Hatirlatici = {
  /** Telefonun verdiği bildirim kimliği; iptal etmek için kullanılır. */
  id: string;
  tur: HatirlatmaTuru;
  baslik: string;
  metin: string;
  /** Bildirimin çıkacağı an, Unix milisaniye. */
  zaman: number;
  /** Aynı yolculuğa ait hatırlatıcıları birlikte iptal etmek için etiket. */
  grup?: string;
  /** Yolculuk içindeki kimliği ("aktarma-1"): yeniden kurulurken eşleşmek için. */
  anahtar?: string;
  /** İlk kurulduğundaki an: saat kaydıysa ne kadar kaydığı buna göre. */
  ilkZaman?: number;
  canli?: boolean;
};

/** Hatırlatıcısı kurulu bir yolculuk: bildirimden açılabilsin, saatleri tazelenebilsin. */
export type YolculukKaydi = {
  grup: string;
  /** "Konumum → Üniversite" */
  baslik: string;
  /** Rozetlerdeki adlarla hatlar: ["97M / 97GE", "A29", "Metrobüs"]. */
  hatlar: string[];
  kalkis: number;
  varis: number;
  guzergah: Guzergah;
  /** Rota listesinden gelen eşdeğer hatlar (rota-detay parametresi). */
  esdeger?: string;
  hedef?: string;
  /** Plan bu ayarla kuruldu: yeniden kurarken aynı "kaç dk önce". */
  ayar: HatirlatmaAyari;
  kuruldu: number;
  guncellendi?: number;
};

const ANAHTAR = 'hatirlaticilar-v1';
const YOLCULUK_ANAHTARI = 'hatirlatma-yolculuklar-v1';
const AYAR_ANAHTARI = 'hatirlatma-ayari-v1';
const KANAL = 'yolculuk';
/** Çıkış bildiriminin düğmeleri ("5 dk ertele", "Yolculuğu başlat"). */
export const CIKIS_KATEGORISI = 'cikis';
/** Bu kadar yakın bir an için bildirim kurmak anlamsız: kullanıcı zaten ekranda. */
const EN_AZ_SANIYE = 45;
/** Saat bundan az kaydıysa bildirim yeniden kurulmaz (gürültü olmasın). */
const KAYMA_ESIGI_MS = 60_000;

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
    // Çıkış bildiriminde iki düğme. Expo Go'da desteklenmiyorsa bildirim düğmesiz çıkar.
    Notifications.setNotificationCategoryAsync(CIKIS_KATEGORISI, [
      { identifier: 'ertele', buttonTitle: '5 dk ertele', options: { opensAppToForeground: false } },
      { identifier: 'baslat', buttonTitle: 'Yolculuğu başlat', options: { opensAppToForeground: true } },
    ]).catch(() => {});
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
  await yolculuklariAyikla(liste);
  haberVer();
}

export async function yolculuklariOku(): Promise<Record<string, YolculukKaydi>> {
  try {
    const ham = await AsyncStorage.getItem(YOLCULUK_ANAHTARI);
    return ham ? (JSON.parse(ham) as Record<string, YolculukKaydi>) : {};
  } catch {
    return {};
  }
}

async function yolculuklariYaz(kayitlar: Record<string, YolculukKaydi>): Promise<void> {
  try {
    await AsyncStorage.setItem(YOLCULUK_ANAHTARI, JSON.stringify(kayitlar));
  } catch {
    // yoksay
  }
}

/** Bildirimi kalmayan ve varışı bir saatten eski yolculuklar silinir. */
async function yolculuklariAyikla(liste: Hatirlatici[]): Promise<void> {
  const kayitlar = await yolculuklariOku();
  const gruplar = new Set(liste.map((h) => h.grup));
  let degisti = false;
  for (const [g, k] of Object.entries(kayitlar)) {
    // Bildirimi çıkmış yolculuk bir süre daha durur: bildirime sonradan dokunulabilir.
    if (!gruplar.has(g) && k.varis < Date.now() - 3600_000) {
      delete kayitlar[g];
      degisti = true;
    }
  }
  if (degisti) await yolculuklariYaz(kayitlar);
}

export async function yolculukGetir(grup: string): Promise<YolculukKaydi | null> {
  return (await yolculuklariOku())[grup] ?? null;
}

async function yolculukKaydet(kayit: YolculukKaydi): Promise<void> {
  const kayitlar = await yolculuklariOku();
  kayitlar[kayit.grup] = kayit;
  await yolculuklariYaz(kayitlar);
}

// ---------- varsayılan ayar ----------

export async function ayarOku(): Promise<HatirlatmaAyari> {
  try {
    const ham = await AsyncStorage.getItem(AYAR_ANAHTARI);
    return ham ? { ...VARSAYILAN_AYAR, ...(JSON.parse(ham) as Partial<HatirlatmaAyari>) } : VARSAYILAN_AYAR;
  } catch {
    return VARSAYILAN_AYAR;
  }
}

export async function ayarYaz(ayar: HatirlatmaAyari): Promise<void> {
  try {
    await AsyncStorage.setItem(AYAR_ANAHTARI, JSON.stringify(ayar));
  } catch {
    // yoksay
  }
  haberVer();
}

// ---------- kurma ve iptal ----------

async function zamanla(o: { baslik: string; metin: string; zaman: number; tur: HatirlatmaTuru }, grup?: string, anahtar?: string) {
  return Notifications.scheduleNotificationAsync({
    content: {
      title: o.baslik,
      body: o.metin,
      sound: true,
      data: { grup: grup ?? null, anahtar: anahtar ?? null, tur: o.tur },
      ...(o.tur === 'kalkis' ? { categoryIdentifier: CIKIS_KATEGORISI } : {}),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(o.zaman), channelId: KANAL },
  });
}

const uygunMu = (zaman: number) => zaman - Date.now() >= EN_AZ_SANIYE * 1000;

/**
 * Bir yolculuğun seçilen bildirimlerini kurar; yolculuğu da kaydeder. Saati geçmiş ya da
 * çok yakın olanlar kurulmaz. İzin isteme çağıranın işi. Kurulanları döner.
 */
export async function planiKur(kayit: YolculukKaydi, ogeler: PlanOgesi[]): Promise<Hatirlatici[]> {
  await yolculukKaydet(kayit);
  const liste = await oku();
  const kurulan: Hatirlatici[] = [];
  for (const o of ogeler) {
    if (!uygunMu(o.zaman)) continue;
    if (liste.some((h) => h.grup === kayit.grup && h.anahtar === o.anahtar)) continue;
    try {
      const id = await zamanla(o, kayit.grup, o.anahtar);
      kurulan.push({
        id,
        tur: o.tur,
        baslik: o.baslik,
        metin: o.metin,
        zaman: o.zaman,
        grup: kayit.grup,
        anahtar: o.anahtar,
        ilkZaman: o.zaman,
        canli: o.canli,
      });
    } catch {
      // bu bildirim kurulamadı; öbürleri sürer
    }
  }
  await yaz([...liste, ...kurulan]);
  return kurulan;
}

/**
 * Kurulu bildirimleri yeni plana göre kaydırır: saati bir dakikadan çok değişen ve hâlâ
 * önde olan bildirim iptal edilip yeni saat ve metinle kurulur. Yolculuk kaydı da yeni
 * güzergâhla güncellenir. Kaç bildirimin kaydığını döner.
 */
export async function planiGuncelle(grup: string, plan: PlanOgesi[], guzergah?: Guzergah): Promise<number> {
  const liste = await oku();
  let kayan = 0;
  const yeni: Hatirlatici[] = [];
  for (const h of liste) {
    const o = h.grup === grup && h.anahtar ? plan.find((p) => p.anahtar === h.anahtar) : undefined;
    const fark = o ? Math.abs(o.zaman - h.zaman) : 0;
    if (!o || (fark < KAYMA_ESIGI_MS && o.metin === h.metin) || !uygunMu(o.zaman) || !uygunMu(h.zaman)) {
      yeni.push(h);
      continue;
    }
    try {
      await Notifications.cancelScheduledNotificationAsync(h.id);
      const id = await zamanla(o, grup, o.anahtar);
      yeni.push({ ...h, id, zaman: o.zaman, baslik: o.baslik, metin: o.metin, canli: o.canli });
      if (fark >= KAYMA_ESIGI_MS) kayan++;
    } catch {
      yeni.push(h);
    }
  }
  const kayitlar = await yolculuklariOku();
  if (kayitlar[grup]) {
    kayitlar[grup] = { ...kayitlar[grup], ...(guzergah ? { guzergah } : {}), guncellendi: Date.now() };
    await yolculuklariYaz(kayitlar);
  }
  await yaz(yeni);
  return kayan;
}

/** Çıkış bildiriminin "5 dk ertele" düğmesi: aynı bildirim beş dakika sonra yeniden. */
export async function ertele(baslik: string, metin: string, grup?: string): Promise<void> {
  const zaman = Date.now() + 5 * 60_000;
  try {
    const id = await zamanla({ baslik, metin, zaman, tur: 'kalkis' }, grup, 'kalkis-ertele');
    await yaz([
      ...(await oku()).filter((h) => !(h.grup === grup && h.anahtar === 'kalkis-ertele')),
      { id, tur: 'kalkis', baslik, metin, zaman, grup, anahtar: 'kalkis-ertele', ilkZaman: zaman },
    ]);
  } catch {
    // yoksay
  }
}

/**
 * Hemen gösterilen bildirim (otobüs yaklaştı). Zamanlanmış hatırlatıcılardan farkı:
 * kaydedilmiyor, listede görünmüyor; uygulama açıkken canlı konuma bakılarak atılıyor.
 */
export async function hemenBildir(baslik: string, metin: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: baslik, body: metin, sound: true },
      trigger: null,
    });
  } catch {
    // Bildirim gönderilemezse ekrandaki kutu yine gösteriyor.
  }
}

export async function hatirlaticiIptal(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Zaten gösterilmiş olabilir; listeden düşmesi yeterli.
  }
  await yaz((await oku()).filter((h) => h.id !== id));
}

/** Bir yolculuktaki tek bildirimi kaldırır ("yaklasma-1"); yoksa bir şey yapmaz. */
export async function anahtariIptal(grup: string, anahtar: string): Promise<void> {
  const h = (await oku()).find((x) => x.grup === grup && x.anahtar === anahtar);
  if (h) await hatirlaticiIptal(h.id);
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

/** Kaydedilmiş bütün bildirimler (tazeleme için). */
export const hatirlaticilariOku = oku;

// ---------- ekranlar için ----------

export function useHatirlaticilar() {
  const [hatirlaticilar, setHatirlaticilar] = useState<Hatirlatici[]>([]);
  const [yolculuklar, setYolculuklar] = useState<Record<string, YolculukKaydi>>({});
  const [ayar, setAyar] = useState<HatirlatmaAyari>(VARSAYILAN_AYAR);
  const [izin, setIzin] = useState<boolean | null>(null);

  const yukle = useCallback(async () => {
    const [liste, kayitlar, a, i] = await Promise.all([oku(), yolculuklariOku(), ayarOku(), izinVarMi()]);
    setHatirlaticilar(liste);
    setYolculuklar(kayitlar);
    setAyar(a);
    setIzin(i);
  }, []);

  useEffect(() => {
    yukle();
    dinleyiciler.add(yukle);
    return () => {
      dinleyiciler.delete(yukle);
    };
  }, [yukle]);

  return { hatirlaticilar, yolculuklar, ayar, izin, yenile: yukle };
}

/** "14:32" — hatırlatıcı listesinde gösterilen saat. */
export function hatirlaticiSaati(zaman: number): string {
  return new Date(zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
}

/** Saat ilk kurulduğundan bu yana kaç dakika kaydı (+ geç, − erken); kaymadıysa 0. */
export function kaymaDk(h: Hatirlatici): number {
  return h.ilkZaman ? Math.round((h.zaman - h.ilkZaman) / 60_000) : 0;
}
