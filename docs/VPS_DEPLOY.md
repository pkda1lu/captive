# VPS deployment

Ниже полный вариант для Ubuntu 22.04/24.04 на чистом VPS.

В примерах используются:

- Домен портала: `portal.example.com`
- IP VPS: `203.0.113.10`
- Папка проекта на VPS: `/opt/captive`
- Пользователь сервиса: `captive`
- NAS ID роутера: `router-01`

Замените эти значения на свои.

## 1. DNS

У регистратора или в DNS-панели создайте A-запись:

```text
portal.example.com -> 203.0.113.10
```

Проверьте с локальной машины:

```bash
nslookup portal.example.com
```

Должен вернуться IP вашего VPS.

## 2. Подготовка сервера

Зайдите на VPS:

```bash
ssh root@203.0.113.10
```

Обновите систему и поставьте пакеты:

```bash
apt update
apt upgrade -y
apt install -y curl git ufw freeradius freeradius-utils
```

Установите Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

Установите Caddy:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

## 3. Firewall

Откройте SSH, HTTP/HTTPS и RADIUS:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 1812/udp
ufw allow 1813/udp
ufw --force enable
ufw status verbose
```

Если у VPS-провайдера есть внешний firewall/security group, откройте там те же порты:

```text
TCP 22
TCP 80
TCP 443
UDP 1812
UDP 1813
```

## 4. Загрузка проекта

Создайте пользователя и папку:

```bash
useradd --system --home /opt/captive --shell /usr/sbin/nologin captive
mkdir -p /opt/captive
chown captive:captive /opt/captive
```

Загрузите проект одним из вариантов.

Через git:

```bash
git clone YOUR_REPOSITORY_URL /opt/captive
chown -R captive:captive /opt/captive
```

Или через `scp` с вашей машины:

```bash
scp -r C:/Users/anotr/Documents/captive root@203.0.113.10:/opt/captive
ssh root@203.0.113.10
chown -R captive:captive /opt/captive
```

Если проект попал как `/opt/captive/captive`, перенесите содержимое в `/opt/captive`.

## 5. Генерация секретов

На VPS:

```bash
cd /opt/captive
npm run generate:config -- portal.example.com 203.0.113.10 router-01
```

Сохраните вывод. Из него нужны:

- `UAM Secret`
- `RADIUS Secret`
- значения для полей роутера
- блок `FreeRADIUS client block`

## 6. .env для портала

Создайте файл:

```bash
nano /opt/captive/.env
```

Пример:

```env
PORT=8080
HOST=127.0.0.1
ACCESS_TTL_MINUTES=480
DEFAULT_USERNAME=guest
DEFAULT_PASSWORD=guest
PORTAL_HOST=portal.example.com
UAM_SECRET=PASTE_GENERATED_UAM_SECRET
RADIUS_SECRET=PASTE_GENERATED_RADIUS_SECRET
```

Права:

```bash
chown captive:captive /opt/captive/.env
chmod 600 /opt/captive/.env
mkdir -p /opt/captive/data
chown -R captive:captive /opt/captive/data
```

## 7. systemd сервис портала

Скопируйте unit:

```bash
cp /opt/captive/deploy/systemd/captive-portal.service /etc/systemd/system/captive-portal.service
systemctl daemon-reload
systemctl enable --now captive-portal
systemctl status captive-portal
```

Проверка локально на VPS:

```bash
curl -i http://127.0.0.1:8080/
curl -s http://127.0.0.1:8080/api/uam
```

Ожидаемо `/api/uam` вернет:

```json
{"username":"guest","password":"guest"}
```

## 8. HTTPS через Caddy

Создайте Caddy env:

```bash
mkdir -p /etc/caddy
printf 'PORTAL_HOST=portal.example.com\n' > /etc/caddy/env
```

Подключите env в systemd override:

```bash
systemctl edit caddy
```

Вставьте:

```ini
[Service]
EnvironmentFile=/etc/caddy/env
```

Скопируйте Caddyfile:

```bash
cp /opt/captive/deploy/caddy-vps.Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl restart caddy
systemctl status caddy
```

Проверка с любой машины:

```bash
curl -I https://portal.example.com/
```

Должен быть HTTP `200`.

## 9. FreeRADIUS

Сделайте резервные копии:

```bash
cp /etc/freeradius/3.0/clients.conf /etc/freeradius/3.0/clients.conf.bak
cp /etc/freeradius/3.0/mods-config/files/authorize /etc/freeradius/3.0/mods-config/files/authorize.bak
```

В конец `/etc/freeradius/3.0/clients.conf` добавьте роутер:

```bash
nano /etc/freeradius/3.0/clients.conf
```

Пример:

```text
client router_01 {
  ipaddr = ROUTER_PUBLIC_WAN_IP
  secret = PASTE_GENERATED_RADIUS_SECRET
  nas_type = other
}
```

`ROUTER_PUBLIC_WAN_IP` - публичный WAN IP роутера/площадки, откуда он будет обращаться к VPS.

В начало `/etc/freeradius/3.0/mods-config/files/authorize` добавьте:

```text
DEFAULT Auth-Type := Accept
  Reply-Message := "Access granted",
  Session-Timeout := 28800
