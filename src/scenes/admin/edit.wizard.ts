import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { timeEntryService } from '../../services/timeEntry.service';
import { parseTime, parseDate } from '../../utils/validation';
import { formatDate, formatTime, localInputToUtc, nowUTC7, todayDateUTC7 } from '../../utils/time';
import { TimeEntryType } from '@prisma/client';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';

export const ADMIN_EDIT_SCENE_ID = 'admin_edit';

const TYPE_LABELS: Record<TimeEntryType, string> = {
  WORK_START: 'Начало дня',
  WORK_END: 'Конец дня',
  LUNCH_START: 'Обед',
  LUNCH_END: 'Конец обеда',
  PERSONAL_LEAVE_START: 'Отлучка',
  PERSONAL_LEAVE_END: 'Возврат',
  SICK_LEAVE: 'Больничный',
};

async function showEmployeeList(ctx: BotContext): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    ...employees.map((e) => [Markup.button.callback(`${e.lastName} ${e.firstName}`, `edit_emp_${e.id}`)]),
    [Markup.button.callback('« Назад', 'edit_emp_back')],
  ];
  await ctx.reply('Выберите сотрудника:', Markup.inlineKeyboard(rows));
}

async function showDateMenu(ctx: BotContext): Promise<void> {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📅 Сегодня', 'edit_date_today'),
      Markup.button.callback('📅 Вчера', 'edit_date_yesterday'),
      Markup.button.callback('📅 Позавчера', 'edit_date_2days'),
    ],
    [Markup.button.callback('« Назад', 'edit_emp_back')],
  ]);
  await ctx.reply('Введите дату (ДД.ММ.ГГ) или выберите:', keyboard);
}

async function showEntriesList(ctx: BotContext, employeeId: number, date: Date): Promise<void> {
  const entries = await timeEntryService.getEntriesByDate(employeeId, date);
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  const dateStr = formatDate(date);
  const name = employee ? `${employee.lastName} ${employee.firstName}` : `#${employeeId}`;

  const lines = [`✏️ *${name} — ${dateStr}*`, ''];
  if (entries.length === 0) {
    lines.push('Нет записей за этот день.');
  } else {
    entries.forEach((e, i) => {
      lines.push(`${i + 1}. ${formatTime(e.timestamp)} — ${TYPE_LABELS[e.type]}`);
    });
  }

  const entryButtons = entries.map((e) => [
    Markup.button.callback(`✏️ ${formatTime(e.timestamp)} ${TYPE_LABELS[e.type]}`, `edit_entry_${e.id}`),
  ]);

  const keyboard = Markup.inlineKeyboard([
    ...entryButtons,
    [Markup.button.callback('➕ Добавить запись', 'edit_add')],
    [Markup.button.callback('« Назад', 'edit_back_to_emp'), Markup.button.callback('📋 Меню', 'go_menu')],
  ]);

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', ...keyboard });
}

async function showEntryActions(ctx: BotContext, entryId: number): Promise<void> {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    await ctx.reply('Запись не найдена.');
    return;
  }
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('⏱ Изменить время', `edit_change_${entryId}`)],
    [Markup.button.callback('🗑 Удалить', `edit_delete_${entryId}`)],
    [Markup.button.callback('« Назад', 'edit_back_to_list'), Markup.button.callback('📋 Меню', 'go_menu')],
  ]);
  await ctx.reply(
    `Запись: *${TYPE_LABELS[entry.type]}* в ${formatTime(entry.timestamp)}\nВыберите действие:`,
    { parse_mode: 'Markdown', ...keyboard }
  );
}

