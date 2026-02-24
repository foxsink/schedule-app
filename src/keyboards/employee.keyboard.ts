import { Markup } from 'telegraf';
import { AvailableAction } from '../services/timeEntry.service';

const ACTION_LABELS: Record<AvailableAction, string> = {
  work_start: '🟢 Начать день',
  lunch_start: '🍽 Обед',
  lunch_end: '✅ Конец обеда',
  personal_leave_start: '🚶 Отлучиться',
  personal_leave_end: '🔙 Вернулся',
  work_end: '🔴 Закончить день',
  sick_leave: '🤒 Больничный',
};

export function buildEmployeeKeyboard(actions: AvailableAction[]) {
  if (actions.length === 0) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📅 Мой график', 'my_schedule')],
    ]);
  }

  const actionButtons = actions.map((a) =>
    Markup.button.callback(ACTION_LABELS[a], a)
  );

  // split into rows of 2
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];
  for (let i = 0; i < actionButtons.length; i += 2) {
    rows.push(actionButtons.slice(i, i + 2));
  }
  rows.push([Markup.button.callback('📅 Мой график', 'my_schedule')]);

  return Markup.inlineKeyboard(rows);
}
