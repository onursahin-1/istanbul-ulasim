// Alttan açılan sayfa (zaman seçimi, rota tercihleri, haritada basılı tutma, yolculuk
// adımları, hatırlatıcı). iPhone'daki sayfalar gibi davranıyor:
//   - Arka plan kararması yerinde belirir (eskiden sayfayla birlikte aşağıdan kayıp
//     geliyordu: Modal'ın animationType="slide"'ı perdeyi de kaydırıyor).
//   - Sayfa yayla yerine oturur; tutamaçtan aşağı çekince iner, bırakınca yeterince
//     çekilmişse kapanır, değilse geri yerine oturur.
//   - Perdeye dokununca ya da Android'in geri tuşuyla kapanır.
//
// Sürükleme arayüz iş parçacığında (gesture-handler + Reanimated), parmakla birebir gider.
// Yalnız tutamaç bölgesi sürüklenir: sayfanın içindeki listeler (yolculuk adımları)
// kendi kaydırmasını korur.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

const YAY = { damping: 26, stiffness: 260, mass: 0.9 };
const KAPANIS = { duration: 220, easing: Easing.in(Easing.cubic) };
/** Sayfa boyunun bu kadarı ya da hızlı bir fiske ile aşağı çekilirse kapanır. */
const KAPAT_ORANI = 0.28;
const KAPAT_HIZI = 900;
/** Sürüklenebilir üst bölge: tutamaç ve başlığın üst kısmı. */
const TUTAMAC_BOYU = 22;

export function ModalSayfa({ acik, kapat, children }: { acik: boolean; kapat: () => void; children: ReactNode }) {
  const [gorunur, setGorunur] = useState(acik);
  const boy = useSharedValue(0);
  const y = useSharedValue(2000);
  const perde = useSharedValue(0);
  const girdi = useRef(false);
  // Sayfa en çok ekranın üst kenarına kadar uzar; içindeki liste (flexShrink) kalanında kayar.
  // Yüzdeyle verilen en büyük yükseklik burada işlemiyordu: üst öğenin boyu içeriğe göre.
  const { height } = useWindowDimensions();
  const kenar = useSafeAreaInsets();
  const enBuyuk = height - kenar.top - 16;

  // Açılış onLayout'ta (sayfanın boyu belli olunca); kapanış burada: önce iner, sonra Modal kalkar.
  useEffect(() => {
    if (acik) {
      setGorunur(true);
      return;
    }
    if (!gorunur) return;
    girdi.current = false;
    perde.value = withTiming(0, KAPANIS);
    y.value = withTiming(boy.value || 800, KAPANIS, (bitti) => {
      if (bitti) scheduleOnRN(setGorunur, false);
    });
  }, [acik, gorunur, boy, perde, y]);

  const olcul = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    boy.value = h;
    if (!acik || girdi.current) return;
    girdi.current = true;
    y.value = h;
    y.value = withSpring(0, YAY);
    perde.value = withTiming(1, { duration: 240 });
  };

  const surukle = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onUpdate((e) => {
      // Yukarı çekince direnç: sayfa yerinden fazla kalkmasın.
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 6;
      perde.value = 1 - Math.max(0, Math.min(1, e.translationY / Math.max(boy.value, 1)));
    })
    .onEnd((e) => {
      if (e.translationY > boy.value * KAPAT_ORANI || e.velocityY > KAPAT_HIZI) {
        scheduleOnRN(kapat);
      } else {
        y.value = withSpring(0, YAY);
        perde.value = withTiming(1, { duration: 160 });
      }
    });

  const sayfaStili = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const perdeStili = useAnimatedStyle(() => ({ opacity: perde.value }));

  return (
    <Modal visible={gorunur} transparent animationType="none" onRequestClose={kapat} statusBarTranslucent>
      <GestureHandlerRootView style={stil.kok}>
        <Animated.View style={[StyleSheet.absoluteFill, stil.perde, perdeStili]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={kapat} accessibilityLabel="Kapat" />
        </Animated.View>
        <Animated.View style={[stil.sayfa, { maxHeight: enBuyuk }, sayfaStili]} onLayout={olcul}>
          {children}
          <GestureDetector gesture={surukle}>
            <View style={stil.tutamac} accessibilityElementsHidden importantForAccessibility="no" />
          </GestureDetector>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const stil = StyleSheet.create({
  kok: { flex: 1, justifyContent: 'flex-end' },
  perde: { backgroundColor: 'rgba(0,0,0,0.35)' },
  sayfa: { width: '100%' },
  tutamac: { position: 'absolute', top: 0, left: 0, right: 0, height: TUTAMAC_BOYU },
});
