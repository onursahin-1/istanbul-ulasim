import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { renk } from '@/lib/tema';

export default function KokDuzen() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: renk.zemin },
          animation: 'slide_from_right',
        }}
      />
    </SafeAreaProvider>
  );
}
