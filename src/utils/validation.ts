/** Parse "HH:MM" → { hours, minutes } or null */
export function parseTime(str: string): { hours: number; minutes: number } | null {
  const match = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** Parse "DD.MM.YYYY" → UTC Date (midnight) or null */
export function parseDate(str: string): Date | null {
  const match = str.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return isNaN(date.getTime()) ? null : date;
}

/** Check that timestamps are in ascending order */
export function isValidTimeSequence(timestamps: Date[]): boolean {
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i].getTime() <= timestamps[i - 1].getTime()) return false;
  }
  return true;
}
