# CFI — Consultor Fiscal Inteligente

Plataforma de gestão de documentos fiscais da SP Assessoria Contábil (~213 empresas clientes; maioria SP, também BA, CE, DF, GO, RJ, SC). **Substitui o SIEG** e não se integra com ele. Não sugira SIEG como destino de integração.

## Regras de ouro (sempre)

- **Nunca faça commit, push ou deploy sem aprovação explícita do Paulo.**
- Nunca altere URLs, domínios, subdomínios, DNS ou domain mapping sem pedido explícito.
- Não mexa no repo/projeto `Consultor-DP` / Módulo Folha nem no `plano-contas-iob`. São projetos separados.
- Respostas diretas e executivas, sem preâmbulo. Comandos em blocos prontos para colar no terminal.
- **Este arquivo é carregado em toda sessão. Mantenha-o enxuto (menos de 150 linhas).** Não registre aqui histórico de sessões, narrativas ou incidentes. O histórico completo está em `docs/historico-claude.md`. Consulte-o com `grep -n "termo" docs/historico-claude.md`, **nunca lendo o arquivo inteiro** (tem mais de 500 KB). Registros novos de sessão devem ser anexados lá, de forma resumida.
- **Economize contexto:** filtre saídas longas (`| tail -50`, `grep -i error`), não leia `node_modules/`, `dist/`, `package-lock.json` nem dumps de XML ou JSON grandes por inteiro.

## Stack

- Frontend: React + TypeScript (Vite). Backend: Node/Express (`server.js` na raiz).
- Firebase: Auth, Firestore, Storage. IA: Gemini 2.5-pro.
- Docker → Cloud Run. Cron via Cloud Scheduler.
- GCP project: `consultorfiscalapp` · serviço: `consultor-fiscal-inteligente` · região: `us-west1`
- Repo: `Paulocpjunior/consultor-fiscal-inteligente`, branch `main`.

## Ambiente (Mac)

- O Paulo usa dois Macs. No **MacBook-Pro-de-Paulo-16** o gcloud aponta para o projeto errado. Antes de qualquer comando gcloud, rode:
  ```bash
  gcloud config set project consultorfiscalapp
  ```
- BSD sed (`sed -i ''`). Para substituições multilinha, prefira Python heredoc a `sed`.
- Segredos: capture com `read -s NOVA_KEY` e use `$NOVA_KEY`. Nunca imprima segredos.

## Metodologia de patch

- Faça substituições literais (`str_replace`), **nunca regex**.
- Crie backup `.bak` com timestamp, verifique a contagem de substituições e reverta automaticamente em caso de falha.

## Gates antes de commit e deploy

1. `node --check <arquivos .js alterados>`
2. `npm run build` deve terminar com exit 0 e zero erros de TypeScript.
   E também `npm run lint && npm run lint:strict`: o deploy roda o tsconfig ESTRITO, e o `build` não (deploy 998 caiu por índice de regex `string | undefined`).
   E `npx jest` DEPOIS de anexar a nota em `docs/historico-claude.md`: a trava `novidadesCobremAsEntregas` compara a data da última nota com `public/novidades-cfi.html` (deploy 1003 caiu por entrega sem novidade). Toda entrega com efeito para quem usa ganha novidade na página + `NOVIDADES_VERSAO`.
3. **Em sessão do Claude Code na web/nuvem, o container nasce SEM `node_modules`. Rode `npm ci` ANTES de afirmar qualquer porta.** Sem dependências, `vite` e `jest` nem existem e o `check-backend-nomes.mjs` acusa `setImmediate` (sem `@types/node` os globais do Node somem; `process`/`Buffer` viram TS2591, que o checker ignora, mas `setImmediate` cai como TS2304). Vermelho sem dependências é retrato do container, **não do repositório** — e nunca vira afirmação em PR. Se as portas não puderem rodar, diga isso, não chame de verde nem de vermelho.
4. Antes do deploy, rode `git fetch origin` e compare HEAD com `origin/main`, por causa da divergência entre os dois Macs.
5. No Cloud Run, use **sempre `--update-env-vars` / `--update-secrets`, nunca `--set-*`**. O `--set` apaga as outras variáveis (incidente de 15/05, com Gemini fora do ar por cerca de 2 dias).

## Como escrever trava (teste)

