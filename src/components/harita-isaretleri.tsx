// Harita üzerindeki otobüs ve durak işaretleri (Apple Haritalar, react-native-maps).
//
// İşaretler gerçek görünüm olarak çiziliyor; iOS'ta Marker'ın içindeki görünüm
// harita üstünde yaşıyor, resme çevrilmiyor.

import { StyleSheet, View } from 'react-native';

import { Ikon } from '@/components/ulasim';
import { useTema } from '@/lib/tema';

/**
 * Otobüs: hat renginde yuvarlak, içinde otobüs simgesi; yönü biliniyorsa gittiği
 * yöne bakan küçük bir ok. Konumu eskiyse gri.
 */
export function OtobusIsareti({ renk, yon, soluk = false }: { renk: string; yon?: number | null; soluk?: boolean }) {
  const tema = useTema();
  const zemin = soluk ? tema.soluk : renk;
  return (
    <View style={stil.otobusKutu}>
      {yon != null && (
        <View style={[stil.okKutu, { transform: [{ rotate: `${yon}deg` }] }]}>
          <View style={[stil.ok, { borderBottomColor: zemin }]} />
        </View>
      )}
      <View style={[stil.otobus, { backgroundColor: zemin, borderColor: tema.yuzey }]}>
        <Ikon ad="bus" boyut={14} renkKodu="#fff" />
      </View>
    </View>
  );
}

/** Hattın durağı: küçük halka. İşaretliyse (yolcunun durağı) büyük ve dolu. */
export function DurakIsareti({ renk, isaretli = false }: { renk: string; isaretli?: boolean }) {
  const tema = useTema();
  return isaretli ? (
    <View style={[stil.durakBuyuk, { backgroundColor: renk, borderColor: tema.yuzey }]} />
  ) : (
    <View style={[stil.durak, { borderColor: renk, backgroundColor: tema.yuzey }]} />
  );
}

const OTOBUS = 30;
const KUTU = 46;

const stil = StyleSheet.create({
  otobusKutu: { width: KUTU, height: KUTU, alignItems: 'center', justifyContent: 'center' },
  okKutu: { position: 'absolute', width: KUTU, height: KUTU, alignItems: 'center' },
  ok: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  otobus: {
    width: OTOBUS,
    height: OTOBUS,
    borderRadius: OTOBUS / 2,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  durak: { width: 10, height: 10, borderRadius: 5, borderWidth: 2.5 },
  durakBuyuk: { width: 18, height: 18, borderRadius: 9, borderWidth: 3 },
});
