import XlsxPopulate from 'xlsx-populate';
import { prisma } from '../prisma';
import { salaryService } from './salary.service';
import { formatDate } from '../utils/time';
import { TimeEntryType } from '../generated/prisma/client';

type XlsSheet = ReturnType<Awaited<ReturnType<typeof XlsxPopulate.fromBlankAsync>>['sheet']>;

const HEADER_FILL = { type: 'solid' as const, color: 'D9E1F2' };
const COLOR_GREEN = '2E7D32';
const COLOR_RED   = 'C62828';

function setupHeaders(sheet: XlsSheet, headers: string[], widths: number[]) {
  headers.forEach((h, i) => {
    sheet.cell(1, i + 1).value(h).style({ bold: true, fill: HEADER_FILL });
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

    const wb = await XlsxPopulate.fromBlankAsync();

    // ── Sheet 1: Зарплаты ──────────────────────────────────────────────────────
    const salarySheet = wb.sheet(0);
    salarySheet.name('Зарплаты');

    const SALARY_HEADERS  = ['Сотрудник', 'Часы', 'Ставка (руб/ч)', 'Начислено', 'Премии', 'Штрафы', 'Итого'];
    const SALARY_WIDTHS   = [25, 10, 16, 14, 12, 12, 14];
    setupHeaders(salarySheet, SALARY_HEADERS, SALARY_WIDTHS);

    let salaryRow = 2;
    for (const r of results) {
      const avgRate = r.totalWorkedHours > 0
        ? Math.round((r.grossSalary / r.totalWorkedHours) * 100) / 100
        : 0;
      const vals = [
        `${r.lastName} ${r.firstName}`,
        r.totalWorkedHours,
        avgRate,
        r.grossSalary,
        r.bonuses,
        r.penalties,
        r.netSalary,
      ];
      vals.forEach((v, i) => salarySheet.cell(salaryRow, i + 1).value(v));
      salaryRow++;
    }

    // Totals row
    const totalsRowNum = salaryRow;
    const totalsVals = [
      'ИТОГО',
      results.reduce((s, r) => s + r.totalWorkedHours, 0),
      '',
      results.reduce((s, r) => s + r.grossSalary, 0),
      results.reduce((s, r) => s + r.bonuses, 0),
      results.reduce((s, r) => s + r.penalties, 0),
      results.reduce((s, r) => s + r.netSalary, 0),
    ];
    totalsVals.forEach((v, i) => salarySheet.cell(totalsRowNum, i + 1).value(v !== '' ? v : null));
    salarySheet.range(`A${totalsRowNum}:G${totalsRowNum}`).style({ bold: true });

    // ── Sheet 2: Детализация ───────────────────────────────────────────────────
    const detailSheet = wb.addSheet('Детализация');

    const DETAIL_HEADERS = ['Дата', 'Сотрудник', 'Начало', 'Конец', 'Обед (ч)', 'Отлучки (ч)', 'Часы', 'Ставка', 'Сумма', 'Премии', 'Штрафы'];
    const DETAIL_WIDTHS  = [14, 25, 10, 10, 10, 12, 8, 10, 12, 12, 12];
    setupHeaders(detailSheet, DETAIL_HEADERS, DETAIL_WIDTHS);

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

        const isSick  = entries.some((e) => e.type === TimeEntryType.SICK_LEAVE);
        const dayAdj  = adjByDate.get(day.date);

        const vals: unknown[] = [
          formatDate(date),
          `${result.lastName} ${result.firstName}`,
          day.workStart ?? (isSick ? 'Больничный' : '—'),
          day.workEnd   ?? '—',
          Math.round((lunchMs  / 3_600_000) * 100) / 100 || null,
          Math.round((leavesMs / 3_600_000) * 100) / 100 || null,
          day.netHours || null,
          day.rate     || null,
          day.amount   || null,
          dayAdj?.bonuses   || null,
          dayAdj?.penalties || null,
        ];
        vals.forEach((v, i) => detailSheet.cell(detailRow, i + 1).value(v));
        detailRow++;
      }
    }

    // ── Sheet 3: Корректировки ─────────────────────────────────────────────────
    const adjSheet = wb.addSheet('Корректировки');

    const ADJ_HEADERS = ['Дата', 'Сотрудник', 'Тип', 'Сумма', 'Описание'];
    const ADJ_WIDTHS  = [14, 25, 12, 12, 40];
    setupHeaders(adjSheet, ADJ_HEADERS, ADJ_WIDTHS);

    let adjRow = 2;
    for (const result of results) {
      for (const a of result.adjustments) {
        const dateObj = new Date(`${a.date}T00:00:00.000Z`);
        const isBonus = a.type === 'BONUS';
        const color   = isBonus ? COLOR_GREEN : COLOR_RED;

        const vals = [
          formatDate(dateObj),
          `${result.lastName} ${result.firstName}`,
          isBonus ? 'Премия' : 'Штраф',
          a.amount,
          a.reason,
        ];
        vals.forEach((v, i) => adjSheet.cell(adjRow, i + 1).value(v));
        // Highlight type and amount cells
        adjSheet.cell(adjRow, 3).style({ fontColor: color });
        adjSheet.cell(adjRow, 4).style({ fontColor: color });
        adjRow++;
      }
    }

    const buf = await wb.outputAsync();
    return Buffer.from(buf as ArrayBuffer);
  },
};
