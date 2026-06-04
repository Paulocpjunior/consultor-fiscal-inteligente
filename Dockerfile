# ─── Stage 1: Build React/Vite ───────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# ARGs necessarios para o Vite injetar nas envs do bundle no build-time.
# Os valores vem do gcloud run deploy --build-env-vars-file ou Cloud Build.
ARG VITE_GEMINI_API_KEY
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
# Sentry: DSN do projeto frontend. Se nao for passado no build, app roda
# normal e Sentry vira NO-OP (vide services/sentry.ts). Opcional.
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENV

ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_SENTRY_ENV=$VITE_SENTRY_ENV

RUN npm run build

# ─── Stage 2: Servidor Express (API /api/fiscal/* + SPA estatico) ────────────
FROM node:20-slim

WORKDIR /app

# Dependências do Chromium pra Playwright (login automático portal NFSe SP)
# Lista mínima validada pelo Playwright em node:20-slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

# Baixa só o Chromium do Playwright. Definimos PLAYWRIGHT_BROWSERS_PATH
# pra garantir caminho previsível independente do user que roda.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
RUN node_modules/.bin/playwright install chromium

COPY --from=builder /app/dist ./dist
COPY server.js ./
COPY sefaz-backend ./sefaz-backend

# Roda como root porque Playwright precisa de acesso a libs nativas.
# Cloud Run isola via gVisor então isso é OK.
EXPOSE 8080

# server.js da raiz: serve /api/fiscal/* (Gemini) + dist/ (frontend) + SPA fallback
CMD ["node", "server.js"]
