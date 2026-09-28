// Ayarlar › Hakkında: rota sunucusunun durumu, tarifenin kapsadığı tarihler, yer verisi ve
// sürüm. Teknik bilgiler Ayarlar'ı kalabalıklaştırmasın diye ayrı ekranda; görünüm
// iPhone'un Ayarlar uygulamasındaki gibi: üstte sistem başlığı ve geri düğmesi, altta
// gruplanmış satırlar (solda etiket, sağda değer), grupların altında açıklama.

import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useStiller } from '@/components/ulasim';
import { OTP_ADRESI, sunucuBilgisiGetir, type SunucuBilgisi } from '@/lib/otp';
import { poiBilgisi } from '@/lib/poi';
import { useTema, type Tema } from '@/lib/tema';

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
        }}
      />
      <ScrollView
        style={s.kok}
        contentContainerStyle={{ paddingBottom: kenar.bottom + 24 }}
        contentInsetAdjustmentBehavior="automatic"
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
          dipnot={
            sunucuHatasi ??
            'Rota motoru bilgisayarında çalışıyor. Evin dışından bağlanmak için telefonda ve bilgisayarda Tailscale açık olmalı, uygulama "npm run uzaktan" ile başlatılmalı.'
          }
          dipnotHata={!!sunucuHatasi}
        >
          <Satir etiket="Durum">
            <View style={s.durum}>
              <View style={[s.nokta, { backgroundColor: sunucu ? tema.vurgu : tema.hata }]} />
              <Text style={s.deger}>{sunucu ? 'Bağlı' : 'Ulaşılamıyor'}</Text>
            </View>
          </Satir>
          <Satir etiket="Adres" deger={OTP_ADRESI} son />
        </Grup>

        <Grup
          baslik="Tarife verisi"
          dipnot="Otobüs ve Metrobüs tarifesi İETT'nin güncel verisinden geliyor. Metro, tramvay, füniküler ve teleferik saatleri Metro İstanbul'un, vapurlar Şehir Hatları'nın, Turyol'un ve Dentur'un kendi güncel tarifesinden. Marmaray'ın saatleri TCDD'nin yayımladığı sıklıktan kuruluyor, İDO'nunkiler İBB'nin artık güncellemediği veriden geliyor; bu ikisi yaklaşıktır."
        >
          <Satir etiket="Başlangıç" deger={tarihYaz(aralik?.start)} />
          <Satir etiket="Bitiş" deger={tarihYaz(aralik?.end)} son={!sunucu?.feeds?.length} />
          {(sunucu?.feeds ?? []).map((b, i, hepsi) => (
            <Satir
              key={b.feedId}
              etiket={b.feedId}
              deger={(b.agencies ?? []).map((a) => a.name).join(', ') || '—'}
              son={i === hepsi.length - 1}
            />
          ))}
        </Grup>

        <Grup baslik="Yer verisi" dipnot="Yer araması telefonda yapılır; internet bağlantısı gerekmez.">
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

/** Solda etiket, sağda değer; son satırın altında ayraç yok. */
function Satir({ etiket, deger, son = false, children }: { etiket: string; deger?: string; son?: boolean; children?: ReactNode }) {
  const s = useStiller(stiller);
  return (
    <View style={s.satir}>
      <Text style={s.etiket}>{etiket}</Text>
      {children ?? (
        <Text style={s.deger} numberOfLines={1}>
          {deger}
        </Text>
      )}
      {/* Ayraç iPhone'daki gibi yazının hizasından başlıyor. */}
      {!son && <View style={s.ayrac} />}
    </View>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    grup: { marginTop: 22 },
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
    etiket: { fontSize: 16, color: t.yazi },
    deger: { fontSize: 16, color: t.soluk, flexShrink: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
    durum: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    nokta: { width: 8, height: 8, borderRadius: 4 },
    dipnot: { fontSize: 12.5, color: t.soluk, lineHeight: 17, paddingHorizontal: 32, paddingTop: 7 },
  });
