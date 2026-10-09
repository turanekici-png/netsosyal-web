import { prisma } from '@/lib/db/prisma'
import { YardimSayacClient } from './YardimSayacClient'
import { TRACKED_YARDIM_TURLERI } from '@/lib/constants/yardimSayac'
import { formatNaiveIstanbulDate, formatNaiveIstanbulTime, istanbulWallClockToNaiveDate } from '@/lib/db/naiveIstanbulTime'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 100
const ROUTE_PATH = '/reports/yardim-sayac'

// Kullanici istegi (14 Eylul 2026): "yardim_sayac... gercek Turkiye
// saatinden 3 saat geride kaydediliyor". Yazma tarafi artik acikca
// Istanbul duvar-saatini "naive" olarak yaziyor (bkz. app/api/documents/
// yardim-sayac/route.ts + lib/db/naiveIstanbulTime.ts) - bu yuzden burada
// ARTIK `.toLocaleDateString`/`.toLocaleTimeString` KULLANILMAZ (o, Prisma'nin
// "naive=UTC" okuma kuralinin ustune BIR KEZ DAHA yerel saate cevirmeye
// calisir ve saklanan digit'leri bozar) - saklanan HAM digit'ler dogrudan
// okunur.
function formatTarih(value: Date | null) {
  if (!value) return '-'
  return formatNaiveIstanbulDate(value)
}
function formatSaat(value: Date | null) {
  if (!value) return '-'
  return formatNaiveIstanbulTime(value)
}

export default async function YardimSayacPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; tur?: string; baslangic?: string; bitis?: string }>
}) {
  const params = await searchParams
  const currentPage = Math.max(1, Number(params.page) || 1)
  const search = (params.search || '').trim()
  // Kullanici istegi (2026-09-28): "Sanal Yazıcı" ile artik SADECE sabit 4
  // turle SINIRLI KALMADAN herhangi bir yardim turu kaydedilebiliyor - bu
  // yuzden tur filtresi artik TRACKED_YARDIM_TURLERI'ye karsi DOGRULANMAZ,
  // veride GERCEKTEN var olan HERHANGI bir turu kabul eder (bkz. asagidaki
  // turOptions - gercek verideki distinct turlerden dinamik olusturulur).
  const turFilter = (params.tur || '').trim()
  const baslangic = (params.baslangic || '').trim()
  const bitis = (params.bitis || '').trim()

  const where: Record<string, unknown> = {}
  if (turFilter) where.yardimTuru = turFilter
  if (search) {
    where.OR = [
      { dosyaNo: { contains: search, mode: 'insensitive' } },
      { adSoyad: { contains: search, mode: 'insensitive' } },
      { gonderenKullanici: { contains: search, mode: 'insensitive' } },
    ]
  }
  // Kullanici istegi (14 Eylul 2026, devami): filtre siniri da saklanan
  // degerle AYNI birimde (Istanbul duvar-saati "naive" digit) kurulmali -
  // aksi halde tarih araligi filtresi yanlis satirlari getirir/kacirir.
  const islemTarihi: Record<string, Date> = {}
  if (baslangic && !Number.isNaN(Date.parse(baslangic))) islemTarihi.gte = istanbulWallClockToNaiveDate(baslangic, '00:00:00')
  if (bitis && !Number.isNaN(Date.parse(bitis))) islemTarihi.lte = istanbulWallClockToNaiveDate(bitis, '23:59:59')
  if (Object.keys(islemTarihi).length) where.islemTarihi = islemTarihi

  let rows: Awaited<ReturnType<typeof prisma.yardimSayac.findMany>> = []
  let totalCount = 0
  let turDagilimi: { tur: string; adet: number }[] = []
  // Kullanici istegi (2026-09-28): filtre acilir menusu artik SADECE sabit
  // 4 turu degil, tabloda GERCEKTEN var olan (Sanal Yazici ile eklenmis
  // olanlar dahil) HER turu listeler. Tarih/arama filtresinden BAGIMSIZ,
  // TUM zamanlarin distinct turleri - boylece secim listesi geçici olarak
  // daralmaz.
  let turOptions: string[] = [...TRACKED_YARDIM_TURLERI]
  let errorMessage: string | null = null

  try {
    const [count, list, grouped, allTurler] = await Promise.all([
      prisma.yardimSayac.count({ where }),
      prisma.yardimSayac.findMany({
        where,
        orderBy: { id: 'desc' },
        take: PAGE_SIZE,
        skip: (currentPage - 1) * PAGE_SIZE,
      }),
      prisma.yardimSayac.groupBy({
        by: ['yardimTuru'],
        where,
        _count: { _all: true },
      }),
      prisma.yardimSayac.groupBy({ by: ['yardimTuru'] }),
    ])
    totalCount = count
    rows = list
    turDagilimi = grouped
      .map((g) => ({ tur: g.yardimTuru, adet: g._count._all }))
      .sort((a, b) => b.adet - a.adet)
    turOptions = Array.from(new Set([...TRACKED_YARDIM_TURLERI, ...allTurler.map((g) => g.yardimTuru)])).sort((a, b) => a.localeCompare(b, 'tr-TR'))
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }

  const data = rows.map((row) => ({
    tarih: formatTarih(row.islemTarihi),
    saat: formatSaat(row.islemTarihi),
    yardimTuru: row.yardimTuru || '-',
    dosyaNo: row.dosyaNo || '-',
    adSoyad: row.adSoyad || '-',
    miktar: row.miktar || '-',
    gonderen: row.gonderenKullanici || '-',
    yazici: row.yaziciAdi || '-',
    aciklama: row.aciklama || '-',
  }))

  return (
    <>
      {errorMessage && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-600 print:hidden">
          Veritabanı Hatası: {errorMessage}
        </div>
      )}
      <YardimSayacClient
        routePath={ROUTE_PATH}
        data={data}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={PAGE_SIZE}
        search={search}
        tur={turFilter}
        baslangic={baslangic}
        bitis={bitis}
        turOptions={turOptions}
        turDagilimi={turDagilimi}
      />
    </>
  )
}
