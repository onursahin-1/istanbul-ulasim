// Araç tabanlı varış tahmini: bir durağa hangi otobüs kaç dakikada gelir.
//
// Köprünün asıl yolu (kopru.mjs) her aracı bir tarife seferine bağlayıp gecikmeyi OTP'ye
// veriyor; OTP de o gecikmeyi seferin kalanına yayıyor. İETT tarifesi gerçeğe uzak olduğu
// için bu zincir kırılgan: araç yanlış sefere bağlanırsa (97GE gerçekte 9 dk uzaktayken
// "17:35'te durakta") ya da hiçbir sefere bağlanamazsa (141M'nin iki otobüsü 5 ve 11 dk
// uzaktayken yalnız tarife) yolcu yanlış saat görüyor.
//
// Burada sefer yok. "Otobüsüm Nerede?" gibi: durağa doğru gelen her otobüsün, hattın
// durak sırasında nerede olduğu bulunur; durağa kalan yol, köprünün öğrendiği durak arası
// sürelerle (segment.mjs; yoksa tarifedeki aralıkla) toplanır. Saat yalnız süre için
// kullanılıyor, seferin kalkış saati için değil.
//
// Aracın yönü (hangi güzergâh varyantı): sefere bağlandıysa onunki; hat taramasının taze
// güzergâh kodu; yoksa iki konumundan (yon.mjs); o da yoksa son bilinen yönü.
//
// Kendini ölçüyor: her araç için birkaç durak ilerisine (3, 6, 10) tahmin bırakılıyor,
// araç o durağı geçince gerçek süre kaydediliyor. Tahmin iki parçanın toplamı: öğrenilen
// durak arası süreler (O) ve öğrenilmemiş aralıklarda tarife (P). Gerçeğe en iyi uyan
// çarpanlar (gerçek ≈ a·O + b·P) sürekli güncelleniyor ve tahmine uygulanıyor: öğrenilen
// süreler ya da tarife sistematik olarak uzun/kısaysa düzeltiliyor. Hata da ufuk ufuk
// raporlanıyor (/durum, `varis`).
//
// Hat başında (ilk durakta) bekleyen otobüs: tarifedeki kalkışı beklenir, hemen hareket
// ediyor sayılmaz.

import { dilimAnahtari } from './segment.mjs';
import { hizmetGunleri } from './tarife.mjs';
import { koridoraGoreSuz, KonumIzi, metreArasi, yonluAdaylar } from './yon.mjs';

/** Bundan eski konumdaki araç sayılmaz. */
export const EN_ESKI_KONUM_SN = 10 * 60;
/** Durağa en çok bu kadar durak uzaktaki araçlar sayılır. */
export const EN_UZAK_DURAK = 70;
/** Bundan uzun varış gösterilmez (uzaktaki araç tahmini anlamsızlaşıyor). */
export const EN_UZUN_VARIS_SN = 90 * 60;
/** Ölçüm ufukları: aracın bu kadar durak ilerisine tahmin bırakılır. */
export const UFUKLAR = [3, 6, 10];
/** Çarpanların 1'e doğru çekilme gücü (bu kadar ölçüm ağırlığında). */
const CEKIM = 20;
/** Her yeni ölçümde eski ölçümlerin ağırlığı (yaklaşık son 2000 ölçüm). */
const UNUTMA = 0.9995;
/**
 * Son bilinen yön bu kadar süre geçerli (araç dururken karar verilemiyor). Eskiden 20 dk
 * idi: hat taraması bir hatta 15–25 dakikada bir dönebildiğinden güzergâh kodu bayatlayan,
 * o sırada iki konumdan da yön çıkmayan (ışık, trafik, durak) otobüs listeden düşüyordu
 * (141M A-1857, 91E A-305; Göztepe Meydanı 18:19). Araç dönünce iki konum yeni yönü
 * zaten söylüyor; bu süre yalnız yön çıkmadığı nabızlar için.
 */
export const YON_OMRU_MS = 45 * 60_000;
/** Güzergâh kodu bu kadar tazeyse yön ondan. */
export const TAZE_GUZERGAH_MS = 20 * 60_000;
/** Durağı bu kadar (durak sırası) geçmiş araç "durakta" sayılır; daha çok geçtiyse gitmiş. */
export const DURAKTA_PAYI = 0.15;

const M_DERECE = 111_320;
/** Aracın gidiş yönü için iki konum arasında en az bu kadar yol (metre); daha azı GPS oynaması. */
export const YON_ICIN_EN_AZ_M = 40;
/**
 * Yönü tutan parça en yakın parçadan en çok bu kadar uzak olabilir. Halka hatlarda iki yaka
 * 20–40 m arayla; daha uzaktaki "yönü tutan" parça (aynı güzergâhın paralel bir sokağı)
 * seçilmesin. Virajda yön hesabı şaşabildiği için sınırsız tercih otobüsü yanlış yere atar.
 */
export const YONLU_PAY_M = 60;
/**
 * Durağı olmayan uzun aralık (otoyol, bağlantı yolu): iki durak arasındaki düz çizgi
 * gerçek yoldan çok uzaklaşabiliyor. 89C'nin Topkapı Alt Geçit → Atışalanı Yanyol aralığı
 * 5,2 km ve durağı yok; otobüsler orada 5–12 dakika "güzergâhın 400 m dışında" sayılıp
 * listeden düşüyor (2026-10-07 kaydında her 89C), aralığın gerçek süresi de hiç
 * ölçülemiyordu (öğrenilen süre: 0 ölçüm; komşu aralıklarda yüzlerce). UZUN_ARALIK_M'den
 * uzun aralıkta izin verilen uzaklık aralığın UZUN_ARALIK_PAYI katı (en çok
 * UZUN_ARALIK_EN_COK_M); "L" biçimli bir yolun köşesi düz çizgiden ~%25 uzakta. Uçlara
 * doğru izin daralır (yol durakta çizgiye kavuşuyor): aralığın uçlarına yakın, ama başka
 * bir sokaktaki otobüs aralığa yerleşmesin.
 */
export const UZUN_ARALIK_M = 2000;
export const UZUN_ARALIK_PAYI = 0.4;
export const UZUN_ARALIK_EN_COK_M = 2500;

/**
 * Durağı olmayan uzun aralıkta planlanan süre yerine ölçülen süre (tarife yönteminde de).
 * İETT 89C'nin Topkapı Alt Geçit → Atışalanı Yanyol aralığına (5,2 km otoyol) 16,7 dakika
 * planlıyor; gece otobüs 4–5 dakikada geçti, varış 10 dakikaya kadar geç gösteriliyordu
 * (T1007: biz 00:34, Otobüsüm Nerede 00:30, gerçek ~00:26; 2026-10-08). Kullanıcı kararı:
 * bu aralıklarda Otobüsüm Nerede'ye değil gerçeğe yakın.
 *
 * Kaynak sırası: son yarım saatte en az CANLI_EN_AZ otobüsün ölçümü (o günün trafiği); yoksa
 * aynı saat diliminde (segment.mjs, dilimAnahtari) en az UZUN_OLCUM_EN_AZ ölçümün ortancası;
 * yoksa plan. Ölçümler diske yazılıyor, UZUN_OLCUM_OMRU_MS saklanıyor.
 */
export const UZUN_OLCUM_EN_AZ = 3;
export const UZUN_OLCUM_OMRU_MS = 21 * 24 * 3_600_000;
const UZUN_OLCUM_EN_COK = 30;

