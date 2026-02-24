import { prisma } from '../prisma';
import { TimeEntryType } from '@prisma/client';
import { nowUTC7, todayDateUTC7 } from '../utils/time';

export type AvailableAction =
  | 'work_start'
  | 'lunch_start'
  | 'lunch_end'
  | 'personal_leave_start'
  | 'personal_leave_end'
  | 'work_end'
  | 'sick_leave';

export const timeEntryService = {
  async getTodayEntries(employeeId: number) {
    const date = todayDateUTC7();
    return prisma.timeEntry.findMany({
      where: { employeeId, date },
      orderBy: { timestamp: 'asc' },
    });
  },

  async getLastEntry(employeeId: number) {
    const date = todayDateUTC7();
    return prisma.timeEntry.findFirst({
      where: { employeeId, date },
      orderBy: { timestamp: 'desc' },
    });
  },

  async getAvailableActions(employeeId: number): Promise<AvailableAction[]> {
    const entries = await this.getTodayEntries(employeeId);
    const types = entries.map((e) => e.type);

    const has = (t: TimeEntryType) => types.includes(t);

    if (has(TimeEntryType.SICK_LEAVE)) return [];
    if (has(TimeEntryType.WORK_END)) return [];

    if (!has(TimeEntryType.WORK_START)) {
      return ['work_start', 'sick_leave'];
    }

    if (has(TimeEntryType.LUNCH_START) && !has(TimeEntryType.LUNCH_END)) {
      return ['lunch_end'];
    }

    if (has(TimeEntryType.PERSONAL_LEAVE_START)) {
      // count pairs to detect open personal leave
      const starts = types.filter((t) => t === TimeEntryType.PERSONAL_LEAVE_START).length;
      const ends = types.filter((t) => t === TimeEntryType.PERSONAL_LEAVE_END).length;
      if (starts > ends) return ['personal_leave_end'];
    }

    const actions: AvailableAction[] = [];
    if (!has(TimeEntryType.LUNCH_START)) actions.push('lunch_start');
    actions.push('personal_leave_start');
    actions.push('work_end');
    return actions;
  },

  async addEntry(employeeId: number, type: TimeEntryType): Promise<void> {
    const actions = await this.getAvailableActions(employeeId);

    const actionMap: Record<TimeEntryType, AvailableAction> = {
      WORK_START: 'work_start',
      LUNCH_START: 'lunch_start',
      LUNCH_END: 'lunch_end',
      PERSONAL_LEAVE_START: 'personal_leave_start',
      PERSONAL_LEAVE_END: 'personal_leave_end',
      WORK_END: 'work_end',
      SICK_LEAVE: 'sick_leave',
    };

    const requiredAction = actionMap[type];
    if (!actions.includes(requiredAction)) {
      throw new Error(`Действие недоступно: ${type}`);
    }

    const now = nowUTC7();
    const date = todayDateUTC7();

    await prisma.timeEntry.create({
      data: {
        employeeId,
        type,
        timestamp: now,
        date,
      },
    });
  },
};
