import { Workbook } from '@xlsx/xlsx-populate';
import type { Sheet } from '@xlsx/xlsx-populate';
import { prisma } from '../prisma';
import { salaryService } from './salary.service';
import { formatDate } from '../utils/time';
import { TimeEntryType } from '../generated/prisma/client';

const HEADER_FILL = { type: 'solid' as const, color: { rgb: 'D9E1F2' } };
const COLOR_GREEN = { rgb: '2E7D32' };
const COLOR_RED   = { rgb: 'C62828' };

function setupHeaders(sheet: Sheet, headers: string[], widths: number[]) {
  headers.forEach((h, i) => {
    sheet.cell(1, i + 1).value(h).style((s) => { s.bold(true); s.fill(HEADER_FILL); });
    sheet.column(i + 1).width(widths[i]);
  });
}

export const excelService = {
  async generateSalaryReport(from: Date, to: Date): Promise<Buffer> {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const results = await Promise.all(
      employees.map((e) => salaryService.calculateSalary(e.id, from, to))
    );

    const wb = await Workbook.fromBlank();

    // ── Sheet 1: Зарплаты ──────────────────────────────────────────────────────
    // fromBlank() always provides at least one sheet; cast away the potential undefined
    const salarySheet = wb.sheet(0)!.name('Зарплаты');

    setupHeaders(salarySheet,
      ['Сотрудник', 'Часы', 'Ср. ставка (руб/ч)', 'Начислено', 'Премии', 'Штрафы', 'Итого'],
      [25, 10, 16, 14, 12, 12, 14],
    );

    let salaryRow = 2;
    for (const r of results) {
      const workDaysWithRate = r.days.filter((d) => !d.sickLeave && d.rate > 0);
      const avgRate = workDaysWithRate.length > 0
        ? Math.round(workDaysWithRate.reduce((s, d) => s + d.rate, 0) / workDaysWithRate.length)
        : 0;
      [
        `${r.lastName} ${r.firstName}`,
        r.totalWorkedHours,
        avgRate,
        r.grossSalary,
        r.bonuses,
        r.penalties,
        r.netSalary,
      ].forEach((v, i) => salarySheet.cell(salaryRow, i + 1).value(v));
      salaryRow++;
    }

    // Totals row
    const totalsRowNum = salaryRow;
    [
      'ИТОГО',
      results.reduce((s, r) => s + r.totalWorkedHours, 0),
      null,
      results.reduce((s, r) => s + r.grossSalary, 0),
      results.reduce((s, r) => s + r.bonuses, 0),
      results.reduce((s, r) => s + r.penalties, 0),
      results.reduce((s, r) => s + r.netSalary, 0),
    ].forEach((v, i) => salarySheet.cell(totalsRowNum, i + 1).value(v));
    salarySheet.range(`A${totalsRowNum}:G${totalsRowNum}`).style((s) => s.bold(true));

    // ── Sheet 2: Детализация ───────────────────────────────────────────────────
    const detailSheet = wb.addSheet('Детализация');

    setupHeaders(detailSheet,
      ['Дата', 'Сотрудник', 'Начало', 'Конец', 'Обед (ч)', 'Отлучки (ч)', 'Часы', 'Ставка', 'Сумма', 'Премии', 'Штрафы', 'Итого'],
      [14, 25, 10, 10, 10, 12, 8, 10, 12, 12, 12, 12],
    );

    let detailRow = 2;
    for (const result of results) {
      // Sorted list of shift day dates for fallback lookup
      const dayDates = result.days.map((d) => d.date).sort();

      // Index adjustments by date; if no matching shift day, attach to closest preceding one
      const adjByDate = new Map<string, { bonuses: number; penalties: number }>();
      for (const a of result.adjustments) {
        let targetDate = a.date;
        if (dayDates.length > 0 && !dayDates.includes(targetDate)) {
          const preceding = dayDates.filter((d) => d <= a.date);
          targetDate = preceding.length > 0 ? preceding[preceding.length - 1] : dayDates[0];
        }
        if (!adjByDate.has(targetDate)) adjByDate.set(targetDate, { bonuses: 0, penalties: 0 });
        const entry = adjByDate.get(targetDate)!;
        if (a.type === 'BONUS') entry.bonuses += a.amount;
        else entry.penalties += a.amount;
      }

      for (const day of result.days) {
        const date = new Date(`${day.date}T00:00:00.000Z`);
        const entries = await prisma.timeEntry.findMany({
          where: { employeeId: result.employeeId, date },
          orderBy: { timestamp: 'asc' },
        });

        const lunchS = entries.find((e) => e.type === TimeEntryType.LUNCH_START);
        const lunchE = entries.find((e) => e.type === TimeEntryType.LUNCH_END);
        const lunchMs = lunchS && lunchE ? lunchE.timestamp.getTime() - lunchS.timestamp.getTime() : 0;

        const plStarts = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START);
        const plEnds   = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END);
        let leavesMs = 0;
        for (let i = 0; i < Math.min(plStarts.length, plEnds.length); i++) {
          leavesMs += plEnds[i].timestamp.getTime() - plStarts[i].timestamp.getTime();
        }

        const isSick = entries.some((e) => e.type === TimeEntryType.SICK_LEAVE);
        const dayAdj = adjByDate.get(day.date);

        const lunchH = Math.round((lunchMs  / 3_600_000) * 100) / 100;
        const leaveH = Math.round((leavesMs / 3_600_000) * 100) / 100;
        const dayNet = (day.amount ?? 0) + (dayAdj?.bonuses ?? 0) - (dayAdj?.penalties ?? 0);

        [
          formatDate(date),
          `${result.lastName} ${result.firstName}`,
          day.workStart ?? (isSick ? 'Больничный' : '—'),
          day.workEnd   ?? '—',
          lunchH  || null,
          leaveH  || null,
          day.netHours || null,
          day.rate     || null,
          day.amount   || null,
          dayAdj?.bonuses   || null,
          dayAdj?.penalties || null,
          dayNet || null,
        ].forEach((v, i) => detailSheet.cell(detailRow, i + 1).value(v));
        detailRow++;
      }

    }

    // ── Sheet 3: Корректировки ─────────────────────────────────────────────────
    const adjSheet = wb.addSheet('Корректировки');

    setupHeaders(adjSheet,
      ['Дата', 'Сотрудник', 'Тип', 'Сумма', 'Описание'],
      [14, 25, 12, 12, 40],
    );

    let adjRow = 2;
    for (const result of results) {
      for (const a of result.adjustments) {
        const dateObj = new Date(`${a.date}T00:00:00.000Z`);
        const isBonus = a.type === 'BONUS';
        const color   = isBonus ? COLOR_GREEN : COLOR_RED;

        [
          formatDate(dateObj),
          `${result.lastName} ${result.firstName}`,
          isBonus ? 'Премия' : 'Штраф',
          a.amount,
          a.reason,
        ].forEach((v, i) => adjSheet.cell(adjRow, i + 1).value(v));
        adjSheet.cell(adjRow, 3).style((s) => s.fontColor(color));
        adjSheet.cell(adjRow, 4).style((s) => s.fontColor(color));
        adjRow++;
      }
    }

    return wb.output('node:buffer');
  },
};
