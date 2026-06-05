# SERPRO Smoke Test — captura de payload real

## Por que existe

Dois providers têm `TODO[SERPRO_REAL]` no código (`das-provider.js:237`,
`darf-provider.js:162`) — os **nomes dos campos** do response do SERPRO são
**supostos**. Em produção `MODE='serpro'` é o default (`deploy.yml:64`), então
a primeira chamada real pode silenciosamente gravar payload vazio.

Esse smoke captura o response **bruto** das APIs de **consulta** (não emite
DAS/DARF/declaração — nada destrutivo) e salva em JSON. Aí dá pra mapear os
parsers sem adivinhar.

## Pré-requisitos

- Credenciais SERPRO Integra Contador (Consumer Key + Secret).
- Cert digital ICP-Brasil A1 da S&P Contábil (mTLS).
- **CNPJ-cliente alvo com procuração e-CAC concedida pra S&P** (senão a
  consulta retorna 4xx — esperado).
- Acesso pra rodar Node 20+ em algum host com saída pra `gateway.apiserpro.serpro.gov.br`.

## Como rodar

### Opção A — local (na sua máquina)

```bash
# Variáveis (idênticas às do Cloud Run)
export SERPRO_CONSUMER_KEY=<key do contrato Integra>
export SERPRO_CONSUMER_SECRET=<secret>
export SERPRO_CONTRATANTE_CNPJ=44388152000189
# Se o cert mTLS estiver acessível via Secret Manager, ADC do gcloud já resolve:
gcloud auth application-default login

node sefaz-backend/scripts/serpro-smoke.js <cnpj-cliente> [202604]
```

Saída: cria pasta em `/tmp/serpro-smoke-<cnpj>-<timestamp>/` com 4 JSONs (um por endpoint).

Se quiser imprimir os JSONs no terminal além de gravar em `/tmp`, adicione:

```bash
export SERPRO_SMOKE_PRINT_JSON=1
```

Use isso com cuidado: os payloads podem conter dados fiscais reais.

### Opção B — Cloud Run job (sem precisar do cert local)

```bash
# 1) Build e push (igual ao deploy normal)
SMOKE_TAG=$(date +%Y%m%d%H%M%S)
SMOKE_IMAGE="us-central1-docker.pkg.dev/consultorfiscalapp/cloud-run-deploy/serpro-smoke:${SMOKE_TAG}"
docker build -t "$SMOKE_IMAGE" .
docker push "$SMOKE_IMAGE"

# 2) Run-once (recebe envs e secrets idênticos ao deploy do app)
gcloud run jobs delete serpro-smoke-once --region=us-west1 --quiet || true
gcloud run jobs create serpro-smoke-once \
  --image="$SMOKE_IMAGE" \
  --region=us-west1 \
  --command=node \
  --args=sefaz-backend/scripts/serpro-smoke.js,<cnpj-cliente>,202604 \
  --set-env-vars=SERPRO_CONTRATANTE_CNPJ=44388152000189,SERPRO_SMOKE_PRINT_JSON=1 \
  --set-secrets=SERPRO_CONSUMER_KEY=serpro-consumer-key:latest,SERPRO_CONSUMER_SECRET=serpro-consumer-secret:latest
gcloud run jobs execute serpro-smoke-once --region=us-west1
gcloud run jobs logs read serpro-smoke-once --region=us-west1
```

Com `SERPRO_SMOKE_PRINT_JSON=1`, os JSONs aparecem no log entre marcadores:

```text
---SERPRO_SMOKE_JSON_BEGIN 01-PGDASD-CONSULTIMADECREC14.json---
{...}
---SERPRO_SMOKE_JSON_END 01-PGDASD-CONSULTIMADECREC14.json---
```

Sem essa variável, o job grava apenas em `/tmp`, que some quando a execução termina. Garanta que a service account do job tenha acesso aos secrets `sefaz-cert-a1` e `sefaz-cert-password`, pois o OAuth mTLS usa o mesmo certificado A1 do app.

## O que o smoke chama (4 endpoints — todos consulta)

| # | Sistema | Serviço | Ação | Pode gerar custo? |
|---|---|---|---|---|
| 1 | `PGDASD` | `CONSULTIMADECREC14` | Consultar | Sim — 1 consulta SERPRO |
| 2 | `DCTFWEB` | `CONSDECCOMPLETA33` | Consultar | Sim — 1 consulta |
| 3 | `CAIXAPOSTAL` | `OBTERLISTAMSGS53` | Consultar | Sim — não marca lidas |
| 4 | `DET` | `CONSULTARMENSAGENS` | Consultar | Sim — alternativa do Caixa Postal |

> **Custo total estimado**: ~R$ 0,10-0,40 (4 consultas em faixa baixa). Nada de
> emissão.

## O que **não** está aqui (e por quê)

- **DARF**: só existe `idServico` de **emissão** documentado no código (sem consulta
  isolada). Não adiciono pra não gerar DARF real.
- **NFSe Nacional**: `nfse-nacional-provider.js` ainda **só tem mock** — não há
  integração SERPRO implementada. Esse gap precisa de PR separado.

## Validação no DRY_RUN (sem credenciais reais)

```bash
SERPRO_DRY_RUN=1 SERPRO_CONTRATANTE_CNPJ=44388152000189 \
  node sefaz-backend/scripts/serpro-smoke.js 11222333000144 202604
```

Imprime esqueleto (responde "simulado" pra cada chamada), gera os JSONs em
`/tmp/serpro-smoke-.../` — útil pra confirmar que o script roda no seu ambiente
antes de gastar credenciais.

## Próximo passo (depois que você rodar com credenciais reais)

Me devolva os 4 JSONs (cole no chat ou anexa). Vou mapear:
- `das-provider.js:237` (campos do GERARDAS12 — atualmente supostos)
- `dctfweb-provider.js` (CONSDECCOMPLETA33 — confirma se a estrutura bate)
- `caixa-postal-orchestrator.js` (OBTERLISTAMSGS53 — paginação, formato de msg)

Sem adivinhar campos. Os parsers param de ser "tente isso e veja se cai".
