// Alt sekme çubuğu. Arama, rota ve durak ekranları bu çubuğun üstünde tam ekran açılır.
// iPhone'daki gibi seçili sekmenin simgesi dolu, öbürleri çizgi; seçilen simge yaylı zıplar.

import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { SekmeSimgesi } from '@/components/hareketli-simgeler';
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
            <SekmeSimgesi ad="compass-outline" doluAd="compass" secili={focused} renk={color} boyut={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="hatlar"
        options={{
          title: 'Hatlar',
          tabBarIcon: ({ color, size, focused }) => (
            <SekmeSimgesi ad="git-branch-outline" doluAd="git-branch" secili={focused} renk={color} boyut={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="kayitli"
        options={{
          title: 'Kayıtlı',
          tabBarIcon: ({ color, size, focused }) => (
            <SekmeSimgesi ad="bookmark-outline" doluAd="bookmark" secili={focused} renk={color} boyut={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="ayarlar"
        options={{
          title: 'Ayarlar',
          tabBarIcon: ({ color, size, focused }) => (
            <SekmeSimgesi ad="settings-outline" doluAd="settings" secili={focused} renk={color} boyut={size} />
          ),
        }}
      />
    </Tabs>
  );
}
