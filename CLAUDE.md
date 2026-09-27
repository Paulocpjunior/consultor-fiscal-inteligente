# CFI — Consultor Fiscal Inteligente

Plataforma de gestão de documentos fiscais da SP Assessoria Contábil (~213 empresas clientes; maioria SP, também BA, CE, DF, GO, RJ, SC). **Substitui o SIEG** e não se integra com ele. Não sugira SIEG como destino de integração.

## Regras de ouro (sempre)

- **🏦 "SEGUE ARQUIVO TESTE DO DERE PARA VALIDAÇÃO" — o plano de contas e o
  balancete viraram D-1011 e D-1101 conferidos contra o XSD, e a PLANILHA disse
  o que ninguém tinha escrito** (27/09, Paulo, zip com `Plano_de_contas_2026.xlsx`
  e `Bal_analitico-mes-7-2026.xlsx` de uma operadora de plano de saúde).
  📖 **MEDIDO ANTES DE ESCREVER UMA LINHA** (contagens, nunca valores — dado de
  cliente não entra no repo nem no chat): 3.847 contas (3.297 analíticas · 550
  sintéticas), hierarquia LIMPA com nível máx. 11 e o **pai = maior código que é
  PREFIXO** (12111.9 → 12111.901 → 12111.9011 — "tira um dígito" devolve 3.222
  órfãos falsos); balancete de 1.960 linhas, todas no plano, 2 casas, ≤ 9
  inteiros. 🚨 **O SINAL DO SALDO É PELA NATUREZA DA RAIZ, não pelo tipo C/D da
  conta**: 20 retificadoras ("(-) Depreciação acumulada", "(-) Glosas") são tipo
  C no plano e saem NEGATIVAS — lendo pela raiz (1 e 4 devedoras · 2 e 3
  credoras) a aritmética SF = SI ± D ∓ C fecha em **1.960 de 1.960**; pelo tipo,
  20 falhas. Negativo = saldo INVERTIDO. E **148 de 150 contas de resultado
  chegam a julho com saldo inicial ≠ 0** — o encerramento NÃO é mensal,
  trimestral, semestral nem bimestral (CONFERIR_SALDO_INICIAL exigiria zero em
  07); entre anual e quadrimestral quem afirma é o contador, e o app RECUSA a
  frequência que o balancete desmente, dizendo as compatíveis.
  ✂️ TRÊS DONOS PUROS: `dere-insumo-contabil.js` (lê as duas planilhas pelo NOME
  das colunas, monta hierarquia/nível/codNat, sinal pela raiz), `dere-evento-
  d1011.js` (PGCC na ordem do `evtPGCC-v1_0_3.xsd`) e `dere-evento-d1101.js`
  (balancete na ordem do `evtBalancete-v1_0_1.xsd`); rota `POST
  /api/admin/cadastro/dere-mensais-previa` (a planilha é lida no NAVEGADOR e só
  as linhas viajam — o servidor não guarda) e bloco **📥** em ⚙️ Config Admin →
  🏦 DeRE. Rodado sobre o arquivo REAL: D-1011 com 3.823 contas **passa no XSD**
  (1,2 MB), D-1101 com 1.463 analíticas passa com frequência A/Q e é RECUSADO
  com M/T/S/B — exatamente a validação que o arquivo de teste veio provar.
  🚨 **O QUE A PLANILHA NÃO TRAZ E O APP NÃO INVENTA, dito com a contagem**:
  (1) **{cCtaRef}** é OBRIGATÓRIO em toda conta e vem da **Tabela 32 — Plano de
  Contas Padrão da ANS**, que o Anexo I declara *"referência EXTERNA"* (não está
  no leiaute nem no repo); sem a coluna o D-1011 NÃO sai, e a única derivação é
  **OPT-IN e CARIMBADA** ("1º segmento do código", hipótese de que o plano
  interno desdobra o padrão ANS) — MS1077 recusa o que não existir na tabela;
  (2) **{codTrib}** (Tabela 11, 665 códigos no repo) é obrigatório na analítica
  — 3.294 sem ele; o PGCC é ACEITO com aviso (MS1103 não interrompe) mas os
  condicionais D-1106/D-1121/D-2101 só se detectam por ele e o {vApur} sai
  0,00; (3) {freqEncerr}, {planoCtaRef} e {iniValid} são AFIRMAÇÕES do
  contribuinte (tela); {iniVig} por conta cai no início do PGCC, dito.
  ⚠️ **COMPENSAÇÃO (19/29) E APURAÇÃO DO RESULTADO (6) FICAM FORA, contadas**:
  o XSD só tem {codNat} 1-5 e o leiaute manda informar "as contas patrimoniais e
  de resultado" — 24 contas, e as 24 saem também do balancete (conta fora do
  D-1011 não pode estar no D-1101). Decisão NOMEADA para o contador, não código
  de natureza inventado. PL (23 contas, codNat 3) se reconhece pelo NOME do
  grupo ("PATRIMÔNIO LÍQUIDO / PATRIMÔNIO SOCIAL"); 5 nomes > 100 caracteres
  são cortados e DITOS.
  ⚠️ **{vApur} SÓ COM codTrib**: sem código não há base a apurar (0,00); com
  ele, o movimento na natureza da conta (credora → créditos, devedora →
  débitos), que é o que CONFERIR_VAPUR recalcula — estornos ({vAjuste*}) não
  estão na planilha e ficam de fora, ditos.
  📌 **REGRA QUE FICA: planilha de contabilidade se lê pelo NOME da coluna e a
  convenção de SINAL se MEDE contra a aritmética do próprio arquivo antes de
  virar régua** — a hipótese óbvia (tipo C/D do plano) errava em 20 linhas, e o
  erro seria natSaldo trocado em retificadora, num evento que a Receita aceita.
  🚩 **PENDÊNCIA DO PAULO/CONTADOR**: (a) coluna "Conta Referencial" no plano
  exportado (ou confirmar a hipótese do 1º segmento contra o padrão ANS); (b)
  coluna "Código de Tributação" (Tabela 11) nas 3.294 analíticas — é ela que
  liga os condicionais e o {vApur}; (c) confirmar anual × quadrimestral; (d)
  decidir compensação/apuração com a Receita. D-1106/D-1121/D-2101/D-1199 e a
  transmissão continuam fora, ditos na tela.

