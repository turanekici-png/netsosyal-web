import * as pg from 'pg'

// PostgreSQL "timestamp WITHOUT time zone" (OID 1114) — saat kayması düzeltmesi
// ---------------------------------------------------------------------------
// KÖK NEDEN: Bu sunucuda PostgreSQL'in oturum timezone'u UTC. Dolayısıyla
// `now()` / `CURRENT_TIMESTAMP`, "timestamp without time zone" kolonlara UTC
// duvar-saatini yazıyor (ör. Türkiye saati 13:05 iken kolona 10:05 düşüyor).
//
// node-postgres (`pg`) VARSAYILAN olarak bu tip için gelen "10:05" metnini
// SUNUCUNUN YEREL saati (Europe/Istanbul) sanıp Date'e çeviriyor -> 07:05Z.
// Ekranda tekrar Türkiye'ye çevrilince 10:05 görünüyor = GERÇEK saatin 3 saat
// GERİSİ. (Prisma'nın `@prisma/adapter-pg` sürücüsü bu tipi zaten UTC kabul
// ettiği için Prisma ile okunan tarihler DOĞRU; sorun yalnız ham `pg`
// havuzlarıyla — getSqlMonitorPool vb. — okunan kayıtlarda.)
//
// İLK DENEME (global `pg.types.setTypeParser` / `pg-types` paketi) Next.js'in
// üretim derlemesinde ÇALIŞMADI: sunucu tarafı derleme rotaları AYRI
// paketlere (chunk) derleniyor ve `pg-types`'ın modül-içi durumu (parser
// kaydı) bu paketler arasında PAYLAŞILMIYOR gibi görünüyor - bir chunk'ta
// çağrılan setTypeParser, başka bir chunk'ta oluşturulan Pool'un kullandığı
// (ayrı) `pg-types` kopyasını etkilemiyordu (canlıda doğrulandı: düzeltme
// koddaydı ama SQL Monitör/İşlem Geçmişi hâlâ 3 saat geri gösteriyordu).
//
// ÇÖZÜM: global kayıt yerine HER Pool'a KENDİ `pg.TypeOverrides` örneğini
// ver (`new Pool({ ..., types: createUtcTypeOverrides() })`). Bu, düzeltmeyi
// Pool NESNESİNİN KENDİSİNE bağlar - hangi chunk'ta oluşturulduğundan
// bağımsız çalışır, paylaşılan/global bir duruma dayanmaz.

// @types/pg bu projenin tsconfig'inde (moduleResolution: "bundler")
// "TypeOverrides" adlandırılmış import'unu ve Pool config'teki "types"
// seçeneğini tutarlı şekilde tiplemiyor - çalışma zamanında ikisi de mevcut
// (pg@8.23.0), bu yüzden bilerek `any` ile erişiliyor (bkz. Pool
// çağrılarındaki `as any`).
type PgTypeOverridesInstance = {
  setTypeParser(oid: number, parseFn: (value: string) => unknown): void
}
type PgTypeOverridesConstructor = new () => PgTypeOverridesInstance
const PgTypeOverrides = (pg as unknown as { TypeOverrides: PgTypeOverridesConstructor }).TypeOverrides

function parseNaiveTimestampAsUtc(value: string): Date {
  // "2026-09-10 10:05:23.887" -> "2026-09-10T10:05:23.887Z"
  const iso = value.includes('T') ? value : value.replace(' ', 'T')
  return new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`)
}

export function createUtcTypeOverrides(): PgTypeOverridesInstance {
  const overrides = new PgTypeOverrides()
  // 1114 = timestamp without time zone
  overrides.setTypeParser(1114, parseNaiveTimestampAsUtc)
  return overrides
}
