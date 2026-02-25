import { config } from '../config';

const OFFSET_MS = config.TZ_OFFSET * 60 * 60 * 1000;

/** Current datetime in UTC+7 */
export function nowUTC7(): Date {
  return new Date(Date.now() + OFFSET_MS);
}

/** Convert UTC Date to UTC+7 Date object */
export function toUTC7(date: Date): Date {
  return new Date(date.getTime() + OFFSET_MS);
}

/** Format time as HH:MM */
export function formatTime(date: Date): string {
  const d = toUTC7(date);
  return d.toISOString().slice(11, 16);
}

/** Format date as DD.MM.YYYY */
export function formatDate(date: Date): string {
  const d = toUTC7(date);
  const [y, m, day] = d.toISOString().slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
}

/** Convert local UTC+7 date+time input to UTC Date for storage */
export function localInputToUtc(dateStr: string, hours: number, minutes: number): Date {
  return new Date(
    new Date(`${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`).getTime() - OFFSET_MS
  );
}

/** Start of day in UTC+7 (as UTC Date, for DB queries) */
export function startOfDayUTC7(date?: Date): Date {
  const d = date ? toUTC7(date) : nowUTC7();
  const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return new Date(`${iso}T00:00:00.000Z`);
}

/** End of day in UTC+7 (as UTC Date, for DB queries) */
export function endOfDayUTC7(date?: Date): Date {
  const d = date ? toUTC7(date) : nowUTC7();
  const iso = d.toISOString().slice(0, 10);
  return new Date(`${iso}T23:59:59.999Z`);
}

/** Get YYYY-MM-DD string in UTC+7 for use as date field */
export function todayDateUTC7(): Date {
  const iso = nowUTC7().toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Returns [monday, sunday] of the current UTC+7 week (Mon–Sun). */
export function currentWeekUTC7(): [Date, Date] {
  const now = nowUTC7();
  const diff = (now.getUTCDay() + 6) % 7; // days since Monday
  const mondayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - diff * 86_400_000;
  return [new Date(mondayMs), new Date(mondayMs + 6 * 86_400_000)];
}

/** Returns [monday, sunday] of the previous UTC+7 week (Mon–Sun). */
export function previousWeekUTC7(): [Date, Date] {
  const [mon] = currentWeekUTC7();
  const prevMondayMs = mon.getTime() - 7 * 86_400_000;
  return [new Date(prevMondayMs), new Date(prevMondayMs + 6 * 86_400_000)];
}
