import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { msToHoursStr } from '../../services/report.service';
import { salaryService } from '../../services/salary.service';
import { formatDate, nowUTC7, todayDateUTC7 } from '../../utils/time';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';
import { PERIOD_KEYBOARD } from '../../keyboards/admin.keyboard';

export const ADMIN_REPORT_SCENE_ID = 'admin_report';

function parseDate(str: string): Date | null {
  const match = str.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!match) return null;
  const [, day, month, yy] = match;
  const date = new Date(`20${yy}-${month}-${day}T00:00:00.000Z`);
  return isNaN(date.getTime()) ? null : date;
}

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function hoursStr(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm > 0 ? `${hh}ч ${mm}м` : `${hh}ч`;
}

function fmtMoney(n: number): string {
  return `${n.toLocaleString('ru-RU')}₽`;
}

async function sendPages(ctx: BotContext, lines: string[]): Promise<void> {
  const pages: string[] = [];
  let cur = '';
  for (const line of lines) {
    const candidate = cur ? `${cur}\n${line}` : line;
    if (candidate.length > 3800 && cur) { pages.push(cur); cur = line; }
    else cur = candidate;
  }
  if (cur) pages.push(cur);
  for (const page of pages) await ctx.reply(page, { parse_mode: 'Markdown' });
}

async function showReport(ctx: BotContext, from: Date, to: Date): Promise<void> {
  const employeeId = ctx.scene.session.selectedEmployeeId;
  const fromStr = formatDate(from);
  const toStr = formatDate(to);
  const period = fromStr === toStr ? fromStr : `${fromStr} – ${toStr}`;

  // All employees — summary mode
  if (!employeeId) {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const lines: string[] = [`📊 *Отчёт за ${period}*`, ''];
    let totalNet = 0;
    let hasData = false;

    for (const emp of employees) {
      const r = await salaryService.calculateSalary(emp.id, from, to);
      if (r.days.length === 0 && r.adjustments.length === 0) continue;
      hasData = true;
      totalNet += r.netSalary;
      lines.push(`👤 *${r.lastName} ${r.firstName}*`);
      lines.push(`  ⏱ ${hoursStr(r.totalWorkedHours)} → ${fmtMoney(r.grossSalary)}`);
      if (r.bonuses > 0) lines.push(`  ➕ Премии: ${fmtMoney(r.bonuses)}`);
      if (r.penalties > 0) lines.push(`  ➖ Штрафы: ${fmtMoney(r.penalties)}`);
      lines.push(`  💰 К выплате: *${fmtMoney(r.netSalary)}*`);
      lines.push('');
    }

    if (!hasData) {
      await ctx.reply(`📊 *Отчёт за ${period}*\n\nНет данных за выбранный период.`, { parse_mode: 'Markdown' });
      return;
    }
    lines.push(`_Итого к выплате: ${fmtMoney(totalNet)}_`);
    await sendPages(ctx, lines);
    return;
  }

  // Single employee — detailed mode
  const r = await salaryService.calculateSalary(employeeId, from, to);
  const header = `📊 *${r.lastName} ${r.firstName} — ${period}*`;

  if (r.days.length === 0 && r.adjustments.length === 0) {
    await ctx.reply(`${header}\n\nНет данных за выбранный период.`, { parse_mode: 'Markdown' });
    return;
  }

  const lines: string[] = [header, ''];

  for (const d of r.days) {
    const dateObj = new Date(`${d.date}T00:00:00.000Z`);
    const dayName = DAY_NAMES[dateObj.getUTCDay()];
    lines.push(`📅 *${formatDate(dateObj)} (${dayName})*`);
    if (d.sickLeave) {
      lines.push('  🏥 Больничный');
    } else {
      lines.push(`  🕐 ${d.workStart} – ${d.workEnd}`);
      if (d.lunchStart && d.lunchEnd) lines.push(`  🍽 ${d.lunchStart} – ${d.lunchEnd}`);
      lines.push(`  ⏱ ${hoursStr(d.netHours)} × ${fmtMoney(d.rate)}/ч = *${fmtMoney(d.amount)}*`);
    }
    lines.push('');
  }

  if (r.adjustments.length > 0) {
    lines.push('─────────────────');
    for (const a of r.adjustments) {
      const dateObj = new Date(`${a.date}T00:00:00.000Z`);
      const sign = a.type === 'BONUS' ? '➕' : '➖';
      lines.push(`${sign} ${formatDate(dateObj)}: *${fmtMoney(a.amount)}* — ${a.reason}`);
    }
    lines.push('');
  }

  lines.push('─────────────────');
  lines.push(`⏱ Отработано: *${hoursStr(r.totalWorkedHours)}*`);
  lines.push(`💵 Заработано: ${fmtMoney(r.grossSalary)}`);
  if (r.bonuses > 0) lines.push(`➕ Премии: ${fmtMoney(r.bonuses)}`);
  if (r.penalties > 0) lines.push(`➖ Штрафы: ${fmtMoney(r.penalties)}`);
  lines.push(`💰 *К выплате: ${fmtMoney(r.netSalary)}*`);

  await sendPages(ctx, lines);
}

