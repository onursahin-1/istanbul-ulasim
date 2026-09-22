// Saat ve süre yardımcıları. Rota motoru saatleri İstanbul saatiyle (+03:00) döndürür.

const IKI = (n: number) => String(n).padStart(2, '0');

/** "2026-09-17T09:00:49+03:00" → "09:00" (saat, sunucunun gönderdiği yerel saattir). */
export function saatYaz(iso?: string | null): string {
  if (!iso) return '--:--';
  const eslesme = iso.match(/T(\d{2}):(\d{2})/);
  return eslesme ? `${eslesme[1]}:${eslesme[2]}` : '--:--';
}

/** Rota aramasında kullanılan "şu an" değeri, İstanbul saatiyle. */
export function istanbulSimdi(): string {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return `${d.toISOString().slice(0, 19)}+03:00`;
}

/** Şu anki İstanbul saatini "09:00" biçiminde verir. */
export function istanbulSaat(): string {
  return saatYaz(istanbulSimdi());
}

/** Gece yarısından itibaren saniye → "23:05" (ertesi güne taşan saatler de düzeltilir). */
export function saniyedenSaat(saniye: number): string {
  const toplam = Math.floor(saniye / 60) % (24 * 60);
  return `${IKI(Math.floor(toplam / 60))}:${IKI(toplam % 60)}`;
}

/** Bir kalkışın kaç dakika sonra olduğunu hesaplar (serviceDay: günün başlangıcı, Unix saniyesi). */
export function kacDakikaSonra(serviceDay: number, saniye: number): number {
  return Math.round((serviceDay + saniye - Date.now() / 1000) / 60);
}

/**
 * Kalkış bundan uzaksa dakika yerine saat yazılır. "351 dk" okunmuyor; gece
 * yarısı bir sonraki otobüsü soran yolcu "05:51" görmek istiyor.
 */
export const SAAT_ESIGI_DK = 60;

/** Unix saniyesini İstanbul saatiyle "05:51" biçiminde yazar. */
export function istanbulSaatiYaz(anSaniye: number): string {
  const d = new Date((anSaniye + 3 * 3600) * 1000);
  return `${IKI(d.getUTCHours())}:${IKI(d.getUTCMinutes())}`;
}

export type KalkisGosterimi = {
  /** Büyük yazılan kısım: "Şimdi", "7" ya da "05:51". */
  metin: string;
  /** Küçük birim; saat gösterilirken ve "Şimdi"de yok. */
  birim: 'dk' | null;
  /** Kaç dakika kaldığı; renk ve sıralama için. */
  dakika: number;
  /** Ekran okuyucunun söyleyeceği tam cümle parçası. */
  seslendirme: string;
};

/**
 * Bir kalkışın ekranda nasıl yazılacağı.
 *
 * Saat, dakikadan geri hesaplanmıyor, kalkışın kendi anından yazılıyor: dakika
 * yuvarlandığı için geri hesap bir dakika kayabiliyordu (05:51 yerine 05:50).
 *
 * @param anSaniye kalkışın mutlak anı, Unix saniyesi (serviceDay + saniye)
 */
export function kalkisGosterimi(anSaniye: number, simdiMs: number = Date.now()): KalkisGosterimi {
  const dakika = Math.round((anSaniye - simdiMs / 1000) / 60);
  if (dakika <= 0) return { metin: 'Şimdi', birim: null, dakika, seslendirme: 'şimdi kalkıyor' };
  if (dakika < SAAT_ESIGI_DK) return { metin: String(dakika), birim: 'dk', dakika, seslendirme: `${dakika} dakika sonra` };
  const saat = istanbulSaatiYaz(anSaniye);
  return { metin: saat, birim: null, dakika, seslendirme: `saat ${saat}` };
}

/** ISO saatin şu andan kaç dakika sonra olduğunu verir ("2026-09-17T20:04:00+03:00"). */
export function isoDakikaSonra(iso?: string | null): number | null {
  if (!iso) return null;
  const zaman = Date.parse(iso);
  return Number.isNaN(zaman) ? null : Math.round((zaman - Date.now()) / 60000);
}

/** Saniye → "59 dk" ya da "1 sa 5 dk". */
export function sureYaz(saniye?: number | null): string {
  if (saniye == null) return '';
  const dakika = Math.max(1, Math.round(saniye / 60));
  if (dakika < 60) return `${dakika} dk`;
  const saat = Math.floor(dakika / 60);
  const kalan = dakika % 60;
  return kalan ? `${saat} sa ${kalan} dk` : `${saat} sa`;
}

/** Metre → "220 m" ya da "1,4 km". */
export function mesafeYaz(metre?: number | null): string {
  if (metre == null) return '';
  if (metre < 1000) return `${Math.round(metre / 10) * 10} m`;
  return `${(metre / 1000).toFixed(1).replace('.', ',')} km`;
}

/** "2026-09-19T18:34:00+03:00" → gün başından itibaren saniye (18*3600 + 34*60). */
export function isodanSaniye(iso?: string | null): number | null {
  if (!iso) return null;
  const e = iso.match(/T(\d{2}):(\d{2}):?(\d{2})?/);
  if (!e) return null;
  return Number(e[1]) * 3600 + Number(e[2]) * 60 + Number(e[3] ?? 0);
}

/** Şu anı İstanbul saatine göre tutan bir Date (UTC alanları İstanbul duvar saatini verir). */
function istanbulAn(): Date {
  return new Date(Date.now() + 3 * 3600 * 1000);
}

/**
 * Seçilen gün ve saatten rota sorgusu için zaman üretir.
 * @param gunFarki 0 bugün, 1 yarın…
 */
export function istanbulZamanYap(gunFarki: number, saat: number, dakika: number): string {
  const d = istanbulAn();
  d.setUTCDate(d.getUTCDate() + gunFarki);
  d.setUTCHours(saat, dakika, 0, 0);
  return `${d.toISOString().slice(0, 19)}+03:00`;
}

const GUN_ADLARI = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const GUN_KISA = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/** 0 → "Bugün", 1 → "Yarın", 5 → "Cumartesi". */
export function gunEtiketi(gunFarki: number, kisa = false): string {
  if (gunFarki === 0) return 'Bugün';
  if (gunFarki === 1) return 'Yarın';
  const d = istanbulAn();
  d.setUTCDate(d.getUTCDate() + gunFarki);
  return (kisa ? GUN_KISA : GUN_ADLARI)[d.getUTCDay()];
}

/** "Cumartesi gecesi" gibi bir seçim gerçekte hangi güne denk geliyor: "26 Eylül Cmt". */
export function gunTarihi(gunFarki: number): string {
  const d = istanbulAn();
  d.setUTCDate(d.getUTCDate() + gunFarki);
  const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  return `${d.getUTCDate()} ${aylar[d.getUTCMonth()]} ${GUN_KISA[d.getUTCDay()]}`;
}

/** 7 → "07:00" */
export function saatDakikaYaz(saat: number, dakika: number): string {
  return `${IKI(saat)}:${IKI(dakika)}`;
}
