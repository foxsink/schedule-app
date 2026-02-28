import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { notificationService } from '../../services/notification.service';
import { prisma } from '../../prisma';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';
import { ADMIN_NOTIF_SETTINGS_SCENE_ID } from './notif-settings.scene';
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

const TYPE_BUTTONS: Array<{ type: TimeEntryType; label: string }> = [
  { type: 'WORK_START',           label: 'Начало дня' },
  { type: 'WORK_END',             label: 'Конец дня' },
  { type: 'LUNCH_START',          label: 'Обед' },
  { type: 'LUNCH_END',            label: 'Возврат с обеда' },
  { type: 'PERSONAL_LEAVE_START', label: 'Отлучка' },
  { type: 'PERSONAL_LEAVE_END',   label: 'Возврат' },
  { type: 'SICK_LEAVE',           label: 'Больничный' },
];

const ALL_TYPES: TimeEntryType[] = TYPE_BUTTONS.map(t => t.type);

const RU_DAYS   = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function formatDateShort(timestamp: Date): string {
  const d = toUTC7(timestamp);
  return `${RU_DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${RU_MONTHS[d.getUTCMonth()]}`;
}

type FeedItem = Notification & { employee: Employee; isRead: boolean; isBookmarked: boolean };

function ss(ctx: BotContext) {
  return ctx.scene.session;
}

async function getActiveEmployees() {
  return prisma.employee.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
}

// ─── FEED ──────────────────────────────────────────────────────────────────

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
    const res = await notificationService.getFeed(
      adminId, page, filterMode === 'settings',
      ss(ctx).notifFilterEmpIds,
      ss(ctx).notifFilterTypes,
      ss(ctx).notifFilterFrom,
      ss(ctx).notifFilterTo,
    );
    items = res.items;
    total = res.total;
    unreadTotal = res.unreadTotal;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tabLabel = tab === 'bookmarks'
    ? '⭐ Закладки'
    : filterMode === 'settings'
      ? '🔔 Push-уведомления'
      : (ss(ctx).notifFilterEmpIds || ss(ctx).notifFilterTypes || ss(ctx).notifFilterFrom || ss(ctx).notifFilterTo)
        ? '📥 Уведомления · Фильтр'
        : '📥 Все уведомления';

  let text = tabLabel + '\n';
  if (tab === 'all') text += `Непрочитанных: ${unreadTotal}\n`;

  if (items.length === 0) {
    text += '\nУведомлений нет.';
  } else {
    text += '\n';
    items.forEach((item, idx) => {
      const num = page * PAGE_SIZE + idx + 1;
      text += `${num}. ${item.isRead ? '✓' : '•'} 👤 ${item.employee.lastName} ${item.employee.firstName}\n`;
      text += `   ${TYPE_TO_LABEL[item.type]} в ${formatTime(item.timestamp)}\n`;
      text += `   📅 ${formatDateShort(item.timestamp)}\n`;
    });
  }

  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  keyboard.push([
    Markup.button.callback(tab === 'all' && filterMode === 'custom' ? '[📥 Все]' : '📥 Все', 'nf_tab_all'),
    Markup.button.callback(tab === 'all' && filterMode === 'settings' ? '[🔔 Push]' : '🔔 Push', 'nf_tab_push'),
  ]);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const num = page * PAGE_SIZE + i + 1;
    keyboard.push([
      Markup.button.callback(
        `${item.isBookmarked ? '⭐' : '☆'} ${num}: ${item.employee.lastName} ${formatTime(item.timestamp)}`,
        `nf_bm_${item.id}`,
      ),
    ]);
  }

  if (tab === 'all') {
    keyboard.push([
      Markup.button.callback('⚙️ Фильтр ленты', 'nf_filter_open'),
      Markup.button.callback('✅ Всё прочитано', 'nf_mark_all'),
    ]);
    if (filterMode === 'custom') {
      keyboard.push([Markup.button.callback('🔄 Сбросить фильтр', 'nf_filter_reset')]);
    }
  }

  const navRow: ReturnType<typeof Markup.button.callback>[] = [];
  if (page > 0) navRow.push(Markup.button.callback('≪ Пред', 'nf_page_prev'));
  navRow.push(Markup.button.callback(`Стр ${page + 1}/${totalPages}`, 'noop'));
  if (page < totalPages - 1) navRow.push(Markup.button.callback('≫ След', 'nf_page_next'));
  keyboard.push(navRow);

  keyboard.push([Markup.button.callback(tab === 'bookmarks' ? '[⭐ Закладки]' : '⭐ Закладки', 'nf_tab_bookmarks')]);
  keyboard.push([Markup.button.callback('🔔 Push-настройки', 'nf_push_settings')]);
  keyboard.push([Markup.button.callback('← Назад в меню', 'nf_back')]);

  return { text, keyboard };
}

