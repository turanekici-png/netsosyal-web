// Bir bireyin dosyasi degistiginde (baska bir dosyaya tasindiginda), o
// bireyin TC'sine ait DURUMU=0 ("Yeni Müracaat") bir Nakit Yardımı
// müracaatı varsa (eski dosyasina bagli olsun ya da olmasin), bireyle
// BİRLİKTE yeni dosyaya tasinmasi icin kullanilan PAYLASILAN yardimci
// fonksiyon. Müracaat kaydinda SADECE dosyaid degistirilir - baska HICBIR
// alana dokunulmaz (ceptel, iban, durumu, donem vb. AYNEN kalir).
//
// ONEMLI: bir bireyi baska bir dosyaya "tasima" işlemi UYGULAMADA IKI FARKLI
// kod yolundan tetiklenebiliyor - app/api/documents/transfer-person/route.ts
// (bilinen bir "eski kayit" icin acikca "Bu Dosyaya Taşı") VE
// app/api/documents/update/route.ts'teki upsertPerson() (bir dosyanin hane
// listesi kaydedilirken, id veya TC eslesmesiyle SESSIZCE baska bir
// dosyadan bu dosyaya "tasinan" birey) - IKISI DE bu fonksiyonu cagirmali,
// aksi halde ikinci yoldan yapilan tasimalarda nakit müracaatı geride
// kalir (canli ortamda gözlemlenen gercek bir hata, bkz. ilgili commit).
type RawSqlClient = {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<number | bigint>
  $queryRaw: <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T>
}

export async function moveActiveNakitApplicationWithPerson(
  tx: RawSqlClient,
  identityNumber: string | null | undefined,
  targetFileId: bigint,
): Promise<string | null> {
  const tc = (identityNumber || '').trim()
  if (!tc) return null

  const nakitRows = await tx.$queryRaw<{ id: bigint }[]>`
    SELECT id
    FROM yrd_ayninakti
    WHERE tckimlikno = ${tc}
      AND durumu = 0
    ORDER BY id DESC
    LIMIT 1;
  `
  const nakitMatch = nakitRows[0]
  if (!nakitMatch) return null

  await tx.$executeRaw`UPDATE yrd_ayninakti SET dosyaid = ${targetFileId} WHERE id = ${nakitMatch.id};`
  return nakitMatch.id.toString()
}
