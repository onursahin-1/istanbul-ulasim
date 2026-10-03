// Raylı sistem şeması: Metro İstanbul'un resmî ağ haritası (Temmuz 2026), yakınlaştırılabilir.
//
// Ağ haritası ekranındaki harita gerçek coğrafya; bu ekran istasyonları ve aktarmaları
// sade bir şemada gösteriyor (yapımı süren hatlar dahil). Görsel PDF'ten 4000 piksel
// genişlikte basıldı: iki parmakla ya da çift dokunarak yakınlaştırınca istasyon adları
// okunuyor. İnternet gerekmiyor, uygulamayla geliyor.

import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStiller } from '@/components/ulasim';
import { useTema, type Tema } from '@/lib/tema';

const SEMA = require('@/assets/images/ag-semasi.jpg');
const ORAN = 4004 / 2536;
const EN_FAZLA = 6;
/** Çift dokununca bu kadar yakınlaşır; yakınken çift dokunmak geri uzaklaştırır. */
const CIFT_DOKUNMA = 3;

export default function AgSemasiEkrani() {
  const tema = useTema();
  const s = useStiller(stiller);
  const kenar = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const boy = width / ORAN;
  const kaydirma = useRef<ScrollView>(null);
  const [yakin, setYakin] = useState(false);

  // iOS'un yakınlaştırma desteği ScrollView'da yerleşik (iki parmak); çift dokunma elle.
  const yakinlastir = (x: number, y: number) => {
    const sv = kaydirma.current as unknown as {
      scrollResponderZoomTo?: (r: { x: number; y: number; width: number; height: number; animated?: boolean }) => void;
    } | null;
    if (yakin) {
      sv?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height: boy, animated: true });
      setYakin(false);
      return;
    }
    const w = width / CIFT_DOKUNMA;
    const h = boy / CIFT_DOKUNMA;
    sv?.scrollResponderZoomTo?.({ x: x - w / 2, y: y - h / 2, width: w, height: h, animated: true });
    setYakin(true);
  };
  const ciftDokunma = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd((e) => yakinlastir(e.x, e.y));

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Raylı sistem şeması',
          headerBackTitle: 'Ağ haritası',
          headerTintColor: tema.vurgu,
          headerTitleStyle: { color: tema.yazi },
          headerStyle: { backgroundColor: tema.zemin },
          headerShadowVisible: false,
          headerTransparent: false,
        }}
      />
      <View style={s.kok}>
        <ScrollView
          ref={kaydirma}
          style={{ flex: 1 }}
          contentContainerStyle={s.icerik}
          maximumZoomScale={EN_FAZLA}
          minimumZoomScale={1}
          bouncesZoom
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={(e) => {
            const z = e.nativeEvent.zoomScale ?? 1;
            if ((z > 1.05) !== yakin) setYakin(z > 1.05);
          }}
        >
          <GestureDetector gesture={ciftDokunma}>
            <Image
              source={SEMA}
              style={{ width, height: boy }}
              resizeMode="contain"
              accessible
              accessibilityLabel="İstanbul raylı sistemler ağ haritası"
            />
          </GestureDetector>
        </ScrollView>
        <Text style={[s.dipnot, { paddingBottom: kenar.bottom + 10 }]}>
          İki parmakla ya da çift dokunarak yakınlaştır. Harita: © Metro İstanbul, İBB · Temmuz 2026
        </Text>
      </View>
    </>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    icerik: { flexGrow: 1, justifyContent: 'center' },
    dipnot: { fontSize: 12, color: t.soluk, textAlign: 'center', paddingHorizontal: 16, paddingTop: 8 },
  });
