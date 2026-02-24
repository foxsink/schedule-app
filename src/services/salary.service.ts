import { prisma } from '../prisma';
import { TimeEntryType } from '@prisma/client';

export interface DaySalary {
  date: string; // YYYY-MM-DD
  netHours: number;
  rate: number;
  amount: number;
}

export interface SalaryResult {
  employeeId: number;
  firstName: string;
  lastName: string;
  days: DaySalary[];
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

    const entries = await prisma.timeEntry.findMany({
      where: { employeeId, date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { timestamp: 'asc' }],
    });

    // Group by date
    const byDate = new Map<string, typeof entries>();
    for (const e of entries) {
      const key = e.date.toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(e);
    }

    const days: DaySalary[] = [];
    let totalWorkedMs = 0;
    let grossSalary = 0;

    for (const [dateKey, dayEntries] of byDate) {
      const date = new Date(`${dateKey}T00:00:00.000Z`);
      const types = dayEntries.map((e) => e.type);

      if (types.includes(TimeEntryType.SICK_LEAVE)) {
        days.push({ date: dateKey, netHours: 0, rate: 0, amount: 0 });
        continue;
      }

      const get = (t: TimeEntryType) => dayEntries.find((e) => e.type === t);
      const workStart = get(TimeEntryType.WORK_START);
      const workEnd = get(TimeEntryType.WORK_END);
      if (!workStart || !workEnd) continue;

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

      days.push({ date: dateKey, netHours: Math.round(netHours * 100) / 100, rate, amount: Math.round(amount * 100) / 100 });
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
