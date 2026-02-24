import { BotContext } from '../types/context';
import { MiddlewareFn } from 'telegraf';

export const adminGuard: MiddlewareFn<BotContext> = async (ctx, next) => {
  const role = ctx.employee?.role;
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    await ctx.reply('Нет доступа.');
    return;
  }
  return next();
};