const ortanca = (l) => {
  const s = [...l].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Bir durak aralığında aracın düz çizgiden en çok ne kadar uzak olabileceği (metre);
 * `t` izdüşümün aralıktaki yeri (0–1). Uçtan aralığın %20'sine kadar doğrusal genişler.
 */
export function aralikEsigi(esik, uzunlukM, t = 0.5) {
  if (!(uzunlukM > UZUN_ARALIK_M)) return esik;
  const uc = Math.min(1, 5 * Math.min(t, 1 - t));
  return Math.max(esik, Math.min(UZUN_ARALIK_EN_COK_M, uzunlukM * UZUN_ARALIK_PAYI) * uc);
}

/** Hareket yönü bu kadar süre hatırlanır: durakta, ışıkta bekleyen araç yönünü kaybetmesin. */
export const HAREKET_OMRU_MS = 10 * 60_000;
/**
 * Duran otobüs (mola, park, arıza): son DURGUN_SN saniyedir DURGUN_YARICAP_M metreden az
 * yer değiştirmiş ve konumu taze. Ne zaman kalkacağı belli olmadığından varışı "hemen
 * kalkarsa" (en erken) diye hesaplanır ve uygulama onu ana dakika yapmaz. Işıkta ya da
 * trafikte 1–3 dakikalık duruş buna girmez. Hat başında bekleyen otobüs ayrı: orada
 * tarifedeki kalkış biliniyor. Göztepe Meydanı'nda dört otobüs 14 dakika boyunca
 * "Otobüsüm Nerede?"de 1–3 dk, bizde "Şimdi" görünmüştü (2026-10-07).
 */
export const DURGUN_SN = 5 * 60;
export const DURGUN_YARICAP_M = 60;
/**
 * Yolda bu kadar uzun süredir duran otobüs servis dışı sayılır, hiç gösterilmez (garajda,
 * cep peronda park). Göztepe Meydanı'nda 91E'nin 60 ve 118 dakikadır duran iki otobüsü
 * "en erken 46 dk" diye listede kalıyordu (2026-10-07 23:14).
 */
export const SERVIS_DISI_SN = 20 * 60;
/**
 * Duran otobüsün bulunduğu duraktan rotasının tarifede ±SEFERSIZ_PAY_SN içinde hiç seferi
 * geçmiyorsa otobüs servis dışı sayılır (20 dakikayı beklemeden). Sefer bitmiş yönde
 * 13 dakikadır duran 97GE "Eminönü yönü, en erken 3 dk" diye listede kalıyordu (Göztepe
 * Meydanı, Aksaray yönü, 2026-10-08 00:36). Hareket eden otobüse uygulanmaz: geciken son
 * sefer de tarifenin dışına düşebilir.
 */
export const SEFERSIZ_PAY_SN = 45 * 60;
/**
 * Konumun yaşı kadar (en çok bu kadar saniye) otobüs planlanan sürelerle ileri alınır:
 * "kaç durak uzakta" ve "durağı geçti mi" bu tahmini yere göre. Konum 1–2 dk eski
 * gelebiliyor; otobüs Göztepe Meydanı'nı geçip Yel Değirmeni'ne varmışken listede "1 durak
 * uzakta, şimdi" kalıyordu (2026-10-07 23:25). Uygulamanın haritası da otobüsü aynı sınırla
 * ilerletiyor (EN_COK_TAHMIN_SN).
 */
export const TAHMIN_ILERI_SN = 150;
/**
 * Canlı trafik: son CANLI_PENCERE_MS içinde otobüslerin bir durak çiftini gerçekte kaç
 * saniyede geçtiği. Öğrenilen süreler saat dilimi ortalaması (16–20 gibi); o günkü
 * tıkanıklığı bilmiyor. Göztepe Meydanı'nda akşam trafiğinde otobüsler tahminden çok
 * yavaş geldi (7–9 durak uzaktakiler 7–10 dk geç; 2026-10-07 19:01–19:34 ölçümü).
 * Aynı durak çiftinden az önce geçen otobüslerin süresi en taze bilgi: Google'ın canlı
 * trafiği gibi. Durak çiftleri hattan bağımsız (aynı yoldan geçen bütün hatlar öğretiyor).
 */
export const CANLI_PENCERE_MS = 30 * 60_000;
/**
 * Yerel trafik oranı: son CANLI_PENCERE_MS içinde bir durağa varan otobüslerin gerçek
 * süresinin tahmine oranı (ortanca). O durağa yapılan tahmine uygulanır. Canlı durak arası
 * süreler tek başına yetmiyordu (Göztepe Meydanı 19:15 sonrası ortalama hata −3,3 dk →
 * −2,8 dk): kuyruk ve ışıklar durak çiftlerine dağınık, oran ise doğrudan "bu durağa
 * gelişler bugün tahminden yüzde kaç uzun" diyor.
 */
export const YEREL_EN_AZ = 3;
/**
 * Otobüsün kendi hızı: içinde bulunduğu durak aralığında son birkaç dakikadır sürünüyorsa
 * (kuyruk, kaza) aralığın kalanı ortalama süreyle değil, bu hızla hesaplanır. Göztepe
 * Meydanı'na 3 durak kala bir aralıkta 5 dk kalan 97M A-293 için tahmin "4 dk sonra"
 * diye yerinde sayıyordu (2026-10-07 19:08–19:14).
 */
export const KENDI_HIZ_EN_AZ_MS = 3 * 60_000;
export const KENDI_HIZ_PENCERE_MS = 6 * 60_000;
export const YEREL_ORAN_SINIR = [0.75, 2.5];
/** Bu kadar canlı ölçümle yalnız canlı süre; daha azıyla öğrenilen/tarifeyle yarı yarıya. */
export const CANLI_EN_AZ = 2;
/** Duruyor demek için konum en çok bu kadar eski olabilir (eski konumla bilinemez). */
export const DURGUN_TAZE_MS = 3 * 60_000;
/**
 * İETT çapası. Hat taraması her otobüs için İETT'nin hesapladığı en yakın durağı da
 * veriyor (yakinDurakKodu); "Otobüsüm Nerede?"nin "kaç durak" bilgisi büyük ihtimalle
 * bundan. Eskiden atılıyordu. Şimdi otobüs güzergâhta yalnız bir pencerede aranıyor: o
 * duraktan bir durak geride ile o andan beri geçen sürenin CAPA_HIZ_PAYI katı (+CAPA_EK_SN)
 * planlanan süre ilerisi arası. Halka hatlarda aynı caddenin iki yakası ya da aynı
 * duraktan iki kez geçen güzergâhta otobüs yanlış tura yerleşmiyor. Pencerede yer
 * bulunamazsa (çapa yanlış ya da otobüs güzergâh dışında) eskisi gibi bütün yolda aranır.
 * Çapa ancak taramanın güzergâh kodu aracın şimdiki varyantıyla aynıysa ve CAPA_OMRU_MS
 * içindeyse geçerli.
 */
export const CAPA_OMRU_MS = 20 * 60_000;
export const CAPA_HIZ_PAYI = 2;
export const CAPA_EK_SN = 300;
/** Çapa ile kendi yerleştirmemizi karşılaştırırken iki konumun anı en çok bu kadar farklı olabilir. */
export const CAPA_KARSILASTIRMA_MS = 60_000;

/** Noktanın a→b doğru parçasına izdüşümü: oran (0–1) ve uzaklık (metre). */
function izdusum(tarife, a, b, enlem, boylam) {
  const olcek = Math.cos((enlem * Math.PI) / 180);
  const ax = (tarife.durakBoylam[a] - boylam) * olcek;
  const ay = tarife.durakEnlem[a] - enlem;
  const dx = (tarife.durakBoylam[b] - boylam) * olcek - ax;
  const dy = tarife.durakEnlem[b] - enlem - ay;
  const uz = dx * dx + dy * dy;
  const t = uz > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / uz)) : 0;
  return { t, metre: Math.hypot(ax + t * dx, ay + t * dy) * M_DERECE, uzunluk: Math.sqrt(uz) * M_DERECE };
}

/**
 * Aracın hangi varyantlarda ilerlediği, iki konumun yol üstündeki kesirli yerinden
 * (yoldakiYer). yon.mjs'teki yonluAdaylar en yakın durağa bakıyor: duraklar 300–500 m
 * arayla olduğundan iki konum çoğu zaman aynı durağa düşüyor, yön çıkmıyordu (köprü yeniden
 * başlayınca Göztepe Meydanı'ndaki 87 otobüsün 48'i "yönü belirlenemedi", 2026-10-07).
 * Burada 40 m ilerleme yetiyor. Dönüş: [{ rota, metre }] iki konumun yola toplam uzaklığına göre.
 */
export function ilerleyenVaryantlar(tarife, rotalar, onceki, simdiki, hareket = null) {
  const sonuc = [];
  for (const rota of rotalar ?? []) {
    const yol = tarife.rotaDuraklari.get(rota);
    if (!yol || yol.length < 2) continue;
    const esik = tarife.rotaEsik?.get(rota) ?? 400;
    const a = yoldakiYer(tarife, yol, onceki.enlem, onceki.boylam, esik, hareket);
    const b = yoldakiYer(tarife, yol, simdiki.enlem, simdiki.boylam, esik, hareket);
    if (!a || !b) continue;
    const ilerleme = b.yer - a.yer;
    // Geri gidiyorsa ters yön; çok ileri sıçradıysa (halkanın öbür yakası) güvenilmez.
    if (ilerleme <= 0.02 || ilerleme > 15) continue;
    sonuc.push({ rota, metre: a.metre + b.metre });
  }
  return sonuc.sort((x, y) => x.metre - y.metre);
}

/**
 * Yolda uzun süredir (DURGUN_SN) kımıldamayan ve konumu taze otobüs. Hat başında kalkışını
 * bekleyen otobüs ayrıca ayıklanmalı (orada tarifedeki kalkış biliniyor).
 */
export function duruyorMu(v, simdiMs) {
  return v.durgunBas != null && v.damga - v.durgunBas >= DURGUN_SN * 1000 && simdiMs - v.damga <= DURGUN_TAZE_MS;
}

/**
 * Çapanın yol üstündeki penceresi: durağın yoldaki her uğrayışı için [bir önceki durak,
 * geçen sürede en çok varılabilecek durak] (yol parçası sırası). Durak yolda yoksa null.
 */
