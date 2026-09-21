// Çevrimdışı yedeğin telefondaki deposu.
//
// onbellek.ts'in kuralları saf ve test edilebilir; burası onları AsyncStorage'a
// bağlayan ince katman. Depo yazması başarısız olursa uygulama çalışmaya devam
// eder: onbellek bir kolaylık, bağımlılık değil.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { gunTuru, kullanilabilir, tasanlar, type Kayit } from './onbellek';

const ON_EK = 'onbellek-v1:';
/** Kayıt başına ~20-60 KB; bu sınır birkaç megabaytı geçmiyor. */
const SINIR = 60;

function tamAnahtar(anahtar: string): string {
  return ON_EK + anahtar;
}

export async function onbellegeYaz<T>(anahtar: string, veri: T): Promise<void> {
  const kayit: Kayit<T> = { veri, zaman: Date.now(), gunTuru: gunTuru(Date.now()) };
  try {
    await AsyncStorage.setItem(tamAnahtar(anahtar), JSON.stringify(kayit));
    await budaa();
  } catch {
    // Yazılamadıysa yedek yok, o kadar.
  }
}

export async function onbellektenOku<T>(anahtar: string, enFazlaGun = 14): Promise<Kayit<T> | null> {
  try {
    const ham = await AsyncStorage.getItem(tamAnahtar(anahtar));
    if (!ham) return null;
    const kayit = JSON.parse(ham) as Kayit<T>;
    return kullanilabilir(kayit, Date.now(), enFazlaGun) ? kayit : null;
  } catch {
    return null;
  }
}

/** Sınırı aşan en eski kayıtları siler. */
async function budaa(): Promise<void> {
  try {
    const anahtarlar = (await AsyncStorage.getAllKeys()).filter((a) => a.startsWith(ON_EK));
    if (anahtarlar.length <= SINIR) return;
    const ciftler = await AsyncStorage.multiGet(anahtarlar);
    const zamanli = ciftler.map(([anahtar, ham]) => {
      let zaman = 0;
      try {
        zaman = (JSON.parse(ham ?? '{}') as Kayit<unknown>).zaman ?? 0;
      } catch {
        zaman = 0;
      }
      return { anahtar, zaman };
    });
    const atilacak = tasanlar(zamanli, SINIR);
    if (atilacak.length) await AsyncStorage.multiRemove(atilacak);
  } catch {
    // Budama başarısız olursa bir sonraki yazmada yeniden denenir.
  }
}

export async function onbellegiTemizle(): Promise<void> {
  try {
    const anahtarlar = (await AsyncStorage.getAllKeys()).filter((a) => a.startsWith(ON_EK));
    if (anahtarlar.length) await AsyncStorage.multiRemove(anahtarlar);
  } catch {
    // yok sayılır
  }
}
