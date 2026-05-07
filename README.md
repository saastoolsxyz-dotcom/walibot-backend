# WaliBot Backend v12

WhatsApp AI bot powered by **Groq (free)** + Baileys.
Gemini removed (paid) — fully Groq-only.

## Quick Start

```bash
npm install
npm start
# open http://localhost:3000
```

## Env (.env)

```
PORT=3000
GROQ_API_KEY=gsk_...
GROQ_API_KEY_FALLBACK=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
RESPONSE_DELAY_MIN=2
RESPONSE_DELAY_MAX=2
AI_PROVIDER=groq
```

Get free Groq keys: https://console.groq.com

## Deploy on Railway

1. Push this folder to GitHub.
2. New Railway project → Deploy from repo.
3. Add the env vars above.
4. Public domain → use that as `Backend URL` in the React frontend Settings.

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | health check |
| GET | `/status` | bot status + AI status |
| GET | `/qr` | QR data URL |
| GET | `/qr.png` | QR PNG |
| GET | `/messages` | recent messages |
| GET | `/dashboard-data` | stats + convos + orders + unknown Qs |
| GET | `/settings` | current settings |
| POST | `/settings` | update settings (`{responseDelay:{min,max}}`) |
| POST | `/start-bot` | start with business profile |
| POST | `/stop-bot` | stop & logout |
| POST | `/rewrite-business` | AI-rewrite business KB |
| POST | `/confirm-order` | confirm a pending order |
| POST | `/add-to-kb` | answer an unknown question |
| POST | `/webhook/order` | external order status webhook |
| GET | `/ai-status` | which AI keys are loaded |

## Notes

- All AI traffic goes through Groq with automatic fallback to the secondary key.
- Reply delay locked to 2s by default (configurable).
- Built-in single-page dashboard at `/`.
- "Back to Home" button in the dashboard nav — set destination via `?home=https://your-frontend.com` (saved in localStorage).