export function capaPenceresi(yol, durak, gecenSn) {
  const pencereler = [];
  for (let k = 0; k < yol.length; k++) {
    if (yol[k].durak !== durak) continue;
    const sinir = yol[k].saniye + Math.max(0, gecenSn) * CAPA_HIZ_PAYI + CAPA_EK_SN;
    let son = k;
    while (son + 1 < yol.length && yol[son + 1].saniye <= sinir) son++;
    pencereler.push([Math.max(0, k - 1), son]);
  }
  return pencereler.length ? pencereler : null;
}

/**
 * Yol üstündeki kesirli yeri `saniye` kadar planlanan durak arası sürelerle ileri alır
 * (en çok TAHMIN_ILERI_SN; aralık en az 30 sn sayılır).
 */
export function ilerlet(yol, yer, saniye) {
  let gecen = Math.min(Math.max(0, saniye), TAHMIN_ILERI_SN);
  let y = yer;
  while (gecen > 0 && Math.floor(y) + 1 < yol.length) {
    const j = Math.floor(y);
    const aralik = Math.max(30, yol[j + 1].saniye - yol[j].saniye);
    const kalan = (j + 1 - y) * aralik;
    if (gecen < kalan) return y + gecen / aralik;
    gecen -= kalan;
    y = j + 1;
  }
  return y;
}

/**
 * Aracın yol (durak listesi) üstündeki kesirli yeri: 3.4 = dördüncü durağı geçmiş, beşinciye
 * %40 gelmiş. Yola `esik` metreden (uzun aralıkta aralikEsigi) uzaksa null.
 *
 * `hareket` (aracın son gidiş yönü, {dx, dy} derece; boylam farkı enleme göre ölçekli)
 * verilirse yolun aracın gittiği yöndeki parçaları önce gelir. Halka hatlarda gidiş ve
 * dönüş aynı caddenin iki yakasından geçiyor (20–40 m); yalnız en yakın parçaya bakınca
 * dönüşteki otobüs gidişe yerleşiyor, durağa 50 durak uzakta sanılıyordu (89C, 91E,
 * Göztepe Meydanı). Yönü tutan parça yoksa ya da en yakından YONLU_PAY_M'den uzaksa en
 * yakın parça.
 *
 * `pencereler` ([[ilk, son]] yol parçası sırası) verilirse yalnız o parçalarda aranır.
 */
export function yoldakiYer(tarife, yol, enlem, boylam, esik, hareket = null, pencereler = null) {
  let enIyi = null;
  let yonlu = null;
  const olcek = Math.cos((enlem * Math.PI) / 180);
  for (let i = 0; i + 1 < yol.length; i++) {
    // Çapa penceresi (capaPenceresi) verildiyse yalnız onun içindeki parçalar.
    if (pencereler && !pencereler.some(([bas, son]) => i >= bas && i <= son)) continue;
    const a = yol[i].durak;
    const b = yol[i + 1].durak;
    const p = izdusum(tarife, a, b, enlem, boylam);
    // Uzun, durağı olmayan aralıkta düz çizgiden daha uzak olabilir (aralikEsigi).
    if (p.metre > aralikEsigi(esik, p.uzunluk, p.t)) continue;
    const aday = { yer: i + p.t, metre: p.metre };
    if (!enIyi || p.metre < enIyi.metre) enIyi = aday;
    if (hareket) {
      const sx = (tarife.durakBoylam[b] - tarife.durakBoylam[a]) * olcek;
      const sy = tarife.durakEnlem[b] - tarife.durakEnlem[a];
      if (sx * hareket.dx + sy * hareket.dy > 0 && (!yonlu || p.metre < yonlu.metre)) yonlu = aday;
    }
  }
  return yonlu && enIyi && yonlu.metre <= enIyi.metre + YONLU_PAY_M ? yonlu : enIyi;
}

export class AracVarislari {
  /**
   * @param tarife tarifeyiKur() çıktısı (rotaDuraklari, durakEnlem/Boylam, kisaAdtanRotalar, guzergahtanRota, rotaEsik)
   * @param {(rota:number, durak:number, anSn:number) => {durak:number, saniye:number}[] | null} yolBul
   *   rotanın o duraktan geçen bir seferinin durakları ve tarife saatleri
   * @param {(a:number, b:number, anSn:number) => number | null} ogrenilenSure durak arası öğrenilen süre (sn)
   */
  /**
   * @param {(rota:number, durak:number, anSn:number) => number | null} [kalkisBul] hat başından
   *   şu andan sonraki ilk tarife kalkışı (unix sn)
   */
  /**
   * @param {{ yontem?: 'tarife' | 'ogrenilen' }} [secenek] varış süresinin kaynağı:
   *   'tarife' — İETT'nin planladığı durak arası süreler (Otobüsüm Nerede? ile aynı sonucu
   *   veriyor: 2026-10-07 Göztepe Meydanı ölçümünde 41 tahminde ortanca fark 0,0 dk);
   *   'ogrenilen' — öğrenilen süreler, çarpanlar, canlı trafik ve otobüsün kendi hızı
   *   (aynı ölçümde Otobüsüm Nerede?den ortalama 3,3 dk geç).
   */
  constructor(tarife, yolBul, ogrenilenSure, kalkisBul = () => null, secenek = {}) {
    this.tarife = tarife;
    this.yontem = secenek.yontem ?? 'ogrenilen';
    this.yolBul = yolBul;
    this.ogrenilenSure = ogrenilenSure;
    this.kalkisBul = kalkisBul;
    /** kapıNo → ölçüm izi: { rota, yol, yer, damga, hedefler } */
    this.izleme = new Map();
    /** Çarpan regresyonu toplamları ve ufuk hataları (ham ve düzeltilmiş). */
    this.olcum = { OO: 0, OP: 0, PP: 0, OA: 0, PA: 0, n: 0, hata: {} };
    this.iz = new KonumIzi();
    /** kapıNo → { rota, an } son bilinen yön */
    this.yon = new Map();
    /** kapıNo → { dx, dy, an } aracın son gidiş yönü (yoldakiYer'de halka hatlar için) */
    this.hareket = new Map();
    /** kapıNo → { enlem, boylam, an } aracın son kımıldamadığı yer ve o yere geldiği an (konum zamanı) */
    this.durgunluk = new Map();
    /** "durakA>durakB" → [{ an (ms), sn }] son yarım saatte gözlenen geçiş süreleri */
    this.canli = new Map();
    /** durak (sıra) → [{ an (ms), oran }] son yarım saatte o durağa varışlarda gerçek/tahmin */
    this.yerel = new Map();
    /** Son nabzın araçları: { kapiNo, hat, rota, enlem, boylam, damga (ms) } */
    this.araclar = [];
    this.an = 0;
    this.yolOnbellegi = new Map();
    this.atlanan = new Map();
    /** kapıNo → son karşılaştırılan çapanın anı (aynı tarama iki kez sayılmasın) */
    this.capaGorulen = new Map();
    /** "durakId>durakId|dilim" → [{ an (ms), sn }] uzun aralıkların ölçülen geçiş süreleri */
    this.uzunOlcum = new Map();
    /** "a>b" (sıra) → uzun aralık mı (önbellek) */
    this.uzunMuOnbellek = new Map();
    /** İETT'nin en yakın durağı ile bizim yerleştirmemiz: kaç kez uyuştu, son uyuşmayanlar. */
    this.capaOlcum = { uyumlu: 0, uyumsuz: 0, ornekler: [] };
  }

