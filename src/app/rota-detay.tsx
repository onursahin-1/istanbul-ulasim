// 3 · Rota detayı: haritada güzergâh, adım adım zaman çizelgesi ve yolculuk takibi.
// Her toplu taşıma bacağı açılabilir: içinde geçilen duraklar, seferin sıklığı ve
// günün son seferi uyarısı çıkar.

import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Pressable } from '@/components/dokun';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AltYaprak } from '@/components/alt-yaprak';
import {
  AdimKartlari,
  AdimSekmeleri,
  KonumSeridi,
  TumAdimlar,
  useSesliTarif,
  type YolTarifiVerisi,
} from '@/components/canli-yol-tarifi';
import { HareketliOtobus } from '@/components/harita-isaretleri';
import { HatirlatmaSayfasi, type InisBilgisi } from '@/components/hatirlatma';
import { canliRenk, DONUS_SIMGELERI, GeriCubugu, HatRozeti, Ikon, useStiller } from '@/components/ulasim';
import { bacakCanli } from '@/lib/canli';
import { hemenBildir, izinIste, useHatirlaticilar } from '@/lib/bildirim';
import { sesliTarifKaydet, useKayitlar } from '@/lib/kayitlar';
import { cizgiUzerindeYer, mesafeMetre, polylineCoz, type Nokta } from '@/lib/cografya';
import {
  araclariYerlestir,
  kalanYaz,
  METROBUS_HIZI_MS,
  OTOBUS_HIZI_MS,
  yaklasanOtobus,
  yasYaz,
  type YerlesikArac,
} from '@/lib/arac-konum';
import {
  bacakDuraklari,
  durakKalkislariGetir,
  seferDeseniGetir,
  seferSaatleriGetir,
  type DurakKalkisi,
  kopruyeIlgiBildir,
  seferAraclariGetir,
  yuruyusPlanla,
  type Bacak,
} from '@/lib/otp';
import { guzergahGetir } from '@/lib/secim';
import { beklemeSecenekleri, binilenHatTahmini, durakOranlari, paylasimMetni, type BeklemeSecenegi } from '@/lib/bekleme';
import { seferBilgisi, sikliktanYazi, type SeferBilgisi } from '@/lib/sefer';
import { aracAdi, baslikYap, haritaRengi, hatEtiketi, hatRengi, useTema, type Tema } from '@/lib/tema';
import { OZEL_GUNLER } from '@/lib/ozel-gun-verisi';
import { TARIFE_TARIHI, UCRET_ADLARI, ucretKisa, ucretYaz, yolculukUcreti } from '@/lib/ucret';
import {
  adimlariKur,
  baslangicDurumu,
  durumuIlerlet,
  durumuZamanla,
  elleBin,
  IYI_DOGRULUK_M,
  KABA_DOGRULUK_M,
  KISA_YURUME_M,
  yenidenCizilmeli,
  type BacakOzeti,
  type KonumOrnegi,
  type YolculukDurumu,
} from '@/lib/yolculuk';
import { kayitBaslat, kayitBitir, kayitEkle } from '@/lib/yolculuk-kaydi';
import { bacakZamanlari, yenidenZamanla, zamanlamayiUygula, type SecilenKalkis } from '@/lib/zamanlama';
import { adimlariYaz } from '@/lib/yuruyus';
import { isodanSaniye, mesafeYaz, saatYaz, saniyedenSaat, sureYaz } from '@/lib/zaman';
import { geriDon } from '@/lib/gezinti';
import { metrobusMu } from '@/lib/metin';

type Takip = { bacak: number; kalanDurak: number } | null;

/** Bundan kötü doğruluklu konum yürüyüşü yeniden çizdirmez (metre). Adım kararları yolculuk.ts'de. */
const KOTU_DOGRULUK_M = IYI_DOGRULUK_M;
/** Konum izinde tutulan süre ve en çok ölçüm (binişi hızdan anlamak için). */
const IZ_SURESI_MS = 20 * 60_000;
const IZ_EN_COK = 400;
/** Yolculuk aranan saatten bu kadar uzakta başlatıldıysa saatler yeniden kurulmaz (ileri tarihli plana bakılıyor). */
const ZAMANLAMA_UFKU_MS = 90 * 60_000;
/** Yürürken ve beklerken saatlerin yeniden kurulma aralığı. */
const ZAMANLAMA_ARALIGI_MS = 20_000;

/** Raylı (yeraltı, sık sefer): durakta tarife payı kısa; otobüs tarifesi ara duraklarda tahmin, payı uzun. */
const RAYLI_MODLAR = new Set(['SUBWAY', 'RAIL', 'FUNICULAR', 'MONORAIL', 'TRAM', 'CABLE_CAR', 'GONDOLA']);
const rayliMi = (b?: Bacak) => RAYLI_MODLAR.has((b?.route?.mode ?? b?.mode ?? '').toUpperCase());

/** Bacağın kendi hattının (aynı desen) kalkışları: yeniden zamanlama ve sefer sıklığı için. */
function anaHatKalkislari(b: Bacak | undefined, liste: DurakKalkisi[] | undefined): DurakKalkisi[] {
  if (!b || !liste) return [];
  const desen = b.trip?.pattern?.code;
  return liste.filter((k) => k.hatId === b.route?.gtfsId && (!desen || !k.desen || k.desen === desen));
}

function anOku(iso?: string | null): number | null {
  const an = Date.parse(iso ?? '');
  return Number.isNaN(an) ? null : an;
}

/** Yolculukta konum gelmese de (metro tüneli) ilerleme bu aralıkla saatten tazelenir. */
const ZAMAN_ADIMI_MS = 3_000;

function bacakNoktalari(b: Bacak): Nokta[] {
  const cizgi = polylineCoz(b.legGeometry?.points);
  if (cizgi.length > 1) return cizgi;
  return [
    { latitude: b.from.lat, longitude: b.from.lon },
    { latitude: b.to.lat, longitude: b.to.lon },
  ];
}

