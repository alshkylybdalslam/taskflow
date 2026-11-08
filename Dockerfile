# ---- deps stage: production node_modules only ---------------------------
FROM node:18-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime ------------------------------------------------------------
FROM node:18-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public

# SQLite file lives here — mount a volume to persist it between containers.
VOLUME ["/app/data"]

ENV PORT=3000
EXPOSE 3000

# The API answers unauthenticated requests with 401 — that means "up".
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Seed the demo account + data on first boot (idempotent: skips when the
# data already exists), then start the server.
CMD ["sh", "-c", "node server/seed.js && exec node server/index.js"]
