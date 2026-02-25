import ExcelJS from 'exceljs';
import { prisma } from '../prisma';
import { salaryService } from './salary.service';
import { formatDate } from '../utils/time';
import { TimeEntryType } from '../generated/prisma/client';

export const excelService = {
  async generateSalaryReport(from: Date, to: Date): Promise<Buffer> {
    const employees = await prisma.employee.findMany({
      where: { isActive: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const results = await Promise.all(
      employees.map((e) => salaryService.calculateSalary(e.id, from, to))
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ScheduleBot';
    workbook.created = new Date();

    // ── Sheet 1: Зарплаты ──────────────────────────────────────────────────────
    const salarySheet = workbook.addWorksheet('Зарплаты');

    salarySheet.columns = [
      { header: 'Сотрудник',      key: 'name',        width: 25 },
      { header: 'Часы',           key: 'hours',        width: 10 },
      { header: 'Ставка (руб/ч)', key: 'rate',         width: 16 },
      { header: 'Начислено',      key: 'gross',        width: 14 },
      { header: 'Премии',         key: 'bonuses',      width: 12 },
      { header: 'Штрафы',         key: 'penalties',    width: 12 },
      { header: 'Итого',          key: 'total',        width: 14 },
    ];

    // Header style
    const headerRow = salarySheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    for (const r of results) {
      const avgRate = r.totalWorkedHours > 0 ? Math.round((r.grossSalary / r.totalWorkedHours) * 100) / 100 : 0;
      salarySheet.addRow({
        name:      `${r.lastName} ${r.firstName}`,
        hours:     r.totalWorkedHours,
        rate:      avgRate,
        gross:     r.grossSalary,
        bonuses:   r.bonuses,
        penalties: r.penalties,
        total:     r.netSalary,
      });
    }

    // Totals row
    const totalsRow = salarySheet.addRow({
      name:      'ИТОГО',
      hours:     results.reduce((s, r) => s + r.totalWorkedHours, 0),
      gross:     results.reduce((s, r) => s + r.grossSalary, 0),
      bonuses:   results.reduce((s, r) => s + r.bonuses, 0),
      penalties: results.reduce((s, r) => s + r.penalties, 0),
      total:     results.reduce((s, r) => s + r.netSalary, 0),
    });
    totalsRow.font = { bold: true };

    // ── Sheet 2: Детализация ───────────────────────────────────────────────────
    const detailSheet = workbook.addWorksheet('Детализация');

    detailSheet.columns = [
      { header: 'Дата',        key: 'date',       width: 14 },
      { header: 'Сотрудник',   key: 'name',       width: 25 },
      { header: 'Начало',      key: 'start',      width: 10 },
      { header: 'Конец',       key: 'end',        width: 10 },
      { header: 'Обед (ч)',    key: 'lunch',      width: 10 },
      { header: 'Отлучки (ч)', key: 'leaves',     width: 12 },
      { header: 'Часы',        key: 'hours',      width: 8  },
      { header: 'Ставка',      key: 'rate',       width: 10 },
      { header: 'Сумма',       key: 'amount',     width: 12 },
      { header: 'Премии',      key: 'bonuses',    width: 12 },
      { header: 'Штрафы',      key: 'penalties',  width: 12 },
    ];

    const detailHeaderRow = detailSheet.getRow(1);
    detailHeaderRow.font = { bold: true };
    detailHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    for (const result of results) {
      // Sorted list of shift day dates for fallback lookup
      const dayDates = result.days.map((d) => d.date).sort();

      // Index adjustments by date. If adjustment date has no matching shift day,
      // attach it to the closest preceding shift day (or the first day if none precede it).
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

        detailSheet.addRow({
          date:      formatDate(date),
          name:      `${result.lastName} ${result.firstName}`,
          // Use pre-computed times from salary service (handles cross-midnight correctly)
          start:     day.workStart ?? (isSick ? 'Больничный' : '—'),
          end:       day.workEnd   ?? '—',
          lunch:     Math.round((lunchMs  / 3_600_000) * 100) / 100 || '',
          leaves:    Math.round((leavesMs / 3_600_000) * 100) / 100 || '',
          hours:     day.netHours || '',
          rate:      day.rate     || '',
          amount:    day.amount   || '',
          bonuses:   dayAdj?.bonuses   || '',
          penalties: dayAdj?.penalties || '',
        });
      }
    }

    // ── Sheet 3: Корректировки ─────────────────────────────────────────────────
    const adjSheet = workbook.addWorksheet('Корректировки');

    adjSheet.columns = [
      { header: 'Дата',       key: 'date',    width: 14 },
      { header: 'Сотрудник',  key: 'name',    width: 25 },
      { header: 'Тип',        key: 'type',    width: 12 },
      { header: 'Сумма',      key: 'amount',  width: 12 },
      { header: 'Описание',   key: 'reason',  width: 40 },
    ];

    const adjHeaderRow = adjSheet.getRow(1);
    adjHeaderRow.font = { bold: true };
    adjHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    for (const result of results) {
      for (const a of result.adjustments) {
        const dateObj = new Date(`${a.date}T00:00:00.000Z`);
        const row = adjSheet.addRow({
          date:   formatDate(dateObj),
          name:   `${result.lastName} ${result.firstName}`,
          type:   a.type === 'BONUS' ? 'Премия' : 'Штраф',
          amount: a.amount,
          reason: a.reason,
        });
        // Highlight bonuses green, penalties red
        const typeCell = row.getCell('type');
        const amountCell = row.getCell('amount');
        if (a.type === 'BONUS') {
          typeCell.font = { color: { argb: 'FF2E7D32' } };
          amountCell.font = { color: { argb: 'FF2E7D32' } };
        } else {
          typeCell.font = { color: { argb: 'FFC62828' } };
          amountCell.font = { color: { argb: 'FFC62828' } };
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  },
};
