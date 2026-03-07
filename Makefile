.PHONY: up down restart rebuild logs db dev
# Поднять всё (БД + бот)
up:
	docker compose up -d

# Остановить всё
down:
	docker compose down

# Перезапустить только бота (без пересборки)
restart:
	docker compose restart bot

# Пересобрать образ бота и перезапустить
rebuild:
	docker compose up -d --build bot

# Логи бота в реальном времени
logs:
	docker compose logs -f bot

# Только БД (для локальной разработки)
db:
	docker compose up -d postgres

# Локальный запуск с hot-reload (БД должна быть запущена через `make db`)
dev:
	npm run dev
