// Ayarlar › Hakkında: rota sunucusunun durumu, tarifenin kapsadığı tarihler, yer verisi ve
// sürüm. Teknik bilgiler Ayarlar'ı kalabalıklaştırmasın diye ayrı ekranda; görünüm
// iPhone'un Ayarlar uygulamasındaki gibi: üstte sistem başlığı ve geri düğmesi, altta
// gruplanmış satırlar (solda etiket, sağda değer), grupların altında açıklama.

import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/dokun';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStiller } from '@/components/ulasim';
import { OTP_ADRESI, sunucuBilgisiGetir, type SunucuBilgisi } from '@/lib/otp';
import { poiBilgisi } from '@/lib/poi';
import { useTema, type Tema } from '@/lib/tema';

/** Verideki yazımı düzeltir: "IETT" → "İETT", "Şehirhatları A.Ş." → "Şehir Hatları", "Minibus" → "Minibüs". */
function isletmeciAdiDuzelt(ad: string): string {
  const temiz = ad.trim().replace(/\s+A\.Ş\.?$/i, '');
  const buyuk = temiz.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
  if (buyuk === 'IETT' || buyuk === 'İETT') return 'İETT';
  if (buyuk === 'IDO' || buyuk === 'İDO') return 'İDO';
  if (buyuk === 'ŞEHİRHATLARI') return 'Şehir Hatları';
  if (buyuk === 'MİNİBUS' || buyuk === 'MİNİBÜS') return 'Minibüs';
  if (buyuk === 'TAKSİDOLMUS' || buyuk === 'TAKSİDOLMUŞ') return 'Taksi dolmuş';
  // Marmaray verisinde aynı işletmeci iki adla geçiyor.
  if (buyuk === 'TCDD') return 'TCDD Taşımacılık';
  return temiz;
}

function tarihYaz(saniye?: number | null): string {
  if (!saniye) return '—';
  return new Date(saniye * 1000).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function HakkindaEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);

  const [sunucu, setSunucu] = useState<SunucuBilgisi | null>(null);
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const [poi, setPoi] = useState<{ nokta: number; kaynak: string } | null>(null);
  const [cekiliyor, setCekiliyor] = useState(false);
  const [yenileniyor, setYenileniyor] = useState(false);
  const [sonYenileme, setSonYenileme] = useState<Date | null>(null);

  const yukle = useCallback(async () => {
    setSunucuHatasi(null);
    try {
      setSunucu(await sunucuBilgisiGetir());
    } catch (e) {
      setSunucu(null);
      setSunucuHatasi((e as Error).message ?? 'Sunucuya ulaşılamadı.');
    }
    setPoi(await poiBilgisi());
  }, []);

  useEffect(() => {
    yukle();
  }, [yukle]);

  // Yenileme sürerken satırda gösterge, bitince saati yazılıyor: sunucu aynı cevabı verince
  // ekranda hiçbir şey değişmiyor, düğme çalışmıyor gibi görünmesin.
  const yenile = useCallback(async () => {
    if (yenileniyor) return;
    setYenileniyor(true);
    try {
      await yukle();
    } finally {
      setYenileniyor(false);
      setSonYenileme(new Date());
    }
  }, [yenileniyor, yukle]);

  const aralik = sunucu?.serviceTimeRange;
  const isletmeciler = [
    ...new Set((sunucu?.feeds ?? []).flatMap((b) => (b.agencies ?? []).map((a) => isletmeciAdiDuzelt(a.name)))),
  ].sort((a, b) => a.localeCompare(b, 'tr'));

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Hakkında',
          headerBackTitle: 'Ayarlar',
          headerTintColor: tema.vurgu,
          headerTitleStyle: { color: tema.yazi },
          headerStyle: { backgroundColor: tema.zemin },
          headerShadowVisible: false,
          headerTransparent: false,
        }}
      />
      <ScrollView
        style={s.kok}
        contentContainerStyle={{ paddingBottom: kenar.bottom + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={cekiliyor}
            tintColor={tema.vurgu}
            onRefresh={async () => {
              setCekiliyor(true);
              await yenile();
              setCekiliyor(false);
            }}
          />
        }
      >
        <Grup
          baslik="Rota sunucusu"
          dipnot={sunucuHatasi ?? undefined}
          dipnotHata
        >
          <Satir etiket="Durum">
            <View style={s.durum}>
              <View style={[s.nokta, { backgroundColor: sunucu ? tema.vurgu : tema.hata }]} />
              <Text style={s.deger}>{sunucu ? 'Bağlı' : 'Ulaşılamıyor'}</Text>
            </View>
          </Satir>
          <Satir etiket="Adres" deger={OTP_ADRESI} son />
        </Grup>

        <Grup baslik="Tarife verisi">
          <Satir etiket="Başlangıç" deger={tarihYaz(aralik?.start)} />
          <Satir etiket="Bitiş" deger={tarihYaz(aralik?.end)} son={!isletmeciler.length} />
          {/* Besleme numarası (1, 2) yolcuya bir şey söylemiyor; işletmeciler alt alta, sığmayınca satır uzar. */}
          {isletmeciler.length > 0 && <Satir etiket="İşletmeciler" deger={isletmeciler.join(', ')} altta son />}
        </Grup>

        <Grup baslik="Yer verisi">
          <Satir etiket="Aranabilir yer" deger={poi ? poi.nokta.toLocaleString('tr-TR') : '—'} />
          <Satir etiket="Kaynak" deger={poi?.kaynak ?? 'OpenStreetMap'} son />
        </Grup>

        <Grup
          baslik="Uygulama"
          dipnot={
            sonYenileme && !yenileniyor
              ? `Son yenileme ${sonYenileme.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · rota sunucusu ${sunucu ? 'bağlı' : 'ulaşılamıyor'}`
              : undefined
          }
        >
          <Satir etiket="Sürüm" deger={Constants.expoConfig?.version ?? '—'} />
          <Pressable
            onPress={yenile}
            disabled={yenileniyor}
            style={({ pressed }) => [s.satir, pressed && { backgroundColor: tema.cizgiSilik }]}
            accessibilityRole="button"
            accessibilityState={{ busy: yenileniyor, disabled: yenileniyor }}
          >
            <Text style={[s.etiket, { color: tema.vurgu }]}>{yenileniyor ? 'Yenileniyor…' : 'Bilgileri yenile'}</Text>
            {yenileniyor && <ActivityIndicator size="small" color={tema.vurgu} />}
          </Pressable>
        </Grup>
      </ScrollView>
    </>
  );
}

