# Ativação SERPRO Integra Contador

## Status atual (revisto em 04/09/2026)

- ✅ **`serpro` é o modo PADRÃO** de todos os providers do Integra Contador —
  `sefaz-backend/das-provider.js` (`const MODE = process.env.DAS_MODE || 'serpro'`),
  `caixa-postal-provider.js` (`CAIXA_POSTAL_MODE`) e `nfse-nacional-provider.js`
  (`NFSE_NAC_MODE`, onde `serpro`/`real` significam o Emissor Nacional real).
  Sem env nenhuma o app fala com o SERPRO de verdade; **sem credencial ele
  FALHA em vez de devolver dado fictício ao cliente** — essa é a decisão.
- ✅ Credenciais em produção (Secret Manager), DAS/PGDAS-D em uso real desde
  jul/2026, caixa postal e NFS-e Nacional também reais.
- 🔁 **`DAS_MODE=mock` é o OPT-OUT** (só desenvolvimento local). O mesmo vale
  para `CAIXA_POSTAL_MODE=mock` e `NFSE_NAC_MODE=mock`. Nunca em produção.

Esta doc é o checklist de (re)ativação — troca de credencial, novo produto na
Loja SERPRO, ou ambiente novo.

## Pré-requisitos

1. **Contratar Integra Contador na Loja SERPRO** — https://loja.serpro.gov.br
   - Produto PGDASD (DAS Simples Nacional) — R$ 0,80/transação
   - Caixa Postal e-CAC
   - NFSe Nacional (o app usa o Emissor Nacional/ADN; a chave SERPRO não é
     necessária para esse trilho)

2. **Credenciais OAuth2** — recebidas no portal após contratação:
   - `consumer_key`
   - `consumer_secret`

3. **CNPJ contratante** = CNPJ da SP Assessoria Contábil (44.388.152/0001-89)

4. **Procuração eletrônica e-CAC** de cada empresa cliente, autorizando
   a SP Contábil como autora dos pedidos. Sem isso, o SERPRO retorna 403.

## Env vars no Cloud Run

O serviço é `consultor-fiscal-inteligente`, região **us-west1**, projeto
`consultorfiscalapp`. Prefira o Secret Manager:

```bash
gcloud secrets create serpro-consumer-key --data-file=-
# (cola a key, Ctrl+D)
gcloud secrets create serpro-consumer-secret --data-file=-
gcloud run services update consultor-fiscal-inteligente \
  --update-secrets=SERPRO_CONSUMER_KEY=serpro-consumer-key:latest,SERPRO_CONSUMER_SECRET=serpro-consumer-secret:latest \
  --update-env-vars=SERPRO_CONTRATANTE_CNPJ=44388152000189 \
  --region us-west1 --project consultorfiscalapp
```

**Não comitar credenciais no Git.** `DAS_MODE` não precisa ser definido —
`serpro` já é o padrão.

> ⚠️ `gcloud run services update` cria revisão a **0% de tráfego** neste
> serviço (o deploy pina o tráfego numa revisão). Env "gravada" não é env "em
> vigor": o próximo deploy pela esteira a leva, ou roteie à mão depois de
> conferir a revisão nova (ver CLAUDE.md, 17/08).

## Validação antes de usar credencial nova

Valide com **dry-run** (sem chamar a API):

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=SERPRO_DRY_RUN=1 \
  --region us-west1 --project consultorfiscalapp
```

Emite um DAS pelo app. Deve retornar payload com `_dryRun: true`. Depois
remova `SERPRO_DRY_RUN`:

```bash
gcloud run services update consultor-fiscal-inteligente \
  --remove-env-vars=SERPRO_DRY_RUN \
  --region us-west1 --project consultorfiscalapp
```

O smoke de CONSULTA (não emite nada) é
`node sefaz-backend/scripts/serpro-smoke.js <cnpj-cliente> [pa]` — ele grava
o response bruto para conferir os parsers sem adivinhar.

## Onde os parsers foram calibrados por response real (e onde ainda não)

Cada provider tem uma classe `SerproProvider` cujo parser do response nasceu
de documentação pública e foi conferido com uso real:

- `das-provider.js` — `SerproProvider.gerarDas` (GERARDAS21),
  `SerproProvider.transmitirPgdasD` (TRANSDECLARACAO11) e
  `SerproProvider.consultarDeclaracaoPa` (CONSULTIMADECREC14): **em produção**,
  provados por DAS emitidos e declarações aceitas (ver CLAUDE.md).
- `caixa-postal-provider.js` — **EXISTE e roda** (`CAIXA_POSTAL_MODE`,
  idSistema `CAIXAPOSTAL`, serviços MSGCONTRIBUINTE51/OBTERINDICADORNOVASMSGS52/
  OBTERLISTAMSGS53).
- `nfse-nacional-provider.js` — **EXISTE e roda** (`NFSE_NAC_MODE`;
  `EmissorNacionalProvider` fala com o ADN/Emissor Nacional, não com o SERPRO).
- `darf-provider.js` — `SerproProvider.gerarDarf`: ver `DARF_ACTIVATION.md`.
  O único marcador `TODO[SERPRO_REAL]` que sobrou no código está em
  `darf-routes.js` (rota `/preview`, aviso sobre o `idServico` do DARF avulso).

## Rollback rápido

Se a credencial nova quebrar, o caminho NÃO é `mock` em produção (mock devolve
dado fictício ao cliente): é voltar a versão anterior do secret
(`--update-secrets=...:<versão-anterior>`) e conferir o tráfego da revisão.
`DAS_MODE=mock` serve só para desenvolvimento local.