// ─── FILTER STEP 1: EMPLOYEES ───────────────────────────────────────────────

const STEP1_PAGE_SIZE = 5;

async function renderStep1(ctx: BotContext) {
  const all = await getActiveEmployees();
  const selectedIds = new Set(
    (ss(ctx).notifFilterEmpIds ?? '').split(',').filter(Boolean).map(Number),
  );
  const page = ss(ctx).notifFilterEmpPage ?? 0;
  const totalPages = Math.max(1, Math.ceil(all.length / STEP1_PAGE_SIZE));
  const pageEmps = all.slice(page * STEP1_PAGE_SIZE, (page + 1) * STEP1_PAGE_SIZE);

  const selectedCount = selectedIds.size;
  const empSummary = selectedCount === 0 ? 'все' : `${selectedCount} выбрано`;
  const text = `⚙️ Фильтр ленты · Шаг 1/3: Сотрудники\n(${empSummary})\n\nВыберите одного или нескольких. Пусто = все.`;

  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  for (const emp of pageEmps) {
    const checked = selectedIds.has(emp.id);
    keyboard.push([
      Markup.button.callback(
        `${checked ? '☑️' : '☐'} ${emp.lastName} ${emp.firstName}`,
        `nf_s1_emp_${emp.id}`,
      ),
    ]);
  }

  // Pagination within step 1
  if (totalPages > 1) {
    const nav: ReturnType<typeof Markup.button.callback>[] = [];
    if (page > 0) nav.push(Markup.button.callback('≪ Пред', 'nf_s1_emp_prev'));
    nav.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));
    if (page < totalPages - 1) nav.push(Markup.button.callback('≫ След', 'nf_s1_emp_next'));
    keyboard.push(nav);
  }

  keyboard.push([
    Markup.button.callback('🗑 Очистить', 'nf_s1_clear'),
    Markup.button.callback('Далее →', 'nf_s1_next'),
  ]);
  keyboard.push([Markup.button.callback('← Отмена', 'nf_filter_cancel')]);

  return { text, keyboard };
}

// ─── FILTER STEP 2: EVENT TYPES ─────────────────────────────────────────────

function renderStep2(ctx: BotContext) {
  const typesStr = ss(ctx).notifFilterTypes ?? '';
  const activeTypes = typesStr.length > 0 ? typesStr.split(',') : [];
  const allActive = activeTypes.length === 0;

  const text = '⚙️ Фильтр ленты · Шаг 2/3: Типы событий\n(пусто = все)';
  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  for (let i = 0; i < TYPE_BUTTONS.length; i += 2) {
    const row = TYPE_BUTTONS.slice(i, i + 2).map(({ type, label }) => {
      const on = allActive || activeTypes.includes(type);
      return Markup.button.callback(`${on ? '✅' : '☐'} ${label}`, `nf_s2_type_${type}`);
    });
    keyboard.push(row);
  }

  keyboard.push([
    Markup.button.callback('← Назад', 'nf_s2_prev'),
    Markup.button.callback('Далее →', 'nf_s2_next'),
  ]);

  return { text, keyboard };
}

// ─── FILTER STEP 3: PERIOD ──────────────────────────────────────────────────

