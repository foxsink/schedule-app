# Этап 6: Админ — Редактирование записей

## Цель
Админ может добавлять, изменять и удалять записи учёта времени. Все изменения записываются в AuditLog.

## Файлы

| Файл | Описание |
|---|---|
| `src/services/timeEntry.service.ts` | Расширение: `updateEntry`, `deleteEntry`, `createEntryManual` — все с записью в аудит |
| `src/services/audit.service.ts` | `log(editorId, action, entityType, entityId, previousData?, newData?)` |
| `src/scenes/admin/edit.wizard.ts` | Wizard: выбор сотрудника → выбор даты → список записей → действие (изменить время / удалить / добавить новую) |
| `src/utils/validation.ts` | `parseTime(str)`, `parseDate(str)`, `isValidTimeSequence(entries)` |

## Аудит
При каждом изменении записи:
- `previousData`: JSON с предыдущим состоянием (или null для CREATE)
- `newData`: JSON с новым состоянием (или null для DELETE)
- `editorId`: кто внёс изменение

## Критерии проверки
- Админ изменяет время записи → AuditLog содержит old/new данные
- Админ удаляет запись → AuditLog фиксирует удаление
- Админ добавляет запись вручную → AuditLog фиксирует создание
