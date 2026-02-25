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

/** Collects all entries belonging to the same shift, sorted by timestamp.
 *  Handles cross-midnight shifts: if today has WORK_START but no WORK_END,
 *  also fetches next-day entries; if today has WORK_END but no WORK_START,
 *  also fetches prev-day entries. */
async function collectShiftEntries(
  employeeId: number,
  dateStr: string,
): Promise<Array<{ id: number; type: TimeEntryType; timestamp: Date }>> {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const dayEntries = await prisma.timeEntry.findMany({ where: { employeeId, date } });
  const types = new Set(dayEntries.map((e) => e.type));

  let extra: typeof dayEntries = [];
  if (types.has(TimeEntryType.WORK_START) && !types.has(TimeEntryType.WORK_END)) {
    // Cross-midnight: shift started today, may end tomorrow
    const nextDate = new Date(date.getTime() + 86_400_000);
    extra = await prisma.timeEntry.findMany({ where: { employeeId, date: nextDate } });
  } else if (types.has(TimeEntryType.WORK_END) && !types.has(TimeEntryType.WORK_START)) {
    // Viewing the end-day of a cross-midnight shift
    const prevDate = new Date(date.getTime() - 86_400_000);
    extra = await prisma.timeEntry.findMany({ where: { employeeId, date: prevDate } });
  }

  return [...dayEntries, ...extra].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

type ShiftEntry = { id: number; type: TimeEntryType; timestamp: Date };


/** Returns the list of entries that will be deleted when the given entry is deleted.
 *  - PERSONAL_LEAVE_START / LUNCH_START: only the entry itself + its closing counterpart (if present).
 *  - Everything else: the entry + all subsequent entries within the shift (cascade). */
function getEntriesToDelete(shiftEntries: ShiftEntry[], targetId: number): ShiftEntry[] {
  const idx = shiftEntries.findIndex((e) => e.id === targetId);
  if (idx < 0) return [];
  const target = shiftEntries[idx];

  const PAIRED_TYPES: TimeEntryType[] = [
    TimeEntryType.PERSONAL_LEAVE_START,
    TimeEntryType.PERSONAL_LEAVE_END,
    TimeEntryType.LUNCH_START,
    TimeEntryType.LUNCH_END,
    TimeEntryType.WORK_END,
  ];
  if (PAIRED_TYPES.includes(target.type)) {
    if (target.type === TimeEntryType.PERSONAL_LEAVE_START || target.type === TimeEntryType.LUNCH_START) {
      const endType =
        target.type === TimeEntryType.PERSONAL_LEAVE_START
          ? TimeEntryType.PERSONAL_LEAVE_END
          : TimeEntryType.LUNCH_END;
      const closingEntry = shiftEntries.slice(idx + 1).find((e) => e.type === endType);
      return closingEntry ? [target, closingEntry] : [target];
    }
    // PERSONAL_LEAVE_END / LUNCH_END / WORK_END — delete only this entry
    return [target];
  }

  // WORK_START: delete this shift only — from WORK_START up to and including its WORK_END.
  // If no WORK_END exists (ongoing shift), delete everything from here to end of shiftEntries.
  if (target.type === TimeEntryType.WORK_START) {
    const tail = shiftEntries.slice(idx);
    const workEndIdx = tail.findIndex((e) => e.type === TimeEntryType.WORK_END);
    return workEndIdx >= 0 ? tail.slice(0, workEndIdx + 1) : tail;
  }

  return shiftEntries.slice(idx);
}

/** Validates that a new entry of `type` at `timestamp` can be inserted into the shift.
 *  Returns an error string if invalid, null if OK.
 *  Only enforces strict rules for closed shifts (WORK_START + WORK_END both present). */
function validateEntryTime(
  type: TimeEntryType,
  timestamp: Date,
  shiftEntries: ShiftEntry[],
): string | null {
  const sorted = [...shiftEntries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const workStart = sorted.find((e) => e.type === TimeEntryType.WORK_START);
  const workEnd = sorted.find((e) => e.type === TimeEntryType.WORK_END);
  const T = timestamp.getTime();

  // LUNCH_START must always be before any open absence, regardless of shift state
  if (type === TimeEntryType.LUNCH_START) {
    const leaveStarts = sorted.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START);
    const leaveEnds = sorted.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END);
    if (leaveStarts.length > leaveEnds.length) {
      const unclosedLeave = leaveStarts[leaveEnds.length];
      if (T >= unclosedLeave.timestamp.getTime()) {
        return `Начало обеда должно быть раньше начала отлучки (${formatTime(unclosedLeave.timestamp)}).`;
      }
    }
  }

  // Only apply time-boundary validation for closed shifts
  if (!workStart || !workEnd) return null;
  const shiftStartMs = workStart.timestamp.getTime();
  const shiftEndMs = workEnd.timestamp.getTime();

  if (T <= shiftStartMs || T >= shiftEndMs) {
    return `Время должно быть строго внутри смены (${formatTime(workStart.timestamp)}–${formatTime(workEnd.timestamp)}).`;
  }

  if (sorted.some((e) => Math.abs(e.timestamp.getTime() - T) < 60_000)) {
    return 'Между событиями должна быть не менее минуты разницы.';
  }

  if (type === TimeEntryType.PERSONAL_LEAVE_START || type === TimeEntryType.LUNCH_START) {
    // Must not fall inside any existing paired interval (lunch or absence)
    const intervals: [TimeEntryType, TimeEntryType][] = [
      [TimeEntryType.LUNCH_START, TimeEntryType.LUNCH_END],
      [TimeEntryType.PERSONAL_LEAVE_START, TimeEntryType.PERSONAL_LEAVE_END],
    ];
    for (const [startType, endType] of intervals) {
      const starts = sorted.filter((e) => e.type === startType);
      const ends = sorted.filter((e) => e.type === endType);
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i].timestamp.getTime();
        const e = ends[i]?.timestamp.getTime() ?? shiftEndMs;
        if (T > s && T < e) {
          return `Время попадает внутрь «${TYPE_LABELS[startType]}».`;
        }
      }
    }
  }

  if (type === TimeEntryType.PERSONAL_LEAVE_END) {
    // Stack-based matching: correctly handles virtual entries injected before existing pairs.
    // Positional indexing (leaveStarts[leaveEnds.length]) fails when a new start is inserted
    // before an already-closed pair, causing it to identify the wrong "unclosed" entry.
    const leaveEvents = sorted.filter(
      (e) => e.type === TimeEntryType.PERSONAL_LEAVE_START || e.type === TimeEntryType.PERSONAL_LEAVE_END,
    );
    const openStack: ShiftEntry[] = [];
    for (const e of leaveEvents) {
      if (e.type === TimeEntryType.PERSONAL_LEAVE_START) {
        openStack.push(e);
      } else {
        openStack.pop();
      }
    }
    const unclosed = openStack[openStack.length - 1] ?? null;
    if (!unclosed) return 'Нет открытой отлучки.';
    if (T < unclosed.timestamp.getTime()) return 'Возврат должен быть не раньше начала отлучки.';
    const nextEvt = sorted.find((e) => e.timestamp.getTime() > unclosed.timestamp.getTime());
    if (nextEvt && T > nextEvt.timestamp.getTime()) {
      return `Время должно быть до следующего события (${formatTime(nextEvt.timestamp)} — ${TYPE_LABELS[nextEvt.type]}).`;
    }
  }

  if (type === TimeEntryType.LUNCH_END) {
    const lunchStart = sorted.find((e) => e.type === TimeEntryType.LUNCH_START);
    if (!lunchStart) return 'Нет начала обеда.';
    if (T < lunchStart.timestamp.getTime()) return 'Конец обеда должен быть не раньше начала.';
    const nextEvt = sorted.find((e) => e.timestamp.getTime() > lunchStart.timestamp.getTime());
    if (nextEvt && T > nextEvt.timestamp.getTime()) {
      return `Время должно быть до следующего события (${formatTime(nextEvt.timestamp)} — ${TYPE_LABELS[nextEvt.type]}).`;
    }
  }

  return null;
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

