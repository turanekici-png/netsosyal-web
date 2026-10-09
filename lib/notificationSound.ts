// "Onay Bekleyenler" gibi kisisel bildirimler (bir talep size yonlendirildi
// / gonderdiginiz talebe karar verildi) geldiginde, tarayicinin sessiz/kucuk
// varsayilan sistem sesinden DAHA BELIRGIN, kendi ureteceğimiz bir uyari
// sesi calar - Web Audio API ile programatik olarak (dis bir ses dosyasina
// gerek yok). Tarayicilarin "autoplay" kisitlamasi geregi, sayfada en az bir
// kullanici etkilesimi (tik/tus) olmadan ses CALINAMAZ - bu normal ve
// beklenen bir davranistir, ilk etkilesimden sonra calismaya baslar.

let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextClass) return null

  if (!audioContext) {
    audioContext = new AudioContextClass()
  }
  return audioContext
}

function beep(ctx: AudioContext, startTime: number, frequency: number, duration: number, gainPeak: number) {
  const oscillator = ctx.createOscillator()
  const gainNode = ctx.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, startTime)
  oscillator.connect(gainNode)
  gainNode.connect(ctx.destination)

  // Hizli attack + fade-out - "tık" sesi olmadan net, dikkat cekici bir bip.
  gainNode.gain.setValueAtTime(0, startTime)
  gainNode.gain.linearRampToValueAtTime(gainPeak, startTime + 0.02)
  gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

  oscillator.start(startTime)
  oscillator.stop(startTime + duration + 0.02)
}

// Belirgin, iki notali (yukselen) bir "dikkat" uyarisi - varsayilan sistem
// bildirim sesinden cok daha yuksek ve fark edilir olmasi icin gain (ses
// seviyesi) neredeyse maksimumda tutulur.
export function playAlertSound() {
  const ctx = getAudioContext()
  if (!ctx) return

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }

  const now = ctx.currentTime
  const gainPeak = 0.9
  // Üç kısa, yükselen bip - "ding-ding-DING" tarzı, tek bip'ten daha zor
  // gözden kaçan bir uyarı deseni.
  beep(ctx, now, 880, 0.16, gainPeak)
  beep(ctx, now + 0.2, 880, 0.16, gainPeak)
  beep(ctx, now + 0.45, 1318.5, 0.28, gainPeak)
}
