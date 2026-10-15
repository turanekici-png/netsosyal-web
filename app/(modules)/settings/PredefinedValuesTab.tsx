'use client'

// 2026-10-15 kullanici istegi: Ayarlar > Sistem Ayarları > Hazır Değerler
// sayfasi "daha kurumsal, kullanışlı ve profesyonel" olsun. Eski 2 sutunlu
// kart izgarasi yerine: solda aranabilir liste gezgini, sagda secili listenin
// tablo duzenleyicisi (kod/deger, siralama, dogrulama, kullanim aciklamasi).
// Kayit akisi AYNI: ust bardaki "Değişiklikleri Kaydet" -> savePredefinedValues
// (page.tsx); bu dosya yalniz state'i duzenler ve kayit oncesi dogrulamayi saglar.

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { confirmDialog } from '@/components/shared/GlobalConfirmDialog'
import { DEFAULT_PREDEFINED_VALUES, normalizePredefinedText, type PredefinedValue } from '@/lib/constants/predefinedValues'

type ValuesMap = Record<string, PredefinedValue[]>
type TitlesMap = Record<string, string>

// "Yardım Kriterleri" kendi sekmesinde yonetilir - burada gosterilmez/dogrulanmaz.
const HIDDEN_CATEGORIES = new Set(['yardimKriterleri'])
// Kodda varsayilan olarak tanimli, uygulamanin dogrudan okudugu listeler -
// silinirlerse ekranlar bozulur; basligi/satirlari duzenlenebilir ama liste silinemez.
const SYSTEM_CATEGORIES = new Set(Object.keys(DEFAULT_PREDEFINED_VALUES).filter((key) => !HIDDEN_CATEGORIES.has(key)))

const SYSTEM_USAGE: Record<string, string> = {
  fileStatus: 'Dosyaların durumu (Dosyalar, Dosya Yönetimi, İş Akışı, raporlar).',
  assistanceStatus: 'Gıda, Ekmek, Hazır Yemek, Destek Paketi vb. yardım ve müracaat durumları.',
  relationship: 'Bireylerin dosya sahibine yakınlık derecesi (Bireyler, hane bilgileri).',
  maritalStatus: 'Bireylerin medeni hali.',
  gender: 'Bireylerin cinsiyeti.',
  healthStatus: 'Bireylerin sağlık durumu (Bireyler, Aceze).',
  familyType: 'Dosyanın aile niteliği (Dosyalar listesi, hane ziyareti formu).',
}

// Ozel (sonradan eklenen) listelerin nerede kullanildigi baslik eslesmesiyle anlatilir.
const TITLE_USAGE: Array<[string[], string]> = [
  [['mulkiyet'], 'Dosyanın mülkiyet durumu (Dosyalar listesi, hane ziyareti formu, nakit aktarımı).'],
  [['oncelik'], 'Dosyanın yardım öncelik sırası (Dosyalar listesi, hane ziyareti formu).'],
  [['konut'], 'Dosyanın konut türü (Dosyalar listesi).'],
  [['isinma'], 'Dosyanın ısınma türü (Dosyalar listesi).'],
  [['ogrenim', 'egitim'], 'Bireylerin öğrenim durumu (Bireyler listesi).'],
  [['guvence'], 'Bireylerin sosyal güvencesi (Bireyler listesi).'],
  [['donem'], 'Yardım dönemleri (Nakit ve diğer yardım müracaatlarında dönem seçimi, Yardım Kriterleri).'],
  [['etiket'], 'Yardım etiketleri (müracaat ve yardım listelerinde etiket seçimi).'],
  [['asama'], 'Nakit müracaatlarının değerlendirme aşaması.'],
  [['dgn', 'd-g-n'], 'Dönem Dışı Gıda, Giyim ve Nakit yardımlarının durumu.'],
  [['nakit'], 'Nakit müracaatlarının durumu.'],
  [['tahkikat'], 'Tahkikat raporlarının konusu.'],
  [['cinsiyet'], 'Cinsiyet seçenekleri.'],
]

