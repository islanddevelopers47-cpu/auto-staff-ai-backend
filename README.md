# Claw Staffer — Backend

Web-based Telegram bot management platform with AI agents. Built on OpenClaw's architecture, simplified for non-technical users.

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Copy env and configure
cp .env.example .env
# Edit .env with your API keys

# 3. Run in development mode
npm run dev
```

Open http://localhost:3000 — login with `admin` / `admin123` (or whatever you set in `.env`).

## Quick Start (Docker)

```bash
# Build and run
docker compose up --build

# Or with env vars
OPENAI_API_KEY=sk-xxx docker compose up --build
```

## Setup Guide

1. **Log in** to the dashboard at http://localhost:3000
2. **Add an AI provider** — set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_AI_API_KEY` in `.env`
3. **Create a Telegram bot** — talk to [@BotFather](https://t.me/BotFather) on Telegram, get a token
4. **Add the bot** in the dashboard — paste the token, select an agent
5. **Start the bot** — click Start, then message your bot on Telegram!

## Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project from the repo
3. Railway auto-detects the Dockerfile
4. Set environment variables in Railway dashboard:
   - `JWT_SECRET` (random string)
   - `OPENAI_API_KEY` (or other provider keys)
   - `PUBLIC_URL` (your Railway URL, for webhooks)
5. Deploy!

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/register` | Register |
| GET | `/api/auth/me` | Current user |
| GET | `/api/bots` | List bots |
| POST | `/api/bots` | Create bot |
| POST | `/api/bots/:id/start` | Start bot |
| POST | `/api/bots/:id/stop` | Stop bot |
| DELETE | `/api/bots/:id` | Delete bot |
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Create agent |
| GET | `/api/providers` | List AI providers |
| GET | `/api/setup/status` | Setup status |
| WS | `/ws?token=xxx` | Real-time events |

## Project Structure

```
src/
  index.ts          — Entry point
  server.ts         — Express + WS server
  config/           — Environment config
  database/         — SQLite (users, bots, sessions, agents)
  auth/             — JWT auth middleware
  telegram/         — grammY bot factory + manager
  agents/           — AI agent runner + model providers
  auto-reply/       — Command handling + reply pipeline
  api/routes/       — REST API endpoints
  gateway/          — WebSocket events
  utils/            — Logger, errors, crypto
public/             — Basic test UI
agents/             — Built-in agent definitions (JSON)
skills/             — Skill definitions
```

## Environment Variables

See `.env.example` for all options. Key ones:

- `PORT` — Server port (default: 3000)
- `JWT_SECRET` — Auth token secret
- `OPENAI_API_KEY` — OpenAI API key
- `ANTHROPIC_API_KEY` — Anthropic API key
- `GOOGLE_AI_API_KEY` — Google AI API key
- `OLLAMA_BASE_URL` — Ollama server URL
- `PUBLIC_URL` — Public URL for webhooks (Railway)
- `DATABASE_PATH` — SQLite database path

## License

MIT
