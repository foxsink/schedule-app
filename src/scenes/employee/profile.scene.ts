import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { employeeService } from '../../services/employee.service';
import { prisma } from '../../prisma';
import { EMPLOYEE_MENU_SCENE_ID } from './menu.scene';

export const EMPLOYEE_PROFILE_SCENE_ID = 'employee_profile';

async function showProfile(ctx: BotContext): Promise<void> {
  if (!ctx.employee) {
    await ctx.reply('Вы не авторизованы. Введите /start.');
    return;
  }

  // Re-fetch to get latest data
  const emp = await prisma.employee.findUnique({ where: { id: ctx.employee.id } });
  if (!emp) return;

  const phoneStr = emp.phone ?? 'не указан';
  const addressStr = emp.address ?? 'не указан';
  const emergencyStr = emp.emergencyPhone ?? 'не указан';

  const text = [
    `👤 *${emp.lastName} ${emp.firstName}*`,
    `📱 Телефон: ${phoneStr}`,
    `🏠 Адрес: ${addressStr}`,
    `🆘 Экстренный: ${emergencyStr}`,
  ].join('\n');

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✏️ Телефон', 'prof_edit_phone'),
      Markup.button.callback('✏️ Адрес', 'prof_edit_address'),
      Markup.button.callback('✏️ Экстренный', 'prof_edit_emergency'),
    ],
    [Markup.button.callback('← Назад', 'prof_back')],
  ]);

  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

export const employeeProfileScene = new Scenes.BaseScene<BotContext>(EMPLOYEE_PROFILE_SCENE_ID);

employeeProfileScene.enter(showProfile);

employeeProfileScene.action('prof_edit_phone', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.profileWaitingFor = 'phone';
  await ctx.reply(
    '📱 Введите номер телефона или поделитесь контактом:',
    Markup.keyboard([
      [Markup.button.contactRequest('📱 Поделиться номером')],
      ['Отмена'],
    ]).resize().oneTime(),
  );
});

employeeProfileScene.action('prof_edit_address', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.profileWaitingFor = 'address';
  await ctx.reply(
    '🏠 Введите адрес:',
    Markup.keyboard([['Отмена']]).resize().oneTime(),
  );
});

employeeProfileScene.action('prof_edit_emergency', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.profileWaitingFor = 'emergency';
  await ctx.reply(
    '🆘 Введите имя и номер экстренного контакта:',
    Markup.keyboard([['Отмена']]).resize().oneTime(),
  );
});

employeeProfileScene.action('prof_back', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.profileWaitingFor = undefined;
  return ctx.scene.enter(EMPLOYEE_MENU_SCENE_ID);
});

employeeProfileScene.on('message', async (ctx) => {
  const waiting = ctx.scene.session.profileWaitingFor;
  if (!waiting || !ctx.employee) return;

  if ('contact' in ctx.message && ctx.message.contact && waiting === 'phone') {
    const phone = ctx.message.contact.phone_number;
    await employeeService.updateProfile(ctx.employee.id, { phone });
    ctx.scene.session.profileWaitingFor = undefined;
    await ctx.reply('✅ Телефон сохранён.', Markup.removeKeyboard());
    return showProfile(ctx);
  }

  if ('text' in ctx.message) {
    const text = ctx.message.text.trim();
    if (text === 'Отмена') {
      ctx.scene.session.profileWaitingFor = undefined;
      await ctx.reply('Отменено.', Markup.removeKeyboard());
      return showProfile(ctx);
    }

    if (waiting === 'phone') {
      await employeeService.updateProfile(ctx.employee.id, { phone: text });
      ctx.scene.session.profileWaitingFor = undefined;
      await ctx.reply('✅ Телефон сохранён.', Markup.removeKeyboard());
      return showProfile(ctx);
    }
    if (waiting === 'address') {
      await employeeService.updateProfile(ctx.employee.id, { address: text });
      ctx.scene.session.profileWaitingFor = undefined;
      await ctx.reply('✅ Адрес сохранён.', Markup.removeKeyboard());
      return showProfile(ctx);
    }
    if (waiting === 'emergency') {
      await employeeService.updateProfile(ctx.employee.id, { emergencyPhone: text });
      ctx.scene.session.profileWaitingFor = undefined;
      await ctx.reply('✅ Экстренный контакт сохранён.', Markup.removeKeyboard());
      return showProfile(ctx);
    }
  }
});
