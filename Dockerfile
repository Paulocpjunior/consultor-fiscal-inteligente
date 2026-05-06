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

ENV VITE_GEMINI_API_KEY=$VITE_GEMINI_API_KEY
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

RUN npm run build

# ─── Stage 2: Servidor Express (API /api/fiscal/* + SPA estatico) ────────────
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY server.js ./
COPY sefaz-backend ./sefaz-backend

EXPOSE 8080

# server.js da raiz: serve /api/fiscal/* (Gemini) + dist/ (frontend) + SPA fallback
CMD ["node", "server.js"]
