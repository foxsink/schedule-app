import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { reportService, EmployeeStatus } from '../../services/report.service';
import { formatDate, todayDateUTC7 } from '../../utils/time';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';

export const ADMIN_SCHEDULE_SCENE_ID = 'admin_schedule';

function statusLine(status: EmployeeStatus): string {
  switch (status.kind) {
    case 'not_started':     return '🔴 не начинал';
    case 'working':         return `🟢 работает (с ${status.since})`;
    case 'lunch':           return `🍽 обед (с ${status.since})`;
    case 'personal_leave':  return `🚶 отлучился (с ${status.since})`;
    case 'done':            return `✅ завершил (${status.start}–${status.end}, ${status.hours})`;
    case 'sick':            return '🏥 больничный';
  }
}

export const adminScheduleScene = new Scenes.BaseScene<BotContext>(ADMIN_SCHEDULE_SCENE_ID);

adminScheduleScene.enter(async (ctx) => {
  if (!ctx.employee || (ctx.employee.role !== 'ADMIN' && ctx.employee.role !== 'SUPER_ADMIN')) {
    await ctx.reply('Нет доступа.');
    return ctx.scene.leave();
  }

  const schedule = await reportService.getDaySchedule();
  const today = todayDateUTC7();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const lines = [`📋 *Расписание*`, ''];
  if (schedule.length === 0) {
    lines.push('Нет активных сотрудников.');
  } else {
    // Group by shiftDate
    const byDay = new Map<number, typeof schedule>();
    for (const entry of schedule) {
      const key = entry.shiftDate.getTime();
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(entry);
    }

    // Sort days descending (today first, then yesterday)
    const sortedDays = Array.from(byDay.entries()).sort((a, b) => b[0] - a[0]);

    for (const [ts, entries] of sortedDays) {
      const dayDate = new Date(ts);
      const isToday = dayDate.getTime() === today.getTime();
      const isYesterday = dayDate.getTime() === yesterday.getTime();
      const label = isToday ? `Сегодня (${formatDate(dayDate)})` :
                   isYesterday ? `Вчера (${formatDate(dayDate)})` :
                   formatDate(dayDate);
      lines.push(`📅 *${label}:*`);
      for (const entry of entries) {
        lines.push(`${statusLine(entry.status)} — ${entry.lastName} ${entry.firstName}`);
      }
      lines.push('');
    }
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Обновить', 'sched_refresh')],
    [Markup.button.callback('« Назад', 'sched_back')],
  ]);

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', ...keyboard });
});

adminScheduleScene.action('sched_refresh', async (ctx) => {
  await ctx.answerCbQuery('Обновлено');
  return ctx.scene.reenter();
});

adminScheduleScene.action('sched_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
