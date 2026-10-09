'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

// Sahte (Mock) Dosya Verileri
const mockFiles = [
  { cardNo: 'C6C5F1ED', tc: '38143156821', name: 'TURAN EKİCİ', neighborhood: 'ALİBABA MAH.', date: '12.01.2024', status: 'Aktif' },
  { cardNo: 'A24D91B0', tc: '24987156320', name: 'AYŞE KARA', neighborhood: 'MEHMETPAŞA MAH.', date: '05.03.2025', status: 'Aktif' },
  { cardNo: 'B72F04C8', tc: '47291563804', name: 'MEHMET YILMAZ', neighborhood: 'ESENTEPE MAH.', date: '22.11.2023', status: 'Pasif' },
  { cardNo: 'D83A19F5', tc: '58321974618', name: 'ZEYNEP DEMİR', neighborhood: 'YENİŞEHİR MAH.', date: '10.06.2026', status: 'Aktif' },
  { cardNo: 'KRT10293', tc: '11223344556', name: 'AHMET ÇELİK', neighborhood: 'KILAVUZ MAH.', date: '14.02.2021', status: 'Arşivlendi' },
]

export default function AllDocumentsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('Tümü')

  const filteredFiles = useMemo(() => {
    return mockFiles.filter(file => {
      const matchesSearch = 
        file.name.toLocaleLowerCase('tr-TR').includes(searchTerm.toLocaleLowerCase('tr-TR')) ||
        file.tc.includes(searchTerm) ||
        file.cardNo.toLocaleLowerCase('tr-TR').includes(searchTerm.toLocaleLowerCase('tr-TR'))
        
      const matchesStatus = statusFilter === 'Tümü' || file.status === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [searchTerm, statusFilter])

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Aktif': return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold bg-[#e6f3dd] text-[#4f8f2f] border border-[#d8efcb]">Aktif Dosya</span>
      case 'Pasif': return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold bg-rose-100 text-rose-700 border border-rose-200">Pasif Dosya</span>
      case 'Arşivlendi': return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold bg-amber-100 text-amber-700 border border-amber-200">Arşivlendi</span>
      default: return <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold bg-slate-100 text-slate-700 border border-slate-200">{status}</span>
    }
  }

  return (
    <div className="space-y-5 text-slate-950">
      {/* Üst Başlık Kartı */}
      <div className="rounded-lg border border-[#9bd36f] bg-gradient-to-r from-[#0076b6] to-[#6fb744] p-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[13px] font-black uppercase tracking-wide text-white/90">Dosya Yönetimi</p>
            <h1 className="mt-1 text-3xl font-black leading-tight tracking-normal md:text-[34px]">Tüm Dosyalar</h1>
          </div>
          <div className="flex gap-2">
            <Link href="/documents" className="rounded-md bg-white px-5 py-2.5 text-sm font-extrabold text-[#0076b6] shadow-sm hover:bg-[#eaf7fd] transition-colors flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              Dosya Ara / İncele
            </Link>
            <button className="rounded-md border border-white/60 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-white/20 transition-colors">
              Excel'e Aktar
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {/* Filtreleme ve Arama Alanı */}
        <div className="p-5 border-b border-slate-100 bg-slate-50 flex flex-col lg:flex-row gap-4 justify-between items-center">
          <div className="w-full lg:w-1/3">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Kart No, TC Kimlik veya İsim ara..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-md border border-slate-300 pl-10 pr-3 py-2 text-[13px] font-bold outline-none focus:border-[#0076b6] focus:ring-1 focus:ring-[#0076b6]"
              />
            </div>
          </div>
          
          <div className="flex gap-3 w-full lg:w-auto">
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 lg:w-48 rounded-md border border-slate-300 px-3 py-2 text-[13px] font-bold outline-none focus:border-[#0076b6] focus:ring-1 focus:ring-[#0076b6] bg-white"
            >
              <option value="Tümü">Tüm Durumlar</option>
              <option value="Aktif">Aktif Dosyalar</option>
              <option value="Pasif">Pasif Dosyalar</option>
              <option value="Arşivlendi">Arşivlenenler</option>
            </select>
          </div>
        </div>

        {/* Tablo */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-[13px] font-semibold">
            <thead className="bg-[#eaf7fd] text-[12px] font-extrabold uppercase text-[#005f95] border-b border-[#b8dff2]">
              <tr>
                <th className="px-5 py-3 w-32">Kart / Dosya No</th>
                <th className="px-5 py-3 w-36">T.C. Kimlik No</th>
                <th className="px-5 py-3">Dosya Sahibi (Ad Soyad)</th>
                <th className="px-5 py-3 w-48">Mahalle</th>
                <th className="px-5 py-3 w-32">Kayıt Tarihi</th>
                <th className="px-5 py-3 w-32 text-center">Durum</th>
                <th className="px-5 py-3 w-32 text-right">İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.length > 0 ? (
                filteredFiles.map((file, index) => (
                  <tr key={file.cardNo} className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'} hover:bg-sky-50 transition-colors border-b border-slate-100 last:border-0`}>
                    <td className="px-5 py-3.5 text-[#0076b6] font-extrabold whitespace-nowrap">
                      {file.cardNo}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 font-bold">
                      {file.tc}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-slate-900 font-extrabold">{file.name}</span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 font-medium">
                      {file.neighborhood}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 font-bold">
                      {file.date}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      {getStatusBadge(file.status)}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link 
                        href={`/documents?search=${file.cardNo}`}
                        className="inline-flex items-center justify-center h-8 px-3 rounded-md bg-white border border-slate-200 text-[11px] font-extrabold text-slate-600 hover:bg-slate-50 hover:text-[#0076b6] transition-colors shadow-sm"
                      >
                        Dosyayı Aç
                      </Link>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-[14px] font-bold text-slate-500">
                    Arama kriterlerinize uygun dosya bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Tablo Altı */}
        <div className="border-t border-slate-200 bg-slate-50 p-4 flex justify-between items-center">
          <span className="text-xs font-bold text-slate-500">Toplam <span className="text-slate-800">{filteredFiles.length}</span> dosya listeleniyor.</span>
        </div>
      </div>
    </div>
  )
}