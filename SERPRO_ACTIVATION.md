# Ativação SERPRO Integra Contador

Status atual: arquitetura pronta, providers em modo mock. Esta doc é o checklist
de ativação quando as credenciais SERPRO chegarem.

## Pré-requisitos

1. **Contratar Integra Contador na Loja SERPRO** — https://loja.serpro.gov.br
   - Produto PGDASD (DAS Simples Nacional) — R$ 0,80/transação
   - Caixa Postal e-CAC (opcional, depois)
   - NFSe Nacional (opcional, depois)

2. **Credenciais OAuth2** — recebidas no portal após contratação:
   - `consumer_key`
   - `consumer_secret`

3. **CNPJ contratante** = CNPJ da SP Assessoria Contábil

4. **Procuração eletrônica e-CAC** de cada empresa cliente, autorizando
   a SP Contábil como autora dos pedidos. Sem isso, o SERPRO retorna 403.

## Env vars no Cloud Run

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=\
SERPRO_CONSUMER_KEY=<key>,\
SERPRO_CONSUMER_SECRET=<secret>,\
SERPRO_CONTRATANTE_CNPJ=44388152000189,\
DAS_MODE=serpro \
  --region us-central1 --project consultorfiscalapp
```

**Não comitar credenciais no Git.** Use Secret Manager se preferir:
```bash
gcloud secrets create serpro-consumer-key --data-file=-
# (cola a key, Ctrl+D)
gcloud run services update consultor-fiscal-inteligente \
  --update-secrets=SERPRO_CONSUMER_KEY=serpro-consumer-key:latest \
  --region us-central1 --project consultorfiscalapp
```

## Validação antes do flip

Antes de virar `DAS_MODE=serpro`, valide com **dry-run** (sem chamar API):

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=DAS_MODE=serpro,SERPRO_DRY_RUN=1 \
  --region us-central1 --project consultorfiscalapp
```

Emite um DAS pelo app. Deve retornar payload com `_dryRun: true`. Confirma
que o roteamento Mock → SerproProvider funcionou sem chamar API real.

Depois remova `SERPRO_DRY_RUN`:
```bash
gcloud run services update consultor-fiscal-inteligente \
  --remove-env-vars=SERPRO_DRY_RUN \
  --region us-central1 --project consultorfiscalapp
```

## Pontos que precisam ajuste pós-primeira chamada real

Procure por `TODO[SERPRO_REAL]` no código. Cada um marca um campo que
foi baseado em documentação pública mas pode precisar de ajuste contra
o response real:

- `das-provider.js` — campos do response do GERARDAS21 e ENTREGARDECLARACAO11
- (futuro) `caixa-postal-provider.js` — quando implementar
- (futuro) `nfse-nacional-provider.js` — quando implementar

## Rollback rápido

Se algo der errado em produção:

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=DAS_MODE=mock \
  --region us-central1 --project consultorfiscalapp
```

Instantâneo. Mock volta a atender sem rebuild.

## Próximos provedores (Caixa Postal, NFSe)

Após DAS estar validado em produção:

1. Replicar o padrão de `das-provider.js` em `caixa-postal-provider.js`
   - idSistema: `CAIXAPOSTAL`
   - idServicos: `MSGCONTRIBUINTE51`, `OBTERINDICADORNOVASMSGS52`, `OBTERLISTAMSGS53`
   - Env var: `CAIXA_POSTAL_MODE=serpro`

2. Replicar em `nfse-nacional-provider.js`
   - idSistema: `NFSE`
   - idServicos: (consultar documentação SERPRO)
   - Env var: `NFSE_NAC_MODE=serpro`
