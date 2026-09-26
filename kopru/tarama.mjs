// Hangi aracın hangi hatta çalıştığını yavaş yavaş öğrenir ve unutmaz.
//
// Canlı filo servisi tek çağrıyla bütün araçların konumunu veriyor ama hat bilgisi
// vermiyor. Hat bilgisi yalnızca hat hat sorulan servisten geliyor ve İBB'nin
// kotası saatte 100 istek. Bütçenin çoğu filo konumuna gidince hat taramasına
// saatte ~48 istek kalıyor: 784 hattın bir turu ~16 saat.
//
// Bunu mümkün kılan gözlem: bir İETT otobüsü gün boyu, çoğu zaman günlerce aynı
// hatta çalışıyor. O yüzden öğrenilen "araç → hat" bilgisi diske yazılıyor ve bir
// hafta tutuluyor; köprü her açılışta sıfırdan başlamıyor, kapsama günden güne
// büyüyor. Yön ise saklanmıyor (her seferde değişiyor), aracın hareketinden
// çıkarılıyor (yon.mjs). Taramanın verdiği güzergâh kodu yalnızca tazeyken
// kullanılıyor.
//
// Sıra: en çok "gecikmiş" hat önce. Puan = geçen süre × (araç sayısı + 1). Hiç
// sorulmamış hatların araç sayısı tarifedeki günlük sefer sayısından tahmin
// ediliyor; ilk tur boş mahalle hatlarıyla değil, 34G ve 500T gibi yoğun hatlarla
// başlıyor.
//
// Gece (İstanbul saatiyle 01:00–05:00) tarama duruyor. O saatte hatların çoğunda araç
// yok; sorulan hat "0 araç" diye kaydediliyor, puanı dibe vuruyor ve gündüz 20 aracı
// olan hat bir sonraki turda en sona kalıyordu. Tek bir düşük sayım da puanı bir anda
// silmesin diye araç sayısı yumuşatılıyor: yeni = max(gözlenen, eski × 0,6).

import { ArizaHatasi, hattakiAraclar, SinirHatasi } from './iett.mjs';

// İlgi: uygulama baktığın durakların, yakınındaki durakların ve yolculuğundaki
// otobüslerin hatlarını bildiriyor (POST /ilgi). Bu hatlar sıranın önüne geçiyor:
// durak ekranını açtığında o hatlardaki otobüsler birkaç dakika içinde tanınır ve canlı
// görünür. Favori durakların hatları kalıcı ilgi: puanları KALICI_CARPAN kat.
/** Anlık ilginin geçerli olduğu süre. */
export const ILGI_OMRU_MS = 45 * 60_000;
/** Bundan kısa süre önce sorulmuş hat, ilgi olsa da yeniden sorulmaz. */
export const ILGI_TAZELIK_MS = 10 * 60_000;
/** Kalıcı ilgi (favori) bu kadar süre yenilenmezse düşer. */
export const KALICI_OMRU_MS = 30 * 24 * 3_600_000;
export const KALICI_CARPAN = 5;

/** Bu kadar süre taramada görülmeyen aracın hat bilgisi unutulur. */
export const HAT_OMRU_MS = 7 * 24 * 3_600_000;

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** İstanbul saati (0–23). İstanbul yaz saati uygulamıyor: her zaman UTC+3. */
export function istanbulSaati(an = Date.now()) {
  return new Date(an + 3 * 3_600_000).getUTCHours();
}

/** Taramanın durduğu saatler: araçların çoğu garajda, sayım yanıltıcı. */
export function geceMi(an = Date.now()) {
  const s = istanbulSaati(an);
  return s >= 1 && s < 5;
}

/** Bir hat sorgusunun ardından araç sayısının yeni değeri. */
export function aracSayisiGuncelle(eski, gozlenen) {
  return Math.max(gozlenen, Math.round((eski ?? 0) * 0.6));
}

export class Tarayici {
  /**
   * @param {object} kapi bütçeli istek kapısı
   * @param {object} p
   * @param {number} p.aralikMs iki hat sorgusu arası (bütçeden hesaplanır)
   * @param {Map<string, number>} p.tahminiYogunluk hat → tahmini araç sayısı
   */
  constructor(kapi, { aralikMs = 75_000, tahminiYogunluk = new Map() } = {}) {
    this.kapi = kapi;
    this.aralikMs = aralikMs;
    this.tahmin = tahminiYogunluk;
    /** kapı no → { hat, guzergah, an } */
    this.atama = new Map();
    /** hat kodu → { sonBakilan, aracSayisi, soruldu } */
    this.hatDurumu = new Map();
    this.hatlar = [];
    /** hat → son ilgi anı (ms): uygulamanın o an baktığı hatlar */
    this.ilgi = new Map();
    /** hat → son bildirim anı (ms): favori durakların hatları */
    this.kalici = new Map();
    this.calisiyor = false;
    this.sayac = { hatSoruldu: 0, sinir: 0, hata: 0 };
  }

