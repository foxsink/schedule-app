# Этап 7: Админ — Управление сотрудниками и зарплата

## Цель
Админ управляет сотрудниками (создание, ставки, деактивация) и считает зарплаты с премиями/штрафами.

## Файлы

| Файл | Описание |
|---|---|
| `src/scenes/admin/manage.scene.ts` | Управление: список сотрудников → создать нового (имя+фамилия) → код приглашения. Установить ставку. Деактивировать. Добавить по Telegram ID напрямую |
| `src/services/salary.service.ts` | `calculateSalary(employeeId, from, to)` — часы × ставка на дату + премии - штрафы. `getRateForDate(employeeId, date)` |
| `src/scenes/admin/salary.wizard.ts` | Wizard: выбор сотрудника (или все) → период → показать расчёт. Кнопки: добавить премию / штраф |

## Расчёт зарплаты (подробно)
```
Для каждого рабочего дня в периоде:
  1. Получить записи TimeEntry за день
  2. Если SICK_LEAVE → 0 часов, 0 руб
  3. Рассчитать рабочее время:
     work_time = WORK_END.timestamp - WORK_START.timestamp
     lunch_time = Σ(LUNCH_END - LUNCH_START)
     personal_time = Σ(PERSONAL_LEAVE_END - PERSONAL_LEAVE_START)
     net_hours = (work_time - lunch_time - personal_time) / 3600
  4. Получить ставку: последний EmployeeRate где effectiveFrom <= date
  5. day_salary = net_hours × rate

period_salary = Σ(day_salary) + Σ(BONUS.amount) - Σ(PENALTY.amount)
```

## Критерии проверки
- Создание сотрудника с генерацией кода
- Установка ставки (новая запись EmployeeRate)
- Добавление премии/штрафа (SalaryAdjustment)
- Расчёт зарплаты за период с учётом ставок на дату
