'use client'

import { useState } from 'react'
import { downloadXlsx } from '@/lib/utils/xlsxExport'

export type ReportColumnOption = { key: string; label: string }
export type ReportScopeOption = { value: string; label: string; count: number }
export type ReportRow = Record<string, string | number | null | undefined>

type ColumnPickerReportModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  reportHeading: string
  columns: ReportColumnOption[]
  scopes: ReportScopeOption[]
  fetchRows: (scope: string) => Promise<ReportRow[]>
  fileNamePrefix: string
  // Bazi sutunlar (dosya durumu, medeni hal, yakinlik derecesi gibi) ekranda
  // "Yardım Yapılabilir" / "Evli" gibi okunabilir etiketlerle gosterilir ama
  // veritabaninda ham bir kod (0, 1, 2...) olarak tutulur. Rapor bu ham
  // kodu DEGIL, ekrandaki gibi okunabilir etiketi icermeli - bu fonksiyon
  // verildiginde her hucre degeri raporlanmadan once bundan gecirilir.
  resolveCellValue?: (columnKey: string, value: string | number | null | undefined) => string | number | null | undefined
}

// "Sütun seçmeli özel rapor": kullanıcı hangi sütunların ve hangi kayıt
// kapsamının (seçili / bu sayfa / filtrelenen tüm kayıtlar) rapora
// gireceğini kendisi seçer; ardından aynı seçimle hem Excel'e aktarabilir
// hem de düzenli, başlıklı bir yazdırma çıktısı alabilir. Dosyalar ve
// Bireyler listeleri arasında paylaşılan, tamamen kontrollü (state'siz veri
// akışlı) bir bileşendir - veriyi nereden/nasıl çekeceğini çağıran sayfa
// `fetchRows` ile belirler.
export function ColumnPickerReportModal({
  isOpen,
  onClose,
  title,
  reportHeading,
  columns,
  scopes,
  fetchRows,
  fileNamePrefix,
  resolveCellValue,
}: ColumnPickerReportModalProps) {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(columns.map((column) => column.key)))
  const [scope, setScope] = useState(scopes[0]?.value ?? '')
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState('')

  if (!isOpen) return null

  const toggleColumn = (key: string) => {
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedColumns = columns.filter((column) => selectedKeys.has(column.key))

  const buildReportRows = async () => {
    const rows = await fetchRows(scope)
    return rows.map((row) => {
      const output: ReportRow = {}
      selectedColumns.forEach((column) => {
        const rawValue = row[column.key] ?? ''
        output[column.label] = resolveCellValue ? resolveCellValue(column.key, rawValue) ?? '' : rawValue
      })
      return output
    })
  }

  const runAction = async (action: (rows: ReportRow[]) => void) => {
    if (selectedColumns.length === 0) {
      setError('En az bir sütun seçin.')
      return
    }

    setError('')
    setStatus('loading')
    try {
      const rows = await buildReportRows()
      if (rows.length === 0) {
        setError('Seçilen kapsamda kayıt bulunamadı.')
        return
      }
      action(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rapor oluşturulamadı.')
    } finally {
      setStatus('idle')
    }
  }

  const handleExportXlsx = () => runAction((rows) => {
    downloadXlsx(rows, `${fileNamePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`, title)
  })

  const handlePrint = () => runAction((rows) => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800')
    if (!printWindow) {
      setError('Yazdırma penceresi açılamadı. Pop-up engelleyiciyi kontrol edin.')
      return
    }

    const headerCells = selectedColumns.map((column) => `<th>${column.label}</th>`).join('')
    const bodyRows = rows.map((row) => `<tr>${selectedColumns.map((column) => `<td>${row[column.label] ?? '-'}</td>`).join('')}</tr>`).join('')

    printWindow.document.write(`
      <!doctype html>
      <html lang="tr">
        <head>
          <meta charset="utf-8" />
          <title>${reportHeading}</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #0f172a; }
            h1 { font-size: 18px; margin: 0 0 4px; }
            p { font-size: 11px; color: #475569; margin: 0 0 16px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
            th { background: #eaf7fd; text-transform: uppercase; font-size: 9px; color: #005f95; letter-spacing: 0.04em; }
            tr:nth-child(even) td { background: #f8fafc; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <h1>${reportHeading}</h1>
          <p>Oluşturma tarihi: ${new Date().toLocaleString('tr-TR')} · ${rows.length} kayıt</p>
          <table>
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
          <script>window.onload = function () { setTimeout(function () { window.print() }, 300) }</script>
        </body>
      </html>
    `)
    printWindow.document.close()
  })

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-900/60 px-4 backdrop-blur-sm print:hidden">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-[#087fb2] via-[#309690] to-[#6fb744] px-5 py-4">
          <h3 className="text-sm font-black uppercase tracking-wide text-white">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-600">Rapora Dahil Edilecek Sütunlar</span>
              <div className="flex gap-3">
                <button type="button" onClick={() => setSelectedKeys(new Set(columns.map((column) => column.key)))} className="text-[11px] font-bold text-[#0076b6] hover:underline">
                  Tümünü Seç
                </button>
                <button type="button" onClick={() => setSelectedKeys(new Set())} className="text-[11px] font-bold text-slate-500 hover:underline">
                  Temizle
                </button>
              </div>
            </div>
            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3">
              {columns.map((column) => (
                <label key={column.key} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-white">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(column.key)}
                    onChange={() => toggleColumn(column.key)}
                    className="rounded border-slate-300 text-[#0076b6]"
                  />
                  <span className="truncate" title={column.label}>{column.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-xs font-black uppercase text-slate-600">Kapsam</span>
            <div className="space-y-1.5">
              {scopes.map((scopeOption) => (
                <label key={scopeOption.value} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                  <input
                    type="radio"
                    name="report-scope"
                    checked={scope === scopeOption.value}
                    onChange={() => setScope(scopeOption.value)}
                    className="text-[#0076b6]"
                  />
                  <span>{scopeOption.label}</span>
                  <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{scopeOption.count} kayıt</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">
              {error}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-100">
            Kapat
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={status === 'loading'}
            className="rounded-md bg-slate-700 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:pointer-events-none disabled:opacity-50"
          >
            {status === 'loading' ? 'Hazırlanıyor...' : 'Yazdır'}
          </button>
          <button
            type="button"
            onClick={handleExportXlsx}
            disabled={status === 'loading'}
            className="rounded-md bg-[#3f7f28] px-4 py-2 text-xs font-black text-white hover:bg-[#346a21] disabled:pointer-events-none disabled:opacity-50"
          >
            {status === 'loading' ? 'Hazırlanıyor...' : "Excel'e Aktar"}
          </button>
        </div>
      </div>
    </div>
  )
}
