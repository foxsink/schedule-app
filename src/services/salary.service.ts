import { prisma } from '../prisma';
import { AdjustmentType, TimeEntryType } from '@prisma/client';
import { formatTime } from '../utils/time';

export interface DaySalary {
  date: string; // YYYY-MM-DD (calendar date of entries)
  shiftStartDate?: string; // YYYY-MM-DD — set when shift started on previous calendar day (cross-midnight Case C)
  netHours: number;
  rate: number;
  amount: number;
  sickLeave?: boolean;
  workStart?: string;
  workEnd?: string;
  lunchStart?: string;
  lunchEnd?: string;
}

export interface AdjustmentItem {
  type: AdjustmentType;
  amount: number;
  date: string;
  reason: string;
}

export interface SalaryResult {
  employeeId: number;
  firstName: string;
  lastName: string;
  days: DaySalary[];
  adjustments: AdjustmentItem[];
  totalWorkedHours: number;
  grossSalary: number;
  bonuses: number;
  penalties: number;
  netSalary: number;
}

export const salaryService = {
  async getRateForDate(employeeId: number, date: Date): Promise<number> {
    const rate = await prisma.employeeRate.findFirst({
      where: {
        employeeId,
        effectiveFrom: { lte: date },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rate ? Number(rate.rate) : 0;
  },

  async calculateSalary(employeeId: number, from: Date, to: Date): Promise<SalaryResult> {
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: employeeId },
    });

    // Extend range by 1 day in each direction to detect cross-midnight shifts
    const fromExtended = new Date(from.getTime() - 86_400_000);
    const toExtended = new Date(to.getTime() + 86_400_000);

    const entries = await prisma.timeEntry.findMany({
      where: { employeeId, date: { gte: fromExtended, lte: toExtended } },
      orderBy: [{ date: 'asc' }, { timestamp: 'asc' }],
    });

    // Group by date
    const byDate = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = e.date.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(e);
    }

    const sortedDates = Array.from(byDate.keys()).sort();
    // Track WORK_END entries consumed by the previous day (cross-midnight case)
    const consumedEntryIds = new Set<number>();

    const days: DaySalary[] = [];
    let totalWorkedMs = 0;
    let grossSalary = 0;

    for (const dateKey of sortedDates) {
      const date = new Date(`${dateKey}T00:00:00.000Z`);
      // Days outside the range are processed for cross-midnight consumption only
      const isInRange = date >= from && date <= to;

      const dayEntries = byDate.get(dateKey)!;
      const types = dayEntries.map((e) => e.type);

      if (types.includes(TimeEntryType.SICK_LEAVE)) {
        if (isInRange) days.push({ date: dateKey, netHours: 0, rate: 0, amount: 0, sickLeave: true });
        continue;
      }

      const get = (t: TimeEntryType) =>
        dayEntries.find((e) => e.type === t && !consumedEntryIds.has(e.id));

      let workStart = get(TimeEntryType.WORK_START);
      let workEnd = get(TimeEntryType.WORK_END);

      // Cross-midnight case A: WORK_END is on same calendar day but its timestamp
      // is earlier than WORK_START — the shift started the previous day and ended after midnight.
      // Mark this WORK_END as consumed so the previous day can claim it via Case B.
      if (workStart && workEnd && workEnd.timestamp.getTime() < workStart.timestamp.getTime()) {
        const prevDateKey = new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10);
        const prevDayEntries = byDate.get(prevDateKey) ?? [];
        const prevHasStart = prevDayEntries.some(
          (e) => e.type === TimeEntryType.WORK_START && !consumedEntryIds.has(e.id),
        );
        const prevHasEnd = prevDayEntries.some(
          (e) => e.type === TimeEntryType.WORK_END && !consumedEntryIds.has(e.id),
        );
        if (prevHasStart && !prevHasEnd) {
          consumedEntryIds.add(workEnd.id);
          workEnd = undefined;
        }
      }

      // Cross-midnight case B: WORK_END recorded on next calendar day.
      // Only consume when this day is in range; otherwise leave the entry for Case C below.
      if (workStart && !workEnd && isInRange) {
        const nextDateKey = new Date(date.getTime() + 86_400_000).toISOString().slice(0, 10);
        const nextDayEntries = byDate.get(nextDateKey) ?? [];
        const crossDayEnd = nextDayEntries.find(
          (e) => e.type === TimeEntryType.WORK_END && !consumedEntryIds.has(e.id),
        );
        if (crossDayEnd) {
          workEnd = crossDayEnd;
          consumedEntryIds.add(crossDayEnd.id);
        }
      }

      // Cross-midnight case C: WORK_START is on previous calendar day.
      // Handles reports where only the WORK_END day is in range.
      let shiftStartDate: string | undefined;
      if (!workStart && workEnd && isInRange) {
        const prevDateKey = new Date(date.getTime() - 86_400_000).toISOString().slice(0, 10);
        const prevDayEntries = byDate.get(prevDateKey) ?? [];
        const crossDayStart = prevDayEntries.find(
          (e) => e.type === TimeEntryType.WORK_START && !consumedEntryIds.has(e.id),
        );
        if (crossDayStart) {
          consumedEntryIds.add(crossDayStart.id);
          workStart = crossDayStart;
          shiftStartDate = prevDateKey;
        }
      }

      if (!workStart || !workEnd) continue;

      if (!isInRange) continue;

      let ms = workEnd.timestamp.getTime() - workStart.timestamp.getTime();

      const ls = get(TimeEntryType.LUNCH_START);
      const le = get(TimeEntryType.LUNCH_END);
      if (ls && le) ms -= le.timestamp.getTime() - ls.timestamp.getTime();

      const plStarts = dayEntries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START);
      const plEnds = dayEntries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END);
      const pairs = Math.min(plStarts.length, plEnds.length);
      for (let i = 0; i < pairs; i++) {
        ms -= plEnds[i].timestamp.getTime() - plStarts[i].timestamp.getTime();
      }
      if (ms < 0) ms = 0;

      const netHours = ms / 3_600_000;
      const rate = await this.getRateForDate(employeeId, date);
      const amount = netHours * rate;

      totalWorkedMs += ms;
      grossSalary += amount;

      days.push({
        date: dateKey,
        shiftStartDate,
        netHours: Math.round(netHours * 100) / 100,
        rate,
        amount: Math.round(amount * 100) / 100,
        workStart: formatTime(workStart.timestamp),
        workEnd: formatTime(workEnd.timestamp),
        lunchStart: ls ? formatTime(ls.timestamp) : undefined,
        lunchEnd: le ? formatTime(le.timestamp) : undefined,
      });
    }

    // Adjustments in period
    const adjustments = await prisma.salaryAdjustment.findMany({
      where: { employeeId, date: { gte: from, lte: to } },
    });

    const bonuses = adjustments
      .filter((a) => a.type === 'BONUS')
      .reduce((s, a) => s + Number(a.amount), 0);
    const penalties = adjustments
      .filter((a) => a.type === 'PENALTY')
      .reduce((s, a) => s + Number(a.amount), 0);

    return {
      employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      days,
      adjustments: adjustments.map((a) => ({
        type: a.type,
        amount: Number(a.amount),
        date: a.date.toISOString().slice(0, 10),
        reason: a.reason,
      })),
      totalWorkedHours: Math.round((totalWorkedMs / 3_600_000) * 100) / 100,
      grossSalary: Math.round(grossSalary * 100) / 100,
      bonuses: Math.round(bonuses * 100) / 100,
      penalties: Math.round(penalties * 100) / 100,
      netSalary: Math.round((grossSalary + bonuses - penalties) * 100) / 100,
    };
  },

  async addAdjustment(
    employeeId: number,
    type: 'BONUS' | 'PENALTY',
    amount: number,
    date: Date,
    reason: string
  ) {
    return prisma.salaryAdjustment.create({
      data: { employeeId, type, amount, date, reason },
    });
  },
};
