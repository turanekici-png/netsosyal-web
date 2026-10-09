const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const [ekmekCount, gidaCount, hazirCount, destekCount] = await Promise.all([
    prisma.yrd_ekmek.count({ where: { durumu: 2 } }),
    prisma.yrd_gidabankasi.count({ where: { durumu: 2 } }),
    prisma.yrd_haziryemek.count({ where: { durumu: 2 } }),
    prisma.yrd_destekpaketi.count({ where: { durumu: 2 } }),
  ]);

  const [ekmekAll, gidaAll, hazirAll, destekAll] = await Promise.all([
    prisma.yrd_ekmek.count(),
    prisma.yrd_gidabankasi.count(),
    prisma.yrd_haziryemek.count(),
    prisma.yrd_destekpaketi.count(),
  ]);

  console.log('Durumu 2 olanlar:');
  console.log({ ekmekCount, gidaCount, hazirCount, destekCount });
  
  console.log('\nToplam Kayıt Sayıları:');
  console.log({ ekmekAll, gidaAll, hazirAll, destekAll });

  // Bir örnek kayda bakalım durumu neymiş
  const sample = await prisma.yrd_ekmek.findFirst({ select: { durumu: true } });
  console.log('\nEkmek tablosu örnek durumu değeri:', sample);
}

main().catch(console.error).finally(() => prisma.$disconnect());