async function showAddTypeMenu(
  ctx: BotContext,
  entries: Array<{ type: TimeEntryType }>,
  prevDayEntries: Array<{ type: TimeEntryType }> = [],
): Promise<void> {
  const count = (t: TimeEntryType) => entries.filter((e) => e.type === t).length;
  const prevCount = (t: TimeEntryType) => prevDayEntries.filter((e) => e.type === t).length;
  const totalCount = (t: TimeEntryType) => count(t) + prevCount(t);
  const existingTypes = new Set(entries.map((e) => e.type));
  const prevTypes = new Set(prevDayEntries.map((e) => e.type));

  // If today already has WORK_END without WORK_START, the cross-midnight shift is already closed
  const todayHasCrossMidnightEnd =
    existingTypes.has(TimeEntryType.WORK_END) && !existingTypes.has(TimeEntryType.WORK_START);
  const prevDayShiftOpen =
    prevTypes.has(TimeEntryType.WORK_START) &&
    !prevTypes.has(TimeEntryType.WORK_END) &&
    !todayHasCrossMidnightEnd;

  const SINGLE_USE: TimeEntryType[] = [
    TimeEntryType.WORK_START, TimeEntryType.WORK_END,
    TimeEntryType.LUNCH_START, TimeEntryType.LUNCH_END,
    TimeEntryType.SICK_LEAVE,
  ];
  const onSickLeave = existingTypes.has(TimeEntryType.SICK_LEAVE);

  // Combined lunch/leave state (today + prev day for cross-midnight shifts)
  const onLunch = totalCount(TimeEntryType.LUNCH_START) > totalCount(TimeEntryType.LUNCH_END);
  const onLeave =
    totalCount(TimeEntryType.PERSONAL_LEAVE_START) > totalCount(TimeEntryType.PERSONAL_LEAVE_END);

  // Cross-midnight: treat as if shift has already started
  const effectiveWorkStarted = existingTypes.has(TimeEntryType.WORK_START) || prevDayShiftOpen;

  const rows = Object.entries(TYPE_LABELS).map(([type, label]) => {
    const t = type as TimeEntryType;
    const noWorkStart = !effectiveWorkStarted;
    // Cross-midnight: prev day's completed single-use types count as ✅ (except WORK_START/WORK_END)
    const alreadyDone =
      SINGLE_USE.includes(t) &&
      (existingTypes.has(t) ||
        (prevDayShiftOpen &&
          prevTypes.has(t) &&
          t !== TimeEntryType.WORK_START &&
          t !== TimeEntryType.WORK_END));
    const requiresWorkStart = noWorkStart && t !== TimeEntryType.WORK_START && t !== TimeEntryType.SICK_LEAVE;
    // Block work_start if previous day's shift is still open
    const workStartCrossMidnight =
      prevDayShiftOpen && t === TimeEntryType.WORK_START && !existingTypes.has(TimeEntryType.WORK_START);
    const sickLeaveBlocked = t === TimeEntryType.SICK_LEAVE && effectiveWorkStarted;
    // Use combined onLunch/onLeave for accurate cross-midnight blocking
    const lunchEndBlocked = t === TimeEntryType.LUNCH_END && !onLunch;
    const returnBlocked = t === TimeEntryType.PERSONAL_LEAVE_END && !onLeave;
    const onLunchBlocked = onLunch && t !== TimeEntryType.LUNCH_END;
    const onLeaveBlocked = onLeave && t !== TimeEntryType.PERSONAL_LEAVE_END;
    const blocked = onSickLeave || onLunchBlocked || onLeaveBlocked || requiresWorkStart || workStartCrossMidnight || sickLeaveBlocked || lunchEndBlocked || returnBlocked;

    const icon = alreadyDone ? '✅' : blocked ? '❌' : null;
    return [
      alreadyDone || blocked
        ? Markup.button.callback(`${icon} ${label}`, 'noop')
        : Markup.button.callback(label, `edit_add_type_${type}`),
    ];
  });
  const keyboard = Markup.inlineKeyboard([
    ...rows,
    [Markup.button.callback('« Назад', 'edit_back_to_list'), Markup.button.callback('📋 Меню', 'go_menu')],
  ]);
  await ctx.reply('Выберите тип записи:', keyboard);
}

