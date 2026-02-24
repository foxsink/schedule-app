import { prisma } from '../prisma';
import { TimeEntryType } from '@prisma/client';
import { todayDateUTC7, formatTime } from '../utils/time';

export type EmployeeStatus =
  | { kind: 'not_started' }
  | { kind: 'working'; since: string }
  | { kind: 'lunch'; since: string }
  | { kind: 'personal_leave'; since: string }
  | { kind: 'done'; start: string; end: string; hours: string }
  | { kind: 'sick' };

export interface DayScheduleEntry {
  id: number;
  firstName: string;
  lastName: string;
  status: EmployeeStatus;
}

export interface PeriodReportEntry {
  employeeId: number;
  firstName: string;
  lastName: string;
  totalMs: number;
  dayCount: number;
}

function calcMs(entries: Array<{ type: TimeEntryType; timestamp: Date }>): number {
  const get = (type: TimeEntryType) => entries.find((e) => e.type === type);
  const workStart = get(TimeEntryType.WORK_START);
  const workEnd = get(TimeEntryType.WORK_END);
  if (!workStart || !workEnd) return 0;

  let ms = workEnd.timestamp.getTime() - workStart.timestamp.getTime();

  const ls = get(TimeEntryType.LUNCH_START);
  const le = get(TimeEntryType.LUNCH_END);
  if (ls && le) ms -= le.timestamp.getTime() - ls.timestamp.getTime();

  const plStarts = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START);
  const plEnds = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END);
  const pairs = Math.min(plStarts.length, plEnds.length);
  for (let i = 0; i < pairs; i++) {
    ms -= plEnds[i].timestamp.getTime() - plStarts[i].timestamp.getTime();
  }

  return ms > 0 ? ms : 0;
}

export function msToHoursStr(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}

export const reportService = {
  async getDaySchedule(date?: Date): Promise<DayScheduleEntry[]> {
    const targetDate = date ?? todayDateUTC7();

    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      include: {
        timeEntries: {
          where: { date: targetDate },
          orderBy: { timestamp: 'asc' },
        },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return employees.map((emp) => {
      const entries = emp.timeEntries;
      const types = entries.map((e) => e.type);
      const get = (type: TimeEntryType) => entries.find((e) => e.type === type);

      let status: EmployeeStatus;

      if (types.includes(TimeEntryType.SICK_LEAVE)) {
        status = { kind: 'sick' };
      } else if (types.includes(TimeEntryType.WORK_END)) {
        const workStart = get(TimeEntryType.WORK_START)!;
        const workEnd = get(TimeEntryType.WORK_END)!;
        const ms = calcMs(entries);
        status = {
          kind: 'done',
          start: formatTime(workStart.timestamp),
          end: formatTime(workEnd.timestamp),
          hours: msToHoursStr(ms),
        };
      } else if (types.includes(TimeEntryType.LUNCH_START) && !types.includes(TimeEntryType.LUNCH_END)) {
        const ls = get(TimeEntryType.LUNCH_START)!;
        status = { kind: 'lunch', since: formatTime(ls.timestamp) };
      } else if (types.includes(TimeEntryType.PERSONAL_LEAVE_START)) {
        const plStarts = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START);
        const plEnds = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END);
        if (plStarts.length > plEnds.length) {
          status = { kind: 'personal_leave', since: formatTime(plStarts[plStarts.length - 1].timestamp) };
        } else {
          const ws = get(TimeEntryType.WORK_START)!;
          status = { kind: 'working', since: formatTime(ws.timestamp) };
        }
      } else if (types.includes(TimeEntryType.WORK_START)) {
        const ws = get(TimeEntryType.WORK_START)!;
        status = { kind: 'working', since: formatTime(ws.timestamp) };
      } else {
        status = { kind: 'not_started' };
      }

      return { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, status };
    });
  },

  async getPeriodReport(from: Date, to: Date, employeeId?: number): Promise<PeriodReportEntry[]> {
    const entries = await prisma.timeEntry.findMany({
      where: {
        date: { gte: from, lte: to },
        ...(employeeId !== undefined ? { employeeId } : {}),
        employee: { isActive: true },
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: [{ employeeId: 'asc' }, { date: 'asc' }, { timestamp: 'asc' }],
    });

    // Group by (employeeId, date)
    const byEmpDay = new Map<string, { entries: typeof entries; employee: { id: number; firstName: string; lastName: string } }>();
    for (const entry of entries) {
      const key = `${entry.employeeId}::${entry.date.toISOString().slice(0, 10)}`;
      if (!byEmpDay.has(key)) byEmpDay.set(key, { entries: [], employee: entry.employee });
      byEmpDay.get(key)!.entries.push(entry);
    }

    // Aggregate per employee
    const byEmp = new Map<number, { employee: { id: number; firstName: string; lastName: string }; totalMs: number; dayCount: number }>();
    for (const { entries: dayEntries, employee } of byEmpDay.values()) {
      if (!byEmp.has(employee.id)) byEmp.set(employee.id, { employee, totalMs: 0, dayCount: 0 });
      const agg = byEmp.get(employee.id)!;
      agg.dayCount++;
      const types = dayEntries.map((e) => e.type);
      if (!types.includes(TimeEntryType.SICK_LEAVE)) {
        agg.totalMs += calcMs(dayEntries);
      }
    }

    return Array.from(byEmp.values())
      .map(({ employee, totalMs, dayCount }) => ({
        employeeId: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        totalMs,
        dayCount,
      }))
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  },
};
