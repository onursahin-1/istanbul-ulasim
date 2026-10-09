// Uygulamanın logosu ve açılış animasyonu.
//
// Logo vektör olarak çizildi (1024'lük kare): yeşil kutu, başlangıç halkası, iki ara durağa
// uğrayan S biçimli rota şeridi ve hedefteki iğne. Parçalar ayrı olduğu için açılışta tek tek
// oynatılabiliyor; her boyutta keskin. Taslak: C:\otp\Claude outputs\acilis-animasyonu-taslak.html
//
// Açılış (taslaktaki A, "tam ekran" zemin, ~1,4 sn): bütün ekran logonun yeşili, ortada beyaz
// işaret. Telefonun sabit açılış ekranı düz yeşil (app.json, expo-splash-screen); animasyon o
// kareden devam ediyor: zemin logonun geçişli yeşiline döner, işaret belirir, halka açılır, rota
// halkadan hedefe çizilir, ara duraklar şerit vardıkça belirir, iğne düşüp oturur, işaret büyüyüp
// solarak ana ekranı açar. "Hareketi azalt" açıksa yalnız sade bir solma; dokununca atlanır.

import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Pressable } from '@/components/dokun';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

/** Logonun çizimi (1024 × 1024 birim). */
export const LOGO = {
  kutuKose: 230,
  serit: 'M 452 778 C 520 766, 590 754, 640 726 C 706 690, 690 636, 600 610 C 520 588, 362 575, 372 528 C 384 478, 500 470, 588 452',
  /** Şeridin uzunluğu (birim); çizim animasyonu için. */
  seritUzunluk: 865,
  seritKalinlik: 44,
  /** İğne ve ortasındaki delik (evenodd: delik saydam, arkadaki yeşil görünür). */
  igne:
    'M 611 496 C 565 452, 455 400, 455 287 A 143 143 0 1 1 741 287 C 741 380, 675 450, 611 496 Z ' +
    'M 657 287 A 59 59 0 1 0 539 287 A 59 59 0 1 0 657 287 Z',
  /** İğnenin ucu: düşüşte büyüme bu noktaya göre. */
  igneUcu: { x: 611, y: 496 },
  /** Ara duraklar; `oran`: şeridin halkadan bu durağa kadarki payı (şerit oraya varınca belirir). */
  nokta1: { x: 392, y: 535, r: 27, oran: 0.7 },
  nokta2: { x: 626, y: 637, r: 31, oran: 0.39 },
  /** Başlangıç halkası: kalın çizgili daire (dış yarıçap 79, iç 38). */
  halka: { x: 387, y: 800, r: 58.5, kalinlik: 41 },
} as const;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function Gradyanlar() {
  return (
    <Defs>
      <LinearGradient id="logoZemin" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#12A9A0" />
        <Stop offset="0.55" stopColor="#0B827E" />
        <Stop offset="1" stopColor="#065A5E" />
      </LinearGradient>
      {/* Şerit iğneye doğru saydamlaşıyor (rota hedefe "akıyor"). */}
      <LinearGradient id="logoSerit" x1="0" y1="440" x2="0" y2="790" gradientUnits="userSpaceOnUse">
        <Stop offset="0" stopColor="#ffffff" stopOpacity={0.25} />
        <Stop offset="0.35" stopColor="#ffffff" stopOpacity={0.85} />
        <Stop offset="0.7" stopColor="#E6F5F4" stopOpacity={0.95} />
        <Stop offset="1" stopColor="#BFE6E3" stopOpacity={0.9} />
      </LinearGradient>
    </Defs>
  );
}

/** Kutunun köşe yarıçapı, verilen boyutta (gölge sarmalayıcısı için). */
export const logoKoseYaricapi = (boyut: number) => (boyut * LOGO.kutuKose) / 1024;

/** Sabit logo (Hakkında ekranı gibi yerler). */
export function Logo({ boyut }: { boyut: number }) {
  return (
    <Svg width={boyut} height={boyut} viewBox="0 0 1024 1024">
      <Gradyanlar />
      <Rect width={1024} height={1024} rx={LOGO.kutuKose} fill="url(#logoZemin)" />
      <Path d={LOGO.serit} fill="none" stroke="url(#logoSerit)" strokeWidth={LOGO.seritKalinlik} strokeLinecap="round" />
      <Circle cx={LOGO.nokta2.x} cy={LOGO.nokta2.y} r={LOGO.nokta2.r} fill="#fff" />
      <Circle cx={LOGO.nokta1.x} cy={LOGO.nokta1.y} r={LOGO.nokta1.r} fill="#fff" />
      <Path d={LOGO.igne} fill="#fff" fillRule="evenodd" />
      <Circle cx={LOGO.halka.x} cy={LOGO.halka.y} r={LOGO.halka.r} fill="none" stroke="#fff" strokeWidth={LOGO.halka.kalinlik} />
    </Svg>
  );
}

