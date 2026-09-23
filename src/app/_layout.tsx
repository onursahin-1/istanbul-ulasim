import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bildirimleriHazirla } from '@/lib/bildirim';
import { useTema } from '@/lib/tema';

// Bildirimin uygulama açıkken de banner olarak görünmesi için tek seferlik kurulum.
bildirimleriHazirla();

export default function KokDuzen() {
  const tema = useTema();
  return (
    // Alt yaprağın sürüklemesi gesture handler ile çalışıyor; kök bununla sarılı olmalı.
    <GestureHandlerRootView style={stiller.kok}>
      <SafeAreaProvider>
        {/* Durum çubuğu da sistem temasını izler: koyu temada saat ve simgeler beyaz olur. */}
        <StatusBar style={tema.koyu ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: tema.zemin },
            animation: 'slide_from_right',
          }}
        />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const stiller = StyleSheet.create({ kok: { flex: 1 } });
