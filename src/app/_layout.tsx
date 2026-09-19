import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTema } from '@/lib/tema';

export default function KokDuzen() {
  const tema = useTema();
  return (
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
  );
}
