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

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(config.botToken);

  const stage = new Scenes.Stage<BotContext>([
    startScene,
    employeeMenuScene,
    historyScene,
    adminMenuScene,
    adminScheduleScene,
    adminReportWizard,
  ]);

  bot.use(sessionMiddleware);
  bot.use(authMiddleware);
  bot.use(stage.middleware());

  registerEmployeeActions(bot);

  bot.command('start', (ctx) => ctx.scene.enter('start'));
  bot.command('menu', (ctx) => ctx.scene.enter(EMPLOYEE_MENU_SCENE_ID));
  bot.command('admin', (ctx) => ctx.scene.enter(ADMIN_MENU_SCENE_ID));

  return bot;
}