  /**
   * Her nabızda: ham filo konumları, sefere bağlananlar ve hat taramasının bildiği araçlar.
   * @param araclar [{kapiNo, enlem, boylam, tarih: Date}]
   * @param eslesenler kopru.mjs araclariEslestir çıktısı (kapiNo, rotaIdx)
   * @param {(kapiNo:string) => {hat:string, guzergah?:string, an:number} | null} bilgiAl
   */
  guncelle(araclar, eslesenler, bilgiAl, simdi = new Date()) {
    const an = simdi.getTime();
    const T = this.tarife;
    const bagli = new Map(eslesenler.map((e) => [e.kapiNo, e.rotaIdx]));
    const liste = [];
    /** Bu nabızda sayılmayan araçlar ve nedeni (teşhis için). */
    this.atlanan = new Map();
    for (const a of araclar) {
      if (!a.kapiNo || !Number.isFinite(a.enlem) || !Number.isFinite(a.boylam) || !a.tarih) continue;
      const bilgi = bilgiAl(a.kapiNo);
      const hat = String(bilgi?.hat ?? '').trim().toUpperCase();
      if ((an - a.tarih.getTime()) / 1000 > EN_ESKI_KONUM_SN) {
        if (hat) this.atlanan.set(a.kapiNo, { hat, neden: `konum ${Math.round((an - a.tarih.getTime()) / 60_000)} dk eski` });
        continue;
      }
      if (!hat) continue;
      // Hattının son taramasında yoksa görevde değil (seferi bitti, garaja çekildi; tarama.mjs).
      if (bilgi.gorevde === false) {
        this.atlanan.set(a.kapiNo, { hat, neden: 'hattın son taramasında yok (görevde değil: garaj ya da sefer bitti)' });
        continue;
      }
      const rotalar = T.kisaAdtanRotalar.get(hat) ?? [];
      let rota = bagli.get(a.kapiNo);
      let rotaNasil = rota != null ? 'sefer eşleşmesi' : null;
      if (rota == null && bilgi.guzergah && an - (bilgi.an ?? 0) <= TAZE_GUZERGAH_MS) {
        rota = T.guzergahtanRota.get(String(bilgi.guzergah).toUpperCase());
        if (rota != null) rotaNasil = 'taze güzergâh kodu';
      }
      const sonYon = this.yon.get(a.kapiNo);
      const y = sonYon && an - sonYon.an <= YON_OMRU_MS && rotalar.includes(sonYon.rota) ? sonYon : null;
      if (rota == null) {
        const onceki = this.iz.onceki(a.kapiNo, an);
        let adaylar = [];
        if (onceki && metreArasi(onceki, a) >= YON_ICIN_EN_AZ_M) {
          const olcek = Math.cos((a.enlem * Math.PI) / 180);
          const vektor = { dx: (a.boylam - onceki.boylam) * olcek, dy: a.enlem - onceki.enlem };
          adaylar = ilerleyenVaryantlar(T, rotalar, onceki, a, vektor);
          // Yol üstünde yer bulunamazsa (güzergâh dışı kısa sapma) eski yöntem.
          if (!adaylar.length) adaylar = yonluAdaylar(T, rotalar, onceki, a);
        }
        if (adaylar.length) {
          // Aynı yöndeki varyantlar (garaj çıkışı, kısa dönüş, ring) çoğu durağı paylaşıyor:
          // en yakın aday çoğu zaman başka bir varyant çıkıyor, o varyant da bu duraktan
          // geçmiyorsa otobüs düşüyordu. Önce aracın bilinen varyantı (hâlâ ilerliyorsa),
          // sonra bilinen varyantın (ya da bayat güzergâh kodunun) koridoru.
          if (y && adaylar.some((x) => x.rota === y.rota)) rota = y.rota;
          else {
            const bayat = bilgi.guzergah ? T.guzergahtanRota.get(String(bilgi.guzergah).toUpperCase()) : undefined;
            rota = koridoraGoreSuz(T, adaylar, y?.rota ?? bayat)[0]?.rota;
          }
          if (rota != null) rotaNasil = 'iki konum';
        }
      }
      if (rota == null) {
        if (y) {
          rota = y.rota;
          rotaNasil = 'son bilinen yön';
        }
      }
      if (rota == null) this.atlanan.set(a.kapiNo, { hat, neden: 'yönü (güzergâh varyantı) belirlenemedi' });
      this.hareketiGuncelle(a.kapiNo, a, an);
      const durgunBas = this.durgunluguGuncelle(a.kapiNo, a);
      this.iz.guncelle(a.kapiNo, a.enlem, a.boylam, an);
      if (rota == null) continue;
      this.yon.set(a.kapiNo, { rota, an });
      const h = this.hareket.get(a.kapiNo);
      const capa = this.capaBul(bilgi, rota, an);
      const v = {
        kapiNo: a.kapiNo,
        hat,
        rota,
        enlem: a.enlem,
        boylam: a.boylam,
        damga: a.tarih.getTime(),
        hareket: h && an - h.an <= HAREKET_OMRU_MS ? h : null,
        durgunBas,
        rotaNasil,
        capa,
      };
      if (capa) this.capaKarsilastir(v);
      liste.push(v);
      this.olc(v);
    }
    for (const [k, iz] of this.izleme) if (an - iz.damga > 30 * 60_000) this.izleme.delete(k);
    for (const [k, y] of this.yon) if (an - y.an > 2 * YON_OMRU_MS) this.yon.delete(k);
    for (const [k, h] of this.hareket) if (an - h.an > 2 * HAREKET_OMRU_MS) this.hareket.delete(k);
    for (const [k, d] of this.durgunluk) if (an - d.son > 30 * 60_000) this.durgunluk.delete(k);
    for (const [k, t] of this.capaGorulen) if (an - t > 2 * CAPA_OMRU_MS) this.capaGorulen.delete(k);
    for (const [k, l] of this.canli) if (!l.length || an - l[l.length - 1].an > CANLI_PENCERE_MS) this.canli.delete(k);
    this.iz.temizle(an);
    this.araclar = liste;
    this.an = an;
  }

  /**
   * Hat taramasının İETT en yakın durağı: { durak (sıra), an (konumun anı, ms) } ya da null.
   * Yalnız taramanın güzergâh kodu aracın şimdiki varyantını gösteriyorsa ve tazeyse.
   */
  capaBul(bilgi, rota, an) {
    const T = this.tarife;
    if (!bilgi?.yakinDurak || !Number.isFinite(bilgi.konumAn) || an - bilgi.konumAn > CAPA_OMRU_MS) return null;
    if (!bilgi.guzergah || T.guzergahtanRota.get(String(bilgi.guzergah).toUpperCase()) !== rota) return null;
    const durak = T.kodtanDurak?.get(String(bilgi.yakinDurak).trim());
    return durak == null ? null : { durak, an: bilgi.konumAn };
  }

  /**
   * Yeni bir taramanın çapası geldiğinde: aynı ana yakın konumla (CAPA_KARSILASTIRMA_MS)
   * bizim çapasız yerleştirmemiz İETT'nin en yakın durağının en çok bir durak yanında mı?
   * /durum'da `capa` — yanlış yerleştirmenin ne kadar sık olduğunu ölçmek için.
   */
  capaKarsilastir(v) {
    const { capa } = v;
    if (this.capaGorulen.get(v.kapiNo) === capa.an) return;
    if (Math.abs(v.damga - capa.an) > CAPA_KARSILASTIRMA_MS) return;
    this.capaGorulen.set(v.kapiNo, capa.an);
    const T = this.tarife;
    const yol = T.rotaDuraklari.get(v.rota);
    if (!yol || yol.length < 2) return;
    const yer = yoldakiYer(T, yol, v.enlem, v.boylam, T.rotaEsik?.get(v.rota) ?? 400, v.hareket);
    const sira = [];
    yol.forEach((d, i) => d.durak === capa.durak && sira.push(i));
    if (!sira.length) return;
    const fark = yer ? Math.min(...sira.map((i) => Math.abs(Math.round(yer.yer) - i))) : null;
    if (fark != null && fark <= 1) {
      this.capaOlcum.uyumlu++;
      return;
    }
    this.capaOlcum.uyumsuz++;
    this.capaOlcum.ornekler = [
      ...this.capaOlcum.ornekler,
      {
        an: new Date(v.damga).toISOString(),
        kapiNo: v.kapiNo,
        hat: v.hat,
        rota: T.rotaAd?.[v.rota] ?? null,
        iettDurak: T.durakAd?.[capa.durak] ?? null,
        bizimDurak: yer ? (T.durakAd?.[yol[Math.round(yer.yer)]?.durak] ?? null) : null,
        durakFarki: fark,
      },
    ].slice(-10);
  }

  /** Aracın verilen yol üstündeki yeri; çapası varsa önce onun penceresinde. */
  yerBul(v, yol) {
    const T = this.tarife;
    const esik = T.rotaEsik?.get(v.rota) ?? 400;
    const pencere = v.capa ? capaPenceresi(yol, v.capa.durak, (v.damga - v.capa.an) / 1000) : null;
    return (
      (pencere && yoldakiYer(T, yol, v.enlem, v.boylam, esik, v.hareket, pencere)) ||
      yoldakiYer(T, yol, v.enlem, v.boylam, esik, v.hareket)
    );
  }

  /**
   * Aracın gidiş yönü: önceki konumundan (KonumIzi, araç gerçekten yol alınca yenileniyor)
   * bugünkü konumuna. Araç yerinde sayıyorsa son bilinen yön kalır.
   */
  hareketiGuncelle(kapiNo, a, an) {
    const onceki = this.iz.onceki(kapiNo, an);
    if (!onceki || metreArasi(onceki, a) < YON_ICIN_EN_AZ_M) return;
    const olcek = Math.cos((a.enlem * Math.PI) / 180);
    this.hareket.set(kapiNo, { dx: (a.boylam - onceki.boylam) * olcek, dy: a.enlem - onceki.enlem, an });
  }

  /**
   * Aracın kımıldamadığı yerin başlangıç anı (ms, konum zamanı): DURGUN_YARICAP_M'den çok
   * yer değiştirince yeni yer, o konumun anından başlar.
   */
  durgunluguGuncelle(kapiNo, a) {
    const t = a.tarih.getTime();
    const d = this.durgunluk.get(kapiNo);
    if (!d || t < d.an || metreArasi(d, a) >= DURGUN_YARICAP_M) {
      this.durgunluk.set(kapiNo, { enlem: a.enlem, boylam: a.boylam, an: t, son: t });
      return t;
    }
    d.son = t;
    return d.an;
  }