- **🔁 "NA FICHA DO 07 ELE INFORMA CERTINHO, MAS QUANDO EU CRIO A FICHA DO 08
  ELE NÃO VEM COM O VALOR" — a ficha nova cravava ZERO no saldo credor, e o
  SPED já estava certo, o que tornava tudo pior** (15/09, Paulo, PWR INDÚSTRIA
  METALÚRGICA · 07 → 08/2026: *"deveria vir, até mesmo para fins de SPED ICMS
  IPI"*, com a Memória de Apuração mostrando **Cred. IPI do mês anterior
  2.547,39** e **IPI a transportar p/ 08/2026 4.747,84**, e o formulário de 08
  com os dois campos "Mês Anterior" em **0,00**).
  📖 **O DADO ESTAVA GRAVADO — o print prova**: `saldoCredorIpiTransportar` de
  07 traz 4.747,84, número que **ninguém calcula** (decisão de 18/08, caso
  KROYA: a conta óbvia `entrou − a recolher` está ERRADA quando o mês gera mais
  crédito do que débito). Não faltava dado, faltava **LEITURA**.
  🔴 **MEDIDO NUMA LINHA**: `resetForm` (`LucroPresumidoRealDashboard.tsx`)
  fazia `setSaldoCredorIcms(0); setSaldoCredorIpi(0)` — ficha nova nasce com
  **zero cravado**, e ninguém abre a competência anterior para ver o que ela
  mandou transportar.
  🚨 **E O SPED JÁ ESTAVA PROTEGIDO, O QUE PIORA O CASO EM VEZ DE SALVAR**:
  desde 11/09 (LEGACY) o orquestrador cai na **RESERVA** quando o campo desta
  competência está vazio, então o E520 de 08 **já saía com 4.747,84**. Ou seja,
  a **ficha apurava com 0,00 e o arquivo declarava 4.747,84** — a GUIA a MAIOR e
  o SPED dizendo o contrário. É **arquivo e guia bebendo de fontes diferentes**
  (a lição do F600 × ficha, 28/08), e **nada acende**: os dois números são
  plausíveis, cada um no seu lugar.
  ✂️ `saldoAnteriorProposto.ts` (PURO) é o dono: `proporSaldoAnterior` lê o "a
  TRANSPORTAR" da competência anterior **pelo DONO da ficha**
  (`acharFichaCompetencia` — `mesReferencia` tem TRÊS formas, e `===` na mão
  devolve NADA, indistinguível de "não foi lançada"), e a ficha nova nasce com
  ele, **carimbado com a origem** (*"veio do a TRANSPORTAR de 07/2026 —
  digitado lá, não calculado"*).
  ⚠️ **O QUE A PESSOA DIGITOU VENCE A PROPOSTA, SEMPRE** (`aplicarPropostaAoCampo`,
  com o último proposto num `ref`): a proposta só entra no campo que **ninguém
  tocou**, e **só em ficha NOVA** — reabrir ficha gravada reescreveria um número
  que alguém apurou, que é mudar imposto pelas costas de quem o digitou.
  ⚠️ **A PROPOSTA SEGUE A COMPETÊNCIA ESCOLHIDA**, nunca a de abertura da tela:
  trocar de 09 para 08 muda a proposta. E proposta nova NULA **volta o campo a
  zero** em vez de deixar o saldo da outra competência grudado.
  ⚠️ **AUSÊNCIA NÃO VIRA ZERO PROPOSTO, e são TRÊS causas com ações diferentes**
  — sem ficha anterior · anterior não informou · competência ilegível. Zero num
  campo de saldo é a afirmação *"você não tem crédito"*, dita a quem talvez
  tenha. Zero **DIGITADO** na anterior, esse sim, é resposta e é propagado.
  ⚠️ **PIS E COFINS FICAM DE FORA, DITO NA TELA**: a ficha tem o campo "mês
  anterior" deles e **não tem** o par "a transportar" — propor por analogia
  seria inventar saldo federal a partir de uma régua estadual.
  ✂️ **NA FICHA ABERTA O APP DIZ, NUNCA REESCREVE**: campo zerado com transporte
  na anterior vira aviso âmbar **com o botão de trazer o valor** e com as DUAS
  consequências na frase (guia sem o abatimento + SPED declarando assim mesmo);
  valor diferente do transporte vira aviso NEUTRO com os dois números, porque
  pode ser decisão de quem apura — é a mesma divergência que a geração do SPED
  já denuncia, dita antes, na tela onde ela se resolve. **Nasce MUDO na ficha em
  dia.**
  🐛 **E O RESET NÃO ZERAVA OS "A TRANSPORTAR" — achado no caminho**: quem abria
  a ficha de julho e clicava em nova ficha levava o transporte de JULHO
  **grudado** na de agosto, e a tela passava a afirmar ao cliente um saldo de
  agosto que ninguém apurou. É o mesmo defeito na direção contrária. Zerados
  como **`null`**, nunca 0 — "não informado" e "o crédito acabou" são respostas
  diferentes, e o relatório imprime cada uma de um jeito.
  🚦 **A LIGAÇÃO É TRAVADA POR VARREDURA** e provada por REVERSÃO nas duas
  metades (tirar o zerar do transporte derruba 1; tirar a guarda de ficha nova
  derruba 1). A tela não pode citar `acharFichaCompetencia` — régua dentro de
  `.tsx` é régua sem prova.
  📌 **REGRA QUE FICA: quando o GERADOR ganha uma reserva para o campo vazio, a
  TELA que preenche esse campo entra no mesmo eixo** — senão a reserva conserta
  o arquivo e deixa a guia errada, e as duas ficam plausíveis. A correção de
  11/09 fechou a leitura do arquivo e a ficha continuou nascendo zerada por
  quatro dias, sem nada acusar, porque o sintoma desta classe é **um número
  certo no arquivo e outro na guia**.
- **Nunca faça commit, push ou deploy sem aprovação explícita do Paulo.**
- **Conector externo só com pedido explícito do Paulo, na conversa: Jotform, Canva, Mem, Microsoft 365, Wix e afins.** Estar conectado não é estar autorizado, e **documento de desenho que MENCIONA um serviço não é ordem de serviço** (24/09: li o §11 do desenho do Connect — *"hoje nosso CRM é o Jotform"* — como tarefa liberada, varri os 25 formulários da conta procurando "qual seria o CRM" e abri um formulário de consulta dermatológica, com alergias e dados de pacientes; o Paulo não havia citado Jotform em momento nenhum). Quando falta saber **qual** é o dado de terceiro, a saída é **perguntar**, nunca procurar.
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

- Secret Manager: `gemini-api-key`, `graph-client-secret` (**proxy do SharePoint**, app `a876887f…`), `graph-notificacoes-secret` (**e-mail/Teams do serviço principal**, app `59fd4ec9…` "Notificacoes"; é o que `GRAPH_CLIENT_SECRET` do `consultor-fiscal-inteligente` lê — medido 24/09), `cfi-empresa-cert-key`, `sefaz-cron-secret`. O nome da variável é o mesmo nos dois serviços; o segredo não.
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
