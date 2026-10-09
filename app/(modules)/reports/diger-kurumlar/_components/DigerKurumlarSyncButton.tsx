'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

// Kullanici istegi: "Diğer Kurumlar" raporundaki "Kayıtları Güncelle"
// butonu - TUM kayitlarin TC kimlik numarasini bireyler tablosunda arar;
// eslesme bulunursa kaydin dosyaid'ini, bulunan bireyler kaydinin
// dosyaid'i ILE DEGISTIRIR (bkz. app/api/reports/diger-kurumlar/
// sync-files/route.ts). Bu, Nakit Yardimi modulundeki AYNI
// "Müracaatları Güncelle" butonuyla (NakitApplicationsSyncButton.tsx)
// BIREBIR AYNI desen/gorunum - dosyasi olmayan kayitlar bulunan dosyaya
// baglanir, YANLIS/ESKI bir dosyaya bagli olanlar ise DOGRU dosyaya
// tasinir.
export function DigerKurumlarSyncButton() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')

  const handleClick = async () => {
    const confirmed = await confirmDialog(
      'TÜM "Diğer Kurumlar" kayıtlarının TC kimlik numarası, bireylerdeki kayıtlı dosyalarla karşılaştırılacak. Dosyası olmayanlar (sonradan dosyası açılmışsa) bağlanacak, YANLIŞ/ESKİ bir dosyaya bağlı olanlar ise DOĞRU dosyaya taşınacak. Devam edilsin mi?',
    )
    if (!confirmed) return

    setStatus('loading')
    try {
      const response = await fetch('/api/reports/diger-kurumlar/sync-files', { method: 'POST' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Kayıtlar güncellenemedi.')
      }

      const updatedCount = Number(payload.data?.updatedCount || 0)
      alert(
        updatedCount > 0
          ? `${updatedCount} kayıt, TC kimlik numarasına göre bulunan dosyaya bağlandı/taşındı.`
          : 'Tüm kayıtların dosya bağlantısı zaten güncel.',
      )
      router.refresh()
    } catch (error) {
      alert('Hata: ' + (error instanceof Error ? error.message : 'Kayıtlar güncellenemedi.'))
    } finally {
      setStatus('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={status === 'loading'}
      title="Tüm kayıtları, TC kimlik numaralarına göre bireylerdeki kayıtlı dosyalarla eşleştirip doğru dosyaya bağlar/taşır"
      className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 bg-indigo-600 px-3.5 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60 print:hidden"
    >
      <span aria-hidden className="text-sm leading-none">↻</span>
      {status === 'loading' ? 'Güncelleniyor...' : 'Kayıtları Güncelle'}
    </button>
  )
}
