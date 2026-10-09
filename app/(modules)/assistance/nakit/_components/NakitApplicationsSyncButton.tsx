'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'

// Kullanici istegi: Nakit Yardimi modulunun TUM sekmelerinde (Muracaatlar,
// Yardimlar, Iptal Edilenler) gorunen "Muracaatlari Guncelle" butonu - TUM
// nakit yardimi muracaatlarinin TC kimlik numarasini bireyler tablosunda
// arar; eslesme bulunursa muracaatin dosyaid'ini, bulunan bireyler
// kaydinin dosyaid'i ile DEGISTIRIR (bkz. app/api/assistance/
// nakit/sync-applications-to-files/route.ts). Bu artik SADECE dosyasiz
// muracaatlarla sinirli degil - zaten (yanlis/eski) bir dosyaya bagli
// muracaatlar da, bireylerdeki GUNCEL kayitla uyusmuyorsa dogru dosyaya
// TASINIR. Sadece GERCEKTEN degisecek kayitlar islenir.
//
// Kullanici istegi (gorunum): eskiden ayri, aciklama metinli buyuk bir
// kart olarak gosteriliyordu - artik diger toplu islem butonlariyla AYNI
// satirda, sade/kompakt bir buton olarak gorunur (bkz. NakitCriteriaButton
// ve AssistanceRequestListPage.tsx/AssistanceListPage.tsx'teki afterHeader).
export function NakitApplicationsSyncButton() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')

  const handleClick = async () => {
    const confirmed = await confirmDialog(
      'TÜM nakit yardımı müracaatlarının TC kimlik numarası, bireylerdeki kayıtlı dosyalarla karşılaştırılacak. Dosyası olmayanlar bağlanacak, YANLIŞ/ESKİ bir dosyaya bağlı olanlar ise DOĞRU dosyaya taşınacak. Devam edilsin mi?',
    )
    if (!confirmed) return

    setStatus('loading')
    try {
      const response = await fetch('/api/assistance/nakit/sync-applications-to-files', { method: 'POST' })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Müracaatlar güncellenemedi.')
      }

      const updatedCount = Number(payload.data?.updatedCount || 0)
      alert(
        updatedCount > 0
          ? `${updatedCount} müracaat, TC kimlik numarasına göre bulunan dosyaya bağlandı/taşındı.`
          : 'Tüm müracaatların dosya bağlantısı zaten güncel.',
      )
      // Kullanici istegi: bu sayfa (coklu-sekme mimarisi geregi) daha once
      // acilmis bir sekmede ESKI/durgun veriyle kalabiliyor - ör. bir
      // muracaat, bu buton disinda (Dosya Yonetimi'nden manuel ekleme gibi)
      // ZATEN dogru dosyaya baglanmis olabilir ama liste bunu hala
      // yansitmiyor olabilir. Bu yuzden updatedCount=0 olsa bile, butona
      // basildiginda liste HER ZAMAN sunucudan taze veriyle yenilenir.
      router.refresh()
    } catch (error) {
      alert('Hata: ' + (error instanceof Error ? error.message : 'Müracaatlar güncellenemedi.'))
    } finally {
      setStatus('idle')
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={status === 'loading'}
      title="Tüm müracaatları, TC kimlik numaralarına göre bireylerdeki kayıtlı dosyalarla eşleştirip doğru dosyaya bağlar/taşır"
      className="inline-flex items-center gap-1.5 rounded-md border border-indigo-600 bg-indigo-600 px-3.5 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60 print:hidden"
    >
      <span aria-hidden className="text-sm leading-none">↻</span>
      {status === 'loading' ? 'Güncelleniyor...' : 'Müracaatları Güncelle'}
    </button>
  )
}
