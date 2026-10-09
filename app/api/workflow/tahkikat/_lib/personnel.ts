import { prisma } from '@/lib/db/prisma'
import type { PersonelEntry } from './rotation'

// Tahkikat gorevlisi = kullanici adi "tahkikat" ile BASLAYAN aktif
// kullanicilar (ör. tahkikat1, tahkikat2). Bkz. app/api/workflow/tahkikat/
// personnel/route.ts (2026-10-08, 1. tur: once "/workflow/tahkikat erisimi
// olan herkes" denendi, cok genisti; 2. tur: "sadece kullanıcı adı
// tahkikat ile başlayanlar" istendi) - paketler/rotasyon hesaplari da AYNI
// listeyi kullanmali, bu yuzden paylasilan tek bir fonksiyona alindi.
export async function getTahkikatPersonelListesi(): Promise<PersonelEntry[]> {
  const activeUsers = await prisma.user.findMany({
    where: { status: 1 },
    select: { id: true, kullanicitamadi: true, username: true },
  })

  return activeUsers
    .filter((user) => (user.username || '').trim().toLocaleLowerCase('tr-TR').startsWith('tahkikat'))
    .map((user) => ({
      id: String(user.id),
      name: (user.kullanicitamadi || '').trim() || user.username || 'Kullanıcı',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))
}