function usageText(category: string, title: string) {
  if (SYSTEM_USAGE[category]) return SYSTEM_USAGE[category]
  const folded = normalizePredefinedText(title)
  const match = TITLE_USAGE.find(([keys]) => keys.some((key) => folded.includes(normalizePredefinedText(key))))
  return match ? match[1] : 'Özel liste - ilgili ekranlarda seçenek olarak kullanılır.'
}

export type PredefinedIssue = { index: number; message: string }

// Satir bazli sorunlar: kodu bos (ama adi dolu) / adi bos (ama kodu dolu) /
// ayni kod birden fazla satirda. Tamamen bos satirlar sorun sayilmaz
// (kayitta zaten atilir - bkz. cleanPredefinedValuesForSave).
export function findPredefinedIssues(items: PredefinedValue[] = []): PredefinedIssue[] {
  const issues: PredefinedIssue[] = []
  const seen = new Map<string, number>()
  items.forEach((item, index) => {
    const id = String(item.id ?? '').trim()
    const name = String(item.name ?? '').trim()
    if (!id && !name) return
    if (!id) issues.push({ index, message: 'Kod boş bırakılamaz.' })
    if (!name) issues.push({ index, message: 'Ad boş bırakılamaz.' })
    if (id) {
      const key = id.toLocaleLowerCase('tr-TR')
      if (seen.has(key)) issues.push({ index, message: `"${id}" kodu ${seen.get(key)! + 1}. satırda da kullanılıyor.` })
      else seen.set(key, index)
    }
  })
  return issues
}

// Kayit oncesi: Hazır Değerler sekmesindeki listelerde sorun varsa ilk sorunu
// aciklayan mesaj doner (kayit yapilmaz); yoksa null.
export function validatePredefinedValues(values: ValuesMap, titles: TitlesMap): string | null {
  for (const category of Object.keys(titles)) {
    if (HIDDEN_CATEGORIES.has(category)) continue
    if (!String(titles[category] ?? '').trim()) return 'Liste başlığı boş bırakılamaz.'
    const issue = findPredefinedIssues(values[category])[0]
    if (issue) return `"${titles[category]}" listesi, ${issue.index + 1}. satır: ${issue.message}`
  }
  return null
}

// Tamamen bos satirlari atar, kod/ad bosluklarini kirpar (Yardım Kriterleri'ne dokunmaz).
export function cleanPredefinedValuesForSave(values: ValuesMap): ValuesMap {
  return Object.fromEntries(Object.entries(values).map(([category, items]) => {
    if (HIDDEN_CATEGORIES.has(category)) return [category, items]
    const cleaned = (items ?? [])
      .map((item) => ({ ...item, id: String(item.id ?? '').trim(), name: String(item.name ?? '').trim() }))
      .filter((item) => item.id || item.name)
    return [category, cleaned]
  }))
}

// Sayisal kodlu listelerde bir sonraki kodu onerir (en buyuk + 1); sayisal degilse bos.
function suggestNextCode(items: PredefinedValue[] = []) {
  const ids = items.map((item) => String(item.id ?? '').trim()).filter(Boolean)
  if (ids.length > 0 && !ids.every((id) => /^\d+$/.test(id))) return ''
  return String(ids.reduce((max, id) => Math.max(max, Number(id)), 0) + 1)
}

const inputBase =
  'w-full rounded-md border bg-white px-2.5 py-[3px] text-[15px] font-semibold leading-6 text-slate-900 outline-none transition focus:border-[#1E2A38] focus:ring-2 focus:ring-[#1E2A38]/15'
const buttonBase =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-[14.5px] font-bold shadow-sm transition-colors disabled:pointer-events-none disabled:opacity-40'
const buttonNeutral = `${buttonBase} border-slate-300 bg-white text-[#1E2A38] hover:border-[#1E2A38] hover:bg-[#F6F3EA]`
const buttonPrimary = `${buttonBase} border-[#1E2A38] bg-[#1E2A38] text-white hover:bg-[#2A3B4D]`
const buttonDanger = `${buttonBase} border-rose-300 bg-white text-rose-700 hover:border-rose-500 hover:bg-rose-50`
// Tablo satirindaki kucuk dugmeler - veri alaniyla ayni yukseklikte (32px).
const rowButtonBase = 'inline-flex h-8 items-center justify-center rounded-md border text-[13px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-30'
const rowButton = `${rowButtonBase} border-slate-300 bg-white text-[#1E2A38] hover:border-[#1E2A38] hover:bg-[#F6F3EA]`
const rowDangerButton = `${rowButtonBase} border-rose-300 bg-white text-rose-700 hover:border-rose-500 hover:bg-rose-50`

