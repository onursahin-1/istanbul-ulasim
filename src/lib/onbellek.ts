// Çevrimdışı yedek: son görülen tarifeleri ve güzergâhları saklar.
//
// Rota sunucusu bilgisayarda çalışıyor; telefon ağdan çıkınca ya da bilgisayar
// kapalıyken uygulama şu anda boş bir hata ekranı gösteriyor. Metroda sinyal
// yokken en çok ihtiyaç duyulan şey de tam bu: az önce bakılan durağın tarifesi.
//
// Saklanan saatler mutlak (serviceDay + saniye). Dünün kaydını bugüne kaydırmak
// ancak gün türü tutuyorsa doğru: hafta içi tarifesini cumartesi göstermek
// yolcuyu yanıltır. Bu yüzden her kayıt kendi gün türüyle saklanıyor ve yalnız
// aynı türden bir güne kaydırılıyor.
//
// Bu dosyanın çekirdeği bağımlılıksız; depolama en altta, ayrı.

export type GunTuru = 'haftaici' | 'cumartesi' | 'pazar';

export type Kayit<T> = {
  veri: T;
  /** Kaydın alındığı an (ms). */
  zaman: number;
  gunTuru: GunTuru;
};

/** Tarifelerin ayrıştığı üç gün türü: İBB verisinde takvimler böyle bölünüyor. */
export function gunTuru(an: Date | number): GunTuru {
  const g = (an instanceof Date ? an : new Date(an)).getDay();
  if (g === 0) return 'pazar';
  if (g === 6) return 'cumartesi';
  return 'haftaici';
}

/** Kaydın ne kadar eskidiği (gün). */
export function kacGun(kayit: { zaman: number }, simdi: number): number {
  return Math.max(0, (simdi - kayit.zaman) / 86400000);
}

/**
 * Kayıt şimdi gösterilmeye uygun mu?
 *
 * @param enFazlaGun bu kadar günden eskiyse tarife değişmiş olabilir
 */
export function kullanilabilir<T>(
  kayit: Kayit<T> | null | undefined,
  simdi: number,
  enFazlaGun = 14,
): kayit is Kayit<T> {
  if (!kayit || !Number.isFinite(kayit.zaman)) return false;
  if (kayit.zaman > simdi + 3600000) return false;          // ileri tarihli kayıt bozuktur
  if (kacGun(kayit, simdi) > enFazlaGun) return false;
  return kayit.gunTuru === gunTuru(simdi);
}

/** Yerel gün başlangıcının epoch saniyesi — OTP'nin serviceDay'iyle aynı ölçek. */
export function gunBasi(an: Date | number): number {
  const t = an instanceof Date ? new Date(an) : new Date(an);
  t.setHours(0, 0, 0, 0);
  return Math.floor(t.getTime() / 1000);
}

/**
 * Kayıttaki serviceDay'leri bugüne kaydırır.
 *
 * Kayıt aynı gün türünden olduğu için saatler yerinde kalıyor, yalnız hangi güne
 * ait oldukları değişiyor. Kaydırma miktarı kaydın alındığı günden bugüne.
 */
export function gunuKaydir(serviceDay: number, kayitZamani: number, simdi: number): number {
  return serviceDay + (gunBasi(simdi) - gunBasi(kayitZamani));
}

/** Kullanıcıya gösterilecek kısa tazelik metni. */
export function tazelikYaz(kayit: { zaman: number }, simdi: number): string {
  const dakika = Math.floor((simdi - kayit.zaman) / 60000);
  if (dakika < 1) return 'az önce kaydedildi';
  if (dakika < 60) return `${dakika} dk önce kaydedildi`;
  const saat = Math.floor(dakika / 60);
  if (saat < 24) return `${saat} saat önce kaydedildi`;
  const gun = Math.floor(saat / 24);
  return gun === 1 ? 'dün kaydedildi' : `${gun} gün önce kaydedildi`;
}

/**
 * Onbellekte tutulacak kayıt sayısı sınırlı: en eski kayıtlar atılır.
 * @returns atılacak anahtarlar
 */
export function tasanlar(anahtarlar: { anahtar: string; zaman: number }[], sinir: number): string[] {
  if (anahtarlar.length <= sinir) return [];
  return [...anahtarlar]
    .sort((a, b) => b.zaman - a.zaman)
    .slice(sinir)
    .map((k) => k.anahtar);
}
