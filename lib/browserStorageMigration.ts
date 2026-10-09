// Uygulama yeniden adlandirildi: "nextsosyal" -> "netsosyal". Tarayicida
// saklanan yerel veriler (yazici yonlendirme ayarlari, calisma alani durumu,
// "beni hatirla" kullanici adi, SQL gecmisi vb.) "nextsosyal:*" / "nextsosyal."
// onekiyle tutuluyordu. Bu fonksiyon, YENI surumun ilk acilisinda bu
// anahtarlari "netsosyal..." karsiligina TASIR (kopyalar + eskisini siler),
// boylece kullanici hicbir yerel ayarini kaybetmez.
//
// Idempotenttir; her acilista guvenle cagrilabilir.

const LEGACY_PREFIXES = ['nextsosyal:', 'nextsosyal.', 'nextsosyal-']
const NEW_PREFIX_BASE = 'netsosyal'

function migrateStorage(storage: Storage) {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i)
    if (key && LEGACY_PREFIXES.some((p) => key.startsWith(p))) keys.push(key)
  }
  for (const oldKey of keys) {
    // "nextsosyal" (10 karakter) -> "netsosyal"
    const newKey = NEW_PREFIX_BASE + oldKey.slice('nextsosyal'.length)
    try {
      const value = storage.getItem(oldKey)
      if (value !== null && storage.getItem(newKey) === null) {
        storage.setItem(newKey, value)
      }
      storage.removeItem(oldKey)
    } catch {
      // kota / erisim hatasi - o anahtari atla
    }
  }
}

export function migrateLegacyBrowserStorage() {
  if (typeof window === 'undefined') return
  try {
    migrateStorage(window.localStorage)
  } catch { /* localStorage erisilemez olabilir */ }
  try {
    migrateStorage(window.sessionStorage)
  } catch { /* sessionStorage erisilemez olabilir */ }
}
