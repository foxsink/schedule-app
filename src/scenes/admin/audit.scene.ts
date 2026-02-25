import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { prisma } from '../../prisma';
import { formatDate, formatTime, toUTC7 } from '../../utils/time';
import { AuditAction, AuditEntityType } from '../../generated/prisma/client';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';

export const ADMIN_AUDIT_SCENE_ID = 'admin_audit';

const PAGE_SIZE = 10;

const ACTION_ICONS: Record<AuditAction, string> = {
  CREATE: '+',
  UPDATE: '|',
  DELETE: 'x',
};

const ENTITY_LABELS: Record<AuditEntityType, string> = {
  TIME_ENTRY: 'TIME_ENTRY',
  SALARY_ADJUSTMENT: 'SALARY_ADJUSTMENT',
  EMPLOYEE: 'EMPLOYEE',
  EMPLOYEE_RATE: 'EMPLOYEE_RATE',
};

function formatAuditEntry(log: {
  id: number;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number;
  createdAt: Date;
  previousData: unknown;
  newData: unknown;
  editor: { firstName: string; lastName: string };
}): string {
  const dt = toUTC7(log.createdAt);
  const dateStr = formatDate(dt);
  const timeStr = formatTime(log.createdAt);
  const editorName = `${log.editor.lastName} ${log.editor.firstName}`;
  const icon = ACTION_ICONS[log.action];
  const entity = `${ENTITY_LABELS[log.entityType]} #${log.entityId}`;

  const lines = [
    `${dateStr} ${timeStr} | ${editorName}`,
    `  [${icon}] ${entity}`,
  ];

  const prev = log.previousData as Record<string, unknown> | null;
  const next = log.newData as Record<string, unknown> | null;

  if (prev && typeof prev === 'object') {
    lines.push(`  Было: ${JSON.stringify(prev)}`);
  }
  if (next && typeof next === 'object') {
    lines.push(`  Стало: ${JSON.stringify(next)}`);
  }

  return lines.join('\n');
}

/** Escape _ and * so Telegram Markdown doesn't treat them as italic/bold (e.g. in SALARY_ADJUSTMENT, JSON). */
function escapeMarkdownBody(s: string): string {
  return s.split('*').join('\\*').split('_').join('\\_');
}

async function showAuditPage(ctx: BotContext, page: number): Promise<void> {
  const total = await prisma.auditLog.count();
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    skip: safePage * PAGE_SIZE,
    take: PAGE_SIZE,
    include: { editor: { select: { firstName: true, lastName: true } } },
  });

  if (logs.length === 0) {
    await ctx.reply('Аудит-лог пуст.');
    return;
  }

  const title = `*Аудит-лог* (стр. ${safePage + 1}/${Math.max(totalPages, 1)})\nПометки: + создание, | изменение, x удаление`;
  const body = logs.map((log) => escapeMarkdownBody(formatAuditEntry(log))).join('\n');
  const text = [title, '', body].join('\n');

  const navButtons: ReturnType<typeof Markup.button.callback>[] = [];
  if (safePage > 0) navButtons.push(Markup.button.callback('<< Пред', `audit_page_${safePage - 1}`));
  if (safePage < totalPages - 1) navButtons.push(Markup.button.callback('След >>', `audit_page_${safePage + 1}`));

  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  if (navButtons.length) rows.push(navButtons);
  rows.push([Markup.button.callback('« Назад', 'audit_back'), Markup.button.callback('📋 Меню', 'go_menu')]);

  // Send in chunks if too long
  const chunks = text.length > 3800 ? [text.slice(0, 3800)] : [text];
  for (let i = 0; i < chunks.length - 1; i++) {
    await ctx.reply(chunks[i], { parse_mode: 'Markdown' });
  }
  await ctx.reply(chunks[chunks.length - 1], { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) });
}

export const adminAuditScene = new Scenes.BaseScene<BotContext>(ADMIN_AUDIT_SCENE_ID);

adminAuditScene.enter(async (ctx) => {
  if (ctx.employee?.role !== 'SUPER_ADMIN') {
    await ctx.reply('Нет доступа.');
    return ctx.scene.leave();
  }
  await showAuditPage(ctx, 0);
});

adminAuditScene.action(/^audit_page_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  await showAuditPage(ctx, parseInt(ctx.match[1], 10));
});

adminAuditScene.action('audit_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '📋 Меню', callback_data: 'go_menu' }]] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
