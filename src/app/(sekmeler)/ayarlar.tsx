// Ayarlar sekmesi: verinin ne kadar güncel olduğu, rota sunucusunun durumu ve uygulama bilgisi.
//
// Buradaki bilgiler süs değil: tarifenin hangi tarihleri kapsadığını sunucunun kendisinden
// okuyoruz, böylece "neden bu sefer çıkmıyor" sorusunun cevabı ekranda görünüyor.

import Constants from 'expo-constants';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Ikon, useStiller } from '@/components/ulasim';
import { hatirlaticiIptal, hatirlaticiSaati, hepsiniIptal, izinIste, useHatirlaticilar } from '@/lib/bildirim';
import { ekranAcikKaydet, ucretTuruKaydet, useKayitlar } from '@/lib/kayitlar';
import { TARIFE_TARIHI, UCRET_ACIKLAMALARI, UCRET_ADLARI, type UcretTuru } from '@/lib/ucret';
import { OTP_ADRESI, sunucuBilgisiGetir, type SunucuBilgisi } from '@/lib/otp';
import { poiBilgisi } from '@/lib/poi';
import { useTema, type Tema } from '@/lib/tema';

function tarihYaz(saniye?: number | null): string {
  if (!saniye) return '—';
  const d = new Date(saniye * 1000);
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function AyarlarEkrani() {
  const kenar = useSafeAreaInsets();
  const tema = useTema();
  const s = useStiller(stiller);

  const [sunucu, setSunucu] = useState<SunucuBilgisi | null>(null);
  const [sunucuHatasi, setSunucuHatasi] = useState<string | null>(null);
  const [poi, setPoi] = useState<{ nokta: number; kaynak: string } | null>(null);
  const [yenileniyor, setYenileniyor] = useState(false);
  const { hatirlaticilar, izin, yenile: hatirlaticilariYenile } = useHatirlaticilar();
  const { ucretTuru, ekranAcik } = useKayitlar();

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

  const besleme = sunucu?.feeds ?? [];
  const aralik = sunucu?.serviceTimeRange;

  return (
    <ScrollView
      style={s.kok}
      contentContainerStyle={{ paddingTop: kenar.top + 6, paddingBottom: kenar.bottom + 24 }}
      refreshControl={
        <RefreshControl
          refreshing={yenileniyor}
          tintColor={tema.vurgu}
          onRefresh={async () => {
            setYenileniyor(true);
            await yukle();
            setYenileniyor(false);
          }}
        />
      }
    >
      <Text style={s.baslik}>Ayarlar</Text>

      <Text style={s.bolumBaslik}>ROTA SUNUCUSU</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <View style={[s.nokta, { backgroundColor: sunucu ? tema.vurgu : tema.hata }]} />
          <Text style={s.satirBaslik}>{sunucu ? 'Bağlı' : 'Ulaşılamıyor'}</Text>
        </View>
        <Text style={s.adres}>{OTP_ADRESI}</Text>
        {sunucuHatasi && <Text style={s.hataYazi}>{sunucuHatasi}</Text>}
        {!sunucuHatasi && (
          <Text style={s.aciklama}>
            Rota motoru şu an bilgisayarında çalışıyor; uygulama yalnızca aynı ağdayken rota bulabilir.
          </Text>
        )}
      </View>

      <Text style={s.bolumBaslik}>TARİFE VERİSİ</Text>
      <View style={s.kutu}>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Geçerlilik</Text>
          <Text style={s.deger}>{`${tarihYaz(aralik?.start)} – ${tarihYaz(aralik?.end)}`}</Text>
        </View>
        {besleme.map((b) => (
          <View key={b.feedId} style={s.bilgiSatiri}>
            <Text style={s.etiket}>{b.feedId}</Text>
            <Text style={s.deger} numberOfLines={1}>
              {(b.agencies ?? []).map((a) => a.name).join(', ') || '—'}
            </Text>
          </View>
        ))}
        <Text style={s.aciklama}>
          Otobüs ve Metrobüs tarifesi İETT'nin güncel verisinden geliyor. Metro, Marmaray, tramvay, füniküler ve
          vapur saatleri İBB'nin artık güncellemediği veriden geldiği için güncel döneme kaydırıldı; saatler
          yaklaşıktır.
        </Text>
      </View>

      <Text style={s.bolumBaslik}>YER VERİSİ</Text>
      <View style={s.kutu}>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Aranabilir yer</Text>
          <Text style={s.deger}>{poi ? poi.nokta.toLocaleString('tr-TR') : '—'}</Text>
        </View>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Kaynak</Text>
          <Text style={s.deger} numberOfLines={1}>
            {poi?.kaynak ?? 'OpenStreetMap'}
          </Text>
        </View>
        <Text style={s.aciklama}>Yer araması telefonda yapılır; internet bağlantısı gerekmez.</Text>
      </View>

      <Text style={s.bolumBaslik}>İSTANBULKART</Text>
      <View style={s.kutu}>
        <View style={s.haplar}>
          {(Object.keys(UCRET_ADLARI) as UcretTuru[]).map((t) => (
            <Pressable
              key={t}
              style={[s.hap, ucretTuru === t && s.hapSecili]}
              onPress={() => ucretTuruKaydet(t)}
              accessibilityRole="button"
              accessibilityState={{ selected: ucretTuru === t }}
            >
              <Text style={[s.hapYazi, ucretTuru === t && { color: tema.vurgu }]}>{UCRET_ADLARI[t]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.aciklama}>{UCRET_ACIKLAMALARI[ucretTuru]}</Text>
        <Text style={s.aciklama}>
          {`Rota ücretleri ${TARIFE_TARIHI} tarihli İBB tarifesine göre hesaplanır. İlk biniş tam bilet, sonraki binişler aktarma bedelidir; aktarma hakkı 120 dakika sürer. Metrobüs, Marmaray ve M11 durak sayısına göre ücretlendirilir.`}
        </Text>
      </View>

      <Text style={s.bolumBaslik}>HATIRLATICILAR</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <View style={[s.nokta, { backgroundColor: izin ? tema.vurgu : tema.uyari }]} />
          <Text style={s.satirBaslik}>{izin ? 'Bildirim izni açık' : 'Bildirim izni kapalı'}</Text>
        </View>
        {!izin && (
          <Pressable
            style={s.dugme}
            accessibilityRole="button"
            onPress={async () => {
              if (await izinIste()) {
                hatirlaticilariYenile();
                return;
              }
              Alert.alert('İzin verilmedi', 'Bildirimleri telefonun ayarlarından açabilirsin.', [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Ayarları aç', onPress: () => Linking.openSettings() },
              ]);
            }}
          >
            <Ikon ad="notifications" boyut={16} renkKodu={tema.vurgu} />
            <Text style={s.dugmeYazi}>İzin iste</Text>
          </Pressable>
        )}

        {hatirlaticilar.length === 0 ? (
          <Text style={s.aciklama}>
            Kurulu hatırlatıcı yok. Bir rota bulup detayında zil düğmesine basarsan çıkış ve iniş uyarıları
            kurulur; uygulama kapalıyken de çıkarlar.
          </Text>
        ) : (
          <>
            {hatirlaticilar.map((h) => (
              <View key={h.id} style={s.hatirlatici}>
                <Text style={s.hatirlaticiSaat}>{hatirlaticiSaati(h.zaman)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.satirBaslik} numberOfLines={1}>
                    {h.baslik}
                  </Text>
                  <Text style={s.aciklama} numberOfLines={2}>
                    {h.metin}
                  </Text>
                </View>
                <Pressable
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`${h.baslik} hatırlatıcısını kaldır`}
                  onPress={() => hatirlaticiIptal(h.id)}
                >
                  <Ikon ad="close" boyut={18} renkKodu={tema.soluk} />
                </Pressable>
              </View>
            ))}
            <Pressable style={s.dugme} onPress={hepsiniIptal} accessibilityRole="button">
              <Ikon ad="notifications-off" boyut={16} renkKodu={tema.hata} />
              <Text style={[s.dugmeYazi, { color: tema.hata }]}>Hepsini kaldır</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={s.bolumBaslik}>YOLCULUK</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <Ikon ad="phone-portrait-outline" boyut={17} renkKodu={tema.vurgu} />
          <Text style={[s.satirBaslik, { flex: 1 }]}>Yolculukta ekran açık kalsın</Text>
          <Switch
            value={ekranAcik}
            onValueChange={ekranAcikKaydet}
            trackColor={{ true: tema.vurgu }}
            accessibilityLabel="Yolculukta ekran açık kalsın"
          />
        </View>
        <Text style={s.aciklama}>
          "Yolculuğu başlat"tan sonra telefon ekranı kararmaz; bakınca sıradaki adım hazır olur. Kapatırsan pil daha
          az harcanır.
        </Text>
      </View>

      <Text style={s.bolumBaslik}>GÖRÜNÜM</Text>
      <View style={s.kutu}>
        <View style={s.satir}>
          <Ikon ad={tema.koyu ? 'moon' : 'sunny'} boyut={17} renkKodu={tema.vurgu} />
          <Text style={s.satirBaslik}>{tema.koyu ? 'Koyu tema' : 'Açık tema'}</Text>
        </View>
        <Text style={s.aciklama}>
          Tema telefonun sistem ayarını izler. Değiştirmek için Ayarlar → Ekran ve Parlaklık'ı kullan.
        </Text>
      </View>

      <Text style={s.bolumBaslik}>UYGULAMA</Text>
      <View style={s.kutu}>
        <View style={s.bilgiSatiri}>
          <Text style={s.etiket}>Sürüm</Text>
          <Text style={s.deger}>{Constants.expoConfig?.version ?? '—'}</Text>
        </View>
        <Pressable onPress={yukle} style={s.dugme} accessibilityRole="button">
          <Ikon ad="refresh" boyut={16} renkKodu={tema.vurgu} />
          <Text style={s.dugmeYazi}>Bilgileri yenile</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const stiller = (t: Tema) =>
  StyleSheet.create({
    kok: { flex: 1, backgroundColor: t.zemin },
    baslik: { fontSize: 26, fontWeight: '800', color: t.yazi, letterSpacing: -0.4, paddingHorizontal: 16, paddingBottom: 6 },
    bolumBaslik: {
      fontSize: 11.5,
      letterSpacing: 0.8,
      fontWeight: '700',
      color: t.soluk,
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 7,
    },
    kutu: {
      marginHorizontal: 16,
      backgroundColor: t.yuzey,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
      padding: 14,
      gap: 8,
    },
    satir: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nokta: { width: 9, height: 9, borderRadius: 5 },
    satirBaslik: { fontSize: 15, fontWeight: '700', color: t.yazi },
    adres: { fontSize: 13, color: t.soluk, fontVariant: ['tabular-nums'] },
    bilgiSatiri: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
    etiket: { fontSize: 13.5, color: t.soluk },
    deger: { fontSize: 13.5, fontWeight: '600', color: t.yazi, flexShrink: 1, textAlign: 'right' },
    aciklama: { fontSize: 12, color: t.soluk, lineHeight: 18 },
    hataYazi: { fontSize: 12.5, color: t.hata, lineHeight: 18 },
    dugme: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', paddingTop: 4 },
    dugmeYazi: { fontSize: 13.5, fontWeight: '700', color: t.vurgu },
    hatirlatici: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.cizgiSilik,
    },
    hatirlaticiSaat: { fontSize: 15, fontWeight: '700', color: t.vurgu, fontVariant: ['tabular-nums'] },
    haplar: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    hap: {
      paddingHorizontal: 12,
      height: 34,
      borderRadius: 17,
      justifyContent: 'center',
      backgroundColor: t.zemin,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.cizgi,
    },
    hapSecili: { backgroundColor: t.vurguAcik, borderColor: t.vurgu },
    hapYazi: { fontSize: 13.5, fontWeight: '700', color: t.yazi },
  });
