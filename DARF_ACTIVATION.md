# Ativação SERPRO — Emissão de DARF

Complemento do `SERPRO_ACTIVATION.md`. Cobre a emissão de DARF pelo Integra
Contador (produto PAGTOWEB / Integra SICALC), separada do PGDASD (DAS Simples).

## Status atual (revisto em 04/09/2026)

- ✅ Código backend pronto (`sefaz-backend/darf-provider.js`, classe
  `SerproProvider.gerarDarf`; payload montado por `montarPayloadDarfSerpro`
  em `darf-payload-builder.js`).
- ✅ **`serpro` é o modo PADRÃO** (`const MODE = process.env.DARF_MODE || 'serpro'`).
  Sem credencial o app falha em vez de devolver guia fictícia.
- 🔁 **`DARF_MODE=mock` é o OPT-OUT** — `MockProvider` gera código de barras
  FEBRABAN local e payload simulado, só para desenvolvimento.
- ⚠️ O `idServico` da emissão avulsa (`EMITEDARF61`) é SUPOSTO — o marcador
  `TODO[SERPRO_REAL]` vive em `darf-routes.js` (rota `POST /preview`), e o
  aviso sai no próprio payload do preview. Quando a conta SERPRO não tem o
  produto, o Integra Contador responde `ICGERENCIADOR-052` e o
  `SerproProvider.gerarDarf` traduz: a saída é o DARF unificado pelo Painel
  DCTFWeb (linha da declaração → Detalhe → DARF), que já está em produção.

## Pré-requisitos

1. **Produto PAGTOWEB / Integra SICALC contratado** na Loja SERPRO
   - https://loja.serpro.gov.br
   - Custo: confirmar na loja (geralmente similar ao DAS, ~R$ 0,80/transação)

2. **Credenciais SERPRO já configuradas** (compartilhadas com DAS)
   - `SERPRO_CONSUMER_KEY` ✓
   - `SERPRO_CONSUMER_SECRET` ✓
   - `SERPRO_CONTRATANTE_CNPJ` ✓

3. **Procuração e-CAC** de cada empresa cliente, autorizando SP Contábil
   como autora dos pedidos (mesma usada pelo DAS).

## Passo 1 — Confirmar `idServico` real

A documentação pública do Integra Contador
(<https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador>)
lista o sistema `PAGTOWEB` mas **não expõe publicamente** o nome do serviço
de emissão de DARF (apenas o de consulta `COMPARRECADACAO72`).

**Como obter o nome correto:**
- Logar no portal autenticado do SERPRO
- Acessar "Catálogo de Serviços" → produto PAGTOWEB / Integra SICALC
- Procurar serviço com nome semelhante a `EMITEDARF`, `CONSOLIDARGERARDARF51`,
  `GERADARF`, etc.
- Anotar:
  - Nome exato do `idServico` (ex: `EMITEDARF61`)
  - Nome dos campos esperados em `dados` (codigoReceita, periodoApuracao,
    valorPrincipal, vencimento — confirmar se variam)

Use `POST /api/admin/darf/preview` (botão de preview no app) para ver o payload que
sairia, sem emitir nada.

## Passo 2 — Configurar Cloud Run

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=\
SERPRO_DARF_SISTEMA=PAGTOWEB,\
SERPRO_DARF_SERVICO=<nome_confirmado_no_portal> \
  --region us-west1 --project consultorfiscalapp
```

> Os envs `SERPRO_DARF_SISTEMA` e `SERPRO_DARF_SERVICO` permitem ajustar
> sem rebuild — caso o serviço mude de nome ou tenha versionamento.
> `DARF_MODE` não precisa ser definido: `serpro` já é o padrão.
> Revisão criada por `services update` nasce a 0% de tráfego (ver CLAUDE.md,
> 17/08) — conferir antes de dar por aplicado.

## Passo 3 — Validar com dry-run

Antes de emitir de verdade, valide o roteamento sem chamar a API:

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=SERPRO_DRY_RUN=1 \
  --region us-west1 --project consultorfiscalapp
```

Emita uma DARF pela UI. Deve retornar payload com `_dryRun: true`.

Depois remova o dry-run:
```bash
gcloud run services update consultor-fiscal-inteligente \
  --remove-env-vars=SERPRO_DRY_RUN \
  --region us-west1 --project consultorfiscalapp
```

## Passo 4 — Primeira emissão real

Recomendado: começar com **uma empresa de teste própria** (CNPJ da SP
Contábil ou similar), valor mínimo (R$ 10,00), competência atual. **Uma
guia por vez** — nunca em lote (regra da casa, 28/07).

Verifique no response:
1. `codigoBarras` tem 44 dígitos válidos
2. `linhaDigitavel` formatada corretamente
3. `pdfBase64` retornado (se aplicável)
4. Pagamento simulado funciona no app bancário (sem efetivar)

Se algum campo do response não bater com o que o `SerproProvider.gerarDarf`
lê (`numeroDocumento`/`numeroDarf`, `codigoBarras`/`linhaDigitavel`,
`consolidado.valorPrincipalMoedaCorrente`, `valorMultaMora`, `valorJuros`,
`valorTotalConsolidado`, `darf`/`docArrecadacaoPdfB64`), ajuste o mapeamento
nessa função e abra novo PR — com o response bruto guardado pelo
`serpro-smoke.js` como fonte.

## Rollback rápido

Se algo der errado, o caminho NÃO é `mock` em produção (mock devolve guia
fictícia ao cliente): é o DARF unificado pelo Painel DCTFWeb, que não passa
por este provider. `DARF_MODE=mock` serve só para desenvolvimento local.

## Pontos a ajustar pós-primeira chamada real

- Confirmar `idServico` exato (chave principal — `darf-routes.js`, `/preview`)
- Confirmar nomes dos campos no `dados` do request (`montarPayloadDarfSerpro`)
- Confirmar nomes dos campos no response (`SerproProvider.gerarDarf`)
- Validar formato de erro (texto vs estrutura JSON com código)
