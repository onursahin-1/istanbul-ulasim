// Dokununca geri bildirim veren Pressable. React Native'in Pressable'ı basılıyken hiçbir
// şey göstermiyor; iPhone'da her dokunulabilir şey parmak üstündeyken hafifçe solar
// (satırlar, düğmeler). Uygulamadaki bütün Pressable'lar bunu kullanıyor: ekranlar
// react-native yerine buradan içe aktarıyor, başka bir şey değişmiyor.
//
// Stili işlev olan (pressed'e kendi bakan) Pressable'a dokunulmuyor. Geri bildirim
// istenmeyen yerde (arka plan perdesi) geriBildirim={false}.

import { Pressable as RNPressable, type PressableProps, type View } from 'react-native';
import type { Ref } from 'react';

/** Basılıyken saydamlık: iOS'un sistem düğmelerindeki kadar. */
export const BASILI_SAYDAMLIK = 0.5;

export function Pressable({
  style,
  geriBildirim = true,
  ref,
  ...ozellikler
}: PressableProps & { geriBildirim?: boolean; ref?: Ref<View> }) {
  // Kısa gecikme: listeyi kaydırmaya başlayan parmak altındaki satırı bir an soldurmasın.
  const gecikme = ozellikler.unstable_pressDelay ?? 50;
  if (!geriBildirim || typeof style === 'function')
    return <RNPressable ref={ref} style={style} unstable_pressDelay={gecikme} {...ozellikler} />;
  return (
    <RNPressable
      ref={ref}
      style={({ pressed }) => [style, pressed && !ozellikler.disabled && { opacity: BASILI_SAYDAMLIK }]}
      unstable_pressDelay={gecikme}
      {...ozellikler}
    />
  );
}
