# CLI — Завантаження COBOL-програм

Інструкція для розробників та адміністраторів.

---

## Вимоги

- Node.js 18+
- Доступ до сервера конвертера
- Обліковий запис з роллю **developer** або **admin**

---

## Автентифікація

CLI підтримує два способи.

### Спосіб 1 — email і пароль (рекомендовано для CI/CD)

CLI сам логіниться і отримує токен. Нічого не потрібно готувати заздалегідь.

```bash
node cli/scan.js \
  --dir /path/to/cobol \
  --email you@company.com \
  --password yourpassword
```

### Спосіб 2 — готовий JWT-токен (для разового запуску)

Токен можна скопіювати з DevTools браузера (Application → Local Storage) або отримати через API.

```bash
node cli/scan.js \
  --dir /path/to/cobol \
  --token eyJhbGciOiJIUzI1NiIs...
```

> **Увага:** токен живе **15 хвилин**. Для довгих запусків використовуйте `--email` / `--password` — CLI отримає токен безпосередньо перед завантаженням.

---

## Усі аргументи

| Аргумент | Обов'язковий | За замовчуванням | Опис |
|----------|-------------|-----------------|------|
| `--dir` | Так | — | Директорія з файлами `.cbl` / `.cob` |
| `--name` | Ні | Назва директорії | Назва застосунку, що створюється в системі |
| `--mode` | Ні | `sequential` | `sequential` або `parallel` — порядок аналізу програм |
| `--api-url` | Ні | `http://localhost:3001` | URL сервера конвертера |
| `--email` | Так* | — | Email облікового запису (* якщо не передано `--token`) |
| `--password` | Так* | — | Пароль облікового запису (* якщо не передано `--token`) |
| `--token` | Так* | — | JWT access token (* альтернатива до email + password) |

---

## Що відбувається при запуску

1. **Автентифікація** — CLI логіниться або перевіряє переданий токен.
2. **Створення застосунку** — у системі створюється новий застосунок з вказаною назвою. Власником стає авторизований користувач.
3. **Завантаження файлів** — усі `.cbl` / `.cob` файли з директорії завантажуються по черзі.
4. **Запуск аналізу** — сервер починає аналізувати програми у вибраному режимі.
5. **Моніторинг** — CLI показує прогрес у реальному часі. По завершенні виводить `Done.`

---

## Приклади

### Мінімальний запуск

```bash
node cli/scan.js --dir ./programs --email dev@company.com --password secret
```

### З власною назвою та паралельним аналізом

```bash
node cli/scan.js \
  --dir      ./legacy-payroll \
  --name     "Payroll System v2" \
  --mode     parallel \
  --email    dev@company.com \
  --password secret
```

### Зовнішній сервер (staging/production)

```bash
node cli/scan.js \
  --dir      ./programs \
  --api-url  https://converter.company.com \
  --email    dev@company.com \
  --password secret
```

### У GitHub Actions / GitLab CI

```yaml
# .github/workflows/convert.yml
- name: Upload COBOL programs
  run: |
    node cli/scan.js \
      --dir ./cobol \
      --name "${{ github.repository }}" \
      --api-url ${{ vars.CONVERTER_URL }} \
      --email ${{ secrets.CONVERTER_EMAIL }} \
      --password ${{ secrets.CONVERTER_PASSWORD }}
```

> Зберігайте email і пароль у секретах CI/CD — не хардкодьте їх у репозиторії.

---

## Поширені помилки

**`Error: authentication required. Provide --token or --email + --password`**
Не передано жодного способу автентифікації. Додайте `--email` + `--password` або `--token`.

**`Login failed: 401`**
Неправильний email або пароль. Перевірте облікові дані або скиньте пароль у налаштуваннях профілю.

**`POST /api/applications failed: 403`**
Обліковий запис має роль **viewer** — завантаження заборонено. Зверніться до адміністратора для отримання ролі **developer**.

**`Invalid or expired token`**
Переданий токен через `--token` вже застарів (живе 15 хв). Використовуйте `--email` + `--password`.

**`No .cbl or .cob files found`**
У вказаній директорії немає COBOL-файлів. Перевірте шлях або розширення файлів.
