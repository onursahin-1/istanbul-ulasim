// Hattı bilinen aracın hangi güzergâhta (yön + varyant) olduğunu hareketinden çıkarır.
//
// İETT beslemesinde her GTFS "route" bir hattın tek bir güzergâh-yön varyantı:
// 34G için 34G_G_D9005 (gidiş), 34G_D_D9006 (dönüş), garaj çıkışları… Hat taraması
// aracın o anki güzergâhını veriyor ama saatlik bütçeyle bir hat ancak saatler
// sonra yeniden sorulabiliyor; o arada araç birkaç kez yön değiştiriyor.
//
// Oysa aracın hattı gün boyu değişmiyor. Bu yüzden köprü "araç → hat" bilgisini
// saklıyor, yönü de iki ardışık konumdan çıkarıyor: aracın o varyantın durak
// sırasında ilerlediği varyantlar aday. Duran araçta (sıra değişmiyor) karar
// verilmiyor; bir sonraki nabızda yeniden denenir.
//
// Saf: yalnızca tarifeye ve iki konuma bakıyor.

import { enYakinDurak } from './tarife.mjs';

/**
 * @param {object} tarife tarifeyiKur() çıktısı
 * @param {number[]} adaylar hattın bütün varyantları (rota sıraları)
 * @param {{enlem:number, boylam:number}} onceki aracın bir önceki konumu
 * @param {{enlem:number, boylam:number}} simdiki aracın şimdiki konumu
 * @returns {{rota:number, durak:number, sira:number, metre:number}[]} aracın
 *   ilerlediği varyantlar, iki konumun güzergâha toplam uzaklığına göre sıralı
 */
export function yonluAdaylar(tarife, adaylar, onceki, simdiki) {
  const sonuc = [];
  for (const rota of adaylar ?? []) {
    const a = enYakinDurak(tarife, rota, onceki.enlem, onceki.boylam);
    const b = enYakinDurak(tarife, rota, simdiki.enlem, simdiki.boylam);
    if (!a || !b) continue;
    // Durak sırasında ilerlemiyorsa ya ters yön ya da araç duruyor.
    if (b.sira <= a.sira) continue;
    sonuc.push({ rota, durak: b.durak, sira: b.sira, metre: b.metre, toplam: a.metre + b.metre });
  }
  sonuc.sort((x, y) => x.toplam - y.toplam);
  return sonuc.map(({ toplam: _t, ...x }) => x);
}

/** Aracın iki konumu arasında hareket sayılacak en az yol (metre). */
export const HAREKET_ESIGI_M = 150;

/** Önceki konum bundan eskiyse yön çıkarımında kullanılmaz: araç arada dönmüş olabilir. */
export const IZ_OMRU_MS = 8 * 60_000;

/**
 * Araçların bir önceki konumunu tutar. Konum yalnızca araç gerçekten hareket
 * ettiğinde ya da kayıt eskidiğinde yenilenir: duran bir aracın konumunu her
 * nabızda üzerine yazarsak, hareket etmeye başladığında karşılaştıracak eski bir
 * nokta kalmaz.
 */
export class KonumIzi {
  constructor() {
    this.kayit = new Map();
  }

  /** Karşılaştırmaya uygun önceki konum; yoksa null. */
  onceki(kapiNo, simdi) {
    const k = this.kayit.get(kapiNo);
    if (!k || simdi - k.an > IZ_OMRU_MS) return null;
    return k;
  }

  guncelle(kapiNo, enlem, boylam, simdi) {
    const k = this.kayit.get(kapiNo);
    if (k && simdi - k.an <= IZ_OMRU_MS && metreArasi(k, { enlem, boylam }) < HAREKET_ESIGI_M) return;
    this.kayit.set(kapiNo, { enlem, boylam, an: simdi });
  }

  temizle(simdi) {
    for (const [kapi, k] of this.kayit) if (simdi - k.an > 2 * IZ_OMRU_MS) this.kayit.delete(kapi);
  }
}

export function metreArasi(a, b) {
  const olcek = Math.cos((a.enlem * Math.PI) / 180);
  const de = b.enlem - a.enlem;
  const db = (b.boylam - a.boylam) * olcek;
  return Math.sqrt(de * de + db * db) * 111_320;
}

function uclar(tarife, rota) {
  const liste = tarife.rotaDuraklari.get(rota);
  return liste?.length ? [liste[0].durak, liste[liste.length - 1].durak] : null;
}

function durakArasi(tarife, a, b) {
  return metreArasi(
    { enlem: tarife.durakEnlem[a], boylam: tarife.durakBoylam[a] },
    { enlem: tarife.durakEnlem[b], boylam: tarife.durakBoylam[b] },
  );
}

/**
 * İki güzergâhın aynı koridorda olup olmadığı: uçları ne kadar uzak (metre).
 *
 * Aynı yöndeki kopya uçları aynı sırayla, ters yöndeki ikizi yer değiştirmiş
 * olarak paylaşıyor. İkisinin küçüğü alınıyor: araç tarama sonrası yön
 * değiştirmiş olsa da ikizine yakın çıkıyor. (Durak kimlikleri karşılaştırılamaz:
 * caddenin iki yakasındaki duraklar ayrı kimlik taşıyor.)
 */
export function koridorFarki(tarife, rota, referans) {
  const x = uclar(tarife, rota);
  const y = uclar(tarife, referans);
  if (!x || !y) return Infinity;
  const ayni = durakArasi(tarife, x[0], y[0]) + durakArasi(tarife, x[1], y[1]);
  const ters = durakArasi(tarife, x[0], y[1]) + durakArasi(tarife, x[1], y[0]);
  return Math.min(ayni, ters);
}

/** Aynı koridordan sayılmak için uçların toplam uzaklık payı (metre). */
export const KORIDOR_PAYI_M = 800;

/**
 * Yönü tutan adayları, taramanın bayat da olsa verdiği güzergâhın koridoruna göre
 * süzer. Aynı yöndeki varyantlar (garaj çıkışı, kısa dönüş) durakların çoğunu
 * paylaştığı için tek bir konumdan ayırt edilemiyor; aracın bilinen son
 * güzergâhının koridoru en güçlü ipucu. Koridorda aday yoksa hepsi döner.
 */
export function koridoraGoreSuz(tarife, adaylar, referansRota) {
  if (referansRota === undefined || referansRota === null || adaylar.length < 2) return adaylar;
  // Araç tarandığı güzergâhta hâlâ ilerliyorsa varyant belli.
  const ayni = adaylar.filter((a) => a.rota === referansRota);
  if (ayni.length) return ayni;
  const farklar = adaylar.map((a) => koridorFarki(tarife, a.rota, referansRota));
  const enAz = Math.min(...farklar);
  if (!Number.isFinite(enAz)) return adaylar;
  return adaylar.filter((_, i) => farklar[i] <= enAz + KORIDOR_PAYI_M);
}