export default function RotaDetayEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);
  const { height } = useWindowDimensions();
  const { sira, hedef, esdeger } = useLocalSearchParams<{ sira: string; hedef?: string; esdeger?: string }>();
  // Güzergâh durumda tutuluyor: yolculukta yürüme bacağı bulunulan yerden yeniden çizilebiliyor.
  const [guzergah, setGuzergah] = useState(() => guzergahGetir(Number(sira)));
  const harita = useRef<MapView>(null);

  // Yolculuktaki otobüs hatlarını köprü öncelikle tarasın: bineceğin otobüs canlı görünsün.
  useEffect(() => {
    kopruyeIlgiBildir((guzergah?.legs ?? []).filter((b) => b.transitLeg).map((b) => b.route?.shortName));
  }, [guzergah]);

  const [takipAcik, setTakipAcik] = useState(false);
  // Canlı yol tarifi: hangi adımdayız (konum belirliyor) ve hangi adımın kartına bakılıyor.
  const [durum, setDurum] = useState<YolculukDurumu | null>(null);
  const [gorunen, setGorunen] = useState(0);
  const [kartBoyu, setKartBoyu] = useState(0);
  const [tumAdimlarAcik, setTumAdimlarAcik] = useState(false);
  const [simdi, setSimdi] = useState(() => Date.now());
  const sonKonum = useRef<Nokta | null>(null);
  /** Son konumun zamanı ve doğruluğu: tazeyse ilerlemeyi konum, değilse saat belirliyor. */
  const sonGps = useRef<{ an: number; dogruluk?: number | null; konum?: Nokta | null } | null>(null);
  /** Son dakikaların konumları: binişi hızdan anlamak için (yolculuk.ts, binisiAlgila). */
  const iz = useRef<KonumOrnegi[]>([]);
  const sonIslenen = useRef<{ an: number; konum: Nokta } | null>(null);
  const sonSinyalKaydi = useRef(0);
  const [konum, setKonum] = useState<Nokta | null>(null);
  const [acikBacaklar, setAcikBacaklar] = useState<Record<number, boolean>>({});
  // Araç bacaklarının biniş durağından bütün kalkışlar (her hat) ve seferin durak saatleri.
  const [durakKalkislari, setDurakKalkislari] = useState<Record<number, DurakKalkisi[]>>({});
  const [seferSaatleri, setSeferSaatleri] = useState<Record<number, Map<string, number>>>({});
  const [hatirlatAcik, setHatirlatAcik] = useState(false);
  const { hatirlaticilar, yenile: hatirlaticilariYenile } = useHatirlaticilar();
  const { ucretTuru, ekranAcik, sesliTarif, sesCinsiyeti, rotaSecenekleri } = useKayitlar();
  const aboneligi = useRef<Location.LocationSubscription | null>(null);
  const simulasyon = useRef<ReturnType<typeof setInterval> | null>(null);
  const uyarilanlar = useRef(new Set<string>());
  const sorulanlar = useRef(new Set<number>());

  const bacaklar = useMemo(() => guzergah?.legs ?? [], [guzergah]);
  const cizgiler = useMemo(() => bacaklar.map(bacakNoktalari), [bacaklar]);
  const duraklar = useMemo(() => bacaklar.map((b) => (b.transitLeg ? bacakDuraklari(b) : [])), [bacaklar]);
  // Rota listesinden gelen eşdeğer hatlar ("141M" aynı duraklar arasında gidiyor), bacak
  // sırasıyla. Yolcu bindiği hattı değiştirebildiği için (97M yerine 141M) bütün hatlar
  // aranan güzergâhın hattıyla birlikte tutulur; "öbürleri" o an binilen hat dışındakiler.
  const ilkHatlar = useRef((guzergah?.legs ?? []).map((b) => b.route?.shortName ?? ''));
  const tumHatlar = useMemo(() => {
    const parcalar = (esdeger ?? '').split('|');
    const tablo: Record<number, string[]> = {};
    let arac = 0;
    (guzergah?.legs ?? []).forEach((b, i) => {
      if (!b.transitLeg) return;
      const ek = (parcalar[arac++] ?? '').split(',').filter(Boolean);
      tablo[i] = [...new Set([ilkHatlar.current[i], ...ek].filter(Boolean))];
    });
    return tablo;
  }, [esdeger]); // eslint-disable-line react-hooks/exhaustive-deps
  const esdegerHatlar = useMemo(() => {
    const tablo: Record<number, string[]> = {};
    for (const [anahtar, liste] of Object.entries(tumHatlar)) {
      const i = Number(anahtar);
      const obur = liste.filter((h) => h !== bacaklar[i]?.route?.shortName);
      if (obur.length) tablo[i] = obur;
    }
    return tablo;
  }, [tumHatlar, bacaklar]);

  // Adım adım görünüm için: hangi bacak hangi adım, konumla ilerlemek için bacakların özeti.
  const ozetler = useMemo<BacakOzeti[]>(
    () =>
      bacaklar.map((b, i) => ({
        arac: !!b.transitLeg,
        mesafe: b.distance ?? null,
        bitis: { latitude: b.to.lat, longitude: b.to.lon },
        duraklar: duraklar[i].map((d) => ({ latitude: d.lat, longitude: d.lon })),
        binisMs: anOku(b.start.estimated?.time ?? b.start.scheduledTime),
        inisMs: anOku(b.end.estimated?.time ?? b.end.scheduledTime),
        cizgi: cizgiler[i],
        ...(b.transitLeg ? { rayli: rayliMi(b) } : {}),
      })),
    [bacaklar, duraklar, cizgiler],
  );
  const adimlar = useMemo(() => adimlariKur(ozetler), [ozetler]);
  // Eski liste görünümü (takip dışı) için: içinde bulunulan araç bacağı ve kalan durak.
  const takip: Takip = useMemo(
    () =>
      durum && durum.faz === 'icinde' && adimlar[durum.adim]
        ? { bacak: adimlar[durum.adim].bacak, kalanDurak: durum.kalanDurak ?? 0 }
        : null,
    [durum, adimlar],
  );

  // Sefer sıklığı ve "kaçırırsan sonraki": biniş saati yolda yeniden kurulabildiği için
  // kalkış listesinden her seferinde güncel biniş saatine göre.
  const seferler = useMemo(() => {
    const tablo: Record<number, SeferBilgisi> = {};
    for (const [anahtar, liste] of Object.entries(durakKalkislari)) {
      const b = bacaklar[Number(anahtar)];
      if (b) {
        tablo[Number(anahtar)] = seferBilgisi(
          anaHatKalkislari(b, liste),
          isodanSaniye(b.start.estimated?.time ?? b.start.scheduledTime),
        );
      }
    }
    return tablo;
  }, [durakKalkislari, bacaklar]);

  // Bekleme kartının satırları: aynı yoldaki her hat, sıradaki kalkışlarıyla.
  const secenekler = useMemo(() => {
    const tablo: Record<number, BeklemeSecenegi[]> = {};
    for (const [anahtar, liste] of Object.entries(durakKalkislari)) {
      const i = Number(anahtar);
      const b = bacaklar[i];
      const ana = b?.route?.shortName;
      if (!b || !ana) continue;
      tablo[i] = beklemeSecenekleri(liste, [ana, ...(esdegerHatlar[i] ?? [])], simdi, b.trip?.pattern?.code);
    }
    return tablo;
  }, [durakKalkislari, bacaklar, esdegerHatlar, simdi]);

  // Durakların biniş ile iniş arasındaki oranı: seferin tarifesinden, yoksa mesafeden.
  const oranlar = useMemo(() => {
    const tablo: Record<number, number[]> = {};
    duraklar.forEach((liste, i) => {
      if (!bacaklar[i]?.transitLeg || liste.length < 2) return;
      tablo[i] = durakOranlari(
        liste.map((d) => ({ latitude: d.lat, longitude: d.lon, gtfsId: d.gtfsId })),
        seferSaatleri[i],
      );
    });
    return tablo;
  }, [duraklar, bacaklar, seferSaatleri]);

  const ucret = useMemo(() => yolculukUcreti(bacaklar, ucretTuru, OZEL_GUNLER), [bacaklar, ucretTuru]);
  // Yürüme bacaklarının adım adım tarifi; toplu taşıma bacaklarında boş kalır.
  const yolTarifleri = useMemo(() => bacaklar.map((b) => (b.transitLeg ? [] : adimlariYaz(b.steps))), [bacaklar]);

  // Hatırlatıcılar: yola çıkış anı ve her aracın iniş durağına varış anı.
  // Grup anahtarı aranan güzergâhın ilk saatiyle: yolda saatler yeniden kurulunca kurulu
  // hatırlatıcılar kaybolmasın.
  const ilkBaslangic = useRef(guzergah?.start ?? '');
  const hatirlatmaGrubu = `rota-${sira}-${ilkBaslangic.current}`;
  const kuruluHatirlatici = hatirlaticilar.filter((h) => h.grup === hatirlatmaGrubu).length;
  const kalkisAni = useMemo(() => {
    const an = Date.parse(guzergah?.start ?? '');
    return Number.isNaN(an) ? null : an;
  }, [guzergah]);
  const inisler = useMemo<InisBilgisi[]>(
    () =>
      bacaklar
        .filter((b) => b.transitLeg)
        .map((b) => ({
          zaman: Date.parse(b.end.estimated?.time ?? b.end.scheduledTime ?? ''),
          durak: baslikYap(b.to.name),
          hat: b.route?.shortName ?? aracAdi(b.route?.mode ?? b.mode),
        }))
        .filter((i) => !Number.isNaN(i.zaman)),
    [bacaklar],
  );

  // Alt yaprak: harita tüm ekranı kaplıyor, yaprak üstünde sürükleniyor (ana ekrandaki gibi).
  // Yaprağın alanı alttaki "Yolculuğu başlat" çubuğunun üstünde bitiyor.
  const [yaprakAlani, setYaprakAlani] = useState(0);
  const [altCubuk, setAltCubuk] = useState(0);
  const [yaprakBoyu, setYaprakBoyu] = useState(Math.round(height * 0.5));

  // Bineceğin otobüsler: henüz binilmemiş her araç bacağı için, o seferi yapan otobüs
  // ve biniş durağına kaç durak kaldığı. Yarım dakikada bir tazeleniyor; alınamazsa
  // sessizce boş kalıyor (canlı konum süs, yolculuk onsuz da planlanmış).
  const [binisOtobusleri, setBinisOtobusleri] = useState<Record<number, { otobus: YerlesikArac; kalan: number }>>({});

  // "Otobüs yaklaşınca haber ver": açık olan bacaklar ve uyarısı atılmış olanlar.
  // Canlı konuma bakarak çalışıyor, bu yüzden yalnız uygulama açıkken; kapalıyken
  // haber vermek sunucudan itme bildirimi ister (sırada).
  const [yaklasmaUyarisi, setYaklasmaUyarisi] = useState<Record<number, boolean>>({});
  const uyarildi = useRef(new Set<number>());
  const yaklasmaUyarisiRef = useRef(yaklasmaUyarisi);
  yaklasmaUyarisiRef.current = yaklasmaUyarisi;
  const uyariDegistir = useCallback(async (i: number) => {
    const acilacak = !yaklasmaUyarisiRef.current[i];
    if (acilacak && !(await izinIste())) {
      Alert.alert('Bildirim izni yok', 'Ayarlar › Bildirimler bölümünden bu uygulamaya izin verebilirsin.');
      return;
    }
    uyarildi.current.delete(i);
    setYaklasmaUyarisi((o) => ({ ...o, [i]: acilacak }));
  }, []);
  useEffect(() => {
    let acik = true;
    const yukle = async () => {
      const simdi = Date.now();
      const sonuc: Record<number, { otobus: YerlesikArac; kalan: number }> = {};
      await Promise.all(
        bacaklar.map(async (b, i) => {
          const sefer = b.trip?.gtfsId;
          const duraklar = b.trip?.pattern?.stops ?? [];
          const binis = Date.parse(b.start.estimated?.time ?? b.start.scheduledTime ?? '');
          if (!b.transitLeg || !sefer || !duraklar.length || !(binis > simdi - 60_000)) return;
          try {
            const araclar = araclariYerlestir(duraklar, await seferAraclariGetir(sefer), simdi);
            const sira = duraklar.findIndex((d) => d.gtfsId === b.from.stop?.gtfsId);
            const y = yaklasanOtobus(araclar, sira, sefer);
            // Yalnız bu seferin otobüsü: başka bir otobüsü "bineceğin" diye göstermek yanıltır.
            if (y && y.otobus.sefer === sefer) sonuc[i] = y;
          } catch {
            // canlı konum alınamadı; bu bacakta gösterilmez
          }
        }),
      );
      if (acik) setBinisOtobusleri(sonuc);
    };
    yukle();
    const zamanlayici = setInterval(yukle, 30_000);
    return () => {
      acik = false;
      clearInterval(zamanlayici);
    };
  }, [bacaklar]);

  useEffect(() => {
    for (const [anahtar, { otobus, kalan }] of Object.entries(binisOtobusleri)) {
      const i = Number(anahtar);
      if (!yaklasmaUyarisi[i] || uyarildi.current.has(i) || kalan > YAKLASMA_ESIGI || otobus.sinif === 'eski') continue;
      uyarildi.current.add(i);
      const b = bacaklar[i];
      const hat = b?.route?.shortName ?? 'Otobüs';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      hemenBildir(
        `${hat} ${kalanYaz(kalan)}`,
        `${baslikYap(b?.from.name)} durağında ol: otobüs ${kalan === 0 ? 'durakta' : 'geliyor'}.`,
      );
    }
  }, [binisOtobusleri, yaklasmaUyarisi, bacaklar]);

  const durakKalkislariRef = useRef<Record<number, DurakKalkisi[]>>({});
  const kalaniZamanlaRef = useRef<() => void>(() => {});

  /**
   * Biniş durağından bütün kalkışları çeker: sefer sıklığı, bekleme kartındaki hatlar ve
   * yolda yeniden zamanlama bunlardan. Bir kez; beklenen bacak için düzenli tazelenir.
   */
  const seferleriYukle = useCallback(
    async (i: number, tazele = false) => {
      if (!tazele && sorulanlar.current.has(i)) return;
      const b = bacaklar[i];
      const durakId = b?.from.stop?.gtfsId;
      if (!b?.transitLeg || !durakId) return;
      sorulanlar.current.add(i);
      try {
        const kalkislar = await durakKalkislariGetir(durakId);
        durakKalkislariRef.current = { ...durakKalkislariRef.current, [i]: kalkislar };
        setDurakKalkislari(durakKalkislariRef.current);
        kalaniZamanlaRef.current();
      } catch {
        // Sefer sıklığı süslemedir; alınamazsa ekranın geri kalanı çalışmaya devam eder.
      }
    },
    [bacaklar],
  );

  /** Seferin durak saatleri: otobüsteyken durakların saati aralarındaki gerçek orana göre. */
  const saatleriYukle = useCallback(async (i: number, seferId?: string | null, gun?: string | null) => {
    if (!seferId || !gun) return;
    try {
      const liste = await seferSaatleriGetir(seferId, gun);
      if (liste.length) setSeferSaatleri((o) => ({ ...o, [i]: new Map(liste.map((s) => [s.gtfsId, s.saniye])) }));
    } catch {
      // Metro gibi sıklık tabanlı seferlerde gelmeyebilir: oranlar mesafeden.
    }
  }, []);

  const bacagiAcKapa = useCallback(
    (i: number) => {
      setAcikBacaklar((onceki) => {
        const yeni = { ...onceki, [i]: !onceki[i] };
        if (yeni[i]) seferleriYukle(i);
        return yeni;
      });
    },
    [seferleriYukle],
  );

  // Yürüyüşü bulunulan yerden yeniden çizme (yolculuk başında ve yürürken yoldan sapınca).
  // Binilecek hat ve durak değişmiyor; yalnız oraya yürüme yolu. Bkz. yolculuk.ts.
  const durumRef = useRef(durum);
  durumRef.current = durum;
  const cizim = useRef<{ ilkKonum: boolean; son: number | null; suruyor: AbortController | null }>({
    ilkKonum: true,
    son: null,
    suruyor: null,
  });
  const erisilebilir = rotaSecenekleri.erisilebilir;
  const yuruyusuYenidenCiz = useCallback(
    async (nokta: Nokta, i: number) => {
      const b = bacaklar[i];
      if (!b || b.transitLeg) return;
      const iptal = new AbortController();
      cizim.current.suruyor = iptal;
      cizim.current.son = Date.now();
      try {
        const yeni = await yuruyusPlanla(nokta, b, erisilebilir, iptal.signal);
        // Durağın dibindeyse (çok kısa yürüyüş) eskisi kalsın: adım listesi değişmesin.
        if (iptal.signal.aborted || !yeni || (yeni.distance ?? 0) < KISA_YURUME_M) return;
        setGuzergah((g) => (g ? { ...g, legs: g.legs.map((x, j) => (j === i ? yeni : x)) } : g));
      } catch {
        // Sunucuya ulaşılamadı: eski çizgi kalır, "rotadan uzaklaştın" uyarısı yol gösterir.
      } finally {
        if (cizim.current.suruyor === iptal) cizim.current.suruyor = null;
      }
    },
    [bacaklar, erisilebilir],
  );

  const konumuIsle = useCallback(
    (nokta: Nokta, dogruluk?: number | null, hiz?: number | null) => {
      const an = Date.now();
      sonGps.current = { an, dogruluk, konum: nokta };
      // Dururken saniyede bir gelen aynı konum yalnız "sinyal var" demek: ekranı yormasın.
      const onceki = sonIslenen.current;
      if (onceki && an - onceki.an < 5_000 && mesafeMetre(onceki.konum, nokta) < 3) {
        // Kayıtta "sinyal var" izi (oynatmada konum kesildi sanılmasın), on saniyede bir.
        if (an - sonSinyalKaydi.current >= 10_000) {
          sonSinyalKaydi.current = an;
          kayitEkle('sinyal', { d: dogruluk ?? null });
        }
        return;
      }
      sonIslenen.current = { an, konum: nokta };
      sonKonum.current = nokta;
      setKonum(nokta);
      kayitEkle('konum', { lat: nokta.latitude, lon: nokta.longitude, d: dogruluk ?? null, h: hiz ?? null });
      if (dogruluk != null && dogruluk > KABA_DOGRULUK_M) return;
      iz.current = [...iz.current.filter((o) => an - o.an <= IZ_SURESI_MS), { an, konum: nokta, dogruluk: dogruluk ?? null, hiz }].slice(
        -IZ_EN_COK,
      );
      // Kaba konum (50–300 m: otobüs içi, istasyon) da işlenir ama yalnız ileri götüren
      // kararlara, temkinli girer: binişi ve araçtaki ilerlemeyi gösterir (yolculuk.ts).
      const izAni = iz.current;
      setDurum((d) => (d ? durumuIlerlet(d, nokta, adimlar, ozetler, { dogruluk, iz: izAni }) : d));
      if (dogruluk != null && dogruluk > KOTU_DOGRULUK_M) return;

      const d = durumRef.current;
      const adim = d ? adimlar[d.adim] : undefined;
      const c = cizim.current;
      if (!d || c.suruyor) return;
      const karar = yenidenCizilmeli({
        durum: d,
        adim,
        ilkKonum: c.ilkKonum,
        konum: nokta,
        cizgi: adim ? cizgiler[adim.bacak] ?? [] : [],
        bitis: adim ? ozetler[adim.bacak].bitis : nokta,
        dogruluk,
        simdi: Date.now(),
        sonCizim: c.son,
      });
      // İlk konum, doğruluğu yeterli ilk konumla tüketiliyor; kaba bir ilk konum hakkı yakmasın.
      if (dogruluk == null || dogruluk <= KOTU_DOGRULUK_M) c.ilkKonum = false;
      if (karar && adim) yuruyusuYenidenCiz(nokta, adim.bacak);
    },
    [adimlar, ozetler, cizgiler, yuruyusuYenidenCiz],
  );
  // Konum aboneliği yolculuk başında kuruluyor; güzergâh sonradan değişince (yeniden çizim)
  // abonelik eski adım listesiyle kalmasın diye her zaman güncel işleyiciyi çağırıyor.
  const konumuIsleRef = useRef(konumuIsle);
  konumuIsleRef.current = konumuIsle;

  // Konum gelmezken de (metro tüneli, istasyon içi) ilerleme saatle sürsün: mavi nokta
  // duraktan durağa kaysın, kalkış geçince "metrodasın"a geçilsin. Taze konum varken
  // durumuZamanla hiçbir şey yapmıyor; konum belirliyor.
  useEffect(() => {
    if (!takipAcik) return;
    const z = setInterval(
      () => setDurum((d) => (d ? durumuZamanla(d, Date.now(), adimlar, ozetler, sonGps.current) : d)),
      ZAMAN_ADIMI_MS,
    );
    return () => clearInterval(z);
  }, [takipAcik, adimlar, ozetler]);

  // İnişe yaklaşırken titreşim; bir durak kala bildirim ("sıradaki durakta in").
  useEffect(() => {
    if (!takip) return;
    const anahtar = `${takip.bacak}-${takip.kalanDurak}`;
    if (takip.kalanDurak > 2 || uyarilanlar.current.has(anahtar)) return;
    uyarilanlar.current.add(anahtar);
    Haptics.notificationAsync(
      takip.kalanDurak === 0 ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
    if (takip.kalanDurak === 1) {
      hemenBildir('Sıradaki durakta in', `${baslikYap(bacaklar[takip.bacak]?.to.name)} durağında inmeye hazırlan.`);
    }
  }, [takip, bacaklar]);

  const zamanlamaAcik = useRef(false);
  const takibiDurdur = useCallback(() => {
    aboneligi.current?.remove();
    aboneligi.current = null;
    if (simulasyon.current) clearInterval(simulasyon.current);
    simulasyon.current = null;
    setTakipAcik(false);
    setDurum(null);
    setKonum(null);
    sonKonum.current = null;
    sonGps.current = null;
    iz.current = [];
    sonIslenen.current = null;
    zamanlamaAcik.current = false;
    kayitBitir();
    setTumAdimlarAcik(false);
    uyarilanlar.current.clear();
    cizim.current.suruyor?.abort();
    cizim.current = { ilkKonum: true, son: null, suruyor: null };
  }, []);

  useEffect(() => takibiDurdur, [takibiDurdur]);

  // Yolda saatleri gerçeğe göre yeniden kurma (zamanlama.ts): yürürken kalan yürüyüşe,
  // durakta şimdiye, binince gerçek biniş anına göre. Hızlı yürüyüp erken varınca önceki
  // otobüs, metro erken gelip binilince ondan sonraki saatler.
  const guncel = useRef({ adimlar, bacaklar, cizgiler, duraklar });
  guncel.current = { adimlar, bacaklar, cizgiler, duraklar };
  const kalaniZamanla = useCallback(() => {
    if (!zamanlamaAcik.current) return;
    const d = durumRef.current;
    const { adimlar: liste, bacaklar: bl, cizgiler: cl } = guncel.current;
    const a = d ? liste[d.adim] : undefined;
    if (!d || !a || d.faz === 'vardi') return;
    const simdi = Date.now();
    const bas = a.bacak;
    let an = simdi;
    let secenek: { kesin?: boolean; kalanYuruyusMs?: number } = {};
    if (d.faz === 'icinde') {
      if (d.binisAn == null) return;
      an = d.binisAn;
      secenek = { kesin: true };
    } else if (d.faz === 'yuru') {
      // Kalan yürüyüş: çizgi boyunca kalan oran kadar planlanan süre. Hızlı yürüdükçe
      // kısalır, durağa daha önce varılacağı için daha önceki sefer seçilebilir.
      const cizgi = cl[a.bacak] ?? [];
      const k = sonKonum.current;
      let oran = 1;
      if (k && cizgi.length > 1) {
        const yer = cizgiUzerindeYer(k, cizgi);
        if (yer.toplam > 0) oran = Math.max(0, Math.min(1, 1 - yer.boyunca / yer.toplam));
      }
      secenek = { kalanYuruyusMs: oran * (bl[a.bacak]?.duration ?? 0) * 1000 };
    }
    setGuzergah((g) => {
      if (!g) return g;
      const zaman = bacakZamanlari(g);
      if (!zaman) return g;
      const kalkislar: Record<number, SecilenKalkis[]> = {};
      for (const [anahtar, l] of Object.entries(durakKalkislariRef.current)) {
        kalkislar[Number(anahtar)] = anaHatKalkislari(g.legs[Number(anahtar)], l).map((k) => ({ an: k.an, seferId: k.seferId }));
      }
      const yeni = yenidenZamanla(
        zaman.map((z, i) => ({ ...z, durakPayiMs: rayliMi(g.legs[i]) ? 30_000 : 120_000 })),
        bas,
        an,
        kalkislar,
        secenek,
      );
      const sonuc = zamanlamayiUygula(g, yeni);
      if (sonuc !== g) {
        kayitEkle('zamanlama', {
          bas,
          an,
          ...secenek,
          bacaklar: sonuc.legs.map((b) => [b.start.scheduledTime, b.end.scheduledTime, b.trip?.gtfsId ?? null]),
        });
      }
      return sonuc;
    });
  }, []);
  kalaniZamanlaRef.current = kalaniZamanla;

  // Adım ya da faz değişince (durağa varıldı, binildi, inildi) saatler yeniden kurulur;
  // kayda da düşer.
  useEffect(() => {
    if (!durum) return;
    kayitEkle('durum', { ...durum });
    kalaniZamanla();
  }, [durum?.adim, durum?.faz, durum?.binisAn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (durum?.kalanDurak != null) kayitEkle('durum', { ...durum });
  }, [durum?.kalanDurak]); // eslint-disable-line react-hooks/exhaustive-deps
  // Yürürken ve beklerken düzenli: hızlı yürüdükçe önceki otobüse, otobüs gelmeyince sonrakine.
  useEffect(() => {
    if (!takipAcik) return;
    const z = setInterval(kalaniZamanla, ZAMANLAMA_ARALIGI_MS);
    return () => clearInterval(z);
  }, [takipAcik, kalaniZamanla]);

  // Yolcunun elle seçtiği hat (düğmeyle): konumdan yapılan tahmin onu ezmesin.
  const elleSecilen = useRef(new Set<number>());

  /**
   * Bacağın hattını değiştirir (97M yerine 141M'ye binildi): hat, sefer ve durak deseni o
   * hattın biniş anına (binilmediyse şimdiye) en yakın seferi olur. Durak listesi, canlı
   * otobüs ve bildirimler bu hatta göre sürer.
   */
  const hatDegistir = useCallback(
    async (i: number, kisaAd: string, seferId?: string) => {
      const b = guncel.current.bacaklar[i];
      if (!b || b.route?.shortName === kisaAd) return;
      const hedefAn = durumRef.current?.binisAn ?? Date.now();
      const adaylar = (durakKalkislariRef.current[i] ?? []).filter((k) => k.kisaAd === kisaAd);
      const secilen =
        adaylar.find((k) => k.seferId === seferId) ??
        [...adaylar].sort((x, y) => Math.abs(x.an - hedefAn) - Math.abs(y.an - hedefAn))[0];
      if (!secilen) return;
      kayitEkle('hat-degisti', { bacak: i, kisaAd, seferId: secilen.seferId });
      let sefer: Awaited<ReturnType<typeof seferDeseniGetir>> = null;
      try {
        sefer = await seferDeseniGetir(secilen.seferId);
      } catch {
        // Desen alınamazsa durak listesi eskisi kalır; hat ve sefer yine değişir.
      }
      const eskiDurakSayisi = guncel.current.duraklar[i]?.length ?? 0;
      setGuzergah((g) =>
        g
          ? {
              ...g,
              legs: g.legs.map((x, j) =>
                j !== i
                  ? x
                  : {
                      ...x,
                      route: {
                        ...(x.route ?? { gtfsId: secilen.hatId, shortName: kisaAd }),
                        gtfsId: secilen.hatId,
                        shortName: kisaAd,
                        longName: secilen.uzunAd,
                        mode: secilen.mode ?? x.route?.mode,
                        agency: secilen.isletmeci ? { name: secilen.isletmeci } : (x.route?.agency ?? null),
                      },
                      headsign: secilen.yon ?? x.headsign,
                      trip: sefer ?? (x.trip ? { ...x.trip, gtfsId: secilen.seferId } : null),
                    },
              ),
            }
          : g,
      );
      // Araçtaysak ve durak sayısı değiştiyse ilerleme yeni listeye göre baştan (yalnız ileri gider).
      const d = durumRef.current;
      const yeniSayi = sefer ? bacakDuraklari({ ...b, trip: sefer }).length : eskiDurakSayisi;
      if (d?.faz === 'icinde' && guncel.current.adimlar[d.adim]?.bacak === i && yeniSayi !== eskiDurakSayisi) {
        setDurum((x) => (x ? { ...x, ilerleme: 0, kalanDurak: null, durakta: false } : x));
      }
      saatleriYukle(i, secilen.seferId, b.serviceDate);
    },
    [saatleriYukle],
  );

  /**
   * "Bindim" düğmesi: araç konumdan anlaşılmadan geldiyse (yeraltı, kötü GPS). Birden çok
   * hat varsa hangisine binildiği de seçilir.
   */
  const bindim = useCallback(
    (kisaAd?: string) => {
      kayitEkle('bindim-dugmesi', { kisaAd: kisaAd ?? null });
      const d = durumRef.current;
      if (d && kisaAd) {
        const sira = adimlar[d.adim]?.tur === 'arac' ? d.adim : d.adim + 1;
        const i = adimlar[sira]?.bacak;
        if (i != null) {
          elleSecilen.current.add(i);
          hatDegistir(i, kisaAd);
        }
      }
      setDurum((x) => (x ? elleBin(x, adimlar, ozetler, Date.now()) : x));
    },
    [adimlar, ozetler, hatDegistir],
  );

  /** "Değiştir": araçtayken bindiği hattı düzeltir. */
  const hatSec = useCallback(
    (i: number, kisaAd: string) => {
      elleSecilen.current.add(i);
      hatDegistir(i, kisaAd);
    },
    [hatDegistir],
  );

  // Konumdan anlaşılan binişte hangi hatta binildi: biniş anına en yakın kalkışı olan.
  useEffect(() => {
    const d = durumRef.current;
    if (d?.faz !== 'icinde' || d.binisAn == null) return;
    const i = adimlar[d.adim]?.bacak;
    if (i == null || elleSecilen.current.has(i) || (tumHatlar[i]?.length ?? 0) < 2) return;
    const tahmin = binilenHatTahmini(durakKalkislariRef.current[i] ?? [], tumHatlar[i], d.binisAn);
    if (tahmin) hatDegistir(i, tahmin.kisaAd, tahmin.seferId);
  }, [durum?.binisAn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Beklenen aracın kalkışları yarım dakikada bir tazelenir: canlı geri sayım ve bekleme kartı.
  useEffect(() => {
    if (!takipAcik) return;
    const z = setInterval(() => {
      const d = durumRef.current;
      const liste = guncel.current.adimlar;
      if (!d) return;
      const a = liste[d.adim];
      const bekle = a?.tur === 'arac' && d.faz === 'bekle' ? a : d.faz === 'yuru' && liste[d.adim + 1]?.tur === 'arac' ? liste[d.adim + 1] : null;
      if (bekle) seferleriYukle(bekle.bacak, true);
    }, 30_000);
    return () => clearInterval(z);
  }, [takipAcik, seferleriYukle]);

  /** Varış saatini paylaş: telefonun paylaşım menüsü. */
  const paylas = useCallback(() => {
    const son = bacaklar[bacaklar.length - 1];
    const varis = saatYaz(son?.end.estimated?.time ?? son?.end.scheduledTime);
    const hatlar = bacaklar
      .filter((b) => b.transitLeg)
      .map((b) => hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).rozet);
    kayitEkle('paylas');
    Share.share({ message: paylasimMetni(hedef ? baslikYap(hedef) : null, varis, hatlar) }).catch(() => {});
  }, [bacaklar, hedef]);

  // Takip başlayınca içinde bulunulan bacak kendiliğinden açılır: kullanıcı yoldayken
  // hangi durakta olduğunu görmek için ayrıca dokunmak zorunda kalmasın.
  useEffect(() => {
    if (takip) {
      setAcikBacaklar((onceki) => (onceki[takip.bacak] ? onceki : { ...onceki, [takip.bacak]: true }));
      seferleriYukle(takip.bacak);
    }
  }, [takip, seferleriYukle]);

  /** Adım adım görünümü açar: ilk adım, aktarmalar için sonraki seferler. */
  const yolculuguAc = () => {
    setTakipAcik(true);
    const ilk = baslangicDurumu(adimlar);
    durumRef.current = ilk;
    setDurum(ilk);
    // Şimdi yola çıkılıyorsa saatler şimdiye göre kurulur (aranan saat değil); ileri bir
    // saatin planına bakılıyorsa dokunulmaz.
    const planBasi = anOku(guzergah?.start);
    zamanlamaAcik.current = planBasi != null && Math.abs(planBasi - Date.now()) <= ZAMANLAMA_UFKU_MS;
    kayitBaslat({ sira, hedef: hedef ?? null, zamanlama: zamanlamaAcik.current, guzergah });
    kalaniZamanla();
    setGorunen(0);
    setSimdi(Date.now());
    bacaklar.forEach((b, i) => {
      if (!b.transitLeg) return;
      seferleriYukle(i);
      saatleriYukle(i, b.trip?.gtfsId, b.serviceDate);
    });
  };

  const takibiBaslat = async () => {
    const izin = await Location.requestForegroundPermissionsAsync();
    if (izin.status !== 'granted') {
      Alert.alert('Konum izni gerekli', 'Yolculuğunu takip edebilmemiz için ayarlardan konum iznini açman gerekiyor.');
      return;
    }
    yolculuguAc();
    // Yol tarifi için en yüksek doğruluk ve sık güncelleme: yürürken dönüşlere 5 m'de
    // bir bakılabilsin. Pil daha çok gider ama yalnız yolculuk sürerken.
    // distanceInterval 0: iOS dururken de konum yollasın. Yoksa durakta beklerken konum
    // kesiliyor, uygulama bunu "yeraltına inildi" sanıp tarifeye göre "bindin" diyordu.
    // Sık gelen konumlar konumuIsle'de seyreltiliyor.
    aboneligi.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 0, timeInterval: 2000 },
      (k) =>
        konumuIsleRef.current({ latitude: k.coords.latitude, longitude: k.coords.longitude }, k.coords.accuracy, k.coords.speed),
    );
  };

  // Geliştirme sırasında masadan deneyebilmek için: düğmeye basılı tutunca
  // güzergâhtaki duraklar sırayla "ziyaret edilir".
  const simulasyonuBaslat = () => {
    if (!__DEV__) return;
    // Yürüyüşlerde çizgi üstünden birkaç nokta, araçta duraklar sırayla "ziyaret edilir".
    const sirali: Nokta[] = bacaklar.flatMap((b, i) => {
      if (b.transitLeg) return duraklar[i].map((d) => ({ latitude: d.lat, longitude: d.lon }));
      const c = cizgiler[i];
      return [c[0], c[Math.floor(c.length / 2)], c[c.length - 1]].filter(Boolean);
    });
    if (!sirali.length) return;
    takibiDurdur();
    yolculuguAc();
    let adim = 0;
    simulasyon.current = setInterval(() => {
      const d = sirali[adim++];
      if (!d) {
        if (simulasyon.current) clearInterval(simulasyon.current);
        simulasyon.current = null;
        return;
      }
      konumuIsleRef.current(d);
    }, 1500);
  };

  // Yolculuk sürerken: ekran kararmasın (Ayarlar'dan kapatılabilir) ve saat yazıları tazelensin.
  useEffect(() => {
    if (!takipAcik) return;
    if (ekranAcik) activateKeepAwakeAsync('yolculuk').catch(() => {});
    const saat = setInterval(() => setSimdi(Date.now()), 30_000);
    return () => {
      clearInterval(saat);
      deactivateKeepAwake('yolculuk').catch(() => {});
    };
  }, [takipAcik, ekranAcik]);

  // Adım değişince (konumla), o anda şimdiki adıma bakılıyorsa kart da yenisine geçer.
  // Kullanıcı başka bir adıma bakıyorsa rahatsız edilmez; "şu anki adıma dön" çıkar.
  const oncekiAdim = useRef(0);
  useEffect(() => {
    if (!durum) return;
    if (gorunenRef.current === oncekiAdim.current) setGorunen(durum.adim);
    oncekiAdim.current = durum.adim;
  }, [durum?.adim]); // eslint-disable-line react-hooks/exhaustive-deps
  const gorunenRef = useRef(gorunen);
  gorunenRef.current = gorunen;

  // Harita bakılan adıma odaklanır: yürürken yol, beklerken durak ve gelen otobüs,
  // otobüsteyken kalan güzergâh. Konum her geldiğinde değil, adım/evre değişince.
  useEffect(() => {
    if (!durum || !kartBoyu) return;
    const a = adimlar[gorunen];
    if (!a) return;
    const i = a.bacak;
    const b = bacaklar[i];
    const simdiki = gorunen === durum.adim;
    let noktalar: Nokta[];
    if (simdiki && durum.faz === 'vardi') {
      noktalar = [{ latitude: b.to.lat, longitude: b.to.lon }];
    } else if (a.tur === 'yuru') {
      noktalar = cizgiler[i];
    } else if (simdiki && durum.faz === 'icinde') {
      const liste = duraklar[i];
      const bas = Math.max(0, liste.length - 1 - (durum.kalanDurak ?? liste.length - 1));
      noktalar = liste.slice(bas).map((d) => ({ latitude: d.lat, longitude: d.lon }));
    } else {
      const otobus = binisOtobusleri[i]?.otobus;
      noktalar = [
        { latitude: b.from.lat, longitude: b.from.lon },
        ...(otobus ? [{ latitude: otobus.lat, longitude: otobus.lon }] : []),
      ];
    }
    if (simdiki && sonKonum.current) noktalar = [...noktalar, sonKonum.current];
    if (noktalar.length === 1) {
      const P = 0.002;
      noktalar = [
        { latitude: noktalar[0].latitude - P, longitude: noktalar[0].longitude - P },
        { latitude: noktalar[0].latitude + P, longitude: noktalar[0].longitude + P },
      ];
    }
    harita.current?.fitToCoordinates(noktalar, {
      edgePadding: { top: kenar.top + 70, right: 50, bottom: kartBoyu + 30, left: 50 },
      animated: true,
    });
    // binisOtobusleri bilerek yok: her tazelemede harita zıplamasın.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gorunen, durum?.adim, durum?.faz, kartBoyu, adimlar]);

  // Harita, yaprağın ilk yerleşiminden sonra bir kez daha sığdırılıyor: ilk sığdırmada
  // yaprağın boyu henüz ölçülmemiş oluyor. Sonra kullanıcı haritayı kendisi kaydırır.
  const haritaHazir = useRef(false);
  const sonSigdirma = useRef(false);
  useEffect(() => {
    if (!haritaHazir.current || sonSigdirma.current || !yaprakAlani || !altCubuk) return;
    sonSigdirma.current = true;
    haritayiSigdir();
    // haritayiSigdir her çizimde yeniden kuruluyor; ölçüler yeter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaprakAlani, altCubuk, yaprakBoyu]);

  const haritayiSigdir = () => {
    haritaHazir.current = true;
    const tum = cizgiler.flat();
    if (tum.length < 2) return;
    harita.current?.fitToCoordinates(tum, {
      edgePadding: { top: kenar.top + 70, right: 40, bottom: yaprakBoyu + altCubuk + 30, left: 40 },
      animated: false,
    });
  };

  const yolTarifi: YolTarifiVerisi | null = durum
    ? {
        bacaklar,
        duraklar,
        adimlar,
        durum,
        tarifler: yolTarifleri,
        konum,
        cizgiler,
        binisOtobusleri,
        seferler,
        yaklasmaUyarisi,
        uyariDegistir,
        hedef,
        simdi,
        esdegerHatlar,
        bindim,
        hatSec,
        secenekler,
        oranlar,
        paylas,
      }
    : null;

  // Yürürken dönüşleri, araçta inilecek durağı sesli söyler (yalnız yolculuk takip edilirken).
  useSesliTarif(takipAcik ? yolTarifi : null, sesliTarif, sesCinsiyeti);

  if (!guzergah) {
    return (
      <View style={[s.kok, { paddingTop: kenar.top + 4, paddingHorizontal: 14 }]}>
        <GeriCubugu baslik="Rota detayı" />
        <Text style={s.bos}>Bu rota artık bellekte değil. Rota listesine dönüp tekrar seç.</Text>
      </View>
    );
  }

  const aktifBacak = takip?.bacak ?? -1;

  return (
    <View style={s.kok}>
      <MapView
        ref={harita}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle={tema.haritaStili}
        onMapReady={haritayiSigdir}
        showsUserLocation={takipAcik}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
      >
        {bacaklar.map((b, i) => (
          <Polyline
            key={i}
            coordinates={cizgiler[i]}
            strokeColor={b.transitLeg ? haritaRengi(b.route, tema) : tema.yurume}
            strokeWidth={b.transitLeg ? 5 : 3}
            lineDashPattern={b.transitLeg ? undefined : [2, 6]}
          />
        ))}
        {bacaklar
          .slice(0, -1)
          .filter((b) => b.to.stop)
          .map((b, i) => (
            <Marker
              key={`aktarma-${i}`}
              coordinate={{ latitude: b.to.lat, longitude: b.to.lon }}
              title={baslikYap(b.to.name)}
              pinColor={b.transitLeg ? haritaRengi(b.route, tema) : tema.yurume}
            />
          ))}
        <Marker coordinate={{ latitude: bacaklar[0].from.lat, longitude: bacaklar[0].from.lon }} title="Başlangıç" pinColor={tema.vurgu} />
        {Object.entries(binisOtobusleri).map(([i, { otobus, kalan }]) => {
          const b = bacaklar[Number(i)];
          // Bineceğin otobüs biniş durağına doğru geliyor: seferin durakları güzergâh yerine.
          const cizgi = (b?.trip?.pattern?.stops ?? [])
            .filter((d) => d.lat != null && d.lon != null)
            .map((d) => ({ latitude: d.lat!, longitude: d.lon! }));
          return (
            <HareketliOtobus
              key={`otobus-${i}`}
              otobus={otobus}
              cizgi={cizgi}
              hiz={metrobusMu(b?.route?.shortName) ? METROBUS_HIZI_MS : OTOBUS_HIZI_MS}
              renk={haritaRengi(b?.route, tema)}
              baslik={`${b?.route?.shortName ?? 'Otobüs'} · ${kalanYaz(kalan)}`}
              aciklama={`Konum ${yasYaz(otobus.yasSn)}`}
            />
          );
        })}
        <Marker
          coordinate={{ latitude: bacaklar[bacaklar.length - 1].to.lat, longitude: bacaklar[bacaklar.length - 1].to.lon }}
          title={hedef ? baslikYap(hedef) : 'Varış'}
          pinColor={tema.yazi}
        />
      </MapView>

      <View style={[s.geri, { top: kenar.top + 8 }]}>
        <Pressable hitSlop={4} style={s.yuvarlak} onPress={geriDon} accessibilityLabel="Geri">
          <Ikon ad="chevron-back" boyut={22} />
        </Pressable>
      </View>

      {takipAcik && yolTarifi && (
        <View style={[s.sekmeKonumu, { top: kenar.top + 8 }]} pointerEvents="box-none">
          <AdimSekmeleri v={yolTarifi} gorunen={gorunen} sec={setGorunen} />
          <KonumSeridi v={yolTarifi} ses={{ acik: sesliTarif, degistir: () => sesliTarifKaydet(!sesliTarif) }} />
        </View>
      )}

      <View
        style={{ flex: 1 }}
        pointerEvents="box-none"
        onLayout={(e) => setYaprakAlani(e.nativeEvent.layout.height)}
      >
        {yaprakAlani > 0 && !takipAcik && (
          <AltYaprak
            kapsayiciYukseklik={yaprakAlani}
            ustPay={kenar.top + 60}
            kapaliYukseklik={92}
            ortaOran={0.62}
            onDurum={(_, boy) => setYaprakBoyu(boy)}
            erisilebilirlikEtiketi="Yolculuk adımlarını aç ya da kapat"
            baslik={
              <View style={s.ozet}>
                <View>
                  <Text style={s.sure}>{sureYaz(guzergah.duration)}</Text>
                  <Text style={s.ozetAlt}>
                    {guzergah.numberOfTransfers === 0 ? 'Aktarmasız' : `${guzergah.numberOfTransfers} aktarma`} · {sureYaz(guzergah.walkTime)} yürüme
                  </Text>
                </View>
                <Text style={s.ozetSaat}>{`${saatYaz(guzergah.start)}–${saatYaz(guzergah.end)}`}</Text>
              </View>
            }
          >
            <View style={{ paddingVertical: 10 }}>
              {bacaklar.map((b, i) => {
                const renkKodu = b.transitLeg ? hatRengi(b.route, tema) : tema.yurume;
                const liste = duraklar[i];
                const durakSayisi = Math.max(liste.length - 1, 1);
                const sonYuruyus = !b.transitLeg && i === bacaklar.length - 1;
                const acik = !!acikBacaklar[i];
                const sefer = seferler[i];
                const aktarma = aktarmaSuresi(bacaklar, i);
                // Takip sırasında kullanıcının bulunduğu durağın listedeki sırası.
                const simdikiDurak = aktifBacak === i && takip ? liste.length - 1 - takip.kalanDurak : -1;
                // Canlı veriyle güncellenmiş kalkışın tarifeden sapması (yalnız araç bacakları).
                const canli = b.transitLeg ? bacakCanli(b.start.scheduledTime, b.start.estimated?.time) : null;

                return (
                  <View key={i} style={[s.adim, aktifBacak === i && s.adimAktif]}>
                    <View style={s.adimSaatSutun}>
                      <Text style={s.adimSaat}>{saatYaz(b.start.estimated?.time ?? b.start.scheduledTime)}</Text>
                      {canli && (
                        <Text style={[s.adimSapma, { color: canliRenk(canli.sinif, tema) }]} numberOfLines={1}>
                          {canli.dakika === 0 ? 'canlı' : canli.dakika > 0 ? `+${canli.dakika} dk` : `${canli.dakika} dk`}
                        </Text>
                      )}
                    </View>
                    <View style={s.cizgiSutun}>
                      <View style={[s.adimNokta, { borderColor: renkKodu }]} />
                      <View style={[s.adimCizgi, b.transitLeg ? { backgroundColor: renkKodu } : s.adimCizgiYuru]} />
                    </View>
                    <View style={s.adimIcerik}>
                      {b.transitLeg ? (
                        <>
                          <Text style={s.adimBaslik}>{baslikYap(b.from.name)}</Text>

                          <Pressable
                            onPress={() => bacagiAcKapa(i)}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: acik }}
                            accessibilityLabel={`${b.route?.shortName ?? ''} hattı, ${durakSayisi} durak. ${acik ? 'Durakları gizle' : 'Durakları göster'}`}
                            style={[s.bacakDugme, acik && { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }]}
                          >
                            <HatRozeti hat={b.route} kucuk ekHatlar={esdegerHatlar[i]} />
                            <Text style={s.adimAlt} numberOfLines={1}>
                              {[
                                b.headsign ? `${baslikYap(b.headsign)} yönü` : aracAdi(b.route?.mode ?? b.mode),
                                `${durakSayisi} durak`,
                                sureYaz(b.duration),
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </Text>
                            <Ikon ad={acik ? 'chevron-up' : 'chevron-down'} boyut={15} renkKodu={acik ? renkKodu : tema.soluk} />
                          </Pressable>

                          {!!esdegerHatlar[i] && (
                            <View style={s.esdegerNot}>
                              <Ikon ad="swap-horizontal" boyut={14} renkKodu={tema.vurgu} />
                              <Text style={s.esdegerYazi}>
                                {`Bu duraklar arasında ${esdegerHatlar[i].join(', ')} ile de gidebilirsin. Hangisi önce gelirse ona bin.`}
                              </Text>
                            </View>
                          )}

                          {binisOtobusleri[i] && (
                            <OtobusKutusu
                              kalan={binisOtobusleri[i].kalan}
                              otobus={binisOtobusleri[i].otobus}
                              binis={b.start.estimated?.time ?? b.start.scheduledTime}
                              renk={renkKodu}
                              uyari={!!yaklasmaUyarisi[i]}
                              uyariDegistir={() => uyariDegistir(i)}
                            />
                          )}

                          {acik && (
                            <View style={s.durakPaneli}>
                              {sefer?.aralikDk != null && (
                                <View style={s.siklik}>
                                  <Ikon ad="time-outline" boyut={13} renkKodu={renkKodu} />
                                  <Text style={[s.siklikYazi, { color: renkKodu }]}>{sikliktanYazi(sefer)}</Text>
                                </View>
                              )}
                              {liste.map((d, j) => {
                                const ilk = j === 0;
                                const son = j === liste.length - 1;
                                const burada = j === simdikiDurak;
                                const saat = ilk
                                  ? saatYaz(b.start.estimated?.time ?? b.start.scheduledTime)
                                  : son
                                    ? saatYaz(b.end.estimated?.time ?? b.end.scheduledTime)
                                    : '';
                                return (
                                  <View key={d.gtfsId} style={s.durakSatiri}>
                                    <View style={s.durakCizgi}>
                                      <View
                                        style={[
                                          s.durakCizgiUst,
                                          { backgroundColor: renkKodu },
                                          ilk && { backgroundColor: 'transparent' },
                                        ]}
                                      />
                                      <View
                                        style={[
                                          s.durakCizgiAlt,
                                          { backgroundColor: renkKodu },
                                          son && { backgroundColor: 'transparent' },
                                        ]}
                                      />
                                      {burada ? (
                                        <View style={[s.durakNoktaBurada, { backgroundColor: tema.vurgu, borderColor: tema.yuzey }]} />
                                      ) : ilk || son ? (
                                        <View style={[s.durakNoktaUc, { borderColor: renkKodu, backgroundColor: son ? renkKodu : tema.yuzey }]} />
                                      ) : (
                                        <View style={[s.durakNokta, { borderColor: renkKodu, backgroundColor: tema.yuzey }]} />
                                      )}
                                    </View>
                                    <Text style={[s.durakAd, (ilk || son || burada) && s.durakAdKalin]} numberOfLines={1}>
                                      {baslikYap(d.ad)}
                                    </Text>
                                    {burada ? (
                                      <Text style={[s.durakBurada, { color: tema.vurgu }]}>şu an buradasın</Text>
                                    ) : (
                                      <Text style={s.durakSaat}>{saat}</Text>
                                    )}
                                  </View>
                                );
                              })}
                              {sefer && (sefer.sonSefer || sefer.sonrakiSaniye != null) && (
                                <View style={[s.sonSefer, sefer.sonSefer && { backgroundColor: tema.uyariAcik }]}>
                                  <Ikon
                                    ad={sefer.sonSefer ? 'warning-outline' : 'repeat-outline'}
                                    boyut={13}
                                    renkKodu={sefer.sonSefer ? tema.uyari : tema.soluk}
                                  />
                                  <Text style={[s.sonSeferYazi, sefer.sonSefer && { color: tema.uyari, fontWeight: '700' }]}>
                                    {sefer.sonSefer
                                      ? 'Bu, elimizdeki tarifedeki son sefer'
                                      : `Sonraki sefer ${saniyedenSaat(sefer.sonrakiSaniye ?? 0)}`}
                                  </Text>
                                </View>
                              )}
                            </View>
                          )}

                          {!!hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).ayrinti && (
                            <Text style={s.hatGuzergah} numberOfLines={2}>
                              {hatEtiketi(b.route?.shortName, b.route?.mode ?? b.mode, b.route?.agency?.name).ayrinti}
                            </Text>
                          )}
                          <Text style={s.adimAlt}>{baslikYap(b.to.name)} durağında in</Text>
                          {aktifBacak === i && takip && (
                            <Text style={s.adimCanli}>
                              {takip.kalanDurak === 0 ? 'Bu durakta in' : `İneceğin durağa ${takip.kalanDurak} durak kaldı`}
                            </Text>
                          )}
                        </>
                      ) : (
                        <>
                          <Text style={s.adimBaslik}>
                            {sonYuruyus ? 'Varış noktasına yürü' : `${baslikYap(b.to.name)} durağına yürü`}
                          </Text>
                          {yolTarifleri[i].length > 0 ? (
                            <Pressable
                              onPress={() => bacagiAcKapa(i)}
                              accessibilityRole="button"
                              accessibilityState={{ expanded: acik }}
                              accessibilityLabel={`${sureYaz(b.duration)} yürüyüş, ${yolTarifleri[i].length} adım. ${
                                acik ? 'Yol tarifini gizle' : 'Yol tarifini göster'
                              }`}
                              style={s.yuruDugme}
                            >
                              <Text style={s.adimAlt}>{`${sureYaz(b.duration)} · ${mesafeYaz(b.distance)}`}</Text>
                              <Ikon ad={acik ? 'chevron-up' : 'chevron-down'} boyut={14} renkKodu={tema.soluk} />
                            </Pressable>
                          ) : (
                            <Text style={s.adimAlt}>{`${sureYaz(b.duration)} · ${mesafeYaz(b.distance)}`}</Text>
                          )}
                          {acik && (
                            <View style={s.yolTarifi}>
                              {yolTarifleri[i].map((adim, j) => (
                                <View key={j} style={s.tarifSatiri}>
                                  <Ikon ad={DONUS_SIMGELERI[adim.donus]} boyut={14} renkKodu={tema.soluk} />
                                  <Text style={s.tarifMetin}>{adim.metin}</Text>
                                  {!!adim.mesafe && <Text style={s.tarifMesafe}>{adim.mesafe}</Text>}
                                </View>
                              ))}
                            </View>
                          )}
                          {aktarma != null && (
                            <View style={[s.aktarma, aktarma.sikisik && { borderLeftColor: tema.uyari, backgroundColor: tema.uyariAcik }]}>
                              <Text style={[s.aktarmaBaslik, aktarma.sikisik && { color: tema.uyari }]}>
                                {aktarma.sikisik
                                  ? `Aktarma sıkışık: ${aktarma.dakika} dakikan var`
                                  : `Aktarma için ${aktarma.dakika} dakikan var`}
                              </Text>
                              <Text style={s.aktarmaAlt}>{`${sureYaz(b.duration)} yürüyüş bu sürenin içinde`}</Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                );
              })}
              <View style={s.adim}>
                <Text style={s.adimSaat}>{saatYaz(guzergah.end)}</Text>
                <View style={s.cizgiSutun}>
                  <View style={[s.adimNokta, s.varisNokta]} />
                </View>
                <View style={s.adimIcerik}>
                  <Text style={s.adimBaslik}>Varış{hedef ? ` · ${baslikYap(hedef)}` : ''}</Text>
                </View>
              </View>

              {(ucret.toplam > 0 || ucret.ucretsizGun) && (
                <View style={s.ucretKutusu}>
                  <View style={s.ucretUst}>
                    <Text style={s.ucretBaslik}>{ucret.minibus ? 'Ücret' : 'İstanbulkart ücreti'}</Text>
                    <Text style={s.ucretToplam}>{ucretKisa(ucret)}</Text>
                  </View>
                  {bacaklar.map((b, i) => {
                    const u = ucret.bacaklar[i];
                    if (!u) return null;
                    return (
                      <View key={`ucret-${i}`} style={s.ucretSatiri}>
                        <HatRozeti hat={b.route} kucuk />
                        <Text style={s.ucretAciklama} numberOfLines={1}>
                          {u.aciklama}
                        </Text>
                        <Text style={s.ucretTutar}>{ucretYaz(u.tutar)}</Text>
                      </View>
                    );
                  })}
                  <Text style={s.ucretNot}>{ucretNotu(ucret, ucretTuru)}</Text>
                </View>
              )}
            </View>
          </AltYaprak>
        )}
      </View>

      {takipAcik && yolTarifi ? (
        <>
          <AdimKartlari
            v={yolTarifi}
            gorunen={gorunen}
            sec={setGorunen}
            onBitir={takibiDurdur}
            onTumAdimlar={() => setTumAdimlarAcik(true)}
            onBoy={setKartBoyu}
          />
          <TumAdimlar v={yolTarifi} acik={tumAdimlarAcik} kapat={() => setTumAdimlarAcik(false)} sec={setGorunen} />
        </>
      ) : (
        <View
          style={[s.alt, { paddingBottom: kenar.bottom + 10 }]}
          onLayout={(e) => setAltCubuk(e.nativeEvent.layout.height)}
        >
          <Pressable
            style={[s.zil, kuruluHatirlatici > 0 && s.zilDolu]}
            onPress={() => setHatirlatAcik(true)}
            accessibilityRole="button"
            accessibilityLabel={kuruluHatirlatici > 0 ? `${kuruluHatirlatici} hatırlatıcı kurulu` : 'Hatırlat'}
          >
            <Ikon
              ad={kuruluHatirlatici > 0 ? 'notifications' : 'notifications-outline'}
              boyut={20}
              renkKodu={kuruluHatirlatici > 0 ? tema.vurguYazi : tema.vurgu}
            />
          </Pressable>
          <Pressable
            style={[s.baslat, takipAcik && s.bitir]}
            onPress={takipAcik ? takibiDurdur : takibiBaslat}
            onLongPress={simulasyonuBaslat}
            accessibilityRole="button"
          >
            <Ikon ad={takipAcik ? 'stop-circle' : 'navigate'} boyut={18} renkKodu={takipAcik ? tema.yuzey : tema.vurguYazi} />
            <Text style={[s.baslatYazi, { color: takipAcik ? tema.yuzey : tema.vurguYazi }]}>
              {takipAcik ? 'Yolculuğu bitir' : 'Yolculuğu başlat'}
            </Text>
          </Pressable>
        </View>
      )}

      <HatirlatmaSayfasi
        acik={hatirlatAcik}
        kapat={() => setHatirlatAcik(false)}
        kalkis={kalkisAni}
        inisler={inisler}
        grup={hatirlatmaGrubu}
        kurulu={kuruluHatirlatici}
        degisti={hatirlaticilariYenile}
      />
    </View>
  );
}

/** Otobüs biniş durağına bu kadar durak kalınca haber verilir. */
const YAKLASMA_ESIGI = 3;

/**
 * Bineceğin otobüs: "Otobüs 2 durak uzakta · ~4 dk". Dakika biniş durağından
 * kalkışa kalan süre (canlı gecikmeyle düzeltilmiş); yürümeye ne zaman başlaman
 * gerektiğini söylüyor.
 */
function OtobusKutusu({
  kalan,
  otobus,
  binis,
  renk,
  uyari,
  uyariDegistir,
}: {
  kalan: number;
  otobus: YerlesikArac;
  binis: string | null | undefined;
  renk: string;
  uyari: boolean;
  uyariDegistir: () => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const dk = binis ? Math.round((Date.parse(binis) - Date.now()) / 60_000) : null;
  const soluk = otobus.sinif === 'eski';
  // Tek satır: yolculuk adımlarının arasında yer kaplamasın.
  return (
    <View style={s.otobusKutu}>
      <View style={[s.otobusSimge, { backgroundColor: soluk ? tema.soluk : renk }]}>
        <Ikon ad="bus" boyut={11} renkKodu="#fff" />
      </View>
      <Text style={s.otobusYazi} numberOfLines={1}>
        <Text style={s.otobusBaslik}>
          {kalanYaz(kalan)}
          {dk != null && dk > 0 ? ` · ~${dk} dk` : ''}
        </Text>
        <Text style={s.otobusAlt}>
          {uyari ? ` · ${YAKLASMA_ESIGI} durak kala haber verilecek` : ` · ${yasYaz(otobus.yasSn)}`}
        </Text>
      </Text>
      <Pressable
        onPress={uyariDegistir}
        hitSlop={10}
        style={[s.otobusZil, uyari && { backgroundColor: renk, borderColor: renk }]}
        accessibilityRole="switch"
        accessibilityState={{ checked: uyari }}
        accessibilityLabel={`Otobüs ${YAKLASMA_ESIGI} durak kalınca haber ver. Uygulama açıkken çalışır.`}
      >
        <Ikon ad={uyari ? 'notifications' : 'notifications-outline'} boyut={14} renkKodu={uyari ? '#fff' : tema.soluk} />
      </Pressable>
    </View>
  );
}

/** Ücret kutusunun altındaki açıklama: tarife, tahmin payı ve gece tarifesi uyarısı. */
function ucretNotu(ucret: ReturnType<typeof yolculukUcreti>, tur: keyof typeof UCRET_ADLARI): string {
  const parcalar = [`${UCRET_ADLARI[tur]} · ${TARIFE_TARIHI} tarifesi`];
  if (ucret.ucretsizGun) {
    parcalar.push(
      ucret.kisiselKart
        ? `${ucret.ucretsizGun}: İBB hatları kişiselleştirilmiş İstanbulkart'la ücretsiz`
        : `${ucret.ucretsizGun}: ücretsiz`,
    );
  }
  if (ucret.geceTarifesi) parcalar.push('Gece tarifesi (çift ücret) uygulandı');
  if (ucret.yeniYolculuk > 0) parcalar.push('120 dakikalık aktarma süresi dolduğu için ücret yeniden başladı');
  if (ucret.minibus) {
    parcalar.push(
      tur === 'ogrenci' || tur === 'ogrenci30'
        ? 'Minibüste İstanbulkart geçmez, ücret araçta ödenir; öğrenci ücreti ilk, orta ve lise öğrencileri için'
        : 'Minibüste İstanbulkart geçmez, ücret araçta ödenir ve mesafeye göre değişir; aktarma indirimi yok',
    );
  }
  if (ucret.vapurYaklasik) parcalar.push('Vapur ücreti hatta göre değişir; tutar yaklaşıktır');
  else if (ucret.yaklasik && !ucret.minibus) parcalar.push('Mesafeli hatlarda bu kartın ücreti tam bilete oranla tahmin edildi');
  return parcalar.join(' · ');
}

/**
 * Bir yürüme bacağı iki toplu taşıma bacağının arasındaysa, aktarma için gerçekte
 * kaç dakika olduğunu verir: önceki aracın iniş saatiyle sonrakinin kalkış saati arası.
 */
function aktarmaSuresi(bacaklar: Bacak[], i: number): { dakika: number; sikisik: boolean } | null {
  const b = bacaklar[i];
  if (b.transitLeg) return null;
  const onceki = bacaklar[i - 1];
  const sonraki = bacaklar[i + 1];
  if (!onceki?.transitLeg || !sonraki?.transitLeg) return null;
  const inis = Date.parse(onceki.end.estimated?.time ?? onceki.end.scheduledTime);
  const kalkis = Date.parse(sonraki.start.estimated?.time ?? sonraki.start.scheduledTime);
  if (Number.isNaN(inis) || Number.isNaN(kalkis)) return null;
  const dakika = Math.round((kalkis - inis) / 60000);
  if (dakika <= 0) return null;
  const yuruyusDakika = Math.round((b.duration ?? 0) / 60);
  return { dakika, sikisik: dakika - yuruyusDakika <= 2 };
}

const stiller = (t: Tema) =>
  StyleSheet.create({
  kok: { flex: 1, backgroundColor: t.zemin },
  bos: { color: t.soluk, padding: 20, textAlign: 'center' },
  geri: { position: 'absolute', left: 14 },
  sekmeKonumu: { position: 'absolute', left: 64, right: 12, alignItems: 'flex-start' },
  yuvarlak: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: t.yuzey,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: t.koyu ? 0.5 : 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  bildirim: {
    position: 'absolute',
    left: 64,
    right: 10,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: t.yuzey,
    borderRadius: 18,
    padding: 11,
    shadowColor: '#000',
    shadowOpacity: t.koyu ? 0.6 : 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  bildirimIkon: { width: 36, height: 36, borderRadius: 9, backgroundColor: t.vurgu, alignItems: 'center', justifyContent: 'center' },
  bildirimBaslik: { fontSize: 14, fontWeight: '700', color: t.yazi },
  bildirimMetin: { fontSize: 13, color: t.yazi, marginTop: 1 },
  ozet: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.cizgi,
  },
  sure: { fontSize: 24, fontWeight: '800', color: t.yazi, letterSpacing: -0.5 },
  ozetAlt: { fontSize: 12.5, color: t.soluk, fontWeight: '600' },
  ozetSaat: { fontSize: 14, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
  adim: { flexDirection: 'row', gap: 8, borderRadius: 10 },
  adimAktif: { backgroundColor: t.vurguAcik },
  adimSaatSutun: { width: 42, gap: 1 },
  adimSapma: { fontSize: 10.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
  adimSaat: { fontSize: 12.5, fontWeight: '700', color: t.yazi, paddingTop: 1, fontVariant: ['tabular-nums'] },
  cizgiSutun: { width: 16, alignItems: 'center' },
  adimNokta: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, backgroundColor: t.yuzey, marginTop: 2, zIndex: 1 },
  varisNokta: { borderColor: t.yazi, backgroundColor: t.yazi, borderRadius: 3 },
  adimCizgi: { flex: 1, width: 4, borderRadius: 2, marginTop: -2, marginBottom: -4 },
  adimCizgiYuru: { width: 0, borderLeftWidth: 3, borderStyle: 'dotted', borderColor: t.yurume },
  adimIcerik: { flex: 1, paddingBottom: 14, gap: 4 },
  adimBaslik: { fontSize: 14, fontWeight: '700', color: t.yazi },
  adimAlt: { fontSize: 12.5, color: t.soluk, flexShrink: 1, flexGrow: 1 },
  esdegerNot: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 6 },
  esdegerYazi: { flex: 1, fontSize: 12.5, lineHeight: 17, color: t.yazi },
  adimCanli: { fontSize: 12.5, fontWeight: '700', color: t.vurgu },
  otobusKutu: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, paddingLeft: 2 },
  otobusSimge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  otobusYazi: { flex: 1, fontSize: 12.5 },
  otobusBaslik: { fontWeight: '700', color: t.yazi },
  otobusAlt: { color: t.soluk },
  otobusZil: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
  },

  bacakDugme: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
    backgroundColor: t.yuzeyIkincil,
  },
  durakPaneli: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
    borderColor: t.cizgi,
    backgroundColor: t.yuzeyIkincil,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    paddingHorizontal: 10,
    paddingBottom: 8,
    marginBottom: 4,
  },
  siklik: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 7, paddingBottom: 4 },
  siklikYazi: { fontSize: 12, fontWeight: '700' },
  durakSatiri: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 28 },
  durakCizgi: { width: 14, height: '100%', alignItems: 'center', justifyContent: 'center' },
  durakCizgiUst: { position: 'absolute', top: 0, height: '50%', width: 3 },
  durakCizgiAlt: { position: 'absolute', bottom: 0, height: '50%', width: 3 },
  durakNokta: { width: 9, height: 9, borderRadius: 5, borderWidth: 2 },
  durakNoktaUc: { width: 12, height: 12, borderRadius: 6, borderWidth: 3 },
  durakNoktaBurada: { width: 16, height: 16, borderRadius: 8, borderWidth: 3 },
  durakAd: { flex: 1, fontSize: 13, color: t.soluk },
  durakAdKalin: { color: t.yazi, fontWeight: '700' },
  durakSaat: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
  durakBurada: { fontSize: 11.5, fontWeight: '700' },
  sonSefer: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 8 },
  sonSeferYazi: { fontSize: 11.5, color: t.soluk, flexShrink: 1 },

  aktarma: {
    marginTop: 4,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderLeftColor: t.vurgu,
    borderTopRightRadius: 9,
    borderBottomRightRadius: 9,
    backgroundColor: t.vurguAcik,
  },
  aktarmaBaslik: { fontSize: 12.5, fontWeight: '700', color: t.vurgu },
  aktarmaAlt: { fontSize: 11.5, color: t.soluk, marginTop: 1 },

  alt: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 16,
    backgroundColor: t.yuzey,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.cizgi,
  },
  baslat: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    backgroundColor: t.vurgu,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bitir: { backgroundColor: t.yazi },
  ucretKutusu: {
    marginHorizontal: 14,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: t.yuzeyIkincil,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
    gap: 8,
  },
  ucretUst: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  ucretBaslik: { fontSize: 14.5, fontWeight: '700', color: t.yazi },
  ucretToplam: { fontSize: 17, fontWeight: '800', color: t.vurgu, fontVariant: ['tabular-nums'] },
  ucretSatiri: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  ucretAciklama: { flex: 1, fontSize: 12.5, color: t.soluk },
  ucretTutar: { fontSize: 13.5, fontWeight: '600', color: t.yazi, fontVariant: ['tabular-nums'] },
  ucretNot: { fontSize: 11.5, color: t.soluk, lineHeight: 17 },
  yuruDugme: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  hatGuzergah: { fontSize: 12, color: t.soluk, lineHeight: 17, marginTop: 6 },
  yolTarifi: {
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: t.cizgi,
    gap: 7,
  },
  tarifSatiri: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tarifMetin: { flex: 1, fontSize: 12.5, color: t.yazi, lineHeight: 17 },
  tarifMesafe: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
  zil: {
    width: 50,
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.vurguAcik,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.cizgi,
  },
  zilDolu: { backgroundColor: t.vurgu, borderColor: t.vurgu },
  baslatYazi: { fontWeight: '700', fontSize: 16 },
});
