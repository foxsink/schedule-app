import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';

export const ADMIN_MENU_SCENE_ID = 'admin_menu';

export const adminMenuScene = new Scenes.BaseScene<BotContext>(ADMIN_MENU_SCENE_ID);

adminMenuScene.enter(async (ctx) => {
  if (!ctx.employee) {
    await ctx.reply('Нет доступа.');
    return ctx.scene.leave();
  }

  const isSuperAdmin = ctx.employee.role === 'SUPER_ADMIN';

  const rows = [
    [Markup.button.callback('Расписание', 'admin_schedule')],
    [Markup.button.callback('Отчёты', 'admin_reports')],
    [Markup.button.callback('Редактирование записей', 'admin_edit')],
    [Markup.button.callback('Сотрудники', 'admin_employees')],
    [Markup.button.callback('Зарплаты', 'admin_salaries')],
    [Markup.button.callback('Экспорт', 'admin_export')],
    [Markup.button.callback('👤 Режим сотрудника', 'admin_to_employee')],
  ];
  if (isSuperAdmin) {
    rows.push([Markup.button.callback('Аудит', 'admin_audit')]);
  }

  await ctx.reply(`Меню администратора, ${ctx.employee.firstName}`, Markup.inlineKeyboard(rows));
});

adminMenuScene.action('admin_schedule', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_schedule');
});

adminMenuScene.action('admin_reports', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_report');
});

adminMenuScene.action('admin_edit', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_edit');
});

adminMenuScene.action('admin_employees', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_manage');
});

adminMenuScene.action('admin_salaries', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_salary');
});

adminMenuScene.action('admin_export', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_export');
});

adminMenuScene.action('admin_audit', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('admin_audit');
});

adminMenuScene.action('admin_to_employee', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('employee_menu');
});
