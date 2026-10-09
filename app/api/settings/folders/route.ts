import fs from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { requireApiAccess } from '@/lib/apiAuth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface FolderEntry {
  name: string
  fullPath: string
}

const isWindows = process.platform === 'win32'

const pathExists = async (folderPath: string) => {
  try {
    await fs.access(folderPath)
    return true
  } catch {
    return false
  }
}

const getRoots = async () => {
  if (!isWindows) return [{ name: '/', fullPath: '/' }]

  const driveLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
  const roots: FolderEntry[] = []

  await Promise.all(driveLetters.map(async (letter) => {
    const drivePath = `${letter}:\\`
    if (await pathExists(drivePath)) {
      roots.push({ name: drivePath, fullPath: drivePath })
    }
  }))

  return roots.sort((firstRoot, secondRoot) => firstRoot.name.localeCompare(secondRoot.name))
}

const resolveRequestedPath = async (requestedPath: string | null) => {
  if (requestedPath?.trim()) {
    const resolvedPath = path.resolve(requestedPath.trim())
    if (await pathExists(resolvedPath)) return resolvedPath
  }

  return process.cwd()
}

export async function GET(request: NextRequest) {
  try {
    // Bu uc nokta sunucunun TUM dosya sistemini (her surucu/klasoru)
    // gezebiliyor (yedekleme hedefi secimi icin) - sadece oturum acik olmasi
    // yeterli degil, /api/settings (POST) ile AYNI yetkiyi (settings.update)
    // zorunlu kilmak gerekiyor; aksi halde herhangi bir dusuk yetkili
    // kullanici sunucudaki tum klasor yapisini gorebilirdi.
    const accessDenied = await requireApiAccess({ action: 'settings.update', page: '/settings' })
    if (accessDenied) return accessDenied

    const requestedPath = request.nextUrl.searchParams.get('path')
    const currentPath = await resolveRequestedPath(requestedPath)
    // turbopackIgnore: bu uc nokta KASITLI olarak sunucudaki HERHANGI bir
    // klasoru gezebiliyor (yukaridaki yorum) - statik bir alt klasore
    // sabitlenemez. Turbopack build sirasinda bunu izlemeye calisip TUM
    // PROJEYI (public/ dahil) build ciktisina dahil ediyor, derlemeyi ciddi
    // sekilde yavaslatiyordu. Bu, salt build-zamani izlemeyi kapatir -
    // calisma zamaninda islev AYNEN devam eder.
    const entries = await fs.readdir(/* turbopackIgnore: true */ currentPath, { withFileTypes: true })
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(/* turbopackIgnore: true */ currentPath, entry.name),
      }))
      .sort((firstEntry, secondEntry) => firstEntry.name.localeCompare(secondEntry.name, 'tr-TR'))

    const parsedPath = path.parse(currentPath)
    const parentPath = currentPath === parsedPath.root ? null : path.dirname(currentPath)
    const roots = await getRoots()

    return NextResponse.json({
      success: true,
      data: {
        currentPath,
        parentPath,
        roots,
        directories,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 400 }
    )
  }
}
