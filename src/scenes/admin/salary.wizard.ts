import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { salaryService } from '../../services/salary.service';
import { auditService } from '../../services/audit.service';
import { parseDate } from '../../utils/validation';
import { formatDate, nowUTC7, todayDateUTC7 } from '../../utils/time';
import { AuditAction, AuditEntityType } from '../../generated/prisma/client';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';

export const ADMIN_SALARY_SCENE_ID = 'admin_salary';

// selectedDate stores sub-state: "bonus:N", "penalty:N", "adj_amt:N:TYPE:DATESTR"

function formatSalaryResult(r: Awaited<ReturnType<typeof salaryService.calculateSalary>>): string {
  const lines = [
    `💰 *${r.lastName} ${r.firstName}*`,
    '',
    `Отработано: *${r.totalWorkedHours}ч*`,
    `Начислено: *${r.grossSalary} руб*`,
  ];
  if (r.bonuses > 0) lines.push(`Премии: +${r.bonuses} руб`);
  if (r.penalties > 0) lines.push(`Штрафы: -${r.penalties} руб`);
  lines.push('');
  lines.push(`Итого к выплате: *${r.netSalary} руб*`);
  return lines.join('\n');
}

const PERIOD_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('Сегодня', 'sal_today'), Markup.button.callback('Эта неделя', 'sal_week')],
  [Markup.button.callback('Этот месяц', 'sal_month'), Markup.button.callback('Ввести даты', 'sal_custom')],
  [Markup.button.callback('« Назад', 'sal_back'), Markup.button.callback('📋 Меню', 'go_menu')],
]);

async function showEmployeeList(ctx: BotContext): Promise<void> {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('👥 Все сотрудники', 'sal_emp_all')],
    ...employees.map((e) => [Markup.button.callback(`${e.lastName} ${e.firstName}`, `sal_emp_${e.id}`)]),
    [Markup.button.callback('« Назад', 'sal_back'), Markup.button.callback('📋 Меню', 'go_menu')],
  ];
  await ctx.reply('Выберите сотрудника для расчёта зарплаты:', Markup.inlineKeyboard(rows));
}

async function showSalaryForPeriod(ctx: BotContext, from: Date, to: Date): Promise<void> {
  const empId = ctx.scene.session.selectedEmployeeId;
  const editorId = ctx.employee?.id;
  if (!editorId) return;

  if (empId) {
    const result = await salaryService.calculateSalary(empId, from, to);
    ctx.scene.session.selectedPeriodFrom = from.toISOString().slice(0, 10);
    ctx.scene.session.selectedPeriodTo = to.toISOString().slice(0, 10);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🎁 Добавить премию', `sal_bonus_${empId}`), Markup.button.callback('⚠️ Добавить штраф', `sal_penalty_${empId}`)],
      [Markup.button.callback('« Назад', 'sal_back')],
    ]);
    await ctx.reply(formatSalaryResult(result), { parse_mode: 'Markdown', ...keyboard });
  } else {
    // All employees
    const employees = await prisma.employee.findMany({ where: { isActive: true }, orderBy: [{ lastName: 'asc' }] });
    const lines: string[] = [`💰 *Зарплаты за период*\n`];
    let grandTotal = 0;
    for (const emp of employees) {
      const r = await salaryService.calculateSalary(emp.id, from, to);
      lines.push(`• ${r.lastName} ${r.firstName}: *${r.netSalary} руб* (${r.totalWorkedHours}ч)`);
      grandTotal += r.netSalary;
    }
    lines.push(`\n_Итого: ${Math.round(grandTotal * 100) / 100} руб_`);
    const keyboard = Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'sal_back')]]);
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', ...keyboard });
  }
}

