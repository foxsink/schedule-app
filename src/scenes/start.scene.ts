import { Scenes } from 'telegraf';
import { BotContext } from '../types/context';
import { employeeService } from '../services/employee.service';

export const START_SCENE_ID = 'start';

export const startScene = new Scenes.WizardScene<BotContext>(
  START_SCENE_ID,

  // Step 0: check auth status
  async (ctx) => {
    if (ctx.employee) {
      await ctx.reply(`С возвращением, ${ctx.employee.firstName}!`);
      // TODO Phase 9: navigate to main menu
      return ctx.scene.leave();
    }
    await ctx.reply('Добро пожаловать! Введите код приглашения:');
    return ctx.wizard.next();
  },

  // Step 1: validate code and link telegram
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Пожалуйста, введите текстовый код приглашения:');
      return;
    }

    const code = ctx.message.text.trim().toUpperCase();
    const employee = await employeeService.findByInvitationCode(code);

    if (!employee || !employee.isActive) {
      await ctx.reply('Неверный код приглашения. Попробуйте ещё раз:');
      return;
    }

    if (employee.telegramId !== null) {
      await ctx.reply('Этот код уже использован. Обратитесь к администратору.');
      return ctx.scene.leave();
    }

    if (!ctx.from) {
      await ctx.reply('Ошибка: не удалось получить ваш Telegram ID.');
      return ctx.scene.leave();
    }

    await employeeService.linkTelegram(employee.id, BigInt(ctx.from.id));
    await ctx.reply(`Добро пожаловать, ${employee.firstName} ${employee.lastName}! Вы успешно авторизованы.`);
    // TODO Phase 9: navigate to main menu
    return ctx.scene.leave();
  }
);
