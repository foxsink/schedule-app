import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { employeeService } from '../../services/employee.service';
import { auditService } from '../../services/audit.service';
import { parseDate } from '../../utils/validation';
import { formatDate } from '../../utils/time';
import { AuditAction, AuditEntityType } from '@prisma/client';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';

export const ADMIN_MANAGE_SCENE_ID = 'admin_manage';

// We'll use selectedDate to store wizard sub-state: "set_rate", "set_rate2:N:RATE", "deactivate:N", "new_emp"
// selectedEmployeeId for current employee

async function showEmployeeList(ctx: BotContext): Promise<void> {
  const employees = await prisma.employee.findMany({
    orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
  });

  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('➕ Создать сотрудника', 'mgmt_create')],
    ...employees.map((e) => {
      const status = e.isActive ? '' : ' [неакт.]';
      return [Markup.button.callback(`${e.lastName} ${e.firstName}${status}`, `mgmt_emp_${e.id}`)];
    }),
    [Markup.button.callback('« Назад', 'mgmt_back')],
  ];

  await ctx.reply('👥 Управление сотрудниками:', Markup.inlineKeyboard(rows));
}

async function showEmployeeCard(ctx: BotContext, employeeId: number): Promise<void> {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { rates: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
  });
  if (!emp) { await ctx.reply('Сотрудник не найден.'); return; }

  const rate = emp.rates[0];
  const rateStr = rate ? `${Number(rate.rate)} руб/ч (с ${formatDate(rate.effectiveFrom)})` : 'не установлена';
  const statusStr = emp.isActive ? '✅ активен' : '❌ деактивирован';
  const tgStr = emp.telegramId ? `@tg${emp.telegramId}` : 'не привязан';
  const codeStr = emp.invitationCode ? `Код: \`${emp.invitationCode}\`` : 'код использован';

  const lines = [
    `👤 *${emp.lastName} ${emp.firstName}*`,
    `Роль: ${emp.role}`,
    `Статус: ${statusStr}`,
    `Telegram: ${tgStr}`,
    `${codeStr}`,
    `Ставка: ${rateStr}`,
  ];

  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [Markup.button.callback('💰 Установить ставку', `mgmt_rate_${employeeId}`)],
  ];
  if (emp.isActive) {
    rows.push([Markup.button.callback('🚫 Деактивировать', `mgmt_deact_${employeeId}`)]);
  } else {
    rows.push([Markup.button.callback('✅ Активировать', `mgmt_activate_${employeeId}`)]);
  }
  rows.push([Markup.button.callback('🔑 Новый код приглашения', `mgmt_newcode_${employeeId}`)]);
  rows.push([Markup.button.callback('« К списку', 'mgmt_list')]);

  await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