  /**
   * Rotanın bu duraktan ±SEFERSIZ_PAY_SN içinde tarifede seferi yok mu? Tarife bilinmiyorsa
   * (kalkış bulunamıyor) false: karar verilmez.
   */
  seferYok(rota, durak, simdiMs) {
    const simdiSn = Math.floor(simdiMs / 1000);
    const kalkis = this.kalkisBul(rota, durak, simdiSn - SEFERSIZ_PAY_SN);
    return kalkis != null && kalkis > simdiSn + SEFERSIZ_PAY_SN;
  }

  /** Rotanın o duraktan geçen temsilci seferinin yolu (yarım saat önbellekte). */
  yol(rota, durak, anSn) {
    const anahtar = `${rota}|${durak}`;
    const k = this.yolOnbellegi.get(anahtar);
    if (k && Math.abs(anSn - k.anSn) < 1800) return k.yol;
    const yol = this.yolBul(rota, durak, anSn);
    this.yolOnbellegi.set(anahtar, { yol, anSn });
    if (this.yolOnbellegi.size > 5000) this.yolOnbellegi.delete(this.yolOnbellegi.keys().next().value);
    return yol;
  }

  /**
   * Bir durağa gelen araçlar, hat hat, varışa göre sıralı.
   * @param {number} durak durak sırası (tarife.durakAd içinde)
   * @param {Set<string>} [hatlar] yalnız bu hatlar (büyük harf)
   * @returns {Record<string, {kapiNo:string, varis:number, kalanDurak:number, yasSn:number,
   *   enlem:number, boylam:number, ogrenilen:number}[]>}
   */
  durakVarislari(durak, simdiMs = Date.now(), hatlar = null) {
    const sonuc = {};
    for (const v of this.araclar) {
      if (hatlar && !hatlar.has(v.hat)) continue;
      const { kayit } = this.aracinVarisi(v, durak, simdiMs);
      if (kayit) (sonuc[v.hat] ??= []).push(kayit);
    }
    for (const liste of Object.values(sonuc)) liste.sort((a, b) => a.varis - b.varis);
    return sonuc;
  }

  /**
   * Bir aracın bu durağa varışı: `{ kayit }`, sayılmıyorsa `{ neden }` (teşhis için,
   * "Otobüsüm Nerede?"de görünen otobüs bizde neden yok).
   */
  aracinVarisi(v, durak, simdiMs) {
    const T = this.tarife;
    const anSn = Math.floor(v.damga / 1000);
    const yol = this.yol(v.rota, durak, anSn);
    if (!yol || yol.length < 2) return { neden: 'aracın güzergâhı bu duraktan geçmiyor' };
    const esik = T.rotaEsik?.get(v.rota) ?? 400;
    const yer = this.yerBul(v, yol);
    if (!yer) return { neden: `araç güzergâhın ${esik} m dışında` };
    // Hedef: aracın önündeki ilk uğrayışı (halka hatlarda durak iki kez geçebilir).
    let hedef = -1;
    for (let i = 0; i < yol.length; i++) {
      if (yol[i].durak === durak && i + DURAKTA_PAYI >= yer.yer) {
        hedef = i;
        break;
      }
    }
    if (hedef < 0) return { neden: 'durağı geçmiş' };
    const tam = Math.floor(yer.yer);
    const kalanDurak = Math.max(0, hedef - tam - (yer.yer - tam >= 1 - DURAKTA_PAYI ? 1 : 0));
    if (hedef - tam > EN_UZAK_DURAK) return { neden: `durağa ${hedef - tam} durak (çok uzak)` };
    // Hat başında bekleyen otobüs: tarifedeki kalkış saatinden önce yola çıkmaz.
    let cikis = v.damga / 1000;
    const hatBasi = yer.yer < DURAKTA_PAYI;
    if (hatBasi) {
      const kalkis = this.kalkisBul(v.rota, yol[0].durak, Math.floor(simdiMs / 1000));
      if (kalkis != null && kalkis > cikis) cikis = kalkis;
    }
    // Yolda uzun süredir duran otobüs: en erken şimdi kalkar.
    const duruyor = !hatBasi && duruyorMu(v, simdiMs);
    if (duruyor && simdiMs - v.durgunBas >= SERVIS_DISI_SN * 1000) {
      return { neden: `${Math.round((simdiMs - v.durgunBas) / 60_000)} dk'dır duruyor (servis dışı sayıldı)` };
    }
    if (duruyor && this.seferYok(v.rota, yol[Math.min(Math.floor(yer.yer), yol.length - 1)].durak, simdiMs)) {
      return { neden: 'duruyor ve bu saatte tarifede seferi yok (servis dışı sayıldı)' };
    }
    if (duruyor) cikis = Math.max(cikis, simdiMs / 1000);
    const tahminiYer = hatBasi || duruyor ? yer.yer : ilerlet(yol, yer.yer, (simdiMs - v.damga) / 1000);
    if (tahminiYer > hedef + DURAKTA_PAYI) return { neden: 'tahminen durağı geçti (konum eski)' };
    const tTam = Math.floor(tahminiYer);
    const gosterilenKalan = Math.max(0, hedef - tTam - (tahminiYer - tTam >= 1 - DURAKTA_PAYI ? 1 : 0));
    let parca;
    let sure;
    if (this.yontem === 'tarife') {
      // Yalnız planlanan durak arası süreler; çarpan, canlı trafik, kendi hızı yok.
      parca = this.kalanYol(yol, yer.yer, hedef, anSn, simdiMs, null, true);
      sure = parca.P;
    } else {
      // Kendi hızı yalnız yolda ilerleyen otobüs için (duran ve hat başında bekleyen ayrı).
      const kendiHiz = duruyor || hatBasi ? null : this.kendiHizi(v.kapiNo);
      parca = this.kalanYol(yol, yer.yer, hedef, anSn, simdiMs, kendiHiz);
      const { a, b } = this.carpanlar();
      sure = (a * parca.O + b * parca.P) * this.yerelOran(durak, simdiMs) + parca.C;
    }
    if (cikis + sure - simdiMs / 1000 > EN_UZUN_VARIS_SN) return { neden: 'varış 90 dk\'dan uzak' };
    const varis = Math.max(simdiMs, (cikis + sure) * 1000);
    const { aralik, ogrenilen } = parca;
    return {
      kayit: {
        kapiNo: v.kapiNo,
        rotaId: T.rotaAd?.[v.rota] ?? null,
        varis,
        // Konumun yaşı kadar ilerletilmiş yere göre (haritadaki işaretle aynı).
        kalanDurak: Math.min(kalanDurak, gosterilenKalan),
        // Durağın ardından gelen durak: uygulama otobüsü aynı yöne giden satıra koysun
        // (aracın güzergâh varyantının satırı yoksa; ör. günün son seferi geçmiş varyant).
        sonrakiDurak: yol[hedef + 1] ? (T.durakAd?.[yol[hedef + 1].durak] ?? null) : null,
        // Duruyorsa kaç saniyedir; varış o zaman "hemen kalkarsa en erken".
        duruyorSn: duruyor ? Math.round((simdiMs - v.durgunBas) / 1000) : null,
        yasSn: Math.max(0, Math.round((simdiMs - v.damga) / 1000)),
        enlem: v.enlem,
        boylam: v.boylam,
        ogrenilen: aralik ? Math.round((ogrenilen / aralik) * 100) / 100 : 1,
        // Kalan yolun ne kadarı canlı (son yarım saatte gözlenen) sürelerle.
        canli: aralik ? Math.round((parca.canliAralik / aralik) * 100) / 100 : 0,
      },
    };
  }

  /**
   * Hat ekranı için: verilen güzergâhlardaki (GTFS route_id) son nabzın otobüsleri. OTP'nin
   * araç konumları yalnız bir tarife seferine bağlanabilenleri içeriyor ve köprüden 45 sn'de
   * bir çekiliyor; burada yönü güzergâh kodundan ya da hareketinden bilinen her otobüs var,
   * durak ekranıyla aynı liste. Yolda 20 dk'dan uzun duran (servis dışı) otobüs yok; hat
   * başında kalkışını bekleyen var.
   * @returns {Record<string, {kapiNo:string, enlem:number, boylam:number, an:number,
   *   yon:number|null, duruyorSn:number|null}[]>}
   */
  rotaAraclari(rotaIdler, simdiMs = Date.now()) {
    const T = this.tarife;
    const sonuc = {};
    for (const v of this.araclar) {
      const id = T.rotaAd?.[v.rota];
      if (id == null || !rotaIdler.has(String(id))) continue;
      let duruyor = duruyorMu(v, simdiMs);
      if (duruyor) {
        const yol = T.rotaDuraklari.get(v.rota);
        const yer = yol && yol.length > 1 ? this.yerBul(v, yol) : null;
        const hatBasi = yer != null && yer.yer < DURAKTA_PAYI;
        if (hatBasi) duruyor = false;
        else if (simdiMs - v.durgunBas >= SERVIS_DISI_SN * 1000) continue;
        else if (yer && this.seferYok(v.rota, yol[Math.min(Math.floor(yer.yer), yol.length - 1)].durak, simdiMs)) continue;
      }
      const h = v.hareket;
      (sonuc[id] ??= []).push({
        kapiNo: v.kapiNo,
        enlem: v.enlem,
        boylam: v.boylam,
        an: v.damga,
        // Gidiş yönü, kuzeyden saat yönünde derece (son iki konumdan).
        yon: h ? Math.round(((Math.atan2(h.dx, h.dy) * 180) / Math.PI + 360) % 360) : null,
        duruyorSn: duruyor ? Math.round((simdiMs - v.durgunBas) / 1000) : null,
      });
    }
    return sonuc;
  }

