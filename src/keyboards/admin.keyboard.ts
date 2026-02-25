import { Markup } from 'telegraf';

export const PERIOD_KEYBOARD = Markup.inlineKeyboard([
  [
    Markup.button.callback('Сегодня', 'rpt_today'),
    Markup.button.callback('Вчера', 'rpt_yesterday'),
  ],
  [
    Markup.button.callback('Эта неделя', 'rpt_week'),
    Markup.button.callback('Прошлая неделя', 'rpt_last_week'),
  ],
  [
    Markup.button.callback('Этот месяц', 'rpt_month'),
    Markup.button.callback('Ввести даты', 'rpt_custom'),
  ],
  [Markup.button.callback('« Назад', 'rpt_back'), Markup.button.callback('📋 Меню', 'go_menu')],
]);
