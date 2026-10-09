'use client'

// Kullanıcı isteği: bazen bir kişiye UYGULAMA DIŞINDA (kendi telefonundan)
// zaten SMS/mesaj gönderilmiş oluyor - bu durumda o kaydı sistemde de
// "gönderildi" olarak görmek istiyor (Son Mesaj Durumu/SMS Raporları
// sütunlarında görünsün diye), gerçek bir mesaj gönderilmeden. Bu buton,
// BulkWhatsappSendButton/BulkSmsSendButton ile AYNI şekilde seçili
// kayıtları {id, phone, label, dosyaNo, dosyaId} olarak alır, ama mesaj
// yazma/gönderme adımı YOKTUR - direkt onay alıp sunucuda kayıt oluşturur
// (bkz. app/api/sms/mark-manual-sent/route.ts).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { normalizeWhatsappPhoneNumber } from '@/lib/constants/whatsappSettings'

export interface ManualSentRecipient {
  id: string
  phone: string | null | undefined
  label?: string | null
  dosyaNo?: string | null
  dosyaId?: string | null
}

interface MarkManualSentButtonProps {
  recipients: ManualSentRecipient[]
  disabled?: boolean
  className?: string
}

export function MarkManualSentButton({ recipients, disabled, className }: MarkManualSentButtonProps) {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')

  const validCount = recipients.filter((r) => normalizeWhatsappPhoneNumber(r.phone)).length

  const handleClick = async () => {
    if (recipients.length === 0) return

    const confirmed = await confirmDialog(
      `Seçili ${recipients.length} kayıttan geçerli telefon numarası olan ${validCount} tanesi, bugünün tarihiyle "SMS gönderildi" olarak işaretlenecek. DİKKAT: gerçekte hiçbir mesaj GÖNDERİLMEZ - bu sadece uygulama dışında zaten gönderdiğiniz mesajları sisteme kayıt/rapor amacıyla işlemek içindir. Devam edilsin mi?`,
    )
    if (!confirmed) return

    setStatus('loading')
    try {
      const response = await fetch('/api/sms/mark-manual-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipients.map((r) => ({
            id: r.id,
            phone: r.phone,
            label: r.label,
            dosyaNo: r.dosyaNo,
            dosyaId: r.dosyaId,
          })),
        }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıtlar işaretlenemedi.')
      }

      const markedCount = Number(payload.data?.markedCount || 0)
      const skippedCount = Number(payload.data?.skippedCount || 0)
      alert(
        `${markedCount} kayıt "SMS gönderildi" olarak işaretlendi.`
        + (skippedCount > 0 ? ` ${skippedCount} kayıt geçersiz/eksik telefon numarası nedeniyle atlandı.` : ''),
      )
      router.refresh()
    } catch (error) {
      alert('Hata: ' + (error instanceof Error ? error.message : 'Kayıtlar işaretlenemedi.'))
    } finally {
      setStatus('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={recipients.length === 0 || disabled || status === 'loading'}
      className={className || 'inline-flex items-center gap-2 rounded-md bg-gradient-to-r from-teal-600 to-emerald-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:brightness-110 disabled:pointer-events-none disabled:opacity-50'}
    >
      {status === 'loading' ? 'İşaretleniyor...' : `✓ Manuel Gönderildi İşaretle (${recipients.length})`}
    </button>
  )
}
