import { Telegraf, Scenes } from 'telegraf';
import { config } from './config';
import { BotContext } from './types/context';
import { sessionMiddleware } from './middleware/session';
import { authMiddleware } from './middleware/auth';
import { startScene } from './scenes/start.scene';

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.botToken);

  const stage = new Scenes.Stage<BotContext>([startScene]);

  bot.use(sessionMiddleware);
  bot.use(authMiddleware);
  bot.use(stage.middleware());

  bot.command('start', (ctx) => ctx.scene.enter('start'));

  return bot;
}