async function showEmployeeKeyboard(ctx: BotContext): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('👥 Все сотрудники', 'rpt_emp_all')],
    ...employees.map((e) => [Markup.button.callback(`${e.lastName} ${e.firstName}`, `rpt_emp_${e.id}`)]),
    [Markup.button.callback('« Назад', 'rpt_emp_back'), Markup.button.callback('📋 Меню', 'go_menu')],
  ];

  await ctx.reply('Выберите сотрудника:', Markup.inlineKeyboard(rows));
}

export const adminReportWizard = new Scenes.WizardScene<BotContext>(
  ADMIN_REPORT_SCENE_ID,

  // Step 0: handles text while cursor=0 (user should use buttons)
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    await ctx.reply('Пожалуйста, выберите сотрудника из списка кнопок.');
  },

  // Step 1: handles text while cursor=1 (user should use buttons)
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    await ctx.reply('Пожалуйста, выберите период из предложенных вариантов.');
  },

  // Step 2: custom start date text input
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите дату начала в формате ДД.ММ.ГГ:');
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату начала в формате ДД.ММ.ГГ:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'rpt_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
    ctx.wizard.next();
    await ctx.reply(
      'Введите дату окончания в формате ДД.ММ.ГГ:',
      Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'rpt_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
    );
  },

  // Step 3: custom end date text input → show report
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите дату окончания в формате ДД.ММ.ГГ:');
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату окончания в формате ДД.ММ.ГГ:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'rpt_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    const fromStr = ctx.scene.session.selectedPeriodFrom;
    if (!fromStr) {
      await ctx.reply('Ошибка. Начните заново.');
      return ctx.scene.leave();
    }
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    if (from > date) {
      await ctx.reply(
        'Дата начала не может быть позже даты окончания. Введите дату окончания:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'rpt_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    await showReport(ctx, from, date);
    return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
  }
);

// On enter: show employee keyboard
adminReportWizard.enter(showEmployeeKeyboard);

// Employee selection actions
adminReportWizard.action(/^rpt_emp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedEmployeeId = parseInt(ctx.match[1], 10);
  ctx.wizard.next();
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

adminReportWizard.action('rpt_emp_all', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedEmployeeId = undefined;
  ctx.wizard.next();
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

adminReportWizard.action('rpt_emp_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

// Period actions
adminReportWizard.action('rpt_today', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const today = todayDateUTC7();
  await showReport(ctx, today, today);
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_yesterday', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const yesterday = new Date(todayDateUTC7().getTime() - 86_400_000);
  await showReport(ctx, yesterday, yesterday);
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_week', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const now = nowUTC7();
  const diff = (now.getUTCDay() + 6) % 7;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - diff * 86_400_000);
  await showReport(ctx, from, todayDateUTC7());
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_month', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const now = nowUTC7();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await showReport(ctx, from, todayDateUTC7());
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.next();
  await ctx.reply(
    'Введите дату начала в формате ДД.ММ.ГГ:',
    Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'rpt_cancel_custom'), Markup.button.callback('📋 Меню', 'go_menu')]]),
  );
});

adminReportWizard.action('rpt_cancel_custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedPeriodFrom = undefined;
  ctx.wizard.selectStep(1);
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

adminReportWizard.action('rpt_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
