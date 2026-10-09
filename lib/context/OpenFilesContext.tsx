'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

// Kullanici istegi (Ekim 2026): Dosya Yönetimi sayfasindaki "AÇIK DOSYALAR"
// seridi kaldirildi - acilan her dosya artik ust sekme cubuğunda (bkz.
// components/layout/WorkspaceTabs.tsx) "Dosya Yönetimi" sekmesinin
// yaninda AYRI bir sekme olarak gorunur (dosya no + sahibi adi, digerlerinden
// farkli renkte). Dosya listesi/aktif dosya/kapatma mantigi HALA
// documents/page.tsx'te - bu context sadece o veriyi + geri cagirmalari
// (select/close) ust sekme cubuğuna kopruler.

export interface OpenFileTab {
  key: string
  fileNo: string
  name: string
}

interface OpenFilesContextValue {
  files: OpenFileTab[]
  activeKey: string
  /** Bir dosya sekmesine tiklandiginda. */
  select: (key: string) => void
  /** Bir dosya sekmesi kapatildiginda. */
  close: (key: string) => void
  /** documents/page.tsx her render'da guncel durumu buradan yayinlar. */
  publish: (
    files: OpenFileTab[],
    activeKey: string,
    handlers: { select: (key: string) => void; close: (key: string) => void },
  ) => void
  /** documents/page.tsx unmount olunca temizler. */
  clear: () => void
}

const OpenFilesContext = createContext<OpenFilesContextValue | undefined>(undefined)

function sameFiles(a: OpenFileTab[], b: OpenFileTab[]) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].key !== b[i].key || a[i].fileNo !== b[i].fileNo || a[i].name !== b[i].name) return false
  }
  return true
}

export function OpenFilesProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ files: OpenFileTab[]; activeKey: string }>({ files: [], activeKey: '' })
  const handlersRef = useRef<{ select: (key: string) => void; close: (key: string) => void }>({
    select: () => {},
    close: () => {},
  })

  const publish = useCallback<OpenFilesContextValue['publish']>((files, activeKey, handlers) => {
    handlersRef.current = handlers
    setState((prev) => (
      prev.activeKey === activeKey && sameFiles(prev.files, files) ? prev : { files, activeKey }
    ))
  }, [])

  const clear = useCallback(() => {
    setState((prev) => (prev.files.length === 0 && prev.activeKey === '' ? prev : { files: [], activeKey: '' }))
  }, [])

  const value = useMemo<OpenFilesContextValue>(() => ({
    files: state.files,
    activeKey: state.activeKey,
    select: (key: string) => handlersRef.current.select(key),
    close: (key: string) => handlersRef.current.close(key),
    publish,
    clear,
  }), [state, publish, clear])

  return <OpenFilesContext.Provider value={value}>{children}</OpenFilesContext.Provider>
}

export function useOpenFiles() {
  const context = useContext(OpenFilesContext)
  if (!context) throw new Error('useOpenFiles must be used within OpenFilesProvider')
  return context
}
