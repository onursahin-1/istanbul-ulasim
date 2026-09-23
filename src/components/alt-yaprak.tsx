// Sürüklenebilir alt yaprak: kapalı / orta / açık.
//
// Sürükleme arayüz iş parçacığında çalışıyor (react-native-gesture-handler +
// Reanimated; ikisi de Expo Go'nun içinde, ek yerel modül gerekmiyor). İlk sürüm
// React Native'in PanResponder'ı ve JS tarafı Animated ile yazılmıştı: parmağın her
// hareketi JS iş parçacığından geçtiği için, JS o sırada başka bir işle meşgulken
// (harita, zamanlayıcılar, yenileme) yaprak takılıyordu.
//
// Kural:
//  - Kapalı ya da ortadayken yaprağın her yerinden dikey sürükleme yaprağı taşır;
//    liste kaymaz. (Apple Haritalar da böyle: önce yaprak açılır, sonra liste kayar.)
//  - Açıkken liste kayar; liste en tepedeyken aşağı çekmek yaprağı küçültür.
//  - Başlığa dokunmak kapalıyı açar, ortayı kapatır.
//
// Durak seçimi src/lib/yaprak.ts'te, testli.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useTema } from '@/lib/tema';
import {
  dokununcaDurak,
  durakOfseti,
  hedefDurak,
  sinirla,
  yukseklikleriHesapla,
  type YaprakDurumu,
} from '@/lib/yaprak';

/** Parmağın yatay mı dikey mi gittiğine karar vermeden önce beklenen yol. */
const KARAR_ESIGI = 6;

const YAY = { damping: 24, stiffness: 240, mass: 0.9 };

type Ozellikler = {
  /** Yaprağın içinde durduğu alanın yüksekliği (onLayout ile ölçülür). */
  kapsayiciYukseklik: number;
  /** Açıkken üstte boş kalacak alan: arama kutusu görünür kalsın. */
  ustPay: number;
  /** Kapalıyken görünen yükseklik — tutamaç ve başlık sığacak kadar. */
  kapaliYukseklik?: number;
  ortaOran?: number;
  baslangic?: YaprakDurumu;
  /** Tutamacın altındaki başlık satırı; dokununca yaprak açılıp kapanır. */
  baslik: ReactNode;
  children: ReactNode;
  /** Durak değişince görünen yükseklikle birlikte çağrılır (harita boşluğu için). */
  onDurum?: (durum: YaprakDurumu, gorunenYukseklik: number) => void;
  stil?: StyleProp<ViewStyle>;
  erisilebilirlikEtiketi?: string;
};