  /**
   * Teşhis: bu duraktan geçen hatların son nabızdaki bütün araçları, sayıldıysa varışı,
   * sayılmadıysa nedeni. Hattı başka sanılan ya da hiç bilinmeyen yakındaki araçlar
   * sunucuda ayrıca ekleniyor (tarama bilgisi orada).
   */
  teshis(durak, simdiMs = Date.now()) {
    const T = this.tarife;
    const hatlar = this.durakHatlari(durak);
    const sonuc = [];
    for (const v of this.araclar) {
      if (!hatlar.has(v.hat)) continue;
      const { kayit, neden } = this.aracinVarisi(v, durak, simdiMs);
      sonuc.push({
        kapiNo: v.kapiNo,
        hat: v.hat,
        rota: T.rotaAd?.[v.rota] ?? null,
        rotaNasil: v.rotaNasil ?? null,
        yonVar: !!v.hareket,
        // İETT'nin en yakın durağı (hat taramasından) ve kaç dakika önceki konum için.
        iettYakinDurak: v.capa ? (T.durakAd?.[v.capa.durak] ?? null) : null,
        capaDkOnce: v.capa ? Math.round((simdiMs - v.capa.an) / 6000) / 10 : null,
        konumYasSn: Math.round((simdiMs - v.damga) / 1000),
        ...(kayit
          ? { varisDk: Math.round((kayit.varis - simdiMs) / 6000) / 10, kalanDurak: kayit.kalanDurak, duruyorSn: kayit.duruyorSn }
          : { neden }),
      });
    }
    for (const [kapiNo, a] of this.atlanan) {
      if (hatlar.has(a.hat)) sonuc.push({ kapiNo, hat: a.hat, neden: a.neden });
    }
    return { hatlar: [...hatlar], araclar: sonuc };
  }

  /** Duraktan geçen hatların kısa adları (büyük harf). */
  durakHatlari(durak) {
    const T = this.tarife;
    if (!this.rotaHat) {
      this.rotaHat = new Map();
      for (const [hat, rotalar] of T.kisaAdtanRotalar) for (const r of rotalar) this.rotaHat.set(r, hat);
    }
    const hatlar = new Set();
    if (T.durakBas && T.sSefer && T.seferRota) {
      for (let i = T.durakBas[durak]; i < T.durakBas[durak + 1]; i++) {
        const h = this.rotaHat.get(T.seferRota[T.sSefer[i]]);
        if (h) hatlar.add(h);
      }
    } else {
      for (const [rota, liste] of T.rotaDuraklari) {
        if (liste.some((d) => d.durak === durak) && this.rotaHat.has(rota)) hatlar.add(this.rotaHat.get(rota));
      }
    }
    return hatlar;
  }

  /**
   * Yolun `yer`den `hedef` durağa kalan kısmı: öğrenilen süreli aralıkların toplamı (O),
   * tarife aralıklarının toplamı (P), sn; içinde bulunulan aralığın yalnız kalanı.
   */
  kalanYol(yol, yer, hedef, anSn, canliAn = null, kendiHiz = null, yalnizTarife = false) {
    const tam = Math.floor(yer);
    let O = 0;
    let P = 0;
    // Canlı (son yarım saatte gözlenen) süreler: çarpansız eklenir, zaten gerçek.
    let C = 0;
    let aralik = 0;
    let ogrenilen = 0;
    let canliAralik = 0;
    for (let j = tam; j < hedef; j++) {
      const p = yol[j];
      const q = yol[j + 1];
      const kesir = j === tam ? 1 - (yer - tam) : 1;
      const plan = Math.max(0, q.saniye - p.saniye);
      if (yalnizTarife) {
        // Planlanan süre; durağı olmayan uzun aralıkta ölçülen (uzunAralikSuresi).
        const olculen = this.uzunAralikSuresi(p.durak, q.durak, canliAn, anSn + P);
        P += kesir * (olculen ?? plan);
        if (olculen != null) ogrenilen++;
        aralik++;
        continue;
      }
      const ogr = this.ogrenilenSure(p.durak, q.durak, anSn + O + P + C);
      const canli = canliAn != null ? this.canliSure(p.durak, q.durak, canliAn) : null;
      // İçinde bulunulan aralık: otobüs ortalamadan çok yavaş ilerliyorsa kendi hızıyla
      // (en çok 20 dk). Bu kısım gerçek gözleme dayandığı için çarpansız (C).
      const temel = canli && canli.n >= CANLI_EN_AZ ? canli.sn : canli ? (canli.sn + (ogr ?? plan)) / 2 : ogr ?? plan;
      // Durağa 2 aralıktan az kalmışsa uygulanmaz: son yaklaşmada (önceki durakta yolcu
      // alırken) yavaşlayan otobüs ölçümde fazla geç gösteriliyordu.
      if (j === tam && kendiHiz != null && kendiHiz > 0 && hedef - tam >= 2) {
        // Hiç ilerlemiyorsa (durakta yolcu alıyor, ışık) kendi hızı bir şey söylemez;
        // uzun duruş zaten "duruyor" sayılıyor. Tek otobüsün hızı yanıltabileceği için
        // ortalama süreyle yarı yarıya.
        const kendi = kesir / kendiHiz;
        if (kendi > kesir * temel * 1.3) {
          C += Math.min((kendi + kesir * temel) / 2, 20 * 60);
          canliAralik++;
          aralik++;
          continue;
        }
      }
      if (canli && canli.n >= CANLI_EN_AZ) {
        C += kesir * canli.sn;
        canliAralik++;
      } else if (canli) {
        // Tek ölçüm: tek otobüsün şansına (ışık, yolcu) kalmasın, temel süreyle yarı yarıya.
        C += kesir * (canli.sn + (ogr ?? plan)) / 2;
        canliAralik++;
      } else if (ogr != null) {
        O += kesir * ogr;
        ogrenilen++;
      } else {
        P += kesir * plan;
      }
      aralik++;
    }
    return { O, P, C, aralik, ogrenilen: ogrenilen + canliAralik, canliAralik };
  }

  /** İki durak arası düz çizgi UZUN_ARALIK_M'den uzun mu (durağı olmayan uzun aralık)? */
  uzunMu(a, b) {
    const anahtar = `${a}>${b}`;
    let u = this.uzunMuOnbellek.get(anahtar);
    if (u == null) {
      const T = this.tarife;
      const olcek = Math.cos((T.durakEnlem[a] * Math.PI) / 180);
      const m = Math.hypot(T.durakEnlem[b] - T.durakEnlem[a], (T.durakBoylam[b] - T.durakBoylam[a]) * olcek) * M_DERECE;
      u = m > UZUN_ARALIK_M;
      this.uzunMuOnbellek.set(anahtar, u);
    }
    return u;
  }

  uzunAnahtari(a, b, anSn) {
    const ad = this.tarife.durakAd;
    return `${ad?.[a] ?? a}>${ad?.[b] ?? b}|${dilimAnahtari(anSn)}`;
  }

  /** Uzun aralığın bir geçiş ölçümü (gerçek dışı olanlar atılır). */
  uzunEkle(a, b, sn, an, planSn) {
    if (!this.uzunMu(a, b) || !(sn >= 30) || sn > Math.max(30 * 60, 3 * planSn)) return;
    const anahtar = this.uzunAnahtari(a, b, Math.floor(an / 1000));
    const liste = (this.uzunOlcum.get(anahtar) ?? []).filter((x) => an - x.an <= UZUN_OLCUM_OMRU_MS);
    liste.push({ an, sn: Math.round(sn) });
    this.uzunOlcum.set(anahtar, liste.slice(-UZUN_OLCUM_EN_COK));
  }

