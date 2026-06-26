# Simple Captive Portal

Минимальный внешний captive portal для схемы `UAM Server + RADIUS`.

Такой режим обычно работает так:

1. Клиент подключается к Wi-Fi.
2. Роутер блокирует интернет и перенаправляет клиента на внешний `UAM Server`.
3. Эта страница показывает кнопку доступа.
4. После нажатия страница отправляет клиента обратно на `loginurl` роутера.
5. Роутер проверяет логин/пароль через RADIUS на VPS.
6. Если RADIUS отвечает `Access-Accept`, роутер открывает клиенту интернет.

## Быстрый локальный запуск

```powershell
npm start
```

По умолчанию сервер слушает `0.0.0.0:8080`.

## Сгенерировать данные для роутера

```powershell
npm run generate:config -- captiveozon.online 159.194.215.125 router-01
```

Где:

- `captiveozon.online` - домен портала на VPS.
- `159.194.215.125` - публичный IP VPS.
- `router-01` - NAS ID для этого роутера.

Команда выведет значения для полей роутера и `.env`.

## Поля на роутере

Для формы со скриншота:

```text
UAM Server: https://captiveozon.online/
UAM Secret: значение из npm run generate:config
RADIUS-сервер 1: публичный IP VPS
RADIUS-сервер 2: пусто
RADIUS Secret: значение из npm run generate:config
RADIUS NAS ID: router-01
RADIUS location name: Main location
RADIUS location ID: main-01
DNS 1: 1.1.1.1
DNS 2: 8.8.8.8
```

`RADIUS-сервер 2` нужен только если есть второй VPS.

## VPS

Полная инструкция для чистой Ubuntu VPS лежит в [docs/VPS_DEPLOY.md](C:/Users/anotr/Documents/captive/docs/VPS_DEPLOY.md).

На VPS нужны:

- Домен, A-запись на публичный IP VPS.
- Открытые TCP-порты `80` и `443` для портала.
- Открытые UDP-порты `1812` и `1813` для RADIUS.
- Node.js 18+ или Docker.
- FreeRADIUS, если роутер требует RADIUS.

Пример Docker Compose лежит в [deploy/docker-compose.yml](C:/Users/anotr/Documents/captive/deploy/docker-compose.yml).

Перед запуском:

1. Скопируйте [.env.example](C:/Users/anotr/Documents/captive/.env.example) в `.env`.
2. Впишите `PORTAL_HOST`, `UAM_SECRET`, `RADIUS_SECRET`.
3. В [deploy/freeradius/clients.conf](C:/Users/anotr/Documents/captive/deploy/freeradius/clients.conf) замените `ROUTER_PUBLIC_WAN_IP` на публичный WAN IP роутера.
4. В том же файле замените `replace-with-generated-radius-secret`.

Запуск на VPS из папки проекта:

```bash
docker compose -f deploy/docker-compose.yml --env-file .env up -d
```

## Что делает текущий портал

- `GET /` показывает страницу входа.
- Если роутер передал `loginurl`, страница отправляет клиента обратно на роутер с `username/password`.
- `GET /api/uam` отдает гостевые учетные данные из `.env`.
- `POST /api/access` оставлен для локального режима без RADIUS.
- `GET /api/status` показывает локальный статус.

По умолчанию портал использует:

```env
DEFAULT_USERNAME=guest
DEFAULT_PASSWORD=guest
```

Эти же данные должен принимать RADIUS. В текущем примере FreeRADIUS принимает любого пользователя через `DEFAULT Auth-Type := Accept`.

## Важные ограничения

Внешний VPS не может сам открыть интернет клиенту в вашей локальной сети. Это делает роутер после успешного RADIUS-ответа.

Если роутер требует CHAP/MD5 UAM flow вместо простого `username/password` POST на `loginurl`, нужно будет адаптировать форму под конкретную модель роутера. Для этого нужны модель роутера и пример URL, на который он редиректит клиента.
