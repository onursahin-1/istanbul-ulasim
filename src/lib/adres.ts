// Telefonun adres servisinden (expo-location reverseGeocodeAsync; iPhone'da Apple)
// gelen sonucu ekrandaki iki satıra çevirir: "1543. Sk. No: 21" / "Yenimahalle, Bağcılar".
//
// Bağımlılıksız: testlerden çağrılabiliyor.

/** reverseGeocodeAsync sonucunun burada kullanılan alanları. */
export type HamAdres = {
  name?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
};

export type Adres = { baslik: string; alt: string };

/** Adres bulunamayınca başlıkta yazan. */
export const SECILEN_NOKTA = 'Haritada seçilen nokta';

export function adresYaz(ham?: HamAdres | null): Adres | null {
  if (!ham) return null;
  const temiz = (s?: string | null) => (s ?? '').trim();
  const sokak = temiz(ham.street);
  const no = temiz(ham.streetNumber);
  const ad = temiz(ham.name);
  // Sokak yoksa adın kendisi (park, meydan, bina adı); ad da yalnız kapı numarasıysa kullanılmaz.
  const baslik = sokak ? (no ? `${sokak} No: ${no}` : sokak) : ad && ad !== no ? ad : '';
  // Semt ve ilçe; ilçe yoksa şehir. Aynı ad iki kez yazılmaz ("Kadıköy, Kadıköy").
  const parcalar: string[] = [];
  for (const p of [temiz(ham.district), temiz(ham.subregion) || temiz(ham.city)]) {
    if (p && !parcalar.some((x) => x.toLocaleLowerCase('tr-TR') === p.toLocaleLowerCase('tr-TR'))) parcalar.push(p);
  }
  const alt = parcalar.join(', ');
  if (!baslik && !alt) return null;
  return { baslik: baslik || alt || SECILEN_NOKTA, alt: baslik ? alt : '' };
}
