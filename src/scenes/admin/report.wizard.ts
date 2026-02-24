import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { reportService, msToHoursStr } from '../../services/report.service';
import { formatDate, nowUTC7, todayDateUTC7 } from '../../utils/time';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';
import { PERIOD_KEYBOARD } from '../../keyboards/admin.keyboard';

export const ADMIN_REPORT_SCENE_ID = 'admin_report';

function parseDate(str: string): Date | null {
  const match = str.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return isNaN(date.getTime()) ? null : date;
}

async function showReport(ctx: BotContext, from: Date, to: Date): Promise<void> {
  const employeeId = ctx.scene.session.selectedEmployeeId;
  const results = await reportService.getPeriodReport(from, to, employeeId);

  const fromStr = formatDate(from);
  const toStr = formatDate(to);
  const period = fromStr === toStr ? fromStr : `${fromStr} – ${toStr}`;

  const lines = [`📊 *Отчёт за ${period}*`, ''];

  if (results.length === 0) {
    lines.push('Нет данных за выбранный период.');
  } else {
    for (const r of results) {
      lines.push(`👤 ${r.lastName} ${r.firstName}: *${msToHoursStr(r.totalMs)}* (${r.dayCount} дн.)`);
    }
    const totalMs = results.reduce((acc, r) => acc + r.totalMs, 0);
    lines.push('');
    lines.push(`_Итого: ${msToHoursStr(totalMs)}_`);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
}

async function showEmployeeKeyboard(ctx: BotContext): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('👥 Все сотрудники', 'rpt_emp_all')],
    ...employees.map((e) => [Markup.button.callback(`${e.lastName} ${e.firstName}`, `rpt_emp_${e.id}`)]),
    [Markup.button.callback('« Назад', 'rpt_emp_back')],
  ];

  await ctx.reply('Выберите сотрудника:', Markup.inlineKeyboard(rows));
}

export const adminReportWizard = new Scenes.WizardScene<BotContext>(
  ADMIN_REPORT_SCENE_ID,

  // Step 0: handles text while cursor=0 (user should use buttons)
  async (ctx) => {
    await ctx.reply('Пожалуйста, выберите сотрудника из списка кнопок.');
  },

  // Step 1: handles text while cursor=1 (user should use buttons)
  async (ctx) => {
    await ctx.reply('Пожалуйста, выберите период из предложенных вариантов.');
  },

  // Step 2: custom start date text input
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите дату начала в формате ДД.ММ.ГГГГ:');
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply('Неверный формат. Введите дату начала в формате ДД.ММ.ГГГГ:');
      return;
    }
    ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
    ctx.wizard.next();
    await ctx.reply('Введите дату окончания в формате ДД.ММ.ГГГГ:');
  },

  // Step 3: custom end date text input → show report
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Введите дату окончания в формате ДД.ММ.ГГГГ:');
      return;
    }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply('Неверный формат. Введите дату окончания в формате ДД.ММ.ГГГГ:');
      return;
    }
    const fromStr = ctx.scene.session.selectedPeriodFrom;
    if (!fromStr) {
      await ctx.reply('Ошибка. Начните заново.');
      return ctx.scene.leave();
    }
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    if (from > date) {
      await ctx.reply('Дата начала не может быть позже даты окончания. Введите дату окончания:');
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
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

// Period actions
adminReportWizard.action('rpt_today', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  const today = todayDateUTC7();
  await showReport(ctx, today, today);
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_week', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  const now = nowUTC7();
  const diff = (now.getUTCDay() + 6) % 7;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - diff * 86_400_000);
  await showReport(ctx, from, todayDateUTC7());
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_month', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  const now = nowUTC7();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await showReport(ctx, from, todayDateUTC7());
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminReportWizard.action('rpt_custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.next();
  await ctx.reply('Введите дату начала в формате ДД.ММ.ГГГГ:');
});

adminReportWizard.action('rpt_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
