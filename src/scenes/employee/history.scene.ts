import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { formatDate, formatTime, nowUTC7, todayDateUTC7 } from '../../utils/time';
import { TimeEntryType } from '@prisma/client';

export const HISTORY_SCENE_ID = 'employee_history';

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

const TYPE_LABELS: Record<TimeEntryType, string> = {
  WORK_START: 'Начало дня',
  WORK_END: 'Конец дня',
  LUNCH_START: 'Обед',
  LUNCH_END: 'Конец обеда',
  PERSONAL_LEAVE_START: 'Отлучка',
  PERSONAL_LEAVE_END: 'Возврат',
  SICK_LEAVE: 'Больничный',
};

function parseDate(str: string): Date | null {
  const match = str.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const [, day, month, yy] = match;
  const date = new Date(`20${yy}-${month}-${day}T00:00:00.000Z`);
  if (isNaN(date.getTime())) return null;
  return date;
}

function calcDayHours(entries: Array<{ type: TimeEntryType; timestamp: Date }>): string | null {
  const get = (type: TimeEntryType) => entries.find((e) => e.type === type)?.timestamp;
  const workStart = get(TimeEntryType.WORK_START);
  const workEnd = get(TimeEntryType.WORK_END);
  if (!workStart || !workEnd) return null;

  let totalMs = workEnd.getTime() - workStart.getTime();

  const lunchStart = get(TimeEntryType.LUNCH_START);
  const lunchEnd = get(TimeEntryType.LUNCH_END);
  if (lunchStart && lunchEnd) {
    totalMs -= lunchEnd.getTime() - lunchStart.getTime();
  }

  const pleStarts = entries
    .filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START)
    .map((e) => e.timestamp);
  const pleEnds = entries
    .filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END)
    .map((e) => e.timestamp);
  const pairs = Math.min(pleStarts.length, pleEnds.length);
  for (let i = 0; i < pairs; i++) {
    totalMs -= pleEnds[i].getTime() - pleStarts[i].getTime();
  }

  if (totalMs <= 0) return null;
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  return minutes > 0 ? `${hours}ч ${minutes}м` : `${hours}ч`;
}

async function buildHistoryPages(employeeId: number, from: Date, to: Date): Promise<string[]> {
  const entries = await prisma.timeEntry.findMany({
    where: { employeeId, date: { gte: from, lte: to } },
    orderBy: [{ date: 'asc' }, { timestamp: 'asc' }],
  });

  if (entries.length === 0) {
    return ['Нет записей за выбранный период.'];
  }

  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = entry.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(entry);
  }

  const dayBlocks: string[] = [];
  for (const [dateKey, dayEntries] of byDate) {
    const dateObj = new Date(`${dateKey}T00:00:00.000Z`);
    const dayName = DAY_NAMES[dateObj.getUTCDay()];
    const lines: string[] = [`📅 *${formatDate(dateObj)} (${dayName})*`];

    if (dayEntries.some((e) => e.type === TimeEntryType.SICK_LEAVE)) {
      lines.push('  🏥 Больничный');
    } else {
      for (const entry of dayEntries) {
        lines.push(`  ${formatTime(entry.timestamp)} — ${TYPE_LABELS[entry.type]}`);
      }
      const hoursStr = calcDayHours(dayEntries);
      if (hoursStr) lines.push(`  _Итого: ${hoursStr}_`);
    }

    dayBlocks.push(lines.join('\n'));
  }

  // Paginate: split day blocks into pages of max ~3800 chars
  const pages: string[] = [];
  let current = '';
  for (const block of dayBlocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > 3800 && current) {
      pages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) pages.push(current);

  return pages;
}

async function showHistory(ctx: BotContext, from: Date, to: Date): Promise<void> {
  if (!ctx.employee) return;
  const pages = await buildHistoryPages(ctx.employee.id, from, to);
  for (const page of pages) {
    await ctx.reply(page, { parse_mode: 'Markdown' });
  }
}

const PERIOD_KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.callback('Сегодня', 'hist_today'),
    Markup.button.callback('Эта неделя', 'hist_week'),
  ],
  [
    Markup.button.callback('Этот месяц', 'hist_month'),
    Markup.button.callback('Ввести даты', 'hist_custom'),
  ],
  [Markup.button.callback('📋 Меню', 'hist_back')],
]);

export const historyScene = new Scenes.WizardScene<BotContext>(
  HISTORY_SCENE_ID,

  // Step 0: show period selector
  async (ctx) => {
    await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
  },

  // Step 1: ask for start date (custom flow)
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите дату начала в формате ДД.ММ.ГГ:');
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату начала в формате ДД.ММ.ГГ:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'hist_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
    await ctx.reply(
      'Введите дату окончания в формате ДД.ММ.ГГ:',
      Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'hist_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
    );
    return ctx.wizard.next();
  },

  // Step 2: ask for end date, then show
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите дату окончания в формате ДД.ММ.ГГ:');
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату окончания в формате ДД.ММ.ГГ:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'hist_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    if (!ctx.employee || !ctx.scene.session.selectedPeriodFrom) {
      await ctx.reply('Ошибка. Начните заново.');
      return ctx.scene.leave();
    }
    const from = new Date(`${ctx.scene.session.selectedPeriodFrom}T00:00:00.000Z`);
    const to = date;
    if (from > to) {
      await ctx.reply(
        'Дата начала не может быть позже даты окончания. Введите дату окончания:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'hist_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    await showHistory(ctx, from, to);
    ctx.wizard.selectStep(0);
    await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
  }
);

historyScene.action('hist_today', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  if (!ctx.employee) return ctx.scene.leave();
  const today = todayDateUTC7();
  await showHistory(ctx, today, today);
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

historyScene.action('hist_week', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  if (!ctx.employee) return ctx.scene.leave();
  const now = nowUTC7();
  const dayOfWeek = now.getUTCDay();
  const diff = (dayOfWeek + 6) % 7;
  const mondayMs =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    diff * 86_400_000;
  const from = new Date(mondayMs);
  const to = todayDateUTC7();
  await showHistory(ctx, from, to);
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

historyScene.action('hist_month', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  if (!ctx.employee) return ctx.scene.leave();
  const now = nowUTC7();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = todayDateUTC7();
  await showHistory(ctx, from, to);
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

historyScene.action('hist_custom', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    'Введите дату начала в формате ДД.ММ.ГГ:',
    Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'hist_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
  );
  return ctx.wizard.next();
});

historyScene.action('hist_cancel_custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedPeriodFrom = undefined;
  ctx.wizard.selectStep(0);
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

historyScene.action('hist_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter('employee_menu');
});
