const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const requests = await prisma.request.findMany({
    take: 5,
    select: {
      mahalleadi: true,
      cadde: true,
      sokak: true,
      binano: true,
      adres: true
    }
  });
  console.log(JSON.stringify(requests, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
