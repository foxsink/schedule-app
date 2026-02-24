import { Scenes } from 'telegraf';
import { BotContext } from '../../types/context';
import { timeEntryService } from '../../services/timeEntry.service';
import { buildEmployeeKeyboard } from '../../keyboards/employee.keyboard';
import { formatDate, nowUTC7 } from '../../utils/time';

export const EMPLOYEE_MENU_SCENE_ID = 'employee_menu';

async function showMenu(ctx: BotContext) {
  if (!ctx.employee) {
    await ctx.reply('Вы не авторизованы. Введите /start.');
    return;
  }

  const actions = await timeEntryService.getAvailableActions(ctx.employee.id);
  const keyboard = buildEmployeeKeyboard(actions);
  const today = formatDate(nowUTC7());

  let statusText: string;
  if (actions.length === 0) {
    const entries = await timeEntryService.getTodayEntries(ctx.employee.id);
    const hasSick = entries.some((e) => e.type === 'SICK_LEAVE');
    statusText = hasSick ? 'Больничный ✓' : 'День завершён ✓';
  } else {
    statusText = 'Выберите действие:';
  }

  const text = `📋 *${today}*\n${ctx.employee.firstName}, ${statusText}`;

  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

export const employeeMenuScene = new Scenes.BaseScene<BotContext>(EMPLOYEE_MENU_SCENE_ID);

employeeMenuScene.enter(showMenu);
