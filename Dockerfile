# Shifa API - production image

# ---- Stage 1: dependencies ----
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --only=production

# ---- Stage 2: runtime ----
FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

# Non-root user
RUN addgroup -S shifa && adduser -S shifa -G shifa

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=shifa:shifa . .

RUN mkdir -p /app/logs && chown -R shifa:shifa /app/logs

USER shifa

EXPOSE 4000

CMD ["node", "server.js"]

