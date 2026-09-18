# Owner Note Backend API

Node.js + Express + Prisma + PostgreSQL backend for the **Owner Note** Android app.

## Local development

```bash
npm install
cp apps/backend/.env.example apps/backend/.env
# Edit DATABASE_URL and JWT_SECRET in apps/backend/.env

npm run backend:setup   # prisma generate + migrate
npm run backend:start   # http://localhost:4000
```

Health check: `GET /health` → `{"status":"ok"}`

## Cloud deployment

See **[DEPLOY.md](./DEPLOY.md)** for Render + Neon + Vercel setup.

Quick Render deploy: connect this repo as a **Blueprint** — `render.yaml` is included.

## Required production env vars

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL URL (`?sslmode=require` for Neon) |
| `JWT_SECRET` | 32+ char random secret |
| `OTP_PROVIDER` | `msg91` (not `console`) |
| `MSG91_*` | MSG91 SMS credentials |
| `CORS_ORIGIN` | Web admin HTTPS origin |
| `TRUST_PROXY` | `1` on Render |

Full list: `apps/backend/.env.production.example`
