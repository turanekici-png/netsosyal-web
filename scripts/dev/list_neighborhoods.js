const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const neighborhoods = await prisma.request.groupBy({
    by: ['mahalleadi']
  });
  console.log(JSON.stringify(neighborhoods, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
