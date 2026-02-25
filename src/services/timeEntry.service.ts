import { prisma } from '../prisma';
import { AuditAction, AuditEntityType, TimeEntryType } from '../generated/prisma/client';
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
    // entries ordered by timestamp ASC
    const entries = await this.getTodayEntries(employeeId);
    const types = entries.map((e) => e.type);

    if (types.includes(TimeEntryType.SICK_LEAVE)) return [];

    const workStarts = entries.filter((e) => e.type === TimeEntryType.WORK_START);
    const workEnds = entries.filter((e) => e.type === TimeEntryType.WORK_END);
    const lastWorkStart = workStarts[workStarts.length - 1];
    const lastWorkEnd = workEnds[workEnds.length - 1];

    // Shift complete: last WORK_END comes after last WORK_START (normal same-day close)
    if (lastWorkStart && lastWorkEnd && lastWorkStart.timestamp.getTime() < lastWorkEnd.timestamp.getTime()) {
      return [];
    }

    if (!lastWorkStart) {
      // No WORK_START today — check cross-midnight scenario
      const yesterday = new Date(todayDateUTC7().getTime() - 86_400_000);
      const prevEntries = await prisma.timeEntry.findMany({
        where: { employeeId, date: yesterday },
        orderBy: { timestamp: 'asc' },
      });

      // Use timestamp ordering to detect open shift — handles double cross-midnight
      // (yesterday may have WORK_END from a prior cross-midnight close + new WORK_START)
      const prevWorkStarts = prevEntries.filter((e) => e.type === TimeEntryType.WORK_START);
      const prevWorkEnds = prevEntries.filter((e) => e.type === TimeEntryType.WORK_END);
      const prevLastWorkStart = prevWorkStarts[prevWorkStarts.length - 1];
      const prevLastWorkEnd = prevWorkEnds[prevWorkEnds.length - 1];

      // todayHasCrossMidnightEnd: today has WORK_END (from closing yesterday's night shift)
      const todayHasCrossMidnightEnd = !!lastWorkEnd;
      const prevShiftOpen =
        !!prevLastWorkStart &&
        (!prevLastWorkEnd || prevLastWorkStart.timestamp.getTime() > prevLastWorkEnd.timestamp.getTime()) &&
        !todayHasCrossMidnightEnd;

      if (!prevShiftOpen) {
        return ['work_start', 'sick_leave'];
      }

      // Cross-midnight shift still in progress:
      // Only count entries from the current shift (at or after prevLastWorkStart)
      const prevCurrentEntries = prevEntries.filter(
        (e) => e.timestamp.getTime() >= prevLastWorkStart.timestamp.getTime(),
      );
      const allTypes = [...prevCurrentEntries.map((e) => e.type), ...types];
      const countAll = (t: TimeEntryType) => allTypes.filter((x) => x === t).length;

      const lunchOpen = countAll(TimeEntryType.LUNCH_START) > countAll(TimeEntryType.LUNCH_END);
      const leaveOpen =
        countAll(TimeEntryType.PERSONAL_LEAVE_START) > countAll(TimeEntryType.PERSONAL_LEAVE_END);

      if (lunchOpen) return ['lunch_end'];
      if (leaveOpen) return ['personal_leave_end'];

      // Cross-midnight shift in progress and we are on the next calendar day:
      // only allow ending the shift — no new lunch/leave until the shift is properly closed.
      return ['work_end'];
    }

    // WORK_START exists today and shift is in progress (lastWorkStart is after lastWorkEnd or no WORK_END yet).
    // Only consider entries from the CURRENT shift (at or after lastWorkStart).
    const currentEntries = entries.filter(
      (e) => e.timestamp.getTime() >= lastWorkStart.timestamp.getTime(),
    );
    const currentTypes = currentEntries.map((e) => e.type);
    const hasC = (t: TimeEntryType) => currentTypes.includes(t);

    if (hasC(TimeEntryType.LUNCH_START) && !hasC(TimeEntryType.LUNCH_END)) {
      return ['lunch_end'];
    }

    if (hasC(TimeEntryType.PERSONAL_LEAVE_START)) {
      const starts = currentTypes.filter((t) => t === TimeEntryType.PERSONAL_LEAVE_START).length;
      const ends = currentTypes.filter((t) => t === TimeEntryType.PERSONAL_LEAVE_END).length;
      if (starts > ends) return ['personal_leave_end'];
    }

    const actions: AvailableAction[] = [];
    if (!hasC(TimeEntryType.LUNCH_START)) actions.push('lunch_start');
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
