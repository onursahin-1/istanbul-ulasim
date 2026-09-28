// Alt sekme çubuğu. Arama, rota ve durak ekranları bu çubuğun üstünde tam ekran açılır.
// iPhone'daki gibi seçili sekmenin simgesi dolu, öbürleri çizgi.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { useTema } from '@/lib/tema';

export default function SekmeDuzeni() {
  const tema = useTema();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: tema.vurgu,
        tabBarInactiveTintColor: tema.soluk,
        tabBarStyle: {
          backgroundColor: tema.yuzey,
          borderTopColor: tema.cizgi,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Keşfet',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'compass' : 'compass-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="hatlar"
        options={{
          title: 'Hatlar',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'git-branch' : 'git-branch-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="kayitli"
        options={{
          title: 'Kayıtlı',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="ayarlar"
        options={{
          title: 'Ayarlar',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
