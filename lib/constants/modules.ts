export const MODULES_CONFIG = [
  // Kullanici istegi (15 Eylul 2026, 32. tur): "Sosyal Asistan" ust duzey
  // (flat) bir sidebar ogesi olmaktan cikarilip "Ayarlar" acilir menusune
  // tasindi (bkz. components/layout/sidebar.tsx - isAsistanPage +
  // Ayarlar alt menusundeki ozel Link). Herkese acikligi (pageAccess.ts)
  // degismedi - sadece sidebar konumu degisti.
  { name: 'Dosya Yönetimi', path: '/documents', icon: 'file' },
  // Kullanici istegi (2026-09-22): "online başvurular butonuna tıklayında
  // diğer alanlar gibi yeni sekmede açılsın dosya yönetimi sekmesi gibi
  // açılsın ve kullanıcı kapatana kadar o sekme gitmesin" - MODULES_CONFIG'e
  // kayitli her path TabContext tarafindan otomatik olarak kalici bir
  // sekmeye donusturuluyor (bkz. lib/context/TabContext.tsx); sidebar'daki
  // "Online Başvurular" sabit butonu (components/layout/sidebar.tsx, kendi
  // ozel gorunumu) bu path'i zaten bilincli olarak "otherModules" genel
  // listesinden HARIC TUTUYORDU (satir ~397, !m.path.startsWith('/online')) -
  // yani buraya eklemek sidebar gorunumunu DEGISTIRMEZ, sadece TabContext'in
  // bu sayfayi taniyip sekme olarak acmasini saglar.
  { name: 'Online Başvurular', path: '/online', icon: 'inbox' },
  { name: 'Dosyalar', path: '/documents/all', icon: 'folder' },
  { name: 'Bireyler', path: '/beneficiary', icon: 'users' },
  { name: 'İhale Bilgileri', path: '/hakedis', icon: 'calculator' },
  { name: 'Muhasebe', path: '/muhasebe', icon: 'calculator' },
  { name: 'Dernek İşlemleri', path: '/dernek', icon: 'badge-check' },

  // Yardım Müracaatları (Süreç Yönetimi)
  { name: 'Müracaat Listesi', path: '/requests', icon: 'edit' },
  { name: 'Ekmek Müracaatı', path: '/requests/ekmek', icon: 'gift' },
  { name: 'Gıda Müracaatı', path: '/requests/gida', icon: 'gift' },
  { name: 'Giyim Müracaatı', path: '/requests/giyim', icon: 'gift' },
  { name: 'Hazır Yemek', path: '/requests/hazir-yemek', icon: 'gift' },
  { name: 'Nakit Müracaatı', path: '/requests/nakit', icon: 'gift' },
  { name: 'Dönem Dışı Gıda', path: '/requests/donem-disi', icon: 'gift' },
  { name: 'Destek Paketi', path: '/requests/destek-paketi', icon: 'gift' },

  // Sosyal Yardımlar (Dağıtım ve Takip)
  { name: 'Ekmek Yardımı', path: '/assistance/ekmek', icon: 'gift' },
  { name: 'Gıda Yardımı', path: '/assistance/gida', icon: 'gift' },
  { name: 'Giyim Yardımı', path: '/assistance/giyim', icon: 'gift' },
  { name: 'Hazır Yemek', path: '/assistance/hazir-yemek', icon: 'gift' },
  { name: 'Nakit Yardımı', path: '/assistance/nakit/muracaatlar', icon: 'gift' },
  { name: 'Dönem Dışı Gıda', path: '/assistance/donem-disi', icon: 'gift' },
  { name: 'Destek Paketi', path: '/assistance/destek-paketi', icon: 'gift' },
  { name: 'Periyodik Yardımlar', path: '/assistance/periyodik', icon: 'workflow' },
  { name: 'Aceze Yardımı', path: '/assistance/aceze', icon: 'gift' },

  // Raporlama
  { name: 'Özel Rapor Oluştur', path: '/reports/ozel', icon: 'bar-chart' },
  { name: 'Ekmek Yardımı Raporu', path: '/reports/ekmek', icon: 'bar-chart' },
  { name: 'Genel Raporlar', path: '/reports/genel', icon: 'bar-chart' },
  { name: 'Yardım Hareketleri', path: '/reports/yardim-hareketleri', icon: 'bar-chart' },
  { name: 'Yardım Sayaç', path: '/reports/yardim-sayac', icon: 'bar-chart' },
  { name: 'SMS Gönderim Raporlar', path: '/reports/sms', icon: 'bar-chart' },
  { name: 'Diğer Kurumlar', path: '/reports/diger-kurumlar', icon: 'bar-chart' },

  { name: 'Yıllık Yardım Geçmişi', path: '/reports/yillik-yardim-gecmisi', icon: 'bar-chart' },

  // Sistem
  { name: 'SQL Monitör', path: '/sql-monitor', icon: 'database' },
  { name: 'Zamanlanmış Görevler', path: '/scheduled-tasks', icon: 'settings' },
  { name: 'Yardım Dağılım Haritası', path: '/assistance/map', icon: 'map' },
]
