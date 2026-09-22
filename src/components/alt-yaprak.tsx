// Sürüklenebilir alt yaprak: kapalı / orta / açık.
//
// Ek paket kullanmıyor (React Native'in kendi Animated ve PanResponder'ı):
// Expo Go'da doğrudan çalışsın, yerel modül gerektirmesin.
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
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

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

  const [durum, setDurum] = useState<YaprakDurumu>(baslangic);
  const durumRef = useRef<YaprakDurumu>(baslangic);
  const ofset = useRef(new Animated.Value(durakOfseti(y, baslangic))).current;
  const anlik = useRef(durakOfseti(y, baslangic));
  const tutulan = useRef(0);
  const kaydirma = useRef(0);
  const liste = useRef<ScrollView>(null);
  const yRef = useRef(y);
  yRef.current = y;

  useEffect(() => {
    const dinleyici = ofset.addListener(({ value }) => {
      anlik.current = value;
    });
    return () => ofset.removeListener(dinleyici);
  }, [ofset]);

  // Ölçüler değişince (ilk ölçüm, ekran döndürme) yaprak bulunduğu durağa oturur.
  useEffect(() => {
    ofset.setValue(durakOfseti(y, durumRef.current));
    onDurum?.(durumRef.current, y[durumRef.current]);
    // onDurum bilerek bağımlılıkta yok: her çizimde yeniden kurulmasın.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y, ofset]);

  const git = useCallback(
    (hedef: YaprakDurumu) => {
      durumRef.current = hedef;
      setDurum(hedef);
      onDurum?.(hedef, yRef.current[hedef]);
      if (hedef !== 'acik') liste.current?.scrollTo({ y: 0, animated: false });
      Animated.spring(ofset, {
        toValue: durakOfseti(yRef.current, hedef),
        useNativeDriver: false,
        damping: 24,
        stiffness: 240,
        mass: 0.9,
      }).start();
    },
    [ofset, onDurum],
  );

  const yakalamali = (dx: number, dy: number) => {
    if (Math.abs(dy) < KARAR_ESIGI || Math.abs(dy) < Math.abs(dx)) return false;
    if (durumRef.current !== 'acik') return true;
    // Açıkken: liste tepedeyken aşağı çekiş yaprağın, gerisi listenin.
    return dy > 0 && kaydirma.current <= 0;
  };

  const surukleme = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => yakalamali(g.dx, g.dy),
        onMoveShouldSetPanResponder: (_, g) => yakalamali(g.dx, g.dy),
        onPanResponderGrant: () => {
          ofset.stopAnimation();
          tutulan.current = anlik.current;
        },
        onPanResponderMove: (_, g) => {
          ofset.setValue(sinirla(tutulan.current + g.dy, yRef.current));
        },
        onPanResponderRelease: (_, g) => {
          git(hedefDurak(tutulan.current + g.dy, g.vy, yRef.current));
        },
        onPanResponderTerminate: (_, g) => {
          git(hedefDurak(tutulan.current + g.dy, g.vy, yRef.current));
        },
        // Sürükleme başladıysa liste ya da bir satır onu elinden alamasın.
        onPanResponderTerminationRequest: () => false,
      }),
    // yakalamali ref'lerden okuyor; yeniden kurmaya gerek yok.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ofset, git],
  );

  const kaydirildi = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    kaydirma.current = e.nativeEvent.contentOffset.y;
  }, []);

  return (
    <Animated.View
      {...surukleme.panHandlers}
      style={[
        stiller.yaprak,
        { height: y.acik, backgroundColor: tema.yuzey, transform: [{ translateY: ofset }] },
        stil,
      ]}
    >
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
