# QR Analytics Streamlit MVP

Чистий Streamlit MVP для створення QR-кодів і постійного трекінгу сканів.

## Як це працює

QR-код веде не напряму на YouTube/презентацію, а на tracking URL:

```txt
https://your-app.streamlit.app/?scan=<slug>
```

Коли людина сканує QR:

1. Streamlit відкриває tracking URL.
2. Додаток записує scan у базу.
3. Додаток робить redirect на фінальний URL з UTM-мітками.

Так QR-код можна друкувати або вставляти у відео надовго: фінальний URL можна змінити, а сам QR лишається тим самим.

## Важливо про базу

Для локального запуску додаток може використовувати SQLite-файл `qr_analytics_local.db`.

Для Streamlit Community Cloud потрібна зовнішня база, бо локальні файли на Streamlit Cloud не гарантують постійне збереження. Найпростіші варіанти:

- Neon Postgres;
- Supabase Postgres.

## Локальний запуск

```bash
cd qr-streamlit
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run streamlit_app.py
```

Без `DATABASE_URL` буде створено локальну SQLite-базу.

## Деплой на Streamlit Community Cloud

1. Завантаж файли `qr-streamlit/` у GitHub repo.
2. Відкрий https://share.streamlit.io/new.
3. Обери repo, branch і файл `streamlit_app.py`.
4. У secrets додай:

```toml
DATABASE_URL = "postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require"
PUBLIC_BASE_URL = "https://your-app-name.streamlit.app"
```

5. Натисни Deploy.

## Структура таблиць

Додаток сам створює таблиці:

- `qr_codes`: QR-коди, фінальні URL, UTM, статус;
- `scans`: час скану, referrer з query string, user agent з query string, device/browser якщо передані.

## Обмеження Streamlit-версії

Streamlit не є класичним backend API, тому referrer і user agent браузера не завжди доступні напряму. Для MVP ми надійно зберігаємо scan timestamp, QR, статус і URL. Referrer/device/browser можна передавати додатковими query params або пізніше винести redirect endpoint у FastAPI/Cloudflare Worker.
