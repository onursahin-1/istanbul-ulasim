// Ekranlarda ortak kullanılan küçük bileşenler.

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Bacak } from '@/lib/otp';
import { hatRengi, metrobusMu, renk } from '@/lib/tema';

export type IkonAdi = ComponentProps<typeof Ionicons>['name'];

export function Ikon({ ad, boyut = 20, renkKodu = renk.yazi }: { ad: IkonAdi; boyut?: number; renkKodu?: string }) {
  return <Ionicons name={ad} size={boyut} color={renkKodu} />;
}

/** Hat numarasını kendi renginde gösteren rozet. Metrobüs hatlarında otobüs simgesi de çıkar. */
export function HatRozeti({ kisaAd, kucuk = false }: { kisaAd?: string | null; kucuk?: boolean }) {
  return (
    <View style={[stil.rozet, kucuk && stil.rozetKucuk, { backgroundColor: hatRengi(kisaAd) }]}>
      {metrobusMu(kisaAd) && <Ionicons name="bus" size={kucuk ? 11 : 13} color="#fff" />}
      <Text style={[stil.rozetYazi, kucuk && stil.rozetYaziKucuk]}>{kisaAd ?? '?'}</Text>
    </View>
  );
}

/** Bir güzergâhın bacaklarını "yürü 3 › 8A › 34G" biçiminde sıralar. */
export function BacakZinciri({ bacaklar }: { bacaklar: Bacak[] }) {
  const gorunen = bacaklar.filter((b) => b.transitLeg || (b.duration ?? 0) >= 60);
  return (
    <View style={stil.zincir}>
      {gorunen.map((b, i) => (
        <View key={i} style={stil.zincirParca}>
          {i > 0 && <Ikon ad="chevron-forward" boyut={12} renkKodu="#aab6b0" />}
          {b.transitLeg ? (
            <HatRozeti kisaAd={b.route?.shortName} />
          ) : (
            <View style={stil.yuru}>
              <Ikon ad="walk" boyut={15} renkKodu={renk.soluk} />
              <Text style={stil.yuruYazi}>{Math.round((b.duration ?? 0) / 60)}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** Güzergâhın ne kadarının hangi araçta geçtiğini gösteren oransal şerit. */
export function SureSeridi({ bacaklar }: { bacaklar: Bacak[] }) {
  return (
    <View style={stil.serit}>
      {bacaklar.map((b, i) => (
        <View
          key={i}
          style={{
            flex: Math.max(b.duration ?? 1, 1),
            backgroundColor: b.transitLeg ? hatRengi(b.route?.shortName) : '#cfd8d3',
          }}
        />
      ))}
    </View>
  );
}

export function GeriCubugu({ baslik, sag }: { baslik: string; sag?: ReactNode }) {
  return (
    <View style={stil.geriCubugu}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Geri"
        hitSlop={12}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      >
        <Ikon ad="chevron-back" boyut={26} />
      </Pressable>
      <Text style={stil.geriBaslik} numberOfLines={1}>
        {baslik}
      </Text>
      {sag}
    </View>
  );
}

export function Yukleniyor({ metin }: { metin: string }) {
  return (
    <View style={stil.durumKutusu}>
      <ActivityIndicator color={renk.vurgu} />
      <Text style={stil.durumYazi}>{metin}</Text>
    </View>
  );
}

export function HataKutusu({ mesaj, tekrarDene }: { mesaj: string; tekrarDene?: () => void }) {
  return (
    <View style={[stil.durumKutusu, stil.hataKutusu]}>
      <Ikon ad="alert-circle" renkKodu={renk.hata} />
      <Text style={[stil.durumYazi, { color: renk.hata }]}>{mesaj}</Text>
      {tekrarDene && (
        <Pressable onPress={tekrarDene} style={stil.tekrarDugme} accessibilityRole="button">
          <Text style={stil.tekrarYazi}>Tekrar dene</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Dakika({ dakika, style }: { dakika: number; style?: StyleProp<ViewStyle> }) {
  const yakin = dakika <= 3;
  return (
    <View style={[stil.dakika, style]}>
      <Text style={[stil.dakikaSayi, yakin && { color: renk.vurgu }]}>{dakika <= 0 ? 'Şimdi' : dakika}</Text>
      {dakika > 0 && <Text style={stil.dakikaBirim}>dk</Text>}
    </View>
  );
}

export const stil = StyleSheet.create({
  rozet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignSelf: 'flex-start',
  },
  rozetKucuk: { height: 21, paddingHorizontal: 6, borderRadius: 6 },
  rozetYazi: { color: '#fff', fontWeight: '700', fontSize: 12.5, fontVariant: ['tabular-nums'] },
  rozetYaziKucuk: { fontSize: 11.5 },
  zincir: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 6 },
  zincirParca: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  yuru: { flexDirection: 'row', alignItems: 'center' },
  yuruYazi: { color: renk.soluk, fontSize: 12, fontWeight: '600' },
  serit: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  geriCubugu: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  geriBaslik: { flex: 1, fontSize: 18, fontWeight: '700', color: renk.yazi },
  durumKutusu: { padding: 20, alignItems: 'center', gap: 10 },
  hataKutusu: { backgroundColor: renk.hataAcik, borderRadius: 14, margin: 12 },
  durumYazi: { color: renk.soluk, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  tekrarDugme: { backgroundColor: renk.yuzey, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  tekrarYazi: { color: renk.yazi, fontWeight: '700' },
  dakika: { flexDirection: 'row', alignItems: 'baseline', gap: 2, minWidth: 44, justifyContent: 'flex-end' },
  dakikaSayi: { fontSize: 15, fontWeight: '700', color: renk.yazi, fontVariant: ['tabular-nums'] },
  dakikaBirim: { fontSize: 11, color: renk.soluk, fontWeight: '500' },
});
