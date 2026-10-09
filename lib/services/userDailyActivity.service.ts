import { prisma } from '@/lib/db/prisma'

type UserDailyActivityRow = {
  user_name: string | null
  daily_count: bigint | number | string | null
  weekly_count: bigint | number | string | null
  monthly_count: bigint | number | string | null
  last_activity: Date | string | null
}

export type UserDailyActivityDatum = {
  userName: string
  daily: number
  weekly: number
  monthly: number
  lastActivity: string | null
}

function toNumber(value: bigint | number | string | null | undefined) {
  return Number(value ?? 0)
}

// Bu sorgu bir ay boyunca sistem hareket/denetim kayitlarini, kullanici ve
// dosya bazinda pencere fonksiyonlariyla oturumlara ayirdigi icin agirdir.
// Hem ana sayfa paneli hem de "Genel Liste" sayfasi bunu cagirdigindan,
// dashboard'daki 30 saniyelik onbellekleme deseniyle ayni sekilde kisa
// sureli bir onbellek kullanmak, her sayfa acilisinda/yenilemede sorguyu
// bastan calistirmayi (ve raporlar listelenirken hissedilen gecikmeyi) onler.
const userDailyActivityCacheTtlMs = 30_000
const globalForUserDailyActivity = globalThis as unknown as {
  userDailyActivityCache?: {
    expiresAt: number
    data: UserDailyActivityDatum[]
  }
}

