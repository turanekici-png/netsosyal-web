import { NextResponse } from 'next/server'
import { getProvisioningState } from '@/lib/services/provisioning.service'

export const dynamic = 'force-dynamic'

// GET - HERKESE AÇIK (oturum gerektirmez - bkz. middleware.ts). Veritabanı/
// tablolar/ilk yönetici henüz kurulmamışsa "/kurulum" sayfası bunu sorgular.
// Mevcut (canlı) kurulumlarda daima { status: 'ready' } döner - bkz.
// lib/services/provisioning.service.ts.
export async function GET() {
  const state = await getProvisioningState()
  return NextResponse.json({ success: true, data: state })
}
