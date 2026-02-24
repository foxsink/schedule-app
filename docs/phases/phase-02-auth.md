# Этап 2: Система авторизации

## Цель
Сотрудники авторизуются по коду приглашения. Суперадмин создаётся автоматически из env. Middleware определяет пользователя по telegramId.

## Файлы

| Файл | Описание |
|---|---|
| `src/middleware/auth.ts` | Ищет Employee по `ctx.from.id` (telegramId), кладёт в `ctx.employee`. Если не найден — пропускает (для /start) |
| `src/middleware/session.ts` | Telegraf session config (in-memory или через БД) |
| `src/middleware/adminGuard.ts` | Middleware: проверяет role ADMIN или SUPER_ADMIN, иначе отклоняет |
| `src/services/employee.service.ts` | `findByTelegramId`, `findByInvitationCode`, `linkTelegram`, `create`, `deactivate`, `setRate`, `generateInvitationCode` |
| `src/scenes/start.scene.ts` | /start → если уже привязан → в меню. Если нет → запросить код → привязать → в меню |
| `src/utils/invitation.ts` | Генерация случайного 8-символьного кода (буквы+цифры) |
| `src/seed.ts` | При старте: если SUPER_ADMIN_TELEGRAM_ID задан и нет Employee с таким telegramId — создать с ролью SUPER_ADMIN |

## Критерии проверки
- При старте бота суперадмин создаётся в БД
- Админ создаёт сотрудника → генерируется код
- Сотрудник вводит код → привязывается telegramId → попадает в меню
- Повторный /start → сразу в меню (без повторной авторизации)