export function AltYaprak({
  kapsayiciYukseklik,
  ustPay,
  kapaliYukseklik = 76,
  ortaOran = 0.48,
  baslangic = 'orta',
  baslik,
  children,
  onDurum,
  stil,
  erisilebilirlikEtiketi = 'Listeyi aç ya da kapat',
}: Ozellikler) {
  const tema = useTema();
  const y = useMemo(
    () => yukseklikleriHesapla(kapsayiciYukseklik, ustPay, kapaliYukseklik, ortaOran),
    [kapsayiciYukseklik, ustPay, kapaliYukseklik, ortaOran],
  );

  // React tarafı: kaydırmanın açılıp kapanması ve erişilebilirlik için.
  const [durum, setDurum] = useState<YaprakDurumu>(baslangic);
  const durumRef = useRef<YaprakDurumu>(baslangic);
  const liste = useRef<ScrollView>(null);
  const onDurumRef = useRef(onDurum);
  onDurumRef.current = onDurum;
  const yRef = useRef(y);
  yRef.current = y;

  // Arayüz iş parçacığı tarafı: sürükleme bunlarla, JS'e uğramadan yürüyor.
  const ofset = useSharedValue(durakOfseti(y, baslangic));
  const tutulan = useSharedValue(0);
  const yS = useSharedValue(y);
  const durumS = useSharedValue<YaprakDurumu>(baslangic);
  const kaydirma = useSharedValue(0);
  const dokunusX = useSharedValue(0);
  const dokunusY = useSharedValue(0);

  /** Durak değişti: React durumunu ve dinleyiciyi güncelle (JS iş parçacığında). */
  const durakDegisti = useCallback((hedef: YaprakDurumu) => {
    durumRef.current = hedef;
    setDurum(hedef);
    onDurumRef.current?.(hedef, yRef.current[hedef]);
    if (hedef !== 'acik') liste.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // Ölçüler değişince (ilk ölçüm, ekran döndürme) yaprak bulunduğu durağa oturur.
  useEffect(() => {
    yS.value = y;
    ofset.value = durakOfseti(y, durumRef.current);
    onDurumRef.current?.(durumRef.current, y[durumRef.current]);
  }, [y, yS, ofset]);

  /** JS'ten (başlığa dokunma) bir durağa git. */
  const git = useCallback(
    (hedef: YaprakDurumu) => {
      durumS.value = hedef;
      ofset.value = withSpring(durakOfseti(yRef.current, hedef), YAY);
      durakDegisti(hedef);
    },
    [durumS, ofset, durakDegisti],
  );

  const surukleme = useMemo(
    () =>
      Gesture.Pan()
        // Kimin olduğuna parmak biraz yol aldıktan sonra karar veriyoruz: yatay
        // hareket (harita, yatay listeler) ve açık yapraktaki liste kaydırması bizim değil.
        .manualActivation(true)
        .onTouchesDown((e) => {
          dokunusX.value = e.changedTouches[0].absoluteX;
          dokunusY.value = e.changedTouches[0].absoluteY;
        })
        .onTouchesMove((e, yonetici) => {
          const dx = e.changedTouches[0].absoluteX - dokunusX.value;
          const dy = e.changedTouches[0].absoluteY - dokunusY.value;
          if (Math.abs(dx) < KARAR_ESIGI && Math.abs(dy) < KARAR_ESIGI) return;
          if (Math.abs(dx) > Math.abs(dy)) {
            yonetici.fail();
            return;
          }
          if (durumS.value !== 'acik') {
            yonetici.activate();
            return;
          }
          // Açıkken: liste tepedeyken aşağı çekiş yaprağın, gerisi listenin.
          if (dy > 0 && kaydirma.value <= 0) yonetici.activate();
          else yonetici.fail();
        })
        .onStart(() => {
          cancelAnimation(ofset);
          tutulan.value = ofset.value;
        })
        .onUpdate((e) => {
          ofset.value = sinirla(tutulan.value + e.translationY, yS.value);
        })
        .onEnd((e) => {
          // Gesture handler hızı piksel/saniye veriyor; hedefDurak piksel/ms bekliyor.
          const hedef = hedefDurak(tutulan.value + e.translationY, e.velocityY / 1000, yS.value);
          durumS.value = hedef;
          ofset.value = withSpring(durakOfseti(yS.value, hedef), YAY);
          scheduleOnRN(durakDegisti, hedef);
        }),
    [dokunusX, dokunusY, durumS, kaydirma, ofset, tutulan, yS, durakDegisti],
  );

  const kaydirildi = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      kaydirma.value = e.nativeEvent.contentOffset.y;
    },
    [kaydirma],
  );

  const tasima = useAnimatedStyle(() => ({ transform: [{ translateY: ofset.value }] }));

  return (
    <GestureDetector gesture={surukleme}>
      <Animated.View style={[stiller.yaprak, { height: y.acik, backgroundColor: tema.yuzey }, tasima, stil]}>
        <Pressable
          onPress={() => git(dokununcaDurak(durumRef.current))}
          accessibilityRole="button"
          accessibilityLabel={erisilebilirlikEtiketi}
          accessibilityState={{ expanded: durum !== 'kapali' }}
          hitSlop={{ top: 8 }}
        >
          <View style={[stiller.tutamac, { backgroundColor: tema.cizgi }]} />
          {baslik}
        </Pressable>
        <ScrollView
          ref={liste}
          style={stiller.liste}
          contentContainerStyle={stiller.icerik}
          scrollEnabled={durum === 'acik'}
          bounces={false}
          overScrollMode="never"
          onScroll={kaydirildi}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={durum === 'acik'}
        >
          {children}
        </ScrollView>
      </Animated.View>
    </GestureDetector>
  );
}

const stiller = StyleSheet.create({
  yaprak: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
    shadowColor: '#14201b',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  tutamac: { width: 38, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 10 },
  liste: { flex: 1 },
  icerik: { paddingBottom: 24 },
});