function renderStep3(ctx: BotContext) {
  const fromStr = ss(ctx).notifFilterFrom ?? '';
  const toStr   = ss(ctx).notifFilterTo   ?? '';

  const now = todayDateUTC7();
  const todayStr    = now.toISOString().slice(0, 10);
  const yesterday   = new Date(now.getTime() - 86_400_000);
  const [wMon, wSun]   = currentWeekUTC7();
  const [lwMon, lwSun] = previousWeekUTC7();
  const [mFrom, mTo]   = currentMonthUTC7();
  const [lmFrom, lmTo] = previousMonthUTC7();

  const is = (f: string, t: string) => fromStr === f && toStr === t;
  const isAll = !fromStr && !toStr;

  const text = '⚙️ Фильтр ленты · Шаг 3/3: Период';
  const keyboard: ReturnType<typeof Markup.button.callback>[][] = [];

  keyboard.push([
    Markup.button.callback(is(todayStr, todayStr) ? '[Сегодня]' : 'Сегодня', 'nf_s3_today'),
    Markup.button.callback(is(yesterday.toISOString().slice(0,10), yesterday.toISOString().slice(0,10)) ? '[Вчера]' : 'Вчера', 'nf_s3_yesterday'),
  ]);
  keyboard.push([
    Markup.button.callback(is(wMon.toISOString().slice(0,10), wSun.toISOString().slice(0,10)) ? '[Эта неделя]' : 'Эта неделя', 'nf_s3_week'),
    Markup.button.callback(is(lwMon.toISOString().slice(0,10), lwSun.toISOString().slice(0,10)) ? '[Прошлая неделя]' : 'Прошлая неделя', 'nf_s3_last_week'),
  ]);
  keyboard.push([
    Markup.button.callback(is(mFrom.toISOString().slice(0,10), mTo.toISOString().slice(0,10)) ? '[Этот месяц]' : 'Этот месяц', 'nf_s3_month'),
    Markup.button.callback(is(lmFrom.toISOString().slice(0,10), lmTo.toISOString().slice(0,10)) ? '[Прошлый месяц]' : 'Прошлый месяц', 'nf_s3_last_month'),
  ]);
  keyboard.push([
    Markup.button.callback(isAll ? '[✓ Всё время]' : 'Всё время', 'nf_s3_all'),
  ]);
  keyboard.push([
    Markup.button.callback('← Назад', 'nf_s3_prev'),
    Markup.button.callback('✅ Применить', 'nf_s3_apply'),
  ]);

  return { text, keyboard };
}

// ─── SCENE ──────────────────────────────────────────────────────────────────

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

async function editFeed(ctx: BotContext) {
  const result = await renderFeed(ctx);
  if (!result) return;
  try {
    await ctx.editMessageText(result.text, Markup.inlineKeyboard(result.keyboard));
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

async function editStep1(ctx: BotContext) {
  const result = await renderStep1(ctx);
  try {
    await ctx.editMessageText(result.text, Markup.inlineKeyboard(result.keyboard));
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

async function editStep2(ctx: BotContext) {
  const result = renderStep2(ctx);
  try {
    await ctx.editMessageText(result.text, Markup.inlineKeyboard(result.keyboard));
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

async function editStep3(ctx: BotContext) {
  const result = renderStep3(ctx);
  try {
    await ctx.editMessageText(result.text, Markup.inlineKeyboard(result.keyboard));
  } catch {
    await ctx.reply(result.text, Markup.inlineKeyboard(result.keyboard));
  }
}

// ─── FEED ACTIONS ───────────────────────────────────────────────────────────

adminNotificationsScene.action('nf_tab_all', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifTab = 'all';
  ss(ctx).notifFilterMode = 'custom';
  ss(ctx).notifFilterEmpIds = '';
  ss(ctx).notifFilterTypes = '';
  ss(ctx).notifFilterFrom = undefined;
  ss(ctx).notifFilterTo = undefined;
  ss(ctx).notifPage = 0;
  if (ctx.employee) notificationService.markAllRead(ctx.employee.id).catch(() => {});
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_tab_push', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifTab = 'all';
  ss(ctx).notifFilterMode = 'settings';
  ss(ctx).notifPage = 0;
  if (ctx.employee) notificationService.markAllRead(ctx.employee.id).catch(() => {});
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_tab_bookmarks', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifTab = 'bookmarks';
  ss(ctx).notifPage = 0;
  await editFeed(ctx);
});

adminNotificationsScene.action(/^nf_bm_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  const notifId = parseInt((ctx.match as RegExpMatchArray)[1], 10);
  await notificationService.toggleBookmark(ctx.employee.id, notifId);
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_mark_all', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.employee) return;
  await notificationService.markAllRead(ctx.employee.id);
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_page_prev', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifPage = Math.max(0, (ss(ctx).notifPage ?? 0) - 1);
  if (ss(ctx).notifTab === 'all' && ctx.employee) notificationService.markAllRead(ctx.employee.id).catch(() => {});
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_page_next', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifPage = (ss(ctx).notifPage ?? 0) + 1;
  if (ss(ctx).notifTab === 'all' && ctx.employee) notificationService.markAllRead(ctx.employee.id).catch(() => {});
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_push_settings', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '← Лента', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_NOTIF_SETTINGS_SCENE_ID);
});

adminNotificationsScene.action('nf_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '← Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

// ─── FILTER OPEN / CANCEL ───────────────────────────────────────────────────

adminNotificationsScene.action('nf_filter_open', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterStep = 1;
  ss(ctx).notifFilterEmpPage = 0;
  await editStep1(ctx);
});

adminNotificationsScene.action('nf_filter_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await editFeed(ctx);
});

adminNotificationsScene.action('nf_filter_reset', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterEmpIds = '';
  ss(ctx).notifFilterTypes = '';
  ss(ctx).notifFilterFrom = undefined;
  ss(ctx).notifFilterTo = undefined;
  ss(ctx).notifFilterMode = 'settings';
  ss(ctx).notifPage = 0;
  await editFeed(ctx);
});

// ─── STEP 1: EMPLOYEES ──────────────────────────────────────────────────────

adminNotificationsScene.action(/^nf_s1_emp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const empId = parseInt((ctx.match as RegExpMatchArray)[1], 10);
  const current = (ss(ctx).notifFilterEmpIds ?? '').split(',').filter(Boolean);
  const idx = current.indexOf(String(empId));
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(String(empId));
  }
  ss(ctx).notifFilterEmpIds = current.join(',');
  await editStep1(ctx);
});

