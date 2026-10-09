#!/bin/bash
# Hızlı başlangıç script'i

echo "🚀 Sosyal Yardım Yönetim Sistemi Başlatılıyor..."

# Prisma migrate
echo "📦 Veritabanı başlatılıyor..."
npx prisma migrate dev --name init

# Dev server
echo "🌐 Geliştirme sunucusu başlatılıyor..."
npm run dev