```

Перезапустите:

```bash
systemctl restart freeradius
systemctl status freeradius
```

Локальная проверка RADIUS на VPS:

```bash
radtest guest guest 127.0.0.1 0 PASTE_GENERATED_RADIUS_SECRET
```

Если проверка с `127.0.0.1` не проходит, добавьте или проверьте `client localhost` в `clients.conf`.

Для отладки:

```bash
systemctl stop freeradius
freeradius -X
```

Потом в другом SSH-окне повторите `radtest`. После отладки верните сервис:

```bash
systemctl start freeradius
```

## 10. Настройки роутера

В поля captive portal на роутере:

```text
UAM Server: https://portal.example.com/
UAM Secret: PASTE_GENERATED_UAM_SECRET
RADIUS-сервер 1: 203.0.113.10
RADIUS-сервер 2: пусто
RADIUS Secret: PASTE_GENERATED_RADIUS_SECRET
RADIUS NAS ID: router-01
RADIUS location name: Main location
RADIUS location ID: main-01
DNS 1: 1.1.1.1
DNS 2: 8.8.8.8
```

Если есть поля `UAM Allowed`, `Walled Garden`, `Allowed Hosts` или похожие, добавьте:

```text
portal.example.com
203.0.113.10
```

Иначе клиент может не открыть портал до авторизации.

## 11. Проверка полного цикла

1. Подключитесь телефоном/ноутбуком к гостевой Wi-Fi.
2. Откройте `http://neverssl.com/`.
3. Роутер должен перенаправить на `https://portal.example.com/`.
4. Нажмите кнопку доступа.
5. Роутер должен получить `Access-Accept` от RADIUS и открыть интернет.

На VPS смотрите логи:

```bash
journalctl -u captive-portal -f
journalctl -u caddy -f
journalctl -u freeradius -f
```

## 12. Частые проблемы

Портал не открывается до авторизации:

- Добавьте домен/IP портала в `UAM Allowed` или `Walled Garden`.
- Проверьте DNS в роутере.
- Проверьте, что `https://portal.example.com/` доступен извне.

RADIUS не отвечает:

- Проверьте UDP `1812` у VPS-провайдера и в `ufw`.
- Проверьте публичный WAN IP роутера в `clients.conf`.
- Проверьте совпадение `RADIUS Secret` на роутере и VPS.
- Запустите `freeradius -X` и смотрите живой лог.

После кнопки доступа интернет не появляется:

- Проверьте, какой URL и параметры роутер передает порталу.
- Некоторые роутеры требуют CHAP/MD5 UAM flow, а не простой `username/password`.
- Пришлите модель роутера и redirect URL, тогда форму можно адаптировать точно.
