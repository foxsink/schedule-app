# Этап 10: Docker, Webhook и продакшн

## Цель
Финализация Docker-образа, поддержка webhook-режима, graceful shutdown.

## Задачи

1. **Dockerfile (multi-stage):**
   - Stage 1 (build): `npm ci`, `npx prisma generate`, `npm run build`
   - Stage 2 (runtime): копировать dist + node_modules + prisma → минимальный образ
2. **docker-compose.yml:**
   - `postgres`: volume для данных, healthcheck
   - `bot`: зависит от postgres (condition: service_healthy), env_file
   - `entrypoint.sh`: `npx prisma migrate deploy && node dist/index.js`
3. **BOT_MODE switch (index.ts):**
   - `polling`: `bot.launch()` — для разработки
   - `webhook`: `bot.launch({ webhook: { domain, port, path } })` — для прода
4. **Graceful shutdown:**
   - SIGINT/SIGTERM → `bot.stop()`, `prisma.$disconnect()`
5. **.env.example** — все переменные с комментариями

## Переменные окружения
```
BOT_TOKEN=            # Telegram Bot API token
DATABASE_URL=         # postgres://user:pass@host:5432/db
BOT_MODE=polling      # polling | webhook
WEBHOOK_DOMAIN=       # https://example.com (для webhook)
WEBHOOK_PATH=/webhook # путь для webhook
PORT=3000             # порт для webhook сервера
SUPER_ADMIN_TELEGRAM_ID=  # Telegram ID суперадмина
```

## Критерии проверки
- `docker-compose up --build` — полный запуск с нуля
- Миграции применяются автоматически
- Бот работает в polling-режиме
- Переключение на webhook (с WEBHOOK_DOMAIN)
- Graceful shutdown без ошибок
