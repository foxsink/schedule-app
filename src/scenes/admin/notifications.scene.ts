import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { notificationService } from '../../services/notification.service';
import { prisma } from '../../prisma';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';
import { formatTime, toUTC7, todayDateUTC7, currentWeekUTC7, previousWeekUTC7, currentMonthUTC7, previousMonthUTC7 } from '../../utils/time';
import { TimeEntryType, Notification, Employee } from '../../generated/prisma/client';

export const ADMIN_NOTIFICATIONS_SCENE_ID = 'admin_notifications';

const PAGE_SIZE = 10;

const TYPE_TO_LABEL: Record<TimeEntryType, string> = {
  WORK_START:           '🟢 Рабочий день начат',
  WORK_END:             '🔴 Рабочий день завершён',
  LUNCH_START:          '🍽 Ушёл на обед',
  LUNCH_END:            '✅ Вернулся с обеда',
  PERSONAL_LEAVE_START: '🚶 Отлучился',
  PERSONAL_LEAVE_END:   '🔙 Вернулся',
  SICK_LEAVE:           '🤒 Больничный отмечен',
};

const ALL_TYPES: TimeEntryType[] = [
  'WORK_START', 'WORK_END', 'LUNCH_START', 'LUNCH_END',
  'PERSONAL_LEAVE_START', 'PERSONAL_LEAVE_END', 'SICK_LEAVE',
];

const RU_DAYS   = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function formatDateShort(timestamp: Date): string {
  const d = toUTC7(timestamp);
  const dayName = RU_DAYS[d.getUTCDay()];
  const monthName = RU_MONTHS[d.getUTCMonth()];
  return `${dayName}, ${d.getUTCDate()} ${monthName}`;
}

type FeedItem = Notification & { employee: Employee; isRead: boolean; isBookmarked: boolean };

function ss(ctx: BotContext) {
  return ctx.scene.session;
}

