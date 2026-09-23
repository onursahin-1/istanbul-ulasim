// Ekranlarda ortak kullanılan küçük bileşenler.
// Hepsi temayı kendisi okur; çağıran ekranın renk geçirmesine gerek yok.

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { CanliBilgi, CanliSinif } from '@/lib/canli';
import { tazelikYaz } from '@/lib/onbellek';
import { istanbulSaatiYaz, kalkisGosterimi } from '@/lib/zaman';
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
/**
 * Rozetin ihtiyacı olan en az bilgi. `Hat` bunu karşılıyor, ama ağ haritası gibi
 * veriyi doğrudan GTFS'ten alan yerlerde gtfsId olmuyor; rozet için de gerekmiyor.
 */
export type RozetHatti = {
  shortName?: string | null;
  color?: string | null;
  textColor?: string | null;
  mode?: string | null;
  agency?: { name: string } | null;
};

export function HatRozeti({ hat, kucuk = false }: { hat?: RozetHatti | string | null; kucuk?: boolean }) {
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

/**
 * Sunucuya ulaşılamadığında, ekrandaki bilginin onbellekten geldiğini söyleyen şerit.
 *
 * Sessizce eski veri göstermek en kötüsü: yolcu kaçırdığı seferi uygulamaya yazar.
 * Şerit hem kaynağı hem de kaydın yaşını açıkça söylüyor.
 */
export function CevrimdisiSerit({ zaman, tekrarDene }: { zaman: number; tekrarDene?: () => void }) {
  const tema = useTema();
  const [simdi, setSimdi] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setSimdi(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={[stil.cevrimdisi, { backgroundColor: tema.uyariAcik }]}>
      <Ikon ad="cloud-offline-outline" boyut={16} renkKodu={tema.soluk} />
      <Text style={[stil.cevrimdisiYazi, { color: tema.yazi }]} numberOfLines={2}>
        Sunucuya ulaşılamıyor — {tazelikYaz({ zaman }, simdi)} bilgi gösteriliyor.
      </Text>
      {tekrarDene && (
        <Pressable onPress={tekrarDene} accessibilityRole="button" hitSlop={8}>
          <Text style={[stil.cevrimdisiDene, { color: tema.vurgu }]}>Yenile</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Canlı kalkışın rengi: zamanında, geç, çok geç, erken. */
export function canliRenk(sinif: CanliSinif, tema: Tema): string {
  if (sinif === 'gec') return tema.uyari;
  if (sinif === 'cokGec') return tema.hata;
  if (sinif === 'erken') return tema.konum;
  return tema.vurgu;
}

/** Sistemde "hareketi azalt" açıksa animasyonları durdurmak için. */
function useHareketAzalt(): boolean {
  const [azalt, setAzalt] = useState(false);
  useEffect(() => {
    let acik = true;
    AccessibilityInfo.isReduceMotionEnabled().then((d) => acik && setAzalt(d));
    const abone = AccessibilityInfo.addEventListener('reduceMotionChanged', setAzalt);
    return () => {
      acik = false;
      abone.remove();
    };
  }, []);
  return azalt;
}

/**
 * Canlı veriyi gösteren nabız noktası: dolu bir nokta ve etrafında yayılıp sönen
 * bir halka. Sabit bir nokta "seçili" ya da "okunmamış" gibi okunabiliyor;
 * atan halka "şu an geliyor" diyor.
 */
export function NabizNoktasi({ renk, boyut = 7 }: { renk: string; boyut?: number }) {
  const azalt = useHareketAzalt();
  const ilerleme = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (azalt) return;
    const dongu = Animated.loop(Animated.timing(ilerleme, { toValue: 1, duration: 1800, useNativeDriver: true }));
    dongu.start();
    return () => dongu.stop();
  }, [azalt, ilerleme]);
  const halka = boyut * 2.2;
  return (
    <View style={{ width: halka, height: halka, alignItems: 'center', justifyContent: 'center' }}>
      {!azalt && (
        <Animated.View
          style={{
            position: 'absolute',
            width: halka,
            height: halka,
            borderRadius: halka / 2,
            borderWidth: 1.5,
            borderColor: renk,
            opacity: ilerleme.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
            transform: [{ scale: ilerleme.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }],
          }}
        />
      )}
      <View style={{ width: boyut, height: boyut, borderRadius: boyut / 2, backgroundColor: renk }} />
    </View>
  );
}

/**
 * Bir kalkışın ne zaman olduğu: bir saatten yakınsa "7 dk", uzaksa "05:51".
 *
 * Canlıysa önünde nabız noktası durur ve rakam gecikmenin rengini alır.
 *
 * @param an kalkışın mutlak anı, Unix saniyesi (serviceDay + saniye). Dakika değil
 *           an alınıyor: saat yuvarlanmış dakikadan geri hesaplanırsa bir dakika kayıyor.
 */
export function Dakika({ an, canli, style }: { an: number; canli?: CanliBilgi | null; style?: StyleProp<ViewStyle> }) {
  const tema = useTema();
  const g = kalkisGosterimi(an);
  const renk = canli ? canliRenk(canli.sinif, tema) : g.dakika <= 3 ? tema.vurgu : tema.yazi;
  const etiket = canli ? `${g.seslendirme}, canlı, ${canli.metin}` : g.seslendirme;
  return (
    <View style={[stil.dakika, style]} accessible accessibilityLabel={etiket}>
      {canli && <NabizNoktasi renk={renk} />}
      <View style={stil.dakikaMetin}>
        <Text style={[stil.dakikaSayi, { color: renk }]}>{g.metin}</Text>
        {g.birim && <Text style={[stil.dakikaBirim, { color: tema.soluk }]}>{g.birim}</Text>}
      </View>
    </View>
  );
}

/**
 * Canlı kalkışın açıklaması: "07:45 · 3 dk gecikmeli". `an` verilmezse yalnız
 * gecikme yazılır (dar yerler için; saat zaten sağdaki dakikada).
 */
export function CanliAciklama({ canli, an, style }: { canli: CanliBilgi; an?: number; style?: StyleProp<TextStyle> }) {
  const tema = useTema();
  const metin = an != null ? `${istanbulSaatiYaz(an)} · ${canli.metin}` : canli.metin;
  return (
    <Text style={[stil.canliYazi, { color: canliRenk(canli.sinif, tema) }, style]} numberOfLines={1}>
      {metin}
    </Text>
  );
}

/**
 * Canlı verisi olmayan kalkış: "tarifeye göre". Aynı listede canlı kalkışlar
 * varken hangisinin tahmin olduğunu açıkça söylemek için.
 */
export function TarifeEtiketi({ saat }: { saat?: string }) {
  const tema = useTema();
  return (
    <View style={stil.tarifeEtiketi}>
      <Ionicons name="time-outline" size={11} color={tema.soluk} />
      <Text style={[stil.canliYazi, { color: tema.soluk }]} numberOfLines={1}>
        {saat ? `tarifeye göre · ${saat}` : 'tarifeye göre'}
      </Text>
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
  cevrimdisi: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 12,
  },
  cevrimdisiYazi: { flex: 1, fontSize: 13, lineHeight: 18 },
  cevrimdisiDene: { fontSize: 13, fontWeight: '600' },
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
  dakika: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 44, justifyContent: 'flex-end' },
  dakikaMetin: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  canliYazi: { fontSize: 12, fontWeight: '600' },
  tarifeEtiketi: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dakikaSayi: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dakikaBirim: { fontSize: 11, fontWeight: '500' },
});
