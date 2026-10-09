'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import {
  USER_PERMISSIONS_SETTING_KEY,
  isActionScheduleActive,
  type UserPermissionConfig,
  type UserPermissionsById,
} from '@/lib/constants/userPermissions'

// Kullanici istegi: Nakit Yardımı Müracaatları listesindeki TÜM durumu=0
// (bekleyen) kayitlar, tek tek dosyanin icine girmeden, Ayarlar > Hazır
// Değerler > Yardım Kriterleri altindaki "Aylık Gelir"/"Araç Modeli"
// sinirlarina gore TOPLU kontrol edilip asilanlarin HEPSININ Aşama bilgisi
// TEK TIKLA "Otomatik Red" yapilsin - manuel kriter girisi ya da tek tek
// satir secimi GEREKMEZ (bkz. lib/services/cashAutoReject.service.ts).
// Kullanici istegi (ters yon): daha once Otomatik Red yapilmis ama
// guncelleme sonrasi artik kriterlerin ALTINDA kalan kayitlar da AYNI
// tikla "İncelenecek"e geri alinir.
// NakitApplicationsSyncButton ile AYNI desen: onay -> istek -> sonuc mesaji.

const AUTO_REJECT_ACTION_ID = 'assistance.autoReject'

// documents/page.tsx'teki canUseAction() ile AYNI mantik - yetkisi
// tanimlanmamis (config yok) veya admin olan kullanicida kisit yoktur;
// allowedActions bos dizi olan kullanicida da (hic islem yetkisi
// tanimlanmamis) hicbir kisit uygulanmaz (bkz. userPermissions.ts notu).
function canRunAutoReject(config: UserPermissionConfig | null): boolean {
  if (!config || config.isAdmin) return true
  if (config.isActive === false) return false
  if (!config.allowedActions?.length) return true
  if (!config.allowedActions.includes(AUTO_REJECT_ACTION_ID)) return false
  return isActionScheduleActive(config.actionSchedules?.[AUTO_REJECT_ACTION_ID])
}

export function NakitAutoRejectButton() {
  const router = useRouter()
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  // Sunucu (bkz. /api/assistance/nakit/auto-reject) zaten "assistance.
  // autoReject" yetkisini ZORUNLU kilar - buradaki kontrol sadece yetkisiz
  // kullaniciya butonun hic GORUNMEMESI icin (UX). Yetki bilgisi henuz
  // yuklenmeden (varsayilan true) buton kisaca gorunup sonra kaybolabilir -
  // bu, "yetkisiz tikla -> hata al" akisindan daha iyi bir deneyimdir.
  const [canRun, setCanRun] = useState(true)

  useEffect(() => {
    let isCancelled = false

    const loadPermission = async () => {
      try {
        const userResponse = await fetch('/api/users/current')
        const userPayload = await userResponse.json()
        const userId = String(userPayload?.data?.id ?? '')
        if (!userResponse.ok || !userId) return

        const permissionResponse = await fetch(`/api/settings/${USER_PERMISSIONS_SETTING_KEY}`)
        if (!permissionResponse.ok) return

        const permissionPayload = await permissionResponse.json()
        const permissions = permissionPayload?.data?.value as UserPermissionsById | undefined
        const config = permissions?.[userId] ?? null

        if (!isCancelled) setCanRun(canRunAutoReject(config))
      } catch {
        // Yetki bilgisi alinamazsa mevcut (serbest) gorunumu bozma -
        // gercek yetkilendirme zaten sunucu tarafinda ayrica uygulanir.
      }
    }

    void loadPermission()

    return () => {
      isCancelled = true
    }
  }, [])

  const handleClick = async () => {
    const confirmed = await confirmDialog(
      'Durumu "Yeni Müracaat" (bekleyen) olan TÜM nakit yardımı müracaatları, Yardım Kriterleri sınırlarına göre kontrol edilecek. Sınırı aşanların Aşaması "Otomatik Red" yapılacak, daha önce Otomatik Red yapılmış ama artık sınırın altında kalanlar ise "İncelenecek"e geri alınacak. Devam edilsin mi?',
    )
    if (!confirmed) return

    setStatus('loading')
    try {
      const previewResponse = await fetch('/api/assistance/nakit/auto-reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'preview' }),
      })
      const previewPayload = await previewResponse.json().catch(() => ({}))
      if (!previewResponse.ok || !previewPayload.success) {
        throw new Error(previewPayload.error || 'Otomatik red kontrolü yapılamadı.')
      }

      const matches: { id: string; reasons: string[] }[] = previewPayload.data?.matches ?? []
      const reverts: string[] = previewPayload.data?.reverts ?? []

      if (matches.length === 0 && reverts.length === 0) {
        alert('Değişecek bir müracaat bulunamadı - kriterleri aşan ya da geri alınacak bekleyen (durumu=0) müracaat yok.')
        return
      }

      let rejectedCount = 0
      let revertedCount = 0

      if (matches.length > 0) {
        // Kullanici istegi (2026-09-29): "otomatik red açıklamasını nakit
        // yardımları tablosunda da görelim" - preview'da gosterilen aşılan
        // kriter metni, apply istegiyle birlikte gonderilip durumuaciklama
        // alanina yazilir.
        const applyResponse = await fetch('/api/assistance/nakit/auto-reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'apply',
            matches: matches.map((match) => ({ id: match.id, reason: (match.reasons || []).join('; ') })),
          }),
        })
        const applyPayload = await applyResponse.json().catch(() => ({}))
        if (!applyResponse.ok || !applyPayload.success) {
          throw new Error(applyPayload.error || 'Otomatik red uygulanamadı.')
        }
        rejectedCount = Number(applyPayload.data?.updatedCount || 0)
      }

      if (reverts.length > 0) {
        const revertResponse = await fetch('/api/assistance/nakit/auto-reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'revert', ids: reverts }),
        })
        const revertPayload = await revertResponse.json().catch(() => ({}))
        if (!revertResponse.ok || !revertPayload.success) {
          throw new Error(revertPayload.error || 'Otomatik red geri alınamadı.')
        }
        revertedCount = Number(revertPayload.data?.updatedCount || 0)
      }

      const messageParts = [
        rejectedCount > 0 ? `${rejectedCount} müracaat "Otomatik Red" yapıldı` : '',
        revertedCount > 0 ? `${revertedCount} müracaat "İncelenecek"e geri alındı` : '',
      ].filter(Boolean)
      alert(messageParts.length > 0 ? messageParts.join(', ') + '.' : 'Değişecek bir müracaat bulunamadı.')
      router.refresh()
    } catch (error) {
      alert('Hata: ' + (error instanceof Error ? error.message : 'Otomatik red kontrolü yapılamadı.'))
    } finally {
      setStatus('idle')
    }
  }

  if (!canRun) return null

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={status === 'loading'}
      title="Bekleyen (durumu=0) tüm müracaatları Yardım Kriterleri sınırlarına göre toplu kontrol edip aşanları Otomatik Red yapar, artık sınırın altında kalanları İncelenecek'e geri alır"
      className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3.5 py-2 text-xs font-black text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-60 print:hidden"
    >
      <span aria-hidden className="text-sm leading-none">⛔</span>
      {status === 'loading' ? 'Kontrol Ediliyor...' : 'Otomatik Red Kontrolü'}
    </button>
  )
}
