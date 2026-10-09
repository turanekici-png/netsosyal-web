// Web Push (masaüstü bildirim) - tarayıcı tarafı yardımcıları. "Bu Bilgisayarı
// Ayarla" panelindeki "Masaüstü Bildirimleri" bölümü bunu kullanır (bkz.
// components/layout/WorkstationSetupButton.tsx).
//
// ÖNEMLİ: Service Worker + Push API, güvenli olmayan (http, localhost hariç)
// origin'lerde tarayıcı tarafından TAMAMEN ENGELLENİR - bu uygulama LAN
// üzerinde düz http ile çalıştığı için, printAgentClient.ts'teki kamera
// erişiminde olduğu gibi, o bilgisayarda "Bu Bilgisayarı Ayarla" kurulumunun
// (OverrideSecurityRestrictionsOnInsecureOrigin kayıt defteri politikası)
// daha önce çalıştırılmış olması GEREKİR - aksi halde isPushSupported() false
// döner.

export type PushStatus = {
  supported: boolean
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean
}

export function isPushSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (window.isSecureContext === false) return false
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false }
  }

  const permission = Notification.permission
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = registration ? await registration.pushManager.getSubscription() : null
    return { supported: true, permission, subscribed: Boolean(subscription) }
  } catch {
    return { supported: true, permission, subscribed: false }
  }
}

// "Bildirimleri Aç" - Service Worker kaydeder, tarayıcı izin kutusunu
// gösterir, sunucudan VAPID public key'i alıp abone olur ve aboneliği
// sunucuya kaydeder. Tüm adımlarda anlaşılır bir hata metni döner.
export async function subscribeToPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) {
    return { success: false, error: 'Bu tarayıcı/bilgisayar masaüstü bildirimlerini desteklemiyor. Önce "Kurulumu Çalıştır" ile bu bilgisayarı ayarlayın.' }
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { success: false, error: 'Bildirim izni verilmedi.' }
    }

    const keyResponse = await fetch('/api/push/public-key')
    const keyPayload = await keyResponse.json()
    if (!keyResponse.ok || !keyPayload.success || !keyPayload.publicKey) {
      return { success: false, error: keyPayload.error || 'Sunucu bildirim için hazır değil.' }
    }

    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyPayload.publicKey) as BufferSource,
      })
    }

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) {
      return { success: false, error: payload.error || 'Abonelik kaydedilemedi.' }
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Bildirimler açılamadı.' }
  }
}

export async function unsubscribeFromPush(): Promise<{ success: boolean; error?: string }> {
  if (!isPushSupported()) return { success: true }

  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js')
    const subscription = registration ? await registration.pushManager.getSubscription() : null
    if (!subscription) return { success: true }

    const endpoint = subscription.endpoint
    await subscription.unsubscribe()

    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {})

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Bildirimler kapatılamadı.' }
  }
}
