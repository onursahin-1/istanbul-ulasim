// Resmî tatil ve bayramlar: o gün hangi tarife işler, hangi hatlar ücretsiz.
//
// Veri assets/veri/ozel-gunler.json'da (veri/ozel-gun-takvimi.py aynı dosyadan GTFS
// takvimine işliyor). Ücretsizlik iki ayrı karardan geliyor:
//   - İBB (İETT, Metro İstanbul, Şehir Hatları): dinî ve millî bayramlarda,
//     kişiselleştirilmiş İstanbulkart'la. Adalar'daki İETT hatları, T2 nostaljik
//     tramvay, Tünel (F2), SG-1/SG-2 havalimanı hatları, 139 ve 139A (Şile) hariç.
//   - Cumhurbaşkanı kararı (TCDD: Marmaray, T6, M11): millî bayramlar, 1 Mayıs,
//     15 Temmuz ve bayramlarda.
// Minibüs, dolmuş, Turyol, Dentur ve İDO bu kararlara girmiyor.
//
// Bağımlılıksız: testlerden çağrılabilir; veri çağırandan gelir.

export type OzelGun = {
  tarih: string; // YYYY-MM-DD, İstanbul saatiyle
  ad: string;
  tarife: 'pazar' | 'cumartesi';
  ucretsiz: { ibb: boolean; tcdd: boolean };
};

export type UcretsizlikTuru = 'ibb' | 'tcdd' | null;

/** Anın İstanbul tarihi: "2026-10-29". */
export function istanbulTarihi(anMs: number): string {
  return new Date(anMs + 3 * 3600_000).toISOString().slice(0, 10);
}

export function ozelGunBul(gunler: OzelGun[], anMs: number): OzelGun | null {
  if (!Number.isFinite(anMs)) return null;
  const tarih = istanbulTarihi(anMs);
  return gunler.find((g) => g.tarih === tarih) ?? null;
}

const IBB_ISLETMECILERI = ['iett', 'metroistanbul', 'sehirhatlari'];
const IBB_HARIC_KODLAR = new Set(['T2', 'F2', 'SG-1', 'SG-2', 'SG1', 'SG2', '139', '139A']);
const ADALAR = /BÜYÜKADA|HEYBELİADA|BURGAZADA|KINALIADA/;

function sade(metin?: string | null): string {
  return (metin ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]/g, '');
}

type HatBilgisi = {
  shortName?: string | null;
  longName?: string | null;
  mode?: string | null;
  agency?: { name: string } | null;
};

/** Bu hat, o özel günde hangi karar gereği ücretsiz; ücretliyse null. */
export function hatUcretsizMi(hat: HatBilgisi | null | undefined, gun: OzelGun | null): UcretsizlikTuru {
  if (!gun || !hat) return null;
  const isletmeci = sade(hat.agency?.name);
  const kod = (hat.shortName ?? '').trim().toUpperCase();
  if (isletmeci.startsWith('tcdd')) return gun.ucretsiz.tcdd ? 'tcdd' : null;
  if (!gun.ucretsiz.ibb || !IBB_ISLETMECILERI.some((i) => isletmeci.startsWith(i))) return null;
  if (IBB_HARIC_KODLAR.has(kod)) return null;
  const adalarOtobusu = (hat.mode ?? '').toUpperCase() === 'BUS' && ADALAR.test((hat.longName ?? '').toLocaleUpperCase('tr-TR'));
  return adalarOtobusu ? null : 'ibb';
}

/** Rota listesinin üstündeki not: "29 Ekim Cumhuriyet Bayramı: pazar tarifesi; …". */
export function ozelGunNotu(gun: OzelGun): string {
  const tarife = gun.tarife === 'pazar' ? 'pazar' : 'cumartesi';
  const ucretsiz =
    gun.ucretsiz.ibb && gun.ucretsiz.tcdd
      ? ' İETT, metro, tramvay, Şehir Hatları ve Marmaray kişiselleştirilmiş İstanbulkart\'la ücretsiz (minibüs, dolmuş ve özel vapurlar hariç).'
      : gun.ucretsiz.ibb
        ? ' İETT, metro, tramvay ve Şehir Hatları kişiselleştirilmiş İstanbulkart\'la ücretsiz.'
        : gun.ucretsiz.tcdd
          ? ' Marmaray, T6 ve M11 ücretsiz.'
          : '';
  return `${gun.ad}: toplu taşıma ${tarife} tarifesiyle çalışır.${ucretsiz}`;
}
