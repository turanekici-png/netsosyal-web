'use client'

import { forwardRef, useImperativeHandle, useRef, useState, type FormEvent } from 'react'

export type DestructiveAuthorizationDialogHandle = {
  authorize: (title: string) => Promise<string | null>
}

export const DestructiveAuthorizationDialog = forwardRef<DestructiveAuthorizationDialogHandle>(
  function DestructiveAuthorizationDialog(_, ref) {
    const resolverRef = useRef<((token: string | null) => void) | null>(null)
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState('Silme İşlemi')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    useImperativeHandle(ref, () => ({
      async authorize(nextTitle) {
        // "Tam yetkili" (admin) kullanicilar icin sifre TEKRAR sorulmaz -
        // kullanicinin acikca istegi. Sunucu, oturum sahibinin GERCEKTEN
        // tam yetkili olup olmadigini BAGIMSIZ dogrular (istemci beyanina
        // guvenilmez) - kisitli kullanicilar icin bu istek 403 doner ve
        // asagida normal sifre penceresi acilir.
        try {
          const bypassResponse = await fetch('/api/auth/destructive-authorization/admin-bypass', { method: 'POST' })
          const bypassPayload = await bypassResponse.json().catch(() => null)
          if (bypassResponse.ok && bypassPayload?.success && bypassPayload.token) {
            return String(bypassPayload.token)
          }
        } catch {
          // Bypass denemesi basarisiz olursa (ag hatasi vb.) normal sifre akisina devam edilir.
        }

        resolverRef.current?.(null)
        setTitle(nextTitle)
        setPassword('')
        setError('')
        setOpen(true)
        return new Promise<string | null>((resolve) => {
          resolverRef.current = resolve
        })
      },
    }), [])

    const close = () => {
      resolverRef.current?.(null)
      resolverRef.current = null
      setOpen(false)
      setPassword('')
      setError('')
    }

    const submit = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!password || loading) return
      setLoading(true)
      setError('')

      try {
        const response = await fetch('/api/auth/destructive-authorization', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        })
        const payload = await response.json()
        if (!response.ok || !payload.success || !payload.token) {
          throw new Error(payload.error || 'Şifre doğrulanamadı.')
        }

        resolverRef.current?.(String(payload.token))
        resolverRef.current = null
        setOpen(false)
        setPassword('')
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'Şifre doğrulanamadı.')
      } finally {
        setLoading(false)
      }
    }

    if (!open) return null

    return (
      <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
        <form onSubmit={submit} className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl">
          <div className="bg-gradient-to-r from-rose-700 to-red-600 px-5 py-4 text-white">
            <h2 className="text-lg font-black">{title}</h2>
            <p className="mt-1 text-xs font-bold text-rose-100">Bu işlem geri alınamayabilir. Kendi kullanıcı şifrenizi girin.</p>
          </div>
          <div className="space-y-4 p-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black uppercase text-slate-600">Kullanıcı Şifreniz</span>
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`h-11 w-full rounded-lg border px-3 font-bold outline-none focus:ring-2 ${error ? 'border-rose-500 bg-rose-50 focus:ring-rose-200' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'}`}
              />
            </label>
            {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">Vazgeç</button>
              <button type="submit" disabled={!password || loading} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-50">
                {loading ? 'Doğrulanıyor...' : 'Şifreyi Doğrula'}
              </button>
            </div>
          </div>
        </form>
      </div>
    )
  },
)
