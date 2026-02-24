import { Telegraf, Scenes } from 'telegraf';
import { config } from './config';
import { BotContext } from './types/context';
import { sessionMiddleware } from './middleware/session';
import { authMiddleware } from './middleware/auth';
import { startScene } from './scenes/start.scene';
import { employeeMenuScene, EMPLOYEE_MENU_SCENE_ID } from './scenes/employee/menu.scene';
import { historyScene } from './scenes/employee/history.scene';
import { registerEmployeeActions } from './scenes/employee/actions';
import { adminMenuScene, ADMIN_MENU_SCENE_ID } from './scenes/admin/menu.scene';
import { adminScheduleScene } from './scenes/admin/schedule.scene';
import { adminReportWizard } from './scenes/admin/report.wizard';
import { adminEditWizard } from './scenes/admin/edit.wizard';
import { adminManageScene } from './scenes/admin/manage.scene';
import { adminSalaryWizard } from './scenes/admin/salary.wizard';
import { adminExportWizard } from './scenes/admin/export.wizard';
import { adminAuditScene } from './scenes/admin/audit.scene';

function getMainMenuSceneId(role?: string): string {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
    ? ADMIN_MENU_SCENE_ID
    : EMPLOYEE_MENU_SCENE_ID;
}

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.botToken);

  const stage = new Scenes.Stage<BotContext>([
    startScene,
    employeeMenuScene,
    historyScene,
    adminMenuScene,
    adminScheduleScene,
    adminReportWizard,
    adminEditWizard,
    adminManageScene,
    adminSalaryWizard,
    adminExportWizard,
    adminAuditScene,
  ]);

  bot.use(sessionMiddleware);
  bot.use(authMiddleware);
  bot.use(stage.middleware());

  registerEmployeeActions(bot);

  // /start — auth or main menu
  bot.command('start', (ctx) => ctx.scene.enter('start'));

  // /menu — smart routing by role
  bot.command('menu', (ctx) => {
    const sceneId = getMainMenuSceneId(ctx.employee?.role);
    return ctx.scene.enter(sceneId);
  });

  // /cancel — leave current scene, return to main menu
  bot.command('cancel', async (ctx) => {
    await ctx.scene.leave();
    if (!ctx.employee) {
      return ctx.scene.enter('start');
    }
    const sceneId = getMainMenuSceneId(ctx.employee.role);
    return ctx.scene.enter(sceneId);
  });

  // /admin — switch to admin menu (admin/superadmin only)
  bot.command('admin', async (ctx) => {
    if (!ctx.employee || (ctx.employee.role !== 'ADMIN' && ctx.employee.role !== 'SUPER_ADMIN')) {
      return ctx.reply('Нет доступа.');
    }
    return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
  });

  // /employee — switch to employee menu (for admins who also track time)
  bot.command('employee', async (ctx) => {
    if (!ctx.employee) return ctx.scene.enter('start');
    return ctx.scene.enter(EMPLOYEE_MENU_SCENE_ID);
  });

  // Unhandled callback queries (stale buttons from old messages)
  bot.on('callback_query', async (ctx) => {
    try {
      await ctx.answerCbQuery('Кнопка устарела. Используйте /menu');
    } catch {}
  });

  // Unhandled text messages
  bot.on('message', async (ctx) => {
    if (!ctx.employee) {
      return ctx.reply('Используйте /start для авторизации.');
    }
    return ctx.reply('Используйте /menu для открытия меню или /cancel для отмены текущего действия.');
  });

  // Global error handler
  bot.catch((err, ctx) => {
    console.error(`Error for user ${ctx.from?.id}:`, err);
    ctx.reply('Произошла ошибка. Попробуйте ещё раз или используйте /cancel.').catch(() => {});
  });

  return bot;
}