  hatlariAyarla(hatlar) {
    this.hatlar = hatlar;
    for (const h of hatlar) {
      if (!this.hatDurumu.has(h)) {
        this.hatDurumu.set(h, { sonBakilan: 0, aracSayisi: this.tahmin.get(h.toUpperCase()) ?? 0, soruldu: false });
      }
    }
  }

  /**
   * Uygulamanın bildirdiği hatlar. İETT listesinde olmayanlar (metro, minibüs) yok
   * sayılır. Kaç hattın kabul edildiğini döner.
   */
  ilgiBildir(hatlar, kalici = false, simdi = Date.now()) {
    const buyuk = new Map(this.hatlar.map((h) => [String(h).toLocaleUpperCase('tr-TR'), h]));
    let kabul = 0;
    for (const ham of Array.isArray(hatlar) ? hatlar.slice(0, 60) : []) {
      const hat = buyuk.get(String(ham ?? '').trim().toLocaleUpperCase('tr-TR'));
      if (!hat) continue;
      this.ilgi.set(hat, simdi);
      if (kalici) this.kalici.set(hat, simdi);
      kabul++;
    }
    return kabul;
  }

  /** Diskten okunan öğrenilmişleri geri yükler. */
  yukle({ atama = {}, hatDurumu = {}, kalici = {} } = {}, simdi = Date.now()) {
    for (const [hat, an] of Object.entries(kalici)) {
      if (Number.isFinite(an) && simdi - an <= KALICI_OMRU_MS) this.kalici.set(hat, an);
    }
    for (const [kapi, k] of Object.entries(atama)) {
      if (k?.hat && simdi - k.an <= HAT_OMRU_MS) this.atama.set(kapi, k);
    }
    for (const [hat, d] of Object.entries(hatDurumu)) {
      if (!d || !Number.isFinite(d.sonBakilan)) continue;
      // Eski sürüm gece de tarıyordu: o saatte sayılan hatların sayısı tarifeden onarılır.
      const tahmin = this.tahmin.get(hat.toUpperCase()) ?? 0;
      const aracSayisi = geceMi(d.sonBakilan) ? Math.max(d.aracSayisi ?? 0, tahmin) : d.aracSayisi;
      this.hatDurumu.set(hat, { ...d, aracSayisi, soruldu: true });
    }
  }

  /** Diske yazılacak özet. */
  disaAktar() {
    return {
      kalici: Object.fromEntries(this.kalici),
      atama: Object.fromEntries(this.atama),
      hatDurumu: Object.fromEntries(
        [...this.hatDurumu].filter(([, d]) => d.soruldu).map(([h, d]) => [h, { sonBakilan: d.sonBakilan, aracSayisi: d.aracSayisi }]),
      ),
    };
  }

  sıradakiHat(simdi = Date.now(), yalnizIlgi = false) {
    // 1) Anlık ilgi: yakın zamanda sorulmamış olanlardan en uzun süredir sorulmayan.
    let ilgili = null;
    for (const [hat, an] of this.ilgi) {
      if (simdi - an > ILGI_OMRU_MS) {
        this.ilgi.delete(hat);
        continue;
      }
      const d = this.hatDurumu.get(hat);
      if (!d || simdi - d.sonBakilan < ILGI_TAZELIK_MS) continue;
      if (!ilgili || d.sonBakilan < this.hatDurumu.get(ilgili).sonBakilan) ilgili = hat;
    }
    if (ilgili || yalnizIlgi) return ilgili;

    // 2) Genel sıra; favori durakların hatları daha sık.
    let enIyi = null;
    let enYuksek = -1;
    for (const hat of this.hatlar) {
      const d = this.hatDurumu.get(hat);
      const kaliciMi = simdi - (this.kalici.get(hat) ?? -Infinity) <= KALICI_OMRU_MS;
      const puan = (simdi - d.sonBakilan) * (d.aracSayisi + 1) * (kaliciMi ? KALICI_CARPAN : 1);
      if (puan > enYuksek) {
        enYuksek = puan;
        enIyi = hat;
      }
    }
    return enIyi;
  }

