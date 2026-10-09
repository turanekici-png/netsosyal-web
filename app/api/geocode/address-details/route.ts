import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'
import { fetchKentRehberiAddressDetails } from '@/lib/services/geocoding'

export const dynamic = 'force-dynamic'

// Kullanici istegi: dosya ekranindaki NVİ'den bilgi getirme akislari
// (handleCitizenLookup, refreshHouseholdFromNvi, lookupHouseholdDraftFromNvi
// - bkz. app/(modules)/documents/page.tsx) TARAYICIDAN calisir; Kent
// Rehberi'ne (kentrehberi.sivas.bel.tr) DOGRUDAN tarayicidan istek atmak
// CORS ile engellenebilir. Bu uc, lib/services/geocoding.ts'teki
// fetchKentRehberiAddressDetails'i (mahalle/cadde-sokak/dis-ic kapi no/
// site-blok - NVİ'nin kendisinde COGUNLUKLA eksik/guvenilmez olan alanlar)
// sunucu tarafinda cagirip sadece SONUCU dondüren ince bir sarmalayicidir.
export async function GET(request: NextRequest) {
  const accessDenied = await requireApiAccess({ page: '/documents' })
  if (accessDenied) return accessDenied

  const adresNo = request.nextUrl.searchParams.get('adresNo')
  const details = await fetchKentRehberiAddressDetails(adresNo)
  return NextResponse.json({ success: true, data: details })
}