// Bu ay icindeki sistem hareket ve denetim kayitlarindan kullanici basina
// gunluk / haftalik / aylik islem sayisini hesaplar.
//
// Onemli: kayidin uzerindeki "kullaniciid" alani (dosyalar.kullaniciid,
// yrd_ekmek.kullaniciid vb.) o kaydin ATANDIGI/SAHIBI OLDUGU personeli
// gosterir; o an islemi YAPAN kisiyi degil. Bu alan, kayit uzerinde baska
// biri (veya otomatik bir is/gorev) degisiklik yapsa bile ayni kalir. Bu
// yuzden islemi kimin yaptigini bulmak icin SADECE log satirinin kendi
// kullanici_adi alani kullanilir - baska bir tabloya/JSON alanina bakip
// tahmin yurutulmez. Boylece izinli/pasif bir personelin uzerine, sistemin
// otomatik guncelledigi (or: yardim donemi/durum yenileme gorevi) kayitlar
// yanlislikla "bugun islem yapti" olarak yazilmiyor.
//
// "Sistem" (ve "postgres") tetikleyici/bakim islemlerini temsil eder, gercek
// bir personel degildir; bu yuzden kullanici bazli performans listesine hic
// dahil edilmez.
//
// Sadece dosyada gercek bir degisiklik yapan (ekleme, silme veya alan
// degeri gercekten degisen guncelleme) kayitlar islem sayilir. Bir kaydi
// sadece acip hicbir sey degistirmeden kapatmak (veri ayni kalan bir
// "guncelle" kaydi) islemden sayilmaz.
//
// Istisna: bir yardim turu/muracaat formu YAZDIRMA da islem sayilir
// (islem_tipi='yazdir' - bkz. app/api/documents/print-log/route.ts).
// Yazdirma hicbir alani degistirmedigi icin normalde yukaridaki
// "eski_deger IS DISTINCT FROM yeni_deger" kontrolunden gecemezdi; bu
// yuzden 'yazdir' ayrica listeye eklendi. Ayni gun+dosya icin birden fazla
// yazdirma, print-log ucunda INSERT'ten once tekillestirilerek (o gun icin
// zaten bir 'yazdir' kaydi varsa yenisi eklenmeyerek) 1 islem olarak kalir.
//
// "Islem sayisi" burada HAM kayit sayisi degildir: performans, personelin
// ilgilendigi MUSTERI/DOSYA sayisina gore olculur. Bir kullanici bir dosyaya
// girip o dosya uzerinde art arda birkac degisiklik yaparsa (once bireyi
// guncelleyip sonra o dosyadaki bir yardimi guncellemesi gibi), bu tek bir
// "dosya ziyareti" - yani 1 islem - sayilir. Ancak kullanici baska bir
// dosyaya gecip DAHA SONRA ayni dosyaya tekrar donerse, bu yeni bir ziyaret
// olarak ikinci bir islem sayilir. Bu, klasik bir "gaps and islands" SQL
// desenidir: kullanicinin butun kayitlari zaman sirasina gore dizilir, her
// kayda hangi dosyayla ilgili oldugu (file_key) atanir, ardindan file_key bir
// onceki kayittan farklilastiginda yeni bir "ziyaret" (session) baslatilir.
// Musteri/dosya baglantisi olmayan tablolardaki (kullanicilar, sistem_gorevler
// disindaki sistem tablolari vb.) kayitlar icin dosyaid bulunamazsa, aynı
// mantik tablo+kayit no ile devam eder (ayni kayda art arda yapilan
// degisiklikler yine tek islem sayilir).
export async function getUserDailyActivityReport(): Promise<UserDailyActivityDatum[]> {
  const cached = globalForUserDailyActivity.userDailyActivityCache
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data
  }

  const rows = await prisma.$queryRaw<UserDailyActivityRow[]>`
    WITH raw_events AS (
      SELECT
        h.tarih AS activity_date,
        h.kullanici_adi,
        h.tablo_adi,
        h.kayit_id,
        ('h' || h.id::text) AS event_id
      FROM sistem_hareket_log h
      WHERE h.tarih >= date_trunc('month', now())
        AND h.kullanici_adi IS NOT NULL
        AND h.kullanici_adi NOT IN ('Sistem', 'postgres')
        AND (
          lower(h.islem_tipi) IN ('ekle', 'insert', 'sil', 'delete', 'yazdir')
          OR h.eski_deger::jsonb IS DISTINCT FROM h.yeni_deger::jsonb
        )
      UNION ALL
      SELECT
        a.tarih,
        a.kullanici_adi,
        a.tablo_adi,
        a.kayit_id,
        ('a' || a.id::text) AS event_id
      FROM sistem_audit_revizyonlar a
      WHERE a.tarih >= date_trunc('month', now())
        AND a.kullanici_adi IS NOT NULL
        AND a.kullanici_adi NOT IN ('Sistem', 'postgres')
        AND (
          lower(a.islem_tipi) IN ('ekle', 'insert', 'sil', 'delete', 'yazdir')
          OR a.eski_deger::jsonb IS DISTINCT FROM a.yeni_deger::jsonb
        )
    ),
    resolved AS (
      SELECT
        e.activity_date,
        e.event_id,
        COALESCE(NULLIF(k.kullanicitamadi, ''), NULLIF(k.kullaniciadi, ''), NULLIF(e.kullanici_adi, '')) AS user_name,
        COALESCE(rf.dosyaid, e.tablo_adi || ':' || e.kayit_id) AS file_key
      FROM raw_events e
      LEFT JOIN kullanicilar k ON k.kullaniciadi = e.kullanici_adi
      LEFT JOIN LATERAL (
        SELECT d.id::text AS dosyaid
          FROM dosyalar d
         WHERE e.tablo_adi = 'dosyalar' AND d.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT b.dosyaid::text FROM bireyler b
         WHERE e.tablo_adi = 'bireyler' AND b.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM evziyareti y
         WHERE e.tablo_adi = 'evziyareti' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM nakitkart y
         WHERE e.tablo_adi = 'nakitkart' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM sistem_evrak_takip y
         WHERE e.tablo_adi = 'sistem_evrak_takip' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM sistem_gorevler y
         WHERE e.tablo_adi = 'sistem_gorevler' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM tahkikatraporlari y
         WHERE e.tablo_adi = 'tahkikatraporlari' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_aceze y
         WHERE e.tablo_adi = 'yrd_aceze' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_ayninakti y
         WHERE e.tablo_adi = 'yrd_ayninakti' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_ddgidadosyali y
         WHERE e.tablo_adi = 'yrd_ddgidadosyali' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_destekpaketi y
         WHERE e.tablo_adi = 'yrd_destekpaketi' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_digerkrmalyrdm y
         WHERE e.tablo_adi = 'yrd_digerkrmalyrdm' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_ekmek y
         WHERE e.tablo_adi = 'yrd_ekmek' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_gidabankasi y
         WHERE e.tablo_adi = 'yrd_gidabankasi' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_giyim y
         WHERE e.tablo_adi = 'yrd_giyim' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        UNION ALL
        SELECT y.dosyaid::text FROM yrd_haziryemek y
         WHERE e.tablo_adi = 'yrd_haziryemek' AND y.id = (CASE WHEN e.kayit_id ~ '^[0-9]+$' THEN e.kayit_id::bigint END)
        LIMIT 1
      ) rf ON true
    ),
    with_prev AS (
      SELECT
        user_name,
        activity_date,
        event_id,
        file_key,
        LAG(file_key) OVER (PARTITION BY user_name ORDER BY activity_date, event_id) AS prev_file_key
      FROM resolved
      WHERE user_name IS NOT NULL
    ),
    grouped AS (
      SELECT
        user_name,
        activity_date,
        file_key,
        SUM(CASE WHEN file_key IS DISTINCT FROM prev_file_key THEN 1 ELSE 0 END)
          OVER (PARTITION BY user_name ORDER BY activity_date, event_id ROWS UNBOUNDED PRECEDING) AS visit_no
      FROM with_prev
    ),
    visits AS (
      SELECT user_name, file_key, visit_no, MIN(activity_date) AS visit_at
      FROM grouped
      GROUP BY user_name, file_key, visit_no
    )
    SELECT
      user_name,
      COUNT(*) FILTER (WHERE visit_at >= current_date)::bigint AS daily_count,
      COUNT(*) FILTER (WHERE visit_at >= date_trunc('week', now()))::bigint AS weekly_count,
      COUNT(*)::bigint AS monthly_count,
      MAX(visit_at) AS last_activity
    FROM visits
    GROUP BY user_name
    ORDER BY daily_count DESC, monthly_count DESC, user_name ASC;
  `

  const data = rows.map((row) => ({
    userName: row.user_name || 'Bilinmeyen',
    daily: toNumber(row.daily_count),
    weekly: toNumber(row.weekly_count),
    monthly: toNumber(row.monthly_count),
    lastActivity: row.last_activity ? new Date(row.last_activity).toISOString() : null,
  }))

  globalForUserDailyActivity.userDailyActivityCache = {
    expiresAt: Date.now() + userDailyActivityCacheTtlMs,
    data,
  }

  return data
}