export const adminSalaryWizard = new Scenes.WizardScene<BotContext>(
  ADMIN_SALARY_SCENE_ID,

  // Step 0: text while at employee list
  async (ctx, next) => { if (ctx.callbackQuery) return next!(); await ctx.reply('Выберите сотрудника из списка.'); },

  // Step 1: text while at period selection
  async (ctx, next) => { if (ctx.callbackQuery) return next!(); await ctx.reply('Выберите период из предложенных вариантов.'); },

  // Step 2: custom start date
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    if (!ctx.message || !('text' in ctx.message)) { await ctx.reply('Введите дату начала (ДД.ММ.ГГ):'); return; }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату начала (ДД.ММ.ГГ):',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
    ctx.wizard.next();
    await ctx.reply(
      'Введите дату окончания (ДД.ММ.ГГ):',
      Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
    );
  },

  // Step 3: custom end date
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    if (!ctx.message || !('text' in ctx.message)) { await ctx.reply('Введите дату окончания (ДД.ММ.ГГ):'); return; }
    const date = parseDate(ctx.message.text);
    if (!date) {
      await ctx.reply(
        'Неверный формат. Введите дату окончания (ДД.ММ.ГГ):',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    const fromStr = ctx.scene.session.selectedPeriodFrom;
    if (!fromStr) return ctx.scene.leave();
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    if (from > date) {
      await ctx.reply(
        'Дата начала не может быть позже даты окончания:',
        Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
      );
      return;
    }
    await showSalaryForPeriod(ctx, from, date);
    ctx.wizard.selectStep(0);
  },

  // Step 4: adjustment input: "AMOUNT reason text"
  async (ctx, next) => {
    if (ctx.callbackQuery) return next!();
    if (!ctx.message || !('text' in ctx.message)) { await ctx.reply('Введите сумму и причину (например: 1000 За хорошую работу):'); return; }
    const meta = ctx.scene.session.selectedDate;
    const editorId = ctx.employee?.id;
    if (!meta || !editorId) return ctx.scene.leave();

    // meta format: "adj:N:TYPE" where N=empId, TYPE=BONUS|PENALTY
    const parts = meta.split(':');
    const empId = parseInt(parts[1], 10);
    const adjType = parts[2] as 'BONUS' | 'PENALTY';

    const cancelKb = Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]);
    const spaceIdx = ctx.message.text.indexOf(' ');
    if (spaceIdx === -1) { await ctx.reply('Введите сумму и причину через пробел (например: 1000 За хорошую работу):', cancelKb); return; }
    const amount = parseFloat(ctx.message.text.slice(0, spaceIdx).replace(',', '.'));
    const reason = ctx.message.text.slice(spaceIdx + 1).trim();
    if (isNaN(amount) || amount <= 0) { await ctx.reply('Неверная сумма. Введите число и причину:', cancelKb); return; }
    if (!reason) { await ctx.reply('Укажите причину после суммы:', cancelKb); return; }

    const today = todayDateUTC7();
    const adj = await salaryService.addAdjustment(empId, adjType, amount, today, reason);
    await auditService.log(editorId, AuditAction.CREATE, AuditEntityType.SALARY_ADJUSTMENT, adj.id, null, { employeeId: empId, type: adjType, amount, reason });

    const label = adjType === 'BONUS' ? 'Премия' : 'Штраф';
    await ctx.reply(`✅ ${label} ${amount} руб добавлен.\nПричина: ${reason}`);
    ctx.scene.session.selectedDate = undefined;
    ctx.wizard.selectStep(0);

    // Re-show salary if we have a period
    const fromStr = ctx.scene.session.selectedPeriodFrom;
    const toStr = ctx.scene.session.selectedPeriodTo;
    if (fromStr && toStr) {
      await showSalaryForPeriod(ctx, new Date(`${fromStr}T00:00:00.000Z`), new Date(`${toStr}T00:00:00.000Z`));
    } else {
      await showEmployeeList(ctx);
    }
  }
);

adminSalaryWizard.enter(showEmployeeList);

adminSalaryWizard.action(/^sal_emp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedEmployeeId = parseInt(ctx.match[1], 10);
  ctx.wizard.next();
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

adminSalaryWizard.action('sal_emp_all', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedEmployeeId = undefined;
  ctx.wizard.next();
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

adminSalaryWizard.action('sal_today', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const today = todayDateUTC7();
  await showSalaryForPeriod(ctx, today, today);
  ctx.wizard.selectStep(0);
});

adminSalaryWizard.action('sal_week', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const now = nowUTC7();
  const diff = (now.getUTCDay() + 6) % 7;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - diff * 86_400_000);
  await showSalaryForPeriod(ctx, from, todayDateUTC7());
  ctx.wizard.selectStep(0);
});

adminSalaryWizard.action('sal_month', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  const now = nowUTC7();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await showSalaryForPeriod(ctx, from, todayDateUTC7());
  ctx.wizard.selectStep(0);
});

adminSalaryWizard.action('sal_custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.next();
  await ctx.reply(
    'Введите дату начала (ДД.ММ.ГГ):',
    Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
  );
});

adminSalaryWizard.action('sal_cancel_input', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedDate = undefined;
  ctx.scene.session.selectedPeriodFrom = undefined;
  ctx.wizard.selectStep(1);
  await ctx.reply('Выберите период:', PERIOD_KEYBOARD);
});

adminSalaryWizard.action(/^sal_bonus_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  ctx.scene.session.selectedDate = `adj:${empId}:BONUS`;
  ctx.wizard.selectStep(4);
  await ctx.reply(
    'Введите сумму премии и причину через пробел (например: 1000 За хорошую работу):',
    Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
  );
});

adminSalaryWizard.action(/^sal_penalty_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  ctx.scene.session.selectedDate = `adj:${empId}:PENALTY`;
  ctx.wizard.selectStep(4);
  await ctx.reply(
    'Введите сумму штрафа и причину через пробел (например: 500 Опоздание):',
    Markup.inlineKeyboard([[Markup.button.callback('✗ Отмена', 'sal_cancel_input'), Markup.button.callback('📋 Меню', 'go_menu')]]),
  );
});

adminSalaryWizard.action('sal_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