- **A asserção cobra o FATO, nunca a redação nem a forma da linha.** Exigir uma frase literal, a ordem dos nomes num `import` ou a posição de um trecho faz a trava ficar vermelha sobre código certo — e manda reescrever para agradar o teste. Três casos assim num único dia (23/09).
- **Alcance da trava = alcance da regra.** Varrer o arquivo inteiro para cobrar algo que vale para um bloco gera alarme falso, e alarme falso é trava desligada.
- **Feche a classe por VARREDURA, não por lista de arquivos.** Lista envelhece em silêncio no próximo caso.
- **Fixture tem de ALCANÇAR o ramo sob teste.** Verde sobre código não exercitado é pior que teste nenhum — confira que o caso chega onde você quer.
- **Teste que lê o relógio ou o fuso da máquina não é trava, é sorteio.** Hora, dia e fuso entram por parâmetro (env), e quem os exercita é UM teste declarado; o resto pina. Duas mordidas reais: a suíte do SBC ficou verde no CI às 17:00 e vermelha às 06:38 do dia seguinte sem mudança de código, e uma fixture que carimbava data em UTC contra um script que filtra pela data LOCAL reprovava em BRT toda noite das 21h à meia-noite. Ao mexer em algo com data/hora, rode a suíte com `TZ=` variado (ex.: `TZ=Pacific/Honolulu npx jest <arquivo>`).
- Ao ler diferença entre ramos, saiba qual das duas você está lendo: `git diff main ramo` (duas pontas) mostra como remoção o que o ramo apenas não tem; o PR usa `main...ramo` (três pontas).

## Invariantes de código

- O Firestore rejeita `undefined`. Passe tudo por `sanitizePayload()` antes de gravar.
- `serverTimestamp()` não funciona dentro de arrays. Use `new Date().toISOString()`.
- Para selecionar empresas, todo módulo usa `getEmpresasParaPerfilCliente(user)` de `xmlFiscalService.ts` (tipo `EmpresaPerfilOption`). Nenhum módulo cria a própria query de empresa.
- Empresas mescladas: respeite o filtro `_merged_into`.

## Domínio fiscal

- `NFeDistribuicaoDFe` só entrega notas de **entrada**. A captura de saída é um mecanismo separado: scraping do portal SEFAZ-SP seguido de `consChNFe`, com janela de 90 dias.
- A SEFAZ limita por IP cerca de 1 h por CNPJ. **Nunca contorne `sefaz_locks`** (expiração de 45 min), porque isso gera bloqueio cStat=656.
- O SERPRO Integra Contador exige procuração e-CAC por cliente. A regra de certificado A1 vale só para NFe/SEFAZ.
- Autenticação SAPI (Caixa Postal): o `jwt_token` vem separado do `access_token` e precisa ir no header `jwt_token`, senão a resposta é AcessoNegado.
- DCTFWeb: o CFI **apenas confere**, não monta nem transmite.
- SPED Fiscal: o CFI gera o arquivo. A transmissão é feita fora, via PVA + Receitanet.
- Arquivos IOB SAGE / Folhamatic: largura fixa, Windows-1252, CRLF. Use `iconv-lite`.

## Integrações

- Secret Manager: `gemini-api-key`, `graph-client-secret`, `cfi-empresa-cert-key`, `sefaz-cron-secret`.
- Microsoft Graph (Mail.Send) usa `GRAPH_CLIENT_ID` e `GRAPH_TENANT_ID`. SharePoint usa 5 variáveis `SHAREPOINT_*`.
- Certificados A1 por empresa: AES-256-GCM, guardados em Storage + `empresas_certificados`.
- **WhatsApp Calling (SBC Asterisk, VM `sbc-whatsapp`, us-west1-a):** funciona ponta a ponta desde 23/09 (ligação real caiu na URA com áudio). A Meta só entrega chamada **dentro da grade `call_hours`** — seg–sex 08:00–12:00 e 13:00–17:30, America/Sao_Paulo, e **a VM roda em UTC**. Fora da grade, "nenhum INVITE no log" é a resposta CERTA: não vira chamado na Meta. Diagnóstico: `scripts/sbc-diagnostico.sh`, rodado DENTRO da VM.
- Principais coleções: `documentos_fiscais`, `carteiras`, `empresas_certificados`, `caixa_postal_mensagens`, `sefaz_locks`, `sefaz_cron_logs`, `xml_erros`, `sharepoint_alertas_log`, `notas_ocultas`, `invoices_manuais`, `categorias_credito_custom`, `nfsesp_capturas_*`, `nfse_tomadas`.

## Crons

- Entrada SEFAZ: diariamente às 02h. Saída SEFAZ (novo): às 05h. Caixa Postal: segundas às 03h. Alertas SharePoint: a cada 6h.

## Regras de conteúdo fiscal

- **Alerta, nunca contorno:** cadastro errado ou faltando gera um alerta que diz ONDE corrigir. Nada de auto-preenchimento ou dedução "esperta".
- **Ausente ≠ zero:** campo de valor não recebe default. Zero só entra quando zero É a resposta.
- **Leiaute não se chuta:** estrutura de arquivo fiscal só entra com o XSD/leiaute conferido ou com um arquivo real de espelho.
- **Farol honesto:** zero nunca é sucesso, lista cortada diz "mostrando X de N" e ausência de sinal nunca vira prontidão.
- Nunca digite URL de Cloud Run. Derive com `gcloud run services describe <svc> --region <r> --project <p> --format='value(status.url)'`.

## Pendências e fila de trabalho

A fila de features, a fila do Paulo e as pendências operacionais estão em `docs/historico-claude.md`. Localize as seções com:

```bash
grep -n "^## " docs/historico-claude.md
```

Depois leia só o intervalo necessário com `sed -n 'INICIO,FIMp'`.
