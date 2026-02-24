# Этап 1: Каркас проекта и инфраструктура

## Цель
Создать базовую структуру проекта, настроить сборку, Docker, БД, чтобы `docker-compose up` запускал PostgreSQL + бот, а `/start` отвечал.

## Файлы

| Файл | Описание |
|---|---|
| `package.json` | Зависимости: telegraf, prisma, @prisma/client, dotenv. Dev: typescript, ts-node, nodemon |
| `tsconfig.json` | target: ES2022, module: commonjs, outDir: dist, strict: true |
| `.env.example` | BOT_TOKEN, DATABASE_URL, BOT_MODE, SUPER_ADMIN_TELEGRAM_ID, WEBHOOK_DOMAIN, PORT |
| `.gitignore` | node_modules, dist, .env, prisma/*.db |
| `Dockerfile` | Multi-stage: build + runtime |
| `docker-compose.yml` | Сервисы: postgres (5432), bot (зависит от postgres) |
| `prisma/schema.prisma` | Все модели: Employee, EmployeeRate, TimeEntry, SalaryAdjustment, AuditLog + enums |
| `src/config.ts` | Чтение env переменных, экспорт констант (TZ_OFFSET=7, и т.д.) |
| `src/prisma.ts` | PrismaClient singleton |
| `src/types/context.ts` | Расширенный Telegraf контекст с session и employee |
| `src/bot.ts` | Создание Telegraf инстанса, подключение middleware stage |
| `src/index.ts` | Entry point: polling или webhook в зависимости от BOT_MODE |

## Критерии проверки
- `npm install` без ошибок
- `npx prisma generate` без ошибок
- `docker-compose up --build` запускает PostgreSQL и бот
- Бот отвечает на /start (заглушка)
