import { Markup } from 'telegraf';

export const PERIOD_KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.callback('Сегодня', 'rpt_today'),
    Markup.button.callback('Эта неделя', 'rpt_week'),
  ],
  [
    Markup.button.callback('Этот месяц', 'rpt_month'),
    Markup.button.callback('Ввести даты', 'rpt_custom'),
  ],
  [Markup.button.callback('« Назад', 'rpt_back')],
]);