/** Logonun ortadaki rengi: telefonun sabit açılış ekranının zemini (app.json) bununla aynı. */
export const LOGO_YESILI = '#0B827E';

/** Açılış animasyonunun zamanlaması (ms). Toplam ≈ 1,36 sn. */
export const ACILIS = {
  /** Düz yeşilden (sabit açılış ekranı) logonun geçişli yeşiline. */
  zemin: { bas: 0, sure: 300 },
  isaret: { bas: 0, sure: 260 },
  halka: { bas: 100, sure: 220 },
  serit: { bas: 250, sure: 500 },
  noktaSure: 180,
  igne: { bas: 700, dusus: 190, sekme: 130 },
  cikis: { bas: 1100, sure: 260 },
  /** Hareketi azalt: logo bir an durur, sonra solar. */
  sade: { bas: 350, sure: 250 },
} as const;

const yumusak = Easing.bezier(0.2, 0.8, 0.2, 1);
const cizgi = Easing.bezier(0.45, 0.05, 0.35, 1);

/**
 * Açılış katmanı: bütün ekranı logonun yeşiliyle kaplar, ortada beyaz işareti çizer, bitince
 * `onBitti` çağrılır (katman kaldırılsın).
 */
export function AcilisAnimasyonu({
  onHazir,
  onBitti,
}: {
  /** Katman ekrana çizildi: sistemin sabit açılış ekranı artık kapatılabilir. */
  onHazir?: () => void;
  onBitti: () => void;
}) {
  const ekran = useWindowDimensions();
  // İşaret 1024'lük karenin ortasındaki dar bir şerit (genişliğin ~%28'i, yüksekliğin ~%69'u):
  // kare ekran genişliğinin %72'si, işaret ekranın yaklaşık dörtte biri boyunda.
  const boyut = Math.min(ekran.width * 0.72, ekran.height * 0.36, 320);
  const azalt = useReducedMotion();
  // Hareketi azalt açıksa her şey baştan yerinde.
  const halka = useSharedValue(azalt ? 1 : 0);
  const cizim = useSharedValue(azalt ? 1 : 0);
  const n1 = useSharedValue(azalt ? 1 : 0);
  const n2 = useSharedValue(azalt ? 1 : 0);
  const igneY = useSharedValue(azalt ? 0 : -260);
  const igneGorunur = useSharedValue(azalt ? 1 : 0);
  const gecisliZemin = useSharedValue(azalt ? 1 : 0);
  const isaret = useSharedValue(azalt ? 1 : 0);
  const cikis = useSharedValue(0);
  const birim = boyut / 1024;

  const bitir = () => {
    'worklet';
    scheduleOnRN(onBitti);
  };

  const cik = (gecikme: number, sure: number) => {
    cikis.value = withDelay(gecikme, withTiming(1, { duration: sure, easing: Easing.bezier(0.4, 0, 0.2, 1) }, (tamam) => {
      if (tamam) bitir();
    }));
  };

  useEffect(() => {
    if (azalt) {
      cik(ACILIS.sade.bas, ACILIS.sade.sure);
      return;
    }
    gecisliZemin.value = withTiming(1, { duration: ACILIS.zemin.sure, easing: Easing.linear });
    isaret.value = withTiming(1, { duration: ACILIS.isaret.sure, easing: yumusak });
    const pit = (bas: number, sure: number) =>
      withDelay(bas, withSequence(
        withTiming(1.2, { duration: sure * 0.6, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: sure * 0.4, easing: Easing.inOut(Easing.quad) }),
      ));
    halka.value = pit(ACILIS.halka.bas, ACILIS.halka.sure);
    cizim.value = withDelay(ACILIS.serit.bas, withTiming(1, { duration: ACILIS.serit.sure, easing: cizgi }));
    // Ara duraklar şerit oraya vardığında (çizim eğrisinin zamanı yaklaşık).
    n2.value = pit(ACILIS.serit.bas + ACILIS.serit.sure * LOGO.nokta2.oran, ACILIS.noktaSure);
    n1.value = pit(ACILIS.serit.bas + ACILIS.serit.sure * LOGO.nokta1.oran, ACILIS.noktaSure);
    const { bas, dusus, sekme } = ACILIS.igne;
    igneGorunur.value = withDelay(bas, withTiming(1, { duration: dusus }));
    igneY.value = withDelay(bas, withSequence(
      withTiming(0, { duration: dusus, easing: Easing.in(Easing.quad) }),
      withTiming(-26, { duration: sekme / 2, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: sekme / 2, easing: Easing.in(Easing.quad) }),
    ));
    cik(ACILIS.cikis.bas, ACILIS.cikis.sure);
    // Paylaşılan değerler ve cik bileşen ömrü boyunca aynı; yalnız ilk açılışta bir kez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const atla = () => {
    if (cikis.value > 0) return;
    cik(0, 160);
  };

  const seritProps = useAnimatedProps(() => ({ strokeDashoffset: LOGO.seritUzunluk * (1 - cizim.value) }));
  const halkaProps = useAnimatedProps(() => ({
    r: LOGO.halka.r * halka.value,
    strokeWidth: LOGO.halka.kalinlik * halka.value,
  }));
  const n1Props = useAnimatedProps(() => ({ r: LOGO.nokta1.r * n1.value }));
  const n2Props = useAnimatedProps(() => ({ r: LOGO.nokta2.r * n2.value }));
  const igneStil = useAnimatedStyle(() => ({
    opacity: igneGorunur.value,
    transform: [{ translateY: igneY.value * birim }, { scale: 0.9 + 0.1 * igneGorunur.value }],
  }));
  // Giriş: hafifçe büyüyerek belirir (0,86 → 1); çıkış: büyüyüp solar (1 → 1,35).
  const isaretStil = useAnimatedStyle(() => ({
    opacity: isaret.value * (1 - cikis.value),
    transform: [{ scale: (0.86 + 0.14 * isaret.value) * (1 + 0.35 * cikis.value) }],
  }));
  const gecisliStil = useAnimatedStyle(() => ({ opacity: gecisliZemin.value }));
  const katmanStil = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, cikis.value * 1.15) }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.katman, katmanStil]} onLayout={onHazir}>
      {/* Yeşil zeminde durum çubuğu beyaz; katman kalkınca temanınki geri gelir. */}
      <StatusBar style="light" />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: LOGO_YESILI }]} />
      {/* Logonun köşeden köşeye geçişli yeşili, bütün ekranda. */}
      <Animated.View style={[StyleSheet.absoluteFill, gecisliStil]}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="acilisZemin" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#12A9A0" />
              <Stop offset="0.55" stopColor={LOGO_YESILI} />
              <Stop offset="1" stopColor="#065A5E" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#acilisZemin)" />
        </Svg>
      </Animated.View>
      <Pressable style={s.orta} onPress={atla} geriBildirim={false} accessibilityLabel="Açılışı geç" accessibilityRole="button">
        <Animated.View style={[{ width: boyut, height: boyut }, isaretStil]}>
          <Svg width={boyut} height={boyut} viewBox="0 0 1024 1024">
            <Gradyanlar />
            <AnimatedPath
              d={LOGO.serit}
              fill="none"
              stroke="url(#logoSerit)"
              strokeWidth={LOGO.seritKalinlik}
              strokeLinecap="round"
              strokeDasharray={[LOGO.seritUzunluk, LOGO.seritUzunluk]}
              animatedProps={seritProps}
            />
            <AnimatedCircle cx={LOGO.nokta2.x} cy={LOGO.nokta2.y} fill="#fff" animatedProps={n2Props} />
            <AnimatedCircle cx={LOGO.nokta1.x} cy={LOGO.nokta1.y} fill="#fff" animatedProps={n1Props} />
            <AnimatedCircle cx={LOGO.halka.x} cy={LOGO.halka.y} fill="none" stroke="#fff" animatedProps={halkaProps} />
          </Svg>
          {/* İğne ayrı katmanda: düşüşü ve sekmesi görünüm dönüşümüyle (ucuna göre). */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              { transformOrigin: `${(LOGO.igneUcu.x / 1024) * 100}% ${(LOGO.igneUcu.y / 1024) * 100}%` },
              igneStil,
            ]}
          >
            <Svg width={boyut} height={boyut} viewBox="0 0 1024 1024">
              <Path d={LOGO.igne} fill="#fff" fillRule="evenodd" />
            </Svg>
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  katman: { zIndex: 1000, elevation: 1000 },
  orta: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