export const adminEditWizard = new Scenes.WizardScene<BotContext>(
  ADMIN_EDIT_SCENE_ID,

  // Step 0: text while at employee selection
  async (ctx) => {
    await ctx.reply('Выберите сотрудника из списка.');
  },

  // Step 1: date text input
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await showDateMenu(ctx);
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату в формате ДД.ММ.ГГ:',
        Markup.inlineKeyboard([[Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    const empId = ctx.scene.session.selectedEmployeeId;
    if (!empId) { return ctx.scene.leave(); }
    ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
    ctx.wizard.next();
    await showEntriesList(ctx, empId, date);
  },

  // Step 2: at entries list — text for new time when editing
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите время в формате ЧЧ:ММ:');
      return;
    }
    const parsed = parseTime(ctx.message.text);
    if (!parsed) {
      await ctx.reply(
        'Неверный формат. Введите время в формате ЧЧ:ММ (например, 09:30):',
        Markup.inlineKeyboard([[Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }

    const editorId = ctx.employee?.id;
    if (!editorId) return ctx.scene.leave();

    // selectedDate stores "eid:N" for edit, "add:TYPE" for add
    const meta = ctx.scene.session.selectedDate;
    const dateStr = ctx.scene.session.selectedPeriodFrom;
    const empId = ctx.scene.session.selectedEmployeeId;
    if (!dateStr || !empId || !meta) return ctx.scene.leave();

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const timestamp = localInputToUtc(dateStr, parsed.hours, parsed.minutes);

    if (meta.startsWith('eid:')) {
      const entryId = parseInt(meta.slice(4), 10);
      await timeEntryService.updateEntry(editorId, entryId, timestamp);
      await ctx.reply(`✅ Время обновлено на ${formatTime(timestamp)}`);
    } else if (meta.startsWith('add:')) {
      const type = meta.slice(4) as TimeEntryType;
      await timeEntryService.createEntryManual(editorId, empId, type, timestamp, date);
      await ctx.reply(`✅ Запись добавлена: ${TYPE_LABELS[type]} в ${formatTime(timestamp)}`);
    }

    ctx.scene.session.selectedDate = undefined;
    await showEntriesList(ctx, empId, date);
  }
);

adminEditWizard.enter(showEmployeeList);

// Employee selection
adminEditWizard.action(/^edit_emp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedEmployeeId = parseInt(ctx.match[1], 10);
  ctx.wizard.next();
  await showDateMenu(ctx);
});

adminEditWizard.action('edit_emp_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

// Date selection
adminEditWizard.action('edit_date_today', async (ctx) => {
  await ctx.answerCbQuery();
  const empId = ctx.scene.session.selectedEmployeeId;
  if (!empId) return ctx.scene.leave();
  const date = todayDateUTC7();
  ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
  ctx.wizard.next();
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_date_yesterday', async (ctx) => {
  await ctx.answerCbQuery();
  const empId = ctx.scene.session.selectedEmployeeId;
  if (!empId) return ctx.scene.leave();
  const date = new Date(todayDateUTC7().getTime() - 86_400_000);
  ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
  ctx.wizard.next();
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_date_2days', async (ctx) => {
  await ctx.answerCbQuery();
  const empId = ctx.scene.session.selectedEmployeeId;
  if (!empId) return ctx.scene.leave();
  const date = new Date(todayDateUTC7().getTime() - 2 * 86_400_000);
  ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
  ctx.wizard.next();
  await showEntriesList(ctx, empId, date);
});

// Entry selection
adminEditWizard.action(/^edit_entry_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showEntryActions(ctx, parseInt(ctx.match[1], 10));
});

// Change time
adminEditWizard.action(/^edit_change_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const entryId = parseInt(ctx.match[1], 10);
  ctx.scene.session.selectedDate = `eid:${entryId}`;
  // ensure cursor is at step 2
  while (ctx.wizard.cursor < 2) ctx.wizard.next();
  await ctx.reply(
    'Введите новое время в формате ЧЧ:ММ или выберите:',
    Markup.inlineKeyboard([
      [Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')],
      [Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')],
    ]),
  );
});

// Delete entry
adminEditWizard.action(/^edit_delete_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const editorId = ctx.employee?.id;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!editorId || !empId || !dateStr) return ctx.scene.leave();
  const entryId = parseInt(ctx.match[1], 10);
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    await ctx.reply('Запись не найдена.');
    await showEntriesList(ctx, empId, date);
    return;
  }

  const allEntries = await timeEntryService.getEntriesByDate(empId, date);

  if (entry.type === TimeEntryType.WORK_START) {
    // Delete all entries for the day
    for (const e of allEntries) {
      await timeEntryService.deleteEntry(editorId, e.id);
    }
    await ctx.reply('🗑 Начало дня удалено — все записи за этот день удалены.');
  } else if (entry.type === TimeEntryType.LUNCH_START) {
    // Delete lunch end too if present
    const lunchEnd = allEntries.find((e) => e.type === TimeEntryType.LUNCH_END);
    await timeEntryService.deleteEntry(editorId, entryId);
    if (lunchEnd) {
      await timeEntryService.deleteEntry(editorId, lunchEnd.id);
      await ctx.reply('🗑 Обед и конец обеда удалены.');
    } else {
      await ctx.reply('🗑 Запись удалена.');
    }
  } else if (entry.type === TimeEntryType.PERSONAL_LEAVE_START) {
    // Find corresponding PERSONAL_LEAVE_END by index
    const leaveStarts = allEntries
      .filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const leaveEnds = allEntries
      .filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const idx = leaveStarts.findIndex((e) => e.id === entryId);
    const correspondingEnd = idx >= 0 && idx < leaveEnds.length ? leaveEnds[idx] : null;
    await timeEntryService.deleteEntry(editorId, entryId);
    if (correspondingEnd) {
      await timeEntryService.deleteEntry(editorId, correspondingEnd.id);
      await ctx.reply('🗑 Отлучка и возврат удалены.');
    } else {
      await ctx.reply('🗑 Запись удалена.');
    }
  } else {
    await timeEntryService.deleteEntry(editorId, entryId);
    await ctx.reply('🗑 Запись удалена.');
  }

  await showEntriesList(ctx, empId, date);
});

// Add entry — show type menu
adminEditWizard.action('edit_add', async (ctx) => {
  await ctx.answerCbQuery();
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!empId || !dateStr) return;
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const entries = await timeEntryService.getEntriesByDate(empId, date);

  // Fetch previous day entries for cross-midnight lunch/leave state detection
  const prevDate = new Date(date.getTime() - 86_400_000);
  const prevEntries = await prisma.timeEntry.findMany({ where: { employeeId: empId, date: prevDate } });

  await showAddTypeMenu(ctx, entries, prevEntries);
});

