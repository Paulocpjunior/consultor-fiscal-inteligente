# Porte do envio de e-mail (Graph) do CFI para o CCI — kit de 24/09

Pedido do Paulo (24/09): *"implementar esta configuração dos e-mails no app irmão CCI,
parametrizando o mesmo layout e ativando sempre que o remetente do e-mail é sempre o
colaborador logado, devendo observar que se trata do departamento contábil"*.

Esta sessão não tinha acesso ao repositório do CCI (`plano-contas-iob`) — a abertura foi
negada pela permissão da sessão. Os arquivos aqui são o porte pronto para colar no CCI.

## O que copiar (para `backend/` do CCI)

| Arquivo | O que é | Diferença para o CFI |
|---|---|---|
| `email-layout.js` | casca HTML com logo inline, faixa, rodapé | `MARCA.departamento = 'Departamento Contábil'`; assinatura "Consultor Contábil Inteligente"; logo em `backend/assets/` |
| `graph-provider.js` | token client-credentials + `enviarEmail` por `/users/{remetente}/sendMail` | nenhuma |
| `graph-remetente.js` | remetente = colaborador logado se a caixa é do domínio do escritório; senão a institucional; detecção de "caixa inexistente" para refazer pela institucional | nenhuma |
| `sp-logo-email.png` | logo de 21 KB otimizado para e-mail (vai inline por `cid:`) | nenhuma |

## A rota de envio (modelo do CFI, `sefaz-backend/envio-imposto-routes.js`, rota `/graph`)

```js
import { enviarEmail } from './graph-provider.js';
import { escolherRemetente, dominiosPermitidos, ehErroDeCaixaInexistente } from './graph-remetente.js';
import { montarEmailGuia, anexoLogo } from './email-layout.js';

const padrao = process.env.GRAPH_REMETENTE || 'junior@spassessoriacontabil.com.br';
const escolha = escolherRemetente({ emailColaborador: req.user?.email, padrao, dominios: dominiosPermitidos() });
let remetente = escolha.remetente;
const corpoHtml = montarEmailGuia({ tipo, empresaNome, competencia, mensagem, temPdf: !!pdfBase64, vencimento });
const anexos = [ ...(pdfBase64 ? [{ name: nomeArquivo, contentType: 'application/pdf', contentBytes: pdfBase64 }] : []), ...anexoLogo() ];
let envio = await enviarEmail({ remetente, para, bcc: [GESTOR], assunto, corpoHtml, anexos });
if (!envio.ok && escolha.fonte === 'colaborador' && ehErroDeCaixaInexistente(envio.error)) {
    remetente = padrao;               // colaborador sem caixa: refaz pela institucional, DITO na resposta
    envio = await enviarEmail({ remetente, para, bcc: [GESTOR], assunto, corpoHtml, anexos });
}
```

Regras que o CFI aprendeu e o CCI deve manter:

- **Remetente = colaborador logado** (`req.user.email`), só se a caixa for do domínio do escritório
  (`spassessoriacontabil.com.br`; extras em `GRAPH_DOMINIOS_REMETENTE`). Fora disso, a institucional.
- **Gestor sempre em cópia** (BCC), e o envio grava auditoria com `enviadoPor`, `remetente`, `fonteRemetente`.
- **`saveToSentItems: true`**: a cópia fica em Itens Enviados da caixa do colaborador.
- Sem PDF, o e-mail DIZ que a guia não foi anexada (farol honesto) — não sai como se tivesse.

## Credencial no Cloud Run do CCI

O app do Azure é o mesmo do CFI (**"Consultor Fiscal Inteligente - Notificacoes"**, `59fd4ec9-…`),
com `Mail.Send` de aplicação no tenant — serve para qualquer serviço do escritório. O segredo é o
**`graph-notificacoes-secret`** (o `graph-client-secret` é do proxy do SharePoint — outro app):

```bash
gcloud config set project consultorfiscalapp
gcloud run services update <SERVIÇO-DO-CCI> --region <REGIÃO> \
  --update-env-vars GRAPH_CLIENT_ID=59fd4ec9-37bd-472c-9fa7-373461dffd50,GRAPH_TENANT_ID=<TENANT>,GRAPH_REMETENTE=junior@spassessoriacontabil.com.br \
  --update-secrets GRAPH_CLIENT_SECRET=graph-notificacoes-secret:latest
```

`GRAPH_TENANT_ID` é o mesmo do `consultor-fiscal-inteligente` (`gcloud run services describe … | grep GRAPH_TENANT_ID`).
Nunca `--set-env-vars`: apaga as outras variáveis. Rotear tráfego pelo NOME da revisão, não `--to-latest`.

## O mata-burro (leve junto)

No CFI o vigia (`sefaz-backend/graph-credencial-vigia.js`) sonda a credencial todo dia dentro do cron
de saúde, ANTES de tentar mandar o alerta por e-mail, grava o veredito em `health_alertas/graph-email`
e a tela mostra uma faixa vermelha para todos enquanto a Microsoft recusar. A lição: **o alerta de
saúde sai por e-mail — credencial morta é alerta mudo.** No CCI, a mesma sonda + faixa; e a régua
`forma-do-segredo.js` (36 caracteres = Secret ID, 40 = Value) pega o erro de colagem antes de doer.