/** Başlığı, satırları ve dipnotu olan grup (iPhone Ayarlar'ındaki gibi). */
function Grup({
  baslik,
  dipnot,
  dipnotHata = false,
  children,
}: {
  baslik: string;
  dipnot?: string;
  dipnotHata?: boolean;
  children: ReactNode;
}) {
  const tema = useTema();
  const s = useStiller(stiller);
  return (
    <View style={s.grup}>
      <Text style={s.grupBaslik}>{baslik.toLocaleUpperCase('tr-TR')}</Text>
      <View style={s.kutu}>{children}</View>
      {!!dipnot && <Text style={[s.dipnot, dipnotHata && { color: tema.hata }]}>{dipnot}</Text>}
    </View>
  );
}

/**
 * Solda etiket, sağda değer; son satırın altında ayraç yok. `altta`: uzun değer
 * etiketin altına, gerektiği kadar satıra yayılır (iPhone Ayarlar'ındaki alt yazılı satır).
 */
function Satir({
  etiket,
  deger,
  son = false,
  altta = false,
  children,
}: {
  etiket: string;
  deger?: string;
  son?: boolean;
  altta?: boolean;
  children?: ReactNode;
}) {
  const s = useStiller(stiller);
  return (
    <View style={[s.satir, altta && s.satirAltta]}>
      <Text style={s.etiket}>{etiket}</Text>
      {children ??
        (altta ? (
          <Text style={s.degerAltta}>{deger}</Text>
        ) : (
          <Text style={s.deger} numberOfLines={1}>
            {deger}
          </Text>
        ))}
      {/* Ayraç iPhone'daki gibi yazının hizasından başlıyor. */}
      {!son && <View style={s.ayrac} />}
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    grup: { marginTop: 18 },
    grupBaslik: { fontSize: 12.5, color: t.soluk, paddingHorizontal: 32, paddingBottom: 6, letterSpacing: 0.3 },
    kutu: { marginHorizontal: 16, backgroundColor: t.yuzey, borderRadius: 12, overflow: 'hidden' },
    satir: {
      minHeight: 46,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 11,
    },
    ayrac: { position: 'absolute', left: 16, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: t.cizgi },
    satirAltta: { flexDirection: 'column', alignItems: 'stretch', gap: 3 },
    etiket: { fontSize: 16, color: t.yazi },
    degerAltta: { fontSize: 15, color: t.soluk, lineHeight: 21 },
    deger: { fontSize: 16, color: t.soluk, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
    durum: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    nokta: { width: 8, height: 8, borderRadius: 4 },
    dipnot: { fontSize: 12.5, color: t.soluk, lineHeight: 17, paddingHorizontal: 32, paddingTop: 7 },
  });
