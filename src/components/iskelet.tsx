// Yüklenirken gösterilen iskelet: gelecek içeriğin biçiminde gri kutular ve üstlerinden
// geçen bir parıltı. Dönen simgeye göre bekleme daha kısa hissettiriyor; ekranın neye
// dönüşeceği baştan belli. "Hareketi azalt" açıksa parıltı yok, kutular durur.

import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useStiller } from '@/components/ulasim';
import { useTema, type Tema } from '@/lib/tema';

/** Parıltının kademeleri: ortası en parlak (degrade kütüphanesi olmadan yumuşak kenar). */
const KADEMELER = [0.05, 0.12, 0.2, 0.12, 0.05];
const BANT = 120;

/** Kapsayıcının üstünden soldan sağa geçen parıltı; kapsayıcı `overflow: 'hidden'` olmalı. */
export function Parilti() {
  const tema = useTema();
  const azalt = useReducedMotion();
  const [genislik, setGenislik] = useState(0);
  const x = useSharedValue(0);
  useEffect(() => {
    if (azalt || !genislik) return;
    x.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [azalt, genislik, x]);
  const bant = useAnimatedStyle(() => ({ transform: [{ translateX: -BANT + x.value * (genislik + 2 * BANT) }] }));
  if (azalt) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={(e) => setGenislik(e.nativeEvent.layout.width)}>
      <Animated.View style={[stil.bant, bant]}>
        {KADEMELER.map((o, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: `rgba(255,255,255,${tema.koyu ? o * 0.5 : o * 3})` }} />
        ))}
      </Animated.View>
    </View>
  );
}

/** Gri kutu: yazı ya da rozet yerine. */
export function Blok({ en, boy, style }: { en: DimensionValue; boy: number; style?: StyleProp<ViewStyle> }) {
  const tema = useTema();
  return <View style={[{ width: en, height: boy, borderRadius: 6, backgroundColor: tema.cizgi }, style]} />;
}

/** Durağın kalkış satırları biçiminde iskelet: rozet, yön ve dakika. */
export function IskeletSatirlari({ sayi = 5 }: { sayi?: number }) {
  const s = useStiller(stiller);
  return (
    <View style={s.satirlar} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: sayi }, (_, i) => (
        <View key={i} style={s.satir}>
          <Blok en={46} boy={24} />
          <View style={{ flex: 1, gap: 6 }}>
            <Blok en="60%" boy={14} />
            <Blok en="35%" boy={11} />
          </View>
          <Blok en={34} boy={18} />
        </View>
      ))}
      <Parilti />
    </View>
  );
}

const stil = StyleSheet.create({
  bant: { position: 'absolute', top: 0, bottom: 0, left: 0, width: BANT, flexDirection: 'row' },
});

const stiller = (t: Tema) =>
  StyleSheet.create({
    satirlar: { overflow: 'hidden' },
    satir: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.cizgi,
    },
  });
