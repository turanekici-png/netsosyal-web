'use client'

// Kok layout'un (app/layout.tsx) kendisi veya AppShell render edilirken hata
// olursa normal error.tsx devreye giremez - Next.js bu durumda global-error'i
// kullanir ve KENDI <html>/<body>'sini render etmesi gerekir.

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error]', error)
  }, [error])

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f1f5f9',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '16px',
        }}
      >
        <div
          style={{
            maxWidth: '32rem',
            width: '100%',
            background: '#fff',
            border: '1px solid #fecdd3',
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              margin: '0 auto',
              width: '48px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '9999px',
              border: '1px solid #fecdd3',
              background: '#fff1f2',
              color: '#be123c',
              fontWeight: 900,
              fontSize: '18px',
            }}
          >
            !
          </div>
          <h1 style={{ marginTop: '16px', fontSize: '20px', fontWeight: 900, color: '#020617' }}>
            Uygulama yüklenemedi
          </h1>
          <p style={{ marginTop: '8px', fontSize: '14px', fontWeight: 600, color: '#475569' }}>
            Beklenmeyen bir hata oluştu. Sayfayı yenilemeyi deneyin. Sorun sürerse
            sistem yöneticisine bildirin.
          </p>
          {error?.digest && (
            <p
              style={{
                marginTop: '12px',
                background: '#f1f5f9',
                padding: '4px 8px',
                borderRadius: '6px',
                fontFamily: 'monospace',
                fontSize: '11px',
                color: '#64748b',
              }}
            >
              Hata kodu: {error.digest}
            </p>
          )}
          <div style={{ marginTop: '20px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                borderRadius: '8px',
                background: '#0d9488',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Tekrar Dene
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                borderRadius: '8px',
                background: '#fff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Sayfayı Yenile
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
