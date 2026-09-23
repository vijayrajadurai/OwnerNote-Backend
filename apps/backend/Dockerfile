# NEWONX backend — production image.
#
# This is an npm-workspaces monorepo (root package.json + a single root
# package-lock.json cover apps/backend, apps/mobile, apps/web), so this
# image must be built with the REPO ROOT as build context, not
# apps/backend/ — the root lockfile isn't reachable otherwise:
#
#   docker build -f apps/backend/Dockerfile -t newonx-backend:test .
#
# node:22-bookworm (Debian Bookworm) is used for every stage: Node 22 is
# the current Node.js LTS line. The non-slim variant is used deliberately
# rather than -slim: Prisma's query-engine binary needs to detect and
# link against the actual OpenSSL on the machine that runs it, and Debian
# slim images strip openssl out entirely (Prisma then falls back to a
# guessed target that may not match, breaking only at runtime); the full
# bookworm image already includes OpenSSL 3.x, so generate and runtime
# always see the real thing without an extra apt-get layer (and its own
# dependency on being able to reach Debian's package mirrors at build
# time). Using the same base image for every stage also avoids an
# Alpine/glibc-vs-musl or cross-Debian-version mismatch between the
# engine binary generate() produces and whatever stage actually runs it.

FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
# --include-workspace-root installs the root's own (dev) deps too (there
# are none of consequence here, but the flag is required for a scoped
# --workspace install to see the root lockfile at all); this still only
# resolves and installs apps/backend's dependency tree, not
# apps/mobile's or apps/web's.
RUN npm ci --workspace=apps/backend --include-workspace-root

# ---- build: compile TypeScript and generate the Prisma Client ----
FROM node:22-bookworm AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/tsconfig.json ./apps/backend/tsconfig.json
COPY apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/src ./apps/backend/src
WORKDIR /app/apps/backend
RUN npx prisma generate
RUN npm run build

# ---- prod-deps: a clean, production-only install ----
# prisma (the CLI) is a `dependencies` entry (not devDependencies)
# specifically so it lands in this install and `npx prisma migrate
# deploy` can be run from the final image as a separate deploy step —
# see the Prisma section of the Phase 7.2.1 report for why.
FROM node:22-bookworm AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json ./apps/backend/package.json
RUN npm ci --workspace=apps/backend --include-workspace-root --omit=dev

# ---- runtime: the actual production image ----
FROM node:22-bookworm AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user to run the app as.
RUN groupadd --system --gid 1001 nodeapp \
  && useradd --system --uid 1001 --gid nodeapp --home-dir /app --shell /usr/sbin/nologin nodeapp

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
# prisma/ (schema.prisma + migrations/) is needed at runtime for `npx
# prisma migrate deploy` to have something to deploy — it is not read by
# the running application itself.
COPY --from=build /app/apps/backend/prisma ./apps/backend/prisma
COPY apps/backend/scripts/start-prod.sh ./apps/backend/scripts/start-prod.sh
RUN chmod +x /app/apps/backend/scripts/start-prod.sh
# The Prisma Client generated in the build stage (schema-specific JS +
# native query-engine binary) lives under node_modules/.prisma, separate
# from the @prisma/client package itself — prod-deps's `npm ci --omit=dev`
# never ran `prisma generate`, so this has to come from the build stage.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

WORKDIR /app/apps/backend
USER nodeapp

EXPOSE 4000

# No external HTTP client (curl/wget) is installed to keep the image
# minimal — Node's own http module is already present and is enough for
# a plain GET against the existing, unauthenticated /health endpoint
# (returns {"status":"ok"}, no secrets or DB details).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||4000,path:'/health',timeout:4000},(res)=>{process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Docker's default stop signal already; set explicitly for clarity. The
# app has no SIGTERM handler of its own (unchanged from before this
# Dockerfile), so a stop currently ends in-flight requests immediately
# rather than draining them — documented here, not silently assumed.
STOPSIGNAL SIGTERM

# Same command as `npm start` after applying pending Prisma migrations.
CMD ["./scripts/start-prod.sh"]
