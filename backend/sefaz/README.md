# cfi-sefaz-proxy

Backend seguro de consulta SEFAZ para a **Central de Documentos Fiscais** do
Consultor Fiscal Inteligente.

## Status atual

🚧 **Scaffold com mocks.** Os endpoints existem, validam autenticação básica
e retornam respostas determinísticas (90% regular, 10% cancelada, 2% denegada
no `/api/sefaz/consulta-status`) para que o front possa ser desenvolvido
contra eles.

A integração real com SEFAZ (`USE_MOCKS=false`) está marcada com `TODO` no
código e será implementada quando houver:
- Certificado A1 de uma empresa de teste.
- IAM/Secret Manager configurados (ver "Setup GCP" abaixo).

## Endpoints

| Método | Path | Descrição |
|--|--|--|
| `GET`  | `/api/health` | health check + modo (mock/real). |
| `POST` | `/api/certificados` | recebe `.pfx` + senha, salva no Secret Manager. **Apenas admin.** |
| `POST` | `/api/sefaz/consulta-status` | consulta status de até 50 chaves de NF-e. |

Todos os endpoints (exceto `/api/health`) exigem header
`Authorization: Bearer <Firebase ID token>`.

## Rodar local

```bash
cd backend/sefaz
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
USE_MOCKS=true uvicorn main:app --reload --port 8080
```

Teste manual:

```bash
curl http://localhost:8080/api/health
# Para endpoints autenticados em modo mock, qualquer Bearer não-vazio funciona:
curl -X POST http://localhost:8080/api/sefaz/consulta-status \
  -H "Authorization: Bearer fake-token" \
  -H "Content-Type: application/json" \
  -d '{"cnpjTitular":"12345678000190","chaves":["35200612345678000190550010000000011000000017"]}'
```

## Setup GCP — antes do primeiro deploy real

Tudo no projeto **`consultorfiscalapp`** (number `631239634290`).

### 1. Habilitar APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project=consultorfiscalapp
```

### 2. Criar repositório do Artifact Registry (se ainda não existir)

```bash
gcloud artifacts repositories create cloud-run-deploy \
  --repository-format=docker \
  --location=us-central1 \
  --project=consultorfiscalapp
```

### 3. Service Account dedicada para o backend

```bash
gcloud iam service-accounts create cfi-sefaz-runtime \
  --display-name="CFI SEFAZ runtime SA" \
  --project=consultorfiscalapp

# Permissão de ler segredos (cert e senha) só dela mesma + da empresa.
gcloud projects add-iam-policy-binding consultorfiscalapp \
  --member="serviceAccount:cfi-sefaz-runtime@consultorfiscalapp.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Criar e gerenciar secrets de certificado (admin).
gcloud projects add-iam-policy-binding consultorfiscalapp \
  --member="serviceAccount:cfi-sefaz-runtime@consultorfiscalapp.iam.gserviceaccount.com" \
  --role="roles/secretmanager.admin"
```

### 4. Service Account de deploy (para CI)

A mesma `id-github-deploy@consultorfiscalapp.iam.gserviceaccount.com` que já
deploya o front-end pode deployar este backend, contanto que tenha
`roles/run.admin` e `roles/iam.serviceAccountUser` (já tem).

## Deploy manual (primeira vez)

```bash
cd backend/sefaz

gcloud builds submit \
  --tag us-central1-docker.pkg.dev/consultorfiscalapp/cloud-run-deploy/cfi-sefaz-proxy:latest \
  --project=consultorfiscalapp

gcloud run deploy cfi-sefaz-proxy \
  --image us-central1-docker.pkg.dev/consultorfiscalapp/cloud-run-deploy/cfi-sefaz-proxy:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --service-account cfi-sefaz-runtime@consultorfiscalapp.iam.gserviceaccount.com \
  --set-env-vars "USE_MOCKS=true,GCP_PROJECT_ID=consultorfiscalapp,ALLOWED_ORIGINS=https://consultor-fiscal-inteligente-631239634290.us-central1.run.app" \
  --project=consultorfiscalapp
```

Depois desse deploy, o backend já existe em `https://cfi-sefaz-proxy-<HASH>.us-central1.run.app`
e responde os mocks. Quando estivermos prontos para o real, basta atualizar
`USE_MOCKS=false`.

## Próximos passos (não mexer ainda)

1. **Cert real:** trocar `USE_MOCKS=false` quando `cryptography` + Secret Manager
   estiverem implementados em `main.py` (procurar `# TODO real:`).
2. **Cache de consulta:** salvar resultados em Firestore (`sefaz_consultas`)
   com TTL 24h para não martelar SEFAZ. Camada de cache fica no front
   (`xmlFiscalService`) — backend é stateless.
3. **Tabela de URLs por UF:** começar com SP, expandir conforme necessidade.
4. **Workflow CI/CD:** quando o caminho real estabilizar, criar
   `.github/workflows/deploy-sefaz.yml` separado, rodando só quando arquivos
   em `backend/sefaz/**` mudarem.
5. **Monitoring:** Cloud Logging filter por `consulta-status`, alerta de
   erro 5xx > 5% em 5 min.

## Segurança

- Certificado `.pfx` **nunca toca disco** no backend. Vai do request →
  validação em memória → Secret Manager → `del`.
- Secret Manager guarda cert e senha em recursos separados.
- Firestore só guarda **metadados** (CNPJ titular, validade, fingerprint).
  O `EmpresaXmlConfig.certificadoRef` aponta para o Secret Manager por
  caminho lógico, nunca contém o conteúdo da chave.
- CORS restrito à URL do front via `ALLOWED_ORIGINS`.
- Auth obrigatório (Firebase ID token) em todos os endpoints exceto `/api/health`.
- Cadastro de cert exige role `admin` (verificado contra Firestore `users/{uid}.role`).
