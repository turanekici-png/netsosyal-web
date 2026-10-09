'use client'

import { useState } from 'react'
import { usePersonPredefinedOptions } from '@/lib/hooks/usePersonPredefinedOptions'

function todayValue() {
  return new Date().toISOString().split('T')[0]
}

function dateInputClass(value: string) {
  return [
    'h-5 border px-1 text-[12px] outline-none',
    value === todayValue()
      ? 'border-[#0076b6] bg-sky-50 font-bold text-[#0076b6]'
      : 'border-slate-300 bg-white text-slate-950',
  ].join(' ')
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="text-[12px] font-semibold text-slate-950">{children}</label>
}

type AcezeAidFormModalProps = {
  initiallyOpen?: boolean
}

export function AcezeAidFormModal({ initiallyOpen = false }: AcezeAidFormModalProps) {
  const { maritalStatusOptions, genderOptions } = usePersonPredefinedOptions()
  const [isOpen, setIsOpen] = useState(initiallyOpen)
  const [form, setForm] = useState({
    nationality: '',
    identityNumber: '',
    firstName: '',
    fatherName: '',
    motherName: '',
    birthPlace: '',
    birthDate: '',
    maritalStatus: '',
    gender: '',
    healthStatus: 'Sağlıklı',
    illnessName: '',
    registryCity: '',
    phone: '',
    date: todayValue(),
    personCount: '0',
    destination: '',
    reason: '',
  })

  const updateField = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="rounded-md bg-white px-4 py-2 text-sm font-extrabold text-[#0076b6] shadow-sm transition hover:bg-sky-50"
      >
        Aceze Yardımı Ekle
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/50 p-2">
          <div className="w-full max-w-[680px] overflow-hidden rounded-md border border-slate-300 bg-[#f4f4f4] shadow-2xl">
            <div className="flex h-6 items-center justify-between border-b border-slate-300 bg-white px-2 text-[12px] text-slate-800">
              <span>Dönem Dışı Gıda Bankası Yardım Kartı</span>
              <button type="button" onClick={() => setIsOpen(false)} className="text-lg leading-none text-slate-700 hover:text-rose-600">
                ×
              </button>
            </div>

            <div className="bg-[#7b7b7b] px-2 py-2">
              <h2 className="text-2xl font-extrabold leading-none text-white">Aceze Yardım Kartı</h2>
            </div>

            <div className="grid grid-cols-1 gap-2 p-2 md:grid-cols-[1fr_1.2fr]">
              <fieldset className="border border-slate-300 bg-[#f7f7f7] px-2 pb-3 pt-2">
                <div className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-x-2 gap-y-1">
                  <FieldLabel>Uyruğu</FieldLabel>
                  <select
                    value={form.nationality}
                    onChange={(e) => updateField('nationality', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  >
                    <option value=""></option>
                  </select>

                  <FieldLabel>T.C Kimlik No</FieldLabel>
                  <input
                    value={form.identityNumber}
                    onChange={(e) => updateField('identityNumber', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Adı</FieldLabel>
                  <input
                    value={form.firstName}
                    onChange={(e) => updateField('firstName', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Baba Adı</FieldLabel>
                  <input
                    value={form.fatherName}
                    onChange={(e) => updateField('fatherName', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Ana Adı</FieldLabel>
                  <input
                    value={form.motherName}
                    onChange={(e) => updateField('motherName', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Doğum Yeri</FieldLabel>
                  <input
                    value={form.birthPlace}
                    onChange={(e) => updateField('birthPlace', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Doğum Tarihi</FieldLabel>
                  <input
                    type="date"
                    value={form.birthDate}
                    onChange={(e) => updateField('birthDate', e.target.value)}
                    className={dateInputClass(form.birthDate)}
                  />

                  <FieldLabel>Medeni Hali</FieldLabel>
                  <select
                    value={form.maritalStatus}
                    onChange={(e) => updateField('maritalStatus', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  >
                    <option value="">Seçiniz</option>
                    {maritalStatusOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>

                  <FieldLabel>Cinsiyeti</FieldLabel>
                  <select
                    value={form.gender}
                    onChange={(e) => updateField('gender', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  >
                    <option value="">Seçiniz</option>
                    {genderOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>

                  <FieldLabel>Sağlık Durumu</FieldLabel>
                  <select
                    value={form.healthStatus}
                    onChange={(e) => updateField('healthStatus', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  >
                    <option value="Sağlıklı">Sağlıklı</option>
                  </select>

                  <FieldLabel>Hasralık Adı</FieldLabel>
                  <input
                    value={form.illnessName}
                    onChange={(e) => updateField('illnessName', e.target.value)}
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Nfs.Kyt.İli</FieldLabel>
                  <div className="grid grid-cols-[minmax(0,1fr)_24px]">
                    <select
                      value={form.registryCity}
                      onChange={(e) => updateField('registryCity', e.target.value)}
                      className="h-5 border border-r-0 border-slate-300 bg-white px-1 text-[12px] outline-none"
                    >
                      <option value=""></option>
                    </select>
                    <button type="button" className="h-5 border border-slate-300 bg-white text-[11px]">...</button>
                  </div>

                  <FieldLabel>Cep Tel</FieldLabel>
                  <input
                    value={form.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="(   )"
                    className="h-5 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />
                </div>
              </fieldset>

              <fieldset className="border border-slate-300 bg-[#f7f7f7] px-2 pb-3 pt-3">
                <div className="grid grid-cols-[82px_minmax(0,1fr)] items-start gap-x-2 gap-y-1">
                  <FieldLabel>Tarih</FieldLabel>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => updateField('date', e.target.value)}
                    className={`${dateInputClass(form.date)} w-32`}
                  />

                  <FieldLabel>Kişi Sayısı</FieldLabel>
                  <input
                    type="number"
                    value={form.personCount}
                    onChange={(e) => updateField('personCount', e.target.value)}
                    className="h-5 w-14 border border-slate-300 bg-white px-1 text-[12px] outline-none"
                  />

                  <FieldLabel>Gideceği Yer</FieldLabel>
                  <div className="grid grid-cols-[minmax(0,1fr)_24px]">
                    <select
                      value={form.destination}
                      onChange={(e) => updateField('destination', e.target.value)}
                      className="h-5 border border-r-0 border-slate-300 bg-white px-1 text-[12px] outline-none"
                    >
                      <option value=""></option>
                    </select>
                    <button type="button" className="h-5 border border-slate-300 bg-white text-[11px]">...</button>
                  </div>

                  <FieldLabel>Nedeni</FieldLabel>
                  <textarea
                    value={form.reason}
                    onChange={(e) => updateField('reason', e.target.value)}
                    className="h-40 resize-none border border-slate-300 bg-white px-1 py-0.5 text-[12px] outline-none"
                  />
                </div>
              </fieldset>
            </div>

            <div className="flex items-center justify-between border-t border-slate-300 bg-[#f4f4f4] px-4 py-2">
              <button type="button" className="border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50">
                Kaydet (F2)
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="border border-slate-300 bg-white px-6 py-1.5 text-[13px] text-slate-800 hover:bg-slate-50"
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
