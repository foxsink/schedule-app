import { Telegraf, session, Scenes } from 'telegraf';
import { config } from './config';
import { BotContext } from './types/context';

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.botToken);

  bot.use(session());

  return bot;
}
