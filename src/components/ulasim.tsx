// Ekranlarda ortak kullanılan küçük bileşenler.
// Hepsi temayı kendisi okur; çağıran ekranın renk geçirmesine gerek yok.

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { Bacak, Hat } from '@/lib/otp';
import { aracSimgesi, hatEtiketi, hatRengi, metrobusMu, rozetRenkleri, useTema, type Tema } from '@/lib/tema';

export type IkonAdi = ComponentProps<typeof Ionicons>['name'];

export function Ikon({ ad, boyut = 20, renkKodu }: { ad: IkonAdi; boyut?: number; renkKodu?: string }) {
  const tema = useTema();
  return <Ionicons name={ad} size={boyut} color={renkKodu ?? tema.yazi} />;
}

/**
 * Hat rozeti: solda araç tipinin simgesi hat renginde bir kutuda, sağda hattın kimliği.
 *
 * Renk küçük kutuda yoğunlaşıyor, yazı açık bir zeminde duruyor. Sebebi: rozetler yan
 * yana diziliyor (bacak zinciri, durak ekranındaki hat listesi) ve hepsi dolu renk
 * olunca satır rengârenk bir şeride dönüşüp hiçbir hat öne çıkmıyordu.
 *
 * Rozette yazan metin `hatEtiketi` ile belirleniyor: minibüs ve dolmuş hatlarının
 * "kısa adı" güzergâhın tamamı olduğu için onlarda araç tipi yazıyor.
 */
export function HatRozeti({ hat, kucuk = false }: { hat?: Hat | string | null; kucuk?: boolean }) {
  const tema = useTema();
  const kisaAd = typeof hat === 'string' ? hat : hat?.shortName;
  const tur = typeof hat === 'string' ? null : hat?.mode;
  const isletmeci = typeof hat === 'string' ? null : hat?.agency?.name;
  const { rozet } = hatEtiketi(kisaAd, tur, isletmeci);
  const renkler = rozetRenkleri(hat, tema);
  const simge = tur && tur.toUpperCase() !== 'BUS' ? aracSimgesi(tur) : metrobusMu(kisaAd) ? 'bus' : 'bus';
  const boy = kucuk ? 22 : 26;
  return (
    <View style={[stil.rozet, { backgroundColor: renkler.zemin, height: boy, borderRadius: kucuk ? 7 : 8 }]}>
      <View style={[stil.rozetKutu, { backgroundColor: renkler.kutu, width: boy, height: boy }]}>
        <Ionicons name={simge as IkonAdi} size={kucuk ? 12 : 14} color={renkler.kutuYazi} />
      </View>
      <Text
        style={[stil.rozetYazi, kucuk && stil.rozetYaziKucuk, { color: renkler.yazi }]}
        numberOfLines={1}
      >
        {rozet}
      </Text>
    </View>
  );
}

