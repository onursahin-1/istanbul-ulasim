// Sola kaydırınca silinen liste satırı (iPhone'daki Posta ve Mesajlar gibi).
//
//  - Biraz sola kaydırıp bırakınca satır açık kalır, sağda kırmızı "Sil" düğmesi görünür.
//  - Satır genişliğinin yarısından fazla kaydırınca "tam kaydırma": hafif bir titreşim,
//    bırakınca satır ekrandan kayıp silinir (düğmeye basmaya gerek yok).
//  - Açıkken satıra dokunmak önce satırı kapatır (yanlışlıkla durağa gitmesin).
//  - VoiceOver: satırın eylemlerinde "Sil" var (yukarı/aşağı kaydırarak seçilir).
//
// Sürükleme arayüz iş parçacığında (gesture-handler + Reanimated). Yatay 12 pt'den
// önce dikey hareket başlarsa jest bırakılır, liste kaymaya devam eder.

import * as Haptics from 'expo-haptics';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Ikon } from '@/components/ulasim';

/** Açık satırda "Sil" düğmesinin genişliği. */
const DUGME = 84;
/** Genişliğin bu oranından fazlası kaydırılınca bırakmak siler. */
const TAM_ORAN = 0.5;
const YAY = { damping: 22, stiffness: 260, mass: 0.7 };
const SIL_KIRMIZI = '#ff3b30';

type Ozellikler = {
  children: ReactNode;
  onSil: () => void;
  /** VoiceOver'da eylemin adı. */
  silEtiketi?: string;
};

export function KaydirmaliSatir({ children, onSil, silEtiketi = 'Sil' }: Ozellikler) {
  const x = useSharedValue(0);
  const baslangic = useSharedValue(0);
  const genislik = useSharedValue(360);
  const tam = useSharedValue(false);
  const [acik, setAcik] = useState(false);

  const titret = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  const sil = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onSil();
  };

  const kaydirVeSil = () => {
    x.value = withTiming(-genislik.value, { duration: 180 }, (bitti) => {
      if (bitti) scheduleOnRN(sil);
    });
  };
  const kapat = () => {
    x.value = withSpring(0, YAY);
    setAcik(false);
  };

  const jest = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => {
      baslangic.value = x.value;
    })
    .onUpdate((e) => {
      let yeni = baslangic.value + e.translationX;
      if (yeni > 0) yeni *= 0.15; // sağa doğru yalnız hafif esneme
      x.value = yeni;
      const esikte = yeni < -genislik.value * TAM_ORAN;
      if (esikte !== tam.value) {
        tam.value = esikte;
        if (esikte) scheduleOnRN(titret);
      }
    })
    .onEnd((e) => {
      if (tam.value) {
        tam.value = false;
        x.value = withTiming(-genislik.value, { duration: 160 }, (bitti) => {
          if (bitti) scheduleOnRN(sil);
        });
        return;
      }
      const ac = x.value < -DUGME / 2 || e.velocityX < -600;
      x.value = withSpring(ac && e.velocityX < 600 ? -DUGME : 0, YAY);
      scheduleOnRN(setAcik, ac && e.velocityX < 600);
    });

  const onStil = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  // Kırmızı alan satırın açılan kısmını doldurur; tam kaydırmada yazı parmağı izler.
  const eylemStil = useAnimatedStyle(() => ({ width: Math.max(0, -x.value) }));
  const yaziStil = useAnimatedStyle(() => ({
    alignItems: -x.value > genislik.value * TAM_ORAN ? 'flex-start' : 'center',
  }));

  return (
    <Animated.View
      exiting={FadeOut.duration(160)}
      layout={LinearTransition.duration(220)}
      style={stiller.kok}
      onLayout={(e) => {
        genislik.value = e.nativeEvent.layout.width;
      }}
      accessibilityActions={[{ name: 'delete', label: silEtiketi }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'delete') onSil();
      }}
    >
      <Animated.View style={[stiller.eylem, eylemStil]}>
        <Pressable style={stiller.eylemDugme} onPress={kaydirVeSil} accessibilityRole="button" accessibilityLabel={silEtiketi}>
          <Animated.View style={[stiller.eylemIc, yaziStil]}>
            <View style={stiller.eylemYazi}>
              <Ikon ad="trash" boyut={18} renkKodu="#fff" />
              <Text style={stiller.eylemMetin}>Sil</Text>
            </View>
          </Animated.View>
        </Pressable>
      </Animated.View>

      <GestureDetector gesture={jest}>
        <Animated.View style={onStil}>
          {children}
          {acik && <Pressable style={StyleSheet.absoluteFill} onPress={kapat} accessibilityElementsHidden />}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const stiller = StyleSheet.create({
  kok: { overflow: 'hidden' },
  eylem: { position: 'absolute', top: 0, bottom: 0, right: 0, backgroundColor: SIL_KIRMIZI },
  eylemDugme: { flex: 1 },
  eylemIc: { flex: 1, justifyContent: 'center' },
  eylemYazi: { width: DUGME, alignItems: 'center', justifyContent: 'center', gap: 2 },
  eylemMetin: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
