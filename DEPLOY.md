# Deploying Shop AI / Owner Note to the Cloud

This guide deploys the monorepo to production using:

| Component | Service | Example URL |
|-----------|---------|-------------|
| **Backend API** | [Render](https://render.com) (Docker) | `https://api.yourdomain.com` |
| **PostgreSQL** | [Neon](https://neon.tech) | connection string only |
| **Web admin** | [Vercel](https://vercel.com) | `https://admin.yourdomain.com` |
| **Android app** | Play Store / APK | points at HTTPS API |
| **TTS proxy** | Already on Vercel | `apps/tts-proxy` |

**Estimated cost (small app):** ₹0–1,500/month on free/low tiers.

---

## Prerequisites

- GitHub repo with this code pushed
- Domain name (optional but recommended for HTTPS on Android)
- [MSG91](https://msg91.com) account for real OTP SMS (India)
- Node 20+ locally (for one-off admin seed commands)

---

## Architecture

```
┌─────────────┐     HTTPS      ┌──────────────────┐
│ Android app │ ─────────────► │ Render (API)     │
│ Owner Note  │                │ apps/backend     │
└─────────────┘                └────────┬─────────┘
                                        │ DATABASE_URL (TLS)
┌─────────────┐     HTTPS      ┌────────▼─────────┐
│ Web admin   │ ─────────────► │ Neon PostgreSQL  │
│ (Vercel)    │                └──────────────────┘
└─────────────┘
```

---

## Part 1 — PostgreSQL (Neon)

1. Sign up at [neon.tech](https://neon.tech) and create a project (e.g. `shop-ai-prod`).
2. Create a database (default `neondb` is fine).
3. Copy the **pooled** connection string and ensure TLS is on:

   ```
   postgresql://USER:PASSWORD@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Save this as `DATABASE_URL` — you will paste it into Render in Part 2.

> **Tip:** Use the pooled connection string for serverless/managed hosts. Neon free tier is enough for early production.

---

## Part 2 — Backend API (Render)

The repo already includes a production Dockerfile at `apps/backend/Dockerfile`. **Build context must be the repo root**, not `apps/backend/`.

### Option A — Deploy with `render.yaml` (recommended)

1. In the [Render dashboard](https://dashboard.render.com), connect your GitHub repo.
2. Choose **Blueprint** (or "New Blueprint") and point at this repo — Render reads `render.yaml` at the root.
3. Set the secret env vars Render prompts for (or add them in the dashboard after create):
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID`
   - `CORS_ORIGIN`
4. Wait for the first deploy. The **pre-deploy** step runs `prisma migrate deploy` automatically.

### Option B — Manual Web Service setup

1. **New → Web Service** → connect GitHub repo.
2. Settings:

   | Field | Value |
   |-------|-------|
   | **Name** | `shop-ai-api` |
   | **Region** | Singapore (closest to India on Render) |
   | **Runtime** | Docker |
   | **Dockerfile path** | `apps/backend/Dockerfile` |
   | **Docker build context** | `.` (repo root) |
   | **Health check path** | `/health` |

3. **Environment variables** (required for production — backend refuses to boot otherwise):

   ```env
   NODE_ENV=production
   PORT=4000
   DATABASE_URL=<paste Neon URL with ?sslmode=require>
   JWT_SECRET=<run: openssl rand -base64 48>
   JWT_EXPIRES_IN=30d
   OTP_PROVIDER=msg91
   MSG91_AUTH_KEY=<your key>
   MSG91_TEMPLATE_ID=<your template id>
   MSG91_SENDER_ID=<optional>
   CORS_ORIGIN=https://admin.yourdomain.com
   TRUST_PROXY=1
   TEST_LOGIN_ENABLED=false
   ```

4. Deploy. After the service is live, open the **Shell** tab and run migrations once (if not using `render.yaml` pre-deploy):

   ```bash
   npx prisma migrate deploy
   ```

5. Verify:

   ```bash
   curl https://YOUR-SERVICE.onrender.com/health
   # {"status":"ok"}
   ```

### Custom domain (API)

1. Render → your service → **Settings → Custom Domains** → add `api.yourdomain.com`.
2. Add the CNAME Render gives you in your DNS (Cloudflare, etc.).
3. Render provisions HTTPS automatically.

---

## Part 3 — Web admin (Vercel)

The admin console is a static Vite build in `apps/web`. It **must** know the production API URL at build time.

### Vercel project settings

| Field | Value |
|-------|-------|
| **Root Directory** | `apps/web` |
| **Framework** | Vite |
| **Install Command** | `cd ../.. && npm ci` |
| **Build Command** | `npm run build` |
| **Output Directory** | `dist` |

### Environment variable (Production)

```env
VITE_API_BASE_URL=https://api.yourdomain.com
```

Use your real Render URL or custom domain. Must be **HTTPS** — the production build fails on `http://` or localhost.

### Deploy

1. Import the GitHub repo in [vercel.com](https://vercel.com).
2. Apply the settings above and deploy.
3. Add custom domain `admin.yourdomain.com` if desired.
4. Update backend `CORS_ORIGIN` to match the exact admin origin (including `https://`).

### Create first admin user

After the API is live, seed an admin from your machine (point at production API):

```bash
cd apps/backend
DATABASE_URL="<neon-url>" npx tsx scripts/seedAdmin.ts +919XXXXXXXXX
```

Or use Render Shell with `DATABASE_URL` already set in the service env.

> Web login is **ADMIN / SALES_OFFICER only**. Owner accounts use the Android app.

---

## Part 4 — Android app (Owner Note)

### Production API URL

Edit `apps/android-native/app/build.gradle.kts`:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"https://api.yourdomain.com\"")
```

Rebuild and ship a release APK/AAB. **Do not** use `http://192.168.x.x` or `http://10.0.2.2` in production.

### Release checklist

- [ ] `API_BASE_URL` is HTTPS
- [ ] `TEST_LOGIN_ENABLED=false` on the server
- [ ] OTP works via MSG91 on a real phone number
- [ ] TTS proxy keys are not hardcoded in release builds (use build-time secrets or remote config)

---

## Part 5 — MSG91 OTP setup

1. Create an MSG91 account and SMS template for OTP.
2. Set on Render:

   ```env
   OTP_PROVIDER=msg91
   MSG91_AUTH_KEY=...
   MSG91_TEMPLATE_ID=...
   MSG91_SENDER_ID=...   # if required by your template
   ```

3. Test: open the Android app → enter phone → OTP should arrive by SMS (not server logs).

`OTP_PROVIDER=console` only prints OTP in server logs — **blocked in production** by `env.ts`.

---

## Environment variable reference

Full template: `apps/backend/.env.production.example`

| Variable | Production | Notes |
|----------|------------|-------|
| `NODE_ENV` | `production` | Enables safety checks |
| `DATABASE_URL` | Neon URL + `sslmode=require` | Required |
| `JWT_SECRET` | 32+ random chars | `openssl rand -base64 48` |
| `OTP_PROVIDER` | `msg91` | Not `console` |
| `CORS_ORIGIN` | `https://admin.yourdomain.com` | Not `*` |
| `TRUST_PROXY` | `1` | Behind Render load balancer |
| `TEST_LOGIN_ENABLED` | `false` | Required in production |

---

## Alternative: Railway (all-in-one)

If you prefer one dashboard for API + Postgres:

1. [railway.app](https://railway.app) → New Project → Deploy from GitHub.
2. Add **PostgreSQL** plugin → copy `DATABASE_URL` into the API service.
3. Set **Dockerfile path** to `apps/backend/Dockerfile`, root context `.`.
4. Add the same env vars as Render.
5. Run migrations in Railway shell: `npx prisma migrate deploy`.

Railway is equally good for small apps; pricing is usage-based.

---

## Alternative: DigitalOcean (India latency)

For lowest latency to Indian users:

- **App Platform** or a **Droplet in Bangalore** (`blr1`)
- Managed PostgreSQL in the same region
- Same Docker image and env vars as above

More setup than Render, but better ping from Tamil Nadu / South India.

---

## Operations

### Run migrations after a schema change

```bash
# Locally against production DB (careful!)
cd apps/backend
DATABASE_URL="<prod-url>" npx prisma migrate deploy
```

Or use Render/Railway shell on the running service.

### View logs

- **Render:** Dashboard → Service → Logs
- **Vercel:** Dashboard → Deployment → Functions/Build logs

### Health check

```bash
curl https://api.yourdomain.com/health
```

### Backup database

Neon: enable automatic backups in the Neon dashboard (paid tiers) or use `pg_dump` periodically.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Backend won't start | Check Render logs — `env.ts` lists exact missing/invalid vars |
| `OTP_PROVIDER=console` error | Set `OTP_PROVIDER=msg91` and MSG91 keys |
| `CORS_ORIGIN="*"` error | Set explicit `https://admin...` origin |
| Web build fails | Set `VITE_API_BASE_URL` to HTTPS API URL |
| Android connection timeout | Use HTTPS domain, not LAN IP |
| 500 on API after deploy | Run `npx prisma migrate deploy` |
| OTP not received | Verify MSG91 template, sender ID, and phone format `+91...` |

---

## Security reminders

- Never commit `.env`, `.env.production`, or real secrets to git.
- Never put JWT, DB URL, or MSG91 keys in `VITE_*` variables (they ship in the browser bundle).
- Rotate `JWT_SECRET` only with a plan — all existing tokens invalidate.
- Keep `TEST_LOGIN_ENABLED=false` in production.

---

## Quick deploy checklist

```
[ ] Neon database created, DATABASE_URL copied
[ ] Render API deployed, /health returns ok
[ ] prisma migrate deploy completed
[ ] JWT_SECRET generated (32+ chars)
[ ] MSG91 configured, OTP SMS tested
[ ] CORS_ORIGIN set to Vercel admin URL
[ ] Vercel admin deployed with VITE_API_BASE_URL
[ ] Admin user seeded
[ ] Android release build uses HTTPS API_BASE_URL
[ ] Custom domains + HTTPS on api + admin
```
