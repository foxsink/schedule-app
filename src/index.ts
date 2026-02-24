import { createBot } from './bot';
import { config } from './config';
import { prisma } from './prisma';
import { seedSuperAdmin } from './seed';

async function main() {
  console.log('Starting bot...');

  await seedSuperAdmin();

  const bot = createBot();

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);
    bot.stop(signal);
    await prisma.$disconnect();
    console.log('Shutdown complete.');
    process.exit(0);
  };

  process.once('SIGINT',  () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  if (config.botMode === 'webhook') {
    if (!config.webhookDomain) {
      throw new Error('WEBHOOK_DOMAIN is required when BOT_MODE=webhook');
    }
    await bot.launch({
      webhook: {
        domain: config.webhookDomain,
        path: config.webhookPath,
        port: config.port,
      },
    });
    console.log(`Bot started in webhook mode on port ${config.port} (${config.webhookDomain}${config.webhookPath})`);
  } else {
    // In polling mode bot.launch() never resolves — run without await
    bot.launch().catch((err) => {
      console.error('Polling error:', err);
      process.exit(1);
    });
    console.log('Bot started in polling mode');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