async function renderFeed(ctx: BotContext) {
  if (!ctx.employee) return null;
  const adminId = ctx.employee.id;
  const page = ss(ctx).notifPage ?? 0;
  const tab = ss(ctx).notifTab ?? 'all';
  const filterMode = ss(ctx).notifFilterMode ?? 'settings';

  let items: FeedItem[];
  let total: number;
  let unreadTotal: number;

  if (tab === 'bookmarks') {
    const res = await notificationService.getBookmarkedFeed(adminId, page);
    items = res.items;
    total = res.total;
    unreadTotal = 0;
  } else {
    const useSettingsFilter = filterMode === 'settings';
    const res = await notificationService.getFeed(
      adminId, page, useSettingsFilter,
      ss(ctx).notifFilterEmpId,
      ss(ctx).notifFilterTypes,
      ss(ctx).notifFilterFrom,
      ss(ctx).notifFilterTo,
    );
    items = res.items;
    total = res.total;
    unreadTotal = res.unreadTotal;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tabLabel = tab === 'all'
    ? (filterMode === 'settings' ? '🔔 Уведомления · По настройкам' : '🔔 Уведомления · Фильтр')
    : '⭐ Закладки';

  let text = tabLabel + '\n';
  if (tab === 'all') {
    text += `Непрочитанных: ${unreadTotal}\n`;
  }

  if (items.length === 0) {
    text += '\nУведомлений нет.';
  } else {
    text += '\n';
    items.forEach((item, idx) => {
      const num = page * PAGE_SIZE + idx + 1;
      const readMark = item.isRead ? '✓' : '•';
      const timeStr = formatTime(item.timestamp);
      const dateStr = formatDateShort(item.timestamp);
      const label = TYPE_TO_LABEL[item.type];
      text += `${num}. ${readMark} 👤 ${item.employee.lastName} ${item.employee.firstName}\n`;
      text += `   ${label} в ${timeStr}\n`;
      text += `   📅 ${dateStr}\n`;
    });
  }

  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  // Tab switcher
  keyboard.push([
    Markup.button.callback(tab === 'all' ? '[📥 Все]' : '📥 Все', 'nf_tab_all'),
    Markup.button.callback(tab === 'bookmarks' ? '[⭐ Закладки]' : '⭐ Закладки', 'nf_tab_bookmarks'),
  ]);

  // Bookmark buttons per item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const num = page * PAGE_SIZE + i + 1;
    const bm = item.isBookmarked ? '⭐' : '☆';
    const timeStr = formatTime(item.timestamp);
    keyboard.push([
      Markup.button.callback(`${bm} ${num}: ${item.employee.lastName} ${timeStr}`, `nf_bm_${item.id}`),
    ]);
  }

  // Action buttons
  if (tab === 'all') {
    keyboard.push([
      Markup.button.callback('⚙️ Фильтр', 'nf_filter_open'),
      Markup.button.callback('✅ Всё прочитано', 'nf_mark_all'),
    ]);
  }

  // Pagination
  const navRow: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 0) navRow.push(Markup.button.callback('≪ Пред', 'nf_page_prev'));
  navRow.push(Markup.button.callback(`Стр ${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) navRow.push(Markup.button.callback('≫ След', 'nf_page_next'));
  keyboard.push(navRow);

  keyboard.push([Markup.button.callback('← Назад в меню', 'nf_back')]);

  return { text, keyboard };
}

async function getActiveEmployees() {
  return prisma.employee.findMany({
    where: { isActive: true, role: 'EMPLOYEE' },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}

async function renderFilter(ctx: BotContext) {
  if (!ctx.employee) return null;

  const employees = await getActiveEmployees();
  const empId = ss(ctx).notifFilterEmpId;
  const typesStr = ss(ctx).notifFilterTypes ?? '';
  const activeTypes = typesStr.length > 0 ? typesStr.split(',') : [];
  const allTypesActive = activeTypes.length === 0;
  const fromStr = ss(ctx).notifFilterFrom ?? '';
  const toStr = ss(ctx).notifFilterTo ?? '';

  const text = '⚙️ Фильтр уведомлений\n\n👤 Сотрудник:\n📋 Типы событий:\n📅 Период:';
  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  // Employee rows (up to 4 per row)
  const empChunks: (typeof employees)[] = [];
  const allEmps = [null, ...employees]; // null = "All"
  for (let i = 0; i < allEmps.length; i += 4) {
    empChunks.push(allEmps.slice(i, i + 4) as typeof employees);
  }

  for (const chunk of empChunks) {
    const row = chunk.map(emp => {
      if (emp === null) {
        return Markup.button.callback(empId === undefined ? '[✓ Все]' : '✓ Все', 'nf_emp_all');
      }
      const active = empId === emp.id;
      return Markup.button.callback(active ? `[${emp.lastName}]` : emp.lastName, `nf_emp_${emp.id}`);
    });
    keyboard.push(row);
  }

  // Type rows
  const typeButtons: ReturnType<typeof Markup.button.callback>[] = [
    Markup.button.callback((allTypesActive || activeTypes.includes('WORK_START') ? '✅' : '☐') + ' Начало дня', 'nf_type_WORK_START'),
    Markup.button.callback((allTypesActive || activeTypes.includes('WORK_END') ? '✅' : '☐') + ' Конец дня', 'nf_type_WORK_END'),
    Markup.button.callback((allTypesActive || activeTypes.includes('LUNCH_START') ? '✅' : '☐') + ' Обед', 'nf_type_LUNCH_START'),
    Markup.button.callback((allTypesActive || activeTypes.includes('LUNCH_END') ? '✅' : '☐') + ' Возврат с обеда', 'nf_type_LUNCH_END'),
    Markup.button.callback((allTypesActive || activeTypes.includes('PERSONAL_LEAVE_START') ? '✅' : '☐') + ' Отлучка', 'nf_type_PERSONAL_LEAVE_START'),
    Markup.button.callback((allTypesActive || activeTypes.includes('PERSONAL_LEAVE_END') ? '✅' : '☐') + ' Возврат', 'nf_type_PERSONAL_LEAVE_END'),
    Markup.button.callback((allTypesActive || activeTypes.includes('SICK_LEAVE') ? '✅' : '☐') + ' Больничный', 'nf_type_SICK_LEAVE'),
  ];
  for (let i = 0; i < typeButtons.length; i += 2) {
    keyboard.push(typeButtons.slice(i, i + 2));
  }

  // Period buttons
  const now = todayDateUTC7();
  const todayStr = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const [wMon, wSun] = currentWeekUTC7();
  const [lwMon, lwSun] = previousWeekUTC7();
  const [mFrom, mTo] = currentMonthUTC7();
  const [lmFrom, lmTo] = previousMonthUTC7();

  const isToday = fromStr === todayStr && toStr === todayStr;
  const isYesterday = fromStr === yesterdayStr && toStr === yesterdayStr;
  const isWeek = fromStr === wMon.toISOString().slice(0, 10) && toStr === wSun.toISOString().slice(0, 10);
  const isLastWeek = fromStr === lwMon.toISOString().slice(0, 10) && toStr === lwSun.toISOString().slice(0, 10);
  const isMonth = fromStr === mFrom.toISOString().slice(0, 10) && toStr === mTo.toISOString().slice(0, 10);
  const isLastMonth = fromStr === lmFrom.toISOString().slice(0, 10) && toStr === lmTo.toISOString().slice(0, 10);
  const isAll = !fromStr && !toStr;

  keyboard.push([
    Markup.button.callback(isToday ? '[Сегодня]' : 'Сегодня', 'nf_period_today'),
    Markup.button.callback(isYesterday ? '[Вчера]' : 'Вчера', 'nf_period_yesterday'),
  ]);
  keyboard.push([
    Markup.button.callback(isWeek ? '[Эта неделя]' : 'Эта неделя', 'nf_period_week'),
    Markup.button.callback(isLastWeek ? '[Прошлая неделя]' : 'Прошлая неделя', 'nf_period_last_week'),
  ]);
  keyboard.push([
    Markup.button.callback(isMonth ? '[Этот месяц]' : 'Этот месяц', 'nf_period_month'),
    Markup.button.callback(isLastMonth ? '[Прошлый месяц]' : 'Прошлый месяц', 'nf_period_last_month'),
  ]);
  keyboard.push([
    Markup.button.callback(isAll ? '[✓ Всё время]' : '✓ Всё время', 'nf_period_all'),
  ]);

  keyboard.push([
    Markup.button.callback('Сбросить', 'nf_filter_reset'),
    Markup.button.callback('← К ленте', 'nf_filter_close'),
  ]);

  return { text, keyboard };
}

export const adminNotificationsScene = new Scenes.BaseScene<BotContext>(ADMIN_NOTIFICATIONS_SCENE_ID);

adminNotificationsScene.enter(async (ctx) => {
  if (!ctx.employee) return ctx.scene.leave();

  ss(ctx).notifPage = 0;
  ss(ctx).notifTab = 'all';
  ss(ctx).notifFilterMode = 'settings';

  notificationService.markAllRead(ctx.employee.id).catch(() => {});

  const result = await renderFeed(ctx);
  if (!result) return;
  await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
});

async function reRenderFeed(ctx: BotContext) {
  const result = await renderFeed(ctx);
  if (!result) return;
  try {
    await ctx.editMessageText(result.text, {
      reply_markup: { inline_keyboard: result.keyboard },
    });
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

async function reRenderFilter(ctx: BotContext) {
  const result = await renderFilter(ctx);
  if (!result) return;
  try {
    await ctx.editMessageText(result.text, {
      reply_markup: { inline_keyboard: result.keyboard },
    });
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

// Tab switcher
adminNotificationsScene.action('nf_tab_all', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifTab = 'all';
  ss(ctx).notifPage = 0;
  if (ctx.employee) notificationService.markAllRead(ctx.employee.id).catch(() => {});
  await reRenderFeed(ctx);
});

adminNotificationsScene.action('nf_tab_bookmarks', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifTab = 'bookmarks';
  ss(ctx).notifPage = 0;
  await reRenderFeed(ctx);
});

// Bookmark toggle
adminNotificationsScene.action(/^nf_bm_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  const notifId = parseInt((ctx.match as RegExpMatchArray)[1], 10);
  await notificationService.toggleBookmark(ctx.employee.id, notifId);
  await reRenderFeed(ctx);
});

// Filter open
adminNotificationsScene.action('nf_filter_open', async (ctx) => {
  await ctx.answerCbQuery();
  await reRenderFilter(ctx);
});

// Mark all read
adminNotificationsScene.action('nf_mark_all', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  await notificationService.markAllRead(ctx.employee.id);
  await reRenderFeed(ctx);
});

// Pagination
adminNotificationsScene.action('nf_page_prev', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifPage = Math.max(0, (ss(ctx).notifPage ?? 0) - 1);
  if (ss(ctx).notifTab === 'all' && ctx.employee) {
    notificationService.markAllRead(ctx.employee.id).catch(() => {});
  }
  await reRenderFeed(ctx);
});

adminNotificationsScene.action('nf_page_next', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifPage = (ss(ctx).notifPage ?? 0) + 1;
  if (ss(ctx).notifTab === 'all' && ctx.employee) {
    notificationService.markAllRead(ctx.employee.id).catch(() => {});
  }
  await reRenderFeed(ctx);
});

// Back
adminNotificationsScene.action('nf_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '← Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

// ===== Filter view actions =====

adminNotificationsScene.action('nf_emp_all', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterEmpId = undefined;
  await reRenderFilter(ctx);
});

adminNotificationsScene.action(/^nf_emp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt((ctx.match as RegExpMatchArray)[1], 10);
  ss(ctx).notifFilterEmpId = empId;
  await reRenderFilter(ctx);
});

// Type toggles
adminNotificationsScene.action(/^nf_type_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = (ctx.match as RegExpMatchArray)[1] as TimeEntryType;
  const typesStr = ss(ctx).notifFilterTypes ?? '';
  let activeTypes: TimeEntryType[] = typesStr.length > 0 ? (typesStr.split(',') as TimeEntryType[]) : [...ALL_TYPES];

  if (activeTypes.includes(type)) {
    activeTypes = activeTypes.filter(t => t !== type);
  } else {
    activeTypes.push(type);
  }

  ss(ctx).notifFilterTypes = activeTypes.length === ALL_TYPES.length ? '' : activeTypes.join(',');
  await reRenderFilter(ctx);
});

// Period presets
adminNotificationsScene.action('nf_period_today', async (ctx) => {
  await ctx.answerCbQuery();
  const d = todayDateUTC7().toISOString().slice(0, 10);
  ss(ctx).notifFilterFrom = d;
  ss(ctx).notifFilterTo = d;
  await reRenderFilter(ctx);
});

adminNotificationsScene.action('nf_period_yesterday', async (ctx) => {
  await ctx.answerCbQuery();
  const d = new Date(todayDateUTC7().getTime() - 86_400_000).toISOString().slice(0, 10);
  ss(ctx).notifFilterFrom = d;
  ss(ctx).notifFilterTo = d;
  await reRenderFilter(ctx);
});

adminNotificationsScene.action('nf_period_week', async (ctx) => {
  await ctx.answerCbQuery();
  const [mon, sun] = currentWeekUTC7();
  ss(ctx).notifFilterFrom = mon.toISOString().slice(0, 10);
  ss(ctx).notifFilterTo = sun.toISOString().slice(0, 10);
  await reRenderFilter(ctx);
});

adminNotificationsScene.action('nf_period_last_week', async (ctx) => {
  await ctx.answerCbQuery();
  const [mon, sun] = previousWeekUTC7();
  ss(ctx).notifFilterFrom = mon.toISOString().slice(0, 10);
  ss(ctx).notifFilterTo = sun.toISOString().slice(0, 10);
  await reRenderFilter(ctx);
});

adminNotificationsScene.action('nf_period_month', async (ctx) => {
  await ctx.answerCbQuery();
  const [from, to] = currentMonthUTC7();
  ss(ctx).notifFilterFrom = from.toISOString().slice(0, 10);
  ss(ctx).notifFilterTo = to.toISOString().slice(0, 10);
  await reRenderFilter(ctx);
});

adminNotificationsScene.action('nf_period_last_month', async (ctx) => {
  await ctx.answerCbQuery();
  const [from, to] = previousMonthUTC7();
  ss(ctx).notifFilterFrom = from.toISOString().slice(0, 10);
  ss(ctx).notifFilterTo = to.toISOString().slice(0, 10);
  await reRenderFilter(ctx);
});

adminNotificationsScene.action('nf_period_all', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterFrom = undefined;
  ss(ctx).notifFilterTo = undefined;
  await reRenderFilter(ctx);
});

// Reset filter
adminNotificationsScene.action('nf_filter_reset', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterEmpId = undefined;
  ss(ctx).notifFilterTypes = '';
  ss(ctx).notifFilterFrom = undefined;
  ss(ctx).notifFilterTo = undefined;
  ss(ctx).notifFilterMode = 'settings';
  await reRenderFilter(ctx);
});

// Close filter → go to feed
adminNotificationsScene.action('nf_filter_close', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterMode = 'custom';
  ss(ctx).notifPage = 0;
  await reRenderFeed(ctx);
});