  /**
   * Uzun aralığın süresi (sn): son yarım saatin ölçümü, yoksa saat diliminin ortancası;
   * uzun aralık değilse ya da yeterli ölçüm yoksa null (plan kullanılır).
   */
  uzunAralikSuresi(a, b, simdiMs, anSn) {
    if (!this.uzunMu(a, b)) return null;
    if (simdiMs != null) {
      const c = this.canliSure(a, b, simdiMs);
      if (c && c.n >= CANLI_EN_AZ) return c.sn;
    }
    const l = this.uzunOlcum.get(this.uzunAnahtari(a, b, anSn));
    return l && l.length >= UZUN_OLCUM_EN_AZ ? ortanca(l.map((x) => x.sn)) : null;
  }

  /** Bir durak çiftinin canlı geçiş süresi ölçümü (gerçek dışı olanlar atılır). */
  canliEkle(a, b, sn, an, planSn) {
    if (!(sn >= 5) || sn > 20 * 60 || (planSn > 0 && sn > 5 * planSn + 300)) return;
    const anahtar = `${a}>${b}`;
    const liste = (this.canli.get(anahtar) ?? []).filter((x) => an - x.an <= CANLI_PENCERE_MS);
    liste.push({ an, sn });
    this.canli.set(anahtar, liste.slice(-12));
  }

  yerelEkle(durak, oran, an) {
    const liste = (this.yerel.get(durak) ?? []).filter((x) => an - x.an <= CANLI_PENCERE_MS);
    liste.push({ an, oran });
    this.yerel.set(durak, liste.slice(-20));
  }

  /** Bir durağa varışlarda son yarım saatin gerçek/tahmin oranı (ortanca, sınırlı); azsa 1. */
  yerelOran(durak, simdi) {
    const l = (this.yerel.get(durak) ?? []).filter((x) => simdi - x.an <= CANLI_PENCERE_MS);
    if (l.length < YEREL_EN_AZ) return 1;
    const s = l.map((x) => x.oran).sort((x, y) => x - y);
    const orta = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return Math.min(YEREL_ORAN_SINIR[1], Math.max(YEREL_ORAN_SINIR[0], orta));
  }

  /** Son yarım saatin ortanca geçiş süresi ve ölçüm sayısı; yoksa null. */
  canliSure(a, b, simdi) {
    const liste = (this.canli.get(`${a}>${b}`) ?? []).filter((x) => simdi - x.an <= CANLI_PENCERE_MS);
    if (!liste.length) return null;
    const s = liste.map((x) => x.sn).sort((x, y) => x - y);
    const orta = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return { sn: orta, n: liste.length };
  }

  /** Gerçeğe uyan çarpanlar (a: öğrenilen süreler, b: tarife), 1'e çekilmiş, 0,4–2,5 arası. */
  carpanlar() {
    const s = this.olcum;
    if (s.n < 1) return { a: 1, b: 1 };
    const l = (CEKIM * (s.OO + s.PP)) / Math.max(s.n, 1);
    const A11 = s.OO + l;
    const A12 = s.OP;
    const A22 = s.PP + l;
    const B1 = s.OA + l;
    const B2 = s.PA + l;
    const det = A11 * A22 - A12 * A12;
    if (!(det > 0)) return { a: 1, b: 1 };
    const sinirla = (x) => Math.min(2.5, Math.max(0.4, x));
    return { a: sinirla((B1 * A22 - A12 * B2) / det), b: sinirla((A11 * B2 - A12 * B1) / det) };
  }

  /** Ölçüm izi: aracın yol üstündeki yeri ilerledikçe bıraktığı tahminleri gerçekle karşılaştır. */
  olc(v) {
    const T = this.tarife;
    const anSn = Math.floor(v.damga / 1000);
    let k = this.izleme.get(v.kapiNo);
    if (!k || k.rota !== v.rota) {
      const liste = T.rotaDuraklari.get(v.rota) ?? [];
      const yol =
        (liste.length && this.yolBul(v.rota, liste[liste.length - 1].durak, anSn)) ||
        (liste.length && this.yolBul(v.rota, liste[0].durak, anSn)) ||
        null;
      if (!yol || yol.length < 2) {
        this.izleme.delete(v.kapiNo);
        return;
      }
      k = { rota: v.rota, yol, yer: null, damga: v.damga, hedefler: [] };
      this.izleme.set(v.kapiNo, k);
    }
    const yer = this.yerBul(v, k.yol);
    if (!yer) {
      this.izleme.delete(v.kapiNo);
      return;
    }
    // Geri gittiyse (yeni tur) ya da uzun boşluk: baştan.
    if (k.yer != null && (yer.yer < k.yer - 0.5 || v.damga - k.damga > 10 * 60_000)) {
      k.hedefler = [];
      k.sonGecis = null;
    }
    if (k.yer != null && yer.yer > k.yer && v.damga > k.damga && v.damga - k.damga <= 6 * 60_000) {
      // Geçilen her durağın anı (iki konum arasında ara değer); ardışık iki durağın arası
      // canlı süre ölçümü.
      for (let j = Math.floor(k.yer) + 1; j <= Math.floor(yer.yer); j++) {
        const t = k.damga + ((j - k.yer) / (yer.yer - k.yer)) * (v.damga - k.damga);
        if (k.sonGecis?.idx === j - 1) {
          const p = k.yol[j - 1];
          const q = k.yol[j];
          this.canliEkle(p.durak, q.durak, (t - k.sonGecis.t) / 1000, t, Math.max(0, q.saniye - p.saniye));
          this.uzunEkle(p.durak, q.durak, (t - k.sonGecis.t) / 1000, t, Math.max(0, q.saniye - p.saniye));
        }
        k.sonGecis = { idx: j, t };
      }
    }
    if (k.yer != null && yer.yer > k.yer && v.damga > k.damga) {
      for (const h of k.hedefler) {
        if (yer.yer < h.idx) continue;
        const gecis = k.damga + ((h.idx - k.yer) / (yer.yer - k.yer)) * (v.damga - k.damga);
        this.kaydet(h, (gecis - h.baslangic) / 1000, gecis);
        h.bitti = true;
      }
      k.hedefler = k.hedefler.filter((h) => !h.bitti && v.damga - h.baslangic < 90 * 60_000);
    }
    // Yeni tahminler: hat başında beklerken değil (bekleme yol süresi değil).
    if (yer.yer >= DURAKTA_PAYI) {
      const tam = Math.floor(yer.yer);
      for (const ufuk of UFUKLAR) {
        const idx = tam + ufuk;
        if (idx >= k.yol.length || k.hedefler.some((h) => h.ufuk === ufuk)) continue;
        const { O, P } = this.kalanYol(k.yol, yer.yer, idx, anSn);
        if (O + P <= 0) continue;
        k.hedefler.push({ ufuk, idx, durak: k.yol[idx].durak, baslangic: v.damga, O, P });
      }
    }
    k.yer = yer.yer;
    k.damga = v.damga;
    // Son dakikaların ilerleyişi (aynı konum tekrar gelirse eklenmez).
    const g = (k.gecmis ?? []).filter((x) => v.damga - x.t <= KENDI_HIZ_PENCERE_MS && x.yer <= yer.yer + 0.05);
    if (!g.length || g[g.length - 1].t !== v.damga) g.push({ t: v.damga, yer: yer.yer });
    k.gecmis = g;
  }

  /** Aracın son dakikalardaki ilerleyişi: durak aralığı / sn; yeterli geçmiş yoksa null. */
  kendiHizi(kapiNo) {
    const g = this.izleme.get(kapiNo)?.gecmis;
    if (!g || g.length < 2) return null;
    const ilk = g[0];
    const son = g[g.length - 1];
    if (son.t - ilk.t < KENDI_HIZ_EN_AZ_MS) return null;
    return Math.max(0, son.yer - ilk.yer) / ((son.t - ilk.t) / 1000);
  }

  /** Bir tahminin gerçekleşen süresi: regresyon toplamları ve ufuk hataları. */
  kaydet(h, gercek, an = Date.now()) {
    if (!(gercek > 0) || gercek > 3 * 3600) return;
    const s = this.olcum;
    const { a, b } = this.carpanlar();
    const tahmin = a * h.O + b * h.P;
    if (h.durak != null && tahmin >= 60) this.yerelEkle(h.durak, gercek / tahmin, an);
    for (const anahtar of ['OO', 'OP', 'PP', 'OA', 'PA', 'n']) s[anahtar] *= UNUTMA;
    s.OO += h.O * h.O;
    s.OP += h.O * h.P;
    s.PP += h.P * h.P;
    s.OA += h.O * gercek;
    s.PA += h.P * gercek;
    s.n += 1;
    const e = (s.hata[h.ufuk] ??= { n: 0, ham: 0, hamMutlak: 0, duz: 0, duzMutlak: 0 });
    for (const anahtar of ['n', 'ham', 'hamMutlak', 'duz', 'duzMutlak']) e[anahtar] *= UNUTMA;
    const ham = gercek - (h.O + h.P);
    const duz = gercek - (a * h.O + b * h.P);
    e.n += 1;
    e.ham += ham;
    e.hamMutlak += Math.abs(ham);
    e.duz += duz;
    e.duzMutlak += Math.abs(duz);
  }

