# Threads → Telegram Autonomous Insight Agent

Production-ready TypeScript agent that monitors **Meta Threads**, filters high-signal posts, generates AI insights, and sends curated updates to Telegram.

## Features

- Playwright scraper for Threads keywords and creator pages
- Engagement + language filtering (English/Ukrainian)
- OpenAI classification and insight extraction
- Telegram Bot API delivery with structured format
- SQLite persistence (duplicate prevention + audit trail)
- Cron mode (every 2 hours by default) + manual modes
- Multi-agent profiles (`kostya`, `vova`)
- Dockerized local deployment with persistent SQLite volume

---

## Project Structure

```txt
/config
  /profiles
    kostya.json
    vova.json
/src
  /agent
  /config
  /db
  /integrations
  /processor
  /scraper
  /telegram
  index.ts
```

---

## Local Setup

### 1) Install dependencies

```bash
npm install
```

### 2) Install Playwright browser

```bash
npx playwright install chromium
```

### 3) Configure env

```bash
cp .env.example .env
```

Fill required values:
- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Optional:
- `AGENT_PROFILE=kostya` or `AGENT_PROFILE=vova`
- `THREADS_KEYWORDS`, `THREADS_CREATORS`
- `ENGAGEMENT_LIKES_THRESHOLD`, `MIN_REPLY_RATIO`

### 4) Quick compile check

```bash
npm run typecheck
npm run build
```

---

## Pre-flight checklist

Run these exact commands before first real run:

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run typecheck
npm run build
npm run scrape-only
npm run test-telegram
npm run run-once
```

If all pass, start scheduler:

```bash
npm run cron
```

---

## Run Modes

### Cron mode (default)

Runs every 2 hours (`CRON_SCHEDULE`) and can run immediately on startup.

```bash
npm run cron
# or
npm run dev
```

### Manual one-shot mode

Scrape → filter → OpenAI → Telegram → save to DB, then exit.

```bash
npm run run-once
```

### Scrape-only debug mode

Scrapes and prints normalized posts JSON only (no OpenAI, no Telegram).

```bash
npm run scrape-only
```

Enable scraper artifacts/logging (screenshot + HTML under `debug/`):

```bash
SCRAPER_DEBUG=true npm run scrape-only
```

### Telegram test command

Sends a short test message to validate bot token and chat ID.

```bash
npm run test-telegram
```

---

## Docker Setup

### Run with Docker Compose

```bash
docker compose up --build -d
```

### Watch logs

```bash
docker compose logs -f threads-agent
```

### Stop

```bash
docker compose down
```

SQLite is persisted via named volume:
- `threads_agent_data` → mounted at `/app/data`
- DB path inside container forced to `/app/data/threads-agent.db`

The container runs cron mode by default.

---

## Agent Profiles

Profiles are in `config/profiles`.

### Kostya
- Topics: AI, marketing, growth, SaaS, automation, agents
- Language: Ukrainian or English
- Output focus: content ideas, insights, reply ideas

### Vova
- Topics: HR, onboarding, employee training, corporate culture, LMS, AI in HR
- Language: Ukrainian or English
- Output focus: thought leadership ideas, CEO post ideas, comments/reply ideas

Select profile via:

```bash
AGENT_PROFILE=kostya npm run run-once
```

---

## Telegram Setup (Bot + Chat ID)

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`, set name + username.
3. Copy token into `.env` as `TELEGRAM_BOT_TOKEN`.
4. Add bot to your target group/channel.
5. Send at least one message in that chat.
6. Get chat ID via:
   - `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
7. Put resulting chat id (usually negative for groups/channels) in `.env` as `TELEGRAM_CHAT_ID`.

---

## Troubleshooting

- **No posts scraped:** Threads markup can change. Re-check selectors in `src/scraper/threadsScraper.ts`.
- **Telegram 401/403:** token invalid or bot lacks permissions in the target chat.
- **No Telegram messages despite scraping:** engagement/language/relevance filters may exclude posts.
- **Playwright launch fails:** reinstall browser binaries (`npx playwright install chromium`).
- **Docker Playwright launch fails:** rebuild image to reinstall dependencies (`docker compose build --no-cache`).
- **Duplicate messages:** verify `DB_PATH` points to persistent storage and app has write access.
- **Docker DB resets:** ensure `threads_agent_data` volume exists and container uses `/app/data`.

---

## Production Notes

- Threads has no official public API; scraping may require periodic maintenance.
- Respect platform ToS and local laws.
- For scale, consider proxy rotation, queueing, and Postgres backend.
