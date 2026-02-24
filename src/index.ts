import { createBot } from './bot';
import { config } from './config';
import { prisma } from './prisma';

async function main() {
  const bot = createBot();

  // Temporary /start handler (replaced in Phase 2)
  bot.command('start', (ctx) => {
    ctx.reply('Бот запущен. Авторизация будет добавлена позже.');
  });

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
