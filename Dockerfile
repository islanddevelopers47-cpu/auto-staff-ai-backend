FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Production stage ---
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY public/ ./public/
COPY agents/ ./agents/
COPY skills/ ./skills/

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R node:node /app/data

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/autostaff.db

USER node

# Railway injects PORT dynamically; no fixed EXPOSE needed

CMD ["node", "dist/index.js"]
