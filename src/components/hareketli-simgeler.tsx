// Küçük, anlam taşıyan simge animasyonları:
//   • FavoriSimgesi: favoriye eklenince kalp/yıldız yaylı büyüyerek dolar, etrafına bir
//     halka ve parçacıklar saçılır; çıkarınca sade küçülüp boşalır.
//   • SekmeSimgesi: alt çubukta seçilen sekmenin simgesi yaylı zıplar.
//   • DonenSimge: `tetik` her arttığında bir tur döner (konumuma git).
//   • PingHalkasi: haritada bir noktadan bir kez yayılıp sönen halka.
// "Hareketi azalt" açıksa hareket yok; simge doğrudan değişir.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Ikon } from '@/components/ulasim';

type IkonAdi = ComponentProps<typeof Ionicons>['name'];

const PARCACIK = 8;

/** Bir değerin değiştiğini (ilk çizim hariç) sayan yardımcı: her değişimde `n` artar. */
function useDegisim<T>(deger: T): { n: number; deger: T } {
  const [d, setD] = useState({ deger, n: 0 });
  if (d.deger !== deger) setD({ deger, n: d.n + 1 });
  return d;
}

export function FavoriSimgesi({
  dolu,
  tur,
  boyut = 16,
  renk,
}: {
  dolu: boolean;
  tur: 'heart' | 'star';
  boyut?: number;
  renk: string;
}) {
  const azalt = useReducedMotion();
  const degisim = useDegisim(dolu);
  const olcek = useSharedValue(1);
  const patlama = useSharedValue(0);
  useEffect(() => {
    if (degisim.n === 0 || azalt) return;
    if (degisim.deger) {
      olcek.value = withSequence(
        withTiming(0.6, { duration: 80 }),
        withTiming(1.3, { duration: 170, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 9, stiffness: 260 }),
      );
      patlama.value = 0;
      patlama.value = withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) });
    } else {
      olcek.value = withSequence(withTiming(0.8, { duration: 110 }), withSpring(1, { damping: 14, stiffness: 260 }));
    }
  }, [degisim.n, degisim.deger, azalt, olcek, patlama]);
  const simge = useAnimatedStyle(() => ({ transform: [{ scale: olcek.value }] }));
  const halka = useAnimatedStyle(() => ({
    opacity: patlama.value === 0 || patlama.value === 1 ? 0 : 0.8 * (1 - patlama.value),
    transform: [{ scale: 0.6 + 0.9 * patlama.value }],
  }));
  const ad = (tur === 'heart' ? (dolu ? 'heart' : 'heart-outline') : dolu ? 'star' : 'star-outline') as IkonAdi;
  return (
    <View style={{ width: boyut, height: boyut, alignItems: 'center', justifyContent: 'center' }}>
      {!azalt && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[stil.halka, { width: boyut * 1.8, height: boyut * 1.8, borderRadius: boyut, borderColor: renk }, halka]}
          />
          {Array.from({ length: PARCACIK }, (_, i) => (
            <Parcacik key={i} aci={(i / PARCACIK) * Math.PI * 2} uzaklik={boyut * 1.15} renk={renk} p={patlama} />
          ))}
        </>
      )}
      <Animated.View style={simge}>
        <Ikon ad={ad} boyut={boyut} renkKodu={renk} />
      </Animated.View>
    </View>
  );
}

function Parcacik({ aci, uzaklik, renk, p }: { aci: number; uzaklik: number; renk: string; p: SharedValue<number> }) {
  const st = useAnimatedStyle(() => ({
    opacity: p.value === 0 || p.value === 1 ? 0 : 1 - p.value,
    transform: [
      { translateX: Math.cos(aci) * uzaklik * p.value },
      { translateY: Math.sin(aci) * uzaklik * p.value },
      { scale: 1 - 0.6 * p.value },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[stil.parcacik, { backgroundColor: renk }, st]} />;
}

/**
 * Alt çubuk simgesi: seçiliyse dolu. Sekmeye basılınca (`tetik` artınca) yaylı zıplar.
 * Sekme çubuğu seçili ve seçisiz iki kopyayı üst üste çizip saydamlıkla değiştirdiği için
 * zıplama `secili`ye değil basışa bağlı; iki kopya birlikte zıplar.
 */
export function SekmeSimgesi({
  ad,
  doluAd,
  secili,
  renk,
  boyut,
  tetik,
}: {
  ad: IkonAdi;
  doluAd: IkonAdi;
  secili: boolean;
  renk: ColorValue;
  boyut: number;
  tetik: number;
}) {
  const azalt = useReducedMotion();
  const olcek = useSharedValue(1);
  useEffect(() => {
    if (tetik === 0 || azalt) return;
    olcek.value = withSequence(
      withTiming(0.8, { duration: 90 }),
      withTiming(1.18, { duration: 140, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 10, stiffness: 260 }),
    );
  }, [tetik, azalt, olcek]);
  const st = useAnimatedStyle(() => ({ transform: [{ scale: olcek.value }] }));
  return (
    <Animated.View style={st}>
      <Ionicons name={secili ? doluAd : ad} size={boyut} color={renk} />
    </Animated.View>
  );
}

/** `tetik` her arttığında içindeki simge bir tur döner. */
export function DonenSimge({ tetik, children }: { tetik: number; children: ReactNode }) {
  const azalt = useReducedMotion();
  const aci = useSharedValue(0);
  useEffect(() => {
    if (tetik === 0 || azalt) return;
    aci.value = 0;
    aci.value = withTiming(360, { duration: 600, easing: Easing.inOut(Easing.cubic) });
  }, [tetik, azalt, aci]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${aci.value}deg` }] }));
  return <Animated.View style={st}>{children}</Animated.View>;
}

/** Bir kez yayılıp sönen halka (haritada konum işareti için). */
export function PingHalkasi({ renk, boyut = 60 }: { renk: string; boyut?: number }) {
  const azalt = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!azalt) p.value = withTiming(1, { duration: 850, easing: Easing.out(Easing.cubic) });
  }, [azalt, p]);
  const st = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - p.value), transform: [{ scale: 0.25 + 0.75 * p.value }] }));
  if (azalt) return null;
  return (
    <View style={{ width: boyut, height: boyut, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
      <Animated.View
        style={[{ width: boyut, height: boyut, borderRadius: boyut / 2, backgroundColor: renk }, st]}
      />
    </View>
  );
}

const stil = StyleSheet.create({
  halka: { position: 'absolute', borderWidth: 2 },
  parcacik: { position: 'absolute', width: 5, height: 5, borderRadius: 2.5 },
});
