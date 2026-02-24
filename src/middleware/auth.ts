import { BotContext } from '../types/context';
import { employeeService } from '../services/employee.service';
import { MiddlewareFn } from 'telegraf';

export const authMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.from) {
    const employee = await employeeService.findByTelegramId(BigInt(ctx.from.id));
    ctx.employee = employee;
  }
  return next();
};