// Types handled atomically in the pair flow — not shown as separate "add" items
const PAIR_END_TYPES = new Set<TimeEntryType>([TimeEntryType.LUNCH_END, TimeEntryType.PERSONAL_LEAVE_END]);

/** Shows the prompt asking the admin to enter the END time of a lunch/absence pair. */
async function showPairEndPrompt(ctx: BotContext, endType: TimeEntryType, startTimestamp: Date, isToday: boolean): Promise<void> {
  const isLunch = endType === TimeEntryType.LUNCH_END;
  const label = isLunch ? 'обеда' : 'отлучки';
  const returnLabel = isLunch ? 'окончания' : 'возврата';
  const buttons: ReturnType<typeof Markup.button.callback>[][] = [];
  if (isLunch) {
    const t30 = new Date(startTimestamp.getTime() + 30 * 60_000);
    const t60 = new Date(startTimestamp.getTime() + 60 * 60_000);
    buttons.push([
      Markup.button.callback(`+30 мин (${formatTime(t30)})`, 'edit_lunch_end_30'),
      Markup.button.callback(`+1 час (${formatTime(t60)})`, 'edit_lunch_end_60'),
    ]);
  }
  if (isToday) {
    buttons.push([Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')]);
  }
  buttons.push([Markup.button.callback('✗ Отмена', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]);
  await ctx.reply(
    `Начало ${label} — *${formatTime(startTimestamp)}*. Введите время ${returnLabel} (ЧЧ:ММ):`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) },
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

  // If today already has WORK_END without WORK_START, the cross-midnight shift closed here
  const todayHasCrossMidnightEnd =
    existingTypes.has(TimeEntryType.WORK_END) && !existingTypes.has(TimeEntryType.WORK_START);
  const prevDayShiftOpen =
    prevTypes.has(TimeEntryType.WORK_START) &&
    !prevTypes.has(TimeEntryType.WORK_END) &&
    !todayHasCrossMidnightEnd;
  // Cross-midnight shift closed today: prev day had WORK_START, today has WORK_END
  const crossMidnightShiftWasActive =
    todayHasCrossMidnightEnd && prevTypes.has(TimeEntryType.WORK_START);

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

  // Treat shift as started if: today has WORK_START, or cross-midnight shift is still in progress.
  // crossMidnightShiftWasActive is NOT included — it means the shift was already closed today.
  const effectiveWorkStarted =
    existingTypes.has(TimeEntryType.WORK_START) || prevDayShiftOpen;

  const rows = Object.entries(TYPE_LABELS).filter(([type]) => !PAIR_END_TYPES.has(type as TimeEntryType)).map(([type, label]) => {
    const t = type as TimeEntryType;
    const noWorkStart = !effectiveWorkStarted;
    // Cross-midnight: prev day's single-use types count as ✅ done (except WORK_START/WORK_END/LUNCH)
    // LUNCH_START and LUNCH_END are excluded: their state is driven by onLunch/lunchEndBlocked
    const alreadyDone =
      SINGLE_USE.includes(t) &&
      (existingTypes.has(t) ||
        ((prevDayShiftOpen || crossMidnightShiftWasActive) &&
          prevTypes.has(t) &&
          t !== TimeEntryType.WORK_START &&
          t !== TimeEntryType.WORK_END &&
          t !== TimeEntryType.LUNCH_START &&
          t !== TimeEntryType.LUNCH_END));
    const requiresWorkStart = noWorkStart && t !== TimeEntryType.WORK_START && t !== TimeEntryType.SICK_LEAVE;
    // Block work_start if previous day's shift is still open
    const workStartCrossMidnight =
      prevDayShiftOpen && t === TimeEntryType.WORK_START && !existingTypes.has(TimeEntryType.WORK_START);
    const sickLeaveBlocked = t === TimeEntryType.SICK_LEAVE && effectiveWorkStarted;
    // Use combined onLunch/onLeave for accurate cross-midnight blocking
    const lunchEndBlocked = t === TimeEntryType.LUNCH_END && !onLunch;
    const returnBlocked = t === TimeEntryType.PERSONAL_LEAVE_END && !onLeave;
    const onLunchBlocked = onLunch && t !== TimeEntryType.LUNCH_END && t !== TimeEntryType.PERSONAL_LEAVE_END;
    const onLeaveBlocked = onLeave && t !== TimeEntryType.PERSONAL_LEAVE_END && t !== TimeEntryType.LUNCH_START && t !== TimeEntryType.LUNCH_END;
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
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    await ctx.reply('Выберите сотрудника из списка.');
  },

  // Step 1: date text input
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
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
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
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

    // selectedDate stores "eid:N" for edit, "add:TYPE" for add,
    // "pair_start:TYPE" / "pair_end:TYPE" for the two-step lunch/absence flow
    const meta = ctx.scene.session.selectedDate;
    const dateStr = ctx.scene.session.selectedPeriodFrom;
    const empId = ctx.scene.session.selectedEmployeeId;
    if (!dateStr || !empId || !meta) return ctx.scene.leave();

    const date = new Date(`${dateStr}T00:00:00.000Z`);
    const timestamp = localInputToUtc(dateStr, parsed.hours, parsed.minutes);
    const backButtons = Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]);

    if (meta.startsWith('pair_start:')) {
      const startType = meta.slice('pair_start:'.length) as TimeEntryType;
      const shiftEntries = await collectShiftEntries(empId, dateStr);
      const validationError = validateEntryTime(startType, timestamp, shiftEntries);
      if (validationError) {
        await ctx.reply(`❌ ${validationError}\n\nВведите другое время:`, backButtons);
        return;
      }
      ctx.scene.session.pendingStartTime = timestamp.toISOString();
      const endType = startType === TimeEntryType.LUNCH_START ? TimeEntryType.LUNCH_END : TimeEntryType.PERSONAL_LEAVE_END;
      ctx.scene.session.selectedDate = `pair_end:${endType}`;
      const isToday = dateStr === todayDateUTC7().toISOString().slice(0, 10);
      await showPairEndPrompt(ctx, endType, timestamp, isToday);
      return;
    }

    if (meta.startsWith('pair_end:')) {
      const endType = meta.slice('pair_end:'.length) as TimeEntryType;
      const startType = endType === TimeEntryType.LUNCH_END ? TimeEntryType.LUNCH_START : TimeEntryType.PERSONAL_LEAVE_START;
      const pendingStartStr = ctx.scene.session.pendingStartTime;
      if (!pendingStartStr) return ctx.scene.leave();
      const startTimestamp = new Date(pendingStartStr);

      if (timestamp <= startTimestamp) {
        await ctx.reply(`❌ Время окончания должно быть позже начала (${formatTime(startTimestamp)}).\n\nВведите другое время:`, backButtons);
        return;
      }
      const shiftEntries = await collectShiftEntries(empId, dateStr);
      const virtualStart = { id: -999, type: startType, timestamp: startTimestamp };
      const validationError = validateEntryTime(endType, timestamp, [...shiftEntries, virtualStart]);
      if (validationError) {
        await ctx.reply(`❌ ${validationError}\n\nВведите другое время:`, backButtons);
        return;
      }
      await timeEntryService.createEntryManual(editorId, empId, startType, startTimestamp, date);
      await timeEntryService.createEntryManual(editorId, empId, endType, timestamp, date);
      const actionLabel = startType === TimeEntryType.LUNCH_START ? 'Обед' : 'Отлучка';
      await ctx.reply(`✅ ${actionLabel} добавлен: ${formatTime(startTimestamp)} — ${formatTime(timestamp)}`);
      ctx.scene.session.pendingStartTime = undefined;
      ctx.scene.session.selectedDate = undefined;
      await showEntriesList(ctx, empId, date);
      return;
    }

    if (meta.startsWith('eid:')) {
      const entryId = parseInt(meta.slice(4), 10);
      const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
      if (entry) {
        const shiftEntries = await collectShiftEntries(empId, dateStr);
        const withoutSelf = shiftEntries.filter((e) => e.id !== entryId);
        const validationError = validateEntryTime(entry.type, timestamp, withoutSelf);
        if (validationError) {
          await ctx.reply(
            `❌ ${validationError}\n\nВведите другое время:`,
            Markup.inlineKeyboard([[Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
          );
          return;
        }
      }
      await timeEntryService.updateEntry(editorId, entryId, timestamp);
      await ctx.reply(`✅ Время обновлено на ${formatTime(timestamp)}`);
    } else if (meta.startsWith('add:')) {
      const type = meta.slice(4) as TimeEntryType;
      const shiftEntries = await collectShiftEntries(empId, dateStr);
      const validationError = validateEntryTime(type, timestamp, shiftEntries);
      if (validationError) {
        await ctx.reply(
          `❌ ${validationError}\n\nВведите другое время:`,
          Markup.inlineKeyboard([[Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
        );
        return;
      }
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
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  const isToday = dateStr === todayDateUTC7().toISOString().slice(0, 10);
  await ctx.reply(
    'Введите новое время в формате ЧЧ:ММ или выберите:',
    Markup.inlineKeyboard([
      ...(isToday ? [[Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')]] : []),
      [Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')],
    ]),
  );
});

// Delete entry — show confirmation with list of affected entries
adminEditWizard.action(/^edit_delete_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!empId || !dateStr) return ctx.scene.leave();
  const entryId = parseInt(ctx.match[1], 10);
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) {
    await ctx.reply('Запись не найдена.');
    await showEntriesList(ctx, empId, date);
    return;
  }

  // Block deletion of WORK_END if a subsequent shift exists
  if (entry.type === TimeEntryType.WORK_END) {
    const nextShift = await prisma.timeEntry.findFirst({
      where: { employeeId: empId, type: TimeEntryType.WORK_START, timestamp: { gt: entry.timestamp } },
    });
    if (nextShift) {
      await ctx.reply('⛔ Нельзя удалить конец смены: после неё уже начата следующая смена.\n\nЧтобы удалить эту смену целиком, удалите её начало (запись «Начало дня»).');
      return;
    }
  }

  const shiftEntries = await collectShiftEntries(empId, dateStr);
  const toDelete = getEntriesToDelete(shiftEntries, entryId);
  if (toDelete.length === 0) toDelete.push(entry as ShiftEntry);

  const listLines = toDelete.map((e, i) => `${i + 1}. ${formatTime(e.timestamp)} — ${TYPE_LABELS[e.type]}`);
  const warning =
    toDelete.length > 1
      ? `⚠️ Будут удалены эта и все последующие записи смены:\n\n${listLines.join('\n')}\n\nПродолжить?`
      : `⚠️ Будет удалена запись:\n\n${listLines[0]}\n\nПродолжить?`;

  await ctx.reply(warning, Markup.inlineKeyboard([
    [Markup.button.callback('🗑 Удалить', `edit_delete_confirm_${entryId}`)],
    [Markup.button.callback('✗ Отмена', 'edit_back_to_list')],
  ]));
});

// Delete entry — confirmed
adminEditWizard.action(/^edit_delete_confirm_(\d+)$/, async (ctx) => {
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

  const shiftEntries = await collectShiftEntries(empId, dateStr);
  const toDelete = getEntriesToDelete(shiftEntries, entryId);
  if (toDelete.length === 0) toDelete.push(entry as ShiftEntry);

  for (const e of toDelete) {
    await timeEntryService.deleteEntry(editorId, e.id);
  }

  await ctx.reply(toDelete.length > 1 ? `🗑 Удалено записей: ${toDelete.length}.` : '🗑 Запись удалена.');
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

  const isToday = dateStr === todayDateUTC7().toISOString().slice(0, 10);

  // Lunch and absence — two-step pair flow: collect start, then end, save both atomically
  if (type === TimeEntryType.LUNCH_START || type === TimeEntryType.PERSONAL_LEAVE_START) {
    ctx.scene.session.pendingStartTime = undefined;
    ctx.scene.session.selectedDate = `pair_start:${type}`;
    while (ctx.wizard.cursor < 2) ctx.wizard.next();
    const startLabel = type === TimeEntryType.LUNCH_START ? 'начала обеда' : 'начала отлучки';
    await ctx.reply(
      `Введите время *${startLabel}* (ЧЧ:ММ):`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          ...(isToday ? [[Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')]] : []),
          [Markup.button.callback('✗ Отмена', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')],
        ]),
      },
    );
    return;
  }

  ctx.scene.session.selectedDate = `add:${type}`;
  while (ctx.wizard.cursor < 2) ctx.wizard.next();
  await ctx.reply(
    `Введите время для "${TYPE_LABELS[type]}" в формате ЧЧ:ММ или выберите:`,
    Markup.inlineKeyboard([
      ...(isToday ? [[Markup.button.callback(`🕐 Сейчас (${formatTime(new Date())})`, 'edit_time_now')]] : []),
      [Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')],
    ]),
  );
});

adminEditWizard.action(/^edit_lunch_end_(30|60)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const editorId = ctx.employee?.id;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  const pendingStartStr = ctx.scene.session.pendingStartTime;
  if (!editorId || !empId || !dateStr || !pendingStartStr) return ctx.scene.leave();
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const startTimestamp = new Date(pendingStartStr);
  const offsetMin = ctx.match[1] === '30' ? 30 : 60;
  const endTimestamp = new Date(startTimestamp.getTime() + offsetMin * 60_000);
  const shiftEntries = await collectShiftEntries(empId, dateStr);
  const virtualStart = { id: -999, type: TimeEntryType.LUNCH_START, timestamp: startTimestamp };
  const validationError = validateEntryTime(TimeEntryType.LUNCH_END, endTimestamp, [...shiftEntries, virtualStart]);
  if (validationError) {
    const isToday = dateStr === todayDateUTC7().toISOString().slice(0, 10);
    await ctx.reply(`❌ ${validationError}\n\nВведите время вручную:`);
    await showPairEndPrompt(ctx, TimeEntryType.LUNCH_END, startTimestamp, isToday);
    return;
  }
  await timeEntryService.createEntryManual(editorId, empId, TimeEntryType.LUNCH_START, startTimestamp, date);
  await timeEntryService.createEntryManual(editorId, empId, TimeEntryType.LUNCH_END, endTimestamp, date);
  ctx.scene.session.pendingStartTime = undefined;
  ctx.scene.session.selectedDate = undefined;
  ctx.wizard.selectStep(2);
  await ctx.reply(`✅ Обед добавлен: ${formatTime(startTimestamp)} — ${formatTime(endTimestamp)}`);
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_time_now', async (ctx) => {
  await ctx.answerCbQuery();
  const editorId = ctx.employee?.id;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  const meta = ctx.scene.session.selectedDate;
  if (!editorId || !empId || !dateStr || !meta) return ctx.scene.leave();

  if (dateStr !== todayDateUTC7().toISOString().slice(0, 10)) {
    await ctx.reply('Кнопка "Сейчас" доступна только для сегодняшней даты. Введите время вручную.');
    return;
  }

  const timestamp = new Date(); // actual UTC for storage
  const date = new Date(`${dateStr}T00:00:00.000Z`);

  const backButtons = Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]);

  if (meta.startsWith('pair_start:')) {
    const startType = meta.slice('pair_start:'.length) as TimeEntryType;
    const shiftEntries = await collectShiftEntries(empId, dateStr);
    const validationError = validateEntryTime(startType, timestamp, shiftEntries);
    if (validationError) {
      await ctx.reply(`❌ ${validationError}\n\nВведите время вручную:`, backButtons);
      return;
    }
    ctx.scene.session.pendingStartTime = timestamp.toISOString();
    const endType = startType === TimeEntryType.LUNCH_START ? TimeEntryType.LUNCH_END : TimeEntryType.PERSONAL_LEAVE_END;
    ctx.scene.session.selectedDate = `pair_end:${endType}`;
    await showPairEndPrompt(ctx, endType, timestamp, true);
    return;
  }

  if (meta.startsWith('pair_end:')) {
    const endType = meta.slice('pair_end:'.length) as TimeEntryType;
    const startType = endType === TimeEntryType.LUNCH_END ? TimeEntryType.LUNCH_START : TimeEntryType.PERSONAL_LEAVE_START;
    const pendingStartStr = ctx.scene.session.pendingStartTime;
    if (!pendingStartStr) return ctx.scene.leave();
    const startTimestamp = new Date(pendingStartStr);
    if (timestamp <= startTimestamp) {
      await ctx.reply(`❌ Время окончания должно быть позже начала (${formatTime(startTimestamp)}).\n\nВведите время вручную:`, backButtons);
      return;
    }
    const shiftEntries = await collectShiftEntries(empId, dateStr);
    const virtualStart = { id: -999, type: startType, timestamp: startTimestamp };
    const validationError = validateEntryTime(endType, timestamp, [...shiftEntries, virtualStart]);
    if (validationError) {
      await ctx.reply(`❌ ${validationError}\n\nВведите время вручную:`, backButtons);
      return;
    }
    await timeEntryService.createEntryManual(editorId, empId, startType, startTimestamp, date);
    await timeEntryService.createEntryManual(editorId, empId, endType, timestamp, date);
    const actionLabel = startType === TimeEntryType.LUNCH_START ? 'Обед' : 'Отлучка';
    await ctx.reply(`✅ ${actionLabel} добавлен: ${formatTime(startTimestamp)} — ${formatTime(timestamp)}`);
    ctx.scene.session.pendingStartTime = undefined;
    ctx.scene.session.selectedDate = undefined;
    ctx.wizard.selectStep(2);
    await showEntriesList(ctx, empId, date);
    return;
  }

  if (meta.startsWith('eid:')) {
    const entryId = parseInt(meta.slice(4), 10);
    const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
    if (entry) {
      const shiftEntries = await collectShiftEntries(empId, dateStr);
      const withoutSelf = shiftEntries.filter((e) => e.id !== entryId);
      const validationError = validateEntryTime(entry.type, timestamp, withoutSelf);
      if (validationError) {
        await ctx.reply(
          `❌ ${validationError}\n\nВведите время вручную:`,
          Markup.inlineKeyboard([[Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
        );
        return;
      }
    }
    await timeEntryService.updateEntry(editorId, entryId, timestamp);
    await ctx.reply(`✅ Время обновлено на ${formatTime(timestamp)}`);
  } else if (meta.startsWith('add:')) {
    const type = meta.slice(4) as TimeEntryType;
    const shiftEntries = await collectShiftEntries(empId, dateStr);
    const validationError = validateEntryTime(type, timestamp, shiftEntries);
    if (validationError) {
      await ctx.reply(
        `❌ ${validationError}\n\nВведите время вручную:`,
        Markup.inlineKeyboard([[Markup.button.callback('« Назад к списку', 'edit_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
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
  const wasPairEnd = ctx.scene.session.selectedDate?.startsWith('pair_end:');
  ctx.scene.session.selectedDate = undefined;
  ctx.scene.session.pendingStartTime = undefined;
  const empId = ctx.scene.session.selectedEmployeeId;
  const dateStr = ctx.scene.session.selectedPeriodFrom;
  if (!empId || !dateStr) return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  ctx.wizard.selectStep(2);
  if (wasPairEnd) {
    await ctx.reply('Добавление отменено. Данные не сохранены.');
  }
  await showEntriesList(ctx, empId, date);
});

adminEditWizard.action('edit_back_to_emp', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedPeriodFrom = undefined;
  // go back to step 1 (date entry)
  ctx.wizard.selectStep(1);
  await showDateMenu(ctx);
});
