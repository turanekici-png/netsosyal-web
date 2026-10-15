'use client'

import { useEffect, useMemo, useState } from 'react'
import { foldTurkish } from '@/lib/utils'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { isValidNewPassword, PASSWORD_POLICY_DESCRIPTION } from '@/lib/security/passwordPolicy'

export const dynamic = 'force-dynamic'

interface UserRow {
  id: string
  name?: string
  kullanicitamadi?: string
  username?: string
  email?: string
  phone?: string | null
  address?: string | null
  yetki?: number | null
  status?: number | null
}

interface UsersResponse {
  success: boolean
  data?: UserRow[]
  error?: string
}

interface ActionResponse {
  success: boolean
  message?: string
  error?: string
  temporaryPassword?: string
  data?: UserRow
}

type SortKey = 'name' | 'username' | 'phone' | 'role' | 'status'

const roleLabel = (yetki?: number | null) => {
  if (yetki === 1) return 'Yönetici'
  if (yetki === 2) return 'Yetkili Kullanıcı'
  if (yetki === 3) return 'Standart Kullanıcı'
  return 'Tanımlı Değil'
}

// Kullanicinin fotografi olup olmadigini onceden bilmiyoruz (sosyalyardimdkm
// veritabaninda ayri bir tabloda, kullanicilar listesiyle ayni sorguda
// gelmiyor) - bu yuzden dogrudan /photo ucunu deniyoruz, foto yoksa uc nokta
// 404 doner ve onError ile baş harf rozetine geri donulur.
function UserAvatar({ userId, name }: { userId: string; name?: string }) {
  const [hasError, setHasError] = useState(false)
  const initial = (name || '?').trim().slice(0, 1).toLocaleUpperCase('tr-TR')

  if (hasError) {
    return (
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xl lg:text-2xl font-black text-slate-400">
        {initial}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/users/${encodeURIComponent(userId)}/photo`}
      alt={name || 'Kullanıcı'}
      className="h-11 w-11 rounded-full border border-slate-300 object-cover"
      onError={() => setHasError(true)}
    />
  )
}

const roleBadgeClass = (yetki?: number | null) => {
  if (yetki === 1) return 'border-sky-200 bg-sky-50 text-[#005f95]'
  if (yetki === 2) return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (yetki === 3) return 'border-slate-200 bg-slate-50 text-slate-600'
  return 'border-amber-200 bg-amber-50 text-amber-700'
}

type UserFormState = {
  name: string
  username: string
  email: string
  phone: string
  address: string
  password: string
  yetki: string
  status: string
}

const EMPTY_FORM: UserFormState = { name: '', username: '', email: '', phone: '', address: '', password: '', yetki: '3', status: '1' }

function UserFormFields({
  form,
  onChange,
  passwordRequired,
  passwordHint,
  photoPreview,
  onPhotoSelect,
  onPhotoRemove,
}: {
  form: UserFormState
  onChange: (next: UserFormState) => void
  passwordRequired: boolean
  passwordHint: string
  photoPreview: string | null
  onPhotoSelect: (file: File) => void
  onPhotoRemove: () => void
}) {
  // Duzenlerken photoPreview mevcut bir kullanicinin foto ucuna isaret
  // edebilir (henuz fotograf olup olmadigi bilinmiyor) - 404 donerse
  // baş harf rozetine geri donuluyor. photoPreview her degistiginde
  // (ör. yeni bir kullanici secilince) hata durumu sifirlanir.
  const [previewLoadFailed, setPreviewLoadFailed] = useState(false)
  useEffect(() => { setPreviewLoadFailed(false) }, [photoPreview])
  const showPreviewImage = photoPreview && !previewLoadFailed

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-slate-300 bg-slate-100 text-2xl lg:text-3xl font-black text-slate-400">
          {showPreviewImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoPreview}
              alt="Kullanıcı fotoğrafı"
              className="h-full w-full object-cover"
              onError={() => setPreviewLoadFailed(true)}
            />
          ) : (
            (form.name || form.username || '?').trim().slice(0, 1).toLocaleUpperCase('tr-TR')
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-lg lg:text-xl font-black text-slate-700 transition hover:bg-slate-50">
            Fotoğraf Seç
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onPhotoSelect(file)
                event.target.value = ''
              }}
            />
          </label>
          {showPreviewImage && (
            <button
              type="button"
              onClick={onPhotoRemove}
              className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-lg lg:text-xl font-black text-rose-600 transition hover:bg-rose-100"
            >
              Fotoğrafı Kaldır
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Ad Soyad</label>
        <input
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Kullanıcı Adı</label>
          <input
            value={form.username}
            onChange={(event) => onChange({ ...form, username: event.target.value })}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">E-posta</label>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Telefon</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => onChange({ ...form, phone: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Adres</label>
          <input
            value={form.address}
            onChange={(event) => onChange({ ...form, address: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Şifre{passwordRequired ? '' : ' (opsiyonel)'}</label>
        <input
          type="password"
          value={form.password}
          onChange={(event) => onChange({ ...form, password: event.target.value })}
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          required={passwordRequired}
        />
        <p className="mt-1.5 text-lg lg:text-xl font-semibold text-slate-500">{passwordHint}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Yetki</label>
          <select
            value={form.yetki}
            onChange={(event) => onChange({ ...form, yetki: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          >
            <option value="1">Yönetici</option>
            <option value="2">Yetkili Kullanıcı</option>
            <option value="3">Standart Kullanıcı</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">Durum</label>
          <select
            value={form.status}
            onChange={(event) => onChange({ ...form, status: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57] focus:bg-white"
          >
            <option value="1">Aktif</option>
            <option value="0">Pasif</option>
          </select>
        </div>
      </div>
    </div>
  )
}

export default function UsersPage() {
  const [userSearch, setUserSearch] = useState('')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'passive'>('all')
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [users, setUsers] = useState<UserRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  // Kullanici Ekle
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [addForm, setAddForm] = useState<UserFormState>(EMPTY_FORM)
  const [isSavingAdd, setIsSavingAdd] = useState(false)
  // Yeni secilen fotografin base64 onizlemesi - kullanici henuz olusturulmadigi
  // icin oncelikle burada tutulur, kayit basarili olunca /photo ucuna gonderilir.
  const [addPhotoDataUrl, setAddPhotoDataUrl] = useState<string | null>(null)

  // Kullanici Duzenle
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [editForm, setEditForm] = useState<UserFormState>(EMPTY_FORM)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  // Mevcut fotograf onizlemesi (sunucudan /photo ile), yeni secilen fotograf
  // (base64) veya kaldirma niyeti - ucu ayni "photoPreview" olarak gosterilir.
  const [editPhotoState, setEditPhotoState] = useState<{ preview: string | null; newDataUrl: string | null; removed: boolean }>({ preview: null, newDataUrl: null, removed: false })

  // Sifre Islemleri (unutan kullanici icin: rastgele olustur YA DA elle belirle)
  const [passwordModalUser, setPasswordModalUser] = useState<UserRow | null>(null)
  const [manualPassword, setManualPassword] = useState('')
  const [isPasswordBusy, setIsPasswordBusy] = useState(false)

  const loadUsers = async () => {
    setIsLoading(true)
    setLoadError('')

    try {
      const response = await fetch('/api/users?limit=500')
      const payload = (await response.json()) as UsersResponse

      if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
        throw new Error(payload.error || 'Kullanıcı listesi alınamadı.')
      }

      setUsers(payload.data)
    } catch (error) {
      setLoadError((error as Error).message)
      setUsers([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error || new Error('Dosya okunamadı.'))
    reader.readAsDataURL(file)
  })

  const openAddModal = () => {
    setAddForm(EMPTY_FORM)
    setAddPhotoDataUrl(null)
    setIsAddModalOpen(true)
  }

  const submitAddUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isValidNewPassword(addForm.password.trim())) {
      setActionMessage({ tone: 'error', text: `Şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}` })
      return
    }

    setIsSavingAdd(true)
    setActionMessage(null)
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          username: addForm.username.trim(),
          email: addForm.email.trim() || undefined,
          phone: addForm.phone.trim() || undefined,
          address: addForm.address.trim() || undefined,
          password: addForm.password,
          yetki: Number(addForm.yetki),
          status: Number(addForm.status),
        }),
      })
      const payload = await response.json().catch(() => null) as ActionResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Kullanıcı eklenemedi.')
      }

      // Kullanici basariyla olustu, artik bir id'si var - secilen fotograf
      // varsa ayri /photo ucuna gonderiliyor. Bu adim basarisiz olsa bile
      // kullanicinin kendisi zaten olustugu icin genel islemi basarisiz
      // saymiyoruz, sadece uyari veriyoruz.
      const newUserId = payload.data?.id
      let photoSaveFailed = false
      if (addPhotoDataUrl && newUserId) {
        try {
          const photoResponse = await fetch(`/api/users/${encodeURIComponent(newUserId)}/photo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData: addPhotoDataUrl }),
          })
          if (!photoResponse.ok) throw new Error()
        } catch {
          photoSaveFailed = true
        }
      }

      setIsAddModalOpen(false)
      setAddPhotoDataUrl(null)
      setActionMessage(photoSaveFailed
        ? { tone: 'error', text: 'Kullanıcı oluşturuldu ancak fotoğraf kaydedilemedi.' }
        : { tone: 'success', text: `${addForm.name || addForm.username} kullanıcısı oluşturuldu.` })
      await loadUsers()
    } catch (error) {
      setActionMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kullanıcı eklenemedi.' })
    } finally {
      setIsSavingAdd(false)
    }
  }

  const openEditModal = (user: UserRow) => {
    setEditingUser(user)
    setEditForm({
      name: user.name || user.kullanicitamadi || '',
      username: user.username || '',
      email: user.email || '',
      phone: user.phone || '',
      address: user.address || '',
      password: '',
      yetki: String(user.yetki ?? '3'),
      status: String(user.status === 1 ? '1' : '0'),
    })
    // Fotografin var olup olmadigini bilmiyoruz - dogrudan uc noktayi
    // onizleme kaynagi olarak veriyoruz, yoksa <img> zaten 404 alip
    // onError ile bos duruma dusuyor (bkz. UserFormFields render'i).
    setEditPhotoState({ preview: `/api/users/${encodeURIComponent(user.id)}/photo?ts=${Date.now()}`, newDataUrl: null, removed: false })
  }

  const submitEditUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingUser) return
    if (editForm.password && !isValidNewPassword(editForm.password.trim())) {
      setActionMessage({ tone: 'error', text: `Yeni şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}` })
      return
    }

    setIsSavingEdit(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(editingUser.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          username: editForm.username.trim(),
          email: editForm.email.trim() || undefined,
          phone: editForm.phone.trim() || undefined,
          address: editForm.address.trim() || undefined,
          yetki: Number(editForm.yetki),
          status: Number(editForm.status),
          ...(editForm.password.trim() ? { password: editForm.password.trim() } : {}),
        }),
      })
      const payload = await response.json().catch(() => null) as ActionResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Kullanıcı güncellenemedi.')
      }

      if (editPhotoState.newDataUrl) {
        await fetch(`/api/users/${encodeURIComponent(editingUser.id)}/photo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: editPhotoState.newDataUrl }),
        }).catch(() => {})
      } else if (editPhotoState.removed) {
        await fetch(`/api/users/${encodeURIComponent(editingUser.id)}/photo`, { method: 'DELETE' }).catch(() => {})
      }

      setEditingUser(null)
      setActionMessage({ tone: 'success', text: `${editForm.name || editForm.username} kullanıcısı güncellendi.` })
      await loadUsers()
    } catch (error) {
      setActionMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kullanıcı güncellenemedi.' })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const openPasswordModal = (user: UserRow) => {
    setManualPassword('')
    setPasswordModalUser(user)
  }

  // 2026-10-15: kullanici silme. Sunucu SADECE hic islem kaydi olmayan
  // hesabi siler (gecmis kayitlarin "kim yapti" bilgisi korunur); kaydi
  // olan icin Pasif yapma onerilir - bkz. app/api/users/[id]/route.ts DELETE.
  const deleteUser = async (user: UserRow) => {
    const userName = user.name || user.kullanicitamadi || user.username || 'Seçilen kullanıcı'
    if (!(await confirmDialog(`${userName} (${user.username || '-'}) kullanıcısı KALICI olarak silinsin mi? Bu işlem geri alınamaz.`, 'Evet, Sil', 'Vazgeç'))) return

    setDeletingUserId(user.id)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null) as ActionResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Kullanıcı silinemedi.')
      }
      setActionMessage({ tone: 'success', text: `${userName} kullanıcısı silindi.` })
      await loadUsers()
    } catch (error) {
      setActionMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Kullanıcı silinemedi.' })
    } finally {
      setDeletingUserId(null)
    }
  }

  const generateRandomPassword = async () => {
    if (!passwordModalUser) return
    const userName = passwordModalUser.name || passwordModalUser.kullanicitamadi || passwordModalUser.username || 'Seçilen kullanıcı'
    if (!(await confirmDialog(`${userName} kullanıcısı için güvenli bir geçici şifre oluşturulsun mu?`))) return

    setIsPasswordBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(passwordModalUser.id)}`, { method: 'PATCH' })
      const payload = await response.json().catch(() => null) as ActionResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Şifre sıfırlanamadı.')
      }
      setPasswordModalUser(null)
      setActionMessage({
        tone: 'success',
        text: `${userName} için geçici şifre: ${payload.temporaryPassword || 'oluşturuldu'}. Bu şifreyi kullanıcıya güvenli biçimde iletin.`,
      })
    } catch (error) {
      setActionMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Şifre sıfırlanamadı.' })
    } finally {
      setIsPasswordBusy(false)
    }
  }

  const sendPasswordBySms = async () => {
    if (!passwordModalUser) return
    const userName = passwordModalUser.name || passwordModalUser.kullanicitamadi || passwordModalUser.username || 'Seçilen kullanıcı'
    if (!passwordModalUser.phone || !passwordModalUser.phone.trim()) {
      setActionMessage({ tone: 'error', text: `${userName} için sisteme kayıtlı bir cep telefonu numarası yok. Önce "Düzenle" ile numarayı kaydedin.` })
      return
    }
    if (!(await confirmDialog(`${userName} için yeni bir geçici şifre oluşturulup KAYITLI TELEFONUNA SMS ile gönderilsin mi? (Şifreyi siz görmezsiniz.)`))) return

    setIsPasswordBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(passwordModalUser.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delivery: 'sms' }),
      })
      const payload = await response.json().catch(() => null) as ActionResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Şifre gönderilemedi.')
      }
      setPasswordModalUser(null)
      setActionMessage({ tone: 'success', text: payload.message || `${userName} için geçici şifre telefonuna SMS ile gönderildi.` })
    } catch (error) {
      setActionMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Şifre gönderilemedi.' })
    } finally {
      setIsPasswordBusy(false)
    }
  }

  const submitManualPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!passwordModalUser) return
    if (!isValidNewPassword(manualPassword.trim())) {
      setActionMessage({ tone: 'error', text: `Şifre kurallara uymuyor. ${PASSWORD_POLICY_DESCRIPTION}` })
      return
    }

    const userName = passwordModalUser.name || passwordModalUser.kullanicitamadi || passwordModalUser.username || 'Seçilen kullanıcı'

    setIsPasswordBusy(true)
    setActionMessage(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(passwordModalUser.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: manualPassword.trim() }),
      })
      const payload = await response.json().catch(() => null) as ActionResponse | null
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || 'Şifre belirlenemedi.')
      }
      setPasswordModalUser(null)
      setActionMessage({ tone: 'success', text: `${userName} için yeni şifre belirlendi.` })
    } catch (error) {
      setActionMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Şifre belirlenemedi.' })
    } finally {
      setIsPasswordBusy(false)
    }
  }

  const filteredUsers = useMemo(() => {
    const userTerm = foldTurkish(userSearch).trim()
    const permissionTerm = foldTurkish(permissionSearch).trim()

    return users.filter(user => {
      const statusLabel = user.status === 1 ? 'aktif' : 'pasif'
      const userMatches = !userTerm || (
        foldTurkish(user.name || user.kullanicitamadi || '').includes(userTerm) ||
        foldTurkish(user.username || '').includes(userTerm) ||
        foldTurkish(user.email || '').includes(userTerm)
      )
      const permissionMatches = !permissionTerm || (
        foldTurkish(roleLabel(user.yetki)).includes(permissionTerm) ||
        String(user.yetki ?? '').includes(permissionTerm) ||
        statusLabel.includes(permissionTerm)
      )

      return userMatches && permissionMatches
    })
  }, [permissionSearch, userSearch, users])

  const activeCount = users.filter(user => user.status === 1).length
  const passiveCount = users.length - activeCount
  const adminCount = users.filter(user => user.yetki === 1).length
  // 2026-10-15 (kurumsal tur): ozet kartlari tiklanabilir durum filtresi -
  // arama alanlariyla BIRLIKTE calisir, veri/islem mantigi degismedi.
  const statusFilteredUsers = statusFilter === 'all'
    ? filteredUsers
    : filteredUsers.filter(user => (statusFilter === 'active' ? user.status === 1 : user.status !== 1))
  // 2026-10-15: sutun basliklarina tiklayarak siralama (artan/azalan) -
  // sadece gorunum sirasi, veri degismez.
  const sortValue = (user: UserRow): string | number => {
    switch (sort.key) {
      case 'username': return user.username || ''
      case 'phone': return (user.phone || '').trim() || '￿'
      case 'role': return user.yetki ?? 99
      case 'status': return user.status === 1 ? 0 : 1
      default: return user.name || user.kullanicitamadi || user.username || ''
    }
  }
  const displayedUsers = [...statusFilteredUsers].sort((a, b) => {
    const va = sortValue(a)
    const vb = sortValue(b)
    const fark = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'tr-TR', { numeric: true, sensitivity: 'base' })
    const sonuc = fark !== 0 ? fark : (a.name || a.username || '').localeCompare(b.name || b.username || '', 'tr-TR')
    return sort.dir === 'asc' ? sonuc : -sonuc
  })
  const toggleSort = (key: SortKey) => {
    setSort(prev => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }
  const sortHeader = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1.5 uppercase tracking-wide hover:!text-[#e8cf7a]"
      title={`${label} sütununa göre sırala`}
    >
      {label}
      <span className={`text-[11px] ${sort.key === key ? 'text-[#e8cf7a]' : 'text-white/40'}`}>
        {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '▲▼'}
      </span>
    </button>
  )
  const hasFilter = Boolean(userSearch || permissionSearch || statusFilter !== 'all')

  const summaryCards: Array<{ key: 'all' | 'active' | 'passive' | null; label: string; value: number; accent: string; hint: string }> = [
    { key: 'all', label: 'Toplam Kullanıcı', value: users.length, accent: 'bg-[#0a3a57]', hint: 'Tüm hesaplar' },
    { key: 'active', label: 'Aktif', value: activeCount, accent: 'bg-emerald-600', hint: 'Giriş yapabilir' },
    { key: 'passive', label: 'Pasif', value: passiveCount, accent: 'bg-rose-600', hint: 'Girişi kapalı' },
    { key: null, label: 'Yönetici', value: adminCount, accent: 'bg-[#c9a227]', hint: 'Rolü yönetici olan' },
  ]

  return (
    <div className="ns-yazi-masaustu space-y-4 text-slate-950">
      {/* Kurumsal baslik - lacivert/altin dil (Dosya Yönetimi, Tahkikat ile ayni) */}
      <div className="ns-sayfa-baslik overflow-hidden rounded-xl border border-[#0a3a57]/20 bg-white shadow-sm">
        <div className="border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] via-[#0d4f6e] to-[#0a3a57] px-6 py-5 text-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <span className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/25 sm:flex">
                <svg viewBox="0 0 24 24" fill="none" stroke="#e8cf7a" strokeWidth="1.8" className="h-8 w-8" aria-hidden>
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" strokeLinecap="round" />
                  <circle cx="17.5" cy="9" r="2.6" />
                  <path d="M16 14.2c3.2-.3 5.5 1.8 5.5 4.8" strokeLinecap="round" />
                </svg>
              </span>
              <div>
                <p className="text-sm lg:text-base font-bold uppercase tracking-[0.18em] text-[#e8cf7a]">Kullanıcı ve Yetki Yönetimi</p>
                <h1 className="mt-0.5 text-[26px] font-black leading-tight md:text-[30px] lg:text-[36px]">Sistem Kullanıcıları</h1>
                <p className="mt-1 max-w-2xl text-base lg:text-lg font-medium text-white/75">
                  Sisteme giriş yapabilen personel hesapları. Sayfa ve işlem yetkileri için satırdaki <span className="font-bold text-white">Yetkiler</span> düğmesini kullanın.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/settings?tab=userPermissions"
                className="inline-flex items-center justify-center rounded-lg border border-white/30 bg-white/10 px-5 py-2.5 text-base lg:text-lg font-bold text-white transition hover:bg-white/20"
              >
                Kullanıcı Yetkileri
              </a>
              <button
                onClick={openAddModal}
                className="inline-flex items-center gap-2 rounded-lg bg-[#c9a227] px-5 py-2.5 text-base lg:text-lg font-black text-[#0a3a57] shadow-sm transition hover:bg-[#d8b440]"
              >
                <span className="text-xl lg:text-2xl leading-none">+</span> Yeni Kullanıcı
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 lg:grid-cols-4">
          {summaryCards.map(card => {
            const isSelected = card.key !== null && statusFilter === card.key
            const content = (
              <>
                <span className={`absolute inset-y-0 left-0 w-1.5 ${card.accent}`} />
                <p className="text-sm lg:text-base font-black uppercase tracking-wide text-slate-500">{card.label}</p>
                <p className="mt-1 text-[30px] lg:text-[35px] font-black leading-none text-slate-900">{card.value}</p>
                <p className="mt-1.5 text-sm lg:text-base font-semibold text-slate-400">{card.hint}</p>
              </>
            )
            return card.key ? (
              <button
                key={card.label}
                type="button"
                onClick={() => setStatusFilter(card.key === 'all' || statusFilter === card.key ? 'all' : card.key!)}
                className={`relative overflow-hidden rounded-lg border bg-white py-3 pl-5 pr-4 text-left shadow-sm transition hover:shadow ${isSelected ? 'border-[#0a3a57] ring-2 ring-[#0a3a57]/20' : 'border-slate-200'}`}
              >
                {content}
              </button>
            ) : (
              <div key={card.label} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white py-3 pl-5 pr-4 shadow-sm">
                {content}
              </div>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {/* Arama cubugu + liste basligi tek kartta */}
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-5 py-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="shrink-0">
            <h2 className="flex items-center gap-2 text-xl lg:text-2xl font-black text-[#0a3a57]">
              <span className="h-6 w-1.5 rounded-full bg-[#c9a227]" />
              Kullanıcı Listesi
            </h2>
            <p className="mt-1 text-sm lg:text-base font-semibold text-slate-500">{displayedUsers.length} / {users.length} kullanıcı listeleniyor</p>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:max-w-[900px]">
            <label className="relative block">
              <span className="mb-1 block text-xs lg:text-sm font-black uppercase tracking-wide text-slate-500">Kullanıcı Ara</span>
              <input
                type="text"
                placeholder="Ad soyad, kullanıcı adı veya e-posta..."
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 text-base lg:text-lg font-semibold outline-none transition focus:border-[#0a3a57] focus:bg-white focus:ring-2 focus:ring-[#0a3a57]/10"
              />
            </label>
            <label className="relative block">
              <span className="mb-1 block text-xs lg:text-sm font-black uppercase tracking-wide text-slate-500">Rol / Durum Ara</span>
              <input
                type="text"
                placeholder="Yönetici, yetkili, standart, aktif, pasif..."
                value={permissionSearch}
                onChange={(event) => setPermissionSearch(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 px-3.5 text-base lg:text-lg font-semibold outline-none transition focus:border-[#0a3a57] focus:bg-white focus:ring-2 focus:ring-[#0a3a57]/10"
              />
            </label>
          </div>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setUserSearch('')
                setPermissionSearch('')
                setStatusFilter('all')
              }}
              className="h-11 shrink-0 rounded-lg border border-slate-300 bg-white px-4 text-sm lg:text-base font-black text-slate-600 hover:bg-slate-50"
            >
              Filtreleri Temizle
            </button>
          )}
        </div>

        {actionMessage && (
          <div className={`mx-5 mt-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-base lg:text-lg font-bold ${actionMessage.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            <span>{actionMessage.text}</span>
            <button type="button" onClick={() => setActionMessage(null)} className="shrink-0 rounded px-3 py-1 text-sm lg:text-base hover:bg-white/70">Kapat</button>
          </div>
        )}

        <div className="overflow-x-auto p-4">
          <table className="ns-tablo ns-tablo-buyuk ns-tablo-kullanici w-full min-w-[1000px] border-separate border-spacing-0 text-left text-base lg:text-lg">
            <thead>
              <tr className="text-sm lg:text-lg font-black uppercase tracking-wide text-white">
                <th className="rounded-tl-lg bg-[#0a3a57] px-4 py-3">{sortHeader('name', 'Kullanıcı')}</th>
                <th className="bg-[#0a3a57] px-4 py-3">{sortHeader('username', 'Kullanıcı Adı')}</th>
                <th className="bg-[#0a3a57] px-4 py-3">{sortHeader('phone', 'İletişim')}</th>
                <th className="bg-[#0a3a57] px-4 py-3">{sortHeader('role', 'Rol')}</th>
                <th className="bg-[#0a3a57] px-4 py-3">{sortHeader('status', 'Durum')}</th>
                <th className="rounded-tr-lg bg-[#0a3a57] px-4 py-3 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="border-b border-slate-200 px-4 py-12 text-center text-base lg:text-xl font-bold text-slate-500">
                    Kullanıcılar yükleniyor...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={6} className="border-b border-slate-200 px-4 py-12 text-center text-base lg:text-xl font-bold text-rose-600">
                    {loadError}
                  </td>
                </tr>
              ) : displayedUsers.length > 0 ? (
                displayedUsers.map((row, index) => (
                  <tr key={row.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} transition-colors hover:bg-sky-50/60`}>
                    <td className="border-b border-slate-200 px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <UserAvatar userId={row.id} name={row.name || row.kullanicitamadi || row.username} />
                        <span className="font-black text-slate-900">{row.name || row.kullanicitamadi || '-'}</span>
                      </div>
                    </td>
                    <td className="border-b border-slate-200 px-4 py-2.5">
                      <span className="rounded bg-slate-100 px-2 py-1 font-mono text-[15px] lg:text-[19px] font-bold text-[#0a3a57]">{row.username || '-'}</span>
                    </td>
                    <td className="border-b border-slate-200 px-4 py-2.5 text-[15px] lg:text-[19px] font-semibold text-slate-600">
                      <span className="block">{row.phone && row.phone.trim() ? row.phone : <span className="text-slate-300">Telefon yok</span>}</span>
                      {row.email && row.email.trim() && row.email.trim() !== '"' && <span className="block text-sm lg:text-lg text-slate-400">{row.email}</span>}
                    </td>
                    <td className="border-b border-slate-200 px-4 py-2.5">
                      <span className={`inline-flex rounded-md border px-2.5 py-1 text-sm lg:text-lg font-black ${roleBadgeClass(row.yetki)}`}>
                        {roleLabel(row.yetki)}
                      </span>
                    </td>
                    <td className="border-b border-slate-200 px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm lg:text-lg font-black ${
                        row.status === 1 ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                      }`}>
                        <span className={`h-2 w-2 rounded-full ${row.status === 1 ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {row.status === 1 ? 'Aktif' : 'Pasif'}
                      </span>
                    </td>
                    <td className="border-b border-slate-200 px-4 py-2.5 text-right">
                      <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
                        <button
                          type="button"
                          onClick={() => openEditModal(row)}
                          className="px-3.5 py-2 text-sm lg:text-lg font-black text-slate-700 transition hover:bg-slate-100"
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          onClick={() => openPasswordModal(row)}
                          className="border-l border-slate-300 px-3.5 py-2 text-sm lg:text-lg font-black text-amber-800 transition hover:bg-amber-50"
                        >
                          Şifre
                        </button>
                        <a
                          href={`/settings?tab=userPermissions&user=${encodeURIComponent(row.id)}`}
                          className="border-l border-slate-300 bg-[#0a3a57] px-3.5 py-2 text-sm lg:text-lg font-black text-white transition hover:bg-[#0d4f6e]"
                        >
                          Yetkiler
                        </a>
                      </div>
                      <button
                        type="button"
                        onClick={() => void deleteUser(row)}
                        disabled={deletingUserId === row.id}
                        title="Kullanıcıyı sil (yalnızca hiç işlem kaydı olmayan hesaplar)"
                        className="ml-2 inline-flex items-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm lg:text-lg font-black text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50"
                      >
                        {deletingUserId === row.id ? 'Siliniyor...' : 'Sil'}
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="border-b border-slate-200 px-4 py-12 text-center text-base lg:text-xl font-bold text-slate-500">
                    Kullanıcı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <form onSubmit={submitAddUser} className="w-full max-w-lg rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-2xl border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-6 py-4">
              <h3 className="text-xl lg:text-2xl font-black text-white">Sisteme Kullanıcı Ekle</h3>
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="rounded-full px-2.5 py-1 text-lg lg:text-xl font-black text-white/70 transition-colors hover:bg-white/10 hover:text-white">
                X
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              <UserFormFields
                form={addForm}
                onChange={setAddForm}
                passwordRequired
                passwordHint="Kullanıcı ilk girişte bu şifreyi kullanacak - en az 6 karakter."
                photoPreview={addPhotoDataUrl}
                onPhotoSelect={(file) => void fileToDataUrl(file).then(setAddPhotoDataUrl)}
                onPhotoRemove={() => setAddPhotoDataUrl(null)}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-xl lg:text-2xl font-extrabold text-slate-600 hover:bg-slate-100">
                Vazgeç
              </button>
              <button type="submit" disabled={isSavingAdd} className="rounded-md bg-[#0a3a57] px-5 py-2.5 text-xl lg:text-2xl font-extrabold text-white shadow-sm transition-colors hover:bg-[#0d4f6e] disabled:cursor-wait disabled:opacity-60">
                {isSavingAdd ? 'Kaydediliyor...' : 'Kullanıcı Oluştur'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <form onSubmit={submitEditUser} className="w-full max-w-lg rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-2xl border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-6 py-4">
              <h3 className="text-xl lg:text-2xl font-black text-white">Kullanıcıyı Düzenle</h3>
              <button type="button" onClick={() => setEditingUser(null)} className="rounded-full px-2.5 py-1 text-lg lg:text-xl font-black text-white/70 transition-colors hover:bg-white/10 hover:text-white">
                X
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-6">
              <UserFormFields
                form={editForm}
                onChange={setEditForm}
                passwordRequired={false}
                passwordHint="Boş bırakılırsa mevcut şifre değişmez. Doldurulursa en az 6 karakter olmalı."
                photoPreview={editPhotoState.removed ? null : (editPhotoState.newDataUrl || editPhotoState.preview)}
                onPhotoSelect={(file) => void fileToDataUrl(file).then((dataUrl) => setEditPhotoState((prev) => ({ ...prev, newDataUrl: dataUrl, removed: false })))}
                onPhotoRemove={() => setEditPhotoState((prev) => ({ ...prev, newDataUrl: null, removed: true }))}
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
              <button type="button" onClick={() => setEditingUser(null)} className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-xl lg:text-2xl font-extrabold text-slate-600 hover:bg-slate-100">
                Vazgeç
              </button>
              <button type="submit" disabled={isSavingEdit} className="rounded-md bg-[#0a3a57] px-5 py-2.5 text-xl lg:text-2xl font-extrabold text-white shadow-sm transition-colors hover:bg-[#0d4f6e] disabled:cursor-wait disabled:opacity-60">
                {isSavingEdit ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between rounded-t-2xl border-b-4 border-[#c9a227] bg-gradient-to-r from-[#0a3a57] to-[#0d4f6e] px-6 py-4">
              <h3 className="text-xl lg:text-2xl font-black text-white">Şifre İşlemleri</h3>
              <button type="button" onClick={() => setPasswordModalUser(null)} className="rounded-full px-2.5 py-1 text-lg lg:text-xl font-black text-white/70 transition-colors hover:bg-white/10 hover:text-white">
                X
              </button>
            </div>
            <div className="space-y-5 p-6">
              <p className="text-xl lg:text-2xl font-bold text-slate-600">
                {passwordModalUser.name || passwordModalUser.kullanicitamadi || passwordModalUser.username} kullanıcısı şifresini unuttuysa, aşağıdaki yollardan birini kullanabilirsiniz.
              </p>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-lg lg:text-xl font-black uppercase text-emerald-800">Yol 1 - Şifreyi Kullanıcının Telefonuna Gönder (Önerilen)</p>
                <p className="mt-1.5 text-lg lg:text-xl font-semibold text-emerald-700">
                  Sistem yeni bir geçici şifre üretip <span className="font-black">kullanıcının kayıtlı cep telefonuna SMS ile</span> gönderir. Şifreyi siz görmezsiniz. Kullanıcı bu şifreyle girip kendi şifresini belirler.
                </p>
                <p className="mt-1.5 text-lg lg:text-xl font-bold text-emerald-600">
                  Kayıtlı telefon: {passwordModalUser.phone && passwordModalUser.phone.trim() ? passwordModalUser.phone : '— (yok, önce Düzenle ile ekleyin)'}
                </p>
                <button
                  type="button"
                  onClick={() => void sendPasswordBySms()}
                  disabled={isPasswordBusy || !passwordModalUser.phone || !passwordModalUser.phone.trim()}
                  className="mt-3 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-xl lg:text-2xl font-extrabold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Geçici Şifreyi SMS ile Gönder
                </button>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-lg lg:text-xl font-black uppercase text-amber-800">Yol 2 - Rastgele Geçici Şifre (Ekranda Göster)</p>
                <p className="mt-1.5 text-lg lg:text-xl font-semibold text-amber-700">Sistem güvenli, rastgele bir şifre üretir; ekranda bir kez gösterilir, kullanıcıya iletmeniz gerekir.</p>
                <button
                  type="button"
                  onClick={() => void generateRandomPassword()}
                  disabled={isPasswordBusy}
                  className="mt-3 w-full rounded-md bg-amber-500 px-4 py-2.5 text-xl lg:text-2xl font-extrabold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60"
                >
                  Rastgele Şifre Oluştur
                </button>
              </div>

              <form onSubmit={submitManualPassword} className="rounded-lg border border-slate-300 bg-slate-50 p-4">
                <p className="text-lg lg:text-xl font-black uppercase text-[#1E2A38]">Yol 3 - Kendiniz Belirleyin</p>
                <p className="mt-1.5 text-lg lg:text-xl font-semibold text-slate-600">Kullanıcıya telefonla/yüz yüze bildireceğiniz belirli bir şifre girin.</p>
                <input
                  type="password"
                  value={manualPassword}
                  onChange={(event) => setManualPassword(event.target.value)}
                  placeholder="Yeni şifre (en az 6 karakter, 1 büyük + 1 küçük harf)"
                  autoComplete="new-password"
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-lg lg:text-xl font-bold text-slate-900 outline-none focus:border-[#0a3a57]"
                  required
                />
                <button
                  type="submit"
                  disabled={isPasswordBusy}
                  className="mt-3 w-full rounded-md bg-[#0a3a57] px-4 py-2.5 text-xl lg:text-2xl font-extrabold text-white shadow-sm transition hover:bg-[#0d4f6e] disabled:cursor-wait disabled:opacity-60"
                >
                  Bu Şifreyi Ata
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
