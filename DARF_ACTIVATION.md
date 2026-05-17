# Ativação SERPRO — Emissão de DARF

Complemento do `SERPRO_ACTIVATION.md`. Cobre apenas a ativação do produto
**PAGTOWEB** (DARF), que é separado do PGDASD (DAS Simples) já ativo.

## Status atual

- ✅ Código backend pronto (`sefaz-backend/darf-provider.js`)
- ✅ Provider Mock funcional (default, gera DARF fictícia pra teste)
- ⚠️ Provider SERPRO precisa de **confirmação do `idServico` exato** antes
  do primeiro flip para produção

## Pré-requisitos

1. **Produto PAGTOWEB contratado** na Loja SERPRO
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
- Acessar "Catálogo de Serviços" → produto PAGTOWEB
- Procurar serviço com nome semelhante a `EMITEDARF`, `EMITEGUIADARF`,
  `GERADARF`, etc.
- Anotar:
  - Nome exato do `idServico` (ex: `EMITEDARF61`)
  - Nome dos campos esperados em `dados` (codigoReceita, periodoApuracao,
    valorPrincipal, vencimento — confirmar se variam)

## Passo 2 — Configurar Cloud Run

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=\
DARF_MODE=serpro,\
SERPRO_DARF_SISTEMA=PAGTOWEB,\
SERPRO_DARF_SERVICO=<nome_confirmado_no_portal> \
  --region us-central1 --project consultorfiscalapp
```

> Os envs `SERPRO_DARF_SISTEMA` e `SERPRO_DARF_SERVICO` permitem ajustar
> sem rebuild — caso o serviço mude de nome ou tenha versionamento.

## Passo 3 — Validar com dry-run

Antes de virar produção real, valide o roteamento sem chamar a API:

```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=DARF_MODE=serpro,SERPRO_DRY_RUN=1 \
  --region us-central1 --project consultorfiscalapp
```

Emita uma DARF pela UI. Deve retornar payload com `_dryRun: true`.
Isso confirma que o roteamento Mock → Serpro funcionou.

Depois remova o dry-run:
```bash
gcloud run services update consultor-fiscal-inteligente \
  --remove-env-vars=SERPRO_DRY_RUN \
  --region us-central1 --project consultorfiscalapp
```

## Passo 4 — Primeira emissão real

Recomendado: começar com **uma empresa de teste própria** (CNPJ da SP
Contábil ou similar), valor mínimo (R$ 10,00), competência atual.

Verifique no response:
1. `codigoBarras` tem 44 dígitos válidos
2. `linhaDigitavel` formatada corretamente
3. `pdfBase64` retornado (se aplicável)
4. Pagamento simulado funciona no app bancário (sem efetivar)

Se algum campo do response não bater com o que está no
`darf-provider.js` (linhas 178-188), ajustar mapeamento e abrir novo PR.

## Rollback rápido

Se algo der errado:
```bash
gcloud run services update consultor-fiscal-inteligente \
  --update-env-vars=DARF_MODE=mock \
  --region us-central1 --project consultorfiscalapp
```

Instantâneo — mock volta a atender, sem rebuild.

## Pontos a ajustar pós-primeira chamada real

Procure por `TODO[SERPRO_REAL]` em `darf-provider.js`:
- Confirmar `idServico` exato (chave principal)
- Confirmar nomes dos campos no `dados` do request
- Confirmar nomes dos campos no response (`numeroDocumento`,
  `codigoBarras`, `dataVencimento`, `docArrecadacaoPdfB64`, etc.)
- Validar formato de erro (texto vs estrutura JSON com código)