/** Bir güzergâhın bacaklarını "yürü 3 › 8A › 34G" biçiminde sıralar. */
export function BacakZinciri({ bacaklar }: { bacaklar: Bacak[] }) {
  const tema = useTema();
  const gorunen = bacaklar.filter((b) => b.transitLeg || (b.duration ?? 0) >= 60);
  return (
    <View style={stil.zincir}>
      {gorunen.map((b, i) => (
        <View key={i} style={stil.zincirParca}>
          {i > 0 && <Ikon ad="chevron-forward" boyut={12} renkKodu={tema.yurume} />}
          {b.transitLeg ? (
            <HatRozeti hat={b.route} />
          ) : (
            <View style={stil.yuru}>
              <Ikon ad="walk" boyut={15} renkKodu={tema.soluk} />
              <Text style={[stil.yuruYazi, { color: tema.soluk }]}>{Math.round((b.duration ?? 0) / 60)}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** Güzergâhın ne kadarının hangi araçta geçtiğini gösteren oransal şerit. */
export function SureSeridi({ bacaklar }: { bacaklar: Bacak[] }) {
  const tema = useTema();
  return (
    <View style={stil.serit}>
      {bacaklar.map((b, i) => (
        <View
          key={i}
          style={{
            flex: Math.max(b.duration ?? 1, 1),
            backgroundColor: b.transitLeg ? hatRengi(b.route, tema) : tema.cizgi,
          }}
        />
      ))}
    </View>
  );
}

export function GeriCubugu({ baslik, sag }: { baslik: string; sag?: ReactNode }) {
  const tema = useTema();
  return (
    <View style={stil.geriCubugu}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Geri"
        hitSlop={12}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(sekmeler)'))}
      >
        <Ikon ad="chevron-back" boyut={26} />
      </Pressable>
      <Text style={[stil.geriBaslik, { color: tema.yazi }]} numberOfLines={1}>
        {baslik}
      </Text>
      {sag}
    </View>
  );
}

export function Yukleniyor({ metin }: { metin: string }) {
  const tema = useTema();
  return (
    <View style={stil.durumKutusu}>
      <ActivityIndicator color={tema.vurgu} />
      <Text style={[stil.durumYazi, { color: tema.soluk }]}>{metin}</Text>
    </View>
  );
}

export function HataKutusu({ mesaj, tekrarDene }: { mesaj: string; tekrarDene?: () => void }) {
  const tema = useTema();
  return (
    <View style={[stil.durumKutusu, { backgroundColor: tema.hataAcik, borderRadius: 14, margin: 12 }]}>
      <Ikon ad="alert-circle" renkKodu={tema.hata} />
      <Text style={[stil.durumYazi, { color: tema.hata }]}>{mesaj}</Text>
      {tekrarDene && (
        <Pressable onPress={tekrarDene} style={[stil.tekrarDugme, { backgroundColor: tema.yuzey }]} accessibilityRole="button">
          <Text style={[stil.tekrarYazi, { color: tema.yazi }]}>Tekrar dene</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Dakika({ dakika, style }: { dakika: number; style?: StyleProp<ViewStyle> }) {
  const tema = useTema();
  const yakin = dakika <= 3;
  return (
    <View style={[stil.dakika, style]}>
      <Text style={[stil.dakikaSayi, { color: yakin ? tema.vurgu : tema.yazi }]}>{dakika <= 0 ? 'Şimdi' : dakika}</Text>
      {dakika > 0 && <Text style={[stil.dakikaBirim, { color: tema.soluk }]}>dk</Text>}
    </View>
  );
}

/**
 * Temaya bağlı stilleri belleğe alır. Ekranlar stil tablolarını modül düzeyinde
 * `const stiller = (t: Tema) => StyleSheet.create({...})` olarak yazar ve bununla çağırır;
 * tema değişince tablo bir kez yeniden üretilir.
 */
export function useStiller<T>(uret: (tema: Tema) => T): T {
  const tema = useTema();
  return useMemo(() => uret(tema), [tema, uret]);
}

const stil = StyleSheet.create({
  rozet: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', overflow: 'hidden' },
  rozetKutu: { alignItems: 'center', justifyContent: 'center' },
  rozetYazi: { fontWeight: '700', fontSize: 12.5, paddingHorizontal: 8, maxWidth: 110 },
  rozetYaziKucuk: { fontSize: 11.5, paddingHorizontal: 7 },
  zincir: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: 6 },
  zincirParca: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 4 },
  yuru: { flexDirection: 'row', alignItems: 'center' },
  yuruYazi: { fontSize: 12, fontWeight: '600' },
  serit: { flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', gap: 2 },
  geriCubugu: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  geriBaslik: { flex: 1, fontSize: 18, fontWeight: '700' },
  durumKutusu: { padding: 20, alignItems: 'center', gap: 10 },
  durumYazi: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  tekrarDugme: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  tekrarYazi: { fontWeight: '700' },
  dakika: { flexDirection: 'row', alignItems: 'baseline', gap: 2, minWidth: 44, justifyContent: 'flex-end' },
  dakikaSayi: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dakikaBirim: { fontSize: 11, fontWeight: '500' },
});
