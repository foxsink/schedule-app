import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { notificationService } from '../../services/notification.service';
import { prisma } from '../../prisma';
import { ADMIN_NOTIFICATIONS_SCENE_ID } from './notifications.scene';
import { TimeEntryType } from '../../generated/prisma/client';

export const ADMIN_NOTIF_SETTINGS_SCENE_ID = 'admin_notif_settings';

const TYPE_LABELS: Array<{ type: TimeEntryType; label: string; field: string }> = [
  { type: 'WORK_START',           label: 'Начало дня',      field: 'notifyWorkStart' },
  { type: 'WORK_END',             label: 'Конец дня',       field: 'notifyWorkEnd' },
  { type: 'LUNCH_START',          label: 'Обед',            field: 'notifyLunchStart' },
  { type: 'LUNCH_END',            label: 'Возврат с обеда', field: 'notifyLunchEnd' },
  { type: 'PERSONAL_LEAVE_START', label: 'Отлучка',         field: 'notifyPersonalLeaveStart' },
  { type: 'PERSONAL_LEAVE_END',   label: 'Возврат',         field: 'notifyPersonalLeaveEnd' },
  { type: 'SICK_LEAVE',           label: 'Больничный',      field: 'notifySickLeave' },
];

async function getActiveEmployees() {
  return prisma.employee.findMany({
    where: { isActive: true, role: 'EMPLOYEE' },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}

async function renderSettings(ctx: BotContext) {
  if (!ctx.employee) return;

  const settings = await notificationService.getOrCreateSettings(ctx.employee.id);
  const filterCount = settings.employeeFilters.length;

  const text = '⚙️ Настройки уведомлений (push)';
  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  // Push toggle
  keyboard.push([
    settings.pushEnabled
      ? Markup.button.callback('🔔 Push: ВКЛ', 'ns_push_off')
      : Markup.button.callback('🔕 Push: ВЫКЛ', 'ns_push_on'),
  ]);

  // Event type toggles (2 per row)
  for (let i = 0; i < TYPE_LABELS.length; i += 2) {
    const row = [];
    for (let j = i; j < Math.min(i + 2, TYPE_LABELS.length); j++) {
      const item = TYPE_LABELS[j];
      const enabled = settings[item.field as keyof typeof settings] as boolean;
      row.push(
        Markup.button.callback(
          (enabled ? '✅' : '☐') + ' ' + item.label,
          `ns_type_${item.type}`,
        ),
      );
    }
    keyboard.push(row);
  }

  // Employee filter
  const empLabel = filterCount === 0 ? '👥 Сотрудники: Все' : `👥 Сотрудники: ${filterCount} выбрано`;
  keyboard.push([Markup.button.callback(empLabel, 'ns_emp_view')]);

  // Back
  keyboard.push([Markup.button.callback('← Назад к ленте', 'ns_back')]);

  return { text, keyboard };
}

async function renderEmployeeFilter(ctx: BotContext) {
  if (!ctx.employee) return;

  const settings = await notificationService.getOrCreateSettings(ctx.employee.id);
  const selectedIds = new Set(settings.employeeFilters.map(f => f.employeeId));
  const employees = await getActiveEmployees();

  const text = `👥 Фильтр сотрудников (push)\n(пусто = все)`;
  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  for (const emp of employees) {
    const checked = selectedIds.has(emp.id);
    keyboard.push([
      Markup.button.callback(
        (checked ? '☑️' : '☐') + ` ${emp.lastName} ${emp.firstName}`,
        `ns_emp_toggle_${emp.id}`,
      ),
    ]);
  }

  keyboard.push([
    Markup.button.callback('👥 Все сотрудники', 'ns_emp_all'),
    Markup.button.callback('← Назад к настройкам', 'ns_emp_back'),
  ]);

  return { text, keyboard };
}

export const adminNotifSettingsScene = new Scenes.BaseScene<BotContext>(ADMIN_NOTIF_SETTINGS_SCENE_ID);

adminNotifSettingsScene.enter(async (ctx) => {
  if (!ctx.employee) return ctx.scene.leave();

  const result = await renderSettings(ctx);
  if (!result) return;
  await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
});

async function reRenderSettings(ctx: BotContext) {
  const result = await renderSettings(ctx);
  if (!result) return;
  try {
    await ctx.editMessageText(result.text, {
      reply_markup: { inline_keyboard: result.keyboard },
    });
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

async function reRenderEmployeeFilter(ctx: BotContext) {
  const result = await renderEmployeeFilter(ctx);
  if (!result) return;
  try {
    await ctx.editMessageText(result.text, {
      reply_markup: { inline_keyboard: result.keyboard },
    });
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

// Push on/off
adminNotifSettingsScene.action('ns_push_on', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  await notificationService.setPushEnabled(ctx.employee.id, true);
  await reRenderSettings(ctx);
});

adminNotifSettingsScene.action('ns_push_off', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  await notificationService.setPushEnabled(ctx.employee.id, false);
  await reRenderSettings(ctx);
});

// Event type toggles
adminNotifSettingsScene.action(/^ns_type_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  const type = (ctx.match as RegExpMatchArray)[1] as TimeEntryType;
  const settings = await notificationService.getOrCreateSettings(ctx.employee.id);
  const item = TYPE_LABELS.find(t => t.type === type);
  if (!item) return;
  const currentValue = settings[item.field as keyof typeof settings] as boolean;
  await notificationService.toggleEventType(ctx.employee.id, type, !currentValue);
  await reRenderSettings(ctx);
});

// Show employee filter
adminNotifSettingsScene.action('ns_emp_view', async (ctx) => {
  await ctx.answerCbQuery();
  await reRenderEmployeeFilter(ctx);
});

// Toggle individual employee
adminNotifSettingsScene.action(/^ns_emp_toggle_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  const empId = parseInt((ctx.match as RegExpMatchArray)[1], 10);
  const settings = await notificationService.getOrCreateSettings(ctx.employee.id);
  const isSelected = settings.employeeFilters.some(f => f.employeeId === empId);
  if (isSelected) {
    await notificationService.removeEmployeeFilter(ctx.employee.id, empId);
  } else {
    await notificationService.addEmployeeFilter(ctx.employee.id, empId);
  }
  await reRenderEmployeeFilter(ctx);
});

// Clear all employee filters
adminNotifSettingsScene.action('ns_emp_all', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  await notificationService.clearEmployeeFilters(ctx.employee.id);
  await reRenderEmployeeFilter(ctx);
});

// Back to settings
adminNotifSettingsScene.action('ns_emp_back', async (ctx) => {
  await ctx.answerCbQuery();
  await reRenderSettings(ctx);
});

// Back to notifications feed
adminNotifSettingsScene.action('ns_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '← Лента', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_NOTIFICATIONS_SCENE_ID);
});
