// Dokunsal geri bildirim (titreşim), iPhone'un kendi uygulamalarındaki yerlerde:
// bir seçim değişince hafif tık, basılı tutunca belirgin vuruş, bir şey kaydedilince
// "tamam" titreşimi. expo-haptics Expo Go'nun içinde. Titreşim hiçbir zaman işi
// durdurmasın diye hatalar yutuluyor (desteklemeyen cihaz, düşük güç modu).

import * as Haptics from 'expo-haptics';

const sessiz = (p: Promise<unknown>) => void p.catch(() => {});

/** Seçim değişti: hap, sekme içi seçici, tercih. */
export function secimTiki(): void {
  sessiz(Haptics.selectionAsync());
}

/** Basılı tutma, sürükleyip bırakma. */
export function vurus(): void {
  sessiz(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Kaydedildi, eklendi. */
export function basari(): void {
  sessiz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Silindi, kaldırıldı. */
export function uyari(): void {
  sessiz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