  /** /durum için: ölçüm sayısı, çarpanlar, ufuk ufuk ortalama hata (sn; artı = geç geldi). */
  ozet() {
    const { a, b } = this.carpanlar();
    const hata = {};
    for (const [ufuk, e] of Object.entries(this.olcum.hata)) {
      const n = Math.max(e.n, 1e-9);
      hata[`${ufuk} durak`] = {
        olcum: Math.round(e.n),
        hamOrtalamaSn: Math.round(e.ham / n),
        hamMutlakSn: Math.round(e.hamMutlak / n),
        duzeltilmisOrtalamaSn: Math.round(e.duz / n),
        duzeltilmisMutlakSn: Math.round(e.duzMutlak / n),
      };
    }
    return {
      // Durak ekranındaki varışın süre kaynağı (VARIS_YONTEMI): tarife | ogrenilen.
      yontem: this.yontem,
      olcum: Math.round(this.olcum.n),
      carpan: { ogrenilen: Math.round(a * 100) / 100, tarife: Math.round(b * 100) / 100 },
      izlenenArac: this.izleme.size,
      canliDurakCifti: this.canli.size,
      // Durağı olmayan uzun aralıklar: hangi aralık × saat dilimi kaç kez ölçüldü, ortancası.
      uzunAralik: Object.fromEntries(
        [...this.uzunOlcum]
          .slice(0, 20)
          .map(([k, l]) => [k, { olcum: l.length, ortancaDk: Math.round(ortanca(l.map((x) => x.sn)) / 6) / 10 }]),
      ),
      // İETT'nin en yakın durağı: kaç otobüs bu nabızda ona dayandı; taramalarda bizim
      // yerleştirmemiz onunla uyuştu mu (en çok bir durak fark), son uyuşmayanlar.
      capa: {
        kullanan: this.araclar.filter((v) => v.capa).length,
        uyumlu: this.capaOlcum.uyumlu,
        uyumsuz: this.capaOlcum.uyumsuz,
        sonUyumsuzlar: this.capaOlcum.ornekler,
      },
      hata,
    };
  }

  /**
   * Diske: ölçüm ve araç hafızası (yön, gidiş vektörü, kımıldamama, önceki konum). Hafıza
   * olmadan köprü her açılışta otobüslerin yönünü sıfırdan öğreniyor, ilk 10–20 dakika
   * duraktaki otobüslerin yarısı "yönü belirlenemedi" diye görünmüyordu. Rota GTFS
   * route_id'siyle yazılır (tarife değişince sıra kayabilir).
   */
  disaAktar() {
    const T = this.tarife;
    const yon = {};
    for (const [k, y] of this.yon) {
      const id = T.rotaAd?.[y.rota];
      if (id != null) yon[k] = { rota: id, an: y.an };
    }
    return {
      surum: 1,
      olcum: this.olcum,
      hafiza: {
        canli: Object.fromEntries(this.canli),
        yerel: Object.fromEntries(this.yerel),
        yon,
        hareket: Object.fromEntries(this.hareket),
        durgunluk: Object.fromEntries(this.durgunluk),
        iz: Object.fromEntries(this.iz.kayit),
        uzun: Object.fromEntries(this.uzunOlcum),
      },
    };
  }

  yukle(veri, simdi = Date.now()) {
    if (veri?.surum === 1 && veri.olcum) this.olcum = { ...this.olcum, ...veri.olcum, hata: veri.olcum.hata ?? {} };
    const h = veri?.hafiza;
    if (!h) return;
    const rotaNo = new Map((this.tarife.rotaAd ?? []).map((id, i) => [id, i]));
    for (const [k, y] of Object.entries(h.yon ?? {})) {
      const rota = rotaNo.get(y?.rota);
      if (rota != null && simdi - y.an <= YON_OMRU_MS) this.yon.set(k, { rota, an: y.an });
    }
    for (const [k, x] of Object.entries(h.hareket ?? {})) if (x && simdi - x.an <= HAREKET_OMRU_MS) this.hareket.set(k, x);
    for (const [k, x] of Object.entries(h.durgunluk ?? {})) if (x && simdi - x.son <= 10 * 60_000) this.durgunluk.set(k, x);
    for (const [k, x] of Object.entries(h.iz ?? {})) if (x && simdi - x.an <= 8 * 60_000) this.iz.kayit.set(k, x);
    for (const [k, l] of Object.entries(h.yerel ?? {})) {
      const taze = (Array.isArray(l) ? l : []).filter((x) => simdi - x.an <= CANLI_PENCERE_MS);
      if (taze.length) this.yerel.set(Number(k), taze);
    }
    for (const [k, l] of Object.entries(h.uzun ?? {})) {
      const taze = (Array.isArray(l) ? l : []).filter((x) => simdi - x.an <= UZUN_OLCUM_OMRU_MS);
      if (taze.length) this.uzunOlcum.set(k, taze);
    }
    for (const [k, l] of Object.entries(h.canli ?? {})) {
      const taze = (Array.isArray(l) ? l : []).filter((x) => simdi - x.an <= CANLI_PENCERE_MS);
      if (taze.length) this.canli.set(k, taze);
    }
  }
}

/**
 * Bir durak saatinin (tarifenin `sSaniye`'si, hizmet gününün başından; gece yarısını aşan
 * seferde 86400'den büyük) dün, bugün ve yarının o gün çalışan servislerine göre mutlak
 * anları (unix sn). Eskiden servis (hafta içi / cumartesi / pazar) hiç sorulmuyordu:
 * çarşamba gecesi 00:36'da Harbiye'de bekleyen 89C'ye cumartesi servisinin 00:35 kalkışı
 * verildi, "01:30'da durakta" diye olmayan bir sefer göründü (2026-10-08; hafta içi
 * bir sonraki kalkış 00:51). Tarifede servis bilgisi yoksa (testler) her gün sayılır.
 */
export function tarifeAnlari(tarife, sefer, sn, anSn, gunler = gunlerOnbellekli(tarife, anSn)) {
  const gunSn = (((anSn + 3 * 3600) % 86400) + 86400) % 86400;
  const gunBasi = anSn - gunSn;
  if (!gunler) return [gunBasi + sn - 86400, gunBasi + sn, gunBasi + sn + 86400];
  const servis = tarife.seferServis?.[sefer] ?? -1;
  const sonuc = [];
  for (const g of gunler) if (servis >= 0 && g.aktif[servis]) sonuc.push(gunBasi - g.ek + sn);
  return sonuc;
}

const gunOnbellegi = new WeakMap();
/** hizmetGunleri, İstanbul tarihine göre (makinenin saat diliminden bağımsız), gün başına bir kez. */
function gunlerOnbellekli(tarife, anSn) {
  if (!tarife.servisler?.length || !tarife.seferServis) return null;
  const d = new Date((anSn + 3 * 3600) * 1000);
  const anahtar = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  const k = gunOnbellegi.get(tarife);
  if (k?.anahtar === anahtar) return k.gunler;
  const gunler = hizmetGunleri(tarife, new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  gunOnbellegi.set(tarife, { anahtar, gunler });
  return gunler;
}

/**
 * Bir duraktan rotanın şu andan sonraki ilk tarife kalkışı, unix sn (o gün çalışan
 * servislerden). Bir dakika önce "kalkmış" görünen de sayılır (tarife payı).
 */
export function tarifedenKalkisBul(tarife) {
  return (rota, durak, anSn) => {
    let enIyi = null;
    for (let i = tarife.durakBas[durak]; i < tarife.durakBas[durak + 1]; i++) {
      const sefer = tarife.sSefer[i];
      if (tarife.seferRota[sefer] !== rota) continue;
      for (const aday of tarifeAnlari(tarife, sefer, tarife.sSaniye[i], anSn)) {
        if (aday >= anSn - 60 && (enIyi == null || aday < enIyi)) enIyi = aday;
      }
    }
    return enIyi;
  };
}

/**
 * Gerçek tarifeden yol: rotanın o duraktan geçen seferlerinden (o gün çalışan servislerden)
 * tarife saati şimdiye en yakın olanın durakları ve saatleri.
 */
export function tarifedenYolBul(tarife, seferDuraklari) {
  return (rota, durak, anSn) => {
    let enIyi = -1;
    let enAz = Infinity;
    for (let i = tarife.durakBas[durak]; i < tarife.durakBas[durak + 1]; i++) {
      const sefer = tarife.sSefer[i];
      if (tarife.seferRota[sefer] !== rota) continue;
      for (const aday of tarifeAnlari(tarife, sefer, tarife.sSaniye[i], anSn)) {
        const fark = Math.abs(aday - anSn);
        if (fark < enAz) {
          enAz = fark;
          enIyi = sefer;
        }
      }
    }
    return enIyi < 0 ? null : seferDuraklari(tarife, enIyi).map((d) => ({ durak: d.durak, saniye: d.saniye }));
  };
}
