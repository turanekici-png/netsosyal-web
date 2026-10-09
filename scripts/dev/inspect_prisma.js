const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const keys = Object.keys(prisma);
  // Model isimleri genellikle prisma.$extends veya dahili nesneler arasında değil, direkt ana nesne üzerindedir.
  // Ancak Prisma Client v5+ ile bazıları farklı görünebilir.
  const models = keys.filter(k => !k.startsWith('$') && !k.startsWith('_'));
  console.log('Mevcut Prisma Modelleri:');
  console.log(models);
}

main().catch(console.error).finally(() => prisma.$disconnect());
