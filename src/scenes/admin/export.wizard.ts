import { Scenes, Markup } from 'telegraf';
import { BotContext } from '../../types/context';
import { excelService } from '../../services/excel.service';
import { parseDate } from '../../utils/validation';
import { formatDate, nowUTC7, todayDateUTC7 } from '../../utils/time';
import { ADMIN_MENU_SCENE_ID } from './menu.scene';

export const ADMIN_EXPORT_SCENE_ID = 'admin_export';

const PERIOD_KEYBOARD = Markup.inlineKeyboard([
  [Markup.button.callback('Эта неделя', 'exp_week'), Markup.button.callback('Этот месяц', 'exp_month')],
  [Markup.button.callback('Ввести даты', 'exp_custom')],
  [Markup.button.callback('« Назад', 'exp_back')],
]);

async function sendExcel(ctx: BotContext, from: Date, to: Date): Promise<void> {
  await ctx.reply('Генерирую файл...');
  try {
    const buffer = await excelService.generateSalaryReport(from, to);
    const filename = `salary_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.xlsx`;
    await ctx.replyWithDocument({ source: buffer, filename });
  } catch (err) {
    await ctx.reply('Ошибка при генерации файла.');
    console.error(err);
  }
}

export const adminExportWizard = new Scenes.WizardScene<BotContext>(
  ADMIN_EXPORT_SCENE_ID,

  // Step 0: period selection (enter hook shows keyboard)
  async (ctx) => {
    await ctx.reply('Выберите период из предложенных вариантов.');
  },

  // Step 1: custom start date
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) { await ctx.reply('Введите дату начала (ДД.ММ.ГГГГ):'); return; }
    const date = parseDate(ctx.message.text);
    if (!date) { await ctx.reply('Неверный формат. Введите дату начала (ДД.ММ.ГГГГ):'); return; }
    ctx.scene.session.selectedPeriodFrom = date.toISOString().slice(0, 10);
    ctx.wizard.next();
    await ctx.reply('Введите дату окончания (ДД.ММ.ГГГГ):');
  },

  // Step 2: custom end date
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) { await ctx.reply('Введите дату окончания (ДД.ММ.ГГГГ):'); return; }
    const date = parseDate(ctx.message.text);
    if (!date) { await ctx.reply('Неверный формат. Введите дату окончания (ДД.ММ.ГГГГ):'); return; }
    const fromStr = ctx.scene.session.selectedPeriodFrom;
    if (!fromStr) return ctx.scene.leave();
    const from = new Date(`${fromStr}T00:00:00.000Z`);
    if (from > date) { await ctx.reply('Дата начала позже окончания. Введите дату окончания:'); return; }
    await sendExcel(ctx, from, date);
    return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
  }
);

adminExportWizard.enter(async (ctx) => {
  await ctx.reply('Экспорт в Excel\nВыберите период:', PERIOD_KEYBOARD);
});

adminExportWizard.action('exp_week', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  const now = nowUTC7();
  const diff = (now.getUTCDay() + 6) % 7;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - diff * 86_400_000);
  await sendExcel(ctx, from, todayDateUTC7());
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminExportWizard.action('exp_month', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  const now = nowUTC7();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await sendExcel(ctx, from, todayDateUTC7());
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});

adminExportWizard.action('exp_custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.wizard.next();
  await ctx.reply('Введите дату начала (ДД.ММ.ГГГГ):');
});

adminExportWizard.action('exp_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); } catch {}
  return ctx.scene.enter(ADMIN_MENU_SCENE_ID);
});
