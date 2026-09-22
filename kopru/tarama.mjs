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

import { hattakiAraclar, SinirHatasi } from './iett.mjs';

/** Bu kadar süre taramada görülmeyen aracın hat bilgisi unutulur. */
export const HAT_OMRU_MS = 7 * 24 * 3_600_000;

const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

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

  /** Diskten okunan öğrenilmişleri geri yükler. */
  yukle({ atama = {}, hatDurumu = {} } = {}, simdi = Date.now()) {
    for (const [kapi, k] of Object.entries(atama)) {
      if (k?.hat && simdi - k.an <= HAT_OMRU_MS) this.atama.set(kapi, k);
    }
    for (const [hat, d] of Object.entries(hatDurumu)) {
      if (d && Number.isFinite(d.sonBakilan)) this.hatDurumu.set(hat, { ...d, soruldu: true });
    }
  }

  /** Diske yazılacak özet. */
  disaAktar() {
    return {
      atama: Object.fromEntries(this.atama),
      hatDurumu: Object.fromEntries(
        [...this.hatDurumu].filter(([, d]) => d.soruldu).map(([h, d]) => [h, { sonBakilan: d.sonBakilan, aracSayisi: d.aracSayisi }]),
      ),
    };
  }

  sıradakiHat(simdi = Date.now()) {
    let enIyi = null;
    let enYuksek = -1;
    for (const hat of this.hatlar) {
      const d = this.hatDurumu.get(hat);
      const puan = (simdi - d.sonBakilan) * (d.aracSayisi + 1);
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
    durum.aracSayisi = araclar.length;
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
      const hat = this.sıradakiHat();
      if (!hat) {
        await bekle(5000);
        continue;
      }
      try {
        const araclar = await hattakiAraclar(this.kapi, hat);
        this.sayac.hatSoruldu++;
        this.isle(hat, araclar);
      } catch (e) {
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
    const sorulanHat = [...this.hatDurumu.values()].filter((d) => d.soruldu).length;
    return {
      bilinenArac: this.atama.size,
      sorulanHat,
      toplamHat: this.hatlar.length,
      buOturumdaSorulan: this.sayac.hatSoruldu,
      sinir: this.sayac.sinir,
      hata: this.sayac.hata,
      taramaAraligiSn: Number.isFinite(this.aralikMs) ? Math.round(this.aralikMs / 1000) : null,
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
