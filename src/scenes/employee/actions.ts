import { BotContext } from '../../types/context';
import { timeEntryService } from '../../services/timeEntry.service';
import { buildEmployeeKeyboard } from '../../keyboards/employee.keyboard';
import { formatDate, formatTime } from '../../utils/time';
import { TimeEntryType } from '@prisma/client';
import { Telegraf } from 'telegraf';
import { HISTORY_SCENE_ID } from './history.scene';

const ACTION_MESSAGES: Record<string, string> = {
  work_start: '🟢 Рабочий день начат',
  lunch_start: '🍽 Ушёл на обед',
  lunch_end: '✅ Вернулся с обеда',
  personal_leave_start: '🚶 Отлучился',
  personal_leave_end: '🔙 Вернулся',
  work_end: '🔴 Рабочий день завершён',
  sick_leave: '🤒 Больничный отмечен',
};

const ACTION_TYPE_MAP: Record<string, TimeEntryType> = {
  work_start: TimeEntryType.WORK_START,
  lunch_start: TimeEntryType.LUNCH_START,
  lunch_end: TimeEntryType.LUNCH_END,
  personal_leave_start: TimeEntryType.PERSONAL_LEAVE_START,
  personal_leave_end: TimeEntryType.PERSONAL_LEAVE_END,
  work_end: TimeEntryType.WORK_END,
  sick_leave: TimeEntryType.SICK_LEAVE,
};

export function registerEmployeeActions(bot: Telegraf<BotContext>) {
  const actions = Object.keys(ACTION_TYPE_MAP);

  for (const action of actions) {
    bot.action(action, async (ctx) => {
      await ctx.answerCbQuery();

      if (!ctx.employee) {
        await ctx.reply('Вы не авторизованы. Введите /start.');
        return;
      }

      const type = ACTION_TYPE_MAP[action];

      try {
        await timeEntryService.addEntry(ctx.employee.id, type);
        const now = new Date();
        await ctx.editMessageText(
          `${ACTION_MESSAGES[action]} в ${formatTime(now)}`,
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: `${ACTION_MESSAGES[action]} в ${formatTime(now)}`, callback_data: 'noop' }]],
            },
          },
        );
      } catch {
        await ctx.answerCbQuery('Действие недоступно', { show_alert: true });
        return;
      }

      // Re-render menu
      const newActions = await timeEntryService.getAvailableActions(ctx.employee.id);
      const keyboard = buildEmployeeKeyboard(newActions);
      const today = formatDate(new Date());

      let statusText: string;
      if (newActions.length === 0) {
        const entries = await timeEntryService.getTodayEntries(ctx.employee.id);
        const hasSick = entries.some((e) => e.type === 'SICK_LEAVE');
        statusText = hasSick ? 'Больничный ✓' : 'День завершён ✓';
      } else {
        statusText = 'Выберите действие:';
      }

      const text = `📋 *${today}*\n${ctx.employee.firstName}, ${statusText}`;
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    });
  }

  bot.action('my_schedule', async (ctx) => {
    await ctx.answerCbQuery();
    try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
    return ctx.scene.enter(HISTORY_SCENE_ID);
  });
}
