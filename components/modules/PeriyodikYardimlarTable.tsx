'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { formatDate } from '@/lib/utils'

interface PeriyodikYardimlarTableProps {
  data: any[]
  totalCount: number
}

const OPERATORS = [
  { id: 'contains', label: 'İçerir' },
  { id: 'not_contains', label: 'İçermez' },
  { id: 'eq', label: 'Eşittir (=)' },
  { id: 'neq', label: 'Eşit Değil (!=)' },
  { id: 'starts', label: 'İle Başlar' },
  { id: 'ends', label: 'İle Biter' },
  { id: 'gt', label: 'Büyüktür (>)' },
  { id: 'lt', label: 'Küçüktür (<)' },
  { id: 'gte', label: 'Büyük Eşit (>=)' },
  { id: 'lte', label: 'Küçük Eşit (<=)' },
]

export function PeriyodikYardimlarTable({ data, totalCount }: PeriyodikYardimlarTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeFilterMenu, setActiveFilterMenu] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveFilterMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const applyFilter = (key: string, value: string, op: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) {
      params.set(`f_${key}`, value)
      params.set(`f_${key}_op`, op)
    } else {
      params.delete(`f_${key}`)
      params.delete(`f_${key}_op`)
    }
    params.set('page', '1')
    router.push(`?${params.toString()}`)
    setActiveFilterMenu(null)
  }

  const columns = [
    { key: 'dosyano', label: 'Dosya', dbKey: 'dosyano', alias: 'd' },
    { key: 'tckimlikno', label: 'TC No', dbKey: 'tckimlikno', alias: 'b' },
    { key: 'adisoyadi', label: 'Adı Soyadı', dbKey: 'adisoyadi', alias: 'b' },
    { key: 'ceptel', label: 'Telefon', dbKey: 'ceptel', alias: 'b' },
    { key: 'adres', label: 'Adres', dbKey: 'adres', alias: 'b' },
    { key: 'hane', label: 'Hane', dbKey: 'hane', noFilter: true },
    { key: 'gida', label: 'Gıda', noFilter: true },
    { key: 'ekmek', label: 'Ekmek', noFilter: true },
    { key: 'destek', label: 'Destek', noFilter: true },
    { key: 'hazir', label: 'H. Yemek', noFilter: true },
  ]

  return (
    <div className="w-full overflow-hidden">
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-inner">
        <table className="w-full border-collapse text-left text-[13px] font-semibold table-auto">
          <thead className="bg-[#eaf7fd] text-[11px] font-extrabold uppercase text-[#005f95] sticky top-0 z-10">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="border-b border-[#b8dff2] px-3 py-2 hover:bg-[#d9f0fc] min-w-[100px] relative">
                  <div className="flex flex-col gap-1.5 min-h-[50px] justify-between">
                    <span className="flex items-center gap-1 whitespace-nowrap overflow-hidden text-ellipsis">{col.label}</span>
                    {!col.noFilter && (
                      <div className="flex items-center gap-1">
                        <input 
                          type="text" 
                          placeholder="..." 
                          defaultValue={searchParams.get(`f_${col.dbKey}`) || ''}
                          onKeyDown={(e) => { 
                            if (e.key === 'Enter') applyFilter(col.dbKey!, (e.target as HTMLInputElement).value, searchParams.get(`f_${col.dbKey}_op`) || 'contains') 
                          }}
                          className="w-full rounded border border-[#b8dff2] bg-white px-2 py-1 text-[10px] outline-none focus:border-[#0076b6] normal-case font-bold"
                        />
                        <button onClick={() => setActiveFilterMenu(activeFilterMenu === col.key ? null : col.key)} className="rounded border border-[#b8dff2] bg-white px-1 py-1 hover:bg-slate-50 text-[10px]">▼</button>
                      </div>
                    )}
                  </div>

                  {activeFilterMenu === col.key && !col.noFilter && (
                    <div ref={menuRef} className="absolute left-3 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-3 shadow-2xl normal-case font-bold">
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500">Operatör</label>
                          <select id={`op-${col.key}`} defaultValue={searchParams.get(`f_${col.dbKey}_op`) || 'contains'} className="w-full rounded border border-slate-200 p-1.5 text-[11px] outline-none">
                            {OPERATORS.map(op => <option key={op.id} value={op.id}>{op.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] text-slate-500">Değer</label>
                          <input id={`val-${col.key}`} type="text" defaultValue={searchParams.get(`f_${col.dbKey}`) || ''} className="w-full rounded border border-slate-200 p-1.5 text-[11px] outline-none" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => {
                            const op = (document.getElementById(`op-${col.key}`) as HTMLSelectElement).value
                            const val = (document.getElementById(`val-${col.key}`) as HTMLInputElement).value
                            applyFilter(col.dbKey!, val, op)
                          }} className="flex-1 rounded bg-[#0076b6] py-1.5 text-[11px] text-white">Uygula</button>
                          <button onClick={() => applyFilter(col.dbKey!, '', 'contains')} className="flex-1 rounded bg-slate-100 py-1.5 text-[11px] text-slate-600">Temizle</button>
                        </div>
                      </div>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={10} className="py-20 text-center text-lg font-bold text-slate-300">Görüntülenecek kayıt bulunamadı.</td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={index} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-[#f1faed] transition-colors leading-tight`}>
                  <td className="border-b border-slate-100 px-3 py-2 font-black text-[#0076b6] whitespace-nowrap">{row["Dosya No"]}</td>
                  <td className="border-b border-slate-100 px-3 py-2 text-slate-500 font-bold whitespace-nowrap">{row["TC Kimlik No"]}</td>
                  <td className="border-b border-slate-100 px-3 py-2 font-black text-slate-900 uppercase whitespace-nowrap">{row["Adı Soyadı"]}</td>
                  <td className="border-b border-slate-100 px-3 py-2 font-bold text-[#0076b6] whitespace-nowrap">{row["Telefon"]}</td>
                  <td className="border-b border-slate-100 px-3 py-2">
                    <div className="text-slate-800 font-extrabold text-[11px] whitespace-normal leading-tight min-w-[150px]">{row["Adres"]}</div>
                  </td>
                  <td className="border-b border-slate-100 px-1 py-2 text-center">
                    <span className="bg-slate-100 px-1.5 py-0.5 rounded font-black">{row["Hane"]}</span>
                  </td>

                  {/* Gıda */}
                  <td className={`border-b border-slate-100 px-3 py-2 border-l border-blue-100/50 ${row.gida_miktar ? 'bg-blue-50/20' : ''}`}>
                    {row.gida_miktar ? (
                      <div>
                        <div className="text-blue-700 font-black">{row.gida_miktar}</div>
                        <div className="text-[9px] text-slate-400 font-bold whitespace-nowrap">{formatDate(row.gida_bit)}</div>
                      </div>
                    ) : <span className="text-slate-200 text-[10px]">--</span>}
                  </td>

                  {/* Ekmek */}
                  <td className={`border-b border-slate-100 px-3 py-2 border-l border-amber-100/50 ${row.ekmek_miktar ? 'bg-amber-50/20' : ''}`}>
                    {row.ekmek_miktar ? (
                      <div>
                        <div className="text-amber-700 font-black">{row.ekmek_miktar}</div>
                        <div className="text-[9px] text-slate-400 font-bold whitespace-nowrap">{formatDate(row.ekmek_bit)}</div>
                      </div>
                    ) : <span className="text-slate-200 text-[10px]">--</span>}
                  </td>

                  {/* Destek Paketi */}
                  <td className={`border-b border-slate-100 px-3 py-2 border-l border-purple-100/50 ${row.destek_miktar ? 'bg-purple-50/20' : ''}`}>
                    {row.destek_miktar ? (
                      <div>
                        <div className="text-purple-700 font-black">{row.destek_miktar}</div>
                        <div className="text-[9px] text-slate-400 font-bold whitespace-nowrap">{formatDate(row.destek_bit)}</div>
                      </div>
                    ) : <span className="text-slate-200 text-[10px]">--</span>}
                  </td>

                  {/* Hazır Yemek */}
                  <td className={`border-b border-slate-100 px-3 py-2 border-l border-emerald-100/50 ${row.hazir_miktar ? 'bg-emerald-50/20' : ''}`}>
                    {row.hazir_miktar ? (
                      <div>
                        <div className="text-emerald-700 font-black">{row.hazir_miktar}</div>
                        <div className="text-[9px] text-slate-400 font-bold whitespace-nowrap">{formatDate(row.hazir_bit)}</div>
                      </div>
                    ) : <span className="text-slate-200 text-[10px]">--</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
