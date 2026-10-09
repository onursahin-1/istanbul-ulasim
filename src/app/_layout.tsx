import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AcilisAnimasyonu } from '@/components/logo';
import { gorselleriHazirla } from '@/components/ulasim';
import { bildirimleriHazirla } from '@/lib/bildirim';
import { temaTercihiniYukle } from '@/lib/kayitlar';
import { useTema } from '@/lib/tema';

// Bildirimin uygulama açıkken de banner olarak görünmesi için tek seferlik kurulum.
bildirimleriHazirla();
// Ayarlar › Görünüm'deki tercih (Sistem / Açık / Koyu); ilk ekran çizilmeden uygulanır.
temaTercihiniYukle();
// Sistemin sabit açılış ekranı (düz yeşil) açılış animasyonu çizilene kadar kalır; animasyon
// tam o kareden başlar.
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ fade: false });
// Hat logoları ve simgeler açılış animasyonu sürerken telefona iniyor (bkz. lib/gorseller).
gorselleriHazirla();

/** Animasyon bir sebeple bitmezse (hata, takılma) katman en geç bu sürede kalkar. */
const ACILIS_EN_GEC_MS = 4000;

export default function KokDuzen() {
  const tema = useTema();
  // Açılış animasyonu yalnız uygulama sıfırdan açılırken: kök düzen bir kez kuruluyor,
  // arka plandan dönüşte yeniden kurulmuyor.
  const [acilis, setAcilis] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setAcilis(false);
      SplashScreen.hideAsync().catch(() => {});
    }, ACILIS_EN_GEC_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    // Alt yaprağın sürüklemesi gesture handler ile çalışıyor; kök bununla sarılı olmalı.
    <GestureHandlerRootView style={stiller.kok}>
      <SafeAreaProvider>
        {/* Durum çubuğu da temayı izler: koyu temada saat ve simgeler beyaz olur. */}
        <StatusBar style={tema.koyu ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tema.zemin },
            // iPhone'da sistemin kendi geçişi (arkadaki ekran hafifçe kayar ve kararır,
            // kenardan kaydırınca parmakla birlikte geri gelir); Android'de sağdan kayma.
            animation: Platform.OS === 'ios' ? 'default' : 'slide_from_right',
          }}
        >
          {/* Arama ekranı yerinde açılır (soluklaşarak): kutu ana sayfadaki yerinden kendi
              yerine kayar, göz onu kaybetmez. */}
          <Stack.Screen name="ara" options={{ animation: 'fade', animationDuration: 220 }} />
        </Stack>
        {/* Ana ekran arkada yükleniyor; animasyon onu geciktirmiyor, bitince açıyor. */}
        {acilis && (
          <AcilisAnimasyonu
            onHazir={() => SplashScreen.hideAsync().catch(() => {})}
            onBitti={() => setAcilis(false)}
          />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const stiller = StyleSheet.create({ kok: { flex: 1 } });
