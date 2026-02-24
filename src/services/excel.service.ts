import ExcelJS from 'exceljs';
import { prisma } from '../prisma';
import { salaryService } from './salary.service';
import { formatDate, formatTime } from '../utils/time';
import { TimeEntryType } from '@prisma/client';

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
      { header: 'Дата',       key: 'date',       width: 14 },
      { header: 'Сотрудник',  key: 'name',       width: 25 },
      { header: 'Начало',     key: 'start',      width: 10 },
      { header: 'Конец',      key: 'end',        width: 10 },
      { header: 'Обед (ч)',   key: 'lunch',      width: 10 },
      { header: 'Отлучки (ч)',key: 'leaves',     width: 12 },
      { header: 'Часы',       key: 'hours',      width: 8  },
      { header: 'Ставка',     key: 'rate',       width: 10 },
      { header: 'Сумма',      key: 'amount',     width: 12 },
    ];

    const detailHeaderRow = detailSheet.getRow(1);
    detailHeaderRow.font = { bold: true };
    detailHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

    for (const result of results) {
      for (const day of result.days) {
        // Fetch raw entries for lunch/leave detail
        const date = new Date(`${day.date}T00:00:00.000Z`);
        const entries = await prisma.timeEntry.findMany({
          where: { employeeId: result.employeeId, date },
          orderBy: { timestamp: 'asc' },
        });
        const get = (t: TimeEntryType) => entries.find((e) => e.type === t);

        const workStart = get(TimeEntryType.WORK_START);
        const workEnd   = get(TimeEntryType.WORK_END);
        const lunchS    = get(TimeEntryType.LUNCH_START);
        const lunchE    = get(TimeEntryType.LUNCH_END);

        const lunchMs = lunchS && lunchE ? lunchE.timestamp.getTime() - lunchS.timestamp.getTime() : 0;
        const plStarts = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_START);
        const plEnds   = entries.filter((e) => e.type === TimeEntryType.PERSONAL_LEAVE_END);
        let leavesMs = 0;
        for (let i = 0; i < Math.min(plStarts.length, plEnds.length); i++) {
          leavesMs += plEnds[i].timestamp.getTime() - plStarts[i].timestamp.getTime();
        }

        const isSick = entries.some((e) => e.type === TimeEntryType.SICK_LEAVE);

        detailSheet.addRow({
          date:   formatDate(date),
          name:   `${result.lastName} ${result.firstName}`,
          start:  workStart ? formatTime(workStart.timestamp) : (isSick ? 'Больничный' : '—'),
          end:    workEnd   ? formatTime(workEnd.timestamp)   : '—',
          lunch:  Math.round((lunchMs  / 3_600_000) * 100) / 100 || '',
          leaves: Math.round((leavesMs / 3_600_000) * 100) / 100 || '',
          hours:  day.netHours || '',
          rate:   day.rate     || '',
          amount: day.amount   || '',
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  },
};
