// Metrobüste yön adı ve aynı yere giden hatların tek satırda toplanması.
//
// Metrobüs araçlarının tabelasında hat numarası değil gidilen yer yazıyor ("Beylikdüzü",
// "Avcılar"); yolcu da durakta "hangi kod" diye değil "hangi yöne" diye bakıyor. İETT
// verisindeki tabela ise kısaltılmış ("B.SONDURAK", "AVCILAR MRK.ÜNV.KMP.", "ÜNİV.MAH.") ve
// 34G'nin seferlerinin çoğunda boş. Burada:
//   • metrobusYonu: tabelayı araçtaki yazıya çevirir.
//   • metrobusSatirlariniBirlestir: durak ekranında aynı yere giden hatların (34BZ, 34G)
//     satırlarını birleştirir; saatler tek listede, ilk gelen metrobüs en üstte.
//   • metrobusKalkislariniTopla: yakındaki duraklar listesinde aynı işi kalkış başına yapar.
//
// Bağımlılıksız: testlerden doğrudan çağrılabiliyor.

import { baslikYap, metrobusMu, trBuyuk } from './metin';

const YONLER: [RegExp, string][] = [
  [/SONDURAK|BEYL[İI]KD[ÜU]Z[ÜU]|T[ÜU]YAP/, 'Beylikdüzü'],
  [/AVCILAR|[ÜU]N[İI]V/, 'Avcılar'],
  [/S[ÖO][ĞG][ÜU]TL[ÜU][ÇC]E[ŞS]ME/, 'Söğütlüçeşme'],
  [/Z[İI]NC[İI]RL[İI]KUYU/, 'Zincirlikuyu'],
  [/CEV[İI]ZL[İI]BA[ĞG]/, 'Cevizlibağ'],
  [/ED[İI]RNEKAPI/, 'Edirnekapı'],
];

/**
 * Metrobüs tabelası → araçtaki yazı: "B.SONDURAK" → "Beylikdüzü". Tabela boşsa yedekler
 * sırayla denenir (desenin son durağı, güzergâh adının son parçası). Tanınmayan yer
 * başlık biçiminde döner.
 */
export function metrobusYonu(tabela?: string | null, ...yedekler: (string | null | undefined)[]): string {
  for (const aday of [tabela, ...yedekler]) {
    const b = trBuyuk(aday ?? '').trim();
    if (!b) continue;
    for (const [desen, ad] of YONLER) if (desen.test(b)) return ad;
    return baslikYap(aday);
  }
  return '';
}

/** "SÖĞÜTLÜÇEŞME - B.SONDURAK" → "B.SONDURAK": güzergâh adının gidilen ucu. */
export function adinSonParcasi(uzunAd?: string | null): string {
  const parcalar = (uzunAd ?? '').split(' - ');
  return parcalar[parcalar.length - 1].trim();
}

/** Kodları sayı sırasıyla: 34, 34A, 34AS, 34BZ, 34G. */
function kodSirala(kodlar: Iterable<string>): string[] {
  return [...new Set(kodlar)].sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
}

type Satir<K> = { anahtar: string; hatKodu: string; yon: string; guzergah: string; kalkislar: K[] };

/**
 * Durak ekranının satırları: aynı yere giden metrobüs satırları tek satır olur. Satırın
 * öbür bilgileri (hat, yaklaşan otobüs, duran notu, desen) ilk kalkışı en erken olan
 * satırdan; kalkışlar birleşip sıralanır, aynı sefer bir kez sayılır. Her metrobüs satırına
 * `kodlar` eklenir (tek hatlı olana da: kod etiketle görünsün). Öbür satırlara dokunulmaz.
 */
export function metrobusSatirlariniBirlestir<K extends { an: number; kimlik?: string | null }, T extends Satir<K>>(
  satirlar: T[],
): (T & { kodlar?: string[] })[] {
  const gruplar = new Map<string, T[]>();
  const sonuc: (T & { kodlar?: string[] })[] = [];
  for (const s of satirlar) {
    if (!metrobusMu(s.hatKodu) || !s.yon) {
      sonuc.push(s);
      continue;
    }
    const g = gruplar.get(s.yon);
    if (g) {
      g.push(s);
      continue;
    }
    gruplar.set(s.yon, [s]);
    sonuc.push(s); // yer tutucu: aşağıda birleşik satırla değiştirilir
  }
  return sonuc.map((s) => {
    const g = metrobusMu(s.hatKodu) && s.yon ? gruplar.get(s.yon) : undefined;
    if (!g) return s;
    const ilk = (x: T) => x.kalkislar[0]?.an ?? Infinity;
    const taban = [...g].sort((a, b) => ilk(a) - ilk(b))[0];
    const gorulen = new Set<string>();
    const kalkislar = g
      .flatMap((x) => x.kalkislar)
      .sort((a, b) => a.an - b.an)
      .filter((k) => {
        const anahtar = `${k.kimlik ?? ''}|${k.an}`;
        if (gorulen.has(anahtar)) return false;
        gorulen.add(anahtar);
        return true;
      });
    return {
      ...taban,
      anahtar: g.length > 1 ? `metrobus|${s.yon}` : taban.anahtar,
      guzergah: '',
      kalkislar,
      kodlar: kodSirala(g.map((x) => x.hatKodu)),
    };
  });
}

/**
 * Yakındaki duraklar listesi: kalkışlar (saate göre sıralı) içinde aynı yere giden
 * metrobüslerden yalnız ilki kalır; yanına o yere giden bütün metrobüs kodları yazılır.
 * Öbür kalkışlar olduğu gibi (kodlar null).
 */
export function metrobusKalkislariniTopla<K>(
  kalkislar: K[],
  bilgi: (k: K) => { kod: string; yon: string },
): { k: K; yon: string | null; kodlar: string[] | null }[] {
  const yonKodlari = new Map<string, string[]>();
  for (const k of kalkislar) {
    const { kod, yon } = bilgi(k);
    if (!metrobusMu(kod) || !yon) continue;
    yonKodlari.set(yon, [...(yonKodlari.get(yon) ?? []), kod.trim().toLocaleUpperCase('tr-TR')]);
  }
  const yazilan = new Set<string>();
  const sonuc: { k: K; yon: string | null; kodlar: string[] | null }[] = [];
  for (const k of kalkislar) {
    const { kod, yon } = bilgi(k);
    if (!metrobusMu(kod) || !yon) {
      sonuc.push({ k, yon: null, kodlar: null });
      continue;
    }
    if (yazilan.has(yon)) continue;
    yazilan.add(yon);
    sonuc.push({ k, yon, kodlar: kodSirala(yonKodlari.get(yon) ?? []) });
  }
  return sonuc;
}