adminNotificationsScene.action('nf_s1_emp_prev', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterEmpPage = Math.max(0, (ss(ctx).notifFilterEmpPage ?? 0) - 1);
  await editStep1(ctx);
});

adminNotificationsScene.action('nf_s1_emp_next', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterEmpPage = (ss(ctx).notifFilterEmpPage ?? 0) + 1;
  await editStep1(ctx);
});

adminNotificationsScene.action('nf_s1_clear', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterEmpIds = '';
  await editStep1(ctx);
});

adminNotificationsScene.action('nf_s1_next', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterStep = 2;
  await editStep2(ctx);
});

// ─── STEP 2: EVENT TYPES ────────────────────────────────────────────────────

adminNotificationsScene.action(/^nf_s2_type_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const type = (ctx.match as RegExpMatchArray)[1] as TimeEntryType;
  const typesStr = ss(ctx).notifFilterTypes ?? '';
  let active: TimeEntryType[] = typesStr.length > 0 ? (typesStr.split(',') as TimeEntryType[]) : [...ALL_TYPES];

  if (active.includes(type)) {
    active = active.filter(t => t !== type);
  } else {
    active.push(type);
  }
  ss(ctx).notifFilterTypes = active.length === ALL_TYPES.length ? '' : active.join(',');
  await editStep2(ctx);
});

adminNotificationsScene.action('nf_s2_prev', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterStep = 1;
  await editStep1(ctx);
});

adminNotificationsScene.action('nf_s2_next', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterStep = 3;
  await editStep3(ctx);
});

// ─── STEP 3: PERIOD ─────────────────────────────────────────────────────────

function setPeriod(ctx: BotContext, from: string, to: string) {
  ss(ctx).notifFilterFrom = from;
  ss(ctx).notifFilterTo   = to;
}

adminNotificationsScene.action('nf_s3_today', async (ctx) => {
  await ctx.answerCbQuery();
  const d = todayDateUTC7().toISOString().slice(0, 10);
  setPeriod(ctx, d, d);
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_yesterday', async (ctx) => {
  await ctx.answerCbQuery();
  const d = new Date(todayDateUTC7().getTime() - 86_400_000).toISOString().slice(0, 10);
  setPeriod(ctx, d, d);
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_week', async (ctx) => {
  await ctx.answerCbQuery();
  const [from, to] = currentWeekUTC7();
  setPeriod(ctx, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_last_week', async (ctx) => {
  await ctx.answerCbQuery();
  const [from, to] = previousWeekUTC7();
  setPeriod(ctx, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_month', async (ctx) => {
  await ctx.answerCbQuery();
  const [from, to] = currentMonthUTC7();
  setPeriod(ctx, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_last_month', async (ctx) => {
  await ctx.answerCbQuery();
  const [from, to] = previousMonthUTC7();
  setPeriod(ctx, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_all', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterFrom = undefined;
  ss(ctx).notifFilterTo   = undefined;
  await editStep3(ctx);
});

adminNotificationsScene.action('nf_s3_prev', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterStep = 2;
  await editStep2(ctx);
});

adminNotificationsScene.action('nf_s3_apply', async (ctx) => {
  await ctx.answerCbQuery();
  ss(ctx).notifFilterMode = 'custom';
  ss(ctx).notifPage = 0;
  await editFeed(ctx);
});
