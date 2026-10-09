export async function register() {
  // NOT: "timestamp without time zone" saat kayması düzeltmesi (Prisma ile
  // aynı şekilde UTC okuma) artık BURADA değil, HER ham `pg` Pool'unun kendi
  // `types: createUtcTypeOverrides()` seçeneğinde uygulanıyor (bkz.
  // lib/db/pgTypeParsers.ts, lib/services/sqlMonitor.service.ts). Global
  // `pg.types.setTypeParser` üretim derlemesinde sunucu paketleri (chunk)
  // arasında paylaşılmadığı için (canlıda doğrulandı: düzeltme koddaydı ama
  // etkisizdi) buradan kaldırıldı.

  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
    // Production build sırasında çalışmasını engellemek için ek kontrol
    if (process.env.NEXT_PHASE === 'phase-production-build') return;
    
    // Bu bilgisayarda veritabani/tablolar/ilk kullanici var mi diye BIR KEZ
    // kontrol eder ve sonucu bellekte tutar (bkz. lib/services/provisioning.service.ts) -
    // sonraki her istek (ör. /login sayfasi) bunu tekrar veritabanina
    // sormadan bellekten okur. Mevcut (kurulu) sistemlerde bu her zaman
    // "ready" sonucu verir, hicbir davranis degismez.
    const { getProvisioningState } = await import('./lib/services/provisioning.service')
    void getProvisioningState().catch(() => { /* durum servis icinde tutulur */ })

    // İKİNCİL (secondary) instance: ayni veritabanina baglanan ikinci bir
    // sunucu (ör. dis erisim icin IIS'te calisan kopya). Zamanli SQL
    // gorevleri / otomatik yedekleme / iletisim temizligi / WhatsApp Web
    // SADECE BİRİNCİL (primary) instance'ta calismali - aksi halde:
    //   * yedekler ve zamanli SQL 2 kez calisir (veri bozulmasi riski)
    //   * WhatsApp Web tek telefon eslesmesini iki istemci paylasamaz
    //   * iletisim saklama temizligi cift calisir
    // Ikincil sunucunun .env'ine NETSOSYAL_ROLE=secondary yazilir; o sunucu
    // yalnizca HTTP isteklerini karsilar, arka plan islerine dokunmaz.
    const isSecondary = (process.env.NETSOSYAL_ROLE || '').toLowerCase() === 'secondary'
    if (isSecondary) {
      console.log('[instrumentation] NETSOSYAL_ROLE=secondary - arka plan isleri (scheduler / yedekleme / WhatsApp) BASLATILMADI.')
      return
    }

    const { scheduledSqlTasksService } = await import('./lib/services/scheduledSqlTasks.service')
    scheduledSqlTasksService.startScheduler()
    const { databaseBackupService } = await import('./lib/services/databaseBackup.service')
    databaseBackupService.startScheduler()
    const { startCommunicationRetentionScheduler } = await import('./lib/services/communicationRetention.service')
    startCommunicationRetentionScheduler()

    // Daha önce QR ile eşleştirilmiş bir WhatsApp oturumu varsa (.wwebjs_auth
    // klasöründe kayıtlı), sunucu her yeniden başladığında otomatik olarak
    // geri yüklenir - yetkilinin tekrar QR okutmasına gerek kalmaz. Hiç
    // eşleştirme yapılmadıysa bu çağrı sadece QR üretir ve bekler (kimseye
    // zarar vermez, bkz. lib/services/whatsappWeb.service.ts).
    const { initWhatsappClient } = await import('./lib/services/whatsappWeb.service')
    void initWhatsappClient().catch(() => { /* durum servis icinde tutulur, ayarlar sayfasindan görünür */ })
  }
}
