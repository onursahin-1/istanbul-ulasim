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

// ---------------------------------------------------------------- haritadaki otobüs

/** Konum bu yaştan sonra soluklaşmaya başlar (sn). */
export const SOLMA_BASI_SN = 60;
/** Bu yaştan sonra işaretin altında yaşı yazar (sn). */
export const YAS_ETIKETI_SN = 120;
/** Bu yaştan sonra konum eski: gri, kesikli, ilerletilmez (arac-konum.ts ESKI_SN ile aynı). */
export const ESKI_KONUM_SN = 5 * 60;

export type Bayatlik = {
  /** 0 taze, 1 eskimek üzere: renk griye bu oranda karışır. */
  oran: number;
  eski: boolean;
  /** İşaretin altındaki yaş: "3 dk", eskiyse "6 dk önce"; gerekmiyorsa null. */
  etiket: string | null;
  saydamlik: number;
};

/** Konumun yaşına göre işaretin görünümü: 1 dk'dan sonra yavaşça solar, 5 dk'da gri. */
export function bayatlik(yasSn: number): Bayatlik {
  const yas = Number.isFinite(yasSn) ? Math.max(0, yasSn) : 0;
  const eski = yas >= ESKI_KONUM_SN;
  const oran = eski ? 1 : Math.min(1, Math.max(0, (yas - SOLMA_BASI_SN) / (ESKI_KONUM_SN - SOLMA_BASI_SN)));
  const dk = Math.floor(yas / 60);
  return {
    oran,
    eski,
    etiket: eski ? `${dk} dk önce` : yas >= YAS_ETIKETI_SN ? `${dk} dk` : null,
    saydamlik: eski ? 0.75 : 1 - 0.3 * oran,
  };
}

function hexOku(renk: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(renk.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** İki rengi karıştırır (#rrggbb): t=0 → a, t=1 → b. Okunamayan renkte yarıdan sonra b. */
export function renkKaristir(a: string, b: string, t: number): string {
  const oran = Math.min(1, Math.max(0, t));
  const x = hexOku(a);
  const y = hexOku(b);
  if (!x || !y) return oran < 0.5 ? a : b;
  const k = x.map((v, i) => Math.round(v + (y[i] - v) * oran));
  return `#${k.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Bir açıdan ötekine en kısa dönüşle varılan açı (sarılmamış): 350 → 10 için 370. */
export function enKisaAci(onceki: number, hedef: number): number {
  const fark = ((((hedef - onceki) % 360) + 540) % 360) - 180;
  return onceki + fark;
}

// ---------------------------------------------------------------- rotanın çizilerek açılması

type Nokta = { latitude: number; longitude: number };

function uzaklik(a: Nokta, b: Nokta): number {
  // Kısa mesafede düzlem yaklaşımı yeter (yalnız oran için).
  const enlem = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dx = (b.longitude - a.longitude) * Math.cos(enlem);
  const dy = b.latitude - a.latitude;
  return Math.hypot(dx, dy) * 111_320;
}

/**
 * Bacakların çizgilerini toplam uzunluğun `oran` kadarına kadar keser: rota baştan sona
 * çizilerek açılsın. Hiç başlamamış bacak boş dizi; yarıdaki bacak ara noktaya kadar.
 */
export function cizgileriKes(cizgiler: Nokta[][], oran: number): Nokta[][] {
  if (oran >= 1) return cizgiler;
  const boylar = cizgiler.map((c) => {
    let t = 0;
    for (let i = 1; i < c.length; i++) t += uzaklik(c[i - 1], c[i]);
    return t;
  });
  const toplam = boylar.reduce((a, b) => a + b, 0);
  let kalan = Math.max(0, oran) * toplam;
  return cizgiler.map((c, ci) => {
    if (kalan <= 0) return [];
    if (kalan >= boylar[ci]) {
      kalan -= boylar[ci];
      return c;
    }
    const sonuc: Nokta[] = [c[0]];
    for (let i = 1; i < c.length; i++) {
      const d = uzaklik(c[i - 1], c[i]);
      if (kalan >= d) {
        sonuc.push(c[i]);
        kalan -= d;
        continue;
      }
      const t = d > 0 ? kalan / d : 0;
      sonuc.push({
        latitude: c[i - 1].latitude + (c[i].latitude - c[i - 1].latitude) * t,
        longitude: c[i - 1].longitude + (c[i].longitude - c[i - 1].longitude) * t,
      });
      kalan = 0;
      break;
    }
    return sonuc;
  });
}

// ---------------------------------------------------------------- yön konisi (pusula)

/** Pusulanın doğruluğu (expo-location): 3 iyi (±20°'den iyi), 2 orta, 1 zayıf, 0 yok. */
export type PusulaSeviyesi = 0 | 1 | 2 | 3;

/**
 * Yön konisinin açısı (derece, tam açıklık) ve boyu (pt). Pusula emin olunca dar ve uzun,
 * emin değilken geniş ve kısa; bilinmiyorsa koni yok (null).
 */
export function koniOlcusu(seviye: number): { aci: number; boy: number } | null {
  if (seviye >= 3) return { aci: 50, boy: 90 };
  if (seviye === 2) return { aci: 76, boy: 72 };
  if (seviye === 1) return { aci: 106, boy: 58 };
  return null;
}

/** Telefonun baktığı yön: coğrafi kuzeye göre; bilinmiyorsa manyetik; o da yoksa null. */
export function pusulaYonu(gercek: number | null | undefined, manyetik: number | null | undefined): number | null {
  if (gercek != null && gercek >= 0) return gercek % 360;
  if (manyetik != null && manyetik >= 0) return manyetik % 360;
  return null;
}
