// Canlı yol tarifi: "Yolculuğu başlat"tan sonraki adım adım görünüm.
//
// Üstte adım sekmeleri (🚶 › 89T › 🚶 › 28T › 🚶), altta sağa-sola kaydırılan adım
// kartları. Her kart yalnız o anda gereken bilgiyi gösteriyor: yürürken mesafe ve
// sıradaki binişe yetişip yetişmediğin, beklerken otobüsün kaç dakika/durak uzakta
// olduğu, otobüsteyken nerede ineceğin. Hangi adımda olunduğunu konum belirliyor
// (src/lib/yolculuk.ts); kaydırarak başka adımlara bakılabiliyor.
//
// Tasarım: C:\otp\Claude outputs\canli-yol-tarifi-maket.html

import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Pressable } from '@/components/dokun';
import { ModalSayfa } from '@/components/modal-sayfa';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canliRenk, DONUS_SIMGELERI, HatRozeti, Ikon, NabizNoktasi, useStiller, YaklasmaSeridi } from '@/components/ulasim';
import type { YerlesikArac } from '@/lib/arac-konum';
import { kalanYaz, yasYaz } from '@/lib/arac-konum';
import { bacakCanli } from '@/lib/canli';
import { mesafeMetre, type Nokta } from '@/lib/cografya';
import type { Bacak } from '@/lib/otp';
import { konus, sus } from '@/lib/konusma';
import type { SeferBilgisi } from '@/lib/sefer';
import type { SesCinsiyeti } from '@/lib/ses-secimi';
import { sesliDuyurular, type SesGirdisi } from '@/lib/sesli-tarif';
import { baslikYap, hatRengi, useTema, type Tema } from '@/lib/tema';
import {
  aktarmaPayi,
  binmeIfadesi,
  durakSirasi,
  durakSozcugu,
  DURAKTA_PAYI,
  kalanSureYaz,
  SAPMA_M,
  SIMDI_M,
  yolaCikisAni,
  yuruyusKonumu,
  type Adim,
  type YolculukDurumu,
} from '@/lib/yolculuk';
import type { YuruyusAdimi } from '@/lib/yuruyus';
import { durakSaatleri, type BeklemeSecenegi } from '@/lib/bekleme';
import { durakVarisMetni, istanbulSaatiYaz, mesafeYaz, saatEkli, saatYaz, saniyedenSaat, sureYaz } from '@/lib/zaman';

export type YolTarifiVerisi = {
  bacaklar: Bacak[];
  /** Araç bacaklarının durakları (biniş → iniş); yürüyüşte boş. */
  duraklar: { ad: string; lat: number; lon: number }[][];
  adimlar: Adim[];
  durum: YolculukDurumu;
  /** Yürüme bacaklarının tarif satırları; araçta boş. */
  tarifler: YuruyusAdimi[][];
  /** Telefonun son konumu; henüz gelmediyse null. */
  konum: Nokta | null;
  /** Bacakların çizgileri; yürürken "sıradaki dönüşe kaç metre" bunun üstünden. */
  cizgiler: Nokta[][];
  binisOtobusleri: Record<number, { otobus: YerlesikArac; kalan: number }>;
  seferler: Record<number, SeferBilgisi>;
  yaklasmaUyarisi: Record<number, boolean>;
  uyariDegistir: (bacak: number) => void;
  hedef?: string;
  /** Saat yazıları için; üst bileşen yarım dakikada bir tazeliyor. */
  simdi: number;
  /** Bacak sırasına göre aynı duraklar arasında giden öbür hatlar ("141M"). */
  esdegerHatlar?: Record<number, string[]>;
  /** "Bindim": araç konumdan anlaşılmadan geldiyse (yeraltı, kötü GPS) elle binildi; birden çok hat varsa hangisi. */
  bindim?: (kisaAd?: string) => void;
  /** Araçtayken bindiği hattı düzeltir ("Değiştir"). */
  hatSec?: (bacak: number, kisaAd: string) => void;
  /** Bacak sırasına göre bekleme kartının satırları: aynı yoldaki her hat, sıradaki kalkışlar. */
  secenekler?: Record<number, BeklemeSecenegi[]>;
  /** Bacak sırasına göre durakların biniş ile iniş arasındaki oranı (durak saatleri için). */
  oranlar?: Record<number, number[]>;
  /** Varış saatini paylaş. */
  paylas?: () => void;
};

const iso = (b: Bacak, uc: 'start' | 'end') => b[uc].estimated?.time ?? b[uc].scheduledTime;

/**
 * Bir bacağın bittiği yerin adı: araç bacağında kendi türü, yürüyüşte sonunda
 * binilecek aracınki (metroya yürünüyorsa "istasyonuna", vapura "iskelesine").
 */
function bitisSozcugu(bacaklar: Bacak[], i: number) {
  const b = bacaklar[i];
  if (b?.transitLeg) return durakSozcugu(b.route?.mode ?? b.mode);
  const sonraki = bacaklar[i + 1];
  return durakSozcugu(sonraki?.transitLeg ? (sonraki.route?.mode ?? sonraki.mode) : null);
}
const an = (b: Bacak, uc: 'start' | 'end') => Date.parse(iso(b, uc) ?? '');

/** Sekmede ve listede adımın kısa adı. */
function adimEtiketi(v: YolTarifiVerisi, a: Adim): string {
  if (a.tur === 'yuru') return 'Yürü';
  return v.bacaklar[a.bacak]?.route?.shortName ?? 'Araç';
}

// ---------------------------------------------------------------- sekmeler

