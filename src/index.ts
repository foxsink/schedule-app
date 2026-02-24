import { createBot } from './bot';
import { config } from './config';
import { prisma } from './prisma';
import { seedSuperAdmin } from './seed';

async function main() {
  await seedSuperAdmin();

  const bot = createBot();

  process.once('SIGINT', () => {
    bot.stop('SIGINT');
    prisma.$disconnect();
  });
  process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    prisma.$disconnect();
  });

  if (config.botMode === 'webhook') {
    await bot.launch({
      webhook: {
        domain: config.webhookDomain,
        path: config.webhookPath,
        port: config.port,
      },
    });
    console.log(`Bot started in webhook mode on port ${config.port}`);
  } else {
    await bot.launch();
    console.log('Bot started in polling mode');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
