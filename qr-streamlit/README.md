# QR Analytics Streamlit MVP with Google Sheets

Streamlit MVP для довгоживучих QR-кодів, де Google Sheet використовується як проста база даних.

## Як це працює

QR-код веде не напряму на YouTube/презентацію, а на tracking URL:

```txt
https://your-app.streamlit.app/?scan=<slug>
```

Коли людина сканує QR:

1. Streamlit відкриває tracking URL.
2. Додаток записує scan у Google Sheet.
3. Додаток робить redirect на фінальний URL з UTM-мітками.

Так QR-код можна друкувати або вставляти у відео надовго: фінальний URL можна змінити, а сам QR лишається тим самим.

## Google Sheet як база

Додаток сам створить два листи у таблиці:

- `qr_codes`: QR-коди, фінальні URL, UTM, статус;
- `scans`: кожен скан окремим рядком.

Це не така надійна база як Postgres, але для внутрішнього MVP і помірної кількості сканів це нормальний практичний варіант. Головний плюс: таблиця лишається у твоєму Google Drive.

## Налаштування Google Sheet

1. Створи нову Google Таблицю.
2. Скопіюй spreadsheet ID з URL:

```txt
https://docs.google.com/spreadsheets/d/<GOOGLE_SHEET_ID>/edit
```

3. Натисни Share і дай Editor-доступ сервісному акаунту:

```txt
academyocean-keywords@academyocean-keywords.iam.gserviceaccount.com
```

4. У Streamlit Secrets додай `GOOGLE_SHEET_ID`, `PUBLIC_BASE_URL` і credentials з JSON.

## Streamlit Secrets

У Streamlit Community Cloud відкрий App settings -> Secrets і встав:

```toml
GOOGLE_SHEET_ID = "paste_spreadsheet_id_here"
PUBLIC_BASE_URL = "https://your-app-name.streamlit.app"

[google_service_account]
type = "service_account"
project_id = "academyocean-keywords"
private_key_id = "..."
private_key = """-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"""
client_email = "academyocean-keywords@academyocean-keywords.iam.gserviceaccount.com"
client_id = "..."
auth_uri = "https://accounts.google.com/o/oauth2/auth"
token_uri = "https://oauth2.googleapis.com/token"
auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
client_x509_cert_url = "..."
universe_domain = "googleapis.com"
```

Не коміть реальний JSON-ключ у GitHub.

## Локальний запуск

Можна використати JSON-файл локально без копіювання в repo:

```bash
cd qr-streamlit
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export GOOGLE_SHEET_ID="paste_spreadsheet_id_here"
export GOOGLE_SERVICE_ACCOUNT_FILE="/Users/sojik/Desktop/academyocean-keywords-f0b8f91b5cd1.json"
export PUBLIC_BASE_URL="http://localhost:8501"

streamlit run streamlit_app.py
```

## Деплой на Streamlit Community Cloud

1. Відкрий https://share.streamlit.io/new.
2. Repo: `kostia-s920/codex_chatGPT`
3. Branch: `codex/qr-streamlit-mvp`
4. Main file path: `qr-streamlit/streamlit_app.py`
5. Додай Secrets як вище.
6. Deploy.

## Обмеження цього підходу

Google Sheets підходить для MVP і помірного трафіку. Якщо QR-коди почнуть отримувати багато сканів на день або потрібна максимальна надійність redirect endpoint, тоді наступний крок: Cloudflare Worker + база. Але почати з Google Sheet зараз абсолютно можна.
