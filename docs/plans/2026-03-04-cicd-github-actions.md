# CI/CD GitHub Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Настроить автодеплой на сервер 107.161.154.192 при пуше в `main`.

**Architecture:** GitHub Actions SSHит на сервер, делает `git pull` + пересборку Docker-образа бота. Postgres работает на хосте (не в Docker). Бот в контейнере с `network_mode: host`.

**Tech Stack:** GitHub Actions, Docker, docker-compose, SSH

---

### Task 1: Создать docker-compose.prod.yml

**Files:**
- Create: `docker-compose.prod.yml`

**Step 1: Создать файл**

```yaml
services:
  bot:
    build: .
    env_file:
      - .env
    network_mode: host
    restart: unless-stopped
```

> `network_mode: host` — контейнер разделяет сеть хоста, `localhost` в DATABASE_URL указывает на хост-postgres.

**Step 2: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "chore: add production docker-compose"
```

---

### Task 2: Создать GitHub Actions workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Создать файл**

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /root/schedule-app
            git pull origin main
            docker compose -f docker-compose.prod.yml up -d --build
```

**Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "chore: add GitHub Actions deploy workflow"
```

---

### Task 3: Создать GitHub репо и запушить код

**Step 1: Создать приватный репо**

```bash
gh repo create schedule-app --private --source=. --remote=origin --push
```

**Step 2: Проверить**

Открыть `https://github.com/foxsink/schedule-app` — убедиться что код есть, `.env` отсутствует.

---

### Task 4: Установить Docker на сервере

**Step 1: Установить Docker**

```bash
ssh schedule-app-server '
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
'
```

**Step 2: Проверить**

```bash
ssh schedule-app-server 'docker --version'
```

---

### Task 5: Подготовить сервер — склонировать репо

**Step 1: Добавить deploy key на сервере**

```bash
ssh schedule-app-server 'ssh-keygen -t ed25519 -f ~/.ssh/deploy_key -N "" && cat ~/.ssh/deploy_key.pub'
```

Добавить полученный публичный ключ в GitHub репо → Settings → Deploy keys (read-only).

**Step 2: Склонировать репо**

```bash
ssh schedule-app-server '
GIT_SSH_COMMAND="ssh -i ~/.ssh/deploy_key" git clone git@github.com:foxsink/schedule-app.git /root/schedule-app
cp /root/.env /root/schedule-app/.env
'
```

**Step 3: Проверить**

```bash
ssh schedule-app-server 'ls /root/schedule-app/.env'
```

---

### Task 6: Добавить GitHub Secrets

В GitHub репо → Settings → Secrets → Actions, добавить:

| Secret | Значение |
|---|---|
| `SERVER_HOST` | `107.161.154.192` |
| `SERVER_USER` | `root` |
| `SSH_PRIVATE_KEY` | содержимое `~/.ssh/id_rsa` |

**Step 1: Добавить через gh CLI**

```bash
gh secret set SERVER_HOST --body "107.161.154.192" --repo foxsink/schedule-app
gh secret set SERVER_USER --body "root" --repo foxsink/schedule-app
gh secret set SSH_PRIVATE_KEY < ~/.ssh/id_rsa --repo foxsink/schedule-app
```

---

### Task 7: Первый деплой и проверка

**Step 1: Сделать пустой коммит для триггера**

```bash
git commit --allow-empty -m "chore: trigger first deploy"
git push origin main
```

**Step 2: Проверить GitHub Actions**

```bash
gh run watch --repo foxsink/schedule-app
```

Ожидаем: все шаги зелёные.

**Step 3: Проверить бота на сервере**

```bash
ssh schedule-app-server 'docker ps'
ssh schedule-app-server 'docker logs $(docker ps -q) --tail 20'
```

Ожидаем: контейнер запущен, бот подключён к Telegram.

---

### Task 8: Настроить git на сервере для pull через deploy key

Нужно чтобы `git pull` на сервере использовал deploy key.

**Step 1:**

```bash
ssh schedule-app-server '
cd /root/schedule-app
git config core.sshCommand "ssh -i ~/.ssh/deploy_key"
'
```
