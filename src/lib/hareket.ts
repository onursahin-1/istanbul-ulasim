// Ortak efektlerin hesapları (bileşenlerden ayrı: testlerden çağrılabilsin).
//   • basılıyken ölçek: dokun.tsx
//   • kayan rakamın hücreleri ve yönü: kayan-metin.tsx

/** Her öğe genişliğinden aşağı yukarı bu kadar piksel küçülür. */
export const KUCULME_PX = 6;

/**
 * Genişliğe göre basılıyken ölçek, 0,94 ile 0,985 arası. Her öğe aşağı yukarı aynı
 * sayıda piksel küçülüyor: rozette belirgin, ekran genişliğindeki satırda hafif.
 */
export function basiliOlcek(genislik: number): number {
  if (!(genislik > 0)) return 0.97;
  return Math.min(0.985, Math.max(0.94, 1 - KUCULME_PX / genislik));
}

export type Yon = 1 | -1;

/** Metindeki sayıların birleşimi; karşılaştırma için ("16:53" → 1653). */
function sayisal(metin: string): number | null {
  const rakamlar = metin.replace(/\D/g, '');
  return rakamlar ? Number(rakamlar) : null;
}

/** Değişimin yönü: sayı azaldıysa -1, arttıysa (ya da karşılaştırılamıyorsa) 1. */
export function degisimYonu(eski: string, yeni: string): Yon {
  const a = sayisal(eski);
  const b = sayisal(yeni);
  return a != null && b != null && b < a ? -1 : 1;
}

/**
 * Metnin hücreleri: her karakter bir hücre. Anahtar parçanın sırası ve parçadaki yeri:
 * sayılar sağdan, yazılar soldan sayılıyor. Böylece aynı basamak bir sonraki metinde
 * aynı anahtarı alır ("10 durak" → "9 durak": birler basamağı aynı hücre).
 */
export function hucreler(metin: string): { anahtar: string; karakter: string }[] {
  const parcalar = metin.match(/\d+|\D+/g) ?? [];
  const sonuc: { anahtar: string; karakter: string }[] = [];
  parcalar.forEach((p, pi) => {
    const rakam = /\d/.test(p[0]);
    [...p].forEach((c, ci) => {
      const yer = rakam ? p.length - ci : ci;
      sonuc.push({ anahtar: `${pi}${rakam ? 's' : 'y'}${yer}`, karakter: c });
    });
  });
  return sonuc;
}
