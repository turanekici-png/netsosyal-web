'use client'

import { useEffect, useState } from 'react'

const THEME_STORAGE_KEY = 'theme'
type Theme = 'light' | 'dark'

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

// Sayfa daha ilk boyanmadan ONCE (app/layout.tsx'teki engelleyici script ile)
// zaten dogru sinif uygulanmis olur; burada sadece o mevcut durumu okuyup
// butonun ikonunu/etiketini eslestiriyoruz - boylece ilk render'da "yanlis"
// bir ikon gorunup sonra degismiyor.
function readCurrentTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

type ThemeToggleProps = {
  // 'onLight': beyaz/acik bir arkaplan uzerinde (ör. ust bilgi cubugu) -
  // gri kenarlikli, "Cikis" gibi diger butonlarla ayni aile.
  // 'onDark': renkli/koyu bir arkaplan uzerinde (ör. sidebar basligi) -
  // yari saydam beyaz stil.
  variant?: 'onLight' | 'onDark'
}

// Gunduz/gece modu dugmesi. Secim localStorage'a yazilir ve <html>
// uzerindeki "dark" sinifini kontrol eder - Tailwind'in tum "dark:"
// varyantlari buna gore tepki verir. Su an icin uygulama govdesinin
// (sidebar/header/genel govde) gorunumu bu anahtarla degisiyor; sayfa
// icerikleri (tablolar, formlar) mevcut sabit acik renk paletini
// kullanmaya devam ediyor - ayri, kapsamli bir sonraki adim.
export function ThemeToggle({ variant = 'onLight' }: ThemeToggleProps) {
  const [theme, setThemeState] = useState<Theme>('light')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setThemeState(readCurrentTheme())
    setMounted(true)
  }, [])

  const setTheme = (next: Theme) => {
    setThemeState(next)
    applyTheme(next)
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
  }

  // Ilk client render'da (mounted olana kadar) sunucu ile ayni, sabit bir
  // gorunum gostermek hydration uyusmazligini onler.
  const isDark = mounted && theme === 'dark'

  const containerClass = variant === 'onDark'
    ? 'border-white/50 bg-white/15'
    : 'border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800'
  const inactiveClass = variant === 'onDark'
    ? 'text-white/80 hover:bg-white/15'
    : 'text-slate-500 hover:bg-white dark:text-slate-400 dark:hover:bg-slate-700'

  return (
    <div
      role="group"
      aria-label="Görünüm modu"
      className={`inline-flex items-center gap-0.5 rounded-full border p-0.5 shadow-inner backdrop-blur ${containerClass}`}
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={!isDark}
        title="Gündüz modu"
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs transition ${
          !isDark ? 'bg-white text-[#c9820a] shadow-sm' : inactiveClass
        }`}
      >
        ☀️
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={isDark}
        title="Gece modu"
        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs transition ${
          isDark ? 'bg-slate-900 text-amber-300 shadow-sm' : inactiveClass
        }`}
      >
        🌙
      </button>
    </div>
  )
}
