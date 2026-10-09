'use client'

import { useEffect, useMemo, useState } from 'react'
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

const roleLabel = (yetki?: number | null) => {
  if (yetki === 1) return 'Yonetici'
  if (yetki === 2) return 'Yetkili Kullanici'
  if (yetki === 3) return 'Standart Kullanici'
  return 'Tanimli Degil'
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
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-xl font-black text-slate-400">
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
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-slate-300 bg-slate-100 text-2xl font-black text-slate-400">
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
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-lg font-black text-slate-700 transition hover:bg-slate-50">
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
              className="inline-flex w-fit items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-lg font-black text-rose-600 transition hover:bg-rose-100"
            >
              Fotoğrafı Kaldır
            </button>
          )}
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Ad Soyad</label>
        <input
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Kullanici Adi</label>
          <input
            value={form.username}
            onChange={(event) => onChange({ ...form, username: event.target.value })}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
            required
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">E-posta</label>
          <input
            type="email"
            value={form.email}
            onChange={(event) => onChange({ ...form, email: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Telefon</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(event) => onChange({ ...form, phone: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Adres</label>
          <input
            value={form.address}
            onChange={(event) => onChange({ ...form, address: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Şifre{passwordRequired ? '' : ' (opsiyonel)'}</label>
        <input
          type="password"
          value={form.password}
          onChange={(event) => onChange({ ...form, password: event.target.value })}
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
          required={passwordRequired}
        />
        <p className="mt-1.5 text-lg font-semibold text-slate-500">{passwordHint}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Yetki</label>
          <select
            value={form.yetki}
            onChange={(event) => onChange({ ...form, yetki: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
          >
            <option value="1">Yönetici</option>
            <option value="2">Yetkili Kullanıcı</option>
            <option value="3">Standart Kullanıcı</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Durum</label>
          <select
            value={form.status}
            onChange={(event) => onChange({ ...form, status: event.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38] focus:bg-white"
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
        throw new Error(payload.error || 'Kullanici listesi alinamadi.')
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
    const userTerm = userSearch.toLocaleLowerCase('tr-TR').trim()
    const permissionTerm = permissionSearch.toLocaleLowerCase('tr-TR').trim()

    return users.filter(user => {
      const statusLabel = user.status === 1 ? 'aktif' : 'pasif'
      const userMatches = !userTerm || (
        (user.name || user.kullanicitamadi || '').toLocaleLowerCase('tr-TR').includes(userTerm) ||
        (user.username || '').toLocaleLowerCase('tr-TR').includes(userTerm) ||
        (user.email || '').toLocaleLowerCase('tr-TR').includes(userTerm)
      )
      const permissionMatches = !permissionTerm || (
        roleLabel(user.yetki).toLocaleLowerCase('tr-TR').includes(permissionTerm) ||
        String(user.yetki ?? '').includes(permissionTerm) ||
        statusLabel.includes(permissionTerm)
      )

      return userMatches && permissionMatches
    })
  }, [permissionSearch, userSearch, users])

  const activeCount = users.filter(user => user.status === 1).length
  const passiveCount = users.length - activeCount

  return (
    <div className="space-y-5 text-slate-950">
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-[#1E2A38] px-6 py-6 text-white">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xl font-black uppercase tracking-wide text-white/80">Kullanici ve Yetki Yonetimi</p>
              <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">Sistem Kullanicilari</h1>
              <p className="mt-2 max-w-2xl text-xl font-semibold text-white/75">Liste sosyalyardim veritabanindaki kullanicilar tablosundan canli okunur; yetki duzenleme ilgili kullanici kaydi uzerinden acilir.</p>
            </div>
            <button
              onClick={openAddModal}
              className="rounded-md bg-white px-6 py-3 text-xl font-extrabold text-[#1E2A38] shadow-sm transition-colors hover:bg-slate-100"
            >
              Yeni Kullanici Ekle
            </button>
          </div>
        </div>

        <div className="grid gap-3 bg-slate-50 p-5 md:grid-cols-4">
          <div className="rounded-lg border border-slate-300 bg-white p-4">
            <p className="text-lg font-black uppercase text-slate-400">Toplam Kullanici</p>
            <p className="mt-1.5 text-3xl font-black text-slate-900">{users.length}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-white p-4">
            <p className="text-lg font-black uppercase text-emerald-600">Aktif</p>
            <p className="mt-1.5 text-3xl font-black text-emerald-700">{activeCount}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-white p-4">
            <p className="text-lg font-black uppercase text-rose-600">Pasif</p>
            <p className="mt-1.5 text-3xl font-black text-rose-700">{passiveCount}</p>
          </div>
          <div className="rounded-lg border border-slate-300 bg-white p-4">
            <p className="text-lg font-black uppercase text-[#1E2A38]">Filtre Sonucu</p>
            <p className="mt-1.5 text-3xl font-black text-[#1E2A38]">{filteredUsers.length}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2">
          <p className="text-xl font-black uppercase tracking-wide text-[#1E2A38]">Arama ve Filtreleme</p>
          <h2 className="text-2xl font-extrabold text-slate-900">Kullanici kayitlarini hizli bulun</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Kullanici Arama</label>
            <input
              type="text"
              placeholder="Ad soyad, kullanici adi veya e-posta..."
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold outline-none transition focus:border-[#1E2A38] focus:bg-white focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xl font-black uppercase text-slate-500">Yetki Arama</label>
            <input
              type="text"
              placeholder="Yonetici, yetkili, standart, aktif veya pasif..."
              value={permissionSearch}
              onChange={(event) => setPermissionSearch(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xl font-bold outline-none transition focus:border-[#1E2A38] focus:bg-white focus:ring-2 focus:ring-sky-100"
            />
          </div>
        </div>
        {(userSearch || permissionSearch) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-4 py-1.5 text-lg font-black text-[#1E2A38]">{filteredUsers.length} kayit listeleniyor</span>
            <button
              type="button"
              onClick={() => {
                setUserSearch('')
                setPermissionSearch('')
              }}
              className="rounded-full border border-slate-300 px-4 py-1.5 text-lg font-black text-slate-500 hover:bg-slate-50"
            >
              Filtreleri Temizle
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm md:p-8">
        <div className="mb-6 flex flex-col items-start justify-between gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-extrabold text-[#1E2A38]">Kullanici Listesi</h2>
            <p className="mt-1.5 text-xl font-bold text-slate-500">Yetkileri duzenle butonu kullaniciyi dogrudan yetki ekraninda acar.</p>
          </div>
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-lg font-black text-slate-500">
            Kaynak: sosyalyardim.kullanicilar
          </div>
        </div>

        {actionMessage && (
          <div className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-xl font-bold ${actionMessage.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>
            <span>{actionMessage.text}</span>
            <button type="button" onClick={() => setActionMessage(null)} className="shrink-0 rounded px-3 py-1.5 text-lg hover:bg-white/70">Kapat</button>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-300">
          <table className="w-full min-w-[900px] border-collapse text-left text-xl font-semibold">
            <thead className="border-b border-slate-200 bg-slate-50 text-lg font-extrabold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Foto</th>
                <th className="px-4 py-3">Ad Soyad</th>
                <th className="px-4 py-3">Kullanici Adi</th>
                <th className="px-4 py-3">E-posta</th>
                <th className="px-4 py-3">Rol / Yetki</th>
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3 text-right">Islemler</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xl font-bold text-slate-500">
                    Kullanicilar yukleniyor...
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xl font-bold text-rose-600">
                    {loadError}
                  </td>
                </tr>
              ) : filteredUsers.length > 0 ? (
                filteredUsers.map((row, index) => (
                  <tr key={row.id} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} border-b border-slate-200 transition-colors last:border-0 hover:bg-slate-50`}>
                    <td className="px-4 py-3">
                      <UserAvatar userId={row.id} name={row.name || row.kullanicitamadi || row.username} />
                    </td>
                    <td className="px-4 py-3 font-extrabold text-slate-900">{row.name || row.kullanicitamadi || '-'}</td>
                    <td className="px-4 py-3 text-[#1E2A38]">{row.username || '-'}</td>
                    <td className="px-4 py-3 text-slate-900">{row.email || '-'}</td>
                    <td className="px-4 py-3 text-slate-900">
                      <span className={`inline-flex rounded-full border px-3 py-1.5 text-lg font-extrabold ${roleBadgeClass(row.yetki)}`}>
                        {roleLabel(row.yetki)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      <span className={`inline-flex rounded-full px-3 py-1.5 text-lg font-extrabold tracking-wide ${
                        row.status === 1 ? 'bg-[#e6f3dd] text-[#4f8f2f]' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {row.status === 1 ? 'AKTIF' : 'PASIF'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(row)}
                        className="inline-block rounded-md border border-slate-300 bg-white px-4 py-2 text-lg font-black text-slate-700 transition hover:bg-slate-50"
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        onClick={() => openPasswordModal(row)}
                        className="inline-block rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-lg font-black text-amber-800 transition hover:bg-amber-100"
                      >
                        Şifre İşlemleri
                      </button>
                      <a
                        href={`/settings?tab=userPermissions&user=${encodeURIComponent(row.id)}`}
                        className="inline-block rounded-md border border-[#1E2A38] bg-white px-4 py-2 text-lg font-black text-[#1E2A38] transition hover:bg-slate-100"
                      >
                        Yetkileri Duzenle
                      </a>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xl font-bold text-slate-500">
                    Kullanici bulunamadi.
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
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-2xl font-extrabold text-[#1E2A38]">Sisteme Kullanici Ekle</h3>
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="rounded-full p-1.5 text-xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500">
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
              <button type="button" onClick={() => setIsAddModalOpen(false)} className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-xl font-extrabold text-slate-600 hover:bg-slate-100">
                Vazgeç
              </button>
              <button type="submit" disabled={isSavingAdd} className="rounded-md bg-[#1E2A38] px-5 py-2.5 text-xl font-extrabold text-white shadow-sm transition-colors hover:bg-[#2A3B4D] disabled:cursor-wait disabled:opacity-60">
                {isSavingAdd ? 'Kaydediliyor...' : 'Kullanıcı Oluştur'}
              </button>
            </div>
          </form>
        </div>
      )}

      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <form onSubmit={submitEditUser} className="w-full max-w-lg rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-2xl font-extrabold text-[#1E2A38]">Kullaniciyi Duzenle</h3>
              <button type="button" onClick={() => setEditingUser(null)} className="rounded-full p-1.5 text-xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500">
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
              <button type="button" onClick={() => setEditingUser(null)} className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-xl font-extrabold text-slate-600 hover:bg-slate-100">
                Vazgeç
              </button>
              <button type="submit" disabled={isSavingEdit} className="rounded-md bg-[#1E2A38] px-5 py-2.5 text-xl font-extrabold text-white shadow-sm transition-colors hover:bg-[#2A3B4D] disabled:cursor-wait disabled:opacity-60">
                {isSavingEdit ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-2xl font-extrabold text-[#1E2A38]">Şifre İşlemleri</h3>
              <button type="button" onClick={() => setPasswordModalUser(null)} className="rounded-full p-1.5 text-xl text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500">
                X
              </button>
            </div>
            <div className="space-y-5 p-6">
              <p className="text-xl font-bold text-slate-600">
                {passwordModalUser.name || passwordModalUser.kullanicitamadi || passwordModalUser.username} kullanıcısı şifresini unuttuysa, aşağıdaki yollardan birini kullanabilirsiniz.
              </p>

              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-lg font-black uppercase text-emerald-800">Yol 1 - Şifreyi Kullanıcının Telefonuna Gönder (Önerilen)</p>
                <p className="mt-1.5 text-lg font-semibold text-emerald-700">
                  Sistem yeni bir geçici şifre üretip <span className="font-black">kullanıcının kayıtlı cep telefonuna SMS ile</span> gönderir. Şifreyi siz görmezsiniz. Kullanıcı bu şifreyle girip kendi şifresini belirler.
                </p>
                <p className="mt-1.5 text-lg font-bold text-emerald-600">
                  Kayıtlı telefon: {passwordModalUser.phone && passwordModalUser.phone.trim() ? passwordModalUser.phone : '— (yok, önce Düzenle ile ekleyin)'}
                </p>
                <button
                  type="button"
                  onClick={() => void sendPasswordBySms()}
                  disabled={isPasswordBusy || !passwordModalUser.phone || !passwordModalUser.phone.trim()}
                  className="mt-3 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-xl font-extrabold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Geçici Şifreyi SMS ile Gönder
                </button>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-lg font-black uppercase text-amber-800">Yol 2 - Rastgele Geçici Şifre (Ekranda Göster)</p>
                <p className="mt-1.5 text-lg font-semibold text-amber-700">Sistem güvenli, rastgele bir şifre üretir; ekranda bir kez gösterilir, kullanıcıya iletmeniz gerekir.</p>
                <button
                  type="button"
                  onClick={() => void generateRandomPassword()}
                  disabled={isPasswordBusy}
                  className="mt-3 w-full rounded-md bg-amber-500 px-4 py-2.5 text-xl font-extrabold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-wait disabled:opacity-60"
                >
                  Rastgele Şifre Oluştur
                </button>
              </div>

              <form onSubmit={submitManualPassword} className="rounded-lg border border-slate-300 bg-slate-50 p-4">
                <p className="text-lg font-black uppercase text-[#1E2A38]">Yol 3 - Kendiniz Belirleyin</p>
                <p className="mt-1.5 text-lg font-semibold text-slate-600">Kullanıcıya telefonla/yüz yüze bildireceğiniz belirli bir şifre girin.</p>
                <input
                  type="password"
                  value={manualPassword}
                  onChange={(event) => setManualPassword(event.target.value)}
                  placeholder="Yeni şifre (en az 8 karakter, 1 büyük harf + 1 rakam)"
                  autoComplete="new-password"
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xl font-bold text-slate-900 outline-none focus:border-[#1E2A38]"
                  required
                />
                <button
                  type="submit"
                  disabled={isPasswordBusy}
                  className="mt-3 w-full rounded-md bg-[#1E2A38] px-4 py-2.5 text-xl font-extrabold text-white shadow-sm transition hover:bg-[#2A3B4D] disabled:cursor-wait disabled:opacity-60"
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
