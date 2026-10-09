# Sosyal Yardım Yönetim Sistemi (SYYS)

Modüler Next.js + PostgreSQL + Prisma ORM tabanlı sosyal yardım programı yönetim sistemi.

## 📋 Proje Yapısı

```
Modüler Mimarı:
- Her modül bağımsız çalışır
- Bir modülde yapılan güncelleme diğerlerini etkilemez
- Dinamik modül ekleme/çıkarma mümkün
```

## 🏗️ Modüller

1. **Bireyler (Beneficiary)** - Sosyal yardım alıcıları yönetimi
2. **Dosyalar (Documents)** - Döküman yönetimi  
3. **Müracaatlar (Requests)** - Müracaat yönetimi
4. **Yardımlar (Assistance)** - Yardım sağlama yönetimi
5. **Kullanıcılar (Users)** - Sistem kullanıcıları
6. **Raporlar (Reports)** - Rapor oluşturma/yönetimi
7. **İş Akışı (Workflow)** - İş akışı adımları
8. **Ayarlar (Settings)** - Sistem ayarları

## 📁 Dosya Yapısı

```
app/
├── layout.tsx                    # Ana layout
├── page.tsx                      # Ana sayfa
├── globals.css                   # Global stiller
├── api/                          # API endpoints
│   ├── beneficiary/
│   ├── documents/
│   ├── requests/
│   ├── assistance/
│   ├── users/
│   ├── reports/
│   ├── workflow/
│   └── settings/
└── (modules)/                    # Modül sayfaları
    ├── beneficiary/
    ├── documents/
    ├── requests/
    ├── assistance/
    ├── users/
    ├── reports/
    ├── workflow/
    ├── dashboard/
    └── settings/

lib/
├── db/
│   └── prisma.ts                 # Prisma client
├── services/                     # İş mantığı
│   ├── module.service.ts         # Base class
│   ├── beneficiary.service.ts
│   ├── document.service.ts
│   ├── request.service.ts
│   ├── assistance.service.ts
│   ├── user.service.ts
│   ├── report.service.ts
│   ├── workflow.service.ts
│   ├── settings.service.ts
│   └── index.ts                  # Modüller registry
├── types/
│   └── index.ts                  # TypeScript types
└── utils/

components/
└── layout/
    ├── header.tsx
    └── sidebar.tsx

prisma/
└── schema.prisma                 # Veritabanı şeması
```

## 🛠️ Teknolojiler

- **Frontend**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Node**: v18+

## 🚀 Başlangıç

### 1. Ortam Kurulumu

```bash
# 1. Veritabanı bağlantısını ayarla
# .env dosyasını oluştur veya düzenle
DATABASE_URL="postgresql://KULLANICI:GUCLU_PAROLA@localhost:5432/VERITABANI"

# 2. Prisma'yı çalıştır
npx prisma migrate dev --name init

# 3. Prisma Studio'yu aç (isteğe bağlı)
npx prisma studio

# Not: PowerShell'de "UnauthorizedAccess" hatası alırsanız şu komutu çalıştırın:
# Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Not: "No database URL found" hatası alırsanız, Prisma Studio komutunu --url argümanı ile çalıştırın:
# npx prisma studio --url "$env:DATABASE_URL"
```

### 2. Projeyi Çalıştır

```bash
npm run dev
```

Tarayıcı: http://localhost:3000

## 📡 API Endpoints

### Bireyler
- `GET /api/beneficiary` - Tüm bireyleri listele
- `GET /api/beneficiary/:id` - Birey detaylarını getir
- `POST /api/beneficiary` - Yeni birey ekle
- `PUT /api/beneficiary/:id` - Birey güncelle
- `DELETE /api/beneficiary/:id` - Birey sil

### Dokümante
- `GET /api/documents` - Tüm dökümanlar
- `POST /api/documents` - Döküman ekle
- `PUT /api/documents/:id` - Döküman güncelle
- `DELETE /api/documents/:id` - Döküman sil

### Müracaatlar
- `GET /api/requests` - Tüm müracaatlar
- `POST /api/requests` - Müracaat ekle
- `PUT /api/requests/:id` - Müracaat güncelle
- `DELETE /api/requests/:id` - Müracaat sil

### Yardımlar
- `GET /api/assistance` - Tüm yardımlar
- `POST /api/assistance` - Yardım ekle
- `PUT /api/assistance/:id` - Yardım güncelle
- `DELETE /api/assistance/:id` - Yardım sil

### Diğer modüller
- Users: `/api/users`
- Reports: `/api/reports`
- Workflow: `/api/workflow`
- Settings: `/api/settings`

## 🔧 Modül Ekleme

Yeni modül eklemek için:

1. **Service oluştur**: `lib/services/newmodule.service.ts`
2. **Types tanımla**: `lib/types/index.ts` e ekle
3. **API routes**: `app/api/newmodule/`
4. **Sayfa**: `app/(modules)/newmodule/`
5. **Registry'ye ekle**: `lib/services/index.ts`

```typescript
// Service örneği
class NewModuleService extends ModuleService {
  // Implement CRUD operations
}

export const newModuleService = new NewModuleService({
  name: 'New Module',
  path: '/newmodule',
  icon: '🆕',
  description: 'Module açıklaması',
})
```

## 📝 Notlar

- Tüm API'ler JSON döndürür
- Pagination: page=1&limit=10
- Error handling: Tüm hataları middleware ile yönet
- Türkçe dil desteği bulunmaktadır

## 🔐 Güvenlik

- Environment variables'ı koruyarak sakla
- API'ye authentication/authorization ekle
- Veritabanı backupı almayı unutma

## 📞 Destek

Sorunlar için GitHub Issues'u kullan.