export const adminManageScene = new Scenes.WizardScene<BotContext>(
  ADMIN_MANAGE_SCENE_ID,

  // Step 0: text while at list
  async (ctx) => {
    await ctx.reply('Выберите действие из списка.');
  },

  // Step 1: text input for various sub-flows
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const meta = ctx.scene.session.selectedDate;
    const editorId = ctx.employee?.id;
    if (!editorId) return ctx.scene.leave();

    if (meta === 'new_emp') {
      // Expect "FirstName LastName"
      const parts = ctx.message.text.trim().split(/\s+/);
      if (parts.length < 2) {
        await ctx.reply('Введите имя и фамилию через пробел (например: Иван Петров):');
        return;
      }
      const [firstName, ...rest] = parts;
      const lastName = rest.join(' ');
      const emp = await employeeService.create({ firstName, lastName });
      await auditService.log(editorId, AuditAction.CREATE, AuditEntityType.EMPLOYEE, emp.id, null, { id: emp.id, firstName, lastName });
      ctx.scene.session.selectedDate = undefined;
      ctx.wizard.selectStep(0);
      await ctx.reply(`✅ Сотрудник создан!\n*${lastName} ${firstName}*\nКод приглашения: \`${emp.invitationCode}\``, { parse_mode: 'Markdown' });
      await showEmployeeList(ctx);
      return;
    }

    if (meta && meta.startsWith('set_rate:')) {
      // Expect rate as number
      const empId = parseInt(meta.slice(9), 10);
      const rate = parseFloat(ctx.message.text.replace(',', '.'));
      if (isNaN(rate) || rate < 0) {
        await ctx.reply('Введите корректную ставку (число, например 250.50):');
        return;
      }
      ctx.scene.session.selectedDate = `set_rate2:${empId}:${rate}`;
      await ctx.reply('Введите дату вступления в силу (ДД.ММ.ГГГГ):');
      return;
    }

    if (meta && meta.startsWith('set_rate2:')) {
      const parts2 = meta.slice(10).split(':');
      const empId = parseInt(parts2[0], 10);
      const rate = parseFloat(parts2[1]);
      const date = parseDate(ctx.message.text);
      if (!date) {
        await ctx.reply('Неверный формат. Введите дату в формате ДД.ММ.ГГГГ:');
        return;
      }
      const rateRecord = await employeeService.setRate(empId, rate, date);
      await auditService.log(editorId, AuditAction.CREATE, AuditEntityType.EMPLOYEE_RATE, rateRecord.id, null, { employeeId: empId, rate, effectiveFrom: date });
      ctx.scene.session.selectedDate = undefined;
      ctx.wizard.selectStep(0);
      await ctx.reply(`✅ Ставка ${rate} руб/ч установлена с ${formatDate(date)}`);
      await showEmployeeCard(ctx, empId);
      return;
    }
  }
);

adminManageScene.enter(showEmployeeList);

adminManageScene.action('mgmt_create', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.scene.session.selectedDate = 'new_emp';
  ctx.wizard.selectStep(1);
  await ctx.reply('Введите имя и фамилию сотрудника через пробел (например: Иван Петров):');
});

adminManageScene.action(/^mgmt_emp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  ctx.scene.session.selectedEmployeeId = empId;
  await showEmployeeCard(ctx, empId);
});

adminManageScene.action(/^mgmt_rate_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  ctx.scene.session.selectedDate = `set_rate:${empId}`;
  ctx.wizard.selectStep(1);
  await ctx.reply('Введите ставку в рублях за час (например: 250.50):');
});

adminManageScene.action(/^mgmt_deact_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  const editorId = ctx.employee?.id;
  if (!editorId) return ctx.scene.leave();
  const old = await prisma.employee.findUnique({ where: { id: empId } });
  await employeeService.deactivate(empId);
  await auditService.log(editorId, AuditAction.UPDATE, AuditEntityType.EMPLOYEE, empId, { isActive: old?.isActive }, { isActive: false });
  await ctx.reply('🚫 Сотрудник деактивирован.');
  await showEmployeeCard(ctx, empId);
});

adminManageScene.action(/^mgmt_activate_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  const editorId = ctx.employee?.id;
  if (!editorId) return ctx.scene.leave();
  await prisma.employee.update({ where: { id: empId }, data: { isActive: true } });
  await auditService.log(editorId, AuditAction.UPDATE, AuditEntityType.EMPLOYEE, empId, { isActive: false }, { isActive: true });
  await ctx.reply('✅ Сотрудник активирован.');
  await showEmployeeCard(ctx, empId);
});

adminManageScene.action(/^mgmt_newcode_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt(ctx.match[1], 10);
  const code = await employeeService.generateInvitationCode();
  await prisma.employee.update({ where: { id: empId }, data: { invitationCode: code } });
  await ctx.reply(`🔑 Новый код приглашения: \`${code}\``, { parse_mode: 'Markdown' });
});

adminManageScene.action('mgmt_list', async (ctx) => {
  await ctx.answerCbQuery();
  await showEmployeeList(ctx);
});

adminManageScene.action('mgmt_back', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
