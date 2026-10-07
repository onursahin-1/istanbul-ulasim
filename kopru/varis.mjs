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

/** Noktanın a→b doğru parçasına izdüşümü: oran (0–1) ve uzaklık (metre). */
function izdusum(tarife, a, b, enlem, boylam) {
  const olcek = Math.cos((enlem * Math.PI) / 180);
  const ax = (tarife.durakBoylam[a] - boylam) * olcek;
  const ay = tarife.durakEnlem[a] - enlem;
  const dx = (tarife.durakBoylam[b] - boylam) * olcek - ax;
  const dy = tarife.durakEnlem[b] - enlem - ay;
  const uz = dx * dx + dy * dy;
  const t = uz > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / uz)) : 0;
  return { t, metre: Math.hypot(ax + t * dx, ay + t * dy) * M_DERECE };
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
 * Aracın yol (durak listesi) üstündeki kesirli yeri: 3.4 = dördüncü durağı geçmiş, beşinciye
 * %40 gelmiş. Yola `esik` metreden uzaksa null.
 *
 * `hareket` (aracın son gidiş yönü, {dx, dy} derece; boylam farkı enleme göre ölçekli)
 * verilirse yolun aracın gittiği yöndeki parçaları önce gelir. Halka hatlarda gidiş ve
 * dönüş aynı caddenin iki yakasından geçiyor (20–40 m); yalnız en yakın parçaya bakınca
 * dönüşteki otobüs gidişe yerleşiyor, durağa 50 durak uzakta sanılıyordu (89C, 91E,
 * Göztepe Meydanı). Yönü tutan parça yoksa ya da en yakından YONLU_PAY_M'den uzaksa en
 * yakın parça.
 */
export function yoldakiYer(tarife, yol, enlem, boylam, esik, hareket = null) {
  let enIyi = null;
  let yonlu = null;
  const olcek = Math.cos((enlem * Math.PI) / 180);
  for (let i = 0; i + 1 < yol.length; i++) {
    const a = yol[i].durak;
    const b = yol[i + 1].durak;
    const p = izdusum(tarife, a, b, enlem, boylam);
    const aday = { yer: i + p.t, metre: p.metre };
    if (!enIyi || p.metre < enIyi.metre) enIyi = aday;
    if (hareket && p.metre <= esik) {
      const sx = (tarife.durakBoylam[b] - tarife.durakBoylam[a]) * olcek;
      const sy = tarife.durakEnlem[b] - tarife.durakEnlem[a];
      if (sx * hareket.dx + sy * hareket.dy > 0 && (!yonlu || p.metre < yonlu.metre)) yonlu = aday;
    }
  }
  const sonuc = yonlu && enIyi && yonlu.metre <= enIyi.metre + YONLU_PAY_M ? yonlu : enIyi;
  return sonuc && sonuc.metre <= esik ? sonuc : null;
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
      };
      liste.push(v);
      this.olc(v);
    }
    for (const [k, iz] of this.izleme) if (an - iz.damga > 30 * 60_000) this.izleme.delete(k);
    for (const [k, y] of this.yon) if (an - y.an > 2 * YON_OMRU_MS) this.yon.delete(k);
    for (const [k, h] of this.hareket) if (an - h.an > 2 * HAREKET_OMRU_MS) this.hareket.delete(k);
    for (const [k, d] of this.durgunluk) if (an - d.son > 30 * 60_000) this.durgunluk.delete(k);
    for (const [k, l] of this.canli) if (!l.length || an - l[l.length - 1].an > CANLI_PENCERE_MS) this.canli.delete(k);
    this.iz.temizle(an);
    this.araclar = liste;
    this.an = an;
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
    const yer = yoldakiYer(T, yol, v.enlem, v.boylam, esik, v.hareket);
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
    const duruyor =
      !hatBasi &&
      v.durgunBas != null &&
      v.damga - v.durgunBas >= DURGUN_SN * 1000 &&
      simdiMs - v.damga <= DURGUN_TAZE_MS;
    if (duruyor && simdiMs - v.durgunBas >= SERVIS_DISI_SN * 1000) {
      return { neden: `${Math.round((simdiMs - v.durgunBas) / 60_000)} dk'dır duruyor (servis dışı sayıldı)` };
    }
    if (duruyor) cikis = Math.max(cikis, simdiMs / 1000);
    let parca;
    let sure;
    if (this.yontem === 'tarife') {
      // Yalnız planlanan durak arası süreler; çarpan, canlı trafik, kendi hızı yok.
      parca = this.kalanYol(yol, yer.yer, hedef, anSn, null, null, true);
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
        kalanDurak,
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
      const ogr = yalnizTarife ? null : this.ogrenilenSure(p.durak, q.durak, anSn + O + P + C);
      const plan = Math.max(0, q.saniye - p.saniye);
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
    const yer = yoldakiYer(T, k.yol, v.enlem, v.boylam, T.rotaEsik?.get(v.rota) ?? 400, v.hareket);
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
      olcum: Math.round(this.olcum.n),
      carpan: { ogrenilen: Math.round(a * 100) / 100, tarife: Math.round(b * 100) / 100 },
      izlenenArac: this.izleme.size,
      canliDurakCifti: this.canli.size,
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
    for (const [k, l] of Object.entries(h.canli ?? {})) {
      const taze = (Array.isArray(l) ? l : []).filter((x) => simdi - x.an <= CANLI_PENCERE_MS);
      if (taze.length) this.canli.set(k, taze);
    }
  }
}

/**
 * Hat başından (rotanın ilk durağı) şu andan sonraki ilk tarife kalkışı, unix sn.
 * Bir dakika önce "kalkmış" görünen de sayılır (tarife payı).
 */
export function tarifedenKalkisBul(tarife) {
  return (rota, durak, anSn) => {
    const gunSn = (((anSn + 3 * 3600) % 86400) + 86400) % 86400;
    const gunBasi = anSn - gunSn;
    let enIyi = null;
    for (let i = tarife.durakBas[durak]; i < tarife.durakBas[durak + 1]; i++) {
      if (tarife.seferRota[tarife.sSefer[i]] !== rota) continue;
      const sn = tarife.sSaniye[i];
      for (const aday of [gunBasi + sn, gunBasi + sn - 86400]) {
        if (aday >= anSn - 60 && (enIyi == null || aday < enIyi)) enIyi = aday;
      }
    }
    return enIyi;
  };
}

/**
 * Gerçek tarifeden yol: rotanın o duraktan geçen seferlerinden tarife saati şimdiye en
 * yakın olanın durakları ve saatleri.
 */
export function tarifedenYolBul(tarife, seferDuraklari) {
  return (rota, durak, anSn) => {
    const gunSn = (((anSn + 3 * 3600) % 86400) + 86400) % 86400;
    let enIyi = -1;
    let enAz = Infinity;
    for (let i = tarife.durakBas[durak]; i < tarife.durakBas[durak + 1]; i++) {
      const sefer = tarife.sSefer[i];
      if (tarife.seferRota[sefer] !== rota) continue;
      let fark = Math.abs(tarife.sSaniye[i] - gunSn);
      fark = Math.min(fark, Math.abs(fark - 86400));
      if (fark < enAz) {
        enAz = fark;
        enIyi = sefer;
      }
    }
    return enIyi < 0 ? null : seferDuraklari(tarife, enIyi).map((d) => ({ durak: d.durak, saniye: d.saniye }));
  };
}
