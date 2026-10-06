// Dokununca geri bildirim veren Pressable. React Native'in Pressable'ı basılıyken hiçbir
// şey göstermiyor. Burada basılan öğe hafifçe küçülüp solar, bırakınca yaylı olarak
// yerine döner. Uygulamadaki bütün Pressable'lar bunu kullanıyor: ekranlar react-native
// yerine buradan içe aktarıyor, başka bir şey değişmiyor.
//
// Küçülme öğenin genişliğine göre: her öğe aşağı yukarı aynı sayıda piksel küçülüyor.
// Rozet ve düğmede belirgin (%94–96), ekran genişliğindeki satırda neredeyse fark edilmez
// (%98,5); geniş kartlar "zıplamıyor".
//
// "Hareketi azalt" açıksa yalnız solma (eskisi gibi). Stili işlev olan (pressed'e kendi
// bakan) Pressable'a dokunulmuyor. Geri bildirim istenmeyen yerde (arka plan perdesi)
// geriBildirim={false}.

import { useRef, type Ref } from 'react';
import {
  Pressable as RNPressable,
  StyleSheet,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PressableProps,
  type View,
} from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { basiliOlcek } from '@/lib/hareket';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);

/** Hareketi azaltılmış görünümde basılıyken saydamlık: iOS'un sistem düğmelerindeki kadar. */
export const BASILI_SAYDAMLIK = 0.5;
/** Küçülürken saydamlık: küçülme zaten gösteriyor, solma hafif. */
const KUCULURKEN_SAYDAMLIK = 0.86;
const BASMA = { duration: 110 };
const BIRAKMA = { damping: 14, stiffness: 320, mass: 0.6 };

export function Pressable({
  style,
  geriBildirim = true,
  ref,
  onPressIn,
  onPressOut,
  onLayout,
  ...ozellikler
}: PressableProps & { geriBildirim?: boolean; ref?: Ref<View> }) {
  const azalt = useReducedMotion();
  const olcek = useSharedValue(1);
  const saydam = useSharedValue(1);
  const hedef = useRef(0.97);

  // Öğenin kendi saydamlığı (ör. devre dışıyken 0,4) ve dönüşümü korunur: saydamlık onunla
  // çarpılır, kendi dönüşümü olan öğe küçülmez.
  const duz = typeof style === 'function' ? null : StyleSheet.flatten(style);
  const tabanSaydam = typeof duz?.opacity === 'number' ? duz.opacity : 1;
  const donusumVar = !!duz?.transform;
  const animasyonluStil = useAnimatedStyle(() =>
    donusumVar
      ? { opacity: tabanSaydam * saydam.value }
      : { opacity: tabanSaydam * saydam.value, transform: [{ scale: olcek.value }] },
  );

  // Kısa gecikme: listeyi kaydırmaya başlayan parmak altındaki satır bir an küçülmesin.
  const gecikme = ozellikler.unstable_pressDelay ?? 50;
  if (!geriBildirim || typeof style === 'function') {
    return (
      <RNPressable
        ref={ref}
        style={style}
        unstable_pressDelay={gecikme}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onLayout={onLayout}
        {...ozellikler}
      />
    );
  }

  const basildi = (e: GestureResponderEvent) => {
    if (!ozellikler.disabled) {
      if (azalt) {
        saydam.value = BASILI_SAYDAMLIK;
      } else {
        olcek.value = withTiming(hedef.current, BASMA);
        saydam.value = withTiming(KUCULURKEN_SAYDAMLIK, BASMA);
      }
    }
    onPressIn?.(e);
  };
  const birakildi = (e: GestureResponderEvent) => {
    if (azalt) {
      saydam.value = 1;
      olcek.value = 1;
    } else {
      olcek.value = withSpring(1, BIRAKMA);
      saydam.value = withTiming(1, { duration: 180 });
    }
    onPressOut?.(e);
  };
  const olculdu = (e: LayoutChangeEvent) => {
    hedef.current = basiliOlcek(e.nativeEvent.layout.width);
    onLayout?.(e);
  };

  return (
    <AnimatedPressable
      ref={ref as never}
      style={[style, animasyonluStil]}
      unstable_pressDelay={gecikme}
      onPressIn={basildi}
      onPressOut={birakildi}
      onLayout={olculdu}
      {...ozellikler}
    />
  );
}
