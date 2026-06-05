# Emissão de NFS-e Padrão Nacional (CGSN 189/2026)

Antes deste PR, `nfse-nacional-provider.js` tinha um stub `SerproProvider` que
**lançava erro** no construtor — emissão real era impossível, só `mock`.

Agora: pipeline real ponta-a-ponta contra o **Emissor Nacional NFS-e** do
gov.br (gratuito, oficial, sem SERPRO). Pré-requisito regulatório: Resolução
CGSN 189/2026 obriga toda ME/EPP do Simples Nacional **prestadora de
serviços** a emitir via Sistema Nacional NFS-e a partir de **1º/setembro/2026**.

## Arquitetura

```
EmitirModal (UI)                        // components/NfseNacional/EmitirModal.tsx
   │ POST /api/admin/nfse-nacional/emitir
   ▼
nfse-nacional-routes.js                 // entrada HTTP (já existia)
   │
   ▼
nfse-nacional-orchestrator.js           // persiste em nfse_nacional_emitidas
   │
   ▼
nfse-nacional-provider.js (NOVO)        // EmissorNacionalProvider
   │ 1) buildDpsXml         (nfse-nacional-dps-builder.js — PURO testável)
   │ 2) carregarCertPrestador (cert da empresa via cert-storage.js)
   │ 3) pfxToPem            (pfx-to-pem.js — extrai PEM)
   │ 4) assinarDpsXml       (nfse-nacional-dps-signer.js — XMLDSig RSA-SHA256)
   │ 5) gzip + base64 + envelope JSON
   ▼
nfse-nacional-emissao-client.js (NOVO)  // POST mTLS https.Agent + pfx
   │
   ▼
https://sefin.nfse.gov.br/SefinNacional/nfse   (produção)
https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse  (produção restrita / homologação)
```

## Variáveis de ambiente

| Var | Default | O que faz |
|---|---|---|
| `NFSE_NAC_MODE` | `real` | `real` = emite pelo SEFIN. `mock` = gera local sem chamar gov.br. `serpro` é alias de `real` (compat). |
| `NFSE_NAC_EMISSAO_AMB` | `homologacao` | `homologacao` aponta pra produção restrita. `producao` aponta pro SEFIN real. **Default conservador — só vai pra produção quando você setar explicitamente.** |
| `NFSE_NAC_EMISSAO_DRY_RUN` | (vazio) | `=1` constrói o XML **completo e assinado** mas **não envia**. Retorna o XML no response do `/emitir`. Use no primeiro disparo pra inspecionar antes de queimar tentativa real. |
| `NFSE_NAC_EMISSAO_BODY_FIELD` | `dpsXmlGZipB64` | Nome do campo JSON onde vai o gzip+base64. Se o primeiro real-run apontar nome diferente no SEFIN, ajuste aqui sem rebuild. |

## Procedimento operacional pro primeiro emit

1. **Cert A1 do prestador** (não do escritório) cadastrado em `cert-storage`
   — UI: Configurações → Certificado Digital → upload PFX por empresa.
   Sem isso o provider lança: *"Cert do prestador (X) não encontrado"*.
2. **Empresa adesa** ao Emissor Nacional (gov.br/nfse). Sem adesão, SEFIN
   responde 4xx "empresa não credenciada".
3. **Primeira execução em DRY_RUN homologação:**
   ```
   NFSE_NAC_EMISSAO_DRY_RUN=1 NFSE_NAC_EMISSAO_AMB=homologacao
   ```
   Clica Emitir → response tem `status: 'dry-run'` + `xmlDps` completo.
   Inspeciona o XML, confere que os campos batem com o esperado pelo XSD oficial.
4. **Remove DRY_RUN, mantém homologação:** dispara real contra produção restrita.
   Se SEFIN retornar 4xx de schema, devolve o XML + a mensagem; ajustamos um
   campo no builder e testamos de novo (normal em integração nova).
5. **Quando passar em homologação:** `NFSE_NAC_EMISSAO_AMB=producao`.

## Cancelamento

Não implementado nesta fase. Cancelamento via `POST /nfse/{chave}/eventos`
exige builder + signer próprios do evento (estrutura diferente do DPS).
Vigência CGSN 189 é o caminho crítico — cancelamento é fluxo mais raro,
fica como PR separado.

## Honestidade sobre limites desta implementação

- O **PDF do Manual v1.2 oficial** retorna HTTP 403 sem cert ICP-Brasil
  (proteção do gov.br). Não consegui ler o detalhamento campo-a-campo do
  "Anexo I — RN_DPS_NFSe".
- O builder foi feito com base na **convenção SPED** (NFe/CTe são da mesma
  família) + o que o `MockProvider` já validava + o que o `EmitirModal`
  coleta. Estrutura conservadora.
- O **primeiro disparo real em produção restrita** pode retornar erro de
  schema (nome de campo, ordem, atributo faltando). Quando isso acontecer,
  o XML rejeitado + a mensagem do SEFIN permite ajustar 1-2 campos no
  builder. **Isso é normal em integração nova — não é falha de implementação.**

## Testes

15 testes unitários (`__tests__/nfseNacionalDpsBuilder.test.ts`) cobrindo:
- Formato do ID DPS (42 chars: IBGE+tpInsc+CNPJ+Serie+Numero).
- Estrutura raiz (`<DPS xmlns versao>` + `<infDPS Id>`).
- Escape XML (`S&P`, aspas, tags HTML embutidas).
- Formatação 2 casas decimais de valor/alíquota/ISS.
- Tomador CNPJ vs CPF mutuamente exclusivo + `<NIFNaoInformado/>` fallback.
- ISS retido (`tpRetISSQN` 1 ou 2).
- Ambiente produção vs homologação (`tpAmb` 1 ou 2).
- Endereço do tomador opcional.
- Validações de campos obrigatórios.

Signer (`nfse-nacional-dps-signer.js`) e cliente HTTP (`emissao-client.js`) NÃO
têm teste unitário — dependem de cert real e rede. Validação acontece no
primeiro real-run via DRY_RUN.

## Endpoints oficiais

- **Produção:** https://sefin.nfse.gov.br/SefinNacional
- **Produção restrita / homologação:** https://sefin.producaorestrita.nfse.gov.br/SefinNacional
- **Manual técnico:** https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica
- **PoC oficial (referência C#):** https://github.com/nfe/poc-nfse-nacional
