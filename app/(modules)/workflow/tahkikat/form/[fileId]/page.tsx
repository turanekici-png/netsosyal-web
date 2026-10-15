'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import SahaIncelemeFormModal from '@/components/documents/SahaIncelemeFormModal'
import { useTabs } from '@/lib/context/TabContext'
import { yasHesapla, type HaneUyesi } from '@/lib/constants/sahaIncelemeForm'
import {
  DEFAULT_PREDEFINED_VALUE_TITLES,
  DEFAULT_PREDEFINED_VALUES,
  getPredefinedValueLabel,
  type PredefinedValueTitlesMap,
  type PredefinedValuesMap,
} from '@/lib/constants/predefinedValues'
import { useFormSekmesiniKapat } from '@/lib/workflow/formSekmesi'
import { EvZiyaretiTekrarUyarisi, type EvZiyaretiTekrari } from '@/components/workflow/EvZiyaretiTekrarUyarisi'

export const dynamic = 'force-dynamic'

// 2026-10-15: İş Akışı > Tahkikat > "Rapor Ekle" artik Hane Ziyareti formunu
// AYRI, turuncu bir sekmede acar (eskiden Dosya Yönetimi uzerinde ekrani
// kaplayan pencere). Form taslagi zaten tarayicida saklandigi icin sekmeden
// cikip donunce kaldigi yerden devam eder.

type Kisi = {
  firstName?: string
  lastName?: string
  identityNumber?: string
  mobilePhone?: string
  address?: string
  birthDate?: string
  personId?: string
}
type HaneSatiri = Kisi & { beneficiaryId?: string; relation?: string | number | null; deathDate?: string }

const temiz = (v: unknown) => {
  const t = String(v ?? '').trim()
  return t === '-' ? '' : t
}