  /** Bir hat sorgusunun sonucunu işler (testlerden de çağrılıyor). */
  isle(hat, araclar, an = Date.now()) {
    const durum = this.hatDurumu.get(hat) ?? { sonBakilan: 0, aracSayisi: 0 };
    durum.sonBakilan = an;
    durum.aracSayisi = aracSayisiGuncelle(durum.aracSayisi, araclar.length);
    durum.soruldu = true;
    this.hatDurumu.set(hat, durum);
    for (const a of araclar) {
      if (a.kapiNo) this.atama.set(a.kapiNo, { hat: a.hat || hat, guzergah: a.guzergah || null, an });
    }
  }

  /** Arka plan döngüsü. Bütçe ve ceza beklemesini kapı uyguluyor. */
  async basla() {
    if (this.calisiyor || !Number.isFinite(this.aralikMs)) return;
    this.calisiyor = true;
    while (this.calisiyor) {
      // Gece genel tarama durur; yalnız uygulamanın o an baktığı hatlar sorulur.
      const gece = geceMi();
      this.gecede = gece;
      const hat = this.sıradakiHat(Date.now(), gece);
      if (!hat) {
        await bekle(gece ? 60_000 : 5000);
        continue;
      }
      try {
        const araclar = await hattakiAraclar(this.kapi, hat);
        this.sayac.hatSoruldu++;
        this.isle(hat, araclar);
      } catch (e) {
        if (e instanceof ArizaHatasi) {
          // İBB yanıt vermiyor: hat sorulmuş sayılmasın, arıza beklemesi bitince aynı hatla devam.
          this.sayac.ariza = (this.sayac.ariza ?? 0) + 1;
          await bekle(Math.max(5000, Math.min(this.kapi.kalanAriza?.() ?? 0, 60_000)));
          continue;
        }
        // Hata da olsa bu hattı bir süre sorma: aynı hatta takılı kalmayalım.
        const d = this.hatDurumu.get(hat);
        if (d) d.sonBakilan = Date.now();
        if (e instanceof SinirHatasi) this.sayac.sinir++;
        else this.sayac.hata++;
      }
      this.unut();
      await bekle(this.aralikMs);
    }
  }

  dur() {
    this.calisiyor = false;
  }

  unut(simdi = Date.now()) {
    for (const [kapiNo, k] of this.atama) {
      if (simdi - k.an > HAT_OMRU_MS) this.atama.delete(kapiNo);
    }
  }

  /** Bir aracın bilinen hattı ve (varsa) son görülen güzergâhı; bilinmiyorsa null. */
  bilgi(kapiNo) {
    return this.atama.get(kapiNo) ?? null;
  }

  ozet(simdi = Date.now()) {
    // Yalnız güncel listedeki hatlar: diskte İETT'nin kaldırdığı bir hat kalmışsa
    // "784/783" gibi toplamı aşan bir sayı çıkıyordu.
    const sorulanHat = this.hatlar.filter((h) => this.hatDurumu.get(h)?.soruldu).length;
    return {
      bilinenArac: this.atama.size,
      sorulanHat,
      toplamHat: this.hatlar.length,
      buOturumdaSorulan: this.sayac.hatSoruldu,
      sinir: this.sayac.sinir,
      hata: this.sayac.hata,
      taramaAraligiSn: Number.isFinite(this.aralikMs) ? Math.round(this.aralikMs / 1000) : null,
      geceBekliyor: !!this.gecede,
      ilgiliHat: [...this.ilgi.values()].filter((an) => simdi - an <= ILGI_OMRU_MS).length,
      kaliciHat: this.kalici.size,
    };
  }
}

/**
 * Hat başına tahmini yoğunluk: tarifedeki sefer sayısı / 10. Yalnız ilk turun
 * sırasını belirliyor; hat bir kez sorulunca gerçek araç sayısı geçerli oluyor.
 */
export function yogunlukTahmini(tarife) {
  const rotaHat = new Map();
  for (const [hat, rotalar] of tarife.kisaAdtanRotalar) for (const r of rotalar) rotaHat.set(r, hat);
  const sayi = new Map();
  for (let s = 0; s < tarife.seferRota.length; s++) {
    const hat = rotaHat.get(tarife.seferRota[s]);
    if (hat) sayi.set(hat, (sayi.get(hat) ?? 0) + 1);
  }
  for (const [hat, n] of sayi) sayi.set(hat, n / 10);
  return sayi;
}
