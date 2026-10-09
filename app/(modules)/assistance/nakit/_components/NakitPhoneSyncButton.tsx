'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

// Kullanici istegi: "Dosya Telefonu" sutununda bazen ESKI/hatali bir numara
// gorunuyor (ör. bir test kaydindan kalma "555555555"), oysa dosya
// sahibinin GERCEK cep telefonu bireyler tablosunda dogru sekilde kayitli.
// Bu buton, Nakit Yardimi ile ilişkili TUM dosyalarin telefonunu, dosya
// SAHIBININ bireylerdeki ceptel'i ile karsilastirip UYUSMAYANLARI gunceller
// (bkz. app/api/assistance/nakit/sync-phone-numbers/route.ts). Diger sync
// butonlariyla (NakitApplicationsSyncButton) AYNI desen - kullanici
// isteğiyle bilerek MANUEL/butonla tetiklenir, sayfa acilinca OTOMATIK
// calismaz (bilerek farkli girilmis numaralarin sessizce degistirilmesi
// riskine karsi).
export function NakitPhoneSyncButton() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')

  const handleClick = async () => {
    const confirmed = await confirmDialog(
      'Nakit yardımıyla ilişkili TÜM dosyaların telefon numarası, dosya sahibinin bireylerdeki cep telefonuyla karşılaştırılacak. Uyuşmayanlar (boş, eksik ya da farklı olanlar) dosya sahibinin cep telefonuyla GÜNCELLENECEK. Devam edilsin mi?',
    )
    if (!confirmed) return

    setStatus('loading')
    try {
      const response = await fetch('/api/assistance/nakit/sync-phone-numbers', { method: 'POST' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Telefon numaraları güncellenemedi.')
      }

      const updatedCount = Number(payload.data?.updatedCount || 0)
      alert(
        updatedCount > 0
          ? `${updatedCount} dosyanın telefon numarası, dosya sahibinin cep telefonuyla güncellendi.`
          : 'Tüm dosyaların telefon numarası zaten güncel.',
      )
      router.refresh()
    } catch (error) {
      alert('Hata: ' + (error instanceof Error ? error.message : 'Telefon numaraları güncellenemedi.'))
    } finally {
      setStatus('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={status === 'loading'}
      title="Tüm dosyaların telefon numarasını, dosya sahibinin bireylerdeki cep telefonuyla karşılaştırıp uyuşmayanları düzeltir"
      className="inline-flex items-center gap-1.5 rounded-md border border-teal-600 bg-teal-600 px-3.5 py-2 text-xs font-black text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-wait disabled:opacity-60 print:hidden"
    >
      <span aria-hidden className="text-sm leading-none">☎</span>
      {status === 'loading' ? 'Kontrol Ediliyor...' : 'Telefonları Kontrol Et'}
    </button>
  )
}