export default function TahkikatFormSekmesiPage() {
  const params = useParams<{ fileId: string }>()
  const fileId = decodeURIComponent(String(params?.fileId ?? ''))
  const { addTab } = useTabs()
  const sekmeyiKapat = useFormSekmesiniKapat()

  const [durum, setDurum] = useState<'yukleniyor' | 'hazir' | 'hata'>('yukleniyor')
  const [hata, setHata] = useState('')
  const [dosyaNo, setDosyaNo] = useState('')
  const [kisi, setKisi] = useState<Kisi | null>(null)
  const [hane, setHane] = useState<HaneSatiri[]>([])
  const [personelAdi, setPersonelAdi] = useState('')
  // 2026-10-15: Sonuç Bekleyen'den "Ev Ziyareti Tekrarı" ile geri gelen dosya uyarisi
  const [tekrar, setTekrar] = useState<EvZiyaretiTekrari | null>(null)
  const [hazirDegerler, setHazirDegerler] = useState<{ values: PredefinedValuesMap; titles: PredefinedValueTitlesMap }>({
    values: DEFAULT_PREDEFINED_VALUES,
    titles: DEFAULT_PREDEFINED_VALUE_TITLES,
  })

  useEffect(() => {
    let iptal = false
    void (async () => {
      try {
        const [dosyaRes, kullaniciRes, hazirRes, tekrarRes] = await Promise.all([
          fetch(`/api/documents/fetch?fileId=${encodeURIComponent(fileId)}`, { cache: 'no-store' }),
          fetch('/api/users/current', { cache: 'no-store' }),
          fetch('/api/predefined-values', { cache: 'no-store' }),
          fetch(`/api/workflow/ev-ziyareti-tekrari?fileId=${encodeURIComponent(fileId)}`, { cache: 'no-store' }).catch(() => null),
        ])
        const dosya = await dosyaRes.json()
        if (!dosyaRes.ok || !dosya.success || !dosya.data) throw new Error(dosya.error || 'Dosya bilgileri alınamadı.')
        const kullanici = await kullaniciRes.json().catch(() => null)
        const hazir = await hazirRes.json().catch(() => null)
        const tekrarBilgisi = tekrarRes ? await tekrarRes.json().catch(() => null) : null
        if (iptal) return
        setDosyaNo(String(dosya.data.file?.fileNo ?? ''))
        setTekrar(tekrarBilgisi?.success && tekrarBilgisi.data ? tekrarBilgisi.data : null)
        setKisi(dosya.data.person ?? null)
        setHane(Array.isArray(dosya.data.household) ? dosya.data.household : [])
        setPersonelAdi(temiz(kullanici?.data?.ekipPersoneli?.name || kullanici?.data?.name || kullanici?.data?.username))
        if (hazir?.success && hazir.data) setHazirDegerler({ values: hazir.data.values, titles: hazir.data.titles })
        setDurum('hazir')
      } catch (err) {
        if (!iptal) {
          setHata(err instanceof Error ? err.message : 'Dosya bilgileri alınamadı.')
          setDurum('hata')
        }
      }
    })()
    return () => { iptal = true }
  }, [fileId])

  const tamAd = [temiz(kisi?.firstName), temiz(kisi?.lastName)].filter(Boolean).join(' ')

  // Dosya Yönetimi'ndeki haneUyeleriForInceleme ile ayni (bkz. documents/page.tsx)
  const haneUyeleri: HaneUyesi[] = kisi
    ? [
      { adSoyad: tamAd, yasGrubu: yasHesapla(kisi.birthDate), yakinlik: 'Başvuru sahibi', adres: temiz(kisi.address) },
      ...hane
        .filter((uye) => uye.beneficiaryId !== kisi.personId && !temiz(uye.deathDate))
        .map((uye): HaneUyesi => ({
          adSoyad: `${temiz(uye.firstName)} ${temiz(uye.lastName)}`.trim(),
          yasGrubu: yasHesapla(uye.birthDate),
          yakinlik: uye.relation === null || uye.relation === undefined || uye.relation === ''
            ? ''
            : getPredefinedValueLabel(hazirDegerler.values, 'person', 'relation', uye.relation, hazirDegerler.titles) ?? String(uye.relation),
          adres: temiz(uye.address) || temiz(kisi.address),
        })),
    ].filter((uye) => uye.adSoyad)
    : []

  const dosyayiAc = () => {
    addTab({ title: dosyaNo ? `Dosya ${dosyaNo}` : 'Dosya Ara', path: `/documents?fileId=${encodeURIComponent(fileId)}` })
  }

  return (
    <div className="space-y-3">
      <div className="hidden flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-300 lg:flex border-l-[6px] border-l-orange-600 bg-orange-50 px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-700">İş Akışı · Tahkikat</p>
          <p className="truncate text-lg font-black text-slate-900">
            {dosyaNo ? `Dosya ${dosyaNo}` : 'Dosya'}{tamAd ? ` — ${tamAd}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={dosyayiAc} className="rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-black text-orange-800 hover:bg-orange-100">
            Dosyayı Aç
          </button>
          <button type="button" onClick={() => sekmeyiKapat('tahkikat')} className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-black text-white hover:bg-orange-700">
            Listeye Dön
          </button>
        </div>
      </div>

      {tekrar && <EvZiyaretiTekrarUyarisi tekrar={tekrar} />}

      {durum === 'yukleniyor' && <div className="rounded-lg border border-slate-200 bg-white p-10 text-center font-bold text-slate-500">Dosya bilgileri yükleniyor...</div>}
      {durum === 'hata' && <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-700">{hata}</div>}
      {durum === 'hazir' && (
        <SahaIncelemeFormModal
          gomulu
          open
          dosyaid={fileId}
          onClose={() => sekmeyiKapat('tahkikat')}
          onSaved={() => {
            // 2026-10-15: kayit sonrasi sekme kapanir, dosya guncel haliyle acilir
            sekmeyiKapat('tahkikat', {
              title: dosyaNo ? `Dosya ${dosyaNo}` : 'Dosya Ara',
              path: `/documents?fileId=${encodeURIComponent(fileId)}&yenile=${Date.now()}`,
            })
          }}
          canDelete={false}
          haneUyeleri={haneUyeleri}
          dosyaBilgileri={{
            identityNumber: temiz(kisi?.identityNumber),
            fullName: tamAd,
            mobilePhone: temiz(kisi?.mobilePhone),
            address: temiz(kisi?.address),
            personelAdi,
          }}
        />
      )}
    </div>
  )
}
