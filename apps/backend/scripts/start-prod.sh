#!/bin/sh
set -e
# Render free tier cannot run preDeployCommand. Apply pending Prisma
# migrations on boot so new routes (e.g. Group Buying) have tables.
npx prisma migrate deploy
exec node dist/index.js
