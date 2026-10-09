import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Sadece rakamlardan oluşan en büyük dosyano'yu bul
    const result = await prisma.$queryRaw<any[]>`
      SELECT dosyano FROM dosyalar 
      WHERE dosyano ~ '^[0-9]+$' 
      ORDER BY dosyano DESC LIMIT 1
    `
    
    let nextNo = "00001"
    if (result && result.length > 0) {
      const lastNoStr = result[0].dosyano
      const lastNo = parseInt(lastNoStr, 10)
      if (!isNaN(lastNo)) {
        // Bir fazlasını al ve 5 haneye tamamla
        nextNo = String(lastNo + 1).padStart(5, '0')
      }
    }
    
    return NextResponse.json({ success: true, nextNo })
  } catch (error) {
    console.error('Sıradaki dosya no hatası:', error)
    return NextResponse.json({ success: false, error: 'Sıradaki dosya numarası alınamadı.' }, { status: 500 })
  }
}
