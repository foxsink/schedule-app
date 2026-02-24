import { Scenes } from 'telegraf';
import { BotContext } from '../../types/context';
import { timeEntryService } from '../../services/timeEntry.service';
import { buildEmployeeKeyboard } from '../../keyboards/employee.keyboard';
import { formatDate, nowUTC7 } from '../../utils/time';
import { ADMIN_MENU_SCENE_ID } from '../admin/menu.scene';

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

  if (ctx.employee.role === 'ADMIN' || ctx.employee.role === 'SUPER_ADMIN') {
    keyboard.reply_markup.inline_keyboard.push([
      { text: '🔧 Режим администратора', callback_data: 'switch_to_admin' },
    ]);
  }

  await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

export const employeeMenuScene = new Scenes.BaseScene<BotContext>(EMPLOYEE_MENU_SCENE_ID);

employeeMenuScene.enter(showMenu);

employeeMenuScene.action('switch_to_admin', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
