# 🔒 Arquitetura Proxy Seguro — Consultor Fiscal Inteligente

## Por que o proxy?

Sem proxy, a `GEMINI_API_KEY` fica embutida no bundle JS do browser:
```
❌ Browser → Gemini API (chave exposta no DevTools)
```

Com o proxy, a chave fica **apenas no servidor**:
```
✅ Browser → Cloud Run Proxy → Gemini API (chave invisível)
```

---

## Estrutura de Serviços no Cloud Run

```
┌─────────────────────────────────────────────────────┐
│                   Google Cloud Run                  │
│                                                     │
│  ┌──────────────────┐    ┌──────────────────────┐  │
│  │  consultor-fiscal │    │ consultor-fiscal-    │  │
│  │  (frontend React) │───▶│ proxy (Node/Express) │  │
│  │  porta 8080       │    │ porta 8080           │  │
│  └──────────────────┘    └──────────┬───────────┘  │
│                                      │              │
└──────────────────────────────────────┼──────────────┘
                                       │ GEMINI_API_KEY
                                       ▼
                              ┌─────────────────┐
                              │   Gemini API    │
                              │ (Google AI)     │
                              └─────────────────┘
```

---

## Setup Passo a Passo

### 1. Deploy do Proxy Backend

```bash
cd proxy-backend

# Build e deploy
gcloud builds submit \
  --tag gcr.io/SEU_PROJECT_ID/consultor-fiscal-proxy

gcloud run deploy consultor-fiscal-proxy \
  --image gcr.io/SEU_PROJECT_ID/consultor-fiscal-proxy \
  --platform managed \
  --region us-central1 \
  --no-allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=SUA_CHAVE_AQUI" \
  --port 8080
```

> Anote a URL retornada: `https://consultor-fiscal-proxy-xxx.a.run.app`

### 2. Atualizar o Frontend

No `.env.production` do frontend:
```env
# NÃO coloque mais a GEMINI_API_KEY aqui!
VITE_API_PROXY_URL=https://consultor-fiscal-proxy-xxx.a.run.app
```

### 3. Substituir o geminiService

Substitua `services/geminiService.ts` pelo arquivo `geminiService.proxy.ts` gerado.

### 4. Configurar CORS do Proxy

Após o deploy do frontend, pegue a URL e configure:
```bash
gcloud run services update consultor-fiscal-proxy \
  --update-env-vars "ALLOWED_ORIGINS=https://consultor-fiscal-xxx.a.run.app"
```

---

## Secrets do GitHub Actions

| Secret | Valor |
|--------|-------|
| `GCP_PROJECT_ID` | ID do seu projeto GCP |
| `GCP_SA_KEY` | JSON da Service Account |
| `GEMINI_API_KEY` | Chave da API Gemini |
| `FRONTEND_URL` | URL do frontend no Cloud Run |
| `VITE_FIREBASE_*` | Config Firebase |

---

## Endpoints do Proxy

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| POST | `/api/fiscal/query` | Consulta fiscal geral |
| POST | `/api/fiscal/compare` | Comparação de termos |
| POST | `/api/fiscal/similar` | Serviços similares |

---

## Segurança Implementada

- ✅ `GEMINI_API_KEY` nunca vai ao browser
- ✅ Rate limiting: 60 req/min por IP
- ✅ CORS restrito ao domínio do frontend
- ✅ Helmet.js (headers de segurança HTTP)
- ✅ Payload máximo: 10kb
- ✅ Prompt máximo: 4000 chars
- ✅ Container roda como usuário não-root
