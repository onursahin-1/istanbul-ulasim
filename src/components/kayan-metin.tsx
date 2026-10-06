// Değişince haneleri kayan metin: "12 dk" → "11 dk"de yalnız son hane kayar.
//
// Sayı azalıyorsa yeni hane yukarıdan iner, eskisi aşağı çıkar; artıyorsa tersi (sayaç
// gibi). Rakam olmayan parçalar (" dk", ":", " durak uzakta") yerinde durur. Haneler her
// sayı parçasında sağdan eşleniyor: "10" → "9"da birler basamağı kayar, onlar basamağı
// kaybolur.
//
// Animasyon yalnız değişimde: ilk görünüşte metin düz çıkar (liste açılırken bütün
// rakamlar kaymasın). "Hareketi azalt" açıksa metin doğrudan değişir.
//
// Metin bir <Text>'in içine konamaz (hücreler View); satırın kendisi View olmalı.

import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useReducedMotion,
  withTiming,
  type EntryAnimationsValues,
} from 'react-native-reanimated';

import { degisimYonu, hucreler, type Yon } from '@/lib/hareket';

/** Kayma süresi (ms). */
const SURE = 420;

// Reanimated'in özel giriş animasyonları: hücrenin yüksekliği kadar kayma. "Çıkış" da
// giriş olarak yazılıyor (eski hane yeni bir öğe olarak takılıp dışarı kayıyor): yönü
// takıldığı anda biliniyor, sökülürken değil.
function gir(yon: Yon) {
  return (v: EntryAnimationsValues) => {
    'worklet';
    const h = v.targetHeight;
    const ayar = { duration: SURE, easing: Easing.out(Easing.cubic) };
    return {
      initialValues: { transform: [{ translateY: yon < 0 ? -h : h }], opacity: 0 },
      animations: { transform: [{ translateY: withTiming(0, ayar) }], opacity: withTiming(1, ayar) },
    };
  };
}

function cik(yon: Yon) {
  return (v: EntryAnimationsValues) => {
    'worklet';
    const h = v.targetHeight;
    const ayar = { duration: SURE, easing: Easing.out(Easing.cubic) };
    return {
      initialValues: { transform: [{ translateY: 0 }], opacity: 1 },
      animations: {
        transform: [{ translateY: withTiming(yon < 0 ? h : -h, ayar) }],
        opacity: withTiming(0, { duration: SURE * 0.8 }),
      },
    };
  };
}

type HucreDurumu = { karakter: string; surum: number; yon: Yon; eski: string | null };

function Hucre({ karakter, yon, style, azalt }: { karakter: string; yon: Yon; style?: StyleProp<TextStyle>; azalt: boolean }) {
  const [d, setD] = useState<HucreDurumu>({ karakter, surum: 0, yon, eski: null });
  // Önceki değerden türetilen durum: React'in önerdiği biçim (render sırasında setState).
  if (d.karakter !== karakter) {
    setD({ karakter, surum: d.surum + 1, yon, eski: azalt ? null : d.karakter });
  }
  // Çıkan hane kaydıktan sonra kaldırılır.
  useEffect(() => {
    if (d.eski == null) return;
    const surum = d.surum;
    const t = setTimeout(() => setD((x) => (x.surum === surum ? { ...x, eski: null } : x)), SURE + 40);
    return () => clearTimeout(t);
  }, [d.eski, d.surum]);

  const kaysin = d.surum > 0 && !azalt;
  return (
    <View style={stil.hucre}>
      <Animated.Text key={`k${d.surum}`} style={style} entering={kaysin ? gir(d.yon) : undefined}>
        {d.karakter === ' ' ? ' ' : d.karakter}
      </Animated.Text>
      {d.eski != null && (
        <Animated.Text key={`e${d.surum}`} style={[style, stil.eski]} entering={cik(d.yon)}>
          {d.eski === ' ' ? ' ' : d.eski}
        </Animated.Text>
      )}
    </View>
  );
}

export function KayanMetin({
  metin,
  style,
  kapStili,
}: {
  metin: string;
  /** Yazının stili (her haneye uygulanır). */
  style?: StyleProp<TextStyle>;
  /** Satırın (View) stili. */
  kapStili?: StyleProp<ViewStyle>;
}) {
  const azalt = useReducedMotion();
  const [d, setD] = useState<{ metin: string; yon: Yon }>({ metin, yon: 1 });
  if (d.metin !== metin) setD({ metin, yon: degisimYonu(d.metin, metin) });
  const yaziStili = [stil.yazi, style];
  return (
    <View style={[stil.satir, kapStili]} accessible accessibilityLabel={metin} accessibilityRole="text">
      {hucreler(metin).map((h) => (
        <Hucre key={h.anahtar} karakter={h.karakter} yon={d.yon} style={yaziStili} azalt={azalt} />
      ))}
    </View>
  );
}

const stil = StyleSheet.create({
  satir: { flexDirection: 'row', alignItems: 'baseline' },
  hucre: { overflow: 'hidden' },
  yazi: { fontVariant: ['tabular-nums'] },
  eski: { position: 'absolute', left: 0, top: 0 },
});