type Props = {
  values: ValuesMap
  titles: TitlesMap
  setValues: Dispatch<SetStateAction<ValuesMap>>
  setTitles: Dispatch<SetStateAction<TitlesMap>>
  isDirty: boolean
  isSaving: boolean
  saveStatus: string
  onSave: () => void
}

export function PredefinedValuesTab({ values, titles, setValues, setTitles, isDirty, isSaving, saveStatus, onSave }: Props) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const categories = useMemo(
    () => Object.keys(titles).filter((category) => !HIDDEN_CATEGORIES.has(category)),
    [titles],
  )
  const foldedSearch = normalizePredefinedText(search)
  const filteredCategories = categories.filter((category) => {
    if (!foldedSearch) return true
    if (normalizePredefinedText(titles[category] ?? '').includes(foldedSearch)) return true
    return (values[category] ?? []).some((item) => normalizePredefinedText(`${item.id} ${item.name}`).includes(foldedSearch))
  })
  const activeCategory = selected && categories.includes(selected) ? selected : filteredCategories[0] ?? categories[0] ?? null
  const items = activeCategory ? values[activeCategory] ?? [] : []
  const issues = findPredefinedIssues(items)
  const issueByIndex = new Map<number, string[]>()
  issues.forEach((issue) => issueByIndex.set(issue.index, [...(issueByIndex.get(issue.index) ?? []), issue.message]))
  const totalValues = categories.reduce((sum, category) => sum + (values[category]?.length ?? 0), 0)
  const listsWithIssues = categories.filter((category) => findPredefinedIssues(values[category]).length > 0).length
  const isSystem = activeCategory ? SYSTEM_CATEGORIES.has(activeCategory) : false
  const statusIsError = Boolean(saveStatus) && !saveStatus.includes('kaydedildi')

  const updateItems = (category: string, next: (current: PredefinedValue[]) => PredefinedValue[]) => {
    setValues((prev) => ({ ...prev, [category]: next(prev[category] ?? []) }))
  }

  const addRow = () => {
    if (!activeCategory) return
    updateItems(activeCategory, (current) => [...current, { id: suggestNextCode(current), name: '' }])
  }

  const moveRow = (index: number, direction: -1 | 1) => {
    if (!activeCategory) return
    updateItems(activeCategory, (current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [row] = next.splice(index, 1)
      next.splice(target, 0, row)
      return next
    })
  }

  const removeRow = async (index: number) => {
    if (!activeCategory) return
    const row = items[index]
    const label = String(row?.name || row?.id || '').trim()
    if (label && !(await confirmDialog(`"${label}" değeri listeden kaldırılsın mı? Bu kodu taşıyan kayıtlar artık ad yerine kod gösterir.`))) return
    updateItems(activeCategory, (current) => current.filter((_, i) => i !== index))
  }

  const addList = () => {
    const title = newTitle.trim()
    if (!title) return
    const key = 'custom_' + Date.now()
    setTitles((prev) => ({ ...prev, [key]: title }))
    setValues((prev) => ({ ...prev, [key]: [] }))
    setNewTitle('')
    setSearch('')
    setSelected(key)
  }

  const removeList = async () => {
    if (!activeCategory || isSystem) return
    const title = titles[activeCategory] || 'Bu liste'
    if (!(await confirmDialog(`"${title}" listesi tamamen silinsin mi? Bu listeyi kullanan ekranlar ad yerine kod göstermeye başlar. Silme işlemi "Değişiklikleri Kaydet" ile kalıcı olur.`))) return
    setTitles((prev) => {
      const next = { ...prev }
      delete next[activeCategory]
      return next
    })
    setValues((prev) => {
      const next = { ...prev }
      delete next[activeCategory]
      return next
    })
    setSelected(null)
  }

  return (
    <div className="space-y-4">
      {/* Ust bilgi ve islem cubugu */}
      <div className="rounded-xl border border-slate-200 border-t-[3px] border-t-[#1E2A38] bg-white p-4 shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.06)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold text-[#1E2A38]">Hazır Değerler</h2>
            <p className="mt-1 max-w-3xl text-[14.5px] font-medium leading-snug text-slate-600">
              Kodla saklanan alanların (dosya durumu, aile niteliği, mülkiyet vb.) ekranda görünen karşılıkları.
              Listeler ve raporlar bu adları kullanır; kodu değiştirmek mevcut kayıtların karşılığını değiştirir.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[13.5px] font-semibold">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-600">{categories.length} liste</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-slate-600">{totalValues} değer</span>
              {listsWithIssues > 0 && (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-rose-700">{listsWithIssues} listede düzeltilmesi gereken satır var</span>
              )}
              {isDirty && (
                <span className="rounded-full border border-[#E7DDC2] bg-[#FBF8F0] px-2.5 py-0.5 text-[#8A6D2F]">Kaydedilmemiş değişiklik var</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button type="button" onClick={onSave} disabled={isSaving || !isDirty} className={buttonPrimary}>
              {isSaving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
            </button>
          </div>
        </div>
        {saveStatus && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-[14.5px] font-semibold ${statusIsError ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {saveStatus}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        {/* Sol: liste gezgini */}
        <aside className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,30,43,0.06)]">
          <div className="space-y-2 border-b border-slate-200 p-3">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Liste veya değer ara..."
              className={`${inputBase} border-slate-300`}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') addList() }}
                placeholder="Yeni liste başlığı"
                className={`${inputBase} border-slate-300`}
              />
              <button type="button" onClick={addList} disabled={!newTitle.trim()} className={buttonNeutral}>
                + Ekle
              </button>
            </div>
          </div>
          <nav className="max-h-[65vh] overflow-y-auto p-2">
            {filteredCategories.length === 0 && (
              <p className="px-2 py-6 text-center text-[14px] font-semibold text-slate-500">Aramaya uyan liste yok.</p>
            )}
            {filteredCategories.map((category) => {
              const isActive = category === activeCategory
              const count = values[category]?.length ?? 0
              const hasIssue = findPredefinedIssues(values[category]).length > 0
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setSelected(category)}
                  className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition ${
                    isActive ? 'bg-[#1E2A38] text-white shadow-sm' : 'text-slate-800 hover:bg-[#F6F3EA]'
                  }`}
                >
                  <span className={`h-full w-1 self-stretch rounded-full ${isActive ? 'bg-[#D4B26A]' : 'bg-transparent'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{titles[category] || 'Başlıksız liste'}</span>
                    {SYSTEM_CATEGORIES.has(category) && (
                      <span className={`text-[12px] font-semibold ${isActive ? 'text-[#E9D9A8]' : 'text-slate-500'}`}>Sistem listesi</span>
                    )}
                  </span>
                  {hasIssue && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="Düzeltilmesi gereken satır var" />}
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12.5px] font-bold ${isActive ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {count}
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Sag: secili listenin duzenleyicisi */}
        <section className="min-w-0 rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(16,30,43,0.06),0_8px_24px_rgba(16,30,43,0.06)]">
          {!activeCategory ? (
            <p className="p-10 text-center text-[15px] font-semibold text-slate-500">Düzenlemek için soldan bir liste seçin ya da yeni liste ekleyin.</p>
          ) : (
            <>
              <div className="flex flex-col gap-3 border-b border-slate-200 p-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <label className="mb-1 block text-[12.5px] font-bold uppercase tracking-wide text-slate-500">Liste başlığı</label>
                  <input
                    type="text"
                    value={titles[activeCategory] ?? ''}
                    onChange={(event) => setTitles((prev) => ({ ...prev, [activeCategory]: event.target.value }))}
                    className={`${inputBase} max-w-xl border-slate-300 text-[17px] font-bold text-[#1E2A38] ${!String(titles[activeCategory] ?? '').trim() ? 'border-rose-400' : ''}`}
                  />
                  <p className="mt-2 text-[14px] font-medium text-slate-600">
                    <span className="font-bold text-slate-700">Kullanıldığı yer: </span>
                    {usageText(activeCategory, titles[activeCategory] ?? '')}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={addRow} className={buttonNeutral}>+ Yeni Satır</button>
                  <button
                    type="button"
                    onClick={() => void removeList()}
                    disabled={isSystem}
                    className={buttonDanger}
                    title={isSystem ? 'Sistem listeleri silinemez (uygulama bu listeyi doğrudan kullanır).' : 'Listeyi sil'}
                  >
                    Listeyi Sil
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto p-3">
                <table className="w-full min-w-[480px] border-separate border-spacing-0 text-left">
                  <thead>
                    <tr className="text-[13.5px] font-semibold text-white">
                      <th className="w-12 rounded-tl-lg bg-[#1E2A38] px-2 py-1.5 text-center shadow-[inset_0_-2px_0_#D4B26A]">#</th>
                      <th className="w-36 bg-[#1E2A38] px-2 py-1.5 shadow-[inset_0_-2px_0_#D4B26A]">Kod</th>
                      <th className="bg-[#1E2A38] px-2 py-1.5 shadow-[inset_0_-2px_0_#D4B26A]">Görünen Ad</th>
                      <th className="w-32 rounded-tr-lg bg-[#1E2A38] px-2 py-1.5 text-center shadow-[inset_0_-2px_0_#D4B26A]">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="border-b border-slate-200 px-3 py-8 text-center text-[14.5px] font-semibold text-slate-500">
                          Bu listede henüz değer yok. &quot;+ Yeni Satır&quot; ile ekleyin.
                        </td>
                      </tr>
                    )}
                    {items.map((item, index) => {
                      const rowIssues = issueByIndex.get(index) ?? []
                      const idEmpty = rowIssues.some((m) => m.startsWith('Kod boş')) || rowIssues.some((m) => m.includes('kodu'))
                      const nameEmpty = rowIssues.some((m) => m.startsWith('Ad boş'))
                      return (
                        <tr key={index} className={`${index % 2 === 1 ? 'bg-[#F7F8FA]' : 'bg-white'} align-middle`}>
                          <td className="border-b border-slate-200 px-2 py-1 text-center text-[14px] font-semibold text-slate-500">{index + 1}</td>
                          <td className="border-b border-slate-200 px-2 py-1">
                            <input
                              type="text"
                              value={item.id}
                              placeholder="Kod"
                              onChange={(event) => updateItems(activeCategory, (current) => current.map((row, i) => (i === index ? { ...row, id: event.target.value } : row)))}
                              className={`${inputBase} font-mono ${idEmpty ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                            />
                          </td>
                          <td className="border-b border-slate-200 px-2 py-1">
                            <input
                              type="text"
                              value={item.name}
                              placeholder="Görünen ad"
                              onChange={(event) => updateItems(activeCategory, (current) => current.map((row, i) => (i === index ? { ...row, name: event.target.value } : row)))}
                              className={`${inputBase} ${nameEmpty ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                            />
                            {rowIssues.length > 0 && (
                              <p className="mt-0.5 text-[13px] font-semibold leading-tight text-rose-700">{rowIssues.join(' ')}</p>
                            )}
                          </td>
                          <td className="border-b border-slate-200 px-2 py-1">
                            <div className="flex justify-center gap-1.5">
                              <button type="button" onClick={() => moveRow(index, -1)} disabled={index === 0} className={`${rowButton} w-8`} title="Yukarı taşı">▲</button>
                              <button type="button" onClick={() => moveRow(index, 1)} disabled={index === items.length - 1} className={`${rowButton} w-8`} title="Aşağı taşı">▼</button>
                              <button type="button" onClick={() => void removeRow(index)} className={`${rowDangerButton} w-8`} title="Satırı sil">✕</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={addRow} className={buttonNeutral}>+ Yeni Satır</button>
                  <p className="text-[13.5px] font-medium text-slate-500">
                    Sıralama, açılır listelerde görünen sıradır. Değişiklikler &quot;Değişiklikleri Kaydet&quot; ile kalıcı olur.
                  </p>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