/** Üstteki adım sekmeleri: biten soluk ve işaretli, bakılan vurgulu. */
export function AdimSekmeleri({ v, gorunen, sec }: { v: YolTarifiVerisi; gorunen: number; sec: (i: number) => void }) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.sekmeler} contentContainerStyle={s.sekmeIc}>
      {v.adimlar.map((a, i) => {
        const bitti = i < v.durum.adim || (v.durum.faz === 'vardi' && i === v.durum.adim);
        const bakilan = i === gorunen;
        const b = v.bacaklar[a.bacak];
        const renk = a.tur === 'arac' ? hatRengi(b?.route, tema) : tema.yazi;
        return (
          <View key={i} style={s.sekmeSarici}>
            {i > 0 && <Text style={s.ayrac}>›</Text>}
            <Pressable
              onPress={() => sec(i)}
              style={[s.sekme, bakilan && { borderColor: renk, backgroundColor: tema.vurguAcik }, bitti && s.sekmeBitti]}
              accessibilityRole="tab"
              accessibilityState={{ selected: bakilan }}
              accessibilityLabel={`Adım ${i + 1}: ${adimEtiketi(v, a)}${bitti ? ', tamamlandı' : ''}`}
              hitSlop={4}
            >
              {a.tur === 'yuru' ? (
                <Ikon ad="walk" boyut={14} renkKodu={bakilan ? tema.yazi : tema.soluk} />
              ) : (
                <Text style={[s.sekmeYazi, { color: renk }]}>{b?.route?.shortName ?? '•'}</Text>
              )}
              {bitti && <Ikon ad="checkmark" boyut={11} renkKodu={tema.soluk} />}
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

/**
 * Sekmelerin altındaki canlı durum satırı: telefonun konumuna göre şu an nerede
 * olunduğu. Hangi karta bakılırsa bakılsın gerçek durumu söyler.
 */
export function KonumSeridi({
  v,
  ses,
}: {
  v: YolTarifiVerisi;
  /** Sesli tarif düğmesi (şeridin sağında). */
  ses?: { acik: boolean; degistir: () => void };
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const { durum, adimlar, bacaklar, konum } = v;
  const a = adimlar[durum.adim];
  if (!a) return null;
  const b = bacaklar[a.bacak];
  let ikon: 'navigate' | 'walk' | 'bus' | 'flag' | 'time-outline' = 'navigate';
  let ana = '';
  let yan = '';

  if (durum.faz === 'vardi') {
    ikon = 'flag';
    ana = 'Vardın';
    yan = v.hedef ? baslikYap(v.hedef) : '';
  } else if (durum.faz === 'icinde') {
    // Araçta konum gelmese de (tünel) ilerleme saatten sürüyor; "konum bekleniyor" denmez.
    const liste = v.duraklar[a.bacak];
    const son = liste.length - 1;
    const kalan = durum.kalanDurak ?? son;
    const ilerleme = durum.ilerleme ?? son - kalan;
    const sira = durakSirasi(ilerleme, son);
    const arada = sira < son && ilerleme - sira >= DURAKTA_PAYI;
    ikon = 'bus';
    if (kalan === 0) {
      ana = `Şimdi in: ${baslikYap(liste[son]?.ad)}`;
    } else if (arada) {
      // İki durak arasında: gidilen durak.
      ana = `Sıradaki: ${baslikYap(liste[sira + 1]?.ad)}`;
      yan = sira + 1 === son ? 'orada in' : `${kalan} durak kaldı`;
    } else {
      ana = `Şu an: ${baslikYap(liste[sira]?.ad)}`;
      yan = `sonraki: ${baslikYap(liste[sira + 1]?.ad)}`;
    }
  } else if (!konum) {
    ikon = 'time-outline';
    ana = 'Konum bekleniyor…';
  } else {
    // Yürürken ve beklerken: gidilen noktaya kalan mesafe.
    const hedefNokta =
      durum.faz === 'bekle'
        ? { latitude: b.from.lat, longitude: b.from.lon }
        : { latitude: b.to.lat, longitude: b.to.lon };
    const m = Math.round(mesafeMetre(konum, hedefNokta));
    const ad = durum.faz === 'bekle' ? baslikYap(b.from.name) : baslikYap(b.to.name);
    const varis = durum.faz === 'yuru' && (a.rol === 'varis' || a.rol === 'tek');
    const sozcuk = bitisSozcugu(bacaklar, a.bacak);
    ikon = durum.faz === 'bekle' ? 'bus' : 'walk';
    if (durum.faz === 'bekle' && m <= 60) {
      ana = `${ad} ${sozcuk.desin}`;
      // "M3 bekleniyor" yerine ne zaman: "M3 22:54'te".
      const kalkis = Date.parse(b.start.estimated?.time ?? b.start.scheduledTime ?? '');
      yan = `${b.route?.shortName ?? ''} ${Number.isNaN(kalkis) ? 'bekleniyor' : saatEkli(kalkis / 1000)}`.trim();
    } else {
      ana = varis ? `Varış noktasına ${mesafeYaz(m)}` : `${ad} ${sozcuk.e} ${mesafeYaz(m)}`;
    }
  }

  return (
    <View style={s.konumSeridi}>
      <View
        style={s.konumMetin}
        accessibilityLiveRegion="polite"
        accessible
        accessibilityLabel={[ana, yan].filter(Boolean).join(', ')}
      >
        <Ikon ad={ikon} boyut={15} renkKodu={tema.vurgu} />
        <Text style={s.konumAna} numberOfLines={1}>
          {ana}
          {!!yan && <Text style={s.konumYan}>{`  ·  ${yan}`}</Text>}
        </Text>
      </View>
      {ses && (
        <Pressable
          onPress={ses.degistir}
          hitSlop={10}
          style={s.sesDugme}
          accessibilityRole="switch"
          accessibilityState={{ checked: ses.acik }}
          accessibilityLabel="Sesli yol tarifi"
        >
          <Ikon ad={ses.acik ? 'volume-high' : 'volume-mute'} boyut={17} renkKodu={ses.acik ? tema.vurgu : tema.soluk} />
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------- sesli tarif

/**
 * Sesli yol tarifi: yolculuk durumu ya da konum değiştikçe söylenecek cümleyi bulur
 * (src/lib/sesli-tarif.ts) ve Türkçe okur. Dönüş "şimdi"si, inilecek durak gibi
 * öncelikli cümleler o an okunanı keser. Kapatılınca ya da ekrandan çıkılınca susar.
 */
export function useSesliTarif(v: YolTarifiVerisi | null, acik: boolean, cinsiyet: SesCinsiyeti) {
  const soylenen = useRef(new Set<string>());

  useEffect(() => () => sus(), []);
  const takipte = !!v;
  useEffect(() => {
    if (!acik || !takipte) sus();
    // Yolculuk bitince yeniden başlarsa en baştan söylesin.
    if (!takipte) soylenen.current.clear();
  }, [acik, takipte]);

  const durum = v?.durum;
  const konum = v?.konum;
  useEffect(() => {
    if (!v || !acik) return;
    const a = v.adimlar[v.durum.adim];
    const b = a ? v.bacaklar[a.bacak] : undefined;
    if (!a || !b) return;
    const g: SesGirdisi = { adim: v.durum.adim, tur: a.tur, faz: v.durum.faz, rol: a.rol };
    if (a.tur === 'yuru') {
      const tarif = v.tarifler[a.bacak] ?? [];
      g.tarif = tarif;
      g.yer = v.konum ? yuruyusKonumu(tarif, v.cizgiler[a.bacak] ?? [], v.konum) : null;
      g.hedefAdi = b.to.stop ? `${baslikYap(b.to.name)} ${bitisSozcugu(v.bacaklar, a.bacak).ad}` : 'varış noktası';
      g.toplamMetre = b.distance;
      g.toplamDakika = b.duration != null ? b.duration / 60 : null;
    } else {
      g.hat = b.route?.shortName ?? '';
      g.binme = binmeIfadesi(b.route?.mode ?? b.mode, b.route?.agency?.name);
      g.inisAdi = baslikYap(b.to.name);
      g.kalanDurak = v.durum.kalanDurak;
      g.durakta = v.durum.durakta;
      const kalkis = an(b, 'start');
      g.kalkisaDakika = Number.isFinite(kalkis) ? (kalkis - Date.now()) / 60_000 : null;
    }
    const { soyle, unut } = sesliDuyurular(g, soylenen.current);
    for (const anahtar of unut) soylenen.current.delete(anahtar);
    if (!soyle.length) return;
    for (const d of soyle) soylenen.current.add(d.anahtar);
    konus(
      soyle.map((d) => d.metin).join(' '),
      cinsiyet,
      soyle.some((d) => d.oncelikli),
    );
  }, [durum, konum, acik]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- kartlar

/**
 * Alttaki adım kartları. Sağa-sola kaydırılıyor; bakılan adım `gorunen`. Kart
 * alanının yüksekliği `onBoy` ile bildiriliyor (harita o kadar boşluk bıraksın).
 */
export function AdimKartlari({
  v,
  gorunen,
  sec,
  onBitir,
  onTumAdimlar,
  onBoy,
}: {
  v: YolTarifiVerisi;
  gorunen: number;
  sec: (i: number) => void;
  onBitir: () => void;
  onTumAdimlar: () => void;
  onBoy: (boy: number) => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const kenar = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const liste = useRef<ScrollView>(null);
  const kaydiriliyor = useRef(false);
  // Kart sayfalarının yüksekliği: içerik daha uzunsa (bütün duraklar, bütün tarif) kayar.
  const sayfaBoyu = Math.max(250, Math.round(height * 0.4));

  // Bakılan adım dışarıdan değişince (sekme, kendiliğinden geçiş) kart oraya kaysın.
  useEffect(() => {
    if (kaydiriliyor.current) return;
    liste.current?.scrollTo({ x: gorunen * width, animated: true });
  }, [gorunen, width]);

  const kaydirmaBitti = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    kaydiriliyor.current = false;
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    if (i !== gorunen) sec(i);
  };

  const simdiki = v.durum.adim;
  const gorunenAdim = v.adimlar[gorunen];
  const zilBacagi = gorunenAdim?.tur === 'arac' && v.binisOtobusleri[gorunenAdim.bacak] ? gorunenAdim.bacak : -1;
  const zilAcik = zilBacagi >= 0 && !!v.yaklasmaUyarisi[zilBacagi];
  const vardi = v.durum.faz === 'vardi';

  return (
    <View style={[s.kart, { paddingBottom: kenar.bottom + 10 }]} onLayout={(e) => onBoy(e.nativeEvent.layout.height)}>
      {gorunen !== simdiki && (
        <Pressable style={s.donDugmesi} onPress={() => sec(simdiki)} accessibilityRole="button">
          <Ikon ad="locate" boyut={14} renkKodu={tema.vurguYazi} />
          <Text style={s.donYazi}>Şu anki adıma dön</Text>
        </Pressable>
      )}
      <View style={s.noktalar}>
        {v.adimlar.map((_, i) => (
          <View key={i} style={[s.nokta, i === gorunen && s.noktaAktif]} />
        ))}
      </View>
      <ScrollView
        ref={liste}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScrollBeginDrag={() => (kaydiriliyor.current = true)}
        onMomentumScrollEnd={kaydirmaBitti}
        contentOffset={{ x: gorunen * width, y: 0 }}
      >
        {v.adimlar.map((a, i) => (
          <View key={i} style={{ width, paddingHorizontal: 16 }}>
            <AdimKarti v={v} sira={i} boy={sayfaBoyu} />
          </View>
        ))}
      </ScrollView>
      <View style={s.eylemler}>
        <Pressable
          style={[s.dugme, vardi ? s.dugmeDolu : s.dugmeBitir]}
          onPress={onBitir}
          accessibilityRole="button"
        >
          <Text style={[s.dugmeYazi, { color: vardi ? tema.vurguYazi : tema.hata }]}>{vardi ? 'Tamam' : 'Bitir'}</Text>
        </Pressable>
        <Pressable style={[s.dugme, { flex: 1 }]} onPress={onTumAdimlar} accessibilityRole="button">
          <Ikon ad="list" boyut={16} renkKodu={tema.yazi} />
          <Text style={s.dugmeYazi}>Tüm adımlar</Text>
        </Pressable>
        {!!v.paylas && (
          <Pressable
            style={[s.dugme, s.zil]}
            onPress={v.paylas}
            accessibilityRole="button"
            accessibilityLabel="Varış saatini paylaş"
          >
            <Ikon ad="share-outline" boyut={17} renkKodu={tema.yazi} />
          </Pressable>
        )}
        {zilBacagi >= 0 && (
          <Pressable
            style={[s.dugme, s.zil, zilAcik && { backgroundColor: hatRengi(v.bacaklar[zilBacagi]?.route, tema) }]}
            onPress={() => v.uyariDegistir(zilBacagi)}
            accessibilityRole="switch"
            accessibilityState={{ checked: zilAcik }}
            accessibilityLabel="Otobüs 3 durak kalınca haber ver"
          >
            <Ikon ad={zilAcik ? 'notifications' : 'notifications-outline'} boyut={17} renkKodu={zilAcik ? '#fff' : tema.soluk} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** Tek bir adımın kartı. İçerik adımın türüne ve (şimdiki adımsa) evresine göre; uzunsa kayar. */
function AdimKarti({ v, sira, boy }: { v: YolTarifiVerisi; sira: number; boy: number }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const kaydirma = useRef<ScrollView>(null);
  const a = v.adimlar[sira];
  const b = v.bacaklar[a.bacak];
  const simdiki = sira === v.durum.adim;
  const bitti = sira < v.durum.adim;
  const ust = `ADIM ${sira + 1} / ${v.adimlar.length}`;

  // Durak çizelgesinde / tarif listesinde şimdiki satır görünür kalsın.
  const [odakY, setOdakY] = useState<number | null>(null);
  useEffect(() => {
    if (odakY != null) kaydirma.current?.scrollTo({ y: Math.max(0, odakY - 70), animated: true });
  }, [odakY]);

  const sar = (icerik: ReactNode) => (
    <ScrollView
      ref={kaydirma}
      style={{ height: boy }}
      contentContainerStyle={s.icerik}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      {icerik}
    </ScrollView>
  );

  if (simdiki && v.durum.faz === 'vardi') {
    return sar(
      <>
        <Text style={s.adimNo}>{`${ust} · VARIŞ`}</Text>
        <Text style={s.komut}>Vardın</Text>
        <Text style={s.detay}>
          {v.hedef ? `${baslikYap(v.hedef)} · ` : ''}
          {saatYaz(iso(v.bacaklar[v.bacaklar.length - 1], 'end'))}
        </Text>
        <View style={[s.kutu, s.kutuIyi]}>
          <Ikon ad="checkmark-circle" boyut={17} renkKodu={tema.vurgu} />
          <Text style={s.kutuYazi}>Yolculuk tamamlandı. İyi günler!</Text>
        </View>
      </>,
    );
  }

  const etiketler = <Text style={s.adimNo}>{`${ust} · ${adimTuruYazisi(v, sira)}${bitti ? ' · TAMAMLANDI' : ''}`}</Text>;

  // ---- yürüme
  if (a.tur === 'yuru') {
    const sonrakiAdim = v.adimlar.slice(sira + 1).find((x) => x.tur === 'arac');
    const sonraki = sonrakiAdim ? v.bacaklar[sonrakiAdim.bacak] : null;
    const hedefDurak = `${baslikYap(b.to.name)} ${bitisSozcugu(v.bacaklar, a.bacak).e}`;
    const komut =
      a.rol === 'aktarma' && sonraki
        ? `${sonraki.route?.shortName ?? ''} için ${hedefDurak} yürü`
        : a.rol === 'varis' || a.rol === 'tek'
          ? 'Varış noktasına yürü'
          : `${hedefDurak} yürü`;
    return sar(
      <>
        {etiketler}
        <Text style={s.komut}>{komut}</Text>
        <Text style={s.detay}>
          <Text style={s.kalin}>{`${mesafeYaz(b.distance)} · ${sureYaz(b.duration)}`}</Text>
          {(a.rol === 'varis' || a.rol === 'tek') && v.hedef ? ` · ${baslikYap(v.hedef)}` : ''}
        </Text>
        {sonraki && sonrakiAdim && (
          <SonrakiBinisKutusu v={v} yuruyus={a.bacak} binis={sonrakiAdim.bacak} simdiki={simdiki} aktarma={a.rol === 'aktarma'} />
        )}
        <TarifKutusu v={v} bacak={a.bacak} simdiki={simdiki} odak={setOdakY} />
      </>,
    );
  }

  // ---- araç
  const renk = hatRengi(b.route, tema);
  const liste = v.duraklar[a.bacak];
  const icinde = simdiki && v.durum.faz === 'icinde';
  const kalan = icinde ? (v.durum.kalanDurak ?? liste.length - 1) : null;
  // Çizelgede "şu an": otobüsteyken bulunulan durak, beklerken biniş durağına 60 m'den yakınsa orası.
  const duraktaBekliyor =
    simdiki &&
    v.durum.faz === 'bekle' &&
    !!v.konum &&
    mesafeMetre(v.konum, { latitude: b.from.lat, longitude: b.from.lon }) <= 60;
  // Mavi noktanın yeri: araçta duraklar arası kesirli (kayarak ilerler), beklerken biniş durağı.
  const ilerleme =
    kalan != null ? (v.durum.ilerleme ?? liste.length - 1 - kalan) : duraktaBekliyor ? 0 : null;

  // Her durağın tahmini saati: oranlar seferin tarifesinden (yoksa mesafeden); araçtayken
  // geride kalınırsa sıradaki duraklar ve iniş kayar.
  const oranlar = v.oranlar?.[a.bacak];
  const saatler =
    oranlar && oranlar.length === liste.length
      ? durakSaatleri(oranlar, an(b, 'start'), an(b, 'end'), icinde ? ilerleme : null, v.simdi)
      : null;
  const inisAni = saatler ? saatler[saatler.length - 1] : an(b, 'end');
  const inisSaati = Number.isNaN(inisAni) ? saatYaz(iso(b, 'end')) : istanbulSaatiYaz(Math.round(inisAni / 1000));
  const secenekler = v.secenekler?.[a.bacak] ?? [];
  const obur = v.esdegerHatlar?.[a.bacak] ?? [];

  const cizelge = (
    <DurakCizelgesi
      duraklar={liste}
      renk={renk}
      ilerleme={ilerleme}
      bitti={bitti}
      beklerken={duraktaBekliyor}
      binisSaati={saatYaz(iso(b, 'start'))}
      inisSaati={inisSaati}
      saatler={saatler}
      odak={setOdakY}
    />
  );

  if (icinde && kalan != null) {
    const inisDk = Math.max(0, Math.round((inisAni - v.simdi) / 60_000));
    return sar(
      <>
        {etiketler}
        <Text style={s.komut}>
          {kalan === 0
            ? `Şimdi in: ${baslikYap(b.to.name)}`
            : `${baslikYap(b.to.name)} ${durakSozcugu(b.route?.mode ?? b.mode).de} in`}
        </Text>
        {v.durum.binisAn != null && (
          <Text style={s.detay}>{`${baslikYap(b.from.name)} ${durakSozcugu(b.route?.mode ?? b.mode).de} ${saatEkli(Math.round(v.durum.binisAn / 1000))} bindin`}</Text>
        )}
        <View style={s.buyukSatir}>
          <Text style={s.sayac}>
            {kalan === 0 ? '' : kalan}
            <Text style={s.sayacBirim}>{kalan === 0 ? 'Bu durakta in' : ' durak kaldı'}</Text>
          </Text>
          <Text style={[s.detay, { textAlign: 'right' }]}>
            <Text style={s.kalin}>{`~${inisDk} dk`}</Text>
            {`\niniş ${inisSaati}`}
          </Text>
        </View>
        {/* Aynı yoldan birden çok hat varsa hangisinde olduğu; yanlışsa düzeltilir. */}
        {obur.length > 0 && !!v.hatSec && <HatSecimi v={v} bacak={a.bacak} obur={obur} />}
        {cizelge}
      </>,
    );
  }

  const kalkis = an(b, 'start');
  const dk = Math.max(0, Math.round((kalkis - v.simdi) / 60_000));
  // Aynı yolu giden birden çok hat: Moovit'teki gibi her biri ayrı satırda, ilk gelene binilir.
  if (secenekler.length >= 2 && !bitti && !icinde) {
    const bindimGorunur =
      !!v.bindim &&
      ((v.durum.adim === sira && v.durum.faz === 'bekle') || (v.durum.adim === sira - 1 && v.durum.faz === 'yuru'));
    return sar(
      <>
        {etiketler}
        <Text style={s.komut}>{`Bu ${aracCogulu(b)} ilk gelene bin`}</Text>
        <Text style={s.detay} numberOfLines={2}>
          {[
            baslikYap(b.from.name),
            b.headsign ? `${baslikYap(b.headsign)} yönü` : '',
            `${Math.max(liste.length - 1, 1)} durak`,
            sureYaz(b.duration),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <View style={s.secenekler}>
          {secenekler.map((x, k) => (
            <SecenekSatiri key={x.kisaAd} v={v} bacak={a.bacak} secenek={x} ilk={k === 0} />
          ))}
        </View>
        {bindimGorunur && (
          <>
            <Text style={s.secenekBaslik}>Hangisi geldi? Bindiğine dokun:</Text>
            <View style={s.secimSatiri}>
              {secenekler.map((x) => (
                <Pressable
                  key={x.kisaAd}
                  style={s.secimDugmesi}
                  onPress={() => {
                    Haptics.selectionAsync().catch(() => {});
                    v.bindim?.(x.kisaAd);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${x.kisaAd} geldi, bindim`}
                >
                  <HatRozeti hat={x.hat} kucuk />
                  <Text style={s.secimYazi}>bindim</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {cizelge}
      </>,
    );
  }
  // Düğme bu araç sıradaysa: beklerken ya da hemen önceki yürüyüşteyken (varış anlaşılmadıysa).
  const bindimGoster =
    !!v.bindim &&
    ((v.durum.adim === sira && v.durum.faz === 'bekle') || (v.durum.adim === sira - 1 && v.durum.faz === 'yuru'));
  // Bir saatten uzaksa dakika yerine saat: "590 dk" okunmuyor.
  const uzak = dk >= 60;
  const canli = bacakCanli(b.start.scheduledTime, b.start.estimated?.time);
  const otobus = v.binisOtobusleri[a.bacak];
  // Sayacın altı: saat ve kaynağı, kaçırılırsa sonraki sefer. Canlıysa durağa varış saati
  // (yakındaki duraklardaki gibi), değilse tarife saati.
  const sonrakiSefer = v.seferler[a.bacak]?.sonrakiSaniye;
  // Sonraki iki sefer dakika olarak ("sonra 5, 17 dk"); liste yoksa kaçırılırsa sonrakinin saati.
  const sonrakiDk = (secenekler[0]?.kalkislar ?? [])
    .filter((k) => k.an > kalkis + 30_000)
    .slice(0, 2)
    .map((k) => Math.max(0, Math.round((k.an - v.simdi) / 60_000)));
  const kalkisYazisi = [
    canli ? `Canlı · ${durakVarisMetni(kalkis / 1000)}` : uzak ? `${kalanSureYaz(dk)} sonra` : saatYaz(iso(b, 'start')),
    canli ? '' : 'tarifeye göre',
    sonrakiDk.length && !uzak
      ? `sonra ${sonrakiDk.join(', ')} dk`
      : sonrakiSefer != null
        ? `kaçırırsan sonraki ${saniyedenSaat(sonrakiSefer)}`
        : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return sar(
    <>
      {etiketler}
      <View style={s.komutSatir}>
        <HatRozeti hat={b.route} ekHatlar={v.esdegerHatlar?.[a.bacak]} />
        <Text style={[s.komut, { flex: 1 }]} numberOfLines={2}>
          {binmeIfadesi(b.route?.mode ?? b.mode, b.route?.agency?.name)}
        </Text>
      </View>
      {!!v.esdegerHatlar?.[a.bacak] && (
        <Text style={s.detay} numberOfLines={2}>
          {`${v.esdegerHatlar[a.bacak].join(', ')} ile de gidebilirsin · hangisi önce gelirse ona bin`}
        </Text>
      )}
      {!!b.headsign && (
        <Text style={s.detay} numberOfLines={1}>
          {`${baslikYap(b.headsign)} yönü · ${Math.max(liste.length - 1, 1)} durak · ${sureYaz(b.duration)}`}
        </Text>
      )}
      <View style={s.buyukSatir}>
        <View>
          {/* Sayının ne olduğu yanında yazıyor: "Kalkışa 9 dk". Bir saatten uzaksa saat. */}
          <View
            style={s.sayacSatir}
            accessible
            accessibilityLabel={uzak ? `Kalkış ${saatYaz(iso(b, 'start'))}` : dk === 0 ? 'Kalkıyor' : `Kalkışa ${dk} dakika`}
          >
            {canli && <NabizNoktasi renk={tema.vurgu} />}
            <Text style={s.sayac}>
              <Text style={s.sayacBirim}>{uzak ? 'Kalkış ' : dk === 0 ? '' : 'Kalkışa '}</Text>
              {uzak ? saatYaz(iso(b, 'start')) : dk === 0 ? 'Kalkıyor' : dk}
              <Text style={s.sayacBirim}>{uzak || dk === 0 ? '' : ' dk'}</Text>
            </Text>
          </View>
          <Text style={[s.detay, canli && { color: tema.vurgu, fontWeight: '600' }]}>{kalkisYazisi}</Text>
        </View>
        {otobus && <YaklasmaSeridi kalan={otobus.kalan} renk={renk} soluk={otobus.otobus.sinif === 'eski'} />}
      </View>
      {otobus && (
        <Text style={s.detay}>
          <Text style={s.kalin}>{`Otobüs ${kalanYaz(otobus.kalan)}`}</Text>
          {` · konum ${yasYaz(otobus.otobus.yasSn)}`}
        </Text>
      )}
      {/* Biniş konumdan anlaşılıyor; yeraltında ya da GPS zayıfken anlaşılamazsa elle. */}
      {bindimGoster && (
        <Pressable
          style={[s.dugme, s.dugmeDolu, { marginTop: 10 }]}
          onPress={() => {
            Haptics.selectionAsync().catch(() => {});
            v.bindim?.();
          }}
          accessibilityRole="button"
          accessibilityHint="Araç geldiyse ve bindiysen yolculuk bu adımdan sürer"
        >
          <Text style={[s.dugmeYazi, { color: tema.vurguYazi }]}>{`${b.route?.shortName ?? 'Araç'} geldi, bindim`}</Text>
        </Pressable>
      )}
      {cizelge}
    </>,
  );
}

/** "Bu otobüslerden", "Bu minibüslerden", "Bu hatlardan". */
function aracCogulu(b: Bacak): string {
  const i = (b.route?.agency?.name ?? '').toLocaleLowerCase('tr-TR');
  if (i.includes('minib') || i.includes('dolmu')) return 'minibüslerden';
  return ['BUS', 'TROLLEYBUS', 'COACH'].includes((b.route?.mode ?? b.mode ?? '').toUpperCase()) ? 'otobüslerden' : 'hatlardan';
}

/** Bekleme kartında bir hat: rozet ve adı, sıradaki kalkışa kalan, sonraki iki sefer, canlı mı. */
function SecenekSatiri({ v, bacak, secenek, ilk }: { v: YolTarifiVerisi; bacak: number; secenek: BeklemeSecenegi; ilk: boolean }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [birinci, ...sonrakiler] = secenek.kalkislar;
  const dk = (anMs: number) => Math.max(0, Math.round((anMs - v.simdi) / 60_000));
  const otobus = v.binisOtobusleri[bacak];
  // Canlı otobüs yalnız planlanan seferinki biliniyor: bu satırın ilk kalkışıysa yazılır.
  const otobusBurada = !!birinci && !!otobus && otobus.otobus.sefer === birinci.seferId;
  const kaynak = birinci?.canli || otobusBurada ? `Canlı${otobusBurada ? ` · otobüs ${kalanYaz(otobus.kalan)}` : ''}` : 'tarifeye göre';
  const ilkDk = birinci ? dk(birinci.an) : null;
  return (
    <View style={[s.secenek, !ilk && s.secenekAyrac]}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={s.komutSatir}>
          <HatRozeti hat={secenek.hat} kucuk />
          <Text style={s.secenekAd} numberOfLines={2}>
            {baslikYap(secenek.ad)}
          </Text>
        </View>
        <Text style={[s.secenekKaynak, (birinci?.canli || otobusBurada) && { color: tema.vurgu, fontWeight: '600' }]}>
          {birinci ? kaynak : 'kalkış bilgisi yok'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View style={s.sayacSatir}>
          {(birinci?.canli || otobusBurada) && <NabizNoktasi renk={tema.vurgu} />}
          <Text style={[s.secenekDk, (birinci?.canli || otobusBurada) && { color: tema.vurgu }]}>
            {ilkDk == null ? '–' : ilkDk >= 60 ? istanbulSaatiYaz(Math.round(birinci!.an / 1000)) : ilkDk === 0 ? 'şimdi' : ilkDk}
            {ilkDk != null && ilkDk > 0 && ilkDk < 60 && <Text style={s.sayacBirim}> dk</Text>}
          </Text>
        </View>
        {sonrakiler.length > 0 && (
          <Text style={s.secenekKaynak}>{`sonra ${sonrakiler.slice(0, 2).map((k) => dk(k.an)).join(', ')} dk`}</Text>
        )}
      </View>
    </View>
  );
}

/** Araçtayken: hangi hatta olunduğu ve "Değiştir" ile öbür hatlar. */
function HatSecimi({ v, bacak, obur }: { v: YolTarifiVerisi; bacak: number; obur: string[] }) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [acik, setAcik] = useState(false);
  const b = v.bacaklar[bacak];
  return (
    <View style={s.hatSecimi}>
      <View style={s.komutSatir}>
        <HatRozeti hat={b.route} kucuk />
        <Text style={[s.detay, { flex: 1 }]}>{`${b.route?.shortName ?? ''} ile gidiyorsun`}</Text>
        <Pressable onPress={() => setAcik((x) => !x)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Bindiğin hattı değiştir">
          <Text style={[s.dugmeYazi, { color: tema.vurgu }]}>{acik ? 'Vazgeç' : 'Değiştir'}</Text>
        </Pressable>
      </View>
      {acik && (
        <View style={s.secimSatiri}>
          {obur.map((h) => (
            <Pressable
              key={h}
              style={s.secimDugmesi}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                v.hatSec?.(bacak, h);
                setAcik(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${h} hattındayım`}
            >
              <HatRozeti hat={{ shortName: h, mode: b.route?.mode, agency: b.route?.agency }} kucuk />
              <Text style={s.secimYazi}>bunun içindeyim</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const CIZELGE_SATIR = 30;
const KONUM_NOKTASI = 16;

/**
 * Biniş ile iniş arasındaki bütün duraklar, alt alta. Geçilenler soluk, iniş kalın.
 * Mavi nokta telefonun yeri: duraklar arasında kayarak ilerler (1.4 = ikinci duraktan
 * %40 ileride), bir durağa varınca onun üstünde durur. Otobüste giderken nerede
 * olduğunu buradan okursun; liste uzunsa kart kayar ve mavi nokta görünür tutulur.
 */
function DurakCizelgesi({
  duraklar,
  renk,
  ilerleme,
  bitti,
  beklerken,
  binisSaati,
  inisSaati,
  saatler,
  odak,
}: {
  duraklar: { ad: string }[];
  /** Her durağın tahmini saati (ms); bilinmiyorsa null. */
  saatler?: number[] | null;
  renk: string;
  /** Duraklar arası kesirli konum; bilinmiyorsa null. */
  ilerleme: number | null;
  /** Bu bacak bitti: bütün duraklar geçildi, nokta yok. */
  bitti: boolean;
  /** Biniş durağında araç bekleniyor. */
  beklerken: boolean;
  binisSaati: string;
  inisSaati: string;
  odak: (y: number | null) => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [ustY, setUstY] = useState(0);
  const son = duraklar.length - 1;
  const yer = bitti || ilerleme == null ? null : Math.max(0, Math.min(son, ilerleme));
  // Noktanın oturduğu durak (varsa) ve iki durak arasındaysa gidilen durak.
  const sira = yer == null ? -1 : durakSirasi(yer, son);
  const arada = yer != null && sira < son && yer - sira >= DURAKTA_PAYI;
  const durakta = yer != null && !arada ? sira : -1;
  const gidilen = arada ? sira + 1 : -1;

  // Nokta yeni yerine yumuşakça kayar; ilk açılışta oraya atlar.
  const y = useSharedValue(yer ?? 0);
  const ilk = useRef(true);
  useEffect(() => {
    if (yer == null) return;
    if (ilk.current) {
      y.value = yer;
      ilk.current = false;
    } else {
      y.value = withTiming(yer, { duration: 900, easing: Easing.out(Easing.cubic) });
    }
  }, [yer, y]);
  const noktaStili = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value * CIZELGE_SATIR + (CIZELGE_SATIR - KONUM_NOKTASI) / 2 }],
  }));

  const odakSirasi = yer == null ? null : Math.round(yer);
  useEffect(() => {
    odak(odakSirasi == null ? null : ustY + odakSirasi * CIZELGE_SATIR);
  }, [odakSirasi, ustY, odak]);

  // Çizginin geçilen kısmı soluk: her satırın üst yarısı durağa gelirken, alt yarısı çıkarken.
  const gecildiMi = (konum: number) => bitti || (yer != null && yer >= konum);

  return (
    <View style={s.cizelge} onLayout={(e) => setUstY(e.nativeEvent.layout.y)}>
      {duraklar.map((d, j) => {
        const gecildi = bitti || (yer != null && j < yer - DURAKTA_PAYI && j !== durakta);
        const uc = j === 0 || j === son;
        const burada = j === durakta;
        let etiket: { yazi: string; renk?: string } | null = null;
        // Durağın saati (biliniyorsa); bulunulan ve sıradaki durak konum renginde.
        const saat = saatler?.[j] != null && !Number.isNaN(saatler[j]) ? istanbulSaatiYaz(Math.round(saatler[j] / 1000)) : null;
        if (j === son) etiket = { yazi: `in · ${inisSaati}`, renk: tema.yazi };
        else if (burada && j === 0 && beklerken) etiket = { yazi: `buradasın · bin ${binisSaati}`, renk: tema.konum };
        else if (burada) etiket = { yazi: saat ?? 'şu an', renk: tema.konum };
        else if (j === gidilen) etiket = { yazi: saat ?? 'sıradaki', renk: tema.konum };
        else if (j === 0) etiket = { yazi: `bin · ${binisSaati}` };
        else if (saat) etiket = { yazi: saat, renk: gecildi ? tema.soluk : undefined };
        return (
          <View key={j} style={[s.cizelgeSatir, { height: CIZELGE_SATIR }]}>
            <View style={s.cizelgeSutun}>
              {j > 0 && (
                <View style={[s.cizelgeUst, { backgroundColor: renk, opacity: gecildiMi(j) ? 0.35 : 1 }]} />
              )}
              {j < son && (
                <View style={[s.cizelgeAlt, { backgroundColor: renk, opacity: gecildiMi(j + 0.5) ? 0.35 : 1 }]} />
              )}
              <View
                style={[
                  uc ? s.cizelgeUc : s.cizelgeNokta,
                  { borderColor: renk, backgroundColor: j === son ? renk : tema.yuzey },
                  gecildi && { opacity: 0.45 },
                ]}
              />
            </View>
            <Text
              style={[s.cizelgeAd, (uc || burada || j === gidilen) && s.kalin, gecildi && { color: tema.soluk }]}
              numberOfLines={1}
            >
              {baslikYap(d.ad)}
            </Text>
            {etiket && <Text style={[s.cizelgeEtiket, etiket.renk ? { color: etiket.renk } : null]}>{etiket.yazi}</Text>}
          </View>
        );
      })}
      {yer != null && (
        <Animated.View
          pointerEvents="none"
          style={[s.cizelgeBurada, s.cizelgeKonum, { backgroundColor: tema.konum, borderColor: tema.yuzey }, noktaStili]}
        />
      )}
    </View>
  );
}

/**
 * Yürürken tarif. Şimdiki adımda ve konum biliniyorsa sıradaki manevra büyük
 * ("40 m sonra · Sağa dön · Maslak Caddesi"); altında bütün tarif, geçilen adımlar
 * soluk, bulunulan adım vurgulu. Rotadan 40 m'den çok uzaklaşılırsa uyarı.
 */
function TarifKutusu({
  v,
  bacak,
  simdiki,
  odak,
}: {
  v: YolTarifiVerisi;
  bacak: number;
  simdiki: boolean;
  odak: (y: number | null) => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const [ustY, setUstY] = useState(0);
  const tarif = v.tarifler[bacak] ?? [];
  const b = v.bacaklar[bacak];
  const yer = simdiki && v.konum ? yuruyusKonumu(tarif, v.cizgiler[bacak] ?? [], v.konum) : null;
  const sonraki = yer ? tarif[yer.simdiki + 1] : undefined;
  const simdi = !!yer && yer.sonrakine <= SIMDI_M;

  // Manevraya gelince kısa bir titreşim: telefona bakmadan "şimdi dön" anlaşılsın.
  const titredi = useRef('');
  useEffect(() => {
    if (!yer || !simdi) return;
    const anahtar = `${bacak}-${yer.simdiki + 1}`;
    if (titredi.current === anahtar) return;
    titredi.current = anahtar;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  }, [yer, simdi, bacak]);

  useEffect(() => {
    odak(yer ? ustY + yer.simdiki * 28 : null);
  }, [yer?.simdiki, ustY]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tarif.length) return null;
  const varisAdi = b.to.stop ? `${baslikYap(b.to.name)} ${bitisSozcugu(v.bacaklar, bacak).ad}` : 'Varış noktası';

  return (
    <View style={s.tarif}>
      {yer && (
        <>
          {yer.rotadan > SAPMA_M && (
            <View style={[s.kutu, s.kutuDikkat, { marginTop: 0 }]}>
              <Ikon ad="alert-circle-outline" boyut={16} renkKodu={tema.uyari} />
              <Text style={s.kutuYazi}>{`Rotadan ${mesafeYaz(yer.rotadan)} uzaklaştın; haritadaki kesikli çizgiye dön.`}</Text>
            </View>
          )}
          <View style={s.manevra}>
            <View style={[s.manevraSimge, simdi && { backgroundColor: tema.uyari }]}>
              <Ikon ad={sonraki ? DONUS_SIMGELERI[sonraki.donus] : 'flag'} boyut={20} renkKodu={tema.vurguYazi} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.manevraMesafe, simdi && { color: tema.uyari }]}>
                {simdi ? 'Şimdi' : `${mesafeYaz(yer.sonrakine)} sonra`}
              </Text>
              <Text style={s.manevraYazi} numberOfLines={1}>
                {sonraki ? sonraki.eylem : 'Vardın'}
              </Text>
              <Text style={s.manevraSokak} numberOfLines={1}>
                {sonraki ? sonraki.sokak || ' ' : varisAdi}
              </Text>
            </View>
          </View>
        </>
      )}
      <View onLayout={(e) => setUstY(e.nativeEvent.layout.y)}>
        {tarif.map((t, i) => {
          const gecildi = !!yer && i < yer.simdiki;
          const burada = !!yer && i === yer.simdiki;
          return (
            <View key={i} style={[s.tarifListeSatir, burada && s.tarifBurada]}>
              <Ikon ad={DONUS_SIMGELERI[t.donus]} boyut={14} renkKodu={burada ? tema.vurgu : tema.soluk} />
              <Text style={[s.tarifSatir, burada && { color: tema.yazi, fontWeight: '700' }, gecildi && { opacity: 0.5 }]} numberOfLines={1}>
                {t.metin}
              </Text>
              {!!t.mesafe && <Text style={[s.tarifMesafe, gecildi && { opacity: 0.5 }]}>{t.mesafe}</Text>}
            </View>
          );
        })}
        <View style={s.tarifListeSatir}>
          <Ikon ad="flag" boyut={14} renkKodu={tema.soluk} />
          <Text style={s.tarifSatir} numberOfLines={1}>
            {varisAdi}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** Yürürken sıradaki biniş: kalkış saati, otobüs nerede, aktarmada yetişme payı. */
function SonrakiBinisKutusu({
  v,
  yuruyus,
  binis,
  simdiki,
  aktarma,
}: {
  v: YolTarifiVerisi;
  yuruyus: number;
  binis: number;
  simdiki: boolean;
  aktarma: boolean;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const yb = v.bacaklar[yuruyus];
  const bb = v.bacaklar[binis];
  const hat = bb.route?.shortName ?? '';
  const canli = bacakCanli(bb.start.scheduledTime, bb.start.estimated?.time);
  const otobus = v.binisOtobusleri[binis];
  // Durağa varış: şu anki adımsa şimdi + yürüme süresi, değilse planlanan.
  const varis = simdiki ? v.simdi + (yb.duration ?? 0) * 1000 : an(yb, 'end');
  const pay = aktarmaPayi(varis, an(bb, 'start'));
  const sonrakiSefer = v.seferler[binis]?.sonrakiSaniye;
  const yetisilmez = !Number.isNaN(pay) && pay < 1;

  return (
    <View style={[s.kutu, yetisilmez ? s.kutuDikkat : s.kutuIyi]}>
      {canli ? (
        <NabizNoktasi renk={canliRenk(canli.sinif, tema)} />
      ) : (
        <Ikon ad="time-outline" boyut={15} renkKodu={yetisilmez ? tema.uyari : tema.vurgu} />
      )}
      <Text style={s.kutuYazi}>
        <Text style={s.kalin}>{hat}</Text>
        {` kalkışı ${saatYaz(iso(bb, 'start'))}`}
        {otobus ? ` · otobüs ${kalanYaz(otobus.kalan)}` : ''}
        {yetisilmez
          ? `. Yetişmek zor${sonrakiSefer != null ? `; sonraki ${hat} ${saniyedenSaat(sonrakiSefer)}` : ''}.`
          : Number.isNaN(pay)
            ? ''
            : !aktarma && pay > 15
              ? // Kalkışa daha çok varsa "587 dk payın var" yerine ne zaman yola çıkılacağı.
                `. En geç ${istanbulSaatiYaz(yolaCikisAni(an(bb, 'start'), yb.duration ?? 0) / 1000)} yola çık.`
              : `. ${pay} dk payın var.`}
      </Text>
    </View>
  );
}

function adimTuruYazisi(v: YolTarifiVerisi, sira: number): string {
  const a = v.adimlar[sira];
  if (a.tur === 'yuru') return a.rol === 'aktarma' ? 'AKTARMA' : 'YÜRÜ';
  if (sira === v.durum.adim && v.durum.faz === 'icinde') return 'YOLDA';
  return 'BİN';
}

// ---------------------------------------------------------------- tüm adımlar

/** Bütün yolculuk tek listede: biten soluk, şu anki vurgulu. Satıra dokununca o adıma gider. */
export function TumAdimlar({
  v,
  acik,
  kapat,
  sec,
}: {
  v: YolTarifiVerisi;
  acik: boolean;
  kapat: () => void;
  sec: (i: number) => void;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  const kenar = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const son = v.bacaklar[v.bacaklar.length - 1];
  const varisDk = son ? Math.max(0, Math.round((an(son, 'end') - v.simdi) / 60_000)) : 0;
  const aktarma = v.adimlar.filter((a) => a.tur === 'arac').length - 1;
  const git = (i: number) => {
    sec(i);
    kapat();
  };
  return (
    <ModalSayfa acik={acik} kapat={kapat}>
      <View style={[s.sayfa, { paddingBottom: kenar.bottom + 12, maxHeight: Math.round(height * 0.85) }]}>
        <View style={s.tutamac} />
        <Text style={s.sayfaBaslik}>{v.hedef ? `${baslikYap(v.hedef)} yolculuğu` : 'Yolculuk'}</Text>
        <Text style={s.detay}>
          {`Varış ${saatYaz(son ? iso(son, 'end') : null)} · ${varisDk} dk kaldı`}
          {aktarma > 0 ? ` · ${aktarma} aktarma` : ''}
        </Text>
        {/* Liste sayfaya sığmazsa kendi içinde kayar (flexShrink); sığıyorsa sayfa içerik kadar. */}
        <ScrollView style={s.adimListesi} contentContainerStyle={{ paddingBottom: 4 }}>
          {v.adimlar.map((a, i) => {
            const b = v.bacaklar[a.bacak];
            const bitti = i < v.durum.adim || (v.durum.faz === 'vardi' && i === v.durum.adim);
            const simdiki = i === v.durum.adim && !bitti;
            return (
              <Pressable key={i} style={[s.satir, simdiki && s.satirSimdi, bitti && { opacity: 0.55 }]} onPress={() => git(i)}>
                <Text style={s.satirSaat}>{saatYaz(iso(b, 'start'))}</Text>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  {a.tur === 'arac' ? (
                    <View style={s.komutSatir}>
                      <HatRozeti hat={b.route} kucuk ekHatlar={v.esdegerHatlar?.[a.bacak]} />
                      <Text style={s.satirBaslik} numberOfLines={1}>
                        {`${baslikYap(b.to.name)} ${bitisSozcugu(v.bacaklar, a.bacak).e}`}
                      </Text>
                    </View>
                  ) : (
                    <Text style={s.satirBaslik} numberOfLines={1}>
                      {a.rol === 'aktarma'
                        ? `Aktarma: ${baslikYap(b.to.name)} ${bitisSozcugu(v.bacaklar, a.bacak).e} yürü`
                        : a.rol === 'varis' || a.rol === 'tek'
                          ? 'Varış noktasına yürü'
                          : `${baslikYap(b.to.name)} ${bitisSozcugu(v.bacaklar, a.bacak).e} yürü`}
                    </Text>
                  )}
                  <Text style={s.satirAlt} numberOfLines={1}>
                    {a.tur === 'arac'
                      ? `${Math.max(v.duraklar[a.bacak].length - 1, 1)} durak · ${sureYaz(b.duration)}`
                      : `${mesafeYaz(b.distance)} · ${sureYaz(b.duration)}`}
                  </Text>
                </View>
                <Text style={[s.durumCipi, simdiki ? { color: tema.vurgu, backgroundColor: tema.vurguAcik } : null]}>
                  {bitti ? 'bitti' : simdiki ? 'şimdi' : 'sonra'}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Pressable style={[s.dugme, s.dugmeDolu, { marginTop: 10 }]} onPress={() => git(v.durum.adim)}>
          <Text style={[s.dugmeYazi, { color: tema.vurguYazi }]}>Şu anki adıma dön</Text>
        </Pressable>
      </View>
    </ModalSayfa>
  );
}

// ---------------------------------------------------------------- stiller

const stiller = (t: Tema) =>
  StyleSheet.create({
    sekmeler: {
      flexGrow: 0,
      backgroundColor: t.yuzey,
      borderRadius: 14,
      shadowColor: '#000',
      shadowOpacity: t.koyu ? 0.5 : 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    sekmeIc: { paddingHorizontal: 6, paddingVertical: 5, alignItems: 'center' },
    sekmeSarici: { flexDirection: 'row', alignItems: 'center' },
    ayrac: { color: t.soluk, fontSize: 12, marginHorizontal: 2, opacity: 0.7 },
    sekme: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      height: 28,
      paddingHorizontal: 7,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    sekmeBitti: { opacity: 0.55 },
    sekmeYazi: { fontSize: 12.5, fontWeight: '800' },

    kart: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 10,
      shadowColor: '#000',
      shadowOpacity: t.koyu ? 0.5 : 0.18,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: -4 },
    },
    donDugmesi: {
      position: 'absolute',
      top: -46,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: t.vurgu,
      paddingHorizontal: 14,
      height: 34,
      borderRadius: 17,
    },
    donYazi: { color: t.vurguYazi, fontWeight: '700', fontSize: 13 },
    noktalar: { flexDirection: 'row', justifyContent: 'center', gap: 5, marginBottom: 8 },
    nokta: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.cizgi },
    noktaAktif: { width: 16, backgroundColor: t.vurgu },
    icerik: { gap: 4, paddingBottom: 10 },
    cizelge: { marginTop: 10 },
    cizelgeSatir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cizelgeSutun: { width: 16, height: '100%', alignItems: 'center', justifyContent: 'center' },
    cizelgeUst: { position: 'absolute', top: 0, height: '50%', width: 3 },
    cizelgeAlt: { position: 'absolute', bottom: 0, height: '50%', width: 3 },
    cizelgeNokta: { width: 9, height: 9, borderRadius: 5, borderWidth: 2.5 },
    cizelgeUc: { width: 13, height: 13, borderRadius: 7, borderWidth: 3 },
    cizelgeBurada: { width: KONUM_NOKTASI, height: KONUM_NOKTASI, borderRadius: KONUM_NOKTASI / 2, borderWidth: 3 },
    // Satırların üstünde kayan nokta: sütunun ortasına hizalı (sütun 16 pt, nokta 16 pt).
    cizelgeKonum: { position: 'absolute', left: 0, top: 0 },
    cizelgeAd: { flex: 1, fontSize: 13.5, color: t.yazi },
    cizelgeEtiket: { fontSize: 12, fontWeight: '700', color: t.soluk, fontVariant: ['tabular-nums'] },
    manevraSokak: { fontSize: 13, color: t.soluk },
    tarifBurada: { backgroundColor: t.vurguAcik, borderRadius: 8 },
    tarifMesafe: { fontSize: 12, color: t.soluk, fontVariant: ['tabular-nums'] },
    soluk: { color: t.soluk, fontWeight: '500' },
    konumSeridi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      marginTop: 6,
      paddingHorizontal: 12,
      height: 34,
      borderRadius: 12,
      backgroundColor: t.yuzey,
      maxWidth: '100%',
      shadowColor: '#000',
      shadowOpacity: t.koyu ? 0.5 : 0.2,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
    },
    konumMetin: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    sesDugme: {
      marginLeft: 2,
      paddingLeft: 9,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: t.cizgi,
      height: 20,
      justifyContent: 'center',
    },
    konumAna: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: t.yazi },
    konumYan: { fontWeight: '500', color: t.soluk },
    tarif: { marginTop: 6, gap: 6 },
    manevra: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.yuzeyIkincil, borderRadius: 12, padding: 10 },
    manevraSimge: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.vurgu, alignItems: 'center', justifyContent: 'center' },
    manevraMesafe: { fontSize: 12, fontWeight: '700', color: t.vurgu },
    manevraYazi: { fontSize: 15, fontWeight: '700', color: t.yazi },
    tarifSatir: { flex: 1, fontSize: 12.5, color: t.soluk },
    tarifListeSatir: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 28, paddingHorizontal: 6 },
    durakKutusu: { marginTop: 8, borderRadius: 12, backgroundColor: t.yuzeyIkincil, padding: 10 },
    durakKutusuSatir: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    durakKutusuCizgi: { width: 3, height: 10, marginLeft: 5.5, borderRadius: 2 },
    durakKutusuYazi: { flex: 1, fontSize: 13.5, fontWeight: '700', color: t.yazi },
    durakKutusuSaat: { fontSize: 12.5, fontWeight: '600', color: t.soluk, fontVariant: ['tabular-nums'] },
    adimNo: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: t.soluk },
    komutSatir: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    secenekler: { marginTop: 8 },
    secenek: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
    secenekAyrac: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.cizgi },
    secenekAd: { flex: 1, fontSize: 13, color: t.yazi, lineHeight: 17 },
    secenekKaynak: { fontSize: 12, color: t.soluk },
    secenekDk: { fontSize: 22, fontWeight: '800', color: t.yazi, fontVariant: ['tabular-nums'] },
    secenekBaslik: { fontSize: 12.5, fontWeight: '700', color: t.soluk, marginTop: 10 },
    secimSatiri: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    secimDugmesi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: t.cizgi,
      borderRadius: 11,
      paddingHorizontal: 10,
      paddingVertical: 7,
      backgroundColor: t.yuzey,
    },
    secimYazi: { fontSize: 13, fontWeight: '700', color: t.yazi },
    hatSecimi: { marginTop: 10, padding: 9, borderRadius: 10, backgroundColor: t.yuzeyIkincil, gap: 6 },
    komut: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3, color: t.yazi, lineHeight: 26 },
    detay: { fontSize: 13, color: t.soluk, lineHeight: 18 },
    kalin: { fontWeight: '700', color: t.yazi },
    buyukSatir: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginVertical: 6 },
    sayacSatir: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sayac: { fontSize: 34, fontWeight: '800', color: t.yazi, fontVariant: ['tabular-nums'] },
    sayacBirim: { fontSize: 14, fontWeight: '600', color: t.soluk },
    kutu: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, padding: 10, marginTop: 8 },
    kutuIyi: { backgroundColor: t.vurguAcik },
    kutuDikkat: { backgroundColor: t.uyariAcik },
    kutuYazi: { flex: 1, fontSize: 12.5, color: t.yazi, lineHeight: 17 },
    kalanListe: { marginTop: 4, gap: 2 },
    kalanSatir: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 24 },
    kalanNokta: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5, marginLeft: 2 },
    kalanInis: { width: 14, height: 14, borderRadius: 7, borderWidth: 2.5 },
    kalanAd: { flex: 1, fontSize: 13.5, color: t.yazi },
    kalanBosluk: { color: t.soluk, marginLeft: 4, height: 16, lineHeight: 16 },
    eylemler: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 10 },
    dugme: {
      height: 42,
      borderRadius: 12,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      backgroundColor: t.yuzeyIkincil,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    dugmeBitir: {},
    dugmeDolu: { backgroundColor: t.vurgu, borderColor: t.vurgu },
    dugmeYazi: { fontSize: 13.5, fontWeight: '700', color: t.yazi },
    zil: { width: 42, paddingHorizontal: 0 },

    sayfa: {
      backgroundColor: t.yuzey,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 16,
      paddingTop: 8,
      flexShrink: 1,
    },
    adimListesi: { marginTop: 8, flexGrow: 0, flexShrink: 1 },
    tutamac: { width: 38, height: 5, borderRadius: 3, backgroundColor: t.cizgi, alignSelf: 'center', marginBottom: 8 },
    sayfaBaslik: { fontSize: 18, fontWeight: '800', color: t.yazi },
    satir: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingLeft: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.cizgi,
      // Şimdiki adımın vurgu çizgisi için her satırda aynı boşluk: saatler hizalı dursun.
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
    },
    satirSimdi: { borderLeftColor: t.vurgu },
    satirSaat: { width: 42, fontSize: 12.5, fontWeight: '700', color: t.yazi, fontVariant: ['tabular-nums'] },
    satirBaslik: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: t.yazi },
    satirAlt: { fontSize: 12, color: t.soluk },
    durumCipi: {
      fontSize: 11,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: t.yuzeyIkincil,
    },
  });
