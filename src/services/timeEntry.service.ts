import { prisma } from '../prisma';
import { AuditAction, AuditEntityType, TimeEntryType } from '@prisma/client';
import { todayDateUTC7 } from '../utils/time';
import { auditService } from './audit.service';

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
    // Cross-midnight: today has WORK_END but no WORK_START — shift ended from yesterday, allow new shift
    if (has(TimeEntryType.WORK_END) && has(TimeEntryType.WORK_START)) return [];

    if (!has(TimeEntryType.WORK_START)) {
      // Check if previous day's shift is still open (cross-midnight)
      const yesterday = new Date(todayDateUTC7().getTime() - 86_400_000);
      const prevEntries = await prisma.timeEntry.findMany({ where: { employeeId, date: yesterday } });
      const prevTypes = prevEntries.map((e) => e.type);
      // Cross-midnight shift is closed if today has WORK_END without a matching WORK_START
      const todayHasCrossMidnightEnd =
        types.includes(TimeEntryType.WORK_END) && !types.includes(TimeEntryType.WORK_START);
      const prevShiftOpen =
        prevTypes.includes(TimeEntryType.WORK_START) &&
        !prevTypes.includes(TimeEntryType.WORK_END) &&
        !todayHasCrossMidnightEnd;

      if (!prevShiftOpen) {
        return ['work_start', 'sick_leave'];
      }

      // Cross-midnight: combine prev+today for lunch/leave state
      const allTypes = [...prevTypes, ...types];
      const countAll = (t: TimeEntryType) => allTypes.filter((x) => x === t).length;

      const lunchOpen = countAll(TimeEntryType.LUNCH_START) > countAll(TimeEntryType.LUNCH_END);
      const leaveOpen =
        countAll(TimeEntryType.PERSONAL_LEAVE_START) > countAll(TimeEntryType.PERSONAL_LEAVE_END);

      if (lunchOpen) return ['lunch_end'];
      if (leaveOpen) return ['personal_leave_end'];

      const actions: AvailableAction[] = [];
      if (countAll(TimeEntryType.LUNCH_START) === 0) actions.push('lunch_start');
      actions.push('personal_leave_start');
      actions.push('work_end');
      return actions;
    }

    // Normal flow (today has WORK_START)
    if (has(TimeEntryType.LUNCH_START) && !has(TimeEntryType.LUNCH_END)) {
      return ['lunch_end'];
    }

    if (has(TimeEntryType.PERSONAL_LEAVE_START)) {
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

    const date = todayDateUTC7();

    await prisma.timeEntry.create({
      data: {
        employeeId,
        type,
        timestamp: new Date(), // actual UTC for storage
        date,
      },
    });
  },

  async getEntriesByDate(employeeId: number, date: Date) {
    return prisma.timeEntry.findMany({
      where: { employeeId, date },
      orderBy: { timestamp: 'asc' },
    });
  },

  async createEntryManual(
    editorId: number,
    employeeId: number,
    type: TimeEntryType,
    timestamp: Date,
    date: Date
  ) {
    const entry = await prisma.timeEntry.create({
      data: { employeeId, type, timestamp, date },
    });
    await auditService.log(
      editorId,
      AuditAction.CREATE,
      AuditEntityType.TIME_ENTRY,
      entry.id,
      null,
      { id: entry.id, employeeId, type, timestamp, date }
    );
    return entry;
  },

  async updateEntry(editorId: number, entryId: number, newTimestamp: Date) {
    const old = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    const updated = await prisma.timeEntry.update({
      where: { id: entryId },
      data: { timestamp: newTimestamp },
    });
    await auditService.log(
      editorId,
      AuditAction.UPDATE,
      AuditEntityType.TIME_ENTRY,
      entryId,
      { id: old.id, type: old.type, timestamp: old.timestamp },
      { id: updated.id, type: updated.type, timestamp: newTimestamp }
    );
    return updated;
  },

  async deleteEntry(editorId: number, entryId: number) {
    const old = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } });
    await prisma.timeEntry.delete({ where: { id: entryId } });
    await auditService.log(
      editorId,
      AuditAction.DELETE,
      AuditEntityType.TIME_ENTRY,
      entryId,
      { id: old.id, type: old.type, timestamp: old.timestamp },
      null
    );
  },
};
