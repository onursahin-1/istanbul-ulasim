import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Platform, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bildirimleriHazirla } from '@/lib/bildirim';
import { temaTercihiniYukle } from '@/lib/kayitlar';
import { useTema } from '@/lib/tema';

// Bildirimin uygulama açıkken de banner olarak görünmesi için tek seferlik kurulum.
bildirimleriHazirla();
// Ayarlar › Görünüm'deki tercih (Sistem / Açık / Koyu); ilk ekran çizilmeden uygulanır.
temaTercihiniYukle();

export default function KokDuzen() {
  const tema = useTema();
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
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const stiller = StyleSheet.create({ kok: { flex: 1 } });
