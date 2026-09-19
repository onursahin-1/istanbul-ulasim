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