// Add entry — type selected
adminEditWizard.action(/^edit_add_type_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = ctx.match[1] as TimeEntryType;
  const editorId = ctx.employee?.id;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!editorId || !empId || !dateStr) return ctx.scene.leave();

  // Sick leave has no time — record immediately at start of day
  if (type === TimeEntryType.SICK_LEAVE) {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    await timeEntryService.createEntryManual(editorId, empId, type, date, date);
    await ctx.reply(`✅ Запись добавлена: ${TYPE_LABELS[type]}`);
    await showEntriesList(ctx, empId, date);
    return;
  }

  // Lunch end — offer quick options based on lunch start time
  if (type === TimeEntryType.LUNCH_END) {
    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const entries = await timeEntryService.getEntriesByDate(empId, date);
    // entries already fetched, reused below
    const lunchStart = entries.find((e) => e.type === TimeEntryType.LUNCH_START);
    if (lunchStart) {
      const t30 = new Date(lunchStart.timestamp.getTime() + 30 * 60_000);
      const t60 = new Date(lunchStart.timestamp.getTime() + 60 * 60_000);
      ctx.scene.session.selectedDate = `add:${type}`;
      while (ctx.wizard.cursor < 2) ctx.wizard.next();
      await ctx.reply(
        `Введите время конца обеда или выберите:`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(`+30 мин (${formatTime(t30)})`, 'edit_lunch_end_30'),
            Markup.button.callback(`+1 час (${formatTime(t60)})`, 'edit_lunch_end_60'),
          ],
          [Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')],
          [Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')],
        ]),
      );
      return;
    }
  }

  ctx.scene.session.selectedDate = `add:${type}`;
  while (ctx.wizard.cursor < 2) ctx.wizard.next();
  await ctx.reply(
    `Введите время для "${TYPE_LABELS[type]}" в формате ЧЧ:ММ или выберите:`,
    Markup.inlineKeyboard([
      [Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')],
      [Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')],
    ]),
  );
});

adminEditWizard.action(/^edit_lunch_end_(30|60)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const editorId = ctx.employee?.id;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!editorId || !empId || !dateStr) return ctx.scene.leave();
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const entries = await timeEntryService.getEntriesByDate(empId, date);
  const lunchStart = entries.find((e) => e.type === TimeEntryType.LUNCH_START);
  if (!lunchStart) return ctx.scene.leave();
  const offsetMin = ctx.match[1] === '30' ? 30 : 60;
  const timestamp = new Date(lunchStart.timestamp.getTime() + offsetMin * 60_000);
  await timeEntryService.createEntryManual(editorId, empId, TimeEntryType.LUNCH_END, timestamp, date);
  ctx.scene.session.selectedDate = undefined;
  ctx.wizard.selectStep(2);
  await ctx.reply(`✅ Запись добавлена: ${TYPE_LABELS[TimeEntryType.LUNCH_END]} в ${formatTime(timestamp)}`);
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_time_now', async (ctx) => {
  await ctx.answerCbQuery();
  const editorId = ctx.employee?.id;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  const meta = ctx.scene.session.selectedDate;
  if (!editorId || !empId || !dateStr || !meta) return ctx.scene.leave();

  const timestamp = new Date(); // actual UTC for storage
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  if (meta.startsWith('eid:')) {
    const entryId = parseInt(meta.slice(4), 10);
    await timeEntryService.updateEntry(editorId, entryId, timestamp);
    await ctx.reply(`✅ Время обновлено на ${formatTime(timestamp)}`);
  } else if (meta.startsWith('add:')) {
    const type = meta.slice(4) as TimeEntryType;
    await timeEntryService.createEntryManual(editorId, empId, type, timestamp, date);
    await ctx.reply(`✅ Запись добавлена: ${TYPE_LABELS[type]} в ${formatTime(timestamp)}`);
  }

  ctx.scene.session.selectedDate = undefined;
  ctx.wizard.selectStep(2);
  await showEntriesList(ctx, empId, date);
});

// Navigation
adminEditWizard.action('edit_back_to_list', async (ctx) => {
  await ctx.answerCbQuery();
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!empId || !dateStr) return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_cancel_input', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedDate = undefined;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!empId || !dateStr) return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  ctx.wizard.selectStep(2);
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_back_to_emp', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedPeriodFrom = undefined;
  // go back to step 1 (date entry)
  ctx.wizard.selectStep(1);
  await showDateMenu(ctx);
});
