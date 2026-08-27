# CFI — Consultor Fiscal Inteligente (SP Assessoria Contábil)

Memória de trabalho para sessões do Claude. Atualize ao assumir compromissos
com o Paulo (admin/dono) — é daqui que a próxima sessão retoma.

## Regras permanentes de operação

- **🔒 FASE 5 DO TÚNEL: o CCI importa o FECHAMENTO, nunca a ficha** (26/08,
  Paulo: *"o departamento contábil, através do CCI, deve fazer a importação com
  a mesma exatidão dos valores apurados e o mês fechado"*).
  🔴 **A ficha é um registro VIVO** — alguém edita e o número muda. Servi-la
  pelo túnel faria o Contábil puxar um valor que pode mudar depois dele ter
  importado, e a divergência voltaria pela porta de trás, calada. O que
  atravessa é o **CARIMBO**: imutável e VERSIONADO.
  🚨 **E O CCI NÃO RECALCULA — a `ressalva` vai em TODA linha entregue.** É a
  régua já provada no R-2055 (12/08): *"a ressalva PROÍBE recalcular do outro
  lado"*. Dois números para o mesmo fato é o pior defeito de um arquivo fiscal,
  e é exatamente isso que este túnel existe para impedir.
  📌 **TRÊS RECUSAS DELIBERADAS**: (1) competência **ABERTA não entrega valor**
  (`podeImportar` só é true em 'fechada') — entregar número de mês aberto seria
  entregar um valor que ainda vai mudar; (2) **REABERTA BLOQUEIA** a importação
  — decisão do Paulo, que abriu exceção à régua da casa (*"acende, não
  bloqueia"*) **porque é dinheiro em duas contabilidades** —, e a resposta DIZ
  qual versão o Contábil pode ter importado, senão ele fica com o número velho
  sem saber que ele mudou; (3) empresa **sem fechamento NÃO SOME da lista** —
  sumir faria o Contábil concluir *"este cliente não teve movimento"*, uma
  afirmação que ninguém fez.
  ⚠️ **O LASTRO ATRAVESSA, e o resumo o conta À PARTE** (`semLastro`): número
  fechado que pode ter ZERO documento por trás é o caso EXPERTE (15/08), e sem
  a ressalva ele chega limpo na tela de quem vai lançar na contabilidade.
  ⚠️ **A competência é OBRIGATÓRIA na consulta** e recusa com o motivo — sem ela
  não dá para dizer QUAL mês foi fechado, e importar o mês errado não volta
  atrás.
  📌 **O ID DO CARIMBO SAI DO DONO** (`idDoFechamento`) também aqui — a
  competência circula em quatro formas, e a rota normaliza na porta.

- **🔒 OS LEITORES DO FIM DE MÊS — o arquivo passou a sair do ACERVO QUE O
  CARIMBO CONGELOU** (26/08, a segunda leva). O carimbo guardava o instante do
  corte e **ninguém o lia**: os dois SPED continuavam gerando do acervo de
  HOJE. Sem isto, o arquivo de agosto regerado em dezembro sai DIFERENTE se uma
  nota de agosto chegou em novembro — e o Contábil já importou o outro número.
  🚨 **A ARMADILHA QUE DECIDIU O DESENHO, e ela foi MEDIDA**: o instante de
  chegada é gravado em **DOIS nomes e DOIS tipos** — `createdAt`/`importadoEm`,
  como Firestore Timestamp em três trilhos e como **string ISO** no
  `nfse-sp-importer.js:172`. Um `.where('createdAt','<=',corte)` deixaria de
  fora, **EM SILÊNCIO**, todo documento gravado como string: o Firestore ordena
  por TIPO, e string nunca cai num range de Timestamp. Seria o livro a MENOR,
  na direção mais cara. Por isso a comparação é **em MEMÓRIA**, por um dono só
  (`chegouEmMs`, que lê as quatro formas).
  ⚠️ **`dhEmi` FICA DE FORA de propósito** — ele diz quando a nota foi EMITIDA,
  não quando ela chegou aqui. Usá-lo faria a nota emitida em 30/08 e capturada
  em 02/09 passar pelo corte como se já estivesse na base, que é exatamente o
  caso que o Paulo descreveu.
  ⚠️ **AUSÊNCIA NÃO É PROVA, e aqui isso decide O LADO DO ERRO**: documento sem
  instante legível **FICA** e sai NOMEADO. Tirá-lo produziria livro a MENOR (o
  erro caro); mantê-lo produz no máximo um documento a mais que o carimbo
  contou — e o aviso leva o total do carimbo para conferir.
  📌 **O ID DO CARIMBO É RÉGUA ÚNICA** (`idDoFechamento`, em
  `fechamento-store.js`): a competência circula em quatro formas, e
  `${id}_07/2026` é um documento DIFERENTE de `${id}_2026-07`. **A varredura
  pegou a segunda cópia na hora** — a trava da ficha montava o id à mão. O I/O
  é que difere entre os dois SDK (admin × modular); o ID, não.
  📌 **E O `warnings` SÓ NASCE DEPOIS DO PONTO DO RECORTE** nos dois
  orquestradores — um `push` ali seria `ReferenceError`, a MESMA classe que
  derrubou a geração do SPED em 20/08. Os avisos ficam guardados e entram onde
  o array existe.
  ✅ Sem fechamento — ou com a competência **REABERTA** — nada muda: quem não
  usar o ato gera exatamente como antes. E o recorte **nasce MUDO** quando nada
  ficou de fora, senão seria alarme sobre arquivo normal.

- **🔒 "DAR FIM DE MÊS" — o ato que vira a RÉGUA de impostos, livros, ficha e
  do CCI** (26/08, Paulo: *"o fechamento do fim do mês no CFI exige (DAR FIM DE
  MÊS), essa função é que deve ser usada como régua para nos nortear, usar como
  base p impostos, livros, ficha financeira, exatamente o que o CCI deve usar
  como base para importação do contábil"*).
  🔴 **A CAUSA: o app DEDUZIA que o mês fechou.** A Rotina olhava documentos,
  ficha, tarefas e envios e concluía — o cabeçalho dela diz, literal: *"Nada
  aqui 'marca como feito' na mão"*. Isso é honesto para GUIAR e não serve para
  NORTEAR, porque dedução muda quando a fonte muda: o livro de agosto
  reimpresso em dezembro sai DIFERENTE se uma nota de agosto chegou em
  novembro; a ficha de competência entregue podia ser editada e o número mudava
  **em silêncio** (não havia `fechadoEm`, `fechadoPor` nem versão em
  `FichaFinanceiraRegistro`); e o Contábil importava valor que podia mudar
  depois dele ter importado.
  ✂️ **A COMPOSIÇÃO É O CORAÇÃO**: as 5 etapas da Rotina viram a
  **PRÉ-CONDIÇÃO** (*"você PODE dar fim de mês?"*) e o ato responde *"o mês FOI
  fechado — quando, por quem, com qual acervo, com quais valores"*.
  ⚠️ **E ISSO MUDOU O SIGNIFICADO DO FAROL `ok`**: ele deixou de querer dizer
  "mês fechado" e passou a dizer "pronto para fechar". Pela régua de 23/08 (o
  `capturaNfeOk`), o leitor entrou no MESMO PR — o `✓ Mês fechado` da Rotina
  virou `✓ Pronto para dar fim de mês` + o botão. Meia correção aqui trocaria
  um erro por uma CONTRADIÇÃO, com uma tela dizendo fechado e a outra aberto.
  ✅ **O CARIMBO CONGELA TRÊS COISAS, e elas têm de concordar por CONSTRUÇÃO**:
  o **ACERVO** (instante do corte + `ultNSU`/`maxNSU` — a prova de QUAIS
  documentos viraram aquele número), os **VALORES APURADOS** e o **LASTRO**
  (quantos documentos existiam por trás; sem ele o CCI recebe número fechado
  com ZERO documento atrás, que é o caso EXPERTE de 15/08).
  🚨 **O CARIMBO LEVA RESULTADO, NUNCA INSUMO** — faturamento, despesa, folha e
  CMV ficam de fora de propósito: levá-los convidaria o outro lado a
  RECALCULAR, e dois números para o mesmo fato é o pior defeito de um arquivo
  fiscal. É a régua já provada no R-2055 (*"a ressalva PROÍBE recalcular do
  outro lado"*). ⚠️ E apurado ausente vira **null, nunca zero** — zero num
  campo de saldo é uma AFIRMAÇÃO, e esta atravessa para a contabilidade.
  ⚠️ **A ÂNCORA É O INSTANTE, e o NSU é a PROVA — não trocar um pelo outro**: o
  NSU só existe no trilho DistDFe, e cofre de e-mail, portal de SP, ADN e
  importação manual não têm NSU nenhum, então corte ancorado nele deixaria
  metade da captura fora da trava.
  📌 **AS TRÊS DECISÕES DO PAULO, travadas por teste**: (1) fecha o
  **COLABORADOR**, reabre **SÓ ADMIN** — o número já pode ter sido importado
  pela contabilidade; (2) **BLOQUEIA** — etapa em âmbar não passa, e não há
  justificativa que fure (eu recomendei justificativa escrita, ele manteve o
  bloqueio; ⚠️ consequência dita e aceita: cliente com captura em âmbar por
  infraestrutura — as 202 do A3, a EXPERTE — **não fecha, e não chega ao CCI**);
  (3) **uma empresa por vez**, a família do *"ninguém emite em série"*.
  ⚠️ **E O BLOQUEIO NOMEIA A ETAPA E DIZ ONDE SE RESOLVE** — com a decisão de
  bloquear, essa lista é a ÚNICA saída que a pessoa tem, e trava sem caminho é
  trava que a equipe contorna (13/08).
  ⚠️ **`reaberta` NÃO conta como fechada**, de propósito: tratá-la assim
  travaria justamente a edição que a reabertura veio permitir. E reabrir não é
  "desfazer" — é **RETIFICAÇÃO**: motivo escrito (≥15 caracteres, o piso da T3
  da DCTFWeb), **versão nova** e o valor da versão anterior guardado, que é a
  única forma de responder depois *"o Contábil importou QUAL número?"*.
  📌 **A ESCRITA É SÓ DA ROTA, e aqui isso É a trava**: a pré-condição é
  conferida no backend, então `allow write: if false` nas rules — escrita pelo
  navegador tornaria o bloqueio inteiro contornável com um `setDoc`.
  📌 **A ROTINA DE UMA EMPRESA SAI DO MESMO DONO DO PAINEL**
  (`montarRotinasDaCompetencia`, extraída neste PR): uma segunda montagem
  divergiria no pior lugar — o painel diria "pronto" e o botão recusaria.
  🚩 **O QUE ESTE PR NÃO FAZ, e é a próxima leva**: os LEITORES fiscais ainda
  não perguntam ao carimbo (livro, os dois SPED, guias e DIPAM continuam
  gerando ao vivo), e o **túnel do CCI ainda não entrega o fechamento**. O que
  já protege o número hoje é o carimbo guardar uma **CÓPIA** dos apurados —
  editar a ficha não o altera — mais a trava que recusa a edição da ficha de
  competência fechada, com a frase mandando pedir a reabertura ao admin.

- **🚨 O CATÁLOGO DE COLEÇÕES TINHA UM FANTASMA — e a varredura só fechava UMA
  direção** (26/08, achado no caminho do fim de mês). `catalogoBanco.test.ts`
  barrava `.collection('x')` sem linha no catálogo; a volta — **coleção
  catalogada que ninguém escreve** — estava aberta, e `lucro_fichas` estava lá.
  🔴 Ela **NUNCA EXISTIU**: a ficha do Lucro é EMBUTIDA no documento da empresa
  (`fichaFinanceira[]`). Foi ela que deixou o saldo de IPI em **0,00** até
  19/08 — a leitura consultava `db.collection('lucro_fichas')` e a query voltava
  vazia SEMPRE, indistinguível de *"não tem saldo"*. Corrigido o leitor, a linha
  do catálogo ficou descrevendo o fantasma. É a MESMA família do
  `tipoTributacao`: **campo/coleção que só existe no lugar que o declara**.
  📌 E o painel Sistema→Banco já sabia dizer *"catalogada sem uso"* — só que em
  tempo de EXECUÇÃO e só para quem o abre, que é dev-only. **Trava escrita não
  é trava ligada.**
  🐛 **E A VARREDURA NASCEU ERRADA DE DUAS FORMAS, as duas MEDIDAS antes de
  subir**: (1) ela lia **PROSA** — os dois orquestradores do SPED têm um
  comentário citando `db.collection('lucro_fichas')` justamente para DIZER que
  ela não existe, e isso contava como prova de que existe (a IDA tinha o mesmo
  vício, e as duas brigavam sobre o mesmo fato); (2) o stripper de comentário
  `/\*[\s\S]*?\*\//` **engoliu 105 KB dos 157 KB do `server.js`** — um `/*`
  dentro de string faz o casamento atravessar o arquivo — e levou junto
  `das_envios_cliente`, que está lá em `.collection(...)`, acusando-a de
  fantasma. **Alarme falso que aparece justamente quando está tudo certo é o
  jeito conhecido de a equipe desligar a trava.**
  ✂️ Saem só comentário de LINHA e linhas de bloco que começam com `*`. E a
  VOLTA **não usa a extração de padrão da IDA**: ali eu já TENHO o nome, então
  basta procurá-lo — usar a extração acusou SEIS coleções que existem, porque
  metade do backend nomeia a coleção por CONSTANTE (`const COL_MSGS =
  'cofre_email_mensagens'`). **Provada criando um fantasma de propósito.**
  📌 **REGRA QUE FICA: varredura de fonte lê CÓDIGO, nunca prosa — e comer
  comentário de bloco com regex é perigoso.** É a terceira vez que a leitura de
  comentário engana uma trava desta casa (o `.select(` da projeção em 22/08, a
  régua única do ISS no mesmo dia, agora o catálogo).

- **🚨 O PAINEL COBRAVA UM CAMPO QUE NÃO EXISTE — 236 empresas em ALTO por uma
  pendência IMPOSSÍVEL DE RESOLVER** (26/08, Paulo com dois prints lado a lado:
  o cadastro da **A CASTELLANO** mostrando *"Regime Tributário: Lucro
  Presumido"* e o painel de Cadastros incompletos dizendo *"`tipoTributacao` —
  Tipo (Presumido/Real) não definido"*).
  🔴 **A varredura fechou a questão em um grep**: `tipoTributacao` aparecia em
  **DOIS lugares no repo inteiro** — no `diagnostico-cadastros-helper.js`, que
  o EXIGIA, e no teste dele, que descrevia a exigência. **Nenhuma tela grava,
  nenhum gerador lê, nenhum importador preenche.** Como ninguém o preenche, a
  pendência nascia em **100% das empresas do Lucro** — é isso que explica o
  **236 em ALTO**, e o número não é a carteira torta: é o painel medindo um
  campo que não existe.
  🔴 **E É A ARMADILHA DAS DUAS FORMAS NO CADASTRO**: o modal grava
  `dadosFiscais.regimeTributario` — o campo que nasceu em **18/08** com dono,
  vocabulário (SIMPLES · LUCRO_PRESUMIDO · LUCRO_REAL · IMUNE · ISENTA) e
  precedência própria —, e o painel perguntava por outro nome. Quem preenchia
  no modal **nunca** conseguia apagar a pendência.
  ✂️ Quem responde agora é o **DONO** (`regimeDaEmpresa`), com a precedência da
  casa: cadastro explícito > `regimePadrao` > coleção. A pendência só nasce
  quando `apuracaoDefinida` é **false** — ou seja, quando o regime está mesmo
  indefinido — e a frase passou a **APONTAR O LUGAR** (*"escolha Lucro
  Presumido ou Lucro Real em Empresas → Dados Fiscais → Regime Tributário"*),
  que é a régua do achado 18 de 21/08.
  ✅ **E IMUNE/ISENTA deixam de virar pendência**: são regimes PRÓPRIOS, não
  "regime indefinido". Cobrá-los de um templo seria o caso da igreja de 18/08
  ao contrário.
  📌 **O CUSTO NÃO É A LINHA ERRADA — É O PAINEL INTEIRO PERDENDO CRÉDITO.**
  Alarme que a carteira toda recebe e ninguém consegue apagar ensina a equipe a
  ignorar a lista, **inclusive as 3 pendências CRÍTICAS que estavam certas**.
  É a família da "rota sem botão" (13/08) e do aviso que aponta lugar
  inexistente (21/08): quem procura, não acha, e conclui que o app está
  quebrado.
  ✂️ **A CLASSE VIROU TRAVA POR VARREDURA** (`pendenciaTemCampoGravavel.test.ts`):
  todo campo que o diagnóstico exige tem de aparecer em código de produção FORA
  do próprio helper — campo que só existe no lugar que o cobra é fantasma por
  definição. A lista de campos é **lida da FONTE** (`add('<campo>'`), nunca
  copiada, senão ela envelhece no primeiro campo novo. Provada revertendo o
  `tipoTributacao` de propósito.
  📌 **REGRA QUE FICA: pendência nasce apontando o campo que a TELA grava, e o
  teste de gravidade não pode ser a única prova de que ela existe.** O teste
  antigo passava verde descrevendo a exigência do campo fantasma — ele
  documentava o defeito em vez de pegá-lo. **Trocar a fixture foi o certo; ela
  descrevia um mundo que a produção não vive.**
  ✅ **MEDIDO EM PRODUÇÃO NO MESMO DIA (deploy 820): 236 → 2, e o OK saltou de
  186 para 420.** Ou seja, **234 das 236 eram alarme falso** — o painel media
  um campo que não existe. Os **2 que sobraram são reais** (empresa do Lucro
  com o regime de fato em branco) e os **3 CRÍTICOS continuam**, corretos.
  📌 **E ISSO FECHA A RÉGUA DE 22/08 pela via certa: impacto se MEDE no painel,
  não se deduz do código.** Eu tinha escrito aqui *"o número não está conferido
  em produção"* justamente para não carimbar "236 resolvidas" antes da prova —
  e a prova veio do print dele, não da minha leitura do diff. **Quando eu deduzi
  impacto** (o ADN, 22/08) **eu errei; quando esperei o painel, o número veio
  maior do que eu teria estimado.**
  ✂️ **E O SUBTÍTULO DA TELA AINDA DESCREVIA O FANTASMA** — *"Alto = DAS/DARF
  não calcula (sem anexo / **tipo tributação**)"*. A tela tem de nomear o campo
  que a pessoa PREENCHE, senão ela procura o que não existe; passou a dizer
  *"sem regime tributário"*, que é o nome do campo no modal.

- **✅ A PWR FECHOU O EFD-CONTRIBUIÇÕES — e com ela o BLOCO C tem recibo pela
  primeira vez** (26/08, Paulo: *"PWR · MANTOAN · AFFITTARE · PEC · CF BANK —
  todas essas foram ref. à obrigação EFD CONTRIBUIÇÕES"*). É a **PRIMEIRA
  INDÚSTRIA** a fechar esta obrigação, e é o que faltava: MANTOAN, HS,
  AFFITTARE, PEC e CF BANK são todas de SERVIÇO ou de receita sem documento —
  nenhuma passava pelo bloco C.
  📌 **O QUE ISSO ENCERRA**: em 20/08 o bloco C do EFD-Contribuições levou
  **157 recusas de importação** de uma vez (C100 saindo com 24 campos onde o
  leiaute tem 29, C170 com 23 onde tem 37, a seção de ICMS/IPI inteira PULADA,
  e os outros 125 erros todos consequência do mesmo defeito de FORMA). Agora
  o recibo prova: `C100` **29**, `C170` **37**, `M210`/`M610` com **COD_CONT
  51**, e `M205`/`M605` preenchidos.
  📌 **E ENCERRA O CASO DOS CINCO DIAS** (25/08, `VL_REC_BRT` 38.316,84 ×
  37.754,60). A resposta estava na *Validação* do M210 campo 03 do Guia 1.35 —
  `VL_REC_BRT` é a Σ dos `VL_ITEM` dos C170, que são BRUTOS, e o desconto e o
  ICMS têm campos PRÓPRIOS. O imposto nunca esteve errado; o recibo confirma
  que a base reduzida (Tema 69) e o rateio do desconto saem certos no arquivo.
  🏁 **O PLACAR DO EFD-CONTRIBUIÇÕES: SEIS empresas e CINCO formas de arquivo
  provadas por recibo** — detalhado só com documento de SERVIÇO (MANTOAN),
  detalhado com documento + F600 de retenção (HS PROJETOS), consolidado só com
  F550 (AFFITTARE), detalhado com documento + F100 (PEC), sem documento nenhum
  com F100 de aplicação financeira (CF BANK) e agora **detalhado de INDÚSTRIA,
  pelo bloco C** (PWR). **As seis saem do MESMO gerador** — o que muda é a
  régua que decide o perfil, nunca um caminho paralelo por cliente.
  ✅ **E A PWR PASSA A SER A ÚNICA EMPRESA COM AS DUAS OBRIGAÇÕES FECHADAS**:
  o EFD ICMS/IPI dela fechou em 20/08 e o EFD-Contribuições agora. Ou seja, o
  mesmo cliente tem os dois arquivos aceitos saindo do mesmo app — que é a
  prova ponta a ponta que faltava para a família do Lucro.
  ⚠️ **O QUE ISSO NÃO PROVA, e não pode virar leitura larga**: (1) **seis
  clientes fechados não são a carteira fechada** — quem diz quem pode migrar
  continua sendo a 🏁 Fila de migração, cliente a cliente, e o gargalo hoje é
  CAPTURA (202 empresas com A3, 42 sem A1 válido), não leiaute; (2) o **bloco
  D** continua sem recibo — nenhuma das seis tem CT-e no EFD-Contribuições, e
  ele só fecha com empresa do NÃO-cumulativo que tenha frete contratado;
  (3) o **E510 (IPI)** e o **E200/E210 (ST)** seguem sem passar pelo PVA.
  🚩 **E FICA UMA PERGUNTA NOMEADA, não uma suposição**: não sei se estes
  arquivos foram regerados ANTES ou DEPOIS do deploy 815. Se foi depois, eles
  são também a prova em PRODUÇÃO de que as travas de 26/08 nasceram MUDAS no
  arquivo correto — que é justamente o que o teste de controle existia para
  medir. Carimbar isso sem saber seria o "print prova o ARQUIVO, não o código"
  ao contrário.

- **🚨 O LADO DA CONTRAPARTE TINHA CINCO CÓPIAS — e o próprio dono já carregava
  o aviso do defeito que elas têm** (26/08, fechando a pendência nomeada em
  22/08: *"restam ~60 leituras cruas de `direcao` e elas NÃO foram triadas uma
  a uma"*). São **82**, e a triagem por RISCO mostrou que a maioria é legítima
  — filtro que a PESSOA escolhe, linha já AGREGADA (a direção foi resolvida a
  montante), o próprio dono, e direção de MENSAGEM, que é outro domínio.
  🔴 **Mas CINCO lugares reimplementavam a MESMA pergunta** — *de que lado está
  a contraparte?* —, que tem dono desde 22/08 (`ladoDaContraparte`). E o
  comentário do dono já diz, palavra por palavra, por que ele existe: *"a nota
  própria de entrada é emitida PELA EMPRESA. Sem esse laço, o `tpNF=0` de um
  TERCEIRO viraria 'nossa' nota própria — e a contraparte sairia do lado
  errado"*.
  🔴 **TRÊS das cinco faziam exatamente isso: `tpNF === '0'` e mais nada** — a
  contraparte de **TODOS os relatórios** (`relatoriosAgregacoes`), o **Livro do
  produtor rural** (`livroNotaProdutor`) e a contagem da **Rotina do Mês**
  (`rotina-fiscal-routes`). É o cenário KROYA × GOLDLOG (17/08): dois clientes
  negociando entre si, a nota própria de entrada de UM aparece na base, e a
  coluna mostraria o **PRÓPRIO cliente como fornecedor**.
  🐛 **E UMA TINHA O LAÇO MAS LIA A FORMA ERRADA**: o `dipam-routes` conferia
  `d.emitente.cnpjCpf` — só o ANINHADO — enquanto a captura principal grava
  `cnpjEmit` **ACHATADO**. Ali ela respondia *"não é própria"* na maioria das
  notas. É a armadilha das duas formas escondida DENTRO de uma cópia que
  parecia correta; delegar ao dono corrigiu isso de brinde.
  ⚠️ **E A CORREÇÃO SÓ FOI SEGURA PORQUE FOI MEDIDA ANTES.** A troca "óbvia"
  tinha um risco real: o dono exige o CNPJ da empresa, e documento sem
  `empresaCnpj` responderia *"não é própria"* para uma nota LEGÍTIMA — a
  contraparte sairia errada na direção contrária. Fui ler o backfill: ele **só
  vira a nota para 'entrada' quando `cnpjEmit === empresaCnpj`**, e ANTES dele
  ela fica gravada como `'saida'`, que o dono reconhece sem precisar do CNPJ.
  **Nos dois estados ele responde certo** — e é isso, não a intuição, que
  autorizou a troca. É a lição de 22/08 (*"a correção óbvia produz o defeito na
  hora"*) aplicada ANTES de custar.
  🐛 **E A TRAVA NASCEU LARGA DEMAIS, pega na primeira execução**: a assinatura
  `const propriaEntrada = String(` acusou `migracao-prontidao.js`, que pergunta
  *"é saída própria?"* e **faz o laço na linha de cima** — código certo.
  Estreitada para casar só a ESCOLHA DO LADO (`propriaEntrada ? …destinatario`
  e `direcao === 'saida' || propriaEntrada`), porque *"é nota própria de
  entrada?"* é OUTRA pergunta e tem dono próprio (`ehNotaPropriaDeEntrada`).
  **Alarme sobre código certo é o que faz a equipe desligar a trava.**
  📌 **REGRA QUE FICA: duas perguntas, dois donos.** Onde a cópia juntava as
  duas numa expressão só (`propriaEntrada ? destinatario : emitente`), a
  delegação chama as DUAS funções — e foi justamente a junção que produziu a
  cópia. Quando uma condição responde duas coisas ao mesmo tempo, ela vira a
  próxima segunda cópia.
  ⚠️ **O que NÃO foi mexido, e por quê**: as leituras de WhatsApp/Connect
  (direção de MENSAGEM, outro domínio), os `filters.direcao` (a escolha da
  PESSOA, que é a fonte), as linhas já agregadas dos relatórios (`l.direcao`,
  exibição 'E'/'S') e o `notaDigitada.ts` (lançamento manual — ali a direção é
  o que a pessoa DIGITOU, não um campo capturado que possa mentir).

- **🚨 SÓ UMA DAS SEIS SOMAS C100 × C190 ESTAVA CONFERIDA — e o par é o que já
  custou um dia inteiro da PWR** (26/08, fechando a varredura do Guia do EFD
  ICMS/IPI). O Guia 3.2.3 repete a MESMA validação em seis campos do C100 —
  *"a soma dos valores do campo <X> dos registros analíticos (C190) deve ser
  igual ao valor informado neste campo"* — e a prevalidação só perguntava pelo
  **VL_DOC × VL_OPR** (a R14, que nasceu do caso PWR de 20/08). Faltavam
  `VL_BC_ICMS`, `VL_ICMS`, `VL_BC_ICMS_ST`, `VL_ICMS_ST` e `VL_IPI`.
  🚨 **E A CONDIÇÃO QUE PRODUZ O DEFEITO CONTINUA NO GERADOR**: o **C100 lê os
  TOTAIS DO DOCUMENTO** (`totais.vBC`, `totais.vICMS`…) e o **C190 agrega os
  ITENS** — duas fontes diferentes, montadas em passos diferentes. É a MESMA
  dupla que produziu o `VL_OPR` sem o IPI, e ali o PVA nem recusa: ele só
  imprime um total menor.
  🐛 **E O COMENTÁRIO DO PRÓPRIO GERADOR JÁ AFIRMAVA O QUE NINGUÉM CONFERIA**:
  `// VL_BC_ICMS — bate com ΣC190`, escrito ao lado do campo. É o vício de
  13/08 na forma mais barata de todas — **regra escrita não é regra travada**,
  e comentário que afirma um invariante sem teste é a pior das duas, porque a
  próxima pessoa lê e acredita.
  ⚠️ **O CAMPO 22 É O QUE ALIMENTA A APURAÇÃO**: é a soma dos `VL_ICMS` dos
  C190 que vira débito e crédito no E110 (a R7 confere exatamente isso). Um
  C100 que discorda dos próprios filhos põe o LIVRO e a APURAÇÃO em números
  diferentes para a MESMA nota — e o colaborador compara o livro, não o C190.
  ✅ **NASCE VERDE sobre o gerador REAL em quatro cenários** — a NF 7 da PWR,
  nota com dois grupos de CST/CFOP com ST e IPI, cancelada e NFC-e. O teste
  **chama o `buildBlocoC`**, nunca uma linha escrita à mão.
  ⚠️ **As duas exceções ficam declaradas**: a **cancelada** sai com os campos
  VAZIOS (Exceção 1) e sem filhos; na **NFC-e** os campos de ST, IPI, PIS e
  COFINS são PROIBIDOS no C100. Comparar nos dois casos acusaria nota correta.
  E nota **sem nenhum C190** continua sendo a R6, que já diz a causa certa —
  dois alarmes para UM defeito é o caminho para a equipe ignorar os dois.
  📌 **A CONTA DO DIA**: o Guia do EFD-Contribuições tem **343** validações
  oficiais (92 em registros que o gerador emite) e o do ICMS/IPI tem **885**
  (147). Elas são a lista de recusas do PVA escrita ANTES de elas acontecerem —
  e ler essa lista custa uma tarde, enquanto descobri-la uma volta de PVA por
  vez é o gargalo que o Paulo nomeou em 20/08.

- **🚨 A APURAÇÃO NUNCA TINHA SIDO PERGUNTADA SE FECHA CONSIGO MESMA — e é
  dela que sai a GUIA** (26/08, a mesma varredura, agora no Guia do EFD
  ICMS/IPI). O Guia 3.2.3 está no repo desde 20/08 e tem **885** linhas de
  *"Validação:"*; **147** são de registros que o gerador emite. As mais caras
  estavam descobertas — e este registro **já mordeu duas vezes, as duas com
  teste verde**:
  · **02/08** — o **E110 campo 11** (saldo DEVEDOR) recebia o saldo CREDOR em
  valor absoluto: o arquivo declarava imposto a pagar num mês em que a empresa
  era CREDORA. Cada total, isolado, estava certo; o que não fechava era a
  **EXPRESSÃO**, e nada perguntava por ela.
  · **19/08** — o **E520** foi lido na posição errada pelo parser do espelho,
  com o `VL_OD_IPI` ocupando a casa do saldo credor. Passou meses despercebido
  porque pouquíssimos clientes têm IPI e o número plausível era **zero**.
  ✂️ **TRÊS REGRAS NOVAS, todas com a expressão LITERAL do Guia**: **R17** — o
  E110 fecha consigo mesmo (campos 11, 13 e 14, com a conta escrita por extenso
  no próprio Guia); **R18** — `VL_ICMS_RECOLHER + DEB_ESP` = Σ `VL_OR` dos
  E116, ou seja *o que o livro apura é o que a obrigação cobra* (os dois lados
  são montados em passos diferentes do gerador, e divergirem é o defeito que
  ninguém confere a olho); **R19** — o saldo do IPI no E520 segue a própria
  conta, travada contra a linha REAL da PWR (2.547,39 + 2.200,45 = 4.747,84).
  ⚠️ **UM CENTAVO DE TOLERÂNCIA nas três**: os campos saem de
  `aplicarAjustesApuracao`, que arredonda a cada passo. Alarme sobre
  arredondamento é o que ensina a equipe a ignorar a prevalidação — e erro de
  SINAL ou campo trocado de casa erra por ORDEM DE GRANDEZA.
  ✅ **NASCEM VERDES nos CINCO caminhos que a régua de apuração produz hoje** —
  devedor simples, devedor com dedução, credor no período, com saldo credor
  anterior, e dedução MAIOR que o saldo devedor (que não vira crédito). O teste
  monta o E110 **chamando a própria `aplicarAjustesApuracao`**, nunca uma linha
  escrita à mão: fixture que não é o que o gerador produz é teste verde sobre
  defeito vivo.
  ✂️ **E A RÉGUA DO PERÍODO MUDOU DE CASA NO MESMO DIA EM QUE NASCEU.** De
  manhã ela entrou só no EFD-Contribuições; a varredura mostrou a MESMA
  validação no Guia do ICMS/IPI, e deixá-la numa família só é a "meia trava" do
  COD_MUN do 0150 — protege o cliente que já quebrou e deixa o próximo
  descoberto. `conferirPeriodoDoArquivo` foi para `sped-c100-regras-comuns.js`
  (o dono declarado das regras que valem nas duas famílias) e o Contribuições
  passou a DELEGAR.
  ⚠️ **A POSIÇÃO É PARÂMETRO, nunca dedução do vizinho**: campos **04/05** no
  EFD ICMS/IPI e **06/07** no EFD-Contribuições, cujo 0000 traz `IND_SIT_ESP` e
  `NUM_REC_ANTERIOR` antes das datas. Carimbar a posição do outro arquivo faria
  a regra ler a **razão social** como se fosse data — é literalmente o erro que
  o teste do DT_FIN pegou em 22/08, e há um caso no teste provando isso.
  📌 **REGRA QUE FICA: quando a fonte oficial repete a mesma validação nos dois
  Guias, a régua nasce no módulo COMUM — não se escreve nela duas vezes nem se
  escreve numa só.** É a terceira vez que esta mudança de casa acontece
  (`linhasMalformadas` em 21/08, o C100 e o COD_MUN do 0150 em 22/08), e as
  três foram descobertas DEPOIS de a trava já estar rodando pela metade.

- **🚨 O GUIA TEM 343 LINHAS DE "Validação:" E NINGUÉM AS TINHA LIDO** (26/08,
  logo depois de o bloco D fechar). O Guia entrou no repo em 25/08 e serviu
  para responder DUAS perguntas pontuais; a varredura mostrou que ele carrega
  **343 validações oficiais**, e **92 delas** são de registros que o gerador de
  fato emite. Cruzando com a prevalidação, duas classes inteiras não estavam
  cobertas.
  ✂️ **(1) `VL = base × alíquota ÷ 100`, exigida em SEIS registros** — A170
  (campos 12 e 16), C170 (30 e 36), D101/D105 (08), F100 (10 e 14) e F550 (07
  e 12). O Guia escreve a conta por extenso no D101: *"Sendo o Campo
  'VL_BC_PIS' = 1.000.000,00 e o Campo 'ALIQ_PIS' = 1,6500, então o Campo
  'VL_PIS' será igual a: 1.000.000,00 x 1,65 / 100 = 16.500,00"*.
  🚨 **É A ASSINATURA DO CAMPO DESLOCADO, e ela é a que esta casa mais paga**:
  o M210 da MANTOAN (18/08) declarava base **R$ 0,65** com contribuição de
  **R$ 285,28** — os VALORES estavam certos e a FORMA errada, com o registro se
  desmentindo dentro de si mesmo. **A contagem de campos pega o registro que
  PERDEU campos; esta pega o que manteve a contagem e trocou as casas.**
  🐛 **E A CONTA SOZINHA NÃO PEGAVA O CASO MAIS PROVÁVEL — descoberto medindo a
  própria régua, antes de subir**: multiplicação é **COMUTATIVA**, então base e
  alíquota trocadas de casa dão exatamente o mesmo produto, e a trava ficava
  MUDA no deslocamento de UM campo. Quem desempata é o que a alíquota **É**: um
  PERCENTUAL. Nenhuma alíquota ad valorem de PIS/COFINS passa de 100%, então
  número maior ali é o campo do vizinho ocupando a casa. **Medir a trava é
  parte de escrevê-la** — a versão que "passava nos testes" tinha um buraco do
  tamanho do caso real.
  ⚠️ **A TOLERÂNCIA DE DOIS CENTAVOS É O QUE FAZ ELA SERVIR, e a prova é um
  arquivo ACEITO**: o F550 da AFFITTARE traz 21.811,34 × 0,65% = 141,7737
  declarado como **141,76** — o próprio e-Fiscal arredonda para baixo, e a
  Receita aceitou. Alarme sobre arredondamento legítimo é o jeito conhecido de
  a equipe desligar a trava; e campo deslocado erra por ORDEM DE GRANDEZA,
  nunca por um centavo.
  ⚠️ **E A LINHA COM ALÍQUOTA POR QUANTIDADE FICA DE FORA**: a própria
  validação diz *"campo 26 **ou** campo 28"* — ali a conta é reais por unidade,
  sem dividir por 100. Acusá-la seria alarme sobre linha correta.
  ✂️ **(2) O PERÍODO DO 0000 TEM DE SER UM MÊS INTEIRO** (campos 06 e 07:
  *"deve ser o primeiro dia do mesmo mês de referência"* e *"o último dia do
  mês a que se refere a escrituração"*). É o campo mais caro do arquivo — ele
  diz **A QUE MÊS** tudo aquilo se refere. A varredura de competência de 22/08
  fechou o lado da PORTA, onde o efeito era arquivo VAZIO; aqui o efeito seria
  arquivo **CHEIO entregue no mês errado**, que é pior, porque ninguém confere
  data de período a olho. Fevereiro bissexto está no teste.
  ⚠️ **Data ilegível é acusada como FORMATO, não como mês errado** — dizer a
  falha errada manda procurar problema no lugar errado.
  📌 **O QUE NÃO ENTROU, E POR QUÊ**: das 92, a maioria depende de tabela
  oficial que **não está neste repo** (Municípios do IBGE, Países, 4.3.7, 0400,
  0450) ou pergunta sobre registro que o gerador não emite. Conferir contra
  tabela deduzida seria inventar a tabela — é o 1405 com outra roupa.
  📌 **REGRA QUE FICA: fonte oficial no repo não é fonte oficial LIDA.** O Guia
  passou um dia respondendo só as duas perguntas que me levaram até ele. As
  validações que ele carrega são a lista de recusas do PVA escrita ANTES de
  elas acontecerem — e ler essa lista é mais barato que descobri-la uma volta
  de PVA por vez, que é exatamente o gargalo que o Paulo nomeou em 20/08.

- **🚨 O BLOCO D NÃO É "O CT-e DO MÊS" — É A AQUISIÇÃO DE FRETE COM DIREITO A
  CRÉDITO, e o gerador tratava como se fosse o primeiro** (26/08, pendência
  nomeada desde 21/08 e cobrada pela trava de contagem que subiu no dia
  anterior). As duas fontes oficiais respondem, literais:
  📖 **Guia Prático 1.35, D100, Observações**: *"Só devem ser relacionados
  neste registro as aquisições de serviços de transportes que … confiram
  direito ao crédito do PIS/Pasep e da Cofins."* E o campo 02 (IND_OPER) tem
  **UM único valor válido: [0]**.
  📖 **Manual do Lucro Presumido (PVA 2.04)**, ao listar os registros do regime
  CUMULATIVO — Blocos 0, F, M e P mais 0200, 0500, F525, F600, 1010/1020, 1800
  e 1900 —: **o bloco D não está lá.** Não podia estar: crédito só existe no
  NÃO-cumulativo.
  🔴 **O que o gerador fazia, e as CINCO empresas fechadas por recibo são todas
  CUMULATIVAS**: ele emitia D100 em qualquer regime e em qualquer direção. Foi
  só por nenhuma delas ter CT-e no período que a recusa não chegou — e ela é a
  MESMA da PEC/AFFITTARE, *"O registro não deve ser informado para esse perfil
  e/ou tipo de operação"*, esperando o primeiro conhecimento de transporte.
  🔴 **E o leiaute estava deslocado a partir do campo 13**: 20 campos onde o
  Guia lista **23**, com o `VL_DOC` caindo na casa do **TP_CT-e** — um campo de
  UM dígito — e o valor do documento saindo **VAZIO**. PIS e COFINS iam parar
  em `IND_FRT`, `VL_SERV`, `VL_BC_ICMS` e `VL_ICMS`, que são campos de ICMS.
  🔴 **E o D101/D105 NUNCA foi emitido**, embora o Guia seja literal: *"Para
  cada documento informado e relacionado em cada registro D100,
  obrigatoriamente deve ser apresentado o detalhamento … referentes ao
  PIS/Pasep (D101) e à Cofins (D105)"*. Sem eles a base do crédito do frete
  **não é recuperada no M105/M505** — o crédito some da apuração, calado.
  ✂️ `frete-contratado-bloco-d.js` é o dono da pergunta *"este CT-e entra no
  bloco D, e com qual tratamento?"*, lido pelo gerador **e** pela prevalidação.
  Prestação aponta o **D200** (que o app ainda não gera) em vez de virar um
  D100 inválido; regime cumulativo não produz o bloco; e cada motivo de
  exclusão sai num aviso PRÓPRIO, porque as ações são diferentes.
  🚨 **TRÊS CÓDIGOS DE TABELA OFICIAL, E NENHUM ESTÁ NO XML DO CT-e**:
  `IND_NAT_FRT` (D101/D105 campo 02) descreve o que a EMPRESA fez com aquele
  frete — venda, compra, transferência —, não o que o transportador fez;
  `IND_FRT` (D100 campo 17) diz por conta de quem ele corre; e `NAT_BC_CRED`
  vem da **Tabela 4.3.7**, que o Guia só REFERENCIA e não está neste repo. Os
  três viraram cadastro (whitelist + modal no MESMO PR, regra do #382) e sem
  eles o CT-e **não entra**, com a falta nomeada e o lugar de preencher — é o
  desenho que fechou o 1900 da AFFITTARE na PRIMEIRA rodada do PVA.
  ⚠️ **E O INDICADOR `9` (Outras) É RECUSADO DE PROPÓSITO**: o Guia o amarra à
  **SUBCONTRATAÇÃO** de transporte, que tem crédito PRESUMIDO, CST 60-66 e
  alíquotas próprias (1,2375% e 5,7%, Tabela 4.3.17). Tratá-lo como os outros
  declararia crédito na alíquota errada — num arquivo que o PVA aceita.
  ✅ **O QUE A RÉGUA DERIVA, com a citação**: o CST sai do indicador — 3, 4 e 5
  vão com **70** (*"as operações que não tem previsão de apuração de crédito
  devem ser informadas com o CST 70"*), e o **1** também, porque nele o ônus é
  do ADQUIRENTE, ou seja quem escritura não pagou o frete. Sem crédito, base,
  alíquota e valor saem **ZERADOS** — e aí o zero É a resposta ("não há
  crédito"), não o default de quem não achou o dado.
  📌 **AS DUAS RECUSAS VIRARAM REGRA DA PREVALIDAÇÃO NO MESMO PR**
  (`conferirBlocoDContrib`): D100 sem D101/D105 e D100 com IND_OPER ≠ 0. Ela
  lê as LINHAS do arquivo gerado e **nasce VERDE** sobre o que o gerador
  produz hoje.
  📌 **E O D100 ENTROU NA CONTAGEM POR LEITURA HUMANA DO GUIA**
  (`CAMPOS_LIDOS_A_MAO_NO_GUIA`): a extração automática do .docx perdeu um
  número nele e o marcou como INCERTO, então a trava que subiu em 25/08 ficaria
  MUDA justamente aqui. A precedência é **recibo > leitura à mão do Guia >
  extração** — e cada entrada nomeia os campos lidos, para a conferência ser
  refazível.
  📌 **REGRA QUE FICA: antes de corrigir a CONTAGEM de um registro, perguntar
  se ele deveria estar no arquivo.** Eu vim consertar "20 campos onde o Guia
  lista 23" e o defeito de verdade era outro — o registro saía em empresa que
  não tem esse bloco, na direção que o campo não admite, e sem os dois filhos
  obrigatórios. Contar campo de um registro que não devia existir é acertar a
  forma do erro.

- **🚨 A TRAVA DE CONTAGEM COBRIA 11 REGISTROS DE 34 — e o Guia fechou o resto
  no mesmo dia** (25/08, logo depois de os dois manuais entrarem no repo).
  `conferirContagemDeCampos` roda em todo arquivo gerado desde 18/08, mas **só
  acusa o registro que está NELA** — e ela tinha onze, todos de recibo do PVA ou
  arquivo assinado. Os outros 23 que o gerador emite passavam **sem conferência
  nenhuma**: foi por isso que o 0500 saiu com o leiaute do arquivo VIZINHO e só
  o olho do Paulo pegou.
  ✂️ A contagem dos **200 registros** virou dado, EXTRAÍDA do Guia 1.35 por
  script (`scripts/extrair-leiaute-contrib.mjs`), nunca digitada — tabela
  oficial copiada à mão é a segunda cópia que esta casa mais paga. Cobertura:
  **de 11 para 33** dos 34 registros emitidos.
  🚨 **A PRECEDÊNCIA É O CORAÇÃO: recibo/assinado VENCE o Guia.** A extração de
  `.docx` erra — no 0500 o número do campo 09 se perdeu na conversão e a
  contagem sai **8** onde o assinado do CF BANK mostra **9**. Recibo é a régua
  FALANDO; extração é leitura de documento. Se o Guia vencesse, a trava
  acusaria justamente a linha CORRETA.
  ⚠️ **E REGISTRO COM NÚMERO PERDIDO NÃO ENTRA** (16 deles): a contagem estaria
  subestimada e acusaria registro certo — o jeito conhecido de a equipe desligar
  a trava. Eles saem NOMEADOS em `naoConferidos`; hoje sobra **só o 0100**.
  📌 **E A DIVERGÊNCIA GUIA × RECIBO É ACHADO, não detalhe a escolher em
  silêncio**: `divergenciasGuiaXRecibo()` nasce VAZIA e, se um dia encher, ou a
  extração falhou ou o Guia e o PVA discordam — as duas pedem olho humano.
  ⚠️ **A régua saiu do script e foi para o backend** (`leiaute-guia-extrator.js`):
  `.mjs` não carrega no jest, e **régua dentro de script é régua sem prova** —
  é a lição do E116, do E250 e da varredura de campo órfão que virou script e
  sumiu do repo. O teste regera do Guia e exige o mesmo módulo que está no repo,
  senão alguém "conserta" uma contagem à mão e ela some na próxima geração.
  🐛 **E DUAS FIXTURES FORAM TROCADAS, pelo motivo certo**: o teste da FONTE
  aceitava só `PVA|ACEITO` (o Guia é a terceira fonte legítima agora) e o
  exemplo de "registro não conferido" era o **0150**, que passou a ser coberto —
  a mesma troca que o C100 sofreu em 20/08. **Trocar a fixture é o certo;
  trocar a régua para o teste passar seria desligar a trava.**

- **🚨 CINCO DIAS NA PWR PORQUE EU NÃO TINHA O GUIA DESTA FAMÍLIA — e o campo
  estava definido por VALIDAÇÃO OFICIAL** (25/08, PWR 1364 · 07/2026). A
  pergunta era *"por que o PVA mostra 38.316,84 se o arquivo diz 37.754,60?"*.
  A resposta está escrita no **Guia Prático da EFD-Contribuições 1.35, M210
  campo 03**: *"Validação: quando o COD_CONT for igual a 01, 51, 02, 52, 31 ou
  32, o valor do campo será igual à soma dos seguintes campos … **VL_ITEM dos
  registros C170** … [IND_OPER do C100 = 1]"*.
  ✅ **`VL_REC_BRT` é a Σ VL_ITEM, e o `VL_ITEM` é BRUTO** — campo 07: *"somente
  o valor das mercadorias (equivalente à quantidade vezes preço unitário)"*,
  com a validação *"a soma dos registros C170 deve ser igual ao VL_MERC do
  C100"*. O desconto **tem campo próprio**: a **Seção 12** traz a tabela —
  no C170, *descontos incondicionais* → **campo 08 (VL_DESC)** e *exclusão do
  ICMS* → **campo 15 (VL_ICMS)**. É de lá que o PVA monta a BASE, e a base é o
  que paga: 38.316,84 − 562,24 − 6.795,83 = **30.958,77** → PIS 201,23 ·
  COFINS 928,76. **O imposto nunca esteve errado, nos cinco dias.**
  ✅ E o Manual do Lucro Presumido (PVA 2.04) fecha: *"o PVA gera automaticamente
  os registros consolidadores do Bloco M"*. Escrever outro número ali é escrever
  num campo que ele sobrescreve — foi o que a Sandra provou apagando a base
  inteira do PVA e reimportando.
  🚨 **E EU ERREI TRÊS VEZES NO MESMO DIA, sempre pelo mesmo motivo: deduzir em
  vez de ler a fonte.** (1) *"o arquivo que você validou é anterior"*; (2) *"o
  PVA está com uma importação antiga"* — e entreguei carimbo de hora no nome do
  arquivo como se fosse a solução; (3) quando ele mandou *"tem que ajustar no
  C100"*, baixei o `VL_ITEM` para o líquido **citando o Guia do EFD ICMS/IPI** —
  o arquivo VIZINHO. É o erro do 1010 (17/08) e do 0500 (24/08), agora cometido
  por mim, no argumento.
  📌 **REGRA QUE FICA: antes de citar uma validação, conferir de QUAL família é
  o Guia.** As duas famílias têm registros com o mesmo número e regras
  diferentes. Os dois manuais agora estão em `docs/sped/` (Guia 1.35 + Manual do
  Lucro Presumido PVA 2.04), então **deduzir leiaute de EFD-Contribuições passou
  a ser escolha, não falta de fonte**.
  📌 **E A SEGUNDA REGRA: quando o número da tela de um validador não é o do
  arquivo, a pergunta é "de ONDE ele tira esse número?"** — some as linhas do
  NOSSO arquivo e leia a *Validação* do campo no Guia. Duas somas e um `grep`
  responderam o que quatro dias de hipótese não responderam.
  ✂️ **A validação virou regra da prevalidação**, com a citação: `VL_REC_BRT` ×
  Σ VL_ITEM dos C170 de saída. Ela **nasce VERDE** no arquivo correto e acusa
  exatamente o que a PWR gerou por cinco dias. ⚠️ Fica **MUDA** quando há A170,
  F100, F550, D300… no arquivo — a validação lista outras fontes na mesma soma,
  e ali a Σ dos C170 é um PISO, não o total.
  ⚠️ **O RATEIO DO DESCONTO FICOU**, e é ele que faz a base sair certa: quando o
  desconto vem só no **total do documento**, cada item precisa levar a parte
  dele no campo 08, senão o PVA não tem de onde reduzir a base daquele item. É
  proporcional ao valor e fecha **na unidade** (a sobra vai no último item).

- **🚨 QUATRO DIAS NO MESMO ERRO PORQUE TODA GERAÇÃO TINHA O MESMO NOME DE
  ARQUIVO** (25/08, PWR 1364 · 07/2026, Paulo: *"Este é o 4º dia, o mesmo erro
  da mesma empresa sobre o mesmo assunto!!!!!! não dá mais pra postergar"*).
  Ele mandou o print do M210 do PVA com `VL_REC_BRT` **38.316,84** e, ANEXO na
  mesma mensagem, o arquivo gerado — que declara **37.754,60**.
  ✅ **OS DOIS ESTAVAM CERTOS.** O par que o PVA mostrava — `38.316,84 /
  30.958,77` — é **exatamente** o estado de 20/08, em que o desconto já saía da
  BASE e ainda não saía da RECEITA (está escrito neste arquivo). Ou seja: a tela
  do PVA estava com uma **importação ANTERIOR**, e o arquivo dele estava certo.
  Conferido linha a linha antes de responder: 38.316,84 − 562,24 = 37.754,60 −
  ICMS 6.795,83 = 30.958,77, e é isso que o `|M210|` do anexo traz.
  🔴 **A CAUSA DE NINGUÉM CONSEGUIR PERCEBER ISSO ERA O NOME DO ARQUIVO**: toda
  geração da mesma empresa/competência saía como
  `SPED_CONTRIB_31947349000169_202607.txt`, byte a byte o mesmo nome. Quatro
  dias de correção ⇒ quatro arquivos indistinguíveis na pasta de downloads (o
  navegador só acrescenta "(1)", "(2)"…) — e **o PVA guarda a escrituração
  IMPORTADA na base dele**, então enquanto ninguém apagar e reimportar a tela
  continua mostrando a importação velha, com o número velho.
  ✂️ O nome passou a carregar a HORA
  (`SPED_CONTRIB_<cnpj>_<periodo>_<AAAAMMDD-HHMM>.txt`), nas **DUAS famílias**,
  com dono único — meia correção deixaria o EFD ICMS/IPI com o defeito inteiro.
  O prefixo e a ordem não mudam, então quem procura por empresa/competência
  continua achando, e a ordem alfabética virou cronológica.
  ⚠️ **E o carimbo é de BRASÍLIA, não do processo**: o Cloud Run é UTC, e
  arquivo gerado às 21h sairia com a data do dia SEGUINTE — o nome existe para
  ORDENAR as gerações, então errar o fuso o faria confundir. É a armadilha de
  fuso de 22/08 na versão do rótulo.
  📌 **E O NÚMERO NA TELA NÃO BASTAVA — a prova é este caso.** O aviso com
  *"bruta 38.316,84 − desconto 562,24 = VL_REC_BRT 37.754,60"* existe desde
  24/08, e o dia seguinte começou igual. Faltava a outra metade: **DIZER QUAL
  ARQUIVO a tela está descrevendo** e o que fazer quando o PVA discorda. A
  geração passa a ecoar o nome + a linha do `M210`/`M610` (`E110` no fiscal)
  **copiada do arquivo que saiu**, com a ação: *apague a escrituração desta
  competência no PVA e importe ESTE arquivo*.
  📌 **REGRA QUE FICA: arquivo que a pessoa vai conferir em OUTRO sistema nasce
  com a hora da geração no nome.** *"Print prova o ARQUIVO, não o código — e
  arquivo tem data"* (24/08) só é acionável se o arquivo DISSER que data ele
  tem; sem isso, "confira se é o arquivo novo" é um pedido que ninguém consegue
  cumprir, e a conversa recomeça no dia seguinte.
  ⚠️ **E A LIÇÃO DE POSTURA**: em 24/08 eu respondi *"o arquivo que você validou
  é anterior à correção"* e parei ali — resposta CERTA que não resolveu nada,
  porque devolvia ao dono um trabalho que só o app podia fazer. **Quando a
  resposta é "você está olhando o arquivo errado", a entrega não é a frase: é
  tornar impossível olhar o arquivo errado.**

- **🚨 A NFC-e NÃO LEVA C170 NO EFD-CONTRIBUIÇÕES — 572 recusas num arquivo
  só** (24/08, HYPE CAFE 1385 · 07/2026, Paulo: *"deu esses erros de estrutura,
  são os NFC-E"* — e ele já tinha nomeado a causa). O Relatório de Erros de
  Importação traz **286 C170 com DUAS mensagens cada**: *"O registro não deve
  ser informado para o modelo de documento do 'Registro Pai'."* e *"…para esse
  perfil e/ou tipo de operação"*. O arquivo tem 182 C100 — **179 modelo 65 e 3
  modelo 55** — e os 5 C170 das notas 55 **passaram**: quem decide é o COD_MOD
  do PAI.
  ✅ **E ISSO NÃO TIRA UM CENTAVO DA APURAÇÃO**, o que era a primeira dúvida
  legítima: a receita da NFC-e é declarada no **C100** (VL_DOC/VL_PIS/VL_COFINS)
  e no **bloco M**, que sai de `receitaEBaseDoDocumento` — nunca do C170. Os 179
  C100 de cupom somam **19.722,70**, que é exatamente o `VL_REC_BRT` do M210 do
  mesmo arquivo. Conferido ANTES de mexer, não deduzido.
  🚨 **A METADE QUE QUASE FICOU: TIRAR O C170 CRIA ITEM ÓRFÃO NO 0200.** Rodei a
  correção sobre o arquivo REAL e medi: como ele está hoje, **0 órfãos**;
  tirando SÓ o C170 das NFC-e, aparecem **4** — `10`, `11`, `20`, `101`, que só
  existem em cupom. Seria trocar 572 recusas por outras tantas da recusa que a
  PWR já pagou em 19/08 (*"Não informar item, se não referenciado em pelo menos
  um dos demais blocos"*). Por isso a coleta do 0200/0190 lê o **MESMO dono**
  (`levaC170NoContribuicoes`) que decide o C170 — duas perguntas ligadas não
  podem ter duas respostas.
  📌 **REGRA QUE FICA: antes de tirar um registro do arquivo, medir o que ele
  SUSTENTA.** Registro do SPED quase nunca vive sozinho — o C170 referencia o
  0200, que referencia o 0190. **Meia correção não deixa o defeito pela metade:
  ela troca uma recusa por outra**, e a segunda chega no mês seguinte parecendo
  problema novo.
  🚦 **AS DUAS ENTRARAM NA PREVALIDAÇÃO NO MESMO PR** — a do C170 de cupom (com
  a recusa literal) e a do 0200/0190 órfão, que **nasce VERDE** e nasce junto da
  correção que poderia produzi-la. ⚠️ Na do órfão, quem referencia aqui são
  **C170 E A170** (no EFD ICMS/IPI é só o C170): portar a régua do vizinho sem
  trocar esse conjunto acusaria todo item de NFS-e num arquivo correto.
  ⚠️ **E O QUE ESTE CASO NÃO PROVA**: como a NFC-e se escritura no EFD **ICMS/
  IPI** — lá as restrições são de CAMPO do C100 (`COD_PART`, ST, IPI, PIS,
  COFINS — a regra R2, PS VIDROS 19/08), não de existência do C170. É a mesma
  fronteira que o 0500 acabou de cobrar no mesmo dia: **mesmo registro, arquivo
  diferente, leiaute diferente.**
  📌 **E A CAUSA VAI JUNTO DO NÚMERO**: a geração DIZ quantas NFC-e saíram sem
  C170, quantos itens ficaram fora do 0200 e que a receita continua declarada —
  senão quem conferir o arquivo vê o item do cupom sumido e procura buraco de
  captura.

- **🚨 "UMA ESTÁ COM 4 BARRINHAS E A OUTRA COM 3" — O 0500 DO
  EFD-CONTRIBUIÇÕES NÃO É O DO EFD ICMS/IPI** (24/08, CF BANK, o Paulo
  comparando A OLHO o nosso arquivo com o assinado da própria empresa). O
  registro saía com **9 campos onde o leiaute tem 8**: eu copiei o 0500 do EFD
  **ICMS/IPI**, que carrega um `COD_CCUS` a mais no fim; o do
  EFD-**Contribuições** termina no `NOME_CTA_REF`. É a **MESMA classe do 1010
  de 17/08** — mesmo NÚMERO de registro, arquivo diferente, leiaute diferente,
  e a família inteira (`C100`/`C170` com 24 e 23 campos em 20/08, `M210`/`M610`
  com 8 em 18/08) já tinha custado três recibos.
  🔴 **E A TRAVA DE CONTAGEM EXISTIA DESDE 18/08 — ELA FICOU MUDA.**
  `conferirContagemDeCampos` roda em todo arquivo gerado, mas só acusa o
  registro que está em `CAMPOS_POR_REGISTRO` — e o 0500 (e o F100, que é quem
  APONTA para ele) nunca tinham entrado. **Trava de contagem só protege o
  registro que está NELA**, e o silêncio dela sai NOMEADO em `naoConferidos`
  justamente para não ser lido como aprovação. Os dois entraram agora, com a
  fonte: o assinado do CF BANK (06/2026) e o da PEC (05/2026).
  📌 **REGRA QUE FICA: registro NOVO entra em `CAMPOS_POR_REGISTRO` no MESMO PR
  em que o gerador passa a emiti-lo** — é a irmã do `DETALHES_VIGIADOS` (06/08)
  e da whitelist do #382. Sem isso, o registro nasce fora da única conferência
  que pega erro de FORMA antes do PVA.
  🐛 **E A MINHA PRIMEIRA CONTAGEM ENTROU ERRADA NA TABELA — pega pelo teste,
  não pelo PVA**: escrevi `campos: 8` e `18`, contando à mão os campos DEPOIS do
  REG. A tabela conta **incluindo o REG** (é como o PVA conta: *"Esperado 16"*
  para um M210 que tem 15 campos adiante), então os números certos são **9** e
  **19** — e a trava, com o número errado, acusaria justamente a linha
  CORRIGIDA. **Contagem de campo se lê da FUNÇÃO, nunca do meu dedo**: um
  `camposDaLinha` sobre a linha real responde em um segundo o que eu errei duas
  vezes olhando.
  📌 **E O ACHADO É DELE, não da minha varredura.** O nosso arquivo e o assinado
  estavam lado a lado na tela e ele contou as barras. **Comparar com o assinado
  da MESMA empresa acha mais do que a recusa pede** (a recusa do PVA falava do
  COD_CTA, não da contagem) — é a mesma lição das quatro particularidades do CF
  BANK, agora provada por um olho humano num detalhe de um caractere.
  ✅ **FECHADO EM PRODUÇÃO NO MESMO DIA** (Paulo: *"1109 - CF BANK - EFD S/
  RENDIMENTOS FINANCEIROS"*) — ver o mata-burro seguinte para o que o recibo
  prova.

- **🚨 A TERCEIRA FONTE DE RECEITA SEM DOCUMENTO: APLICAÇÃO FINANCEIRA — e o
  arquivo saía declarando ZERO** (24/08, CF BANK 1109 · instituição de
  pagamento, Paulo: *"o EFD dela é pela APLICAÇÃO FINANCEIRA … e o código da
  receita dela de PIS/COFINS é diferente também"*). O arquivo de 07/2026 saiu
  com `F001|1` e **M200/M600 ZERADOS** numa empresa cuja receita inteira é
  rendimento financeiro — a MESMA classe do M200 zerado da MANTOAN e da
  AFFITTARE: o app monta o arquivo a partir dos DOCUMENTOS, e aqui não há
  nenhum.
  ✅ **FECHADO EM PRODUÇÃO NO MESMO DIA** (Paulo: *"1109 - CF BANK - EFD S/
  RENDIMENTOS FINANCEIROS"*). É a **QUINTA empresa** com o EFD-Contribuições
  fechado por recibo e a **QUARTA FORMA de arquivo provada**: detalhado só com
  documento (MANTOAN, HS), consolidado só com F550 (AFFITTARE), detalhado com
  documento + F100 (PEC) e agora **SEM DOCUMENTO NENHUM, com F100 de receita
  financeira**. As quatro saem do MESMO gerador — o que muda é a régua que
  decide o perfil, nunca um caminho paralelo por cliente.
  📌 **E ISSO FECHA A CLASSE DA "RECEITA SEM DOCUMENTO" com três fontes
  provadas por recibo**: locação (AFFITTARE/PEC) e aplicação financeira (CF
  BANK). A quarta que aparecer entra pelo mesmo desenho — dono próprio, valores
  e não linhas, e o gabarito é o assinado da PRÓPRIA empresa.
  ✅ **O GABARITO É O EFD ASSINADO DA PRÓPRIA EMPRESA (06/2026)**, que fixa as
  quatro particularidades campo a campo: `|F100|1|||30062026|21647,53|02|…|4|
  865,9|…|`, `|M205|08|457401|`, `|M605|08|798701|`, `|M210|02|…|`.
  📌 **E AS ALÍQUOTAS NÃO ERAM NOVIDADE — O APP JÁ AS TINHA.**
  `ALIQ_PIS_APLICACAO = 0,65%` e `ALIQ_COFINS_APLICACAO = 4%` viviam no
  `lucroService`, que calcula a **GUIA**; o SPED é que não as lia. Ou seja: a
  guia e o arquivo declarariam números diferentes sobre o MESMO rendimento —
  o defeito que esta casa mais paga. O dono passou para o backend e a ficha
  IMPORTA dele. Conferem centavo a centavo com o assinado (21.647,53 × 0,65% =
  140,71 · × 4% = 865,90).
  ⚠️ **O CÓDIGO DE RECEITA `4574`/`7987` (NUM_CAMPO 08) É DESTA APURAÇÃO, NÃO
  DO NÃO-CUMULATIVO COMUM.** Ele veio do arquivo assinado, como o `810902`/
  `217201` da PWR — e reaproveitá-lo para toda empresa do Lucro Real declararia
  o débito na receita ERRADA da DCTF. O aviso do não-cumulativo sem código
  provado continua de pé.
  🔴 **E A COMPARAÇÃO COM O ASSINADO ACHOU MAIS DOIS DEFEITOS que ninguém tinha
  pedido**: (1) o **`IND_APRO_CRED` do 0110 saía CRAVADO em `2`** (rateio
  proporcional) para TODA empresa do não-cumulativo — ele declara COMO a
  empresa apropria o crédito, que é fato dela; o assinado traz **1**
  (apropriação direta). É a família do `IND_PERFIL` (19/08): campo que a pessoa
  escolhe e o gerador ignorava. Virou cadastro, com whitelist e modal no MESMO
  PR. (2) o **`VL_TOT_CONT_NC_DEV` (campo 4 do M200/M600) saía `0` cravado** —
  o registro se desmentia, dizendo que NADA era devido no não-cumulativo com o
  campo 7 (a recolher) cheio.
  🔴 **2ª RODADA DO PVA — o F100 apontava para uma conta que o arquivo NÃO
  DECLARAVA**: *"Código da conta analítica/grupo de contas inválido. Informar
  código no 'Registro 0500' antes de utilizá-lo."* É a MESMA família do
  participante do 0150 e do item do 0200 ÓRFÃOS — o registro referencia um
  cadastro que o arquivo não traz. O assinado tem a linha:
  `|0500|01012026|04|A|5|30106030012|RENDIMENTOS FINANCEIROS|||`.
  ✅ **AS TRÊS RODADAS FECHARAM NO MESMO DIA** — receita zerada, conta órfã e a
  contagem do 0500. **O que fez a diferença foi o assinado da própria empresa
  na mão desde a primeira rodada**: cada recusa do PVA foi respondida com a
  linha correspondente dele, nunca com dedução de leiaute.
  ✅ **O que a régua DERIVA, e por quê**: `COD_NAT_CC 04` (contas de RESULTADO
  — receita sempre é), `IND_CTA A` (ANALÍTICA, que é exatamente o que a recusa
  cobra) e `DT_ALT` = 1º de janeiro do ano, como o assinado.
  🚨 **E A COERÊNCIA É TUDO OU NADA**: `NOME_CTA` e `NIVEL` são do PLANO DE
  CONTAS da empresa e o app não os deduz — **sem eles o COD_CTA também NÃO sai
  no F100**. Emitir a referência sem a declaração é justamente a recusa; e o
  arquivo da PEC foi ACEITO com F100 sem COD_CTA, então a ausência não impede a
  entrega. A falta vira aviso com o lugar de preencher.
  📌 **REGRA QUE FICA: comparar o nosso arquivo com o assinado da MESMA empresa
  acha mais do que a recusa pede.** A recusa não existia aqui — o arquivo
  simplesmente declarava zero —, e foi a comparação linha a linha que entregou
  as quatro particularidades e os dois defeitos de brinde.

- **🚨 "A RECEITA CONTINUA ERRADA" — e a régua estava CERTA: o que faltava era
  o app DIZER o número** (24/08, PWR, Paulo com o M210 do PVA mostrando
  `VL_REC_BRT 38.316,84`: *"tem que tirar o desconto — e olha que só tem 1
  nota, tem empresa que tem MUITOS descontos"*).
  ✅ **INSTRUMENTEI ANTES DE CONCLUIR, e foi isso que respondeu.** Rodei o
  gerador com os números reais da NF 7 dele (`vProd 18.741,24 · desconto
  562,24 · ICMS 3.272,22`) e ele devolveu a linha **provada em 20/08**:
  `|M210|51|37754,60|30958,77|…`. Nas TRÊS formas de desconto (só no item, só
  no total do documento, nos dois) a receita sai 18.179,00 e nunca desconta
  duas vezes. Ou seja: o arquivo que ele validou é ANTERIOR à correção.
  📌 **REGRA QUE FICA: quando o dono reporta número errado, RODE a régua com os
  números dele antes de procurar defeito.** Em 14/08 eu deduzi a causa de um
  print e gastei dois deploys corrigindo o que não estava quebrado; aqui a
  mesma pergunta se respondeu em uma execução. **Print prova o ARQUIVO, não o
  código — e arquivo tem data.**
  ✂️ **O QUE FALTAVA DE VERDADE ERA O NÚMERO NA TELA.** A régua descontava em
  silêncio, então *"a receita está errada"* só se respondia com alguém lendo o
  código. A geração passou a DIZER: *"bruta 38.316,84 − desconto 562,24 =
  VL_REC_BRT 37.754,60 (1 documento(s) com desconto) — confira contra o C100 do
  PVA"*. É o desenho do aviso do Tema 69, que já fazia isso com o ICMS.
  ⚠️ **E o aviso NÃO nasce em empresa sem desconto**: alarme sobre arquivo
  correto é o que ensina a equipe a ignorar os avisos que importam.
  📌 **A contagem de documentos vai junto de propósito** — é a resposta ao
  *"tem empresa que tem MUITOS descontos"*: um número só não diz se o desconto
  apareceu em uma nota ou em cem.

- **🚨 "ALUGUEL ⇒ ARQUIVO CONSOLIDADO" ERA PREMISSA DA AFFITTARE — e quebrou
  na PRIMEIRA empresa que tem os DOIS** (24/08, PEC PRONTA ENTREGA 1350 ·
  07/2026: serviços prestados **e** aluguel). O PVA recusou **6 registros** —
  1× A010 e 5× A100 — com *"O registro não deve ser informado para esse perfil
  e/ou tipo de operação"*.
  ✅ **FECHADO EM PRODUÇÃO NO MESMO DIA** (Paulo: *"1350 - PEC ok"*). É a
  **QUARTA empresa** com o EFD-Contribuições fechado e a **TERCEIRA FORMA de
  arquivo provada por recibo**: detalhado só com documento (MANTOAN, HS),
  consolidado só com F550 (AFFITTARE) e agora **detalhado com documento +
  F100** (PEC). As três saíram do MESMO gerador.
  🔴 A causa: `indRegCumDoArquivo` devolvia **2 (CONSOLIDADO)** sempre que
  havia receita de locação. **Consolidado é o arquivo que NÃO escritura
  documento** — e a PEC tem cinco. O app declarou um perfil e entregou o
  contrário dele.
  ✅ **O GABARITO É O EFD ASSINADO DA PRÓPRIA PEC (05/2026)**, que faz o certo:
  `|0110|2||1|9|` (**DETALHADO**), os cinco A100 de pé, e o aluguel no
  **`F100`** — `|F100|1|||01052026|188836,42|01|188836,42|0,65|1227,44|01|
  188836,42|3|5665,09||||||`. E o bloco 1 dele sai `|1001|1|`, **sem 1900**.
  📌 **F550 e F100 DECLARAM A MESMA RECEITA — a diferença é de PERFIL, não de
  valor.** F550 só existe no consolidado; F100 é o registro de "demais
  operações" do detalhado, e CONVIVE com o bloco A. A régua passou a ser: há
  documento de receita ⇒ detalhado + F100; não há ⇒ consolidado + F550.
  📌 **E O 1900 É CONSEQUÊNCIA DO F550, NÃO DO ALUGUEL.** A recusa de 24/08
  fala de *"F550 e F560"*; no detalhado não há F550, então não há obrigação —
  e o assinado da PEC comprova, com aluguel e sem 1900. Emitir ali seria
  inventar obrigação que a recusa não criou.
  🚨 **A PREVALIDAÇÃO DISPAROU E O APP GEROU ASSIM MESMO.** A trava de 21/08
  previu as SEIS recusas antes do PVA (`avisosDePerfilConsolidado` acusa A010,
  A100 e A170). **O defeito não era o aviso: era a DECISÃO.** Aviso não
  conserta arquivo — quando o app tem como saber a resposta certa, avisar não
  é entrega, é passar o problema adiante.
  📌 **E A TRAVA LITERAL MORDEU PELA QUINTA VEZ**
  (`receitaSemDocumentoF550.test.ts`): ela prendia no TEXTO
  `receitaSemDocumento > 0 && regimeApuracao === '2'` — e esse texto ERA o
  defeito. Trocada pela INTENÇÃO (a exclusão vale no consolidado, e o
  consolidado é DERIVADO da contagem de documentos), mais a proibição de
  voltar a assumir "tem aluguel ⇒ consolidado".
  ⚠️ **E a exclusão de ENTRADAS passou a valer SÓ no consolidado**: no
  detalhado, tirar a entrada seria apagar escrituração legítima. Antes ela
  dependia de `regimeApuracao === '2'` — que é o **COD_INC_TRIB** (cumulativo),
  não o IND_REG_CUM. **Dois campos diferentes com o mesmo número 2**, lado a
  lado no mesmo arquivo.

- **🚨 HAVENDO F550, O 1900 É OBRIGATÓRIO — e o bloco 1 saía SEMPRE VAZIO**
  (24/08, AFFITTARE 1139 · 07/2026, urgente).
  ✅ **FECHADO EM PRODUÇÃO NO MESMO DIA** (Paulo: *"1139 - AFFITARE - EFD
  ALUGUEL F550 /1900 - MATAMOSSSSSSSSSS"*). É a **PRIMEIRA empresa a fechar o
  EFD-Contribuições pelo caminho CONSOLIDADO** (`IND_REG_CUM 2`) — MANTOAN e HS
  fecharam pelo DETALHADO. Ou seja: o trilho da **receita sem documento** está
  provado ponta a ponta, da ficha ao recibo.
  Recusa do PVA, literal: *"Se o somatório do campo Valor Total da Receita
  Auferida do registro F550 e F560 for maior que zero o registro 1900 deve ser
  preenchido."*
  🔴 **É uma CONSEQUÊNCIA do F550 que ninguém previu.** O `buildBloco1_Contrib`
  devolvia `|1001|1|` (bloco SEM DADOS) em TODO arquivo — ele ficou vazio
  quando o 1010 de ação judicial foi removido (17/08, MANTOAN) e nunca ganhou
  conteúdo. Enquanto a receita vinha de documento isso não aparecia; com o F550
  no ar desde 21/08, o bloco 1 vazio virou recusa: **o arquivo declara receita
  e não a consolida**.
  📌 **REGRA QUE FICA: registro novo pode tornar OBRIGATÓRIO um bloco que
  sempre saiu vazio.** O F550 foi provado sozinho, e o que faltava não estava
  nele — estava num bloco que ninguém olhava porque nunca tinha tido conteúdo.
  ✂️ `montar1900` nasce no dono da receita sem documento
  (`receita-sem-documento-f550.js`) e devolve VALORES, não a linha pronta —
  igual ao `montarF550`; formatar ali criaria uma segunda forma do número.
  ✅ **O QUE A RÉGUA DERIVA, com o motivo**: `CNPJ` (o do F010, já no arquivo),
  `VL_TOT_REC` (a Σ do F550/F560 — é a PRÓPRIA recusa do PVA que define essa
  igualdade) e `CST_PIS`/`CST_COFINS` (os MESMOS do F550 — lê-los de outro
  lugar faria o 1900 e o F550 discordarem dentro do mesmo arquivo).
  🚨 **O QUE ELA RECUSA**: `COD_MOD` (Tabela 4.1.1) e `COD_SIT` (Tabela 4.1.2)
  são código de TABELA OFICIAL e dependem de **QUAL documento a empresa emite
  pelo aluguel** — o app não sabe e isso não se deduz do valor. Sem cadastro o
  registro **NÃO SAI** e a falta vira aviso NOMEADO com a recusa literal e o
  lugar de preencher: é o desenho do `0002`, do código 9 do ISS fixo e do
  `IND_NAT_PJ`. Carimbá-los de memória é a família do `1405`, do `5352` e do
  `PARTSEM` — código inventado que o PVA às vezes ACEITA, e aí o erro só
  aparece na fiscalização.
  ⚠️ **`QUANT_DOC` sai VAZIO de propósito**: é opcional, e nós não temos os
  documentos (é justamente por isso que a receita vem da ficha). O arquivo do
  e-Fiscal declarava **3** porque ELE os tinha; escrever um número aqui seria
  afirmar uma contagem que ninguém fez.
  📌 **Campo entrou na whitelist E no modal no MESMO PR** (regra do #382) — e
  desta vez isso é o que faz o aviso apontar um lugar que EXISTE, que é a
  lição do dia anterior. A recusa virou regra da **prevalidação** no mesmo PR,
  lendo as LINHAS do arquivo gerado, com o arquivo REAL da AFFITTARE no teste.
  📌 **E O DESENHO "O APP NÃO ESCOLHE O CÓDIGO" FOI CONFIRMADO PELO RECIBO.**
  Eu me recusei a chutar `COD_MOD`/`COD_SIT` e mandei o Paulo lê-los na fonte;
  ele preencheu no cadastro e o PVA aceitou **na primeira rodada**. É a quinta
  vez que a mesma disciplina fecha um caso (código 9 do ISS fixo, M205/M605,
  `indAquis`, `0002`, agora o 1900): **código de tabela oficial vem da FONTE ou
  do CADASTRO, nunca da minha memória** — e recusar-se a preencher não atrasou
  a entrega, resolveu no mesmo dia.
  ⚠️ **O QUE ESTE CASO NÃO PROVA**: quais são os códigos certos para OUTRA
  locadora. Eles descrevem **qual documento aquela empresa emite** pelo
  aluguel — por isso moram no cadastro, por empresa, e não viram constante no
  código. Generalizar o par da AFFITTARE seria o `1405` com outra roupa.
  ⚠️ **E o gerador foi provado ANTES do PVA, rodando de verdade**: a simulação
  ponta a ponta reproduziu o arquivo recusado byte a byte (59 linhas, `9999|59`)
  e, com os códigos, produziu `1990|3`, `9900|1900|1`, `9990|34` e `9999|61`
  — as três aritméticas do bloco 9 fechando. **Acrescentar UMA linha ao bloco 1
  mexe em QUATRO contadores**; conferir só a linha nova teria deixado a próxima
  recusa esperando.

- **🚨 O PAINEL AFIRMAVA "✓ CAPTURA OK" A PARTIR DE UM CAMPO DE CADASTRO — nas
  MESMAS 202 empresas** (23/08, achado ao conferir se a porta que eu tinha
  acabado de apontar abria). O 📋 Status de Captura por Empresa decidia com
  `temA3Proprio = tipoCert === 'A3' && certUploaded`, e isso entrava no
  `capturaNfeOk` que imprime **✓ Captura OK**. Ou seja: alguém marcou A3 no
  cadastro e subiu o arquivo ⇒ a tela AFIRMA que a captura está boa — **nada
  ali olhava se o agente `cfi-a3` alguma vez entregou um documento**.
  🔴 **É a PRIMEIRA regra permanente deste projeto invertida** (*"validação por
  RESULTADO, não por status"*), na família do trilho NFS-e SP que ficou semanas
  verde com 0 sucessos e 121 falhas.
  🐛 **E a segunda metade do custo era MINHA, do PR anterior**: horas antes eu
  passei a mandar essas 202 para *"confira se o agente cfi-a3 rodou (Status por
  Empresa)"* — e a tela apontada respondia **✓ Captura OK** para todas. Aviso
  que aponta lugar que não responde é o achado 18 de 21/08 outra vez, agora com
  o agravante de eu ter criado o ponteiro sem abrir a porta. **Conferir se a
  porta abre faz parte de escrever o aviso.** (O emoji também estava errado —
  a aba é 📋, não 📊; corrigido nos quatro lugares.)
  ✂️ `captura-a3-cobertura.js` é o dono da pergunta *"o agente ENTREGOU?"*, que
  é OUTRA pergunta de `temA3Proprio` (*"existe caminho de captura?"* — essa
  continua sim, e segue mandando no `capturaNfeOk` e na lista de bloqueios).
  Duas perguntas, dois donos. A tela passou a dizer *"Capturada pelo agente
  local cfi-a3 · última entrega em dd/mm/aaaa"*, e o cabeçalho ganhou
  `a3SemEntrega` — o número que o verde escondia.
  ⚠️ **ÂMBAR, NÃO VERMELHO, e o motivo é régua da casa**: o agente só grava
  `sefaz_state.ultimaSync` **quando trouxe NSU**, então a ausência prova que
  *documento nenhum chegou por ele* — **não** prova que ele não rodou (rodada
  sem movimento não deixa rastro). Vermelho afirmaria o que o app não mediu; a
  frase diz exatamente essa diferença. O que não pode é continuar VERDE.
  ⚠️ **E NENHUM SLA INVENTADO**: o app não conhece a agenda do agente, então
  "entregou há 180 dias" devolve o FATO com a data, nunca um veredito de
  "parado". Cravar janela aqui seria inventar prazo — o mesmo que a casa se
  recusa a fazer com vencimento, município e código de tabela.
  📌 **A FONTE DA SYNC É QUE DECIDE, não a data**: `ultimaSyncFonte` entrou no
  `stateMap` no mesmo PR — sem ela, uma sync antiga do CRON EM NUVEM passaria
  por entrega do agente local. É a armadilha das duas formas entre dois
  **ESCRITORES** do mesmo campo. Provada removendo a checagem de propósito.
  🚨 **E CORRIGIR SÓ A FRASE TERIA CRIADO O DEFEITO QUE A CASA MAIS PAGA.**
  `capturaNfeOk` responde *"existe CAMINHO?"* — e para a A3 existe —, então o
  **pill NFe**, o **KPI "Captura NFe OK"**, o filtro **"tudo OK"** e o **CSV**
  continuavam dizendo verde/sim ao lado da linha que dizia *"⚠ nunca
  entregou"*: **duas leituras do mesmo fato na mesma tela**. Os quatro
  passaram a concordar — o pill ganhou TERCEIRO estado (âmbar, e o alerta
  VENCE o ok), o "tudo OK" exclui quem nunca recebeu entrega (o filtro existe
  para a pessoa PARAR de olhar), o KPI mostra o número com clique para a lista
  e o CSV leva a coluna (exportar não pode perder a ressalva).
  📌 **REGRA QUE FICA: quando um booleano muda de significado, os LEITORES
  dele entram no mesmo PR** — meia correção não deixa o defeito pela metade,
  ela troca um erro por uma CONTRADIÇÃO, e quem lê escolhe a metade que
  preferir. É a irmã da régua dos leitores do `cfopEscriturado` (18/08).

- **🚨 METADE DA CARTEIRA CAPTURA POR A3 — e as duas telas do colaborador
  mandavam as 202 "destravar a captura"** (23/08, do painel de captura que o
  Paulo mandou: **202 das 404** empresas monitoradas estão bloqueadas por
  certificado **A3**, que NÃO roda no cron em nuvem — quem as captura é o
  **agente local `cfi-a3`**; as outras 42 são A1 faltando ou inválido).
  🔴 Para essas 202, "zero documento" não aponta captura quebrada: aponta o
  AGENTE que não rodou naquela competência. E as duas telas que decidem se
  alguém pode parar de olhar o mês mandavam procurar defeito onde não há — a
  **Rotina do Mês** (*"pode ser certificado, procuração ou município sem
  trilho"*) e o **farol de lastro** (*"destrave a captura"*, o caso EXPERTE de
  15/08, que é justamente uma empresa A3). **Meia carteira recebendo alarme com
  ação errada é o jeito conhecido de ensinar a equipe a ignorar o farol.**
  ⚠️ **E A SEVERIDADE NÃO CAI, de propósito**: o agente A3 escreve na MESMA
  coleção, então documento nenhum ali continua sendo lacuna de verdade — não é
  desenho. Baixar para âmbar (ou calar) trocaria um alarme com ação errada por
  um **SILÊNCIO FALSO**, e a Rotina voltaria a dar a competência por fechada
  sem lastro. É a régua do cruzamento CFI × SPED (22/08): **trocar alarme falso
  por silêncio falso não é correção.** O teste exige `cor` e `status`
  IDÊNTICOS aos do caso comum, e a trava foi provada estreitando a condição de
  volta — ela acusa exatamente a linha que silenciaria as 202.
  📌 **O tipo do certificado vira PROJEÇÃO, não consulta por empresa**: as duas
  rotas leem `empresas_certificados` **uma vez** com `.select('tipoCert')` e
  passam `capturaPorAgenteLocal` para o núcleo — falha na leitura devolve o
  comportamento antigo (nunca derruba o painel da carteira inteira por um
  cadastro torto).
  📌 **REGRA QUE FICA: causa junto do número vale para o BLOQUEIO também.** O
  farol já dizia *"há valor sem documento"*, que é verdade; o que faltava era
  **por qual porta** aquele documento entraria. Alarme certo com primeira
  parada errada custa o dia do colaborador e o crédito do farol.

- **🚨 A VARREDURA DE "CAMPO QUE O GERADOR LÊ E NINGUÉM PODE PREENCHER" EXISTIA
  COMO SCRIPT E NUNCA FOI LIGADA — e o oitavo campo já estava esperando**
  (22/08). O eixo nasceu em 17/08 com o `IND_NAT_PJ` e o cruzamento virou
  script naquele dia, achando mais três — mas **o script não ficou no repo**. O
  que sobrou foi um teste citando o `indNatPJ` **pelo NOME**: a "trava escrita
  como LISTA" (13/08), que cobre o campo que alguém lembrou.
  🔴 **O oitavo é o `gerarInventario`, lido pelo BLOCO H.** Sem ele na
  whitelist nem no modal, `inventarioExigido` virava na prática *"só em
  dezembro"* — e a empresa que precisa apresentar o inventário em outro mês
  (mudança de regime, encerramento, exigência estadual) **não tinha como fazer
  o bloco sair**. ⚠️ E **a ausência de um bloco é silenciosa**: o PVA só reclama
  do que ESTÁ no arquivo.
  ✂️ Campo entrou na whitelist **e** no modal no MESMO PR (regra do #382), e a
  varredura virou TESTE. ⚠️ Ela não muda o que o app se recusa a fazer: o bloco
  continua saindo **vazio com aviso** enquanto ninguém informar a contagem —
  quantidade de inventário não se estima (o Bloco H zerado de 06/08).
  ⚠️ **A assinatura recusa o `)` entre o objeto e o campo, de propósito**:
  `resolverNaturezaAtividade(empresa?.dadosFiscais || {}).natureza` lê o
  RESULTADO da função, não um campo do cadastro — a versão larga acusava
  `natureza` como órfã, que é alarme sobre código certo.
  ✅ As sete exceções são carimbo do backend ou fallback de campo cuja casa real
  é outra, **cada uma com o motivo escrito**. Provada removendo o
  `gerarInventario` da whitelist de propósito.

- **🚨 NO DARF, A COMPETÊNCIA ILEGÍVEL VIRAVA VENCIMENTO = HOJE — e só a ORDEM
  de duas chamadas segurava o defeito** (22/08, terceira parada da varredura de
  competência). `parseCompetencia`, no construtor do payload, casava só
  `AAAA-MM`; as outras formas que o app usa DE VERDADE — `202607` (colagem de
  arquivo), `07/2026` (catálogo e tarefas) e `AAAA-MM-DD` (a ficha grava as
  duas) — caíam no `null`, e daí `calcularVencimentoDarf` devolvia
  **`new Date()`**: guia vencendo no dia da emissão, sobre débito de outro
  período.
  ⚠️ **Hoje isso não sai errado por SORTE**: `periodoApuracaoSicalc`, duas
  linhas adiante, LANÇA antes de alguém usar o vencimento. Ou seja, o arquivo
  depende de a segunda chamada vir depois da primeira — trocar duas linhas de
  lugar tornaria isso um defeito VIVO e SILENCIOSO, porque ninguém confere data
  de vencimento a olho. **Defeito que só não acontece pela ordem das linhas é
  defeito, não é margem.**
  ✂️ O parse passou a usar o dono das quatro formas (as legítimas param de ser
  recusadas com mensagem de formato) e a ausência devolve **null** — campo de
  data não recebe default, a régua de 06/08. Quem monta a guia RECUSA com o
  motivo.
  ✅ **E O DARE-SP JÁ ESTAVA CERTO NO QUE IMPORTA** — ele conhecia duas das
  quatro formas, mas o ilegível SEMPRE devolveu **null** e a emissão recusa com
  a frase. É o desenho que as outras guias deviam ter tido desde o começo, e
  fica declarado no teste para não ser "uniformizado" para pior. Ganhou só as
  duas formas que faltavam.
  📌 **A conta da varredura de competência**: as guias e os dois SPED passaram
  pelo MESMO dono. O que se aprendeu é que a competência circula em quatro
  formas legítimas e **cada porta conhecia um subconjunto diferente** — não é
  descuido de um lugar, é a régua morando em cinco cabeças.

- **🚨 A COMPETÊNCIA ENTRAVA NA GERAÇÃO SEM CONFERÊNCIA DE FORMA — e o arquivo
  saía VAZIO dizendo que a empresa não teve movimento** (22/08). As portas do
  **EFD-Contribuições** e do **EFD ICMS/IPI** só perguntavam se a competência
  EXISTIA (`if (!competencia) …`). Chegando `07/2026` ou `202607`, o
  `where('competencia','==',…)` de `documentos_fiscais` — que grava sempre
  `AAAA-MM` — devolvia **ZERO documentos**; o orquestrador empilhava o aviso
  *"não tem documentos fiscais no período; arquivo será gerado com estrutura
  mínima"* e **o arquivo saía mesmo assim**, declarando nada à Receita.
  🔴 **É a ausência PLAUSÍVEL no lugar mais caro**: empresa sem movimento é caso
  legítimo, então aquele aviso não parece defeito — parece a verdade. Mesma
  família do caso HYPE (17/08), em que a consulta por igualdade de competência
  achou ZERO envios e liberou a MESMA cobrança.
  ⚠️ **A régua NORMALIZA em vez de recusar as outras formas** — `07/2026` e
  `202607` dizem a mesma competência, e é para isso que o dono existe
  (`competenciaParaGerarArquivo`, em `competencia.js`). O que **RECUSA** é o
  ILEGÍVEL, com a consequência na frase: competência chutada é arquivo entregue
  no mês errado.
  📌 **E entrou nas DUAS famílias no MESMO PR** — meia trava protege o cliente
  que já quebrou e deixa o próximo descoberto, agora do lado da PORTA. No EFD
  ICMS/IPI os **três** campos de período passam (o trimestral usa
  início+fim), e o **range compara STRING**, então forma diferente não filtra
  "quase certo": não casa com nada.
  ⚠️ E o **nome do arquivo** saía da forma CRUA da requisição — um `07/2026`
  viraria nome de arquivo com barra.
  🐛 A trava de nomes do backend (20/08) pegou um import que faltou nesta mesma
  correção, antes de subir.
  🔴 **E A MESMA VARREDURA ACHOU O CASO QUE VALE DINHEIRO: o DAS.** Lá a
  competência crua decide DUAS coisas que não voltam atrás — o **período que vai
  ao PGDAS-D** (o provider faz `Number(comp.replace(/\D/g,'').slice(0,6))`, e
  `07/2026` vira **72026**, período que não existe) e a **IDENTIDADE do DAS**
  (`docId = cnpj_competencia_regular`, com não-alfanuméricos virando `_`):
  `2026-07` e `07/2026` dão ids DIFERENTES para o MESMO mês, então a
  idempotência que impede a segunda emissão **não vê a primeira** — duas guias
  do mesmo DAS. Regular e avulso passaram a normalizar pelo dono, e a recusa diz
  as DUAS consequências (só *"competência inválida"* manda procurar erro de
  digitação num problema que termina em declaração no período errado).

- **📌 TESTE CRUZADO PROVA OS DOIS QUE VOCÊ CONHECE; SÓ A VARREDURA IMPEDE O
  TERCEIRO** (22/08, fechando a classe da DATA). Pela manhã o gerador do SPED e
  o do `.FML` foram corrigidos e travados por um teste que alimenta os DOIS com
  as mesmas entradas e exige o **mesmo dia**. Isso prova o que existe — e não vê
  quem nasce depois. A varredura achou o **terceiro**: o relatório de análise de
  XMLs do SAGE lia `new Date(dhEmi).toLocaleDateString('pt-BR')`, ou seja *"que
  dia era no fuso de QUEM ABRIU A TELA"* — e é justamente ele que o colaborador
  compara com o arquivo. E achou o **quarto**, na lista de XMLs por
  entrada/saída.
  ✂️ `dataDeclaradaDoDocumento` nasce no `xml-metadata-helper` (a casa das
  leituras de documento, ao lado de `valorDoDocumento` e `issDoDocumento`) e
  devolve **'AAAA-MM-DD'**; cada lugar só **TRADUZ** para a forma dele —
  `DDMMAAAA` no SPED, `AAAAMMDD` no `.FML`, `dd/mm/aaaa` na tela. **O que não
  pode ter duas respostas é o DIA, não o formato.**
  ⚠️ **E ISSO REVISA UMA DECISÃO DO MESMO DIA, com o motivo**: de manhã ficou
  escrito *"os dois formatadores moram em mundos diferentes; criar um módulo só
  para partilhar cinco linhas traria de volta a armadilha do `.d.ts` à mão"*. O
  obstáculo era o MÓDULO NOVO — ele some ao pôr a régua onde o `.d.ts` **já
  existe**: o backend importa o `.js`, o front importa pelo tipo. O teste
  cruzado continua de pé e agora passa por construção.
  ⚠️ A assinatura da varredura é ESTREITA de propósito: só `new Date(<campo de
  data de documento>)` seguido de leitura de DIA/MÊS. **Cálculo de IDADE
  (`getTime()`) não casa** — ele é outra pergunta e independe de fuso; acusá-lo
  seria alarme sobre código certo. Provada revertendo o relatório do SAGE.

- **🐛 A TRAVA DA PROJEÇÃO TINHA UMA JANELA CURTA — e EMUDECIA na consulta mais
  importante** (22/08, pego ao ligar a régua do ISS). `projecaoNaoCegaARegua`
  captura o `.select(` por regex com teto de **900 caracteres**, e o da **Rotina
  do Mês** passa disso (ela pede ~25 campos). Resultado: aquela projeção caía
  FORA da captura — a varredura não a acusava **nem a conferia**, e quem lesse o
  teste verde concluiria que estava coberta.
  📌 **REGRA QUE FICA: trava que não grita quando devia é pior que trava
  nenhuma — ela dá sensação de cobertura.** É a MESMA lição do
  `dtsNaoPrometeFantasma`, que nasceu fraco e passava batido justo no caso que
  ele existia para pegar. Janela para 3000; os comentários já eram removidos
  antes, então ela não traz prosa junto.
  ✂️ E a régua do ISS entrou na varredura (`CAMPOS_PARA_ISS_DO_DOCUMENTO`): as
  DUAS consultas que decidem o ISS da carteira — a aba 🏛️ ISS SP e a **Rotina do
  Mês** — traziam três das quatro formas e **faltava justamente `totais.vISSRetido`**,
  a forma do ABRASF, que é a do RETIDO.

- **🚨 A CAPTURA DO ADN GRAVAVA UMA NOTA QUE NENHUM LEITOR DO APP ENXERGARIA**
  (22/08 — e ⚠️ **CORRIGIDO EM 23/08: o dano em produção é ZERO**). O painel de
  captura do Paulo mostra **`Docs (histórico total): 0 — ADN sem movimento`**:
  o trilho está LIGADO (38 empresas elegíveis, 38 sucessos) e **nunca capturou
  um documento**, porque o provedor não tem nada disponível (maxNSU alcançado)
  e 272 dos 394 municípios da carteira usam sistema próprio. Ou seja: o defeito
  do ESCRITOR era real no código e **não produziu nota torta nenhuma**.
  📌 **A correção continua valendo como PREVENÇÃO** — o dia em que os
  municípios migrarem, a nota entra completa. O que NÃO vale é ler a frase
  original como defeito vivo: eu escrevi *"a nota EXISTIA e não aparecia"* sem
  ter o número, e o número é zero. **Impacto se mede no painel, não se deduz do
  código.**
  🗑️ **E o backfill do acervo do ADN SAIU da lista** — não há acervo. Também
  sai do caminho crítico a pendência do código de cancelamento do leiaute
  nacional: ela só volta a importar quando houver documento.
  O trilho escreve em `documentos_fiscais` — a
  MESMA coleção de tudo — e gravava só o que o parser dele extraiu:
  `tipo: 'nfseNacional'`, `prestadorCnpj`, `tomadorCnpj`, `valorServico`,
  `valorIss`. **Sem `direcao`, sem `competencia`, sem `status`, sem
  `valorTotal` e sem os blocos de participante.**
  🔴 **A nota EXISTIA e não aparecia em lugar nenhum**: sem `direcao` some do
  filtro Entradas/Saídas, do Livro, do Resumo por CFOP, da aba de Serviços e do
  bloco A do EFD-Contribuições; sem `competencia` fica fora de **TODA** consulta
  por competência, que é como o app recorta o mês; e o `detectTipo` da lista não
  conhece aquele rótulo, então caía no default `'NFe'` — a NFS-e aparecia como
  nota de **MERCADORIA**, com valor 0,00.
  📌 **É o eixo INVERSO do que a casa vinha varrendo**: eu estava corrigindo
  LEITORES que perguntavam por uma forma só; aqui o defeito é do **ESCRITOR**,
  que não grava as formas que os donos lêem. **Trilho de captura novo nasce
  gravando os campos que os DONOS pedem** — direção, competência, rótulo, valor
  e participante —, senão a nota entra e some.
  ⚠️ E nada foi inventado: a direção sai de comparar prestador/tomador com o
  CNPJ da empresa (o que o importador do portal de SP já faz), a competência sai
  da data de emissão, e **o que não dá para derivar fica de FORA e volta
  NOMEADO** em `lacunas` — empresa que não é parte não ganha direção chutada
  (seria a nota no livro errado), e data ilegível não vira competência (nota na
  competência errada some do mês certo E aparece no errado).
  🔴 **E O EVENTO ESTAVA APAGANDO A NOTA**: o `docId` é a CHAVE nos dois casos —
  e a chave do evento é a **da NFS-e a que ele se refere**. Com `merge: true` e
  `tipo: meta.tipoDoc`, o evento reescrevia o `tipo` do documento para
  `'eventoNfseNacional'`: **a nota deixava de ser nota**. É a família do stub que
  o merge ressuscitava (11/08), na direção contrária. Agora ele entra em
  **`eventos[]`** — o array que `docCancelado` já lê — sem tocar na identidade.
  🚩 **PENDÊNCIA NOMEADA, NÃO CORRIGIDA**: isso **não** faz o cancelamento pelo
  ADN ser detectado. `docCancelado` reconhece o **110111** da NF-e, e o código de
  cancelamento do leiaute nacional da NFS-e **não está provado neste repo** —
  carimbá-lo de memória seria inventar código de tabela oficial. O evento fica
  gravado e FIEL; fecha com um evento real de cancelamento vindo do ADN.
  ✂️ **E A LEITURA PASSOU A RESPONDER PELO ACERVO ANTIGO**: `detectTipo` (a
  régua da lista) perguntava `tipo === 'NFSe'`, não casava com o rótulo antigo e
  caía no default `'NFe'` — a NFS-e do ADN já capturada aparecia como nota de
  **MERCADORIA**. Agora ela pergunta ao dono (`ehNotaDeServico`), que conhece as
  formas raras. **Campo gravado pode não existir na forma que o leitor espera —
  quem responde é a régua da LEITURA.**
  ✅ **NÃO HÁ ACERVO A CONSERTAR** (medido em 23/08: histórico total = 0). A
  leitura pelas DUAS formas do rótulo continua nos consultores, e é barata —
  ela cobre o dia em que o trilho começar a trazer documento.

- **🚨 O CRUZAMENTO CFI × SPED GRITAVA "NÃO ESCRITURADA" EM TODA CANCELADA POR
  EVENTO — sobre um arquivo CERTO** (22/08). O DESENHO já estava certo e
  escrito no cabeçalho do módulo desde sempre: *"só cruza NF-e capturadas com
  status='autorizado' (canceladas, denegadas, inutilizadas não devem estar no
  SPED — incluir geraria falso-positivo)"*. A **LEITURA** é que era cega — o
  cancelamento por EVENTO não muda o `status`, então a cancelada passava.
  🔴 **E o falso-positivo que o próprio cabeçalho previa saía do jeito mais
  alarmante**: o C100 de cancelada tem **COD_SIT 02**, que não está em
  `COD_SIT_EFETIVO`, logo ela nem entra no índice do SPED — e a nota capturada
  virava **`NAO_ESCRITURADA`, severidade ERRO** (*"capturada e NÃO encontrada
  na escrituração"*), a mensagem mais grave da tela, disparando com os dois
  lados certos.
  ✂️ Quem responde é `docCancelado`, e o descarte é **CONTADO À PARTE**
  (`canceladasNaoConferidas`) com KPI próprio: *"não conferi porque foi
  cancelada"* e *"não conferi porque o documento está torto"* pedem ações
  opostas — um número só faz as duas parecerem a mesma coisa. Trocar um alarme
  falso por um silêncio falso não é correção.
  ⚠️ Um teste que exigia a cancelada no contador MISTURADO foi **TROCADO** —
  ele descrevia a premissa que este PR corrige.
  ✂️ Junto: os relatórios **Entradas/Saídas** da Central de XMLs filtravam pelo
  campo cru enquanto o *resumo por competência* da mesma tela já contava pelo
  dono — dois números do mesmo fato na mesma tela —, e a coluna de contraparte
  deles deduzia o lado do **nome do relatório** ("estou em entradas ⇒ emitente"),
  que na nota própria de entrada é o PRÓPRIO cliente.

- **🚨 A COLUNA DA CONTRAPARTE LIA O CAMPO CRU NA MESMA LINHA EM QUE O SELO DA
  DIREÇÃO JÁ VINHA DO DONO** (22/08, quarta leva do eixo). A lista de
  documentos e o PDF dela pintavam o selo com `getView(d).direcao` (a régua) e
  escolhiam entre *emitente* e *destinatário* com `d.direcao` (o campo cru) —
  duas leituras do mesmo fato **na mesma linha**.
  🔴 **E é do tipo mais traiçoeiro: hoje o campo cru ACERTA por acidente.** A
  nota própria de entrada está gravada como `'saida'`, então o `=== 'entrada'`
  dá falso e a tela mostra o destinatário, que É a contraparte. No dia em que o
  backfill do sync-cron virar a direção, a MESMA linha passa a mostrar o
  **emitente — o próprio cliente**.
  ⚠️ **E A CORREÇÃO "ÓBVIA" PRODUZ O DEFEITO NA HORA**: trocar por
  `direcaoEfetivaDoc` (que responde ENTRADA) faz a coluna mostrar o próprio
  cliente imediatamente. **A pergunta não é "qual a direção", é "em qual LADO
  está a contraparte"** — e ela já tinha dono no backend
  (`participanteDoDocumento`, do C100/0150). `ladoDaContraparte` é a MESMA
  régua na forma que a tela precisa: o arquivo quer o objeto, a tela quer
  escolher entre duas colunas já normalizadas.
  ✂️ Junto foi o **nome da EMPRESA** quando falta `empresaNome` — ele é o lado
  OPOSTO, e virou a mesma régua lida ao contrário em vez de uma segunda
  condição que divergiria no mesmo dia.
  🔴 **E O "ONDE ESTÁ A NOTA?" MANDAVA PROCURAR DO LADO ERRADO**: a rota
  `localizar-doc` devolvia `direcao: d.direcao` cru — e ela é justamente a tela
  que o colaborador abre **quando o filtro não achou o documento**. Ela dizia
  *saída* enquanto o filtro da lista, corrigido no mesmo dia, mostra a nota em
  ENTRADAS. O `tpNF` passou a viajar junto: **campo fora da resposta some da
  leitura de quem quiser conferi-la depois** (`DocLocalizado` não o tinha, então
  a régua ali era cega por construção).
  ✅ E o **bloco A do EFD-Contribuições** passou a ler pela régua como o C100 e
  o C170 do MESMO arquivo — ali só entra NFS-e (sem `tpNF`), então a resposta é
  idêntica; o que não pode é um bloco perguntar de um jeito e o vizinho de
  outro.

- **🚨 O ISS CHEGAVA EM QUATRO FORMAS E TODO MUNDO LIA UMA — a do NAVEGADOR,
  que é a MINORIA das notas** (22/08, o eixo da direção aplicado ao ISS). A
  varredura mostrou o fato que explica tudo: **só o import pelo navegador**
  (`xmlParserService`) grava o objeto `valores{}`. Os trilhos que trazem a
  esmagadora maioria das NFS-e gravam de outro jeito — o **portal de SP** (CSV
  e o WS legado) grava `valorIss`/`issDevido` ACHATADOS (e `issRetido`
  **BOOLEANO**, sem valor separado), o **ABRASF** grava `totais.vISS`, e o
  **ADN** grava `valorIss` **com `tipo: 'nfseNacional'`**.
  🔴 **O custo, leitor a leitor**: o relatório de **ICMS/IPI/ISS destacados**
  somava ISS **0,00** na carteira inteira; as abas **Serviços tomados/prestados
  e Retenções** imprimiam a coluna zerada **e** — pelo `d.tipo === 'NFSe'` — a
  nota do ADN **sumia inteira** das três; a **NFTS** (declaração de serviços
  TOMADOS de SP) perdia justamente o prestador de fora do município; e a tese de
  **recuperação do ISS** exige `issValor > 0`, então respondia
  *"sem_oportunidade"* sem ter lido nota nenhuma.
  🔴 **E O MAIS CARO ERA UMA TRAVA DIZENDO VIA LIVRE**: `contarRetencoesTomadas`
  (o insumo do **Reinf** na DCTFWeb) lia só `valores.*`, então em toda NFS-e do
  portal o total dava ZERO → `seloReinf` = `sem-movimento` → `vereditoInsumos` =
  **'pronto'**, *"os três insumos confirmados, pode fechar sem retrabalho"*,
  sobre competência COM retenção. A trava respondia verde exatamente no caso que
  ela existe para barrar — e a ressalva agravava, mandando *"notas antigas…
  reimportar o XML"* sobre nota atual cujo dado estava no campo ao lado.
  ✂️ `issDoDocumento` / `issRetidoDoDocumento` / `issRetidoDeclarado` nascem no
  `xml-metadata-helper` — a casa das leituras de documento, para onde o
  `valorDoDocumento` foi em 21/08 pela MESMA razão — e entram em
  `REGUAS_VIGIADAS`. Ausência devolve **NaN**, nunca zero.
  ⚠️ **`issAPagar`/`issPago` ficam FORA, de propósito**: eles respondem *"quanto
  FALTA pagar"*, não *"quanto o documento destacou"* — a nota já quitada
  apareceria com ISS zero. E **o booleano do portal não vira valor**: ele afirma
  a retenção e não diz quanto, então quem precisa da marca lê
  `issRetidoDeclarado`; somar `0` como se fosse o retido seria declarar retenção
  nenhuma sobre nota que teve.
  📌 **E A SEQUÊNCIA CERTA JÁ EXISTIA — copiada em DOIS lugares** (`iss-carteira
  .js`, desde 06/08, e `issSpApuracao.ts`), enquanto três leitores liam uma
  forma só. É o retrato de como a régua diverge: não por alguém saber menos, mas
  por a resposta morar em três cabeças. As duas cópias passaram a delegar e o
  `primeiroNumero` órfão foi **DELETADO**.
  🐛 **E A TRAVA NOVA GRITOU SOBRE O ARQUIVO JÁ CORRIGIDO**: `reguaUnica` lia o
  arquivo INTEIRO, comentário incluído — as assinaturas antigas eram formas de
  CÓDIGO (`export function …`) e isso nunca aparecera; a do ISS casa nomes de
  CAMPO e acusou os três comentários que EXPLICAM a correção, ou seja mandava
  apagar a explicação para o teste passar. A varredura passou a ler **código,
  não prosa** — a mesma decisão que a varredura de órfãs já tinha tomado.
  Provada revertendo uma delegação de propósito.

- **🚨 A DEDUP DO ART. 136 NÃO RODAVA PARA NOTA NENHUMA — a compra dobrava, em
  DOIS livros** (22/08, terceira leva do eixo da direção). Dois defeitos que se
  sustentavam:
  🔴 o **Livro de Entradas** filtrava `d.direcao === 'entrada'` — campo CRU. A
  nota própria de entrada fica gravada como `'saida'`, então ela **não chegava
  ao Livro de Entradas** (aparecia no de SAÍDAS) e, por tabela, **nunca chegava
  à dedup** logo abaixo;
  🔴 e a `ehNotaPropriaDeEntrada` do `livroNotaProdutor.ts` exigia
  `direcao === 'entrada'` — **o contrário do dono no backend**. Função com o
  MESMO NOME respondendo diferente, que é o começo de duas respostas
  divergentes (a lição do `perguntarDebitosJaEnviados`, 18/08).
  🔴 Resultado: a nota do PRODUTOR ficava **sem par** e entrava no livro, com a
  própria contada do outro lado. A compra de produtor rural contava **duas
  vezes**, em livros diferentes — que é exatamente o que a dedup de 11/08
  existe para impedir.
  📌 **E O TESTE PASSAVA**: o fixture usava `direcao: 'entrada'`, a forma
  PÓS-backfill. Ele descrevia um mundo que a produção não vive. Agora o
  fixture é a forma REAL do banco (`'saida'` + `empresaCnpj`), com o caso
  pós-backfill ao lado e o `tpNF=0` de TERCEIRO barrado.
  ⚠️ **Fixture que não é a forma gravada é teste verde sobre defeito vivo** —
  é a armadilha das duas formas atacando o TESTE, não o código.

- **🚨 A CENTRAL DE DOCUMENTOS DIZIA "SAÍDA" NA NOTA QUE O SPED ESCRITURA COMO
  ENTRADA** (22/08, fechando o eixo da direção onde ele mais aparece). Depois
  de o SPED, o `.FML`, o preflight e os relatórios passarem a ler pela régua,
  sobrou **a tela onde o colaborador PROCURA o documento** — e ela era a pior
  das quatro:
  🔴 **o FILTRO fazia a nota SUMIR**: pedindo **ENTRADAS**, a compra de
  produtor rural (art. 136) não aparecia — ela fica gravada como `'saida'` até
  o backfill passar —, e aparecia ao pedir **SAÍDAS**. Em todo cliente que
  compra de produtor, aquelas notas eram invisíveis na lista de entradas.
  🔴 E a **lista, o CSV e o PDF** leem `getView(d).direcao`, que preferia o
  campo cru — inclusive a **contraparte** do CSV, derivada de
  `direcao === 'entrada'`: com a direção errada, a coluna trazia o lado errado
  do documento.
  ✂️ `getView` (o dono da leitura da tela) e `applyDocumentosFilters` passaram
  a chamar `direcaoEfetivaDoc`. ⚠️ **O fallback pelo CNPJ continua**: resumo
  (resNFe) chega sem direção legível, e é ele que responde ali — o dono entra
  ANTES, não no lugar.
  📌 **REGRA QUE FICA: o eixo de uma régua não fecha no gerador — fecha em quem
  PROCURA o documento.** Livro certo com tela que esconde a nota é a mesma
  divergência de sempre, na forma mais cara: a pessoa conclui que a captura
  falhou.
  🔴 **E A MESMA VARREDURA ACHOU O ARQUIVO DO FISCO SE CONTRADIZENDO — o SPED
  Fiscal declarava a MESMA nota como SAÍDA.** Três leituras cruas no
  C100/C170/C190 do EFD ICMS/IPI: o **IND_OPER** saía **1 (saída)** no MESMO
  registro cujo `IND_EMIT` logo abaixo já reconhecia a emissão própria de
  entrada; e a **correlação de CFOP** do C170 e do C190 recebia a direção crua,
  então o CFOP saía **5102** — enquanto o `.FML` grava 1102 e o E110 já soma
  como CRÉDITO. **É o C190 que a apuração soma.** No EFD-Contribuições a mesma
  leitura crua punha a COMPRA em `totalReceitaSaida`: o arquivo declarava
  PIS/COFINS a pagar **sobre uma compra**.
  📌 **E A TRAVA LITERAL MORDEU PELA QUARTA VEZ** (`cfopPorNota.test.ts`): ela
  prendia `nota.direcao` no TEXTO da chamada — e esse campo É o defeito.
  Trocada pela INTENÇÃO (o documento chega + a direção vem da régua) mais a
  proibição explícita do campo cru.

- **🚨 O CÓDIGO MORTO DO SPED **ERA A RÉGUA VELHA** — e uma trava estava
  escrita sem nunca ter sido ligada** (22/08). A varredura de declarações
  órfãs no `sefaz-backend/` achou seis, e a triagem por RISCO deu duas
  naturezas OPOSTAS.
  🗑️ **Cinco a DELETAR, porque o morto ERA a régua que já custou caro**:
  `MODELOS_BLOCO_C = ['55','65']` + `filtrarNotasBlocoC` viviam nos DOIS
  geradores, e `MODELOS_BLOCO_D` no bloco D — é a comparação contra o campo
  CRU `n.modelo`, o defeito que tirou **100 das 131 notas** da PS VIDROS do
  arquivo (19/08). Quem responde hoje é `selecionarNotasBlocoC`. Junto saiu o
  `modeloDaChave` órfão da prevalidação, que eu mesmo orfanei horas antes ao
  mover a R1 para o dono comum.
  🔌 **Uma a LIGAR, porque ela deveria estar rodando**: a tabela de **CST de
  PIS/COFINS (4.3.3/4.3.4)** morava em `sped-fiscal-regras-tributarias.js` — o
  módulo do EFD **ICMS/IPI**, que não escreve CST de PIS/COFINS nenhum — **sem
  um único leitor**. É a família do `coberturaIncompleta` (quatro dias
  produzindo flag que ninguém lia) e do E510 "pronto" que ninguém gerava:
  **trava escrita não é trava ligada.** E a classe é real ali: em 20/08 a PWR
  saiu com **CST `01` numa ENTRADA**, código que nem existe na tabela das
  aquisições.
  ⚠️ **O QUE ELA CONFERE, e o que NÃO**: se o código EXISTE na tabela — pega
  vazio, CSOSN (`101`, `500`) e lixo de captura. Ela **não** julga se o código
  é o certo para a DIREÇÃO: a Tabela 4.3.7 (aquisições) não está no repo, e
  reconstruí-la de memória seria inventar tabela oficial.
  ⚠️ E lê **só o C170**, cujas posições estão PROVADAS (37 campos, recibo do
  PVA + arquivo aceito: CST_PIS 25, CST_COFINS 31). O **A170 fica de fora,
  nomeado** — a contagem dele não está em `CAMPOS_POR_REGISTRO`, e conferir
  posição deduzida é alarme falso.
  📌 **REGRA QUE FICA: no SPED, declaração órfã se TRIA, não se apaga em
  bloco** — ou ela some (era a régua velha), ou ela é LIGADA (era a trava que
  faltava). A varredura fica, e o que não foi triado fica **NOMEADO** em vez
  de ganhar motivo inventado.
  🔴 **E A TRIAGEM DAS DUAS ÚLTIMAS ACHOU O DEFEITO QUE ELAS ESCONDIAM.**
  `spOk`/`baixaOk` do painel de envio estavam superadas por
  `pendenciaSharePoint`/`pendenciaBaixa` — que respondem a mesma pergunta E
  devolvem o motivo. Só que essas duas devolvem **null quando NÃO HÁ status
  gravado**, e o painel lia esse null como *"etapa cumprida"*: o envio entrava
  em `completos` e o resumo afirmava **"todos completos (arquivados e com
  baixa)"** — o que a rodada nunca estabeleceu. Auditoria gravada ANTES do
  rito #293 existir cai exatamente aí.
  ✂️ Nasceu `naoConferidos`: nem completo, nem pendência — **ação própria**
  (conferir a pasta IMPOSTOS e a aba Vencimentos), com a linha dizendo QUAL
  etapa não tem registro, e o farol saindo do verde enquanto houver um. É a
  mesma correção do selo da conferência CFI × SPED, no mesmo dia: **ausência
  de alarme não pode ser indistinguível de "está tudo certo"**.
  ⚠️ `sem-pdf` continua sendo desfecho LEGÍTIMO (envio sem anexo, como aviso de
  guia já paga) — ele não vira "não conferido".
  📌 E o bloco entrou **na TELA no mesmo PR**: flag que ninguém lê é
  exatamente a classe que este PR fecha.
  de ganhar motivo inventado: sobraram **quatro pendentes**, e duas delas
  (`spOk`/`baixaOk` do painel de envio) têm cara da MESMA classe — conferência
  do rito #293 escrita e nunca ligada.

- **🚨 O `COD_ITEM` TINHA QUATRO RÉGUAS — e ele é a CHAVE que liga o item ao
  cadastro do 0200** (22/08). O 0200 é a Tabela de Identificação do Item; C170
  e A170 **apontam** para ela. Nas DUAS famílias de arquivo os dois lados
  respondiam coisas diferentes, e o PVA já cobrou as duas consequências desta
  casa: *"Campo obrigatório · COD_ITEM"* (MANTOAN, **36 recusas**, 18/08) e o
  **item ÓRFÃO**, declarado no 0200 e referenciado por ninguém (PWR, 19/08).
  🔴 **O retrato de antes**: o **0200** (os dois orquestradores) usava
  `cProd || codigo || cFiscal || ITEM-n`; o **C170 do EFD ICMS/IPI**,
  `cProd || codigo || ITEM-n` — **sem o `cFiscal`**; e o **C170 e o A170 do
  EFD-Contribuições**, `cProd || codigo || ''` — **saindo VAZIO**. Item que
  chega só com `cFiscal` fazia o 0200 dizer `7803` e o C170 `ITEM-1`.
  🔴 **E havia uma QUINTA divergência escondida no próprio `ITEM-n`**: o 0200
  lê o `nItem` que veio no XML e o C170 do ICMS/IPI usava o **contador do
  laço**. Batia por coincidência quando a ordem do array casava com o número do
  item; fora disso, `ITEM-3` × `ITEM-1` — órfão garantido.
  ✂️ `codItemDoItem` nasce em `sped-selecao-documentos.js` (a casa das decisões
  de item/documento que as DUAS famílias leem), e **quem manda é o 0200**,
  porque ele é o CADASTRO: quem aponta se ajusta a quem é apontado. Nunca
  devolve vazio.
  📌 **A trava é por VARREDURA** — lista de arquivos envelhece no primeiro
  registro novo, e envelhece em SILÊNCIO, que é exatamente como esta divergência
  sobreviveu a duas rodadas de PVA.
  ⚠️ **Pendência NOMEADA, não corrigida**: item sem `nItem` cai em `ITEM-?`, e
  dois produtos distintos nessa situação colapsam num cadastro só. É o
  comportamento que o 0200 já tinha; trocar uma chave de cadastro sem caso real
  seria pior que a colisão.
  ✂️ **E A IRMÃ ESTAVA UM CAMPO ADIANTE — a `UNID`, que liga o item ao 0190.**
  Mesma doença, CINCO escritas e quatro normalizações: o **0190** dos dois
  orquestradores fazia `.toUpperCase().substring(0,6)` **sem trim**; o **C170**
  das duas famílias, `sanitizeString(upper, 6)` **com trim**; o **UNID_INV do
  0200**, `sanitizeString(unidade, 6)` **sem `toUpperCase`**; o **H010**, sem
  nenhum dos dois; e a rota do editor, uma quarta forma. Com `'UN '` no XML, o
  0190 cadastrava `'UN '` e o C170 referenciava `'UN'` — o registro aponta para
  unidade que a Tabela não tem **e** a Tabela declara uma que ninguém
  referencia: as duas recusas do PVA de uma vez.
  📌 **O validador do app já sabia** (*"C170: UNID 'X' nao cadastrada no
  0190"*) — mas ele roda DEPOIS, sobre o arquivo pronto. **Conferência que
  existe não substitui régua única**: ela conta o erro, não o impede.
  🔴 **E A MESMA "MEIA TRAVA" ESTAVA NA PREVALIDAÇÃO: duas recusas já pagas
  rodavam numa família só.** O **cabeçalho do C100 é o MESMO nos dois
  arquivos** (`|C100|IND_OPER|IND_EMIT|COD_PART|COD_MOD|COD_SIT|SER|NUM_DOC|
  CHV_NFE|DT_DOC|DT_E_S|VL_DOC|…` — só o que vem DEPOIS do VL_DOC diverge), e
  mesmo assim a recusa *"o modelo da chave não confere com o modelo do
  documento"* (PS VIDROS, **35 ocorrências**) e o limite de `DT_DOC` do Guia
  3.2.3 só existiam no EFD ICMS/IPI. `sped-c100-regras-comuns.js` é o dono, e
  as duas passaram a rodar no EFD-Contribuições.
  🐛 **E O TESTE PEGOU UM ERRO MEU DE CONTAGEM ANTES DE SUBIR — do tipo
  BARULHENTO, não do silencioso**: eu escrevi que o `DT_FIN` do
  EFD-Contribuições era o campo **6**; ele é o **7** (o 0000 dele traz
  `IND_SIT_ESP` e `NUM_REC_ANTERIOR` antes das datas). O campo 6 é o
  **DT_INI** — que também é uma data VÁLIDA —, então a regra não emudeceria:
  passaria a acusar **TODA** nota emitida depois do dia 1º, em todo arquivo da
  família. **Posição de campo é PARÂMETRO por família, nunca dedução do
  vizinho.**
  ⚠️ **A100 e D100 ficam de FORA, declarado**: eles têm campos a mais no
  cabeçalho (`SUB` no D100), então as posições NÃO são as mesmas. Portá-los sem
  a prova do leiaute produziria o alarme falso que desliga a prevalidação.
  🔴 **E A VARREDURA DA DUPLA ACHOU O CASO EM QUE A CÓPIA JÁ TINHA CUSTADO: o
  0150 e o 0190.** Os dois têm o **MESMO leiaute** nas duas famílias (só o 0000
  é de fato diferente — um tem COD_VER/IND_PERFIL, o outro
  TIPO_ESCRIT/IND_NAT_PJ) e estavam escritos byte a byte duas vezes. E a
  denúncia do **COD_MUN faltando** — a recusa de 18/08, **30 participantes** da
  MANTOAN — tinha entrado **SÓ no EFD-Contribuições**: o 0150 do EFD ICMS/IPI é
  o MESMO registro, com a MESMA obrigatoriedade, e ficava **MUDO**. A próxima
  empresa gastaria a mesma volta de PVA com outro CNPJ.
  📌 **REGRA QUE FICA: recusa aprendida entra na prevalidação no MESMO PR — e
  em TODAS as famílias onde o registro é o mesmo.** Meia trava protege o
  cliente que já quebrou e deixa o próximo descoberto (a lição de 21/08, agora
  do lado do bloco 0). `sped-bloco0-cadastros.js` é o dono.
  ⚠️ A decisão do Paulo continua na frase do aviso: **o app NÃO preenche** —
  inventar município é afirmar o domicílio de terceiro, e o `'9999999'` que o
  PVA sugere significa *"NÃO domiciliado no Brasil"*.
  ✂️ **E O BLOCO 9 INTEIRO ERA UMA SEGUNDA CÓPIA, linha por linha.** Ele é a
  **aritmética de FECHAMENTO**: o 9900 conta cada tipo de registro, o 9990 as
  linhas do próprio bloco e o **9999 o ARQUIVO INTEIRO** — os três conferidos
  pelo PVA. As duas implementações eram **idênticas**, e é aí que a segunda
  cópia é perigosa: **não há defeito hoje, e a próxima correção entra numa
  só** — foi exatamente o que aconteceu com o `getContadorPadrao` e com o
  `UNIDADES_PADRAO`, nesta MESMA dupla de arquivos. Virou re-exportação, com
  teste cruzado exigindo saída idêntica.
  ✅ O desenho do 9900 já era o certo e fica declarado: ele conta os registros
  que de fato SAÍRAM, nunca uma lista — bloco novo entra sozinho.
  ✂️ **E A TABELA DE DESCRIÇÃO ERA A TERCEIRA CÓPIA — já divergida.** O
  `UNIDADES_PADRAO` existia nos DOIS orquestradores, e o do EFD ICMS/IPI tinha
  **`CM: CENTIMETRO`** que o do EFD-Contribuições não tinha: item em CM saía
  descrito *"CENTIMETRO"* num arquivo e *"CM"* no outro. É a divergência do
  `getContadorPadrao` (20/08) na MESMA dupla de orquestradores. As duas cópias
  foram **DELETADAS** — código morto é a isca para alguém reativar a régua
  velha.
  ⚠️ `normalizarUnidade` devolve **''** para ausência de propósito: o default
  `'UN'` continua onde já estava (0190, 0200 e C170) e o **H010 segue sem
  default** — inventar a unidade do inventário mudaria a leitura da
  QUANTIDADE, que é outra ordem de erro. A régua uniformiza a FORMA da chave,
  não a política de ausência.

- **🚨 O FORMATADOR DE VALOR DO SPED ENCOLHIA O NÚMERO EM SILÊNCIO** (22/08,
  varrendo o gêmeo da data — mesmo módulo, mesma classe). `formatValue` fazia
  **`parseFloat(value)` cru**, e o `parseFloat` lê só o PREFIXO que entende. As
  duas formas em que um valor chega como TEXTO neste projeto são justamente as
  que ele erra: **`'1.234,56'`** (pt-BR — do e-Fiscal, de PDF, de colagem) vira
  **1.234**, ou seja o arquivo declara **`1,23`**; e **`'1234,56'`** (digitado
  sem milhar) vira **1234**, ou seja **os centavos somem**.
  🔴 **Nas duas o arquivo sai com um número ERRADO E PLAUSÍVEL** — o pior
  desfecho: o PVA aceita e ninguém confere valor a olho. É a família do
  `VL_OPR` sem o IPI (20/08), o erro que o validador não recusa e só aparece na
  fiscalização. Agora o texto passa pela MESMA leitura de `parseValorMoeda`
  (pt-BR com milhar, sem milhar, e ponto decimal JS), e o ilegível continua
  saindo **VAZIO** — campo de valor não recebe default, e `''` o PVA acusa;
  número errado, não.
  ✂️ **E A IRMÃ ENTROU NA AUDITORIA: valor NEGATIVO.** O leiaute do SPED **não
  carrega sinal** — saldo que muda de lado tem DOIS campos (devedor × credor),
  e ajuste que abate é dito pelo **CÓDIGO** da 5.1.1. Um `-1.234,56` é sempre
  uma de duas coisas, e as duas já morderam: **subtração que passou do zero**
  (o E210 de 21/08, dedução maior que o saldo devedor) ou **valor no campo do
  lado errado** (o E110 campo 11, de 02/08, recebendo o saldo CREDOR num campo
  de saldo DEVEDOR).
  📌 **Ela mora na AUDITORIA, que roda em TODO arquivo gerado das DUAS
  famílias** — a lição de 21/08: trava nasce onde roda para todos os arquivos
  daquela família, senão protege o cliente que já quebrou e deixa o próximo
  descoberto. E **não lista registro por registro**: lista envelhece no
  primeiro registro novo, e envelhece em silêncio.
  ⚠️ A assinatura é ESTREITA de propósito (`-` + número no formato SPED): código
  de ajuste, data, chave e razão social **não** casam. **Nasce VERDE** — as 365
  suítes passam, ou seja nenhum gerador de hoje emite negativo.

- **🚨 A NOTA EMITIDA ÀS 22h SAÍA NO SPED COM A DATA DO DIA SEGUINTE** (22/08).
  O `dhEmi` da NF-e chega com o fuso do EMITENTE
  (`2026-07-31T22:30:00-03:00`); o formatador fazia `new Date(...)` e lia
  **`getUTCDate()`**. Às 22h30 de Brasília, em UTC, já é o dia seguinte — e o
  backend roda no **Cloud Run, que é UTC**, então o defeito era ATIVO.
  🔴 **Duas gravidades**: nota depois das **21h** saía com a data do dia
  seguinte (errado, e ninguém confere data a olho); e na **VIRADA DO MÊS** ela
  saía com a data de OUTRA competência, aí o PVA recusa.
  ✂️ **A data que o documento DECLARA é a do TEXTO** — `2026-07-31`. Converter
  para outro fuso é reescrever o que a nota diz, então o formatador passou a ler
  o prefixo ISO da string. O `Date` continua em UTC porque um `Date` já perdeu o
  fuso de origem: não há o que recuperar; quem tem a string não deve convertê-la
  antes. **Timestamp do Firestore** também parou de sair VAZIO — data em branco
  no C100 é recusa do PVA.
  🚦 **E a recusa virou REGRA no mesmo PR (R16)**, com a fonte no Guia — 3.2.3,
  C100 campo 10: *"o valor informado no campo deve ser menor ou igual ao valor
  do campo DT_FIN do registro 0000"*. ⚠️ **Só o limite SUPERIOR**: o Guia não
  exige `DT_DOC ≥ DT_INI` no C100, e documento **EXTEMPORÂNEO** é legítimo —
  acusá-lo seria alarme falso sobre escrituração correta.
  ✂️ **E O EXPORTAR SAGE FECHOU NA SEQUÊNCIA, no mesmo dia** — eu o tinha
  deixado NOMEADO ("acerta por acidente: `getDate()` lê o fuso do PROCESSO, e o
  .FML sai do navegador em BRT"). Errado deixar: basta a nota vir de **outro
  fuso** (Manaus, −04:00, emitida às 23h30) para o dia andar — e aí o **SPED
  declara 31/07 e o `.FML` 01/08 para a MESMA nota**. Corrigir o gerador e
  deixar o gêmeo é criar a divergência que a casa mais paga, que é a lição
  deste mesmo dia.
  🐛 **E o caminho até lá achou DOIS defeitos que ninguém tinha visto**: o
  `dEmi` caía em **`|| new Date()`** — nota sem `dhEmi` legível era escriturada
  com a data **de HOJE**, e na virada do mês em OUTRA competência, com o
  E-Fiscal aceitando calado (é a régua de 06/08: campo de data não recebe
  default). Agora ela fica **de FORA e NOMEADA**, com a ação (♻️) — e o
  preflight concorda **por construção**, porque ele roda a geração REAL e lê
  `falhas`. E o `dateAAAAMMDD` era **código morto** com um corpo sem sentido
  (`\`${y}${m}${d}\`.length === 8 ? A : A`, interpolando o `Date` inteiro):
  deletado, porque código morto é a isca para alguém reativar a régua velha.
  📌 **A TRAVA É SOBRE A RESPOSTA, NÃO SOBRE O CÓDIGO**: os dois formatadores
  moram em mundos diferentes (o do SPED é backend `.js` **sem `.d.ts`**, e criar
  um só para partilhar cinco linhas traria de volta a armadilha do `.d.ts` à mão
  de 20/08). O teste alimenta os DOIS com as mesmas entradas e exige que digam
  o **MESMO DIA** — inclusive o caso de Manaus, que o BRT também erra.
  📌 **REGRA QUE FICA: data de documento fiscal se lê do TEXTO, nunca de uma
  conversão de fuso.** `new Date(...)` + `getUTCDate()`/`getDate()` sobre um
  `dhEmi` é a armadilha das duas formas com outra roupa — o mesmo instante,
  dois dias.
  ✅ Fica cru, com o motivo: a **DATA DE INCLUSÃO** do E020 (cadastro de
  produto) — ela responde "quando este item entrou no cadastro", não que dia o
  documento declara; um dia de diferença ali não muda livro nenhum.

- **🚨 E OS RELATÓRIOS LIAM A DIREÇÃO CRUA — a tela discordaria do arquivo que
  eu tinha acabado de consertar** (22/08, fechando o eixo). Corrigidos o SPED,
  o `.FML` e o preflight, sobrava quem o colaborador USA para conferir: a
  **conferência de correlação de CFOP** (`d.direcao !== 'entrada'` → a compra de
  produtor **sumia da tela** que existe para mostrá-la) e o
  `relatoriosAgregacoes` inteiro — **Resumo por CFOP** (linha saía como
  *"saída"* com um CFOP **1xxx** ao lado), **ICMS/IPI destacados** (o ICMS ia ao
  **DÉBITO** em vez do crédito — o achado 16 outra vez, errando para os dois
  lados), **Por participante**, **Por produto** e **Por UF**.
  🔴 **E O EIXO AINDA TINHA DOIS GERADORES**: o **E510 (IPI)** do SPED Fiscal
  lia `nota.direcao` cru onde decide DOIS campos do arquivo — o CFOP e, o mais
  caro, o **CST de escrituração**, que na ENTRADA converte o CST de saída do
  fornecedor (IN RFB 932/2009: 50→00, 51→01…). A nota própria de entrada ia ao
  E510 com o CFOP e o CST **da operação do fornecedor**. E a coleta do **F600**
  filtrava saída pelo campo cru, deixando uma COMPRA entrar na conta da
  retenção sofrida e sair nomeada num aviso sem sentido para quem lê.
  📌 **REGRA QUE FICA: corrigir o GERADOR sem corrigir quem CONFERE cria a
  divergência que a casa mais paga.** O eixo da direção só fechou quando
  gerador, preflight, conferência e relatórios passaram a ler o MESMO dono.
  ✅ Ficam cruas, com o motivo no teste: `contraparteDoc` (já trata a própria
  entrada explicitamente) e as leituras de **NFS-e**, que não têm `tpNF`.
  🚩 **E A CLASSE NÃO ESTÁ FECHADA — restam ~60 leituras cruas de `direcao`**
  no repo, e elas **não foram triadas uma a uma**. O que foi corrigido é o que
  produz ARQUIVO FISCAL e o que a equipe compara com ele. O resto é, em boa
  parte, domínio onde o campo não mente (NFS-e, direção de MENSAGEM, formulário
  de lançamento manual) — mas isso é hipótese, não varredura feita.
  📌 **E A TRAVA LITERAL MORDEU TRÊS VEZES NO MESMO DIA** (`cfopPorNota.test.ts`,
  nas três chamadas de correlação): teste que prende a FORMA da chamada reprova
  a correção que a régua manda fazer. As três foram trocadas pela INTENÇÃO
  (o DOCUMENTO chega como argumento) **mais** a proibição explícita do campo
  cru — que é o que elas deveriam ter dito desde o começo.

- **🚨 A TRAVA DO APATEL COBRIA UM ARQUIVO — e a classe estava viva na PORTA
  QUE GRAVA DOCUMENTO FISCAL** (22/08). Em 21/08 a regra ficou escrita: *"input
  de valor NUNCA é controlado por `String(número)`"* (o campo re-parseia o
  próprio texto exibido, a tecla da vírgula devolve o inteiro, o render apaga a
  vírgula e os dígitos seguintes grudam — "1234,50" vira **123450**, tecla a
  tecla). Só que a trava foi escrita como **LISTA de um arquivo**
  (`components/Relatorios/index.tsx`) — o vício de 13/08 —, e o
  **✍️ Lançar nota sem XML** tinha o mesmo defeito em TRÊS campos: o **valor do
  item**, a **alíquota do ISS** e o **ISS devido**.
  🔴 **E O PIOR ERA O CAMPO QUE PARECIA SEGURO**: o *valor total da nota* já
  guardava texto, mas passava por uma **SEGUNDA CÓPIA** da régua (`num()`), que
  apagava **TODO** ponto — então a forma JS com ponto decimal (`3241688.71`,
  que é como sai de export de sistema) virava **324.168.871**. O mesmo 100× do
  APATEL, no campo que alimenta livro, SPED, DIPAM e relatórios. E o item tinha
  ainda uma TERCEIRA cópia inline (`parseFloat(v.replace(',','.')) || 0`), que
  não tirava o milhar (colar `1.234,56` gravava **R$ 1,23**) e transformava
  ilegível em **ZERO** — num campo de valor, que é a regra de 06/08.
  ✂️ `services/valorDigitado.ts` vira o dono da pergunta ("que número a pessoa
  digitou?"); `declaracaoFaturamento.ts` **re-exporta**, então quem já importava
  de lá não muda. Os três campos guardam TEXTO, o número é derivado na
  gravação, o **eco do que o app ENTENDEU** aparece ao lado (a outra metade da
  correção do APATEL — aqui vale dobrado, porque isto vira documento fiscal) e
  **ilegível é RECUSA com o campo nomeado**, nunca zero.
  📌 **REGRA QUE FICA: régua nova nasce com a trava por VARREDURA, não por
  lista** — `valorDigitadoNaTela.test.ts` varre `components/**` atrás da
  CONJUNÇÃO que produz o defeito (campo de TEXTO cujo `value` re-renderiza um
  número **e** cujo `onChange` converte). Nasce VERDE, com zero falso positivo.
  ⚠️ **E ELA NÃO ENTROU EM `REGUAS_VIGIADAS`, de propósito**: a assinatura da
  conversão pt-BR casa com **37 arquivos** que fazem OUTRA pergunta — converter
  texto de ARQUIVO (linha de SPED, CSV do portal, PDF do e-Fiscal), onde a
  forma é fixa e conhecida. **Régua única é o dono da MESMA pergunta, não o
  dono mais próximo** (a lição do `ufDoDestinatarioDoc`), e trava que grita
  sobre código certo é trava que a equipe desliga.
  ✅ `type="number"` fica fora da varredura com o motivo: ali o navegador recusa
  a vírgula antes de chegar ao React, então o round-trip não gruda dígito.

- **🚨 O EXPORTAR SAGE DECIDIA O LADO DO LIVRO PELO CAMPO CRU** (22/08). A nota
  PRÓPRIA DE ENTRADA (art. 136 — a compra de produtor rural PF, que o
  adquirente emite) fica gravada como `direcao: 'saida'` até o backfill do
  sync-cron passar; quem decide na LEITURA é `direcaoEfetivaDoc`, pelo `tpNF`.
  O gerador do `.FML` importava `docCancelado` e **não** a régua da direção, e
  lia o campo cru em três lugares que decidem o arquivo: o **E/S da linha**, o
  participante cadastrado como **cliente × fornecedor**, e a **direção passada
  à correlação de CFOP** (que escolhe entre 5xxx e 1xxx). É o caso EDUARDO
  GUERRA de 31/07 (#384) — corrigido no import e na régua, e deixado vivo no
  leitor que GERA O ARQUIVO. Só o participante tinha a exceção, escrita à mão
  ali dentro.
  ⚠️ **Duas leituras cruas ficaram, com o motivo declarado NO TESTE**:
  `usaDestinatario` pergunta em QUAL BLOCO está a contraparte (não o lado do
  livro, e a exceção já está explícita ao lado), e a derivação da UF da empresa
  procura uma nota com chave — a própria entrada também foi emitida pela
  empresa, então a chave carrega a MESMA UF.
  🐛 **E EU DEIXEI A CONFERÊNCIA PARA TRÁS POR ALGUNS MINUTOS**: corrigi o
  GERADOR e o **preflight** continuou lendo o campo cru — com o arquivo saindo
  1xxx (certo) e a conferência exigindo 5/6/7, TODA compra de produtor rural
  viraria "CFOP inválido para nota de saída" sobre um arquivo CERTO. Alarme
  falso em toda nota de um cliente é o jeito mais rápido de ensinar a equipe a
  ignorar o preflight. Os dois lêem a MESMA régua agora, travado por teste.
  📌 **E A TRAVA DE 17/08 REPROVOU A PRÓPRIA CORREÇÃO**: `cfopPorNota.test.ts`
  prendia a **forma literal** `cfopParaEscriturar(it.cfop, d.direcao, ...)`
  quando o que ela existe para garantir é a INTENÇÃO (o DOCUMENTO chega como 4º
  argumento). Trocada pela intenção **mais** a proibição do campo cru — é a
  mesma lição do `IND_REG_CUM`, que travava o `'9'` no texto do arquivo:
  **teste que trava a FONTE impede a correção que a régua manda fazer**.

- **📌 `.d.ts` À MÃO: AS DUAS DIREÇÕES NÃO CUSTAM IGUAL — e só uma é
  silenciosa** (22/08, varredura dos 8 pares `.js`/`.d.ts` escritos à mão).
  · **`.js` exporta e o `.d.ts` não declara** ⇒ quem importar do TypeScript leva
  **erro de compilação**: o gate pega, é ALTO. Hoje há ~25 nomes assim em 8
  arquivos e **não foram corrigidos de propósito** — corrigir em massa é
  trabalho sem consequência, e a régua da casa é triagem por RISCO.
  · **`.d.ts` declara e o `.js` não exporta mais** ⇒ o TypeScript compila feliz
  e o import estoura **em produção, no primeiro clique**. É o silencioso, e é
  esse que `dtsNaoPrometeFantasma.test.ts` fecha. **Hoje há ZERO** — a trava
  nasce VERDE, que é como trava deve nascer.
  🐛 **E ela nasceu fraca**: a 1ª versão só perguntava se o nome APARECIA no
  `.js`, então tirar o `export` de uma função que continua declarada passava
  batido — justamente o caso que ela existe para pegar. **Trava que não grita
  quando devia é pior que trava nenhuma: ela dá sensação de cobertura.** Agora
  compara os nomes EXPORTADOS dos dois lados; provada tirando o `export` do
  `docCancelado` de propósito.
  ⚠️ E as duas constantes de projeção que nasceram hoje
  (`CAMPOS_PARA_DOC_CANCELADO`, `CAMPOS_PARA_VALOR_DO_DOCUMENTO`) entraram no
  `.d.ts` no mesmo dia — eu quase repeti a regra de 20/08 que estava aplicando.

- **🚨 A TRAVA QUE IMPEDE COBRAR O CLIENTE DUAS VEZES CONSULTAVA POR IGUALDADE
  DE COMPETÊNCIA — e a gravação normaliza** (22/08). `impostos_enviados` grava
  `competencia: normalizarCompetencia(...)` (= `AAAA-MM`), e a rota que confere
  o débito repetido perguntava `where('competencia','==', <texto cru da
  requisição>)`. Pedindo **`07/2026`** ou **`202607`**, ela achava **ZERO envios
  anteriores**, respondia *"nunca foi enviado"* e liberava a **MESMA cobrança** —
  que é exatamente o que ela existe para impedir (caso HYPE, 17/08, o 1082 indo
  em duplicidade). É a irmã do CNPJ em duas formas, no campo que decide dinheiro.
  ✂️ A consulta passou a cobrir **todas as formas GRAVADAS** (`formasDaCompetencia`),
  não só a normalizada — envio antigo, anterior à normalização, guarda o texto
  como veio, e perder ESSE registro é a mesma conta dobrada um mês depois. E
  **competência ilegível RECUSA** com o motivo: virar "nunca foi enviado" seria
  liberar a segunda cobrança justamente quando não dá para conferir.
  🔴 **A CAUSA DE FUNDO ERAM DUAS RÉGUAS COM O MESMO NOME**: `envio-imposto.js`
  aceitava `AAAAMM` e **recusava `AAAA-MM-DD`** (a forma que a ficha usa); o
  `ipi-varredura.js` fazia o **contrário**. Cada uma devolvia **null** para a
  forma que a outra entendia — e null aqui não falha, **some**. `competencia.js`
  virou dono das quatro formas e entrou em `REGUAS_VIGIADAS`.
  ⚠️ **`assertCompetencia`/`partesDaCompetencia` do catálogo NÃO são a terceira
  cópia** e ficam declaradas como exceção: elas respondem *"esta entrada está no
  formato que o catálogo exige?"* e **lançam** de propósito. Régua única é o dono
  da MESMA pergunta, não o dono mais próximo — a lição do `ufDoDestinatarioDoc`.

- **🚨 A CONFERÊNCIA CFI × SPED PULAVA O CONFRONTO DE VALOR — CALADA, e
  justamente na maioria das notas** (22/08). A tela montava o input lendo **só
  `d.totais?.vNF`**, e a captura pela SEFAZ grava **`valorTotal`**: em toda nota
  capturada automaticamente o valor chegava `undefined`, o serviço PULAVA a
  comparação, e a tela mostrava *"nenhuma inconsistência"*. A conferência que
  existe para pegar divergência de valor dizia que estava tudo certo **sem ter
  comparado nada** — é a lição de 12/08 ("conferência que promete número
  diferente do arquivo é pior que não ter tela") na versão silenciosa.
  ⚠️ **O pulo continua existindo** (documento sem valor legível não dá para
  confrontar) — o que mudou é que ele é **CONTADO e DITO** na tela, com a ação
  (♻️ reimportar o XML completo). Ausência de alarme não pode ser
  indistinguível de "os números batem".
  ✂️ No mesmo eixo, a **terceira cópia da régua do valor**: o painel de
  estatísticas do `xmlFiscalService` lia `valorTotal ?? totais.vNF ??
  valores.liquido` — e `valores.liquido` é o que o dono **EXCLUI de propósito**
  (na NFS-e ele é o líquido de RETENÇÕES, não o bruto). Os dois passaram a
  chamar `valorDoDocumento`; serviço do front já importa do backend quando o
  módulo tem `.d.ts`.
  📌 **REGRA QUE FICA: quem MONTA o input de uma conferência também é leitor** —
  a régua única não termina no serviço, ela começa em quem preenche o objeto.
  ⚠️ **E O SELO VERDE ERA A OUTRA METADE**: com documento pulado, a caixa verde
  dizia *"todos os documentos estão compatíveis"* logo ABAIXO do aviso que diz
  o contrário — duas leituras do mesmo fato na mesma tela, que é o defeito que
  este projeto mais paga. Agora ela só afirma o absoluto quando nada foi pulado;
  com pulo, sai âmbar e diz *"nos que deu para conferir"*.
- **🐛 `| tail` MASCARA O EXIT CODE — e por isso um commit com marcador de
  conflito passou pelo gate** (22/08, defeito meu, pego pelo próprio `tsc` no
  push seguinte). `npm run lint 2>&1 | tail -3 && npx jest && ...` continua a
  corrente mesmo com o lint VERMELHO, porque o código que o shell lê é o do
  `tail`. É a mesma armadilha do `git merge … | tail` que já tinha deixado eu
  empurrar uma branch com marcadores horas antes.
  📌 **REGRA QUE FICA: gate se lê SEM pipe** (ou com `set -o pipefail`), e
  **depois de um merge, varrer a árvore inteira por marcador** — `git add -A`
  engole conflito não resolvido em arquivo que você não abriu. A lição de 20/08
  (*"rodar o gate antes do último arquivo é não rodar o gate"*) ganha a irmã:
  **ler o gate por um pipe é não ler o gate**.

- **🚨 A PROJEÇÃO CEGAVA A RÉGUA — as três apurações corrigidas ONTEM
  respondiam como se o campo não existisse** (22/08). Em 21/08 o crédito
  acumulado, o **DIFAL de aquisição** e o **FUNRURAL/DIPAM** passaram a
  perguntar por `docCancelado`. A varredura das **projeções** mostrou que
  nenhuma das três consultas trazia `eventos` nem `cStat` no `.select()` — e o
  cancelamento chega por **EVENTO**, com o `status` ainda `'autorizado'`.
  🔴 Ou seja: régua certa, leitor certo, e a **nota cancelada continuava gerando
  imposto** — DIFAL a pagar sobre compra que não existiu, FUNRURAL sobre nota
  cancelada, crédito de ICMS a maior. **Campo fora da projeção some da leitura**,
  e a régua responde *"não cancelada"* com toda confiança.
  ⚠️ **E a QUARTA era o farol**: a **Rotina do Mês** (o guia do colaborador)
  conta as canceladas pela mesma régua e dizia **"0 cancelada(s)"**, fechando a
  etapa de validação em VERDE. Farol honesto mentindo é pior que farol nenhum.
  ⚠️ No crédito acumulado faltava também o **`tpNF`**, que é o que
  `direcaoEfetivaDoc` usa para reconhecer a nota PRÓPRIA de entrada (art. 136) —
  sem ele o ICMS dela entra do lado errado, que é o achado 16 de novo.
  ✂️ `CAMPOS_PARA_DOC_CANCELADO` nasce **junto do dono** (no
  `xml-metadata-helper`) e `projecaoNaoCegaARegua.test.ts` cobra o trio de quem
  consulta `documentos_fiscais`. **Exceção se declara COM o motivo** — as oito
  de hoje são diagnóstico/adoção/NFS-e (que não tem evento), nenhuma decide
  imposto. Provada removendo os campos do DIFAL de propósito.
  📌 **REGRA QUE FICA: consertar o LEITOR não fecha a classe se a CONSULTA não
  traz o campo.** Régua nova que lê um campo nasce declarando de quais campos
  ela depende, e a projeção que a alimenta é conferida no MESMO PR — é a irmã
  da regra do `.d.ts` e da whitelist do #382.
  ✂️ **E A IRMÃ APARECEU UM CAMPO ADIANTE — o VALOR.** `valorDoDocumento` lê
  SEIS formas porque o valor chega em seis, e o import pelo **NAVEGADOR** grava
  **só `totais.vNF`**. Três consultas traziam apenas `valorTotal`: o **Relatório
  de Faturamento** da carteira, a **Declaração de Faturamento** — o papel
  ASSINADO que vai ao banco — e a base do **FUNRURAL/DIPAM**. Nas duas primeiras
  o leitor ainda lia `Number(d.valorTotal) || 0` cru; na DIPAM o leitor já lia
  as três formas e a **projeção** é que apagava o fallback. Nota importada à mão
  entrava valendo **zero** nos três, calada. `CAMPOS_PARA_VALOR_DO_DOCUMENTO`
  entrou junto do dono e a varredura cobra `totais.vNF` de quem soma dinheiro.
  🐛 **E a trava nasceu com um defeito meu**: ela fechava o `.select(` no
  PRIMEIRO `)` — e as projeções são comentadas, então um parêntese dentro do
  comentário cortava a captura no meio e ela acusava campo que estava lá.
  **Alarme falso que aparece justamente quando está tudo certo** é o que ensina
  a equipe a desligar a trava; o comentário passou a ser removido ANTES da
  leitura dos campos.
- **🚨 A CLASSE QUE A CASA DECLAROU FECHADA — E ESTAVA ABERTA EM NOVE LUGARES**
  (22/08). A regra de 07/08 é literal, e está escrita DENTRO do
  `empresa-por-cnpj.js`: *"nunca consultar Firestore por igualdade de CNPJ neste
  projeto"* — o cadastro guarda o CNPJ em DUAS formas (`51227692000146` e
  `51.227.692/0001-46`), então igualdade casa com uma e ignora a outra. O
  comentário do módulo AFIRMAVA que nenhuma outra rota fazia isso. A varredura
  achou **nove**, e **sete sem fallback nenhum**.
  🔴 **E cada uma erra de um jeito que não parece erro**: o `xml-importer` não
  acha o dono e o documento fica **SEM DONO**, invisível em qualquer filtro por
  cliente (o caso GUARANI, 27/07); os **quatro toggles** (captura SEFAZ e NFS-e
  Nacional) devolvem **404 "Empresa não encontrada"** para empresa que ESTÁ
  cadastrada; o **diagnóstico do ABRASF** era o pior — dizia *"cadastre em
  Simples ou Lucro primeiro"*, mandando recadastrar cliente que já existe; e a
  captura dirigida reportava um cliente em `naoEncontrados`.
  ⚠️ **`where('cnpj','in',[…])` é o MESMO defeito em roupa de LOTE**: ele filtra
  ANTES de normalizar, então o `replace(/\D/g,'')` que vem depois só normaliza o
  que já passou — o mascarado nunca chega lá.
  ✂️ `empresa-cadastro-lookup.js` é a casca que fala com o Firestore (o
  `empresa-por-cnpj.js` continua dono do lado PURO): **igualdade primeiro**
  (1-2 leituras, usa índice) e **só na falha** o índice normalizado, varrido uma
  vez por janela com `.select('cnpj')` e cacheado — inclusive o **negativo**,
  porque CNPJ de terceiro aparece em toda paginação de captura e sem isso cada
  um custaria uma varredura. **LÁPIDE fica de fora nos dois caminhos** (#290):
  os fallbacks antigos da `conferencia-chaves` e da drenagem **não** olhavam a
  lápide e o do `xml-importer` olhava — mesma pergunta, três respostas.
  📌 **REGRA QUE FICA: regra escrita não é regra travada.** Esta viveu 15 dias
  como comentário e renasceu em seis arquivos. A trava varre
  `where('cnpj','==' | 'in')` fora do dono — e **foi ela que achou a nona**, na
  subpasta `abrasf/`, que meu próprio glob de `sefaz-backend/*.js` não pegava.
  ✅ Conferidos e **inocentes**, para não virarem correção cega: os
  `where('empresaCnpj','==',…)` (coleções que o APP escreve, sempre em dígitos)
  e os dois `e.cnpj === CNPJ_ESCRITORIO` (o CNPJ já chega normalizado ali).
- **🚨 SETE ROTAS SEM BOTÃO — E O PAULO MANDOU DAR BOTÃO A TODAS** (22/08:
  *"sim, todas com botao, e NFP tbm deve ser corrigido"*). A varredura de
  `rotaTemChamada` (a trava de 13/08 virada em CLASSE) leu as 273 rotas do
  backend e achou sete grupos que **nenhuma tela chama** — código morto com cara
  de entrega. A 1ª leva a fechar foi a **MANIFESTAÇÃO**, que é a mais cara:
  sem Ciência a SEFAZ não entrega o XML COMPLETO, então resumo preso na fila é
  **livro a menor** — e o app só tinha o botão do LOTE, que passa por cima da
  chave que trava.
  ✂️ Card **🔎 Fila da manifestação** no Diagnóstico da captura (admin), com as
  três: **🔎 Ver fila** (`/manifest-elegiveis` — quem está esperando, com o
  recorte DIZENDO "1 de N", que é a régua do farol honesto), **📨 Manifestar**
  (`/manifest-one`, por LINHA) e **🔧 Destravar falhas de infraestrutura**
  (`/manifest-reset-falhas-infra`).
  ⚠️ **TRÊS TRAVAS, e as três são de linguagem**: (1) manifestar **PERGUNTA
  antes** — evento na SEFAZ não se desfaz, e botão por linha é clique fácil;
  (2) **fila vazia não é "não há pendência"** — chave em cooldown ou com falhas
  seguidas fica FORA da fila, e o texto diz isso (senão o vazio vira prova de
  que está tudo capturado, que é a mentira do "0 de 388"); (3) o 🔧 diz que só
  volta o que falhou por **INFRAESTRUTURA** — recusa da SEFAZ por mérito
  continua fora, e prometer o contrário faria alguém clicar esperando
  ressuscitar nota que a SEFAZ recusou por regra.
  📌 **A PROVA É POR RENDER, NUNCA POR VARREDURA DE FONTE** — a lição de 20/08
  (o campo do cérebro do CFOP que a varredura dizia estar certo e o dedo do
  Paulo não achava): `filaManifestacaoBotoes.test.tsx` monta o card, clica e
  lê o que aparece. 🐛 E ele pegou um detalhe que só existe no DOM: o "não" do
  texto vai em `<strong>`, então o parágrafo é **partido em três nós** e regex
  que atravessa a fronteira nunca casa — quem responde é o `textContent`.
  ✂️ **2ª LEVA — NFP, prévia do resumo e o FREIO DE EMISSÃO**, os três com o
  mesmo desenho (o botão nasce ONDE a dúvida nasce, régua do card CFOP de
  18/08):
  🔹 **NFP** (*"e NFP tbm deve ser corrigido"*): `/situacao-fiscal`,
  `/divida-ativa` e `/cnds-publicas` existiam e a tela só chamava
  `/analise-completa` — que é um `allSettled` de **CINCO** consultas. Quando UMA
  caía (SERPRO fora, timeout do portal), ou se refazia a varredura inteira
  **queimando quota PAGA** nas quatro que já tinham dado certo, ou se ficava sem
  o pedaço. Card **🔎 Consultas avulsas** na aba Análise, dizendo (a) que é
  **consulta pura, não grava** — senão a pessoa vê o número e conclui que ele
  entrou no plano de ação —, (b) **qual clique gasta quota** (SERPRO × portal
  público) e (c) que resultado vazio **não prova** ausência de débito.
  🔹 **`/previa-resumo`**: conferir os números do resumo diário exigia
  **disparar o e-mail de verdade** — conferir e enviar eram a MESMA ação, e quem
  só queria ver o número enchia a própria caixa. Nasceu o **👁 Prévia (não
  envia)** ao lado do ✉️ Testar, com a diferença escrita entre os dois.
  🔹 **`/guard-status`**: o comentário da rota dizia *"admin vê quais tipos
  estão bloqueados sem precisar abrir o Cloud Run"* — e o caminho para ver
  **nunca existiu**. Com o freio ligado, quem emite leva **HTTP 423** com uma
  frase que parece defeito do app. Banner no topo da Central de Emissões:
  bloqueado sai VERMELHO **com a env var que destrava na frase** (trava sem
  caminho é trava que a equipe contorna), liberado sai numa linha discreta
  (alarme permanente em estado normal ensina a ignorar alarme) e **falha ao
  consultar NÃO vira "liberado"** — diz que não conferiu.
  ✅ **3ª LEVA — AS DUAS DO CRON FECHARAM, e a régua aqui é a da PORTA**:
  `/sincronizar-uma` e `/sync-targeted` são autenticadas pelo **segredo do
  cron**, que **nunca** vai ao navegador (ele já vazou 2× em cola de terminal).
  Botão exige porta de ADMIN — o desenho do 🚚 CT-e.
  🔹 **`/sincronizar-uma` não precisou de rota nova**: ela é a MESMA operação de
  `/sincronizar` (admin), que já existia — o buraco era só o BOTÃO. A Caixa
  Postal só tinha *"Sincronizar Todas"*, ou seja, conferir a caixa de UM cliente
  exigia disparar as 213. Nasceu o **🔄 Só esta empresa** no detalhe da
  mensagem; a rota do cron fica declarada como smoke test do Scheduler.
  🔹 **`/sync-targeted` ganhou a irmã `/sync-targeted-now`** (admin, em
  background pelo MESMO `withCronHeartbeat` do cron) + card **🎯 Captura
  dirigida**. ⚠️ **O laço é UM SÓ** (`executarSyncDirigido`) e a varredura prova:
  duas portas com dois laços divergiriam no **respiro de 90s**, que é o que
  evita o **cStat 656** da SEFAZ — e divergiriam em silêncio. A régua da lista
  saiu para o módulo PURO `cnpjs-dirigidos.js` porque `sync-routes.js` puxa
  firebase-admin e **não carrega no jest** (régua dentro de rota é régua sem
  prova).
  ⚠️ **E a tela responde "COMEÇOU", nunca "capturou"** — 90s × N corre em
  background, com o tempo estimado DITO antes do clique (rodada de 45 min sem
  aviso é lida como "travou") e teto de 30 CNPJs **recusado com o número**, não
  cortado calado. CNPJ que não é cliente volta NOMEADO em `naoEncontrados`:
  sumir faria "processadas: 3" passar por "as 5 rodaram".
  📌 **AS SETE FECHARAM NO MESMO DIA** — e a lista de exceções da varredura
  encolheu de 29 para 21, com o que sobra sendo cron/túnel/agente de verdade.
- **🚨 A VARREDURA DOS LEITORES DE DOCUMENTO ACHOU TRÊS DEFEITOS QUE NINGUÉM
  TINHA VISTO** (21/08, à noite — Paulo: *"pode varrer a noite toda"*). Depois
  de fechar a classe da FICHA, apliquei o mesmo método ao DOCUMENTO: levantar os
  donos (`docCancelado`, `modeloDoDoc`, `direcaoEfetivaDoc`,
  `normalizarParticipantesDoc`, `valorDoDocumentoServico`) e varrer quem lê o
  campo cru. **162 ocorrências, 3 defeitos reais** — o resto é domínio onde o
  campo NÃO mente (tarefa cancelada, NFS-e do ADN) ou comentário sobre a
  correção antiga. Triagem por RISCO, nunca correção cega.
  🔴 **(1) O CRÉDITO ACUMULADO lia dois conjuntos de documentos ao mesmo
  tempo.** `detectarHipotesesArt71` tinha as MESMAS duas leituras cruas que
  zeraram a apuração da PS VIDROS (`status !== 'autorizado'` + `String(modelo)`)
  enquanto `apurarCompetencia`, ao lado, já usava a régua. Efeito PERVERSO: em
  toda empresa de captura automática a detecção lia **ZERO itens**, então a
  empresa aparecia credora todo mês e **sem hipótese legal** — indo para o balde
  *"provavelmente falta saída na captura"* quando podia ser **exportadora
  legítima**. Num painel que decide se o cliente abre processo no e-CredAc.
  🔴 **(2) O BLOCO A perguntava pelas DUAS formas mais raras.**
  `filtrarNotasBlocoA` testava `n.tipo === 'NFSe'` e `String(n.modelo) ===
  'NFSE'` — e a NFS-e do portal de SP entra por CSV/TXT gravando
  `prestador`/`tomador`, a do ADN grava `tipoDoc`. Documento desses trilhos
  **sumia do bloco A**, e sumir do bloco A é sumir da apuração de PIS/COFINS.
  ✂️ Nasceu `ehNotaDeServico` na seleção (o irmão que faltava de
  `ehNotaDeMercadoria`/`ehConhecimentoDeTransporte`). ⚠️ **NÃO é a
  `ehDocumentoDeServico` do FUNRURAL**: aquela responde *"é serviço?"* e o CT-e
  É — mas o CT-e vai ao bloco **D**. Trocar uma pela outra mandaria todo
  conhecimento de transporte para o bloco errado. 🐛 E o teste pegou um defeito
  MEU antes de subir: escrevi `/NFS?e/`, e o `?` faz **"NFe"** casar — nota de
  MERCADORIA entrando no bloco A.
  🔴 **(3) O PIOR: o BLOCO D saía com VL_DOC 0,00 em TODO CT-e capturado** — e
  não tinha **um único teste**. Ele lia `nota.valor || nota.totalNota` e o
  importer grava **`valorTotal`** (o CT-e traz `<vTPrest>`): nenhuma das duas
  formas existe no documento capturado. É o MESMO defeito que zerou o M200 da
  MANTOAN em 17/08 — corrigido no bloco A e **deixado vivo no D**, com o
  crédito de PIS/COFINS do FRETE indo a zero. Junto vinham a direção crua e o
  participante só aninhado: as três leituras num bloco só.
  📌 **D100 entrou em `DETALHES_VIGIADOS`** (a regra de 06/08 — só o D190
  estava lá, e por isso a auditoria não teve o que olhar), e CT-e sem valor em
  forma nenhuma agora sai **NOMEADO**, nunca como zero.
  🚩 **PENDÊNCIA NOMEADA, NÃO CONSERTADA**: o leiaute do D100 do
  EFD-Contribuições **não está provado** — o gerador monta 20 campos onde o Guia
  lista 23, e o valor cai na casa do `TP_CT-e`. O teste pergunta pelo VALOR, não
  pela POSIÇÃO, de propósito: travar a posição atual carimbaria de PROVADO um
  leiaute deduzido. Fecha com um EFD-Contribuições **aceito que tenha bloco D**.
  🔴 **(6) A CONFERÊNCIA DO SAGE VALIDAVA UM CFOP E O ARQUIVO GRAVAVA OUTRO.**
  `cfopParaEscriturar` recebe o DOCUMENTO como 4º argumento porque o CFOP
  informado na NF (✏️ CFOP por nota) vence o override e a régua automática — o
  Exportar SAGE passa, e o **preflight não passava**. É a família da "réplica de
  CFOP no modal" (12/08), e a régua da casa é dura: *conferência que promete
  número diferente do arquivo é pior que não ter tela*.
  🔴 **(7) O D190 CRAVAVA CFOP `'5352'` EM 100% DOS CONHECIMENTOS.** A captura
  só lia o CFOP de dentro de `<prod>` — e o **CT-e o traz no CABEÇALHO**
  (`<ide><CFOP>`), então `nota.cfop` era sempre vazio e o default entrava.
  Cravar ali AFIRMA a natureza da operação de transporte, num campo que a
  fiscalização lê: é o 'PARTSEM' de novo. ✂️ O importer passou a capturar
  CFOP/CST do cabeçalho, o D190 os lê, e o CFOP passa pela **mesma correlação
  do C190** (o CT-e traz o código do TRANSPORTADOR — 5352 — e quem TOMA o frete
  escritura 1352). CT-e sem CFOP legível **não entra** e sai NOMEADO, com a
  ação (♻️), em vez de entrar com natureza inventada.
  🔴 **(8) O `COD_SIT` TINHA DUAS RÉGUAS — e a do bloco D declarava REGIME
  ESPECIAL por default.** `statusParaCodSit` existia nos dois geradores: o C
  mandava '00' (regular) para status desconhecido e o D mandava **'08'**, que
  significa *"documento emitido por regime especial ou norma específica"* e tem
  regras PRÓPRIAS de preenchimento (Exceção 4). A tabela é a MESMA para C100 e
  D100. ✂️ `codSitDoDocumento` virou dona (na seleção), e as duas cópias foram
  **deletadas** — código morto é a isca para alguém reativar a régua velha.
  🐛 **E o teste da régua nova pegou um defeito PRÉ-EXISTENTE do bloco C**: ele
  perguntava `docCancelado` ANTES do status, e `docCancelado` trata
  denegado/inutilizado como cancelamento (para efeito de "não conta no livro",
  que é o uso dela) — então a nota **DENEGADA saía com COD_SIT 02** em vez de
  **04**. São fatos diferentes: denegada é a SEFAZ RECUSANDO a autorização (a
  nota nunca valeu); cancelada é a nota que existiu e foi cancelada. Agora o
  status específico vem primeiro e o `docCancelado` só decide o caso que ele
  existe para resolver — o cancelamento por EVENTO, em que o status continua
  'autorizado'.
  📌 **REGRA QUE FICA: bloco/gerador sem teste é bloco sem prova** — o D era o
  único do EFD-Contribuições sem nenhum, e era justamente onde estavam três
  defeitos de uma vez. E **default de campo fiscal é invenção com outro nome**:
  'PARTSEM', '5352', '000', '08' e o COD_GEN '00' saíram todos da mesma cabeça
  — cinco dos oito achados da noite eram exatamente isso.
  🔴 **(9) E A 5ª LEVA ACHOU O DEFAULT DENTRO DO BLOCO 0 — o `TIPO_ITEM` saía
  '00' (MERCADORIA PARA REVENDA) em TODO item, inclusive no item SINTÉTICO de
  SERVIÇO.** O `SERV-GENERICO` existe justamente porque o documento é uma NFS-e
  sem discriminação, e o 0200 dele declarava mercadoria — com **NCM
  `00000000`** ao lado, que é NCM FABRICADO. O Guia 3.2.3 é literal nos dois
  pontos: o serviço *"deverá ser criado o correspondente item no registro 0200,
  cujo conteúdo do campo TIPO_ITEM será igual '09' (Serviços)"*, e o campo 08 —
  *"Não existe COD-NCM para serviços"*. ✂️ `tipoItemDoDocumento` (na seleção,
  lida pelos DOIS orquestradores) + NCM vazio no item de serviço.
  ⚠️ **O QUE A RÉGUA SE RECUSA A FAZER**: adivinhar o tipo da MERCADORIA. Numa
  indústria, matéria-prima é 01 e produto acabado é 04 — e **isso não está no
  XML** (é o caso KALUNGA do CFOP, um campo adiante). Mercadoria continua '00',
  pendência NOMEADA no código, porque deduzir pelo ramo produziria o 1405 num
  campo que o Bloco K cruza. A trava é por VARREDURA: `tipo: '00'` cravado na
  coleta quebra a build.
  🔴 **(10) O `IND_NAT_PJ` ERA LIDO DE UM CADASTRO QUE NÃO EXISTIA.** O 0000 do
  EFD-Contribuições escrevia `df.indNatPJ || '00'` — e `indNatPJ` **não estava
  na whitelist nem em tela nenhuma**: caía no '00' SEMPRE, que declara
  *sociedade empresária em geral*. É a "rota sem botão" (13/08) na versão
  CAMPO, e o arquivo afirmava isso à Receita todo mês — inclusive na igreja do
  caso de 18/08, que é o cliente que fez o módulo de regime nascer.
  ⚠️ **O APP NÃO ESCOLHE O CÓDIGO** (Tabela 3.1.3, oficial, fora deste repo —
  mesma disciplina do 0002 e do código 9 do ISS fixo). O que mudou é o
  SILÊNCIO: campo no modal + whitelist no MESMO PR (#382), e quando o cadastro
  diz IMUNE/ISENTA ou sem fins lucrativos o '00' sai **DITO**, com o lugar de
  preencher. Empresa comum não ganha aviso — alarme sem ação é o que ensina a
  equipe a ignorar alarme.
  🔴 **(11) E O `SER` INVENTAVA SÉRIE 1**: o bloco D (nos DOIS arquivos) escrevia
  `nota.serie || '1'`. A série é um campo que o **PVA confere CONTRA A CHAVE**
  (recusa de 20/08 na PWR), e a chave a carrega nas posições **23-25** — do
  lado do modelo (21-22) e do número (26-34), que a casa já lê. ✂️
  `serieDoDocumento`: campo gravado > chave > '000' (o Guia manda 000 quando
  não há série). O C100 também parou de mandar '000' quando a chave diz outra
  coisa.
  🔴 **(12) E O C100 DO EFD-CONTRIBUIÇÕES LIA O PARTICIPANTE SÓ NA FORMA
  ANINHADA** — o mesmo defeito de 17/08 (37 A100 da MANTOAN com COD_PART
  VAZIO), vivo um bloco adiante e justamente no arquivo que a PWR ainda tem de
  regerar: em toda nota capturada automaticamente (achatada, `cnpjEmit`) o
  participante saía VAZIO — e participante vazio no C100 é recusa do PVA. Junto
  vinham a direção crua e o `IND_EMIT` pela direção, com a nota PRÓPRIA de
  entrada saindo como "terceiros". ✂️ Passou a usar os DONOS
  (`normalizarParticipantesDoc` + `direcaoEfetivaDoc` + `participanteDoDocumento`
  + `ehEmissaoPropriaDoc`), e o coletor do **0150 usa o MESMO dono** — senão o
  C100 referencia participante que a Tabela de Cadastro não tem.
  ⚠️ **E SÓ O IND_EMIT: a Exceção 2 do Guia do ICMS/IPI ("emissão própria não
  leva C170") NÃO VALE AQUI** — no EFD-Contribuições o C170 é quem carrega o
  detalhe de PIS/COFINS do item, e o arquivo ACEITO da PWR (03/2026) tem C170
  nas notas próprias. Portar a régua inteira do arquivo vizinho apagaria a
  apuração; travado por teste.
  🔴 **(13) E O ICMS-ST IA PARA O ESTADO ERRADO — a UF de destino era lida só na
  forma ANINHADA.** `agruparStPorUf` lia `destinatario.uf` e o importer grava
  **`ufDest` ACHATADO**: em toda nota capturada a UF vinha vazia e caía no
  **`ufEmpresa`**. O E200/E210 é **POR UF de destino e cada UF é uma GNRE** —
  o ST retido para MG/PR/RJ era apurado como se fosse do próprio estado, ou
  seja recolhimento no estado errado, calado. ✂️ Dono `ufDoDestinatarioDoc`
  (no `participante-doc-helper`), e **`ufEmpresa` deixou de ser default**:
  documento sem UF legível sai NOMEADO, com o número e a ação.
  ⚠️ **E ELE NÃO PASSA PELO `normalizarParticipantesDoc`, de propósito**: aquele
  dono decide o lado pela IDENTIDADE (nome/CNPJ), então `destinatario: {uf:'MG'}`
  — sem nome e sem documento, que é como a venda de balcão chega — é DESCARTADO
  por ele e a UF se perde. Foi o teste que mostrou isso, na primeira tentativa
  de reusar o dono errado: **régua única é o dono da MESMA pergunta**, não o
  dono mais próximo.
  🔴 **(14) E A VARREDURA DO CANCELAMENTO SÓ VIA METADE DAS CÓPIAS.** A trava de
  17/08 acusa `status === 'cancelado'`; metade das cópias não se escreve assim
  — elas montam uma **LISTA de rótulos** (`['cancelado','cancelada','denegado',
  'inutilizado']`) e perguntam com `.has`/`.includes`. Mesma régua, outra roupa,
  e o mesmo defeito: **nenhum desses rótulos aparece quando o cancelamento chega
  por EVENTO**. Estava viva onde muda DINHEIRO — **FUNRURAL/DIPAM** (imposto
  sobre nota cancelada, na direção mais cara), **DIFAL de aquisição** e a rota
  dele (imposto A PAGAR sobre compra que não existiu) e o **índice do CIAP** (que
  decide quanto do crédito do imobilizado entra no mês). O C197 do DIFAL e o
  bloco G liam também a DIREÇÃO crua.
  ✂️ Os quatro passaram por `docCancelado`, as constantes mortas foram
  **DELETADAS** (código morto é a isca para reativar a régua velha) e a
  varredura ganhou a **segunda assinatura**, com as exceções declaradas COM o
  motivo — quase todas a mesma: **NFS-e não tem evento, ali o campo é a fonte**.
  🔴 **(15) E O ÍNDICE DO CIAP PULAVA A NOTA IMPORTADA PELO NAVEGADOR.** O
  `xmlParserService` (import manual) grava **só `totais.vNF`** — **nunca**
  `valorTotal` —, e `classificarSaidasCiap` lia `valores.total ?? valorTotal`:
  a nota caía como se valesse **zero**. Efeito PERVERSO: denominador menor ⇒
  **índice MAIOR** ⇒ mais crédito de ICMS do imobilizado do que a lei dá (LC
  87/96 art. 20 §5º). Zero silencioso na direção mais cara, pela 15ª vez.
  ✂️ `valorDoDocumentoServico` virou **`valorDoDocumento`** — a pergunta
  ("quanto vale este documento?") nunca foi específica de serviço — com as duas
  formas que faltavam (`valores.total` e `vNF` na raiz); o nome antigo continua
  exportado apontando para a MESMA função. ⚠️ **`valores.liquido` fica FORA de
  propósito**: na NFS-e ele é o líquido de RETENÇÕES, e o VL_DOC é o bruto.
  ⚠️ **E O MESMO ZERO APARECIA NA CONFERÊNCIA**: o cruzamento CFI × SPED (e os
  três painéis de diagnóstico) liam `valorTotal ?? vNF` na mão — a nota
  importada pelo navegador entrava valendo 0,00 e o cruzamento acusava
  **divergência de valor contra um SPED CERTO**. Alarme falso que aparece
  justamente quando está tudo certo é o que ensina a equipe a ignorar a
  conferência que existe para pegar o erro de verdade. Os quatro leem o dono.
  🔴 **(16) E O E110 SOMAVA A NOTA PRÓPRIA DE ENTRADA COMO DÉBITO.**
  `somarImpostoPorDirecao` é quem soma o **débito e o crédito de ICMS do E110**
  e o **IPI do E520** — duas leituras cruas dessa MESMA linha já tinham sido
  corrigidas em 19/08 (o status e o modelo), e a TERCEIRA, a **direção**, ficou.
  A nota do art. 136 (tpNF=0) fica gravada como 'saida' até o backfill passar:
  o ICMS dela entrava como DÉBITO em vez de CRÉDITO — imposto a maior nas DUAS
  pontas, e é o caso que a NOVA ERA e a EDUARDO GUERRA têm às dezenas por mês.
  📌 **LIÇÃO: linha que já teve duas correções merece a varredura INTEIRA** —
  eu tinha consertado dois campos ali e não perguntei quantos mais liam cru.
  🔴 **(17) E A VARREDURA NOVA — "campo que o gerador LÊ e ninguém pode
  preencher" — ACHOU MAIS TRÊS.** O eixo nasceu do `IND_NAT_PJ` e virou script:
  cruzar todo `dadosFiscais.X` lido no backend contra a whitelist de gravação.
  **`icmsCodRec` e `icmsDiaVencimento`** (o E116, que é a obrigação do ICMS **a
  recolher**) eram lidos com o comentário *"sobrescritível via dadosFiscais"* e
  não estavam na whitelist nem em tela: a régua caía SEMPRE no default — **dia
  20, que é o de SP**, num campo que é DATA DE PAGAMENTO e varia por UF e pelo
  CPR do contribuinte. E **`regimeApuracaoPisCofins`**, que é o único jeito de
  declarar o regime **'3 — ambos'** (a derivação pelo regime tributário só sabe
  1 e 2). Os três entraram na whitelist + modal no MESMO PR, e o default do
  E116 passou a sair **DITO**; UF sem código de receita cadastrado sai com o
  campo **VAZIO** e nomeada — código estadual não se inventa.
  🔴 **(18) E A VARREDURA GANHOU UM SEGUNDO CRUZAMENTO — "o gerador lê × o
  orquestrador passa" — que achou DOIS CADASTROS INEXISTENTES.** É o defeito do
  `saldoCredorIpiAnterior` (19/08, PWR) virado script. O **E250** (a guia do
  ICMS-ST) lia `obrigacoesStPorUf` e **nenhum orquestrador passava**: o registro
  NUNCA saiu. O **C197** do DIFAL lia `difalCodigoAjusteC197`, que o
  orquestrador passava e **nenhuma tela gravava**. Nos dois, o aviso mandava
  *"informe no cadastro"* — e o cadastro não existia em tela nenhuma.
  📌 **Mensagem que manda a pessoa a um lugar inexistente é PIOR que silêncio**:
  ela procura, não acha e conclui que o app está quebrado.
  ✂️ Os dois ganharam casa na aba **Ajustes E111** (que já era dona daquele
  documento — o mesmo desenho que o código do C197 já previa), o orquestrador
  passou a ler o ST, e os dois avisos passaram a dizer **ONDE**.
  ⚠️ **E A GRAVAÇÃO VIROU MERGE**: o doc `sped_ajustes_apuracao` tem TRÊS donos
  (ajustes do E111, código do C197, obrigações de ST). O `setDoc` sem merge
  apagaria o que o outro gravou — calado, que é o pior jeito de perder um
  código de tabela estadual que alguém digitou.
  ⚠️ O app **continua não deduzindo** nenhum dos dois: vencimento e código de
  receita da GNRE e o COD_AJ da 5.3 são ESTADUAIS.
  🔴 **(19) E A VARREDURA INVERSA — "a tela grava × ninguém lê" — pegou o
  `IND_PERFIL`.** O modal tinha o campo de PERFIL do EFD desde sempre: a pessoa
  escolhia, salvava, e o 0000 saía com **'A' cravado** (o comentário dizia
  *"perfil EFD: sempre A"*). O perfil é atribuído pelo **fisco estadual** e
  decide QUAIS REGISTROS o arquivo deve ter — declarar A num contribuinte B faz
  o arquivo prometer detalhamento que o PVA vai cobrar, a MESMA família da
  recusa *"O registro não deve ser informado para esse PERFIL"* da AFFITTARE.
  Com a agravante do **trabalho perdido**: o colaborador preenchia e nada
  acontecia. Perfil fora de A/B/C é RECUSADO com o motivo, e perfil ≠ A sai
  DITO no aviso.
  🔴 **(20) E TRÊS RECUSAS DO PVA TINHAM SIDO APRENDIDAS E NUNCA VIRARAM
  REGRA.** A régua da casa é *"recusa aprendida entra na prevalidação no MESMO
  PR"* — o EFD ICMS/IPI tem 15 regras assim, e o EFD-**Contribuições** tinha
  DUAS. As três estavam corrigidas **só no gerador**: **COD_ITEM vazio no
  A170/C170** (MANTOAN, 36 recusas — e as 2 de M205/M605 eram consequência),
  **IND_ORIG_CRED vazio em item de ENTRADA** (MANTOAN, 3 recusas: *"campo
  obrigatório para notas fiscais de entrada"* — quem manda é a DIREÇÃO, não o
  CST) e **M200/M600 × Σ F600** (HS PROJETOS: *"VL_RET_CUM maior que o
  somatório dos F600"*).
  📌 **Consertar o gerador fecha a INSTÂNCIA; a regra fecha a CLASSE** — sem ela
  a próxima empresa gasta uma volta de PVA descobrindo o mesmo, que é
  exatamente o "vai e vem o dia todo" de 20/08.
  ⚠️ E a do bloco M diz os DOIS números de propósito: em 19/08 o sintoma do PVA
  apontou o M200 (que estava certo) quando o vazio era o F600.
  📌 **(21) E A CLASSE DO ACHADO 18 VIROU TRAVA: "aviso que aponta um lugar
  tem de apontar um lugar que a pessoa ACHA".** Varrendo os 61 avisos que
  mandam preencher algo, sobraram QUATRO com o mesmo vício em forma mais leve —
  apontar a **chave do banco** (*"preencha em `dadosFiscais.uf`"*, nos DOIS
  orquestradores de captura) ou lugar nenhum (*"informe a contagem física"*).
  O colaborador não sabe o que é `dadosFiscais`; ele sabe o que é o botão
  **Dados Fiscais**. `avisoApontaLugarReal.test.ts` barra caminho de campo do
  Firestore dentro de mensagem de usuário — e foi ela que achou a quarta, que
  eu não tinha visto.
  📌 **(22) E A REGRA DE 13/08 — "rota sem botão não é funcionalidade, é código
  morto com cara de entrega" — GANHOU TRAVA.** Ela estava escrita e nunca tinha
  varredura. `rotaTemChamada.test.ts` cruza as **273 rotas** do backend contra
  as chamadas do frontend: rota nova sem caminho na interface quebra a build, a
  menos que seja declarada COM o motivo (cron do Scheduler, túnel de app irmão,
  agente `cfi-a3`). Provada criando uma rota órfã de propósito.
  🚩 **E o retrato de hoje tem SETE órfãs de verdade**, agora NOMEADAS na
  própria lista: `/manifest-one` (manifestar UM documento — a tela só tem o
  lote), `/manifest-elegiveis`, `/manifest-reset-falhas-infra`,
  `/sincronizar-uma`, `/sync-targeted`, `/previa-resumo`, `/guard-status`, mais
  três do NFP (`/situacao-fiscal`, `/divida-ativa`, `/cnds-publicas` — a tela só
  chama `/analise-completa`). **Não apaguei nenhuma**: remover rota que talvez
  alguém chame por fora é decisão do Paulo. Nomear já impede que a próxima
  sessão as leia como entrega pronta.
  🔴 **(23) E A VARREDURA DAS COLEÇÕES ACHOU UM DIAGNÓSTICO QUE MENTIA PARA
  TODA EMPRESA.** O checklist do ABRASF lia
  `db.collection('sefaz_certificados_empresa')` — coleção que **NENHUM ponto do
  app escreve** (o cadastro de certificado é `empresas_certificados`, usado pela
  captura, pelo cron de alerta e pelo túnel). A leitura devolvia SEMPRE vazio,
  então o item *"Certificado A1 cadastrado"* saía **NÃO** para todas, inclusive
  as que têm um válido. É o defeito da ficha lida de `lucro_fichas` (19/08, que
  deixou o saldo de IPI em 0,00 para sempre): **consulta que só devolve vazio é
  indistinguível de "não tem"**.
  📌 **E O CAMINHO ATÉ ELE FOI O CATÁLOGO**: a regra de 31/07 manda toda coleção
  ter dono declarado em `catalogo-banco.js`, e o painel Sistema→Banco denuncia a
  órfã — só que em TEMPO DE EXECUÇÃO e só para quem o abre (é dev-only). **Sete
  coleções viviam invisíveis** (cursor e lock do CT-e, estado do ABRASF, as duas
  auditorias da DCTFWeb, a sonda do PGDAS, o log de bloqueio por horário) e a
  oitava era esta, que nem existe. As sete entraram no catálogo e
  `catalogoBancoCompleto` fecha a classe: `.collection('x')` sem linha no
  catálogo quebra a build. Provada criando uma coleção órfã de propósito.
  🐛 **E A TRAVA NASCEU COM O MESMO VÍCIO QUE ELA DENUNCIA — pego uma hora
  depois, pela varredura INVERSA.** Ela lia só `sefaz-backend/` e só a forma
  `.collection('x')`: escapavam o **`server.js` da RAIZ** (onde mora o histórico
  de envios de DAS) e a coleção citada por **CAMINHO** (`const STATE_DOC =
  'sefaz_xml_email_state/estado'`, o cofre de e-mail). É a "trava escrita como
  LISTA" (13/08) na minha própria trava. ⚠️ E a 1ª tentativa de cobrir o caminho
  usou regex LARGO e acusou `application/json` e prefixo de rota — **teste que
  grita sem motivo é teste desligado**, então a assinatura ficou estreita
  (`.doc('x/y')` ou constante `*_DOC`/`*_PATH`). As duas extensões provadas
  quebrando de propósito.
  🔴 **(4) E A VARREDURA ACHOU UM DEFEITO QUE EU TINHA CRIADO DE MANHÃ**: ao
  corrigir o `IND_EMIT` da nota PRÓPRIA DE ENTRADA para '0', deixei a decisão
  do **C170** lendo `direcao === 'saida'` — o arquivo passou a dizer "emissão
  própria" **e** mandar C170 na mesma nota. O Guia 3.2.3, C100, **Exceção 2** é
  literal (*"NF-e de emissão própria: … somente os registros C100 e C190"*) e o
  EFD **aceito** da REALITY prova: as duas notas de importação têm **ZERO**
  C170. ✂️ `ehEmissaoPropriaDoc` virou o dono de TRÊS decisões que têm que
  concordar — o IND_EMIT, a existência do C170 e a coleta de itens do **0200**
  (item de nota sem C170 no 0200 vira item ÓRFÃO, outra recusa).
  🔴 **(5) O BLOCO D DO EFD ICMS/IPI INVENTAVA PARTICIPANTE.** Ele lia
  `nota.emitente?.cnpj` — a régua monta `.cnpjCpf` e a captura grava
  `cnpjEmit`: **nenhuma das duas** era lida, então o `IND_EMIT` saía sempre '1'
  e o `COD_PART` caía no literal **`'PARTSEM'`** — participante FABRICADO, que
  o 0150 nunca teria. Junto: VL_DOC e VL_OPR zerados (mesma causa do bloco D do
  Contribuições), COD_SIT sem o cancelamento por evento e IND_OPER pela direção
  crua. **Cinco leituras num registro só.** Agora sem participante legível o
  campo sai **VAZIO** — ausência não se inventa.
  ✂️ A régua do VALOR mudou de casa no mesmo PR: `valorDoDocumentoServico` saiu
  do bloco A do Contribuições para o `xml-metadata-helper` (dono das leituras
  de documento), porque os DOIS blocos D a leem; o arquivo antigo re-exporta
  (mesmo desenho do `decidirGravacaoNFe`).
  📌 **REGRA QUE FICA: bloco/gerador sem teste é bloco sem prova** — o D era o
  único do EFD-Contribuições sem nenhum, e era justamente onde estavam três
  defeitos de uma vez.
- **🚨 A FICHA SE LÊ PELA RÉGUA, NUNCA POR `===` — e a varredura achou MAIS
  QUATRO leitores quebrados** (21/08, à noite, depois do F550). O defeito da
  AFFITTARE tinha DUAS metades: os CAMPOS (forma do input × forma gravada,
  corrigida na hora) e a COMPETÊNCIA. `mesReferencia` aparece em `YYYY-MM`,
  `YYYY-MM-DD` e `MM/YYYY` conforme a época do lançamento, e **igualdade
  estrita não devolve erro: devolve NADA** — indistinguível de "a ficha não foi
  lançada". Varrendo os leitores, quatro comparavam na mão: a **Rotina do Mês**
  (diria "sem apuração" com a ficha lançada), o **saldo credor do SPED Fiscal**,
  o **Lote DARE** (empresa sumindo do lote sem dizer por quê) e a **emissão de
  DARF** (`taxEmissionService`, mensal E trimestral) — mais a cópia que **EU
  criei no PR do F550 horas antes**, normalizando inline em vez de usar o dono.
  ✂️ Dono único `acharFichaCompetencia` (+ `fichasDasCompetencias` para o
  trimestral, que precisa de 3 meses) em `ipi-varredura.js`, e a régua entrou
  em `REGUAS_VIGIADAS` — a assinatura barra `mesReferencia ===` fora do dono.
  **Provada revertendo um leitor de propósito.** Exceções declaradas COM o
  motivo: dedup na GRAVAÇÃO e merge de cadastros comparam ficha com ficha da
  MESMA origem, não competência vinda de fora.
  📌 **REGRA QUE FICA: leitor novo de FICHA passa pelo dono, igual ao leitor de
  DOCUMENTO** (`normalizarParticipantesDoc`, `docCancelado`, `modeloDoDoc`). A
  ficha era o único lado sem trava — em 13 mordidas da armadilha das duas
  formas, essa foi a primeira que fechou a CLASSE em vez da instância.
- **🚨 A TELA QUE VÊ A RESPOSTA E NÃO GRAVA — o 🔎 via o cStat 653 e o
  conhecimento EVAPORAVA** (21/08, MV LIDER 639, *"erro persistente"* — e
  ✅ **FECHADA NO MESMO DIA**: *"639 - MV LIDER - ok"*). O print mostrava a
  reconferência ANDANDO (102 → 82 nunca perguntadas — a correção de 20/08
  funcionou); o que persistia era outra coisa: em 18/08 o Paulo consultou as
  chaves suspeitas no 🔎 Consultar NFe por chave, a SEFAZ confirmou o
  cancelamento (653)… e a rota **não gravava nada** — rota de diagnóstico que
  VÊ o fato e não carimba é a família da "rota sem gravação". A reconferência
  teve que redescobrir as mesmas canceladas a ~20 consultas/hora, porque a
  SEFAZ pausa com 656 (limite DELA, não do app).
  ✂️ A gravação virou ÚNICA (`cancelamento-gravacao.js`): reconferência e 🔎
  escrevem o MESMO evento + carimbo; o 🔎 **só carimba documento que JÁ existe
  na base** (id = chave — consulta de chave alheia continua só consulta) e a
  tela DIZ o que gravou ("✓ cancelamento GRAVADO"). ⚠️ E os dois números da
  mesma tela discordavam por TEMPO, não por régua: o texto da rodada dizia o
  "nunca perguntadas" de ANTES (102) com o cabeçalho já no DEPOIS (82) — o
  aviso passou a descontar a própria rodada ("Depois desta rodada, restam N").
  📌 **REGRA QUE FICA: número que aparece duas vezes na mesma tela sai do
  MESMO instante** — e resposta de órgão confirmando fato fiscal NUNCA fica só
  na tela de quem consultou.
- **🚨 CCM `00000000` VALE COMO VAZIO EM TODO LEITOR — a régua existia e
  faltava justo onde acusava** (21/08, caso LAV COMERCIO DE AUTOPECAS,
  colaboradora via Paulo: *"ali onde deveria colocar o de ccm de SP coloco uma
  sequência de 8 zeros"*). Os 8 zeros são contorno ANTIGO da equipe, de quando
  o campo parecia obrigatório; a regra "só-zeros = vazio" (#311) existia na
  GRAVAÇÃO e na captura de NFS-e — e a régua de PENDÊNCIAS não a conhecia,
  acusando *"CCM preenchido fora de SP capital"* sobre zeros que significam
  "não tem". ✂️ Dono único `soZerosComoVazio` (`empresaDadosFiscaisSanitize`):
  pendências usam, o `xmlFiscalService` perdeu a cópia local, e a rota do
  perfil parou de devolver os zeros pro modal (o campo aparece VAZIO, como o
  texto de ajuda sempre pediu). Na capital, zeros = **CCM FALTANDO** (a
  captura não roda com eles); fora dela, zeros não são nada. Os zeros já
  gravados **não precisam ser removidos um a um** — o app os ignora.
  ⚠️ No mesmo dia, a outra metade: a pendência afirmava "fora de SP capital"
  também com `codMunIBGE` VAZIO — ausência não é prova (régua da
  uf-desconhecida, 15/08); sem o código IBGE quem acusa é a pendência do
  próprio município.
- **🚨 O BLOCO E DE ST SAÍA COM 9 REGISTROS NUMA LINHA SÓ — módulo formando
  linha FORA do buildLine** (21/08, REALITY 0899 · 07/2026 — dúvida do
  colaborador com análise do Copilot; conferida contra os DOIS arquivos antes
  de concluir). `montarLinhasStBlocoE` devolvia strings com `join('|')` cru
  (sem o `|` inicial e sem `\r\n`) e o arquivo final é `join('')`: os
  E200/E210 de MG/PR/RJ/SP + o E500 saíram GRUDADOS na linha 2406 —
  invisíveis para o PVA, para o 9900 e para a PRÓPRIA prevalidação, que lê
  linha a linha (nem o E500 dela era visto). O módulo nunca tinha passado no
  PVA, e o próprio cabeçalho avisava. ✂️ As linhas viraram **ARRAYS de campos**
  formatados pelo blocoE com `fmt.buildLine` (o padrão do E111, escrito ao
  lado); **R15 da prevalidação fecha a CLASSE** (linha fora de `|REG|…|` é
  erro nomeado — módulo novo que bypassar o buildLine cai nela).
  ⚠️ **E A TRAVA MUDOU DE CASA no mesmo dia, porque cobria METADE**: a R15 vivia
  só na prevalidação do EFD ICMS/IPI, e o EFD-**Contribuições** usa o MESMO
  buildLine — o defeito é do MECANISMO, não do leiaute, então lá ele passaria
  calado. `linhasMalformadas` virou dono ÚNICO dentro de
  `sped-auditoria-saida.js`, que é quem roda em **todo arquivo gerado, nos
  dois**; a R15 passou a chamá-la e só traduz para a linguagem de recusa do
  PVA. 📌 **Trava nasce onde roda para TODOS os arquivos daquela família** —
  senão ela protege o cliente que já quebrou e deixa o próximo descoberto.
  ⚠️ **E o campo 11 do E210 era outra dedução minha errada**: `VL_SLD_DEV_
  ANT_ST` é o saldo devedor **ANTES das deduções** (apurado no mês), não o
  "anterior" do mês passado — corroborado pelo E210 do e-Fiscal ACEITO da
  mesma empresa (380,79 → 380,79 → 380,79; a conta 11−12=13 fecha). Dedução
  ganhou o TETO do devedor: excedente sai NOMEADO, nunca vira crédito a
  transportar.
  ✂️ No mesmo PR, dois defeitos irmãos que a comparação expôs: **IND_EMIT da
  nota PRÓPRIA de entrada saía '1' (terceiros) com COD_PART = a própria
  empresa** (a chave diz que quem emitiu foi ela; o e-Fiscal aceito declara
  `|C100|0|0|`) — a régua do "outro lado" virou ÚNICA
  (`participanteDoDocumento`, usada pelo buildC100 E pelo coletor do 0150,
  senão o C100 referenciaria participante que o 0150 não tem); e o **0200
  cravava COD_GEN '00' (= SERVIÇO) em toda mercadoria** — agora deriva do
  CAPÍTULO da NCM (48131000→48, corroborado pelo aceito) e sem NCM fica
  VAZIO, porque gênero não se afirma no escuro.
  🛑 **PAULO CORTOU O RESTO DA COMPARAÇÃO** (*"estamos corretos, pode
  desconsiderar"*): C120 da importação (nDI não capturado; Σ vPIS/vCOFINS dos
  itens bate centavo a centavo com o C120 do e-Fiscal, se um dia voltar),
  C191 do FCP, CEST/alíquota do 0200 e E300/E310 zerado **NÃO entraram — não
  ressuscitar sem pedido dele**. Só os três acima subiram, porque são defeitos
  do NOSSO arquivo, independentes do e-Fiscal.
- **🏛️ O CFI NUNCA TEVE CAMPO DE REGIME TRIBUTÁRIO — e uma IGREJA chegava ao
  CCI como "Lucro Presumido"** (Paulo, 18/08, com o print do cadastro do túnel:
  *"criamos no CCI que as informações de cadastro sejam compartilhadas do CFI…
  temos empresas Simples, Presumido, Real, isentas, imunes — devemos nos atentar
  às que são isentas/imunes e terceiro setor"*; e, ao ver o defeito de frente:
  *"é uma falta grave, como um sistema de apuração e tributos não tem campo de
  regime de tributação"*). A COMUNIDADE EVANGÉLICA SARA NOSSA TERRA aparecia
  como Lucro Presumido porque o regime era DEDUZIDO da COLEÇÃO em que a empresa
  foi cadastrada — não existia lugar nenhum para "imune". O caro não era o
  rótulo: era a HERANÇA — entidade imune apurando PIS/COFINS sobre FATURAMENTO
  quando, em regra, recolhe PIS sobre a FOLHA (Lei 9.532/97 art. 13).
  ✂️ `sefaz-backend/regime-tributario.js` — vocabulário único (SIMPLES ·
  LUCRO_PRESUMIDO · LUCRO_REAL · IMUNE · ISENTA), precedência **campo explícito
  > regimePadrao > COLEÇÃO** com a ORIGEM carimbada. A coleção fica por ÚLTIMO
  de propósito: ela responde "onde foi cadastrada", não "o que a empresa é".
  ⚠️ **DOIS EIXOS, NÃO UM**: "terceiro setor" (`semFinsLucrativos`) NÃO é
  regime — é a natureza da entidade, e CONVIVE com ele (templo é imune E sem
  fins lucrativos; associação pode ser isenta e ter atividade tributada).
  Juntar os dois numa lista só obrigaria a escolher entre fatos que coexistem.
  ⚠️ **O CAMPO `regime` DO TÚNEL NÃO MUDA DE SIGNIFICADO** (continua sendo a
  coleção, 'simples'/'lucro' — os apps irmãos já o consomem): o regime de
  verdade viaja em campos NOVOS (`regimeTributario`, `regimeOrigem`,
  `regimeApuracaoDefinida`, `regimeRessalva`). Campo entrou na whitelist de
  `dadosFiscais` no MESMO PR (lição do #382) e a gravação RECUSA valor fora do
  vocabulário, nunca descarta calada.
  🚨 **O QUE O MÓDULO SE RECUSOU A FAZER, POR ALGUMAS HORAS**: inventar a lista
  de obrigações da imune e da isenta — montá-la por dedução minha seria o erro
  do 1405 num lugar onde o custo é multa. Enquanto ninguém tinha decidido,
  IMUNE/ISENTA caíam em INDEFINIDO de propósito e recebiam só o comum aos dois
  regimes do Lucro — nunca a lista do Presumido em SILÊNCIO.
  ✅ **A LISTA VEIO DELE NO MESMO DIA, em três respostas**: ECD e ECF só com
  MOVIMENTO FINANCEIRO no ano; DCTFWeb só com EVENTO (aluguel, folha ou
  retenção); EFD-Contribuições **apenas em dezembro, sem movimento** — que por
  isso usa a MESMA régua de `frequencia: 'anual'` da DEFIS, não uma exceção
  nova. Cada entrada do catálogo carrega a FALA que a decidiu.
  🚩 **O FIM DE VIGÊNCIA DE 12/2026 É EXPECTATIVA, NÃO NORMA** (*"com a reforma
  estão indicando que essa obrigação encerra em 12/2026"*): "estão indicando"
  não é norma publicada, então o app CONTINUA gerando depois de 12/2026 e
  carrega a ressalva — parar por expectativa faria a obrigação sumir em
  silêncio, e sumir da tela é pior que aparecer com ressalva.
  ❌ **FGTS SAIU DA LISTA — segunda resposta dele, corrigindo uma extensão
  MINHA.** Eu tinha incluído FGTS como proposta (ele citou FOLHA entre os
  eventos da DCTFWeb, e FGTS é consequência de folha) e marquei para
  confirmar. Paulo: *"FGTS é um imposto gerado pelo departamento pessoal, não
  faz base para impostos gerados pelo CFI"* — mesmo havendo folha, o FGTS
  Digital não é obrigação que este catálogo acompanha, é do módulo de DP.
  Removido; um teste MEU que exigia o contrário foi TROCADO, porque premissa
  em aberto se fecha por decisão do dono, nunca por extensão minha.
  🚨 **E O CHECKLIST DE PENDÊNCIAS PASSOU A DEDUPLICAR PELA REGRA, NÃO PELO
  NOME**: desde este PR a MESMA obrigação tem regras diferentes por regime (o
  FGTS do Lucro é `ativa` e conferido; a variante que existiu brevemente para a
  imune era `proposta`) — deduplicar só por `obrigacao` colapsaria as duas numa
  linha e diria "FGTS não conferido" sobre a carteira inteira, uma afirmação
  falsa. A chave virou `obrigação+status+condição+frequência`.
  🔎 **E O PEDIDO AO COLABORADOR VIROU UMA FILA CURTA, NÃO "PREENCHAM AS
  ~390"** — ele já tinha recusado esse desenho uma vez (16/08, calendário
  municipal: *"eu não vou fazer nada manual"*). `triagem-terceiro-setor.js` +
  painel no ⚙️ Config Admin levantam quem PARECE imune/isenta pela razão social
  e pelo CNAE, e a fila é CURTA porque o regime deduzido já acerta a maioria.
  🚨 **O sinal NEGATIVO vale tanto quanto o positivo**: razão social com
  LTDA/S.A./EIRELI é SOCIEDADE (CC art. 44), e sociedade empresária não é
  entidade sem fins lucrativos — mesma leitura que resolveu metade das
  pendências do FUNRURAL em 13/08, régua REUSADA (`tipoSocietarioNoNome`), não
  reescrita. Sem essa trava, todo "INSTITUTO DE BELEZA LTDA" cairia na fila, e
  fila com falso positivo é fila que ninguém abre. CNAE de escola e de clínica
  ficam de FORA (dizem o que a entidade FAZ, não o que ela É); sinal fraco
  ("INSTITUTO", "CASA DE") sozinho não vira candidato. O painel NÃO DECIDE
  nada — é sugestão carimbada com a origem, quem marca é uma pessoa no
  cadastro — e o que a régua BARROU também aparece, com o tipo societário.

- **💬 SP CONNECT — o app de atendimento WhatsApp que SUBSTITUI a Ultra Fox**
  (projeto vivo desde 14/08; o documento de GOVERNO é
  `docs/desenho-modulo-comunicacao.md` — estado, fases e decisões moram LÁ,
  não aqui). O que NÃO se esquece entre sessões: (1) é **APP PRÓPRIO em
  `/connect`** (Paulo: *"não faz sentido algum ter um card dentro do CFI"*) —
  mesmo serviço Cloud Run, casa separada, tema CLARO por padrão, build no
  rodapé; (2) **identidade é da CASA, nunca da ferramenta** (ele recusou
  subdomínio "claude": *"eu não queria que os colaboradores associassem a
  você"*) — nome SP Connect, domínio alvo `app.spassessoriacontabil.com.br`;
  (3) **o bot de triagem NASCE DESLIGADO** (`whatsapp_config/atendimento`,
  chave na ⚙️ do Connect): enquanto a Ultra Fox estiver de pé são DOIS bots no
  mesmo cliente — liga no dia do corte, e a Ultra Fox só cai após aceite;
  (3b) 🚨 **ALERTAS À EQUIPE NASCEM LIGADOS, SEMPRE** (Paulo, 23/08: *"OS
  ALERTAS NASCEM LIGADOS SEMPRE"*, na linha do 16/08 *"quanto mais notificação
  melhor"*): notificação interna nova (som, popup, push, aviso no Teams) entra
  ATIVA por padrão — o "nasce desligado" vale só pro que fala com o CLIENTE
  (bot, avaliação, aviso de transferência);
  (4) **FILA ≠ DEPARTAMENTO do SaaS**: catálogo próprio de 8 filas em
  `whatsapp-atendimento.js` (Recepção vê TUDO; RH e Jurídico são filas), o
  catálogo dos 5 módulos não incha; (5) fora da janela de 24h SÓ template
  aprovado (Meta) — a trava é do backend; (6) credencial da WABA vive SÓ no
  CFI (irmãos usam o túnel); token/app secret NUNCA em chat ou print;
  (7) pacote do app do TEAMS pronto em `teams-app/` (zip servido em
  `/sp-connect-teams.zip`; GUID do manifest NUNCA muda entre versões);
  (8) backup da Ultra Fox entra pela ⚙️ → 📥 (preview antes de gravar,
  contato existente não é sobrescrito, reimportar não duplica, direção do
  .txt é escolha humana); (9) **quem responde "dá pra derrubar a Ultra Fox?"
  é `docs/de-para-ultrafox-spconnect.md`** — documento VIVO, atualizado no
  MESMO PR que fecha ou abre lacuna, com trava por comportamento
  (`__tests__/deParaUltrafox.test.ts` pergunta ao CÓDIGO e exige que o
  documento concorde). Nele, o que sei da Ultra Fox vem CARIMBADO com a
  origem ([print] · [Paulo] · [produção] · [?] = não conferido), porque
  de-para que finge conhecer a ferramenta antiga faz o corte acontecer com
  buraco escondido. ✅ **AS 3 BLOQUEANTES FECHARAM EM 16/08** (mídia
  recebida, envio de anexo e aviso de mensagem nova) — a última só depende
  de o Paulo publicar a `VITE_FIREBASE_VAPID_KEY`, e enquanto isso o app
  DIZ que o push está pendente em vez de fingir; (10) **o ℹ️ SOBRE é a casa
  do manual, do histórico e da identidade do app** (`services/
  sobreConnect.ts` — conteúdo é DADO, não JSX, senão não se testa). Selo
  vermelho com a régua IMPORTADA do `novidadesService` (segunda cópia foi o
  que deixou o 📣 do CFI onze dias apagado) e DUAS travas provadas
  quebrando de propósito: versão tem que ser a data da revisão mais nova, e
  **comando novo do bot obriga manual novo NO MESMO PR** (a varredura lê
  `decidirAutomacao`, nunca uma lista copiada). Regra que fica: **manual
  errado é pior que manual nenhum** — quem não sabe segue o que está
  escrito, então o manual se trava contra o COMPORTAMENTO do app;
  (11) 🔀 **A SEPARAÇÃO DE VERDADE ESTÁ PLANEJADA PARA DEPOIS DO CORTE**
  (Paulo, 17/08, ao ver CFI e Connect misturados na lista de runs do GitHub:
  *"planeja separação de verdade depois do corte da Ultra Fox"*). O plano é
  **`docs/separacao-sp-connect.md`** — fases, riscos, e a divisão do que é
  dele e do que é meu. O que muda decisão de HOJE: **separar SERVIÇO ≠
  separar BANCO** (precedente do 📋 Legalização — repo e serviço próprios,
  MESMO Firestore/Auth, zero migração de dados); a credencial da WABA
  **INVERTE de casa** (o Connect vira dono do canal e o CFI passa a PEDIR
  pelo túnel — manter a WABA no CFI anularia o motivo, porque queda do
  fiscal voltaria a calar o atendimento); e **nada começa antes do corte
  assentado**, senão o código do Connect vive em dois lugares justamente
  durante a migração de plataforma.
  ⚠️ **E AO RELATAR, SEPARAR AS DUAS CASAS**: ele reclamou com razão de eu
  misturar pendência do CFI (envs, robô de auditoria, fila do FUNRURAL) com
  pendência do Connect na mesma lista. Dividir CFI × Connect, e dentro de
  cada uma, o que é dele × o que é meu.
  🚨 **SEGUNDA VEZ EM 20/08 — e a regra ficou mais dura**: no meio de uma
  conversa inteira sobre SPED eu enfiei o Connect num "status geral"
  (*"não era p trazer aqui"* … *"n vamos misturar projetos"*). Dividir em
  seções NÃO basta. **O relatório responde SÓ o projeto da conversa**; o outro
  entra quando ele perguntar pelo outro, nunca por iniciativa minha. O custo
  não é estético: ele estava decidindo sobre arquivo fiscal e recebeu de volta
  uma lista com chave de push e ensaio de atendimento no meio.
  ⚠️ **E não carimbar pendência do outro projeto sem CONFERIR**: eu listei a
  `VITE_FIREBASE_VAPID_KEY` como "falta" lendo o de-para, quando o workflow já
  a carrega (`deploy-app.yml`, secret + build-arg) — repetir texto velho como
  fato é o erro do "0/388", agora atravessando de casa.
- **A RAZÃO SOCIAL JÁ RESPONDE: LTDA/S.A./EIRELI É PESSOA JURÍDICA** (13/08,
  fila da NOVA ERA). Metade das pendências de *"consulte o CADESP"* era de
  fornecedor cujo nome DIZ o que ele é — MIXTER … LTDA, PONTUAL COMERCIAL
  AGRICOLA LTDA, FRUTAS DA TERRA HORTIFRUTI LTDA. Sociedade é pessoa jurídica
  (CC art. 44) e produtor rural PF não se organiza como sociedade, então mandar
  consultar o CADESP de uma LTDA é gastar o tempo da equipe pra descobrir o que
  está escrito na tela. `tipoSocietarioNoNome` + confiança `sugerida-pj` +
  pendência `fornecedor-sociedade`: a ação vira **um clique de confirmação**.
  TRÊS TRAVAS: (1) é SUGESTÃO carimbada com a origem, nunca decisão — o valor
  continua FORA do total até alguém confirmar (regra de 06/08); (2) **"ME"/"EPP"
  ficam de fora** porque são PORTE, não tipo societário, e empresário individual
  com CNPJ pode ser justamente o caso do Comunicado CAT 45/2008; (3) a porta é a
  MESMA do `indefinido` — só entra quem vende gênero agropecuário, senão toda
  autopeças LTDA viraria pendência (um teste de 31/07 pegou isso na hora).
  🚨 **E A CONFIRMAÇÃO HUMANA NÃO VENCE AQUI — única exceção da regra de 06/08**
  (Paulo, no detalhe do FUNRURAL: *"o erro está aqui, tem que tirar esses
  caras"*). BELA VISTA COMERCIO DE FRUTAS E VERDURAS **LTDA** estava somando
  sub-rogação nota a nota porque alguém a confirmou como "Produtor Rural (PF)"
  — a fila oferece TRÊS BOTÕES e o PRIMEIRO é justamente esse, então limpando
  centenas de linhas o clique fácil faz a pendência sumir E ADICIONA imposto que
  não existe. Confirmação humana vence quando é OPINIÃO ("esta PJ é produtor? o
  CADESP responde"); não vence o IMPOSSÍVEL: sociedade é PJ (CC art. 44) e a
  sub-rogação (Lei 8.212/91 art. 30, IV) só alcança produtor rural PESSOA
  FÍSICA. Duas travas: confiança `cadastro-contraditorio` **não calcula
  FUNRURAL** e vira pendência com o valor nomeado (total que muda sozinho faz
  desconfiar do número certo), e `assertNaturezaCoerente` **RECUSA na gravação**
  — com a saída escrita na mensagem ("marque como Pessoa Jurídica"), porque
  trava sem caminho é trava que a equipe contorna. ⚠️ Um teste MEU de 17h dizia
  o contrário ("cadastro vence inclusive o nome") e foi trocado: premissa
  plausível derrubada por caso real.
  🚨 **E O BURACO MAIOR ERA OUTRO: FUNRURAL NÃO CONFERIA SE A COMPRA É DE
  PRODUÇÃO RURAL** (Paulo, mesma varredura: *"esses dois também têm que sair"* —
  EMILIO CAMPIGOTTO, CPF de SC, e ALEXANDRE AUGUSTO ARCARO **2º TP**, um
  tabelionato). Nenhum dos dois é erro de cadastro: **bastava o fornecedor ser
  pessoa física** para a contribuição ser calculada. A Lei 8.212/91 art. 25
  incide sobre a comercialização da **PRODUÇÃO RURAL** e o art. 30, IV sub-roga o
  adquirente DELA — comprar um caminhão usado, uma custa de cartório ou um
  serviço de uma PF não gera nada. A prova é NEGATIVA e por isso segura: só
  bloqueia quando o documento DIZ que não é produção rural (itens lidos e nenhum
  agropecuário, ou CFOP **de entrada** que não é de compra). Nota sem itens
  capturados NÃO é bloqueada — ausência não é prova, e bloquear no escuro tira
  FUNRURAL legítimo.
  🚨 **E FALTAVA A PROVA POSITIVA: NOTA DE SERVIÇO NUNCA É PRODUÇÃO RURAL**
  (Paulo, ainda na mesma fila: *"ainda esses"*). A prova negativa não alcança
  NFS-e/CT-e — eles não têm NCM nem CFOP, então passavam por AUSÊNCIA. O próprio
  painel já denunciava: **DIPAM R$ 729 mil contra base de FUNRURAL de R$ 1,89
  MILHÃO**, porque a DIPAM exige CFOP de compra e descartava esses documentos.
  `ehDocumentoDeServico` reconhece pelo que o documento É (tipo nfse/cte, modelo
  57/67, blocos prestador/tomador, código de serviço municipal) — **nunca pelo
  `modeloDoDoc`, que cai em '55' quando o campo não foi gravado** e faria
  justamente a NFS-e passar por NF-e. Serviço prestado por PF com retenção é
  R-2010, outro evento.
  ✂️ **E O QUE SOBRA SE TIRA COM UM CLIQUE, NÃO COM UMA LISTA NO CÓDIGO**
  (Paulo: *"achamos a diferença, tira esses do FUNRURAL e já era"*). O campo já
  existia — `produtores_rurais.funrural = 'nao_aplica'`, lido pelo núcleo desde
  sempre; faltava o BOTÃO na linha do FUNRURAL (rota sem botão outra vez, do
  lado do cadastro). **✕ tirar do FUNRURAL** (admin) grava o REGIME, nunca a
  natureza: dizer "é pessoa jurídica" seria afirmar sobre quem o fornecedor É,
  coisa que ninguém verificou — e ele continua valendo para a DIPAM, que é outra
  obrigação. Lista de nomes no código envelhece e daqui a três meses ninguém
  lembra POR QUE aquele fornecedor estava lá; decisão gravada no cadastro tem
  dono, data e volta atrás.
  ⚠️ **DUAS ARMADILHAS QUE ESSA REGRA PISOU NA HORA** (as duas pegas por teste):
  (1) reusei `CFOPS_COMPRA`, que é a régua da **DIPAM** — obrigação PAULISTA, só
  1xxx. Isso matava toda compra INTERESTADUAL de produtor, erro na direção mais
  cara (deixar de recolher); o gêmeo 2xxx virou `ehCfopCompraProducao`,
  **DERIVADO** da mesma tabela em vez de uma segunda lista. (2) o CFOP só pode
  julgar o lado da ENTRADA: CFOP de saída (5101) numa nota de entrada é a NF-e do
  próprio produtor, que sai pela dedup do art. 136 e **não pode cobrar
  pendência** — era exatamente o alarme apagado em 12/08.
- **🚨 O AVISADOR NÃO PODE COMPARTILHAR O MODO DE FALHA QUE ELE DENUNCIA — 3ª
  vez do mesmo cenário** (17/08, deploy 566). O deploy caiu em **"Prepare all
  required actions"**: o GitHub devolveu **429 e depois 503** ao baixar
  `google-github-actions/auth`. **Nenhum passo do job rodou** — inclusive o que
  abre a issue, que morava DENTRO do mesmo job. Resultado: trabalho mesclado na
  main, FORA DO AR, e ninguém avisado. As duas correções anteriores (a issue em
  13/08 e o `env:` no mesmo dia) não alcançavam este caso, porque as duas viviam
  no job que morre.
  ✂️ A trava virou **ESTRUTURAL**: job próprio `avisar-falha`, com `needs:
  deploy`, e **ZERO `uses:`** — usa só o `gh` que já vem no runner, porque a
  falha coberta é justamente o download de action (sem checkout também; o corpo
  da issue não precisa do repo, e por isso o `gh` leva `--repo` explícito).
  ⚠️ E passou a disparar em **`cancelled()`** além de `failure()`: em 06/08 três
  deploys foram cancelados aos 15m00s cravados sem runner atribuído (cota da
  conta) e não geraram aviso nenhum — cancelamento por plataforma é tão
  invisível quanto falha. A issue diz em qual estado terminou.
  ⚠️ **E EU NÃO CONSIGO REEXECUTAR DEPLOY**: `rerun_failed_jobs` e
  `run_workflow` devolvem **403 (Resource not accessible by integration)** para
  este token. Quando um deploy cai por infraestrutura, o caminho é **um push
  novo na main** (ou o Paulo reexecutando no painel) — não perder tempo tentando
  disparar pela API.
- **🚨 O SEGUNDO ENVIO DO MESMO DÉBITO ESTÁ BARRADO — a unidade é o DÉBITO,
  nunca a guia** (Paulo, 17/08, autorizando na sequência do caso HYPE: *"pode
  fazer, barrar o segundo envio do mesmo débito"*). O aviso de mistura resolvia
  METADE: ele DIZ que o DARF unificado carrega débito de outro departamento, e a
  trava dependia de o outro departamento **LEMBRAR** — memória não é trava (regra
  de 11/08: quem não sabe não precisa saber, precisa NÃO PASSAR).
  ⚠️ **O RISCO É ESTRUTURAL, NÃO DESCUIDO**: receita PREVIDENCIÁRIA **não tem
  guia avulsa** (`RECEITAS_GUIA_SEPARADA` do orquestrador não a inclui — "só sai
  em DARF numerado"), então o 1082 **só sai dentro do unificado**, que carrega
  PIS/COFINS de novo. Em TODO cliente com folha E faturamento no mesmo mês existe
  um caminho de cobrança dobrada. Por isso a régua é `debito-ja-enviado.js` (na
  `REGUAS_VIGIADAS`) e a chave é `código+extensão` na COMPETÊNCIA — duas guias
  diferentes com o mesmo código são a MESMA cobrança.
  A auditoria `impostos_enviados` passou a gravar a **composição** (`debitos[]`
  com departamento) — sem ela o log sabia que "um DARF saiu" e não sabia O QUE
  ele cobrava. **Campo novo ⇒ whitelist das TRÊS rotas de envio no mesmo PR**
  (lição do #382; aqui o descarte silencioso significa conta dobrada no mês
  seguinte), e um teste conta as 3 ocorrências em cada camada.
  QUATRO DECISÕES: (1) **reenvio legítimo existe** (cliente perdeu a guia,
  declaração retificada) ⇒ bloqueio COM saída por **motivo escrito ≥15 caracteres
  gravado com quem seguiu** — o desenho da trava T3 da DCTFWeb, porque bloqueio
  puro é trava que a equipe contorna; (2) **canal que não prova envio vai
  MARCADO** — só `email-graph` e `whatsapp-api` provam (regra de 05/08); tratar
  `email-app` igual faria o app barrar um primeiro envio de verdade por causa de
  uma janela que alguém abriu e fechou, então ele barra DIZENDO que o cliente
  talvez nunca tenha recebido; (3) **valor diferente é sinal de RETIFICAÇÃO** — o
  app mostra antes×depois e NÃO escolhe; (4) **envio antigo sem composição não
  vira "nunca foi enviado"**: vira ressalva nomeada (`incerto`), porque ausência
  de registro não é prova de ausência — e afirmar o contrário é justamente o que
  dobra a cobrança. Falha na consulta também NÃO libera calado.
  🐛 **A própria varredura da régua única pegou minha porta do frontend como
  segunda cópia** — eu havia dado o MESMO nome (`conferirDebitosJaEnviados`) à
  régua e à porta de fetch. Renomeada para `perguntarDebitosJaEnviados`: função
  com o mesmo nome nos dois lados é o começo de duas respostas divergentes.
  🚨 **E A GUIA CERTA ERA A ÚNICA SEM BOTÃO DE ENVIAR** (Paulo, na sequência:
  *"então como eu tenho que emitir em guias separadas, a função envio pelo
  sistema não vai né"* — e não ia). Eu mandei ele usar a guia separada (a que NÃO
  mistura departamentos) e o rito completo — SharePoint, gestor em cópia, baixa
  da obrigação, auditoria e a trava do débito repetido — existia **só no DARF
  unificado**. Ou seja, o app oferecia o caminho bom sem ferramenta e o caminho
  ruim com tudo. Família do "rota sem botão" (13/08), na versão pior: o botão
  existia no lugar ERRADO. Agora cada bloco de vencimento tem **📤 Enviar pelo
  sistema**, e a composição que viaja é a **DAQUELA DATA** (usar a do unificado
  barraria por débito que nem está no anexo). As guias da mesma data vão numa
  mensagem SÓ — o Integra Contador emite 1 DARF por código, e um e-mail por
  código faria o cliente receber três mensagens da mesma cobrança sem saber se
  são guias diferentes ou repetidas; o limite de 4 MB passou a ser do TOTAL.
  ⚠️ `conferirRepeticao` virou função PRÓPRIA porque os dois caminhos passam por
  ela: duplicar faria um caminho barrar o que o outro libera.
  📌 **PROCEDIMENTO QUE FICA (dito ao Paulo em 17/08)**: ou vai o **unificado**,
  UMA vez, por UM departamento combinado; ou vai o **avulso** de quem pode emitir
  (Fiscal: PIS/COFINS/IRPJ/CSLL/IPI) e o resto exige combinação humana. Nunca os
  dois caminhos no mesmo mês sem conferir. **Eu errei ao dizer que existia "guia
  separada de 20/08" para o 1082** — não existe; corrigido na hora.
- **🚨 O DARF DA DCTFWEB NÃO É DE UM DEPARTAMENTO SÓ — e o app deixava enviar
  sem dizer** (Paulo, 17/08, HYPE CAFE 07/2026: *"ERRO GRAVÍSSIMO, ia enviar os
  impostos PIS/COFINS da HYPE, está vindo os impostos de outro depto junto… por
  desencargo eu abri o PDF para conferir… senão vai acabar indo em duplicidade
  os impostos"*). O DARF unificado trazia **1082 CONTR PREV DESCONTA SEGURADO
  R$ 201,71** (DP/Folha) junto com **2172 COFINS 591,68 + 8109 PIS 128,20**
  (Fiscal), total 921,59. Se o DP mandasse a guia dele, o cliente pagaria o 1082
  **duas vezes** — e só o olho do dono pegou, abrindo o PDF por desconfiança.
  ⚠️ **A OPÇÃO QUE ELE PEDIU NÃO EXISTE, E A QUE RESOLVE JÁ EXISTIA**: não se
  escolhe imposto num DARF — a **Receita consolida por VENCIMENTO** (um
  vencimento, uma cobrança, todos os códigos daquela data). A saída real é a
  guia POR VENCIMENTO, que a aba DARF já emite; na HYPE ela resolve inteiro
  (1082 vence 20/08, PIS/COFINS 25/08). O defeito não era falta de recorte, era
  o app **não DIZER** que o unificado mistura departamentos. Prometer "escolha
  os impostos" seria promessa que a tela não cumpre — a lição do ✕ de 14/08.
  **E quando dois departamentos caem no MESMO vencimento a guia É uma só por
  determinação da Receita**: aí o app diz isso em vez de inventar recorte, e a
  combinação passa a ser humana (um envia, o outro sabe que não deve).
  `darf-departamentos.js` (na `REGUAS_VIGIADAS`) classifica pela **DESCRIÇÃO**,
  com o código de receita CORROBORANDO — de-para de código não é tabela oficial,
  então cada entrada carrega a FONTE (as três da HYPE vêm do DARF real).
  TRÊS TRAVAS: (1) **`misturado` é TRUE também com débito não classificado** —
  não saber de quem é não é o mesmo que saber que é meu, e o silêncio aqui é
  justamente o que dobra a cobrança; (2) **a trava CARREGA a composição sozinha**
  (os débitos são sob demanda, e depender de a pessoa ter clicado "Ver débitos"
  protegeria só quem já sabia do problema, que é ninguém) e **falha ao conferir
  PEDE confirmação dizendo que não conferiu** — indeterminado PARA aqui, ao
  contrário do gate de departamento, porque é guia indo ao cliente;
  (3) a régua é por **VARREDURA das rotas de envio**, não por lista — botão de
  envio novo sem a trava é guia dobrada, e envelheceria em silêncio (lição de
  13/08). ⚠️ **ORDEM DA CLASSIFICAÇÃO É REGRA, não detalhe**: "RETIDA/RETENÇÃO"
  é testado ANTES de "contribuição previdenciária", senão a CP retida de serviço
  tomado (Reinf, Contábil) seria carimbada como folha — a mesma mistura na
  direção contrária. A composição aparece na TELA antes dos botões: descobrir
  "por desencargo" não pode ser o processo.
- **🚨 TRANSFERÊNCIA RECEBIDA: o sufixo MUDA DE SIGNIFICADO ao atravessar a
  operação — e o CFI escriturava 1151 onde a tabela diz 1152** (Paulo, 17/08,
  NOVA ERA, com o livro de Entradas do E-Fiscal ao lado do Resumo por CFOP do
  CFI: *"precisamos trabalhar a correlação dos CFOPs com maior detalhe, melhor
  amarração de acordo com o RAMO da empresa que adquire a mercadoria"*).
  Na **SAÍDA** o sufixo descreve a ORIGEM de quem envia (5151 produção própria ·
  5152 mercadoria de terceiros); na **ENTRADA** ele descreve o DESTINO de quem
  recebe (1151 industrialização · 1152 comercialização · 1154 prestação de
  serviço). **É a MESMA assimetria de 101/102**, que a correlação já tratava — a
  família de transferência é que estava fora, então preservar o sufixo
  escriturava *"recebi para industrializar"* num comércio de frutas que revende.
  ⚠️ **Quem decide aqui não é o E-Fiscal, é a TABELA** (a régua de 11/08 continua
  valendo: E-Fiscal é referência, nunca gabarito — divergir dele é uma PERGUNTA,
  e esta tinha resposta na norma).
  ⚠️ **153 (energia elétrica para distribuição) fica FORA** — família própria;
  mandá-la para 152 porque o cliente é comércio seria inventar operação. E
  **misto/indefinido NÃO força**, ao contrário da família ST: aqui a conversão
  mecânica produz CFOP que EXISTE, então preservar é honesto (na ST ela inventava
  o 1405).
  ✅ **DEVOLUÇÃO FECHADA no mesmo princípio** (Paulo confirmou: *"as devoluções de
  mercadorias devem sempre se basear em COMO FOI DADO ENTRADA na NF"*). Quando o
  cliente devolve, ele emite pelo lado DELE (5201/5202 descrevem o destino que
  ELE dava); do meu lado vale se eu vendi **produção própria** ou **mercadoria de
  terceiros**. `PARES_DEVOLUCAO_RECEBIDA` com o par ficando DENTRO da família —
  **201/202** venda, **208/209** transferência, **410/411** com ST —, porque
  trocar de família inventaria operação. ⚠️ Um teste que dizia *"devolução com ST
  preserva o sufixo, 1410/1411 existem"* foi TROCADO: existir era metade da
  pergunta, a outra metade é QUAL DOS DOIS. **408/409 ficaram FORA** (semântica
  não provada aqui — deduzir é o que produziu o 1405), e **155/156** segue como
  pergunta aberta.
  🚨 **E O RAMO É DEFAULT, NÃO VERDADE DA NOTA — o caso KALUNGA** (Paulo, 17/08:
  *"uma indústria compra da Kalunga material de escritório; ela não usa essa nota
  para industrialização nem comercialização — usa para uso/consumo ou compra de
  ativo"*). A régua escreve `1101` para toda compra de indústria; ali o certo é
  **1556** (uso/consumo) ou **1551** (ativo). **O XML NÃO carrega esse destino** —
  a Kalunga emite `5102` porque para ELA é revenda —, então o app não tem como
  saber e a correção é o **campo por NF**. O que dava para melhorar era a
  VISIBILIDADE: a descrição do CFOP passou a aparecer junto do número.
  📚 **E A BASE DE CONSULTA ESTAVA VAZIA** (ele achou a incongruência: *"o próprio
  CFI publica o link do CONFAZ com todos os CFOPs atualizados"*). O app citava a
  tabela oficial e tinha **DUAS** descrições gravadas, dentro do `geminiService`.
  Viraram `sefaz-backend/cfop-catalogo.js` (régua única, com a FONTE junto), e
  código sem descrição sai **NOMEADO** — `descricaoCfop` devolve **null**, nunca
  frase genérica, senão a tela parece completa quando não está.
  🚧 **FALTA A TABELA**: `confaz.fazenda.gov.br` é **bloqueado pela rede deste
  ambiente** (mesma trava da doc do SERPRO e do manual da Receita), então o
  preenchimento vem por COLAGEM humana — igual ao código 9 do ISS fixo e aos ids
  de qualificação do PGDAS. **Descrição entra COPIADA, nunca de memória**:
  descrição errada é pior que descrição nenhuma, porque faz escolher com
  confiança o CFOP errado.
  ✅ **CATÁLOGO CARREGADO EM 18/08 — 619 códigos da redação EM VIGOR** (Ajuste
  SINIEF 03/24, Anexo II do Convênio s/nº 15/12/1970; PDF da compilação da
  SEFAZ-SC mandado pelo Paulo). **Extraídos por script, nenhum digitado.** O
  arquivo `cfop-catalogo.js` é GERADO — para atualizar, regere do PDF novo.
  🚨 **E O CATÁLOGO ACHOU O QUE NENHUM TESTE ACHAVA: o app estava INVENTANDO
  CFOP na família do COMBUSTÍVEL.** A saída tem SEIS códigos (origem × destino:
  5651-5656) e a entrada tem TRÊS (só o destino: 1651 industrialização · 1652
  comercialização · 1653 consumidor final). **1654, 1655 e 1656 NÃO EXISTEM** —
  e o Resumo por CFOP da NOVA ERA 07/2026 tem **1655 com 109 notas e
  R$ 72.805,21**. É o **mesmo defeito do 1405**, três meses depois, noutra
  família. ⚠️ Aqui NÃO se decide pelo ramo: o próprio CFOP do vendedor já DECLARA
  o destino ("destinados à comercialização"), então o de-para é direto
  (`PARES_COMBUSTIVEL_ENTRADA`) e não depende de cadastro nenhum.
  📌 **E SOBRARAM TRÊS que a régua NÃO conserta**: o mesmo print tem **1103** (9
  notas), **1929** (25) e **2104** (1) — códigos que o SINIEF 03/24 REMOVEU e que
  a conversão mecânica ainda produz. O app **não escolhe o substituto** (seria
  inventar), mas agora **DIZ**: a aba ✏️ CFOP por nota mostra `NÃO CONSTA` na
  linha e um resumo em vermelho no topo com a lista e a contagem de notas.
  🚨 **A TRAVA QUE FICA É A MAIS FORTE DO DIA**: `cfopCatalogo.test.ts` roda a
  régua sobre **os CFOPs de saída que EXISTEM de verdade** nas famílias que ela
  transforma e exige que o resultado conste da tabela. ⚠️ A 1ª versão montava os
  códigos combinando faixa × sufixo e acusou 37 falhas — todas na faixa 3
  (importação), para códigos como "7151" que **não existem nem como saída**. O
  app só converte CFOP que veio num XML, e XML carrega código real: alimentar a
  régua com código inventado é acusar defeito onde não há.
  📉 O catálogo guarda a descrição **CURTA** (o título). As notas explicativas
  inteiras somariam ~250 KB no bundle, e o que vai na tela ao lado do número é o
  título — quem precisa da nota tem o link da fonte.
  🚨 **E A PRIMEIRA TABELA MANDADA NÃO SERVIA — a página `cfop_cvsn_70_nova` do
  CONFAZ NÃO é a redação EM VIGOR** (18/08, Paulo mandou o PDF de 59 páginas).
  Ela se desmente no cabeçalho — *"Nova redação dada ao CFOP pelo Ajuste SINIEF
  16/20, **sem efeitos**"* e *"Revogado, a partir de 01.06.22, pelo Ajuste SINIEF
  03/22"* — e a prova prática é maior que a leitura: aquela redação **ELIMINA A
  FAMÍLIA ST INTEIRA** (a faixa 1.4xx fica só com 1450-1456; não existem 1401,
  1403, 1406, 1407, 1408, 1409, 1410, 1411, nem o 1655).
  ⚠️ **E o CFI escritura 1403 HOJE** — ele está no Resumo por CFOP da NOVA ERA
  07/2026 com 56 notas e R$ 85.553,20, no print DELE. Carregar aquela tabela faria
  o app dizer *"1403 não cadastrado"* para um código que ele mesmo produz dezenas
  de vezes por mês, e alguém poderia "corrigir" a escrituração por causa de uma
  tabela que não vale. **REGRA QUE FICA: antes de carregar qualquer tabela de
  CFOP, conferir se ela tem a família ST (x401/x403/x407/x410/x411)** — se não
  tiver, é a redação do 16/20 e NÃO SERVE. Travado em `cfopCatalogo.test.ts`.
  ✅ **O que o PDF SERVIU para fazer**: corroborar, palavra por palavra, as duas
  correlações que subiram no mesmo dia — **1151** *"Transferência para
  industrialização ou produção rural"* × **1152** *"Transferência para
  comercialização"*; **1201** *"Devolução de venda de produção do
  estabelecimento"* × **1202** *"Devolução de venda de mercadoria adquirida ou
  recebida de terceiros"*; e **1208/1209** no mesmo par. Também confirma o caso
  KALUNGA: **1556** *"Compra de material para uso ou consumo"* e **1551**
  *"Compra de bem para o ativo imobilizado"*.
  🧠 **E O CAMPO GANHOU CÉREBRO — ideia dele, 18/08**: *"um cérebro que, quando o
  usuário faz a alteração de forma manual, ele deve gravar, criando um parâmetro
  para os próximos meses"*. `cfop-cerebro.js` (na `REGUAS_VIGIADAS`) + coleção
  `cfop_parametros`. **O NÚMERO QUE JUSTIFICA** veio do Relatório de Notas que ele
  mandou (2.330 entradas em 6 meses): **914 notas (39%)** escrituradas como
  uso/consumo ou ativo — destino que o XML NÃO carrega, porque o fornecedor emite
  5102/5405 (para ELE é venda de mercadoria). Corrigir 914 à mão por semestre não
  é processo.
  📐 **A MEDIÇÃO DEFINIU A CHAVE**: no mesmo arquivo, **apenas 6 de 311
  fornecedores** aparecem em mais de um grupo de destino — o FORNECEDOR decide em
  98% dos casos, e 10 fornecedores cobrem 66% daquelas 914 notas. Mas 98% não é
  100%, então a chave é **fornecedor + CFOP DE ORIGEM** (o CFOP que o fornecedor
  emitiu já separa venda normal de ST e de ativo), com "qualquer CFOP do
  fornecedor" como escopo largo — **o mais específico vence**.
  🚨 **TRÊS TRAVAS**: (1) **vigência NÃO RETROAGE** — o parâmetro vale da
  competência em que nasceu em diante, senão um mês já entregue mudaria de CFOP
  depois do SPED transmitido (régua do IVA-ST e do calendário municipal); entre
  dois vigentes ganha o mais RECENTE, resolvendo pela DATA do fato; (2) **a NF
  vence o cérebro** — precedência NF > cérebro > empresa > régua, porque quem
  corrigiu a nota olhou a nota; (3) **é OPT-IN** — depois de corrigir, o app
  PERGUNTA se deve aprender, com a consequência escrita antes do clique; nascer
  ligado faria o app aprender com um clique de teste, e parâmetro errado é pior
  que a correção nota a nota porque se aplica calado a tudo que vier depois.
  ⚠️ **SAÍDA NÃO APRENDE** (aprender ali seria reescrever a nota que o cliente
  emitiu) e **desligar NÃO APAGA** (o parâmetro continua explicando as
  competências que já datou). Falha ao ler os parâmetros devolve `[]`: o cérebro
  é palpite melhor, não trava — sem ele a régua automática segue valendo.
  📗 **E A EQUIPE TEM GUIA** (Paulo, 18/08: *"aonde e como explico p colaborador"*).
  `/guia-cfop-por-nota.html` — botão 📗 na aba ✏️ E no cabeçalho do modal 🔗, par
  duplo com `docs/guia-colaborador-cfop.md`, e seção nas 📣 Novidades com o
  `NOVIDADES_VERSAO` no par. A frase que abre o guia é a que resolve a dúvida
  toda: **"o XML da compra traz o CFOP do FORNECEDOR, não o nosso"** — a Kalunga
  emite 5102 porque para ELA é venda, e o destino do papel não está em campo
  nenhum da nota. O resto (corrigir, ensinar, o que o parâmetro NÃO faz, e o
  "NÃO CONSTA") decorre disso.
  🔁 **E O CST SEGUE O CFOP — a mesma assimetria, um campo adiante** (Paulo,
  18/08: *"adiciona o CST para validarmos a operação… a nota vai vir 5102, vamos
  registrar como 1556; aí que está a chave do SPED: o CST do fornecedor vai vir
  como 00, temos que indicar 90 para essas operações"*). A nota é do FORNECEDOR:
  para a Kalunga aquilo é venda tributada integralmente (CST 00); do lado de cá a
  entrada não é de mercadoria, e a operação se escritura como **90 (Outras)**.
  Precedente já provado no IPI (IN RFB 932/2009, 11/08) — preservar o CST cru é
  escriturar a operação DELE.
  🚨 **A ARMADILHA QUE O CST TEM E O CFOP NÃO: a ORIGEM mora no 1º dígito.**
  Escrever `090` direto faria todo produto IMPORTADO (`100`) virar NACIONAL
  dentro do SPED. A conversão troca só os dois últimos dígitos — provado para as
  nove origens da Tabela A.
  ⚠️ **O QUE A RÉGUA RECUSA, E DIZ**: CST 40/41/50/51/60/70 é MANTIDO (cada um já
  declara um fato — isenta, diferimento, ST já cobrada — que o 90 apagaria, e é
  justo o 60 que o livro precisa enxergar); CSOSN é outra tabela; item sem CST
  não recebe CST deduzido do CFOP.
  ✅ **E O ATIVO É O EXEMPLO DE COMO SE FECHA UMA PREMISSA**: ele nasceu FORA da
  tabela, devolvido como pergunta COM CONTAGEM, porque o raciocínio parecia o
  mesmo mas o fato não era (no ativo há crédito de ICMS por CIAP; no uso/consumo
  não há crédito nenhum). Perguntado, Paulo respondeu **"Sim, CST 90"** — e só
  então 551/552 entraram, com a fala dele como FONTE. Um teste MEU que exigia o
  contrário foi TROCADO: premissa em aberto se fecha por decisão do dono, nunca
  por dedução minha. A fila `DESTINOS_SEM_DECISAO` fica de pé VAZIA, porque é a
  forma certa de a próxima família entrar.
  🚨 A trava é a dos **LEITORES**: C170 e C190 passam pela MESMA função, contado
  por varredura — se divergirem, o detalhe e o consolidado do MESMO item contam
  histórias diferentes, e é o C190 que a apuração soma.
  🚪 **E A ENTREGA FICOU NUMA PORTA QUE NINGUÉM ABRE — o card de CFOP não levava
  ao CFOP** (Paulo, 18/08, com o print do card 🔄 CFOP aberto: *"n
  identifiquei"*). Ele procurou no lugar CERTO: **o card se chama CFOP**. O
  ✏️ CFOP por nota tinha subido horas antes DENTRO de Relatórios (é lá que mora o
  recorte empresa × competência) e ninguém adivinha isso. **Não foi build velho**
  — conferido: o deploy 586 estava verde e o `_v` do print dele era posterior.
  É a família do **"rota sem botão"** (13/08) e do botão no **lugar errado**
  (17/08, a guia separada que era justamente a certa e não tinha ✉️), na versão
  mais enganosa: a tela existia, funcionava, e a única pessoa que sabia onde
  era, era eu.
  ✂️ O card CFOP passou a **DIZER O QUE ELE É** (*"esta tela consulta a IA sobre
  CFOP"*) e a levar ao lançamento com um clique. Dizer o que a tela é vale tanto
  quanto o atalho: sem isso, quem chega ali continua tentando escriturar por um
  campo de busca. ⚠️ O atalho chega **NA ABA**, não na primeira — cair no Livro
  de Entradas depois de clicar em "CFOP por nota" faria concluir que o campo
  sumiu; e ele **NÃO GRUDA** (o `selecionarTipo` limpa o destino), senão um
  clique deixaria Relatórios abrindo naquela aba para sempre, respondendo a um
  pedido que ninguém fez.
  🚨 **REGRA QUE FICA: tela nova nasce com o atalho NO CARD ONDE A PESSOA VAI
  PROCURAR** — e o nome do card é a pista de onde ela procura. `atalhoCfopPorNota
  .test.ts` exige que a aba pedida EXISTA na união `AbaId`, que a tela honre o
  pedido, que a limpeza esteja no `selecionarTipo` e que as DUAS metades do guia
  digam que o card CFOP é consulta; provado renomeando a aba de propósito.
  Atalho apontando para aba renomeada envelheceria EM SILÊNCIO, levando ao lugar
  errado sem nada acusar.
  🏠 **E A CASA DELE É O MODAL** (Paulo, 18/08: *"pode usar o modal"*). O painel
  virou COMPONENTE (`CfopCerebroPainel`), montado em DOIS lugares: aba
  **🧠 Por fornecedor** dentro do 🔗 Correlação de CFOP, e a aba ✏️ CFOP por nota.
  Duas cópias fariam uma tela listar parâmetro que a outra não conhece. ⚠️ São
  ABAS separadas de propósito: override **por CFOP** (empresa) e parâmetro **por
  FORNECEDOR** são réguas diferentes, e na mesma lista pareceriam a mesma coisa.
  ⚠️ Na aba do cérebro o botão **Salvar SOME** — o parâmetro grava na hora, e
  botão que não faz nada é pior que botão nenhum (família do "Já importado" sem
  estado). O painel **não decide CFOP**: só cria, lista e desliga.
  ⚠️ **O QUE ELE DELIBERADAMENTE NÃO FAZ**: aprender por NCM ou pela descrição do
  produto. Acertaria na maioria e erraria EM SILÊNCIO na minoria — e num livro
  fiscal o erro silencioso é o caro. Ele aprende do que uma PESSOA decidiu.
  ✅ **E O CAMPO DE LANÇAMENTO ENTROU — a decisão dele foi "é por NF"** (perguntei
  se era por nota ou por item). Aba **✏️ CFOP por nota** em Relatórios:
  `documentos_fiscais.cfopEscriturado` + carimbo (`...Por`/`...Em`), com
  precedência **NF > override da EMPRESA > régua automática** (o mais específico
  vence, igual ao cadastro de NCM) e **campo em branco devolvendo a nota à régua**.
  A decisão vale para TODOS OS ITENS da nota — foi o pedido, e a consequência é
  DITA antes do clique: nota com CFOPs diferentes entre os itens aparece marcada
  **⚠ mista** com os CFOPs que o carimbo vai colapsar (`cfopsDistintosDaNota`),
  em vez de o total mudar sozinho depois.
  🚨 **A trava que manda aqui é a dos LEITORES**: campo que só a tela honra seria
  pior que não ter o campo — a conferência daria certo e o SPED sairia com o CFOP
  velho. `cfopPorNota.test.ts` varre e exige que Livro, Resumo por CFOP, Por
  produto, C170/C190, E510 e as DUAS saídas do Exportar SAGE passem o DOCUMENTO
  para `cfopDoLancamento`, não só o CFOP do item.
  ⚠️ **CFOP digitado não entra torto**: `validarCfopEscriturado` recusa faixa
  incompatível com a direção (5102 numa entrada) — é a família do 1405, e campo
  fiscal digitado sem trava vira dado que só a fiscalização acha. 🐛 A varredura
  da régua única pegou meu `['1','2','3'].includes(...)` como cópia de
  `ehNotaPropriaDeEntrada`; virou regex de faixa em vez de exceção — mesma saída
  do `status` que virou `situacao`.
- **🚨 O `1010` DO EFD-CONTRIBUIÇÕES NÃO É O DO EFD ICMS/IPI — mesmo número,
  arquivo diferente** (Paulo, 17/08, com o recibo do PVA da MANTOAN 07/2026:
  *"O número de campos informado no registro difere do especificado no leiaute"*
  — esperado **7**, veio **9** — mais recusa em `IND_NAT_ACAO` e `DT_SENT_JUD`
  recebendo `'N'`). O gerador emitia `|1010|N|N|N|N|N|N|N|N|`, que é a
  **Obrigatoriedade de registros do Bloco 1 do EFD ICMS/IPI**; no
  EFD-Contribuições o 1010 é **Processo Referenciado — AÇÃO JUDICIAL**
  (`NUM_PROC, ID_SEC_JUD, ID_VARA, IND_NAT_ACAO, DESC_DEC_JUD, DT_SENT_JUD`).
  Ou seja, **declarava um processo judicial com os campos preenchidos com 'N'**.
  É a família do IPI que foi parar em E200/E210 (04/08), que são registros do
  ICMS-ST. ⚠️ **E não se inventa o 1010 certo**: ele só existe quando a empresa
  TEM ação referenciada, e isso ninguém cadastrou — bloco sem dados se declara
  **SEM DADOS** (`1001|1`), com o `IND_MOV` saindo do que foi PRODUZIDO (registro
  novo vira '0' sozinho) em vez de constante.
  🚨 **E O QUE O PVA NÃO RECUSOU ERA PIOR: M200/M600 SAÍAM 0,00** num arquivo com
  37 A100 e PIS/COFINS destacados — o arquivo dizia à Receita que **não havia
  contribuição a pagar**, e isso o PVA aceita (**arquivo aceito não é arquivo
  certo**). Causa: a armadilha das DUAS FORMAS pela **terceira vez no mesmo
  arquivo** — a NFS-e do portal não tem `itens` e grava `valorTotal`, e o bloco M
  lia `nota.valor || nota.totalNota`. Agora cai em `valorDoDocumentoServico`, e
  documento sem valor em forma nenhuma **sai da base NOMEADO num aviso** ("o
  M200/M600 está a MENOR"), nunca como zero. Provado contra o arquivo real: 33
  prestações = base **43.890,00** · PIS **285,28** · COFINS **1.316,70**.
  🚨 **RODADA 3 DO PVA (18/08) — 39 recusas, DUAS causas** (Paulo: *"terceira vez
  sobre os erros da empresa Mantoan"*; as outras 30, COD_MUN, ele resolve na mão
  — "na nota não tinha mesmo"). (1) **COD_ITEM vazio nos 37 A170 sintéticos**
  (36 recusas): o item único que representa a NFS-e sem `itens[]` saía com
  `cod: ''` — não existe cProd numa nota sem discriminação, e inventar um código
  POR DOCUMENTO seria fingir um catálogo que não existe. Virou
  `COD_ITEM_SERVICO_GENERICO` ('SERV-GENERICO'), constante ÚNICA, e — porque o
  A170 não pode apontar pra um item que a Tabela de Identificação não conhece —
  o coletor (`sped-contrib-orchestrator.js`) passou a registrar esse MESMO
  código no 0200 sempre que houver documento de serviço sem itens no período,
  importando a constante em vez de duplicá-la. (2) **IND_ORIG_CRED vazio em 3
  itens de ENTRADA com CST 70** (sem crédito): o código anterior só preenchia
  esse campo quando o CST TINHA crédito (50-56) — premissa MINHA, sem prova, da
  rodada 2. O PVA desmente: *"Campo obrigatório PARA NOTAS FISCAIS DE
  ENTRADA"* — quem manda é a DIREÇÃO do documento, não o CST. Toda entrada leva
  IND_ORIG_CRED = '0' (mercado interno), tenha ou não crédito; saída continua
  SEM o campo (ele descreve a origem da AQUISIÇÃO, que só existe do lado de
  quem compra). NAT_BC_CRED não mudou — o PVA não acusou ele nestas linhas, e
  continua só com CST de crédito.
  ✅ **CASO FECHADO EM PRODUÇÃO (18/08, mesmo dia)**: Paulo regerou o arquivo da
  MANTOAN 07/2026 e validou no PVA de novo — *"empresa 0040 ... zerou"*. As 39
  recusas saíram, incluindo as 2 de M205/M605 ("registro filho obrigatório")
  que este PR não tinha tocado: elas eram CONSEQUÊNCIA do COD_ITEM vazio (um
  A170 sem item identificável quebra o encadeamento que o PVA cobra do
  detalhamento por código de receita), não um leiaute próprio que faltasse
  escrever — corrigido o pai, o filho parou de faltar. **Arquivo aceito >
  leiaute deduzido**, mais uma vez: não escrevi nada para M205/M605, e o
  recibo é quem prova que não havia nada a escrever.
  🚨 **E O F600 NUNCA EXISTIU — `buildBlocoF` era um STUB permanente** (Paulo,
  19/08, HS PROJETOS 0304: *"ela é retido de PIS/COFINS, então quando eu
  informo no EFD CONTRIBUIÇÕES ele me dá o F600 para preencher, na SAGE ele já
  puxava essas informações"*). Toda empresa com retenção na fonte saía com
  `F001|1` (bloco sem dados) — e sem F600 o `VL_RET_CUM` do M200/M600 não
  abate nada: o arquivo declararia **a recolher MAIOR que o devido**. Fiquei
  bloqueado de propósito (IND_NAT_RET é tabela oficial, não se chuta) até ele
  mandar **o EFD antigo do E-Fiscal da própria HS (05/2026, assinado) com 5
  F600 reais** — e o arquivo destravou tudo de uma vez:
  `|F600|03|02052026|5200|189,8|5952|1|47252373000113|33,8|156|0|` ⇒
  IND_NAT_RET=03 (PJ direito privado) · COD_REC=5952 (CSRF) · IND_NAT_REC=1
  (cumulativa) · **VL_RET = SÓ PIS+COFINS** (a CSLL retida existe no DARF mas
  NÃO entra nesta escrituração — somá-la declararia retenção a maior). E os
  totais fecham centavo a centavo: Σ dos 5 F600 = PIS 114,40 e COFINS 528,00
  = `VL_RET_CUM` do M200/M600 do MESMO arquivo.
  🚨 **E O ARQUIVO ACEITO DESMENTIU NOSSO M200/M600**: a contribuição do
  regime CUMULATIVO mora nos campos 8-12 (`|M200|0|0|0|0|0|0|0|114,4|114,4|0|0|0|`);
  o gerador punha a BASE no campo 1 e a contribuição espalhada na seção do
  NÃO-cumulativo. O PVA ACEITAVA (não cruza esses campos — a MANTOAN passou
  assim), mas "aceito não é certo": declarava a apuração na seção do regime
  errado. Corrigidos os dois no mesmo PR; os testes antigos que travavam o
  leiaute deduzido foram TROCADOS (premissa derrubada por arquivo aceito).
  ⚠️ **A régua do R-4020 vale no F600 na direção mais cara**: nota cujos
  campos de PIS/COFINS têm a assinatura 1,65%+7,60% (tributo da OPERAÇÃO do
  prestador, caso ATLAS SCHINDLER) fica FORA, nomeada — declará-la inflaria o
  abatimento com retenção que ninguém reteve. Quem decide é
  `conferirRetencaoFederal`, nunca uma cópia. `coletarRetencoesF600` é UMA
  coleta para o bloco F e o M (duas divergiriam); F600 entrou em
  `DETALHES_VIGIADOS` no mesmo PR.
  🚨 **E A PROVA REPROVOU NO MESMO DIA — a coleta lia SÓ a forma ANINHADA**
  (Paulo, 19/08, com o recibo do PVA: *"0304 - HS PROJETOS, não subiu o
  F600"*). A NFS-e do portal grava `valorPis`/`valorCofins` ACHATADOS na raiz
  e `coletarRetencoesF600` lia só `valores.*` — toda nota retida era pulada
  como "sem retenção gravada" (o `continue` do caso normal), o bloco saía
  `F001|1` e o M200/M600 declarava **295,23 + 1.362,60 a recolher SEM o
  abatimento** num mês em que a retenção zera a conta. É a armadilha das duas
  formas pela DÉCIMA vez, e a régua já tinha nascido HORAS antes para o
  Relatório de Retenções: a coleta passou a ler pelo DONO
  (`lerRetencoesFederaisDoDoc`), e o **A100 ganhou VL_PIS_RET/VL_COFINS_RET da
  MESMA coleta** (o arquivo aceito de 05/2026 preenche esses campos; segunda
  leitura faria A100 e F600 contarem retenções diferentes no mesmo arquivo).
  ⚠️ Os erros do print do PVA ("VL_RET_CUM > Σ F600") vieram de a colaboradora
  ter preenchido o M200 NA MÃO dentro do PVA com o F600 vazio — o arquivo cru
  nem acusava, porque nele a retenção sumia dos DOIS lados de uma vez.
  ✅ **PROVADO EM PRODUÇÃO no mesmo dia** (Paulo, 19/08, depois de regerar:
  *"passa o mata burro, 0304 - HS PROJETOS"*). O F600 subiu com a retenção que
  o documento já tinha na forma achatada — o arquivo saía `F001|1` sobre a
  MESMA base de dados, ou seja não faltava dado nenhum, faltava LEITURA.
  📌 **A LIÇÃO QUE FICA É A DA FORMA, NÃO A DO F600**: em dez ocorrências, a
  armadilha das duas formas nunca apareceu como erro — ela aparece como
  **ausência plausível** ("sem retenção gravada", "sem participante", "valor
  0,00"), que é indistinguível do caso normal. Por isso leitor novo de campo de
  documento não escolhe uma forma: chama o DONO da régua. E quando não existe
  dono, ele nasce ali — foi o que aconteceu neste PR e no do Relatório de
  Retenções, horas antes, com o MESMO leitor.
  ⚠️ **E o sintoma no PVA acusava o lugar errado**: os erros eram
  "VL_RET_CUM > Σ F600", que faz procurar defeito no M200 — quando o M200
  estava certo e o vazio era o F600. Recibo do PVA aponta o CAMPO que não
  fecha, nunca a CAUSA; foi o arquivo aceito de 05/2026 que disse onde olhar.
- **🚨 "CANCELADA DEVERIA PUXAR" — e ele tinha razão, E a prova veio no mesmo
  dia** (Paulo, MV LIDER 639 · 18/08). Primeira tentativa: eu inventei um
  SEGUNDO webservice (Consulta Situação, `NfeConsultaProtocolo4`) pra resolver
  a empresa sem A1 próprio — código escrito, mergeado, **host nunca provado**.
  Paulo não esperou: abriu a tela "🔎 Consultar NFe por chave" que JÁ EXISTE em
  produção (`consulta-nfe-por-chave`, cert do ESCRITÓRIO) e consultou as 3
  chaves suspeitas da MV LIDER uma a uma. **As três voltaram
  `cStat=653 · Rejeicao: NF-e Cancelada, arquivo indisponivel para
  download`** — mesmo o escritório não sendo parte de nenhuma delas.
  ✂️ **Isso desmonta a premissa que eu tinha escrito**: eu assumia que o
  `NFeDistribuicaoDFe`/`consChNFe` recusa qualquer resposta pra quem não é
  parte do documento. Falso PARA REJEIÇÃO — só é verdade pro CONTEÚDO. cStat
  653 é a SEFAZ dizendo "essa nota não existe mais" sem entregar nada, e isso
  ela conta pra qualquer certificado válido. Ou seja: **o webservice que já
  está em produção resolvia sozinho** — não precisava do segundo.
  🗑️ **A Consulta Situação foi REMOVIDA** (`consultaSituacaoNFe`,
  `ufTemConsultaSituacao`, `lerRespostaConsultaSituacao`, host
  `nfe.fazenda.sp.gov.br` nunca provado) — código morto que ninguém ia chamar,
  e mantê-lo seria a isca certa pra alguém reativar um caminho não testado
  contra produção. Deletar código não-testado > deixar "por via das dúvidas".
  ✅ **O QUE FICOU, PROVADO**: `lerRespostaCancelamento` (reconferir-
  cancelamento.js) ganhou o caso `cStat === '653'` — corroborado pelo TEXTO
  ("cancelad" no `xMotivo`, não só o número, porque a NT seguinte pode
  reaproveitar o código pra outra coisa. E a rota `/reconferir-cancelamento`
  passou a cair no cert do ESCRITÓRIO (consultando COMO escritório,
  `cnpjInteressado = CNPJ_ESCRITORIO`) quando a empresa não tem A1 — o MESMO
  caminho da tela de diagnóstico, não um novo. Nota válida da qual o
  escritório não é parte continua `indeterminado` (honesto: não é prova de
  "tudo certo"), só nota CANCELADA agora é encontrada mesmo sem A1 próprio.
  **LIÇÃO QUE FICA**: antes de escrever um webservice novo pra contornar uma
  restrição, testar se a restrição é real com a ferramenta que já existe. Eu
  deduzi a regra do DistDFe; ele testou. O teste venceu.
  🚨 **E A TERCEIRA RODADA ACHOU O DEFEITO QUE FAZIA TUDO PARECER PARADO: A
  FILA NÃO ANDAVA** (Paulo, 20/08: *"639 - MV LIDER, não mudou! já tínhamos
  dado como ajustada"*). A tela trazia 20 notas `[indeterminado]` com cStat 640
  e, embaixo, *"a rodada parou em 60 de 162 — rode de novo para continuar, são
  3 rodadas"*. **Rodar de novo NÃO continuava**: só a nota CANCELADA era
  carimbada, então `selecionarParaReconferir` não tinha como saber quem já
  havia sido perguntada — ordenava por número, cortava no teto e devolvia
  exatamente as MESMAS 60, rodada após rodada. As 102 do fim nunca foram
  perguntadas, e a promessa de progresso era do próprio app.
  ✂️ Agora a rota **carimba TODA nota perguntada** (`reconferenciaSefazEm`) e a
  seleção ordena por **antiguidade da pergunta** — nunca perguntada primeiro,
  depois a mais antiga. ⚠️ **Não é "perguntou uma vez, nunca mais"**: o
  cancelamento tem prazo legal e nota válida hoje pode ser cancelada amanhã, então
  a fila GIRA em vez de excluir. E o campo entrou no `.select()` no MESMO PR —
  campo fora da projeção some da leitura, e a fila voltaria a repetir em silêncio.
  🚨 **E `cStat 640` NÃO É SILÊNCIO, É RESPOSTA — o app chamava de
  "indeterminado"**, que se lê como *"a ferramenta não conseguiu"*. Ela
  conseguiu: a SEFAZ respondeu. O que 640 significa sai da PROVA de 18/08, na
  MESMA empresa e com o MESMO certificado do escritório (que não é parte de
  nenhum daqueles documentos): as três chaves canceladas voltaram **653**. Ou
  seja, a SEFAZ informa o cancelamento ANTES de barrar por permissão — se ela
  barrou por permissão, **não havia cancelamento a informar**. Situação
  `nao-cancelada-por-recusa`, contada À PARTE do `nao-cancelada` normal: lá a
  prova é POSITIVA (ela entregou o documento e não há evento), aqui é NEGATIVA
  (ela não disse 653), e fundir as duas apagaria a diferença justo onde importa.
  Corrobora pelo TEXTO, como o 653 — cStat isolado pode ser reaproveitado por NT
  futura.
  ⚠️ **E O SELO VERDE ERA A OUTRA METADE**: o cabeçalho dizia *"✓ numeração
  contínua · 0 cancelada(s)"* em VERDE com 20 notas sem resposta embaixo. Para a
  saída o cancelamento só chega por evento e a SEFAZ não entrega ao emitente
  (Rej. 641), então aquele número é o das canceladas que CHEGARAM. Agora ele diz
  **"0 cancelada(s) conhecida(s) · N não conferida(s) na SEFAZ"** e sai do verde
  enquanto N > 0.
  🐛 **E A RODADA SEGUINTE ACHOU O SEGUNDO BURACO — a fila nem chegava nas
  notas certas** (Paulo, 19/08, rodando a correção acima na MV LIDER: 20 de 20
  voltaram `[indeterminado] ... cStat 618 — Rejeicao: Chave de Acesso invalida
  (modelo diferente de 55)`). `selecionarParaReconferir` ordena por `numero`
  sem separar por MODELO — e naquela empresa a série de NFC-e (mod 65,
  numeração 293-345) é mais BAIXA que a série de NF-e (mod 55, 3736-3897, o
  alvo de verdade). Rodada após rodada, a fila consultava NFC-e primeiro, que
  o `NFeDistribuicaoDFe` **nunca** vai conseguir responder — não é falha de
  rede nem de certificado, é modelo errado, e a própria SEFAZ diz isso na
  cara (cStat 618). `modeloDoDoc` (régua já existente em
  `participante-doc-helper.js`, nunca uma leitura nova) filtra mod ≠ 55 pra
  FORA da fila, contado em `naoMod55` — nunca em silêncio, senão "20
  indeterminadas" voltaria a parecer resposta da SEFAZ quando na verdade
  nenhuma das 20 podia responder.
- **🚨 CT-e NUNCA TEVE CAPTURA AUTOMÁTICA — o NFe DistDFe nunca pergunta por
  CT-e** (Paulo, 18/08, EDUARDO GUERRA — tomadora de frete, 0 documento
  capturado apesar dela ser a DESTINATÁRIA: *"o consultor não está fazendo a
  captura de CT-e, confirma pra mim"* → confirmado: busquei em TODO o
  histórico do git por `CTeDistribuicaoDFe`/`DistCTe` e não existe nenhum
  commit. O parser (`xml-importer.js`) já entendia `infCte`/`chCTe`/`vTPrest`
  desde sempre — o que faltava era PERGUNTAR à SEFAZ, porque CT-e tem
  webservice de distribuição PRÓPRIO, `CTeDistribuicaoDFe`, nunca chamado.
  *"como automatizar as CTeS então"* → `cte-client.js` espelha ponto a ponto o
  `NFeDistribuicaoDFe` que já roda em produção (mesmo envelope `distDFeInt`,
  troca só o namespace de `.../nfe` pra `.../cte`), e
  `sync-orchestrator-cte.js` espelha `sincronizarEmpresa` reaproveitando
  `calcularCursorSeguro` (pura, já testada — reescrevê-la seria a segunda
  cópia) e `importarXmlSefaz` (o MESMO leitor, que já reconhece
  resCTe/procCTe). Rota manual `POST /sync-cte-one` pra provar numa empresa
  real ANTES de entrar no cron noturno.
  🚨 **CURSOR E LOCK PRÓPRIOS — `sefaz_state_cte`/`sefaz_locks_cte`, NUNCA os
  do NF-e**: compartilhar o cursor faria um dos dois documentos ficar
  "sincronizado" com o NSU do lado errado — a mesma armadilha das duas formas
  que já mordeu o projeto (11/08), agora entre NF-e e CT-e em vez de entre
  dois formatos do mesmo documento. Travado por varredura de fonte
  (`syncOrchestratorCte.test.ts`).
  🚧 **HOST NÃO PROVADO CONTRA RESPOSTA REAL** — mesma cegueira de rede do item
  acima; `www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/...` segue a convenção de
  nome do NF-e (mesma infraestrutura nacional), mas só produção confirma.
  ✅ **E O TESTE VEIO NO MESMO DIA — o host RESPONDEU** (Paulo, 19/08, botão
  🚚 CT-e beta na EDUARDO GUERRA: `cStat=239 Rejeicao: Cabecalho — A versao do
  arquivo xml nao e suportada`). Isso prova TLS, host, SOAP e o resto do
  envelope de uma vez — 239 é a SEFAZ RECUSANDO um campo específico, não uma
  falha de rede/schema. A causa era a constante `VERSAO`: copiei o `'1.01'` da
  NF-e sem checar, e o CT-e tem versão PRÓPRIA do `distDFeInt` (NT 2015.002).
  Rede da SEFAZ segue bloqueada deste ambiente, então a correção não veio de
  doc oficial — veio de CORROBORAÇÃO por múltiplas implementações
  independentes no GitHub (PySPED, PyNFe, e um script de terceiro com o
  comentário *"NAO e a 1.35 da NF-e — o layout de distribuicao do CT-e tem
  versao PROPRIA"*), todas concordando em `'1.00'`. Corrigido; falta a PROVA
  de verdade — uma rodada que volte `ok:true`.
  Escopo desta rodada: só ENTRADA (empresa tomadora, caso EDUARDO GUERRA) —
  emissão própria de CT-e e "Manifestação do Destinatário" de CT-e ficam de
  fora, por decisão explícita, até haver caso real que peça.
  🚨 **E EU OFERECI CHAMAR A API COM CREDENCIAL QUE NÃO TENHO** (Paulo: *"pode
  chamar por API as CTE"*). Este sandbox não tem `gcloud`, service account nem
  token de admin da produção — e pedir pra ele colar um token no chat seria
  repetir a mesma falta de higiene do `sefaz-cron-secret` (vazou 2× em cola de
  terminal). A saída certa é a de sempre: um BOTÃO na tela, que ele clica já
  logado, sem token nenhum passando por mim. `🚚 CT-e (beta)` entrou na MESMA
  linha do `↓ Sincronizar SEFAZ` (aba Empresas → Empresas Monitoradas),
  admin-only, chamando `POST /sync-cte-one` — resultado em estado PRÓPRIO
  (`resultCte`/`runningCte`), nunca misturado com o resultado do NF-e.
  Travado por `sefazSyncButtonCte.test.ts` (mesma família do "rota sem botão"
  de 13/08: endpoint novo sem caminho na interface é código morto com cara de
  entrega).
- **🚨 IMPORTAÇÃO MANUAL DE CT-e BLOQUEADA — DUAS LEITURAS DO MESMO XML,
  DIVERGINDO** (Sandra via Paulo, 19/08, A CASTELLANO: um CT-e que o cliente
  manda dava *"Arquivo não é desta empresa — nenhum dos 6 XMLs é desta
  empresa"*, com o botão Importar nem aparecendo — só Cancelar). O backend que
  de fato importa (`parseCTeXml`, `services/xmlParserService.ts`) já sabia a
  regra desde sempre: no CT-e o **REMETENTE** é a contraparte principal (é ele
  quem manda a carga, e no XML da A CASTELLANO `toma=0` diz que o remetente
  também é quem PAGA o frete) — o `<dest>` cru é só o destinatário FINAL da
  mercadoria, sem nada a ver com o cliente. Mas a TELA de confirmação (que
  roda ANTES do backend, só pra mostrar de quem são os arquivos) usava
  `extrairDadosXml` (`services/xmlLoteValidacao.ts`) — uma SEGUNDA leitura,
  por regex, que só conhecia `<emit>`/`<dest>` e nunca soube da regra do
  remetente. Resultado: a tela bloqueava um arquivo que o backend já aceitava
  — a régua duplicada divergindo da régua real, e a duplicada é que decidia se
  a pessoa via o botão de importar.
  ✂️ `extrairDadosXml` passou a ler `<rem>` também e, quando presente, usá-lo
  no lugar do `<dest>` — a MESMA substituição que `parseCTeXml` já faz, nunca
  uma regra nova. Para NF-e a tag `<rem>` não existe, então nada muda nela.
  Chave também passou a reconhecer `Id="CTe..."` e `<chCTe>`, não só o padrão
  de NF-e. Provado com o XML real que ela mandou (CT-e da TadLog Transportes,
  A CASTELLANO como remetente/tomadora, chave real).
- **🚨 A IMPORTAÇÃO MANUAL RECUSAVA A NF-e COMPLETA DE UMA NOTA QUE ESTAVA NA
  BASE COMO RESUMO** (caso PWR, 19/08: quatro notas de fornecedor — GLOBAL
  COMPANY, BENCO, POXPUR — na tela ✏️ CFOP por nota **sem nº, sem CFOP pela
  régua e sem CST**, e o colaborador digitando o CFOP no escuro). O XML que
  Paulo mandou provou que a nota TEM tudo (item, CST 00, base, ICMS destacado):
  o que estava no banco era o **RESUMO** (resNFe, ~531 bytes, sem itens) que o
  DistDFe entrega antes da Ciência — e ao importar o XML completo por cima, o
  caminho manual respondia "já está aqui", recusando exatamente o arquivo que
  consertaria tudo. **O trilho automático do backend sempre fez esse upgrade**
  (`decidirGravacaoNFe`); o manual do navegador é que não conhecia a régua.
  ✂️ A régua MUDOU DE CASA: `decidirGravacaoNFe` (+ os detectores de resumo)
  saiu de `xml-importer.js` — que puxa firebase-admin e não entra no bundle —
  para o módulo PURO `sefaz-backend/gravacao-nfe-regua.js`; o importer importa
  de lá e re-exporta (nada quebra pra quem já usava). `lerDuplicado` ganhou a
  situação `resumo-pode-completar` (upgrade SEM opt-in — é estritamente MAIS
  dado do mesmo documento) e a gravação do upgrade usa **MERGE**, senão os
  eventos que o resumo já recebeu (cancelamento chega antes da completa)
  seriam apagados. TRÊS TRAVAS: posse vem ANTES (resumo de OUTRA empresa não
  completa por aqui), CANCELADA vem antes (completar não muda total e
  reescrever status de cancelada é risco sem ganho), e a tela DIZ "COMPLETADA"
  — item aparecendo sem explicação é susto.
  ⚠️ **E a mensagem "CFOP inválido — são 4 dígitos" sobre campo VAZIO era
  alarme errado**: vazio é AUSÊNCIA (resumo sem itens), não formato — acusar
  digitação mandava procurar erro onde o problema é de captura. `textoDoCfop`
  agora separa os dois e manda reimportar o XML completo em vez de digitar.
- **🚨 O SPED PERDIA AS NOTAS CAPTURADAS — o filtro lia um campo que o importer
  NUNCA GRAVOU** (Paulo, 19/08, PRONTO SOCORRO 0896 · 07/2026: *"no consultor
  está puxando 131 notas de saída NF-e e NFC-e; quando gerei o SPED me dá isso
  aqui apenas"* — o relatório do PVA trazia **DOIS CFOPs e R$ 30.833,16** contra
  **R$ 74.213,10** do recorte). A linha era
  `if (!['55','65'].includes(String(n.modelo))) return false` — e o
  `xml-importer.js` (captura SEFAZ, cofre de e-mail, XML manual do backend)
  **grava `tipo`, `tipoDoc` e `chave`, mas NÃO grava `modelo`**. O modelo mora
  na CHAVE (posições 21-22). Só o import pelo NAVEGADOR (`xmlParserService`) e o
  `sync-routes` gravam o campo — eram essas as poucas notas que sobravam.
  🔴 **E O ALCANCE ERA MUITO MAIOR QUE "faltam notas no livro"**: a MESMA
  leitura estava no **bloco D** (CT-e), no **bloco C do EFD-Contribuições** e —
  o pior — em **`somarImpostoPorDirecao`**, que é quem soma o **débito e o
  crédito de ICMS do E110** e o **IPI do E520**. Nota fora do bloco é nota fora
  da **APURAÇÃO**: o arquivo saía declarando imposto a MENOR, e o PVA aceita.
  ✂️ `sped-selecao-documentos.js` (na `REGUAS_VIGIADAS`) — família de
  `docCancelado` e `direcaoEfetivaDoc`: **o campo gravado pode não existir, e
  quem responde é a régua na LEITURA**.
  ⚠️ **O TIPO É JULGADO ANTES DO MODELO**, e isso é trava, não ordem: o
  `modeloDoDoc` **cai em '55'** quando não há modelo nem chave legível (armadilha
  já registrada em 13/08), então uma NFS-e entraria no bloco C como se fosse
  NF-e. Rótulo com CTe/MDFe/NFSe, ou blocos de prestador/tomador, saem antes.
  🐛 **E A PRIMEIRA VERSÃO DESSA RÉGUA TIROU NOTA BOA — defeito MEU, pego pelo
  PVA no mesmo dia**: eu excluía pelo RÓTULO (`schema`/`tipoDoc` = resNFe), e o
  import pelo NAVEGADOR **não grava esses dois campos** — então a nota
  COMPLETADA por cima de um resumo continua rotulada `resNFe` **com itens,
  modelo e número**. Três notas inteiras (GLOBAL COMPANY, POXPUR, BENCO) saíram
  do bloco C da PWR, e o PVA acusou na hora: participante e item declarados no
  0150/0200 **sem C100 que os referencie**, e o crédito do E110/E520 sem origem
  documental. **Quem decide é o ITEM; o rótulo só EXPLICA a ausência dele.**
  📌 **RESUMO NÃO SE ESCRITURA, e agora sai NOMEADO**: o resNFe não tem itens,
  então não produz C170/C190 — e C100 solto o PVA recusa. Ele vira aviso com a
  ação certa (importar o XML completo ou rodar o ♻️), em vez de sumir calado.
  **Nota CANCELADA é a exceção que ENTRA**: o Guia Prático manda escriturar só o
  C100, sem filhos.
  🚨 **E O PVA COBROU A SEGUNDA METADE NA MESMA HORA — três erros, três causas
  da MESMA família** (PS VIDROS, 187 erros; PWR, 12). (1) **`COD_MOD` do C100
  saía `String(nota.modelo || '55')`** ⇒ NFC-e capturada era declarada como
  modelo 55 *com uma chave que diz 65* (*"O modelo da chave não confere com o
  modelo do documento"*, 35×). Corrigi o FILTRO e esqueci o ESCRITOR — o campo
  cru estava nos dois. (2) **NFC-e tem leiaute PRÓPRIO no C100**: `COD_PART`,
  ST, IPI, PIS e COFINS **não podem ser informados** (86×) — é venda de balcão,
  não há participante a declarar. (3) **E500/E520 em quem NÃO é contribuinte de
  IPI**: com o bloco C consertado, as compras entraram e o crédito de IPI da
  nota do FORNECEDOR passou a gerar o bloco — mas em comércio aquilo é
  **CUSTO**, não crédito. A prova positiva é o IPI destacado na **SAÍDA** (só
  contribuinte destaca) ou saldo credor na ficha; crédito de compra não prova
  nada. Cadastro (`contribuinteIpi`) vence os dois, e a falta vira aviso com a
  ação.
  🚨 **E O SALDO DE IPI CONTINUOU 0,00 DEPOIS DA "CORREÇÃO" — a ficha não mora
  em coleção nenhuma.** A leitura que subiu de manhã consultava
  `db.collection('lucro_fichas')`, que **NÃO EXISTE**: a ficha é EMBUTIDA no
  documento da empresa (`fichaFinanceira[]`, competência em `mesReferencia`).
  A query voltava vazia SEMPRE — e o ICMS, que já lia assim antes, **nunca
  transportou saldo nenhum**. Consulta que só devolve vazio é indistinguível de
  "não tem saldo": a ausência plausível, agora do lado da LEITURA. Agora lê a
  ficha embutida e prefere o **`saldoCredor*Transportar` da competência
  ANTERIOR** (o que SOBROU, calculado — 18/08, KROYA), com o campo antigo de
  reserva e a ORIGEM carimbada no aviso; isso também fecha a defasagem do ICMS
  registrada em 17/08.
  📌 **E O 0150 PASSOU A CASAR COM A RÉGUA DO BLOCO C**: *"Não informar
  participante, se não referenciado em pelo menos um dos demais blocos"* — duas
  fontes de órfão, e as duas apareceram nos dois PVAs do dia. A **NFC-e** nunca
  referencia participante (o C100 dela não pode ter COD_PART), então consumidor
  de cupom no 0150 é erro garantido — e arrasta o *"campo obrigatório para
  contribuintes domiciliados no Brasil"*, porque o cupom não traz endereço do
  comprador. E a nota **não escriturada** (só resumo/sem itens) leva o
  participante dela junto. É a mesma régua que o 0200 já aplicava aos itens.
  📌 **E O 0002 NÃO SE INVENTA**: o PVA recusa o arquivo do contribuinte de IPI
  sem o registro *Classificação do estabelecimento industrial* — cujo código é
  de TABELA OFICIAL. Ele só sai CADASTRADO (`classEstabIpi`, campo novo no
  modal Dados Fiscais + whitelist no mesmo PR, regra do #382), e a falta vira
  aviso nomeando o erro exato do PVA e onde preencher. Mesmo desenho do código
  9 do ISS fixo: o número vem do cadastro, nunca de dedução minha.
  🐛 **E a varredura achou DUAS leituras cruas na mesma linha da apuração**: ao
  lado do modelo estava `status !== 'autorizado'` — o cancelamento chega por
  EVENTO e o campo continua 'autorizado', então **cancelada ENTRAVA no E110** (a
  régua de 11/08 não tinha chegado aqui, e a varredura do `canceladaReguaUnica`
  não pega a forma negada). O `COD_SIT` do C100 tinha o mesmo defeito: cancelada
  saía como **00 (regular)**, voltando ao livro pela porta do SPED.
- **🚨 O BACKEND FISCAL NÃO PASSAVA POR VERIFICAÇÃO NENHUMA — e derrubou a
  geração do SPED** (Paulo, 20/08, com o print: *"Erro ao gerar SPED · Falha
  interna — este erro é de hoje de manhã, tem que ser sanado"*). A causa era uma
  reescrita MINHA da coleta de participantes que **apagou a linha
  `const participantesMap = new Map()`**. O arquivo continuava usando o nome
  TRÊS vezes, e a primeira empresa que gerasse SPED batia num ReferenceError.
  🔴 **O QUE ASSUSTA NÃO É O ERRO, É NADA TER PEGO**, por três motivos que se
  somam: (1) `npm run lint` era só `tsc --noEmit`, e o `tsconfig.json` do app
  tem **`allowJs: false`** — ou seja, **todo o `sefaz-backend/`, que é quem GERA
  IMPOSTO, não era verificado por nada**; (2) `node --check` enxerga sintaxe,
  não escopo; (3) o jest não carrega o orquestrador, porque ele puxa
  firebase-admin. Deploy verde, testes verdes, app quebrado.
  ✂️ `tsconfig.backend.json` (checkJs) + `scripts/check-backend-nomes.mjs`,
  ligado no **`lint`** — que é o comando do passo "Typecheck + testes" do
  deploy. Agora nome usado sem declaração **para a esteira**.
  ⚠️ **O FILTRO É CIRÚRGICO DE PROPÓSITO**: ligar `checkJs` no backend legado
  acusa **~520 TS2339** ("propriedade não existe") que são ruído de código
  dinâmico. A trava vigia só **TS2304/TS2552 — "usou um nome que não existe"**,
  que é sempre defeito de verdade. Trava que nasce vermelha é trava que a
  equipe desliga, e aí ela não protege nada.
  ⚠️ **E JSDoc NÃO CONTA**: `@returns { statusCode, body }` faz o TS ler as
  chaves como tipo e acusar um nome que é só documentação — eram 5 falsos
  positivos, todos em comentário. Linha de comentário é descartada.
  📌 **REGRA QUE FICA: corrigir a linha fecha a INSTÂNCIA; a trava fecha a
  CLASSE.** Provada removendo a declaração de propósito — ela acusou as três
  linhas exatas do defeito real.
- **🚨 RODAR O GATE ANTES DO ÚLTIMO ARQUIVO É NÃO RODAR O GATE** (20/08, deploy
  634 — defeito MEU, e quem pegou foi o Paulo). O PR da fila da reconferência
  (#845) estendeu `reconferir-cancelamento.js` e **não tocou o
  `reconferir-cancelamento.d.ts` escrito à mão ao lado**. O `tsc --noEmit` do
  deploy travou; o #847 consertou o tipo.
  🔴 **O QUE ASSUSTA É A ORDEM, NÃO O TIPO**: eu rodei `npm run lint` e ele
  passou — **antes de criar o arquivo de teste**, que era justamente quem
  referenciava os campos novos. Depois rodei `jest` (ts-jest não reprova por
  erro de tipo do jeito que o `tsc` reprova) e `build` (o Vite não faz
  typecheck). Ou seja: os três verdes eram verdadeiros e **nenhum deles tinha
  olhado o último arquivo tocado**.
  ✂️ **REGRA QUE FICA: o gate é a ÚLTIMA coisa antes do commit, sempre depois do
  último arquivo escrito.** `lint → escrever mais um arquivo → commit` é a
  mesma família do "trava escrita como LISTA" (13/08): a verificação existe,
  passa, e não cobre o que entrou depois dela.
  ⚠️ **E `.d.ts` À MÃO É A ARMADILHA DAS DUAS FORMAS com outra roupa**: o tipo e
  a implementação são duas declarações do MESMO fato, e divergem em silêncio —
  o `.js` não reclama. Campo novo em módulo com `.d.ts` vizinho ⇒ os dois no
  MESMO PR, igual à whitelist do #382.
- **🚦 O GARGALO DO SPED NÃO ERA SÓ O LEIAUTE — ERA O ROUND-TRIP** (Paulo,
  20/08: *"um dos maiores gargalos que vem consumindo tempo e retrabalho é o
  EFD-ICMS/IPI e SPED Fiscal… corrija evitando o vai e vem o dia todo"*, com o
  link do Guia Prático 3.2.2 e o do leiaute 2026).
  🚧 **OS DOIS LINKS NÃO ABREM DAQUI, E A CAUSA NÃO É O SITE**: o proxy de saída
  deste container recusa o CONNECT com **403 (policy denial)** — provado com
  `curl` e com o `/__agentproxy/status`, que lista só npm/pypi e afins. Paulo
  estranhou com razão (*"o domínio não bloqueia link, ainda mais
  governamental"*): o bloqueio é da MINHA rede, não do gov.br. É o mesmo caso
  do CONFAZ, da doc do SERPRO e do manual da Receita — e a saída é a que já
  funcionou: **ele cola o PDF** (foi assim que entraram os 619 CFOPs).
  ✂️ **O QUE DEU PARA FAZER SEM O MANUAL, e ataca a causa real**: o vai-e-vem
  vem de os erros aparecerem **um round-trip do PVA por vez** — gera, valida,
  print, conserta um grupo, recomeça. `sped-prevalidacao.js` ("PVA de bolso")
  roda as recusas que o PVA JÁ NOS DEU sobre o **arquivo gerado**, na hora, e
  sai nos warnings e no header `X-SPED-Prevalidacao`. Uma volta em vez de N.
  🚨 **DUAS REGRAS DE OURO DESSE MÓDULO**: (1) **cada regra carrega a FONTE** —
  a recusa LITERAL do PVA, com cliente e data; regra sem fonte é chute com cara
  de validação, e validação errada manda consertar o que está certo; (2) ele
  confere o **ARQUIVO, não a intenção** — a entrada são as LINHAS, o mesmo
  texto que o PVA lê. Auditar o objeto em memória foi o que deixou o C100 sair
  com modelo 55 e chave 65 por meses sem nenhum teste acusar.
  ✅ **E O MANUAL CHEGOU NO MESMO DIA — em WORD** (Paulo: *"vou te mandar em
  WORD"*, depois de o Adobe também bloquear). É a versão **3.2.3**, mais nova
  que a 3.2.2 do link, mais a Nota Técnica do leiaute **020**. Os dois estão
  extraídos em `docs/sped/` para a próxima sessão não depender de reenvio.
  ✅ **O LEIAUTE 2026 É UM NÃO-EVENTO PARA O CFI**: as mudanças do 020 são o
  `COD_DOC_IMP` do **C120** (DUIMP) e o `CAP_TANQUE` do **1310** — dois
  registros que não geramos; e o `COD_VER` que o app escreve (`020`) é o certo
  para 2026. Preocupação legítima dele, respondida com a fonte na mão.
  ✅ **E O MANUAL CONFIRMOU, PALAVRA POR PALAVRA, DUAS REGRAS QUE EU TINHA
  DEDUZIDO** das recusas do PVA na véspera: o 0150 não leva participante citado
  só em C100 de NFC-e, e a Exceção 9 do C100 lista exatamente os oito campos
  que a NFC-e não pode informar. Dedução a partir de recusa REAL se sustentou.
  🐛 **E REVELOU QUATRO DEFEITOS QUE NINGUÉM TINHA VISTO**: (1) **NFC-e
  escriturada na ENTRADA** (*"as NFC-e não devem ser escrituradas nas
  entradas"*); (2) **C100 de CANCELADA saindo com os valores** — a Exceção 1
  manda preencher SÓ REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e
  CHV_NFE, *"demais campos com conteúdo VAZIO"*; (3) **`SER` sem as três
  posições** — e o PVA confere a série contra a que está DENTRO da chave, então
  o zero à esquerda é o que faz os dois baterem (`000` quando não há série);
  (4) **nota em substituição ao cupom fiscal (CFOP 5929/6929) saindo como
  COD_SIT 00** quando a Exceção 4 diz **08** — com a ressalva do próprio manual
  de que o **PARANÁ** escritura por outra regra, que virou condição no código.
  📌 **REGRA QUE FICA: fonte oficial que chega vira ARQUIVO NO REPO, não
  conhecimento de sessão.** O manual em `docs/sped/` é grep-ável, e regra nova
  entra citando o item — mesma disciplina do catálogo de CFOP.
  📌 As 13 regras da 1ª leva: COD_MOD × chave · campos proibidos da NFC-e ·
  0150/0200/0190 órfãos · C100 sem C190 (cancelada é exceção) · **E110 c.6 =
  Σ VL_ICMS dos C190 de entrada** (com a exceção do 1605 e a inclusão do 5605,
  literal) · **Σ IPI dos C190 = Σ crédito dos E520** · 0002 ausente com E500 ·
  E500 em não-contribuinte · ST sem E200 · CFOP fora do catálogo · 0100 sem
  EMAIL/COD_MUN. Regra nova do Guia Prático entra AQUI, com a citação do manual
  como fonte.
- **🚨 O `VL_OPR` DO C190 NÃO É A SOMA DOS `vProd` — o livro saía a MENOR e o
  PVA ACEITAVA** (Paulo, 20/08, teste da PWR: *"2 erros, e o teste da PWR"*,
  com o Livro de Entradas do CFI dizendo **TOTAIS (4 notas) 71.960,81** e o
  relatório "Registros fiscais dos documentos de entradas" do PVA, sobre o
  arquivo recém-gerado, dizendo **TOTAL 69.760,36**). A diferença —
  **2.200,45** — é exatamente o *Total de IPI* do mesmo relatório.
  O manual é literal (Guia Prático **3.2.3, C190, Campo 05**): *"informar neste
  campo o valor das mercadorias somadas aos valores de fretes, seguros e outras
  despesas acessórias e os valores de ICMS_ST, FCP_ST e IPI (somente quando o
  IPI está destacado na NF), subtraídos o desconto incondicional e o abatimento
  não tributado e não comercial"*. E o C100 fecha pelo outro lado — **Campo 12
  (VL_DOC)**: em 2026 ele **tem que ser igual à Σ VL_OPR dos C190 filhos**.
  ⚠️ **É A MESMA LIÇÃO DO `VL_CONT_IPI` DO E510** (11/08, provada contra arquivo
  aceito): o "valor contábil" do SPED **inclui o IPI**. Um registro adiante, a
  mesma armadilha — e aqui **o PVA nem recusa**: ele só imprime um total menor.
  Erro que o validador aceita é o que sai do escritório e só aparece na
  fiscalização, então a trava tem que ser NOSSA (virou a regra **R14** do PVA de
  bolso, com a citação do Guia como fonte).
  ✂️ **E A CORREÇÃO NÃO CABIA NUMA LINHA — a regra estava em TRÊS lugares e os
  três discordavam do manual**: o gerador somava `vProd`; o validador do editor
  (R8) exigia `VL_OPR == Σ VL_ITEM dos C170`; e o **autofix do C190
  REESCREVIA** o campo com essa soma. Consertar só o gerador faria o editor
  acusar o arquivo CERTO e o autofix **desfazer a correção** na primeira nota
  que passasse por lá. Dono único: `sefaz-backend/valor-operacao-c190.js` (na
  `REGUAS_VIGIADAS`).
  ⚠️ **E O ARQUIVO NÃO PROVA TUDO**: frete, seguro e outras despesas acessórias
  moram no **C100**, não no C170 — lendo só as linhas, o derivado é um **PISO**,
  nunca o número exato. Por isso o dono devolve **piso e teto**: com despesa na
  nota o validador confere a FAIXA e o autofix **não reescreve, DIZ**. Ratear
  despesa por CST/CFOP seria inventar — e inventar é o que produziu o 1405.
  📌 O `vFCPST` passou a ser capturado **por item** (só existia nos totais, e
  total não serve num registro que é por CST+CFOP+alíquota).
  ✅ **CASO FECHADO EM PRODUÇÃO no mesmo dia** (Paulo, 20/08, depois do deploy
  626: *"SPED ICMS/IPI - 1364 - PWR - OK"*). É a **primeira empresa do Lucro a
  fechar o EFD ICMS/IPI inteiro** neste projeto — e ela vinha de quatro rodadas
  seguidas de recusa (bloco C perdendo nota pelo campo `modelo` cru · resumo
  excluído por RÓTULO · saldo credor de IPI 0,00 · `VL_OPR` sem o IPI). O que
  fechou foi sempre a MESMA disciplina: **arquivo aceito > leiaute deduzido**, e
  regra nova só com a citação do Guia do lado.
  📌 **E O QUE ISSO DIZ SOBRE O GARGALO** (a queixa de 20/08, *"evitando o vai e
  vem o dia todo"*): as quatro rodadas custaram um dia cada porque os erros
  apareciam **um round-trip do PVA por vez**. As 14 regras do PVA de bolso
  existem para que a próxima empresa gaste UMA volta — e a régua que fica é que
  **regra aprendida numa recusa entra no `sped-prevalidacao.js` no MESMO PR**,
  com o cliente e a data. Recusa que só conserta a instância volta no mês
  seguinte com outro CNPJ.
  🏁 **O PLACAR DE 20/08 — TRÊS CLIENTES FECHADOS NO MESMO DIA** (Paulo, no fim
  do dia: *"0040 - MANTOAN - OK · 0304 - HS PROJETOS - OK (APURAÇÃO / EFD
  CONTRIBUIÇÕES) · 1364 - PWR (APURAÇÃO ENTRADA/SAÍDA / SPED ICMS IPI) OK"*).
  O que isso muda para o projeto, e não é pouco: **as DUAS obrigações do Lucro
  passaram a ter cliente fechado ponta a ponta** — EFD-Contribuições (MANTOAN e
  HS) e EFD ICMS/IPI (PWR). Até 19/08 nenhuma tinha. Sai do campo do "gera o
  arquivo" e entra no do **recibo**, que é a única prova que a casa aceita.
  ⚠️ **E ISSO NÃO GENERALIZA SOZINHO**: três clientes fechados não são a
  carteira fechada, e a régua de 05/08 continua valendo — quem diz quem pode
  migrar é a 🏁 Fila de migração, cliente a cliente, com a captura provada. O
  que mudou é que o LEIAUTE deixou de ser o gargalo; o gargalo volta a ser
  captura e cadastro (é o que segura PS VIDROS e EXPERTE hoje).
- **🚨 O BLOCO C DO EFD-CONTRIBUIÇÕES NUNCA TINHA PASSADO PELO PVA — 157
  recusas de IMPORTAÇÃO, todas em C100 e C170** (Paulo, 20/08, PWR 1364 ·
  07/2026: *"são erros diferentes dos outros, agora estamos falando do PIS e
  COFINS de INDÚSTRIA"*). Ele nomeou a causa sem saber: **MANTOAN e HS PROJETOS
  são de SERVIÇO e fecham pelo bloco A** (A100/A170) — a PWR é a primeira
  INDÚSTRIA, ou seja a primeira a passar pelo bloco C deste arquivo.
  🔴 **O C100 saía com 24 campos onde o leiaute tem 29, e o C170 com 23 onde
  tem 37** — e não era campo faltando no fim: o gerador **PULOU a seção de
  ICMS/IPI**, então o CST_PIS caiu na casa do CST_ICMS, a base do PIS na do
  CFOP e a alíquota na de COD_NAT. Os outros 125 erros (*"Conteúdo do campo
  inválido · CFOP 4765,00"*, *"Tamanho do campo inválido · COD_ENQ 318,68"*)
  são TODOS consequência de um defeito único de forma. É a **quarta vez** da
  mesma classe (1010 em 17/08, M210/M610 em 18/08, agora C100/C170).
  ✂️ **O GABARITO É O ARQUIVO ACEITO DA PRÓPRIA EMPRESA** — o
  EFD-Contribuições de **03/2026** que o e-Fiscal transmitiu e a Receita
  aceitou. Ele fixa os 29 e os 37 campo a campo, e o C170 dele mostra a seção
  de ICMS preenchida (`...|000|5101||19580|18|3524,4|...`) antes do PIS.
  ⚠️ **E O CST E O CFOP SAEM DAS MESMAS RÉGUAS DO EFD ICMS/IPI**
  (`cstDoLancamento`, `convertCfopParaEntrada`, `serieDoC100`, `modeloDoDoc`):
  dois arquivos declarando CFOP diferente para o MESMO item seria a divergência
  que este projeto mais paga.
  🚨 **E FALTAVA UMA QUE O PVA AINDA NÃO TINHA COBRADO — o CST de PIS/COFINS da
  ENTRADA é o do FORNECEDOR.** O importer captura `cstPis` do XML desde #563 e
  o gerador o copiava, então a COMPRA saía com **01** — código que **nem existe
  na Tabela 4.3.7**, que é a das AQUISIÇÕES (50-56 com crédito, 70-75 sem, 98,
  99). Terceira vez da MESMA lição (CST do ICMS 00→90 em 18/08; IPI da IN RFB
  932/2009 em 11/08): **o CST do XML descreve a operação de quem EMITIU**. Na
  entrada quem decide é o REGIME de quem escritura — não-cumulativo 50, e
  cumulativo **70 com base e valor ZERO**, onde zero É a resposta ("não há
  crédito"). Na saída o documento é NOSSO e o CST do item continua vencendo.
  🚨 **E O `COD_CONT` DO M210/M610 ESTAVA CRAVADO EM `01`, que é o código do
  NÃO-CUMULATIVO** (Tabela 4.3.5; cumulativo é **51**). A PWR declarava `0110`
  com COD_INC_TRIB=2, o M200 preenchido nos campos do cumulativo… e o M210 com
  o código do outro regime: **o arquivo se desmentia dentro de si mesmo**. O
  aceito de 03/2026 traz `|M210|51|` e `|M610|51|`.
  📌 **C100 e C170 entraram em `CAMPOS_POR_REGISTRO` com a citação do recibo** —
  a trava de contagem existia desde 18/08 e ficou MUDA porque esses dois nunca
  tinham sido provados (eles voltavam em `naoConferidos`, que é o desenho
  certo: silêncio ali não é aprovação). ⚠️ Um teste que usava o C100 como
  exemplo de "registro não provado" foi TROCADO de fixture — trocar a régua
  para manter o teste verde seria desligar a trava que acabou de pegar o
  defeito.
  🚩 **PENDÊNCIA ABERTA, NOMEADA: a EXCLUSÃO DO ICMS DA BASE (Tema 69).** O
  arquivo aceito de 03/2026 declara `VL_BC_PIS` = **16.055,60** para um item de
  **19.580,00** — a diferença é exatamente o ICMS destacado (3.524,40). E o
  **próprio CFI já exclui** na ficha do Lucro (`basePisCofins =
  receitaBrutaEfetiva − icmsVendas − monofásico`, com o RE 574.706 citado na
  memória de cálculo). Ou seja: **a guia que o cliente paga sai de uma base e o
  SPED declara outra, MAIOR** — duas leituras do mesmo fato dentro do app. Não
  entrou neste PR porque muda VALOR (o C100 leva o PIS DESTACADO no documento e
  o C170/M210 o APURADO sobre a base reduzida, como o aceito mostra), e valor
  se fecha com o número na frente do dono.
  ✅ **FECHADA NO MESMO DIA — e o dono pediu junto a SEGUNDA dedução que faltava**
  (Paulo, 20/08, com a DANFE da NF 7 na mão: *"ele não deduziu o ICMS da base do
  PIS/COFINS e também não considerou o desconto no valor total da nota, só
  isso"*). Eram **duas** deduções faltando no MESMO campo, as duas na direção
  mais cara — o M210 declarava base **38.316,84**, que é a soma CRUA dos `vProd`
  das saídas. ✂️ `sefaz-backend/base-pis-cofins.js` (na `REGUAS_VIGIADAS`), lido
  pelo C170 e pelo bloco M.
  📌 **A PROVA DO DESCONTO É A PRÓPRIA DANFE**: `V. TOTAL PRODUTOS 18.741,24` ·
  `DESCONTO 562,24` · **`V. TOTAL DA NOTA 18.179,00`** — e a `BASE DE CÁLC. DO
  ICMS` é justamente 18.179,00, ou seja o ICMS já é calculado sobre a receita
  líquida. Com o ICMS de 3.272,22 fora, a base do PIS/COFINS daquela nota é
  **14.906,78**, não 18.741,24.
  🚨 **RECEITA E BASE SÃO CAMPOS DIFERENTES DO M210, e o gerador punha o MESMO
  número nos dois** — o aceito traz `VL_REC_BRT 19.580` × `VL_BC_CONT 16.055,60`.
  Juntar os dois apaga a exclusão de dentro do registro que deveria mostrá-la.
  ⚠️ **E O VALOR SEGUE A BASE, nunca o destacado**: o `vPIS` do XML foi
  calculado pelo emitente sobre a mercadoria cheia. No aceito, o C100 leva
  127,27 (o que o documento destacou) e o C170/M210 levam 104,36 (o que se
  apura) — dois FATOS diferentes, não duas versões do mesmo.
  ⚠️ **NA ENTRADA A EXCLUSÃO NÃO SE APLICA POR ANALOGIA**: o Tema 69 é sobre a
  RECEITA de quem vende; a base do crédito de quem compra é o valor da
  aquisição, e ali o ICMS é custo. Decidir por simetria seria inventar crédito.
  O que muda na entrada é só o DESCONTO.
  📌 **E o número vai DITO no aviso da geração** (receita − ICMS = base): valor
  que muda sozinho é o que faz desconfiar do número certo.
  ✅ **E O M205/M605 PASSOU A SAIR PREENCHIDO** (Paulo, na mesma mensagem: *"esse
  registro nós preenchemos manual, tem a possibilidade de já puxar preenchido?
  O ICMS na parte de obrigação veio preenchido"*). Dá — com o código PROVADO: os
  dois pares vêm do EFD-Contribuições aceito da própria PWR (03/2026),
  `|M205|12|810902|...|` e `|M605|12|217201|...|`, com `NUM_CAMPO 12` = *valor da
  contribuição CUMULATIVA a recolher*, que é o que o próprio PVA lista como
  valor válido. 🚨 **O regime NÃO-CUMULATIVO fica de FORA, nomeado**: o código de
  receita dele não está provado por arquivo aceito nenhum, e código errado no
  M205 declara o débito na receita errada da DCTF — mesmo desenho do 0002 e do
  código 9 do ISS fixo. M205/M605 entraram em `CAMPOS_POR_REGISTRO` no mesmo PR.
  ⚠️ Um teste MEU que exigia `VL_BC_PIS = vProd` foi TROCADO (premissa derrubada
  por arquivo aceito + decisão do dono), e a trava da FONTE passou a aceitar
  "arquivo ACEITO" além de "recusa do PVA" — as duas são fonte; memória não é.
  ✅ **RODADA 2 — a BASE e o M205/M605 fecharam; sobrou o `VL_REC_BRT`** (Paulo,
  20/08, com o M210 do PVA: *"deu certo a BASE DO PIS/COFINS sem o ICMS,
  M205/M605 já preenchidos tbm deu certo, apenas ajustar o desconto do VALOR DA
  RECEITA… valor correto tem que ser R$ 37.754,60"*). O registro mostrava
  **receita 38.316,84 × base 30.958,77** — ou seja o desconto saía da BASE e não
  saía da RECEITA, dentro do MESMO registro.
  🚨 **A CAUSA É A ARMADILHA DAS DUAS FORMAS, PELA 11ª VEZ, agora no DESCONTO**:
  a NF-e traz `<prod><vDesc>` **por item**, mas há emissor que só preenche o
  `<ICMSTot><vDesc>` do documento — e o importer guarda as DUAS casas
  (`itens[].vDesc` e `totais.vDesc`). Quem lê uma só vê a ausência **plausível**
  ("esta nota não tem desconto"), indistinguível do caso normal; aqui o efeito é
  declarar receita a MAIOR. `receitaEBaseDoDocumento` passou a ler as duas.
  ⚠️ **E NÃO DESCONTA DUAS VEZES**: o total do documento é a SOMA dos itens
  quando eles o trazem, então ele só entra quando NENHUM item declarou desconto
  — travado com fixture nas três formas (no item · só no total · nos dois), as
  três fechando em **37.754,60 / 30.958,77** com os números reais das 5 saídas.
  ✅ **PROVADO NO ARQUIVO em 20/08** — `|M210|51|37754,60|30958,77|||30958,77|0,6500|||201,23|…`
  —, e o desconto da PWR morava mesmo SÓ no total do documento, que era a
  hipótese. 📌 **Ler o ARQUIVO GERADO é o que fecha; print de tela não fecha**:
  eu tinha ficado duas rodadas deduzindo de onde vinha o 38.316,84, e a linha
  do M210 respondeu na primeira leitura.
  🐛 **E O MESMO ARQUIVO ENTREGOU O DEFEITO SEGUINTE, que ninguém tinha pedido:
  o `0100` saía `|0100|nome|cpf|crc|||||||||||`** — tudo depois do CRC vazio. É
  a MESMA recusa que o PVA já tinha dado no EFD ICMS/IPI da PWR em 19/08
  (*"Campo obrigatório · 13 - EMAIL"* e *"14 - COD_MUN"*), esperando no arquivo
  seguinte: eu corrigi o `getContadorPadrao` do orquestrador do FISCAL e o do
  EFD-CONTRIBUIÇÕES era a **SEGUNDA CÓPIA** — sem o e-mail padrão e **sem o
  campo `codMunIBGE` sequer existir**. Dono único em
  `sefaz-backend/contador-escrituracao.js` (na `REGUAS_VIGIADAS`), com os
  padrões vindos do 0100 do EFD **aceito** do próprio escritório (HS PROJETOS
  05/2026) e o env continuando a vencer.
  ⚠️ **Nenhum teste pegava, e não por falta de teste**: cada orquestrador fazia
  exatamente o que o próprio código dizia, e os dois "funcionavam" — a família
  do IPI em E200/E210 e do Bloco H zerado. E dois arquivos do MESMO mês
  declarando contabilistas diferentes é divergência que ninguém vai procurar.
- **🚨 A RECEITA DE ALUGUEL NÃO TEM DOCUMENTO — e o arquivo declarava
  CONTRIBUIÇÃO ZERO** (Paulo, 20/08, AFFITTARE 1139: *"o faturamento dela é
  aluguel, então não tem captura de notas, apenas a informação do valor em
  Locação de Bens na ficha financeira; para efeito de EFD CONTRIBUIÇÕES a
  informação vai no bloco F550"*). O CFI monta o EFD-Contribuições a partir dos
  DOCUMENTOS, e numa administradora de imóveis não existe documento de receita:
  o arquivo de 07/2026 saiu com **M200 e M600 ZERADOS** numa empresa que fatura
  ~R$ 21 mil/mês. Mesma classe do M200 zerado da MANTOAN e do Bloco H inteiro
  zerado — **campo de valor recebendo o default de quem não achou o dado**.
  ✂️ `sefaz-backend/receita-sem-documento-f550.js` (na `REGUAS_VIGIADAS`), com o
  EFD-Contribuições **ACEITO da própria AFFITTARE (05/2026)** fixando o registro
  campo a campo: `|F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33|||||`
  — CST **01**, base = receita, e os quatro últimos campos VAZIOS.
  ✅ **E O `IND_REG_CUM` DO 0110 FINALMENTE DERIVA DO QUE FOI GERADO**: o aceito
  declara **2** (competência, escrituração CONSOLIDADA) porque é o F550 que
  carrega a receita; quem escritura documento a documento continua **9**. O
  comentário do nosso `build0110` já previa este dia — *"se um dia existir o
  caminho consolidado, o valor passa a DEPENDER do que foi gerado, nunca a ser
  cravado"*. Um teste MEU que travava o `'9'` no TEXTO do arquivo foi TROCADO
  para provar pelo COMPORTAMENTO: travar a fonte impediria a própria correção.
  🚨 **A TRAVA QUE MANDA É A DUPLA CONTAGEM**: se a receita entrar pelo F550 E
  por um documento de saída, a contribuição sai declarada em DOBRO. Por isso só
  a **LOCAÇÃO** da ficha entra (as outras receitas têm documento e já vêm pelos
  blocos A/C/D — trazê-las "por garantia" seria criar a duplicidade), e período
  com saída junto vira **aviso nomeado com os dois números**. O app não escolhe.
  ⚠️ **E O CENTAVO É ONDE O E-FISCAL DEIXA DE SER GABARITO**: o arquivo aceito
  traz F550 = 141,76 e **M200 = 141,77** no MESMO arquivo (COFINS 654,33 ×
  654,34) — ele se desmente, porque calculou documento a documento (o 1900 dele
  declara `QUANT_DOC 3`) e somou arredondamentos. Nós não temos esses 3
  documentos — é por isso que a receita vem da ficha —, então reproduzir o
  141,76 exigiria inventar o rateio. **F550 e M200 nossos saem do MESMO
  número**: um centavo contra o e-Fiscal é aceitável, arquivo que se contradiz
  não é (régua de 11/08: referência, nunca gabarito; VALOR de lá não é verdade).
  ❌ **O "PROVADO NO PVA" DE 21/08 DE MANHÃ ERA FALSO — o print era o arquivo
  de MAIO do e-Fiscal aberto no validador, não o nosso** (à tarde Paulo mandou
  o arquivo REAL gerado: `F001|1`, sem F550, M200/M600 zerados — *"erro da
  empresa, segue anexo como está e como deve ser"*). Eu carimbei prova com
  números que batiam (141,76/654,33 = os de MAIO) sem notar que o nosso F550
  jamais poderia ter saído: **a régua lia a forma do INPUT
  (`faturamentoLocacao`/`faturamentoFiliais.locacao`) e a ficha GRAVADA usa os
  nomes ACHATADOS (`faturamentoMesLocacao`/`faturamentoFiliaisLocacao`)** — a
  armadilha das duas formas, agora entre o LucroInput e a fichaFinanceira[].
  Zero silencioso indistinguível de "não faturou", pela 13ª vez.
  ✂️ `receitaDeLocacao` lê as DUAS formas; a competência da ficha casa
  NORMALIZADA (`normalizarCompetencia` do ipi-varredura — mesReferencia existe
  em YYYY-MM, YYYY-MM-DD e MM/YYYY); e período sem receita NENHUMA (nem saída,
  nem locação) sai DITO no aviso ("M200/M600 vão declarar ZERO"), porque zero
  ali é afirmação à Receita. 📌 **LIÇÃO DO CARIMBO: print de validador só prova
  o arquivo cujo NOME/número se conferiu** — valores que batem podem ser o
  arquivo de referência aberto do lado. A prova real é o PVA sobre o arquivo
  REGERADO pelo CFI.
  🚨 **E A 2ª RODADA DO PVA ENSINOU O PERFIL: arquivo CONSOLIDADO não leva
  documento** (Paulo, 21/08, com o Relatório de Erros de Importação: *"está
  puxando a NFS de serviços tomados… tem que ter a opção apenas para o que
  gera receita"*). Com o F550 no arquivo (IND_REG_CUM **2**), o A010/A100 do
  serviço TOMADO voltou com *"O registro não deve ser informado para esse
  PERFIL e/ou tipo de operação"* — e no regime CUMULATIVO o tomado não gera
  crédito nenhum, então excluí-lo **não muda um centavo** da apuração; o
  aceito de 05/2026 da própria empresa tem o bloco A **VAZIO**.
  ✂️ O orquestrador tira os documentos de ENTRADA quando o arquivo sai
  consolidado — **ANTES da coleta de participantes/itens**, senão 0150/0200
  ficariam órfãos (outra recusa do PVA) — e DIZ quantos saíram.
  ⚠️ **O caminho DETALHADO não exclui nada**: o PVA ACEITOU as entradas da
  MANTOAN (IND_REG_CUM 9), e mexer em arquivo aceito sem recusa que mande é
  inventar leiaute. Documento de SAÍDA nunca é excluído: convivendo com o
  F550, quem fala é a trava de dupla contagem.
  🚦 **E A RECUSA VIROU REGRA NO MESMO PR** (`conferirPerfilConsolidado`, em
  `sped-contrib-campos.js`): o arquivo consolidado que declarar A010/A100/C100/
  D100 sai com aviso ANTES do PVA, com a recusa literal como fonte. Ela lê as
  LINHAS do arquivo gerado (nunca o objeto em memória — foi auditar a intenção
  que deixou o C100 sair com modelo 55 e chave 65 por meses) e fica MUDA no
  arquivo detalhado. É a mesma disciplina do PVA de bolso do ICMS/IPI: **recusa
  aprendida entra na prevalidação no MESMO PR**, senão volta no mês seguinte
  com outro CNPJ.
- **🚨 O CAMPO DE VALOR COMIA A VÍRGULA ENQUANTO A PESSOA DIGITAVA — e o
  documento ASSINADO saiu 100× maior** (colaboradora via Paulo, 21/08, APATEL
  0371: *"os valores do consultor não estão puxando ponto e vírgula"*). Ela
  colou os valores do e-Fiscal ("3.241.688,71") na Declaração de Faturamento e
  o PDF saiu com **324.168.871,00** — total de **R$ 4,2 BILHÕES** numa empresa
  de R$ 42 milhões, num papel que vai assinado para banco.
  🔴 **A CAUSA NÃO ERA O PARSE — era o INPUT CONTROLADO re-formatando a cada
  tecla**: o campo exibia `String(número)` e re-parseava o próprio texto
  exibido. Na tecla da vírgula o parse devolvia o inteiro, o render apagava a
  vírgula da tela, e os dígitos seguintes grudavam: "3241688,71" virava
  324168871 tecla a tecla, sem nenhum erro aparecer. O usuário FEZ tudo certo.
  ✂️ TRÊS correções: (1) o campo guarda **TEXTO cru** (rascunho — o padrão dos
  campos de CFOP); (2) o parse virou régua pura (`parseValorMoeda` em
  `declaracaoFaturamento.ts`), aceitando as formas reais (pt-BR colado,
  digitado sem milhar, ponto decimal JS) e devolvendo **null** para o ilegível
  — nunca um número inventado; (3) **o que o app ENTENDEU aparece formatado ao
  lado** ("ajustado = R$ 3.241.688,71") e o ilegível sai em vermelho com o
  formato esperado. Num documento assinado, a interpretação se mostra ANTES do
  PDF.
  📌 **REGRA QUE FICA: input de valor NUNCA é controlado por `String(número)`**
  — texto no estado, número derivado. Re-formatar no meio da digitação é comer
  o que a pessoa digitou, e o erro sai com cara de dado certo. Travado em
  `declaracaoFaturamento.test.ts` (barra o `String(ajustes[...])` na fonte).
- **🚨 CAMPO OBRIGATÓRIO NÃO NASCE COM EXEMPLO CINZA DENTRO** (Paulo, 20/08, o
  segundo dos "2 erros": aba **🧠 Por fornecedor**, POXPUR, CFOP de origem 5101,
  e o botão *🧠 Criar parâmetro* apagado). O campo "Escriturar como" estava
  **VAZIO** — o `1556` que aparecia ali era o **placeholder**. Ele leu como
  preenchido, clicou, e nada aconteceu: **a única saída que sobra para quem não
  vê efeito é repetir o clique** (a família do "Já importado" sem estado, 14/08,
  e do botão que não faz nada).
  ✂️ Duas correções, e a segunda vale mais que a primeira: (1) campo de CFOP
  nesta casa tem **UM** placeholder — o mesmo `—` da aba ✏️ CFOP por nota;
  exemplo com cara de valor preenchido é mentira barata; (2) **botão desligado
  DIZ o que falta**, com as duas causas separadas (escolher fornecedor × os 4
  dígitos do CFOP), porque elas pedem ações diferentes. Travado por varredura em
  `cfopCerebro.test.ts`: placeholder de 4 dígitos neste campo é barrado.
  🚨 **E A CORREÇÃO NÃO BASTOU — ele voltou com outro print: *"o componente
  Escriturar como continua desabilitado"*.** O campo **NÃO estava**: montei o
  painel num teste de RENDER, digitei nele e o botão ligou (`cfopCerebroPainel
  Campo.test.tsx`). O que engana é a **VIZINHANÇA** — os dois campos ao lado são
  `<select>` COM valor, e um input de texto com um `—` cinza no meio deles lê-se
  como célula de SAÍDA, não como campo. **Para quem usa, "parece desabilitado" e
  "está desabilitado" são a mesma coisa: nos dois casos ele não digita.**
  ✂️ Vazio passou a vir **destacado** (anel azul, que sai quando preenche) e a
  linha de baixo — a MESMA que mostra a descrição oficial do CFOP — passa a
  DIZER que ali se digita, com exemplos (1556 uso/consumo · 1551 ativo · 1102
  revenda) **FORA do campo**: dentro dele já foi o `1556` cinza lido como valor.
  📌 **REGRA QUE FICA: varredura de fonte prova o CÓDIGO, não a TELA.** A trava
  anterior conferia o placeholder e a mensagem no texto do arquivo — e não
  conferia o que o dedo dele encontrou. Campo que a pessoa PRECISA preencher se
  prova RENDERIZANDO e digitando (`@testing-library/react` já está no projeto);
  é a régua de sempre — validação por RESULTADO, não por status.
- **✍️ O CST VIROU CAMPO POR NOTA — e o campo é a TRIBUTAÇÃO, nunca o CST
  inteiro** (Paulo, 19/08: *"teria a possibilidade de ajustarmos o CST e
  visualizar o CST que vem na nota do fornecedor?"*). Coluna **CST informado**
  na aba ✏️ CFOP por nota, `documentos_fiscais.cstEscriturado` + carimbo, com a
  precedência **NF > régua automática** — a mesma do CFOP (17/08).
  🚨 **A ARMADILHA QUE OBRIGOU O RECORTE**: a ORIGEM da mercadoria mora no 1º
  dígito e é fato da MERCADORIA, não da operação — aceitar "090" cru faria todo
  produto IMPORTADO (`100`) virar NACIONAL dentro do SPED. Então só a
  TRIBUTAÇÃO é informada (2 dígitos) e a origem vem SEMPRE do item; digitar 3
  dígitos vale a tributação, e a tela diz isso. `validarCstEscriturado` recusa
  o que não está na **Tabela B** (00/10/20/30/40/41/50/51/60/70/90) — campo
  fiscal digitado sem trava vira dado que só a fiscalização acha.
  ⚠️ **A precedência mora no DONO** (`cstDoLancamento` ganhou o 3º parâmetro),
  nunca na tela: C170 e C190 chamam a MESMA função e um `if` na tela faria o
  detalhe e o consolidado do mesmo item divergirem. A função local do bloco C
  foi RENOMEADA para `cstDoItemNoArquivo` — dar a ela o nome do CAMPO
  (`cstEscriturado`) é o começo de duas respostas divergentes (lição de 18/08,
  a porta do frontend que virou `perguntarDebitosJaEnviados`).
  🔎 **E "ver a nota" entrou junto**: o Nº NF ganhou o link de consulta no
  **portal NACIONAL da NF-e** (pela chave) e o ⧉ de copiar a chave. **NÃO é
  "PDF da nota"**: o CFI não emite DANFE, e prometer o PDF seria promessa que a
  tela não cumpre (a lição do ✕ de 14/08). Sem chave de 44 dígitos o botão não
  aparece — botão que não faz nada é pior que botão nenhum.
- **♻️ A NOTA "VAZIA" GANHOU O BOTÃO DE RELEITURA — e a régua separa o que ele
  RESOLVE do que ele NÃO resolve** (Paulo, 19/08, depois do procedimento "não
  digitem nada, aguardem o botão": *"esse botão ainda não construído né, tenho
  outra empresa que puxou sem NF, SEM CST E CFOP"*). Botão **♻️ Reler XMLs
  guardados** na aba ✏️ CFOP por nota (admin — a rota ESCREVE em documento
  fiscal), `POST /api/admin/sefaz/reler-notas-vazias` → `relerNotasVazias` no
  xml-importer. A classificação é PURA (`releitura-notas-vazias.js`, na
  `REGUAS_VIGIADAS`) e o resultado responde **POR CAUSA**, porque cada uma tem
  ação própria: **preenchidas** (XML completo guardado, itens/nº relidos) ·
  **só o RESUMO na base** (o arquivo guardado É o resNFe de ~531 bytes — reler
  não cria item; a ação é importar o XML COMPLETO, que desde o caso PWR
  completa a nota por cima) · **sem arquivo** (buraco de captura, 📊 Status) ·
  **fora do escopo** (NFS-e/CT-e — item não vem de `<det>`). Fundir tudo num
  número só seria o "0 recuperadas · 664 já tinham" de 13/08 outra vez.
  📌 **O Nº SAI DA CHAVE quando falta** (posições 26-34 — a chave não mente):
  até o resumo, que não tem `<nNF>`, deixa de ficar cego na tela antes de o
  XML completo chegar. Carimbo `numeroOrigem: 'chave-de-acesso'`.
  ⚠️ **SEM carimbo de versão, de propósito**: a condição-alvo (sem itens/nº) se
  limpa sozinha no preenchimento; carimbar os "só resumo" esconderia justamente
  os que ainda esperam o XML completo. Backfill continua NÃO apagando nada
  (`patchDaReleitura` só preenche vazio). Difere do `relerItensFiscais` (que
  melhora CAMPOS de item em nota que JÁ TEM itens): este cria os itens do zero.
- **🚨 O SALDO CREDOR ANTERIOR SAÍA ZERO — e zero num campo de saldo é uma
  AFIRMAÇÃO à SEFAZ** (Paulo, 17/08: *"essa empresa possui saldos acumulados de
  meses anteriores… a apuração não está considerando o saldo que já vinha sendo
  acumulado nas competências anteriores"*). Fui ler: são **TRÊS apurações com
  TRÊS comportamentos**, e nenhum avisava. **ICMS próprio** (E110 c.10) lê
  `saldoCredorIcms` da ficha da competência ANTERIOR — mas na ficha esse campo é
  o que **ENTROU** naquele mês, não o que **SOBROU** dele: transporta DEFASADO e
  ignora a movimentação do próprio mês anterior. **IPI** (E520): o gerador lê
  `saldoCredorIpiAnterior` e **o orquestrador nunca passa esse campo** ⇒ sempre
  0,00. **ICMS-ST** (E210): `apurarStDaUf` aceita `saldoCredorAnterior` e
  **ninguém passa** ⇒ sempre 0,00.
  ⚠️ **Para quem tem crédito acumulado isso recolhe a MAIOR — e nada denuncia,
  porque o arquivo é ACEITO.** É a família do Bloco H zerado: campo de valor
  recebendo default.
  ✂️ Este PR **não inventa o saldo** (seria adivinhar imposto): faz o que a casa
  faz com ausência — `saldo-anterior-apuracao.js` **DIZ** que declarou zero e
  por quê, com a ação na frase, e o número que existe sai **CARIMBADO com a
  origem** e com a ressalva de que ele não é o saldo que sobrou. Aviso só nasce
  para o bloco que REALMENTE saiu (`geraIpi`/`geraSt` vêm do tamanho das linhas
  produzidas, nunca do cadastro) — alarme sobre bloco inexistente é o que ensina
  a ignorar alarme.
  ✅ **A CRONOLOGIA EXISTE DESDE 21/08 — aba 🧮 Saldo de abertura no card
  SPED** (`saldo-abertura.js`, na `REGUAS_VIGIADAS`; rota
  `/api/admin/sped-fiscal/saldo-abertura`; coleção `sped_saldos_abertura`).
  Cola-se o .txt do **último SPED ENTREGUE** — o backend lê o **E110 c.14** e o
  **E520 c.7**, confere o CNPJ contra a empresa (arquivo de outro cliente é
  recusado NOMEADO) e carimba a abertura. Daí em diante o transporte é
  **CALCULADO** mês a mês com a MESMA matemática do E110
  (`aplicarAjustesApuracao` — nunca uma segunda fórmula), e a geração PREFERE a
  cronologia sobre a ficha, com a origem no aviso. **Não há campo de digitar
  valor, de propósito**: saldo digitado é a ficha de novo, com outro nome.
  TRÊS TRAVAS: não retroage (competência ≤ abertura já foi entregue com outro
  número); elo faltando derruba a cadeia NOMEADO (mês sem leitura não vira zero
  calado); cadeia > 12 meses pede um SPED entregue mais novo em vez de custar N
  consultas por geração. **O que falta é só o USO**: colar o SPED entregue de
  cada empresa do Lucro com crédito acumulado — decisão de operação, não código.
  🚨 **E O PARSER TS DO E520 LIA POSIÇÕES ERRADAS — pego ao construir isto**: o
  plano era reusar o `valorSaldoCredorIpi` do `spedFiscalParserService`, que
  mapeava `fields[4]` — a posição do **VL_OD_IPI** (outros débitos, quase
  sempre 0,00). O leiaute real é |E520|VL_SD_ANT|VL_DEB|VL_CRED|VL_OD|VL_OC|
  VL_SC|VL_SD| e a tela 🪞 mostrava o **VL_CRED como "IPI a Recolher"** e o
  VL_OD como "Saldo Credor" — zero plausível, ninguém desconfiou (pouquíssimos
  clientes têm IPI). A prova é a linha real da PWR: 2.547,39 + 2.200,45 =
  4.747,84 só fecha com o campo 7 sendo o credor. Corrigido parser, tipo e
  tela no mesmo PR. **Reusar leitor existente sem conferir contra uma linha
  REAL é herdar o defeito dele com carimbo de régua única.**
  ⚠️ **E A ARMADILHA DAS DUAS FORMAS MORDEU DENTRO DO PRÓPRIO MÓDULO NOVO, no
  primeiro teste**: a coerção de texto SPED (tira ponto de milhar, vírgula →
  ponto) aplicada a um número JS transforma 2547.39 em **254739** — cem vezes o
  saldo, calado. Viraram DUAS funções nomeadas (`numArquivo` × `numJs`), cada
  leitura com o seu dono.
  📌 **E ST NUNCA SE SOMA AO ICMS PRÓPRIO NO DEMONSTRATIVO**: são apurações
  distintas e a de ST é **POR UF DE DESTINO** (E200/E210/E220/E250, uma GNRE por
  estado) contra E100/E110/E111 do próprio. Hoje o demonstrativo 📊 ICMS·IPI·ISS
  não mostra ST — e o que falta ali não é somar, é **DIZER** que não mostra
  (quem lê não distingue "não teve ST" de "o app não olha ST").
  ✅ **O IPI FECHOU EM 19/08 — caso PWR 07/2026** (Paulo, com o PVA e a ficha
  lado a lado: *"só o valor do saldo credor anterior de IPI não está puxando,
  só isso para eu transmitir o SPED dela"*). A ficha dizia **Cred. IPI do mês
  anterior R$ 2.547,39** e o E520 saía 0,00. O orquestrador passou a alimentar
  `saldoCredorIpiAnterior` — e a conta prova o fio: 2.547,39 + 2.200,45
  (créditos do mês) = **4.747,84**, exatamente o "IPI a transportar p/ 08/2026"
  da mesma ficha.
  ⚠️ **A FONTE É A FICHA DA PRÓPRIA COMPETÊNCIA, não a anterior**: na ficha, o
  campo `saldoCredorIpi` de M já significa "o que ENTROU em M" — a semântica
  exata do VL_SD_ANT_IPI. Copiar o desenho do ICMS (que lê a ficha ANTERIOR)
  repetiria a defasagem que este mesmo registro denuncia. O aviso do
  `saldo-anterior-apuracao` agora carimba a origem quando o valor existe — e
  diz que ele foi **digitado, não calculado**, com a conferência (VL_SC_IPI do
  último SPED entregue) na frase.
  ⚠️ **E o saldo anterior passou a SEGURAR o E500/E520 de pé**: mês sem
  movimento de IPI mas com crédito vindo de trás gera o bloco mesmo assim,
  senão o saldo some da corrente de transporte em silêncio — que é o defeito
  original com outra roupa. Sem movimento E sem saldo, o bloco continua não
  saindo (comércio sem IPI não ganha registro indevido). Travado em
  `spedE520SaldoAnterior.test.ts` com a linha real da PWR
  (`|E520|2547,39|0,00|2200,45|0,00|0,00|4747,84|0,00|`) e varredura do
  orquestrador (gerador que lê campo que ninguém passa era o defeito — o teste
  exige quem passa, de onde, e que falha de leitura vire aviso nomeado).
  ICMS (defasado) e ST (0,00) continuam como estavam, ditos pelo aviso.
- **🚨 "CANCELADA" TINHA SEIS RÉGUAS — e o campo cru MENTE justamente no caminho
  NORMAL** (17/08, ao conferir a MV LIDER 639 07/2026 para o Paulo: a aba 🚫
  Canceladas/Faltantes dizia *"✓ numeração contínua · 0 cancelada(s)"*). A régua
  da LEITURA (`docCancelado`: status OU cStat legado 101/151 OU evento 110111
  com 135/155) nasceu em **11/08, para ESTE MESMO CLIENTE** — e tinha sido
  aplicada no CÁLCULO e em quase nada mais. **O cancelamento chega por EVENTO, e
  nesse caminho o campo `status` continua 'autorizado'**: as cópias só erram no
  caso comum, que é o pior lugar para um defeito silencioso.
  Onde estava: selo 🟢 **Vigente** numa nota cancelada (`NFeStatusCell`); PDF da
  lista somando cancelada no *"valor líquido"*; **Exportar SAGE gravando situação
  0 no .FML** ⇒ o livro do cliente recebia de volta a nota que o CFI já tinha
  tirado; helper próprio na `rotina-fiscal`; e o pior — **o EFD-Contribuições**:
  C/D/F pulavam pelo campo cru e o **bloco A não pulava nada**, ou seja **NFS-e
  cancelada ia DECLARADA à Receita** com PIS/COFINS calculados em cima dela.
  ✂️ Trava por **VARREDURA**, não por lista (`canceladaReguaUnica.test.ts`):
  acusa `status === 'cancelado'` em `components/`, `services/` e
  `sefaz-backend/`. **A exceção se declara COM o motivo** — TAREFA cancelada é
  outro domínio, e **NFS-e é o caso em que o campo NÃO mente** (ADN e portal não
  têm evento; quem informa o cancelamento é o próprio documento). É essa a
  fronteira: o campo cru só mente onde existe o caminho do evento.
  ⚠️ No bloco A a cancelada é **PULADA, não marcada `COD_SIT '02'`** — o leiaute
  do documento cancelado ali não está provado contra arquivo aceito, e inventar
  código de situação é o oposto da régua da casa.
  ⚠️ E o falso positivo da varredura se resolveu **renomeando** a variável
  derivada para `situacao` em vez de virar exceção: o resultado da régua não se
  chama como o campo cru, senão a próxima leitura confunde os dois de novo.
- **🚨 A MESMA NF-e É SAÍDA DE UMA EMPRESA E ENTRADA DA OUTRA — e a captura
  TROCAVA A NOTA DE DONA a cada rodada** (Paulo, 17/08: *"importei as notas de
  saída da KROYA e algumas delas foram emitidas para a GOLDLOG… preciso
  importar/escriturar a mesma NF-e nas duas empresas?"*). **Precisa** — são dois
  contribuintes e dois livros (saída/débito numa, entrada/crédito na outra). E o
  CFI não fazia: em `documentos_fiscais` **o id do documento é a CHAVE**
  (`xml-importer.js`, `xmlFiscalService.ts`), então **uma chave só comporta UM
  dono**.
  🔴 **E O DANO ERA MAIOR QUE A RECUSA NA TELA**: na captura automática o
  importer não recusava — ele **REATRIBUÍA** (`status: 'reatribuido'`). Aquilo
  nasceu para o caso GUARANI (27/07: notas **SEM DONO**, invisíveis em qualquer
  filtro por cliente) e nunca previu **duas empresas da mesma carteira
  negociando entre si**: com as duas capturando, a nota trocava de lado toda
  rodada e o livro de quem perdeu ficava a menor **sem nada acender**.
  ✂️ `documento-posse.js` (na `REGUAS_VIGIADAS`): **dono errado é dono que NÃO É
  PARTE do documento**. Se o CNPJ de quem está com a nota é o emitente ou o
  destinatário dela, ele não é dono errado — é a CONTRAPARTE, e tirar dele apaga
  a escrituração de um contribuinte. `sem-dono` e `dono-nao-e-parte` continuam
  reatribuindo; `contraparte-legitima` **não**, e a recusa sai NOMEADA no
  resultado (nota que não entrou e ninguém soube é buraco escondido).
  ⚠️ **AUSÊNCIA NÃO É PROVA**: dono cujo CNPJ não está gravado vira
  `posse-indeterminada` e a nota FICA onde está — afirmar erro no escuro é
  justamente o que estava corrompendo dado.
  ⚠️ **E A MENSAGEM DA IMPORTAÇÃO MANUAL DAVA O CONSELHO ERRADO**: *"a nota
  precisa ser corrigida na origem"* mandaria o colaborador cobrar do cliente uma
  nota **perfeita**. Agora, quando as DUAS são partes, ela DIZ que ninguém errou
  e que o limite é do CFI. 🐛 A primeira versão dessa condição perguntava só *"a
  empresa escolhida é parte?"* — o que engolia o caso de posse errada de verdade
  (escolhida parte × dono não-parte); pego pelo teste na hora, e a tela passou a
  chamar a MESMA régua em vez de ter cópia.
  🚧 **A RAIZ CONTINUA ABERTA — a identidade do documento ainda não separa os
  dois lados.** Enquanto isso o lado que falta se lança pelo ✍️ **sem preencher
  a CHAVE** (com a chave ele cai no mesmo documento), e essas notas SAEM quando
  a correção subir, senão contam duas vezes.
  ✅ **CASO REAL CONFIRMADO 19/08 — o desenho funcionou** (Paulo: *"esse CNPJ é
  da GOLDLOG. Nas capturas, foi escriturado pelo consultor o movimento de
  entrada na GOLDLOG (nota+chave de acesso), sua contrapartida que foi a SAÍDA
  da KROYA foi lançada manualmente, conforme orientado"*). `17.390.490/0001-82`
  É a GOLDLOG — a captura automática trouxe a entrada dela pela chave
  (`contraparte-legitima`, sem reatribuir), e a saída correspondente da KROYA
  entrou pelo ✍️ sem chave, exatamente o contorno que a `RAIZ CONTINUA ABERTA`
  pede. **Pendência FECHADA** — os dois lados estão escriturados, cada um no
  contribuinte certo, sem duplicidade e sem nota trocando de dono.
- **🚨 O RELATÓRIO DE RETENÇÕES SUMIA JUSTAMENTE AS NOTAS QUE PRECISAVA MOSTRAR**
  (Paulo, 19/08, CLUDE 07/2026: *"Relatório de Retenções, onde deve conter as
  notas com os devidos impostos retidos"* — a tela mostrava **0 NFS-e · base
  R$ 0,00** para uma competência com **67 notas tomadas**, todas capturadas
  antes de 01/08 e sem IR/INSS/CSLL gravados). `linhasRetencoes` filtrava por
  **soma > 0** — e nota sem os campos gravados soma exatamente ZERO, igual a
  nota CONFIRMADA sem retenção (campos presentes, valor 0). As duas caíam no
  MESMO balde: sumidas. O aviso "ausência ≠ zero retido" continuava escrito no
  rodapé, mas sobre uma lista vazia — o alerta nunca tinha nota nenhuma pra
  apontar.
  ✂️ A régua virou **"exclui só quem tem CERTEZA de zero"**: fica de fora
  apenas quem tem `retencoesFederaisGravadas` (IR/INSS/CSLL presentes no
  documento, não `undefined`) **e** soma zero — aí "sem retenção" é fato, não
  lacuna de captura. Nota sem os campos entra na lista, marcada.
  ⚠️ **E CADA LINHA VIROU HONESTA POR SI SÓ**: incluir a nota sem marcar nada
  faria o PDF imprimir "IR 0,00 · INSS 0,00 · CSLL 0,00" linha a linha,
  desmentindo o próprio aviso do rodapé — alarme geral e dado por linha
  discordando na mesma folha é a armadilha de sempre. As três colunas (IR,
  INSS, CSLL) saem com **"?"** em vez de 0,00 quando `!retencoesFederaisGravadas`,
  nas abas Serviços tomados/prestados/Retenções igualmente (a mesma lacuna
  vale nas três). PIS/COFINS/ISS retido não levam "?" — o flag só cobre os
  federais que o e-Fiscal antigo não capturava.
  🚨 **E A SEGUNDA METADE ERA A ARMADILHA DAS DUAS FORMAS, PELA NONA VEZ**
  (mesmo dia, ao construir o ♻️): o importador do CSV do portal grava
  `valorIr`/`valorInss`/`valorCsll` ACHATADOS na raiz e o relatório só lia
  `valores.*` — nota com IR **gravado** imprimia "?". A leitura virou do DONO
  (`lerRetencoesFederaisDoDoc` em `reinf-retencoes-pj.js`, o mesmo que alimenta
  o R-4020; na `REGUAS_VIGIADAS`), nunca uma segunda cópia. ⚠️ **E a assinatura
  de alíquota passou a decidir NA TELA o que o campo É** (a régua de 07/08,
  `conferirRetencaoFederal`): "CSLL" valendo 4,65% da base é o **TOTAL das três
  (CSRF)** — sai da coluna e vai **marcado com †**, fora da soma, senão PIS e
  COFINS contam em dobro (caso CLINIPAR); PIS 1,65% + COFINS 7,60% é **tributo
  da OPERAÇÃO do prestador** — fora das colunas e dos totais, dito na legenda
  (caso ATLAS). A nota com CSRF sem rateio **não some da aba Retenções**: a
  retenção existe, só não tem rateio no documento.
- **🚨 O EFD-CONTRIBUIÇÕES DE SERVIÇO SAÍA DECLARANDO ZERO — e o arquivo mentia
  sobre si mesmo em três lugares** (Paulo, 17/08: *"fui testar um EFD
  Contribuições de prestação de serviço e puxou zerado alguns blocos"*, depois
  *"teste com 2 empresas que tem movimento e o mesmo erro"*). CLINICA MEDICA
  MANTOAN 07/2026: **37 registros A100, todos com COD_PART VAZIO e VL_DOC
  0,00**. Os documentos ESTAVAM no banco — o que faltou foi a LEITURA: é a
  **armadilha das DUAS FORMAS** (11/08) pela oitava vez, agora no bloco A. A
  NFS-e do portal de SP entra ACHATADA (`cnpjDest`, `valorTotal`) e o gerador
  lia só a ANINHADA (`nota.destinatario`, `nota.valor`). A régua já existia num
  lugar só (`normalizarParticipantesDoc`) e o bloco A não a chamava; o
  orquestrador tinha a MESMA falta, e por isso o **0150 saía vazio** — sem
  cadastro de participante, o COD_PART do A100 apontaria para o nada.
  ✂️ E o valor virou `valorDoDocumentoServico`, que **devolve NaN quando nenhuma
  forma tem número** — de propósito: "documento de R$ 0,00" e "não achei o
  valor" são coisas diferentes, e foi o zero silencioso que produziu 37 linhas
  zeradas num arquivo entregue à Receita.
  🚨 **E A AUDITORIA DE SAÍDA NÃO PEGOU PORQUE SÓ O A170 ERA VIGIADO** — e
  aquele arquivo não tinha **nenhum** A170, então a trava de "coluna zerada em
  100% das linhas" não teve o que olhar. `A100 → VL_DOC` entrou em
  `DETALHES_VIGIADOS`, e o teste PROVA contra as linhas reais do arquivo do
  Paulo. É a regra de 06/08: **detalhe novo entra em `DETALHES_VIGIADOS` no
  mesmo PR** — quem não entra envelhece em silêncio.
  🚨 **E O `0110` DIZIA `IND_REG_CUM = 1`, que é regime de CAIXA consolidado no
  registro F500 — que este gerador NUNCA produz.** O arquivo afirmava sobre si
  mesmo uma coisa que não fazia. O EFD do E-Fiscal **ACEITO** (06/2025, mesmo
  cliente) usa **9** = escrituração DETALHADA nos blocos A/C/D/F, que é o que
  este gerador de fato faz. Régua "arquivo aceito > leiaute deduzido" pela
  quarta vez (R-4020, E510, R-2010, agora o 0110).
  🐛 **E A TERCEIRA PONTA ERA A PORTA DE SAÍDA DO PROBLEMA**: a RADIO E TV
  IBIRAPUERA (DF, sem trilho de captura) tinha **zero documento** e ficha de
  R$ 2.000 — o caminho para isso é o ✍️ **Lançar nota sem XML**, que estava
  **quebrado para todo mundo, inclusive admin**: *"Falha ao gravar: Missing or
  insufficient permissions"*. A regra de `documentos_fiscais` exige
  `createdBy == request.auth.uid` no CREATE e **não abre exceção para admin**;
  o objeto montado não levava o campo. Ou seja **a terceira porta nunca gravou
  uma nota**. Agora o UID viaja, e a validação **RECUSA ANTES com a causa
  escrita** ("saia e entre de novo") em vez de deixar o banco responder —
  "Missing or insufficient permissions" manda a pessoa procurar problema de
  permissão que não existe.
- **🚨 PDF GIRADO (`/Rotate 90`) FAZIA O PARSER LER O EIXO ERRADO — e ele acusava
  a COLABORADORA de um erro que era DELE** (Paulo, 17/08, urgente: *"a
  colaboradora reporta este erro do CFI, porém ela analisa está correto"*, caso
  CLUDE, análise de créditos de 07/2026). A tela mostrava **0 lançamentos**,
  R$ 0,00 em tudo, e uma "divergência" citando *"Valor da NF: PDF=R$ 5017.50"* —
  **número que não existe no documento**. O rodapé real é
  `Total 580.395,26 · 66.652,60 · 0,00 · 0,00`.
  **A CAUSA**: este relatório do E-Fiscal sai em **A4 RETRATO (595×842) com
  `/Rotate 90`** — paisagem GIRADA. O `efiscalPdfParserService` extrai por
  COORDENADA X e usava `item.transform[4]`, que é o espaço do PDF **antes** da
  rotação: com /Rotate 90 aquilo é o eixo VERTICAL do que a pessoa vê. As janelas
  de coluna (calibradas num PDF de mediabox paisagem) nunca casavam ⇒ nenhuma
  linha reconhecida. A correção é compor a matriz do item com a do **VIEWPORT**,
  que é quem conhece o `/Rotate`; para `/Rotate 0` ela devolve o mesmo x, então
  nada regride. ⚠️ **No espaço do viewport o Y cresce PARA BAIXO** — a ordenação
  das linhas virou y CRESCENTE, senão a linha "Total" (a última) viraria a
  primeira e a razão social de duas linhas colaria na nota errada.
  ✅ **PROVADO contra o PDF real: 137 notas e os totais batem CENTAVO A CENTAVO**
  (580.395,26 · 66.652,60). Antes: zero.
  🚨 **E O SEGUNDO DEFEITO ERA PIOR QUE O PRIMEIRO: o app INVENTAVA o total.** O
  rodapé era "a última linha sem data que tivesse valor numa janela" — qualquer
  token que caísse ali por acidente virava o total impresso, e foi de onde saiu o
  R$ 5017,50. Agora o rodapé se identifica pela palavra **Total** (âncora no token
  inteiro: existe fornecedor "TOTAL PASS PARTICIPACOES"), e **sem rodapé não se
  afirma divergência nem se dá verde** — vira `nao-conferido`, porque comparar
  contra zero acusaria o relatório inteiro justamente quando a extração está
  perfeita. **Total que o app inventa é pior que total que ele não acha**: manda
  a pessoa revisar uma conta certa.
  ✂️ A tela separa os **TRÊS** estados (confere · não conferido · divergente) e
  **zero notas** passou a ser dito como BURACO DE LEITURA, com a ação certa
  ("mande o PDF ao time — **não refaça a conta à mão**"), em vez de relatório
  vazio.
  **REGRA QUE FICA: parser por coordenada é calibrado numa AMOSTRA, então a régua
  mora em módulo PURO e testável.** Ela vivia dentro do arquivo que importa
  `pdfjs-dist`, que **não carrega no jest** — ou seja, era inexercitável por
  teste, e foi exatamente por isso que isto passou. `services/efiscalPdfGeometria.ts`
  guarda as janelas, os regexes e o `mapearTokens`; o teste mede as DUAS rotações
  com as coordenadas reais **sem PDF de cliente no repositório**.
  🐛 E o teste pegou um defeito meu na hora: escrevi `/^totais?$/`, que casa
  "totai" e "totais" e **nunca "Total"** — a correção teria subido sem achar
  rodapé nenhum, trocando um total inventado por um "não conferido" eterno.
- **🐛 ATIVAR A EMPRESA ABRIA A TELA SEM CARREGAR A EMPRESA — tela BRANCA no
  LP/LR** (Paulo, 17/08, com print: *"as fichas do LP/LR não estão aparecendo
  quando ativamos a empresa, elas aparecem quando ativamos empresas do
  SIMPLES"*). Defeito MEU do PR de 15/08. O atalho da empresa ativa marcava
  `view = 'details'` + o id e **parava ali**, sem passar pelo `abrirEmpresa`,
  que é quem BUSCA o documento — e a ficha financeira mora DENTRO dele (virou
  carga sob demanda no mesmo PR). `selectedEmpresa` ficava `undefined`,
  `renderDetails()` devolvia **`null`**, e a lista TAMBÉM não renderizava porque
  a view já não era `'list'`: **tela vazia, sem botão, sem caminho de volta** —
  e o mesmo valia para o *"próximo passo: apuração"* da Rotina do Mês, que é o
  guia do colaborador.
  ⚠️ **O SINTOMA ENGANAVA**: "funciona no Simples" era o atalho **NÃO
  DISPARANDO** (com empresa do Simples ativa o id do Lucro vem `null`, a pessoa
  cai na lista, e ali o botão Abrir carrega). Parecia Lucro × Simples e era
  caminho novo pulando a carga; o Simples nunca teve o buraco porque carrega a
  lista inteira de uma vez.
  **DUAS REGRAS QUE FICAM**: (1) **caminho novo para uma tela passa pelo MESMO
  carregamento que o caminho antigo** — atalho que pula a carga entrega a tela
  sem o dado, e é a família do "rota sem botão" ao contrário; (2) **`return
  null` num render de detalhe é BECO** — nenhum estado pode renderizar NADA: ou
  tem o dado, ou DIZ por que não tem e devolve o botão. Travado por varredura em
  `empresaAtivaSequencia.test.ts` (exige `abrirEmpresa(externalSelectedId)`,
  barra o `setView('details')` no atalho e o `return null`), **provado
  revertendo o código antigo de propósito**.
- **A SEQUÊNCIA DO APP É LOGIN → ATIVAR EMPRESA → MÓDULOS — e VER a carteira é
  livre, AGIR num cliente exige que ele seja o ATIVO** (Paulo, 15/08, três
  mensagens no mesmo dia). Eu tinha lido *"não carregamos nada até ativar"*
  como carga preguiçosa e implementei DUAS vezes (Simples #676, Lucro #684) —
  a frase é sobre ESCOPO DA SESSÃO. O que existe agora: portão pós-login
  (`AtivarEmpresaScreen`), `services/empresaAtiva.ts` + contexto, chip
  permanente no topo com ⇄ Trocar, módulos abrindo NA ativa, trocar limpa o
  carregado, logout limpa a ativação (F5 não). TRÊS CORREÇÕES DELE NO MESMO
  DIA, todas por print: (1) o card do Lucro voltava à lista de ~400
  (`setSelectedLucroEmpresaId(null)`); (2) **exceção sem porta** — a lista
  `DISPENSAM_EMPRESA_ATIVA` (consultas de tabela + visões de carteira) existia
  e o portão barrava TUDO; virou o botão "📖 Entrar só para consultas", e card
  de cliente clicado no modo consulta pede ativação NA HORA guardando o
  destino; (3) **lista de triagem trazendo OUTRA empresa dentro de módulo
  por-cliente** (EXPERTE ativa, FASTWELD na Varredura IPI): eu travei só a
  AÇÃO e mantive a visão da carteira — ele REPETIU com print ("mesmo
  problema") e a decisão é dele: **dentro de módulo por cliente, até a VISÃO
  é da ativa**. Lista e KPIs filtram pela ativa NO MESMO recorte (número de um
  recorte com lista de outro é a leitura dupla de sempre); o que fica de fora
  vai CONTADO ("N outras empresas têm IPI — troque no ⇄ ou use a Rotina");
  emissão (Cotas/Trimestrais) tem a mesma guarda — e "ninguém emite em série,
  já tínhamos falado" (é a regra de 28/07, guia UMA A UMA). Seletor interno de painel
  por-cliente SAIU (`EmpresaAtivaFixa` no lugar); ficam com seletor: filtro de
  carteira, config de admin e drill-down de tela de carteira (nascendo na
  ativa). ✅ **RESOLVIDO NO MESMO DIA** (Paulo: *"ninguém emite nada em série,
  já tínhamos falado sobre"* — é a regra de 28/07): Cotas do mês e Trimestrais
  ganharam a guarda E o recorte. E a ÚLTIMA aba do módulo caiu com o print
  *"essas são as ABAS?"*: o **Painel DCTFWeb** listava a carteira inteira com
  **Transmitir** e **↻ Retificar** por linha — a tela de consequência mais cara
  do app, porque transmitir DCTFWeb da empresa errada FECHA a competência para
  o DP e o Contábil e obriga retificadora. Recortado, com seletor interno fora
  (o de sincronizar junto: sincronizar é AÇÃO) e KPIs no MESMO recorte da lista.
  ⚠️ **E A BUSCA NÃO PASSOU A FILTRAR NO SERVIDOR**, de propósito: daria a mesma
  lista e destruiria a CONTAGEM do que ficou de fora — esconder sem dizer é o
  que faz alguém ler "0 pendentes" como resposta da carteira.
- **🐛 AÇÃO SEM EFEITO VISÍVEL É BECO — informar a data não atualizava a tarefa**
  (16/08, terceira ponta do mesmo PR, achada por varredura minha). O colaborador
  informava o vencimento, o calendário era gravado, e **a tarefa na frente dele
  continuava dizendo "📅 informar vencimento"** — porque `criarTarefaSeFalta`
  faz dedup e nunca ATUALIZA. Ele clicaria de novo, e de novo. É a família do
  "Já importado" sem estado (14/08): a única saída que sobra para quem não vê
  efeito é repetir o clique.
  O `/informar` passou a datar as tarefas **da CIDADE** que estavam sem
  vencimento — é a cidade que ganhou calendário, não aquele cliente. Cada
  competência recebe a data DELA. TRÊS TRAVAS: vigência **não retroage** no
  backfill; tarefa que já tem data **não é sobrescrita**; e falha no backfill
  **não desfaz o calendário** (a gravação já aconteceu) mas é **DITA** — esconder
  faria a pessoa esperar uma atualização que não vem.
- **🐛 DATA ERRADA É PIOR QUE DATA QUE EXPLODE** (16/08, ponta solta do meu
  próprio PR, achada antes do Paulo). Com o ISS passando a circular sem dia,
  `calcularVencimento` devolvia uma data **VÁLIDA E ERRADA**: 29/05/2026 para a
  competência 06/2026 — no PASSADO. A tarefa nasceria já **ATRASADA**, vermelha
  na Rotina, para todo cliente de cidade sem calendário. E passaria calada:
  data inválida ao menos explode; data errada, não.
  ⚠️ **E A PRIMEIRA VERSÃO DA GUARDA NÃO PEGOU**: `Number(null)` é 0 e
  `Number.isInteger(0)` é **true**. É a TERCEIRA vez que este mesmo
  `Number(null)` morde num só dia (farol de lastro, regime do catálogo, agora
  aqui). O `== null` vem primeiro, sempre.
  ⚠️ **E a guarda no lugar errado zerou três prazos trimestrais**: obrigação de
  "último dia útil do mês" não tem `diaVencimento` — os testes que já existiam
  pegaram na hora.
  ✂️ Duas pontas mais: os DOIS criadores de tarefa gravavam
  `Timestamp.fromDate(null)`, e o **município não viajava com a tarefa** — o
  botão do modal apareceria e a gravação falharia. Meia ligação de novo, e desta
  vez eu achei antes de subir para ele.
- **🚨 O CALENDÁRIO SE PREENCHE PELO USO, NÃO POR FILA DE ADMIN** (Paulo,
  16/08: *"eu não vou fazer nada manual, você deve — como nos demais impostos —
  se atualizar automaticamente; no caso de ISS de outra cidade deve abrir o
  modal de data de vencimento para que o colaborador insira a data na hora do
  cálculo e geração da guia, assim eliminamos esta pendência e seguimos para o
  próximo"*). Eu tinha entregue o cadastro municipal como **fila de admin**: 57
  cidades para alguém preencher ANTES que o mês funcionasse. Ele recusou o
  desenho, não o número — e está certo: fila que depende de trabalho manual do
  dono não é solução, é a pendência com outro nome.
  **A INVERSÃO**: o ISS de cidade sem calendário deixa de ser pendência
  bloqueante e **NASCE como obrigação**, sem data, marcada `vencimentoAInformar`
  (sumir da tela é pior que aparecer com ressalva). Na linha da tarefa, o botão
  **📅 informar vencimento** abre o modal, que **consulta sozinho com fonte** e
  pré-preenche só o que vier COM link. O que a pessoa confirma vira o calendário
  da cidade a partir daquela competência — **ninguém pergunta de novo**, nem
  para os outros clientes de lá.
  TRÊS RÉGUAS QUE SOBREVIVEM À INVERSÃO: (1) **a data nunca é chutada** — sem
  calendário o vencimento é NULO, e o `diaVencimento: 10` que a entrada do ISS
  carregava como placeholder foi ZERADO (agora que a obrigação circula, aquele
  10 seria lido como dia de verdade — e é justamente o de SP, o que faria o
  número certo aparecer na cidade errada por coincidência); (2) **a vigência
  começa na competência informada e NÃO retroage** (a pessoa diz o prazo de
  HOJE); (3) **base legal continua obrigatória no cadastro do ADMIN** — só o
  fluxo dispensa, porque exigir a lei de quem está gerando a guia é exigir
  julgamento fiscal que ela não tem, e a alternativa real não é "com norma × sem
  norma", é **ter data × não ter data nenhuma**. O informado fica carimbado
  (`origem: 'fluxo'`, `aConfirmar`) e o admin promove quando quiser.
  ⚠️ E o informado **NÃO sobrescreve** calendário já confirmado com norma.
  🐛 A trava de layout do próprio projeto pegou meu modal (`items-center` sem
  `overflow-y-auto`: com várias fontes, os botões sumiam) — antes de subir.
- **DENUNCIAR SEM DAR SAÍDA É MEIA CORREÇÃO — a esfera ESTADUAL virou cadastro**
  (15/08, fim do dia). De manhã o app passou a acusar que o prazo do SPED
  (`UF:SP`, CAT 147/2009) era entregue a cliente de qualquer estado, e eu deixei
  a correção como "decisão do Paulo". Estava pela metade: quem é do Paraná via o
  alerta e **não tinha onde cadastrar a data do Paraná**. O mecanismo era meu; o
  dado é dele.
  O núcleo do calendário municipal ganhou a esfera ESTADUAL — mesma régua de
  VIGÊNCIA e mesma recusa sem BASE LEGAL, variando só o ESCOPO
  (`IBGE:3550308` × `UF:PR`). Cadastrado o prazo do estado do cliente, a
  obrigação sai com a data DELE e **deixa de aparecer como "prazo de outra
  UF"**; sem cadastro, o alerta continua e agora diz **ONDE cadastrar**.
  ⚠️ **O ID MUNICIPAL NÃO MUDOU** (só os dígitos do IBGE): mudar a fórmula
  orfanaria o que já estiver cadastrado. Estadual nasce com o prefixo `UF:`.
  ✂️ E a conversão `MM/AAAA → AAAA-MM` — que mordeu TRÊS vezes no dia, uma delas
  em silêncio — virou `competenciaIsoDe`, num lugar só, com teste contando as
  ocorrências para a segunda cópia não nascer.
- **🚨 PARE DE CORRIGIR INSTÂNCIA — TRAVE A CLASSE** (Paulo, 15/08: *"a cada
  rodada você descobre um erro seu, essa semana foi demais! resolva seus
  gaps"*). Ele estava certo e o padrão era meu. Em vez de esperar a próxima
  rodada, varri as TRÊS classes que apareceram no dia — formato de competência,
  "liguei um lado e não o outro", e status lido como resultado.
  A varredura achou o MESMO defeito do cron em OUTRO caminho:
  `services/tarefasAutoGerar.ts` (o auto-gerar da tela de Tarefas, que roda
  quando o colaborador troca a competência) chamava `obrigacoesAplicaveis`, a
  lista genérica — sem município, sem UF.
  🐛 **E ALI MORAVA UM DEFEITO MAIOR, PRÉ-EXISTENTE E MUDO**: o app tem DOIS
  vocabulários de regime. O perfil do cliente diz `LUCRO_REAL_INDUSTRIA` /
  `_SERVICOS` / `_COMERCIO`; o catálogo tem `LUCRO_REAL`. `CATALOGO[regime]`
  dava `undefined` e a lista saía **VAZIA EM SILÊNCIO** — esse caminho criava
  **ZERO obrigação para todo cliente do Lucro Real**, e a estatística mostrava
  "0 criadas" como se não houvesse o que criar. `normalizarRegimeCatalogo` +
  `obrigacoesDoCliente` (núcleo único) resolvem, e regime desconhecido vem
  NOMEADO em `regimesNaoReconhecidos`.
  **A TRAVA É POR COMPORTAMENTO, não por arquivo**: o teste varre QUEM CRIA
  TAREFA e exige o núcleo por cliente, barrando a volta da lista genérica.
  Corrigir instância por instância não fecha a classe — foi por isso que o
  mesmo defeito nasceu duas vezes no mesmo dia.
- **🚨 MATA-BURRO: LIGUEI O CADASTRO NO ALERTA E ESQUECI DE LIGAR NA ENTREGA**
  (15/08, defeito MEU, achado horas depois de subir). O calendário municipal
  alimentava a COBERTURA da Rotina (o âmbar) e **não** alimentava o cron que
  CRIA a tarefa — que continuava chamando `obrigacoesAplicaveis(regime, comp)`,
  a lista genérica, que não conhece município nem UF.
  O efeito seria PERVERSO e só apareceria depois: ao cadastrar a cidade, o aviso
  *"o ISS não vira tarefa automática"* **SUMIRIA** e a tarefa continuaria não
  existindo. **Trocar o alerta pelo silêncio é pior que não ter cadastrado** —
  o mês fecharia sem o ISS, sem ninguém avisando, e a pessoa que cadastrou teria
  toda razão de achar que resolveu.
  O cron passou a usar `mesDoCliente` (que resolve o município e conhece a UF);
  federais e estaduais saem idênticos, o que muda é o municipal APARECER quando
  a cidade tem calendário. `tarefasMunicipais` vai contado no log — entrega nova
  que não aparece no log é entrega que ninguém sabe que aconteceu.
  **REGRA QUE FICA: cadastro que APAGA um alerta tem que ENTREGAR o que o
  alerta cobrava — no mesmo PR.** Alerta que some sem a entrega é a pior
  combinação possível: parece progresso e é regressão.
  ⚠️ E a terceira chance do descasamento `MM/AAAA` × `AAAA-MM` estava aqui — o
  cron fala MM/AAAA, igual ao catálogo. **Conferido, não suposto**, e travado
  por teste.
- **A CONSULTA MENSAL DE PRAZO ENTROU — proposta COM FONTE, nunca escrita
  direta** (15/08, fechando o desenho do Paulo de 11/08). Com o calendário
  municipal virando cadastro, a pergunta seguinte é quem preenche ~N cidades à
  mão. `prazo-municipal-consulta.js` (12 testes) + `POST
  /prazos-municipais/consultar` pergunta ao Gemini **com grounding** e devolve
  PROPOSTA — **o handler não escreve NADA**, e um teste recorta o handler e
  prova que não há `.set`/`.update` nele. Quem grava é o cadastro, com base
  legal e o nome de quem confirmou.
  TRÊS RECUSAS QUE FAZEM ISSO SER ÚTIL: (1) **proposta SEM FONTE é chute** e
  derruba a resposta INTEIRA — modelo sem busca inventa prazo com a mesma
  confiança com que acerta, e aqui o custo do chute é multa; (2) **fonte não
  oficial vai MARCADA, não escondida** (o modelo cita o que acha; quem decide é
  quem lê) — `.gov.br`/`.leg.br`/`.jus.br` valem, e a régua casa por FRONTEIRA
  de domínio, senão `gov.br.exemplo.com` passaria; (3) **dia ilegível NÃO vira
  default** — campo de prazo não recebe chute nem zero. E o que o humano
  confirma é a **DIFERENÇA** contra o cadastro, não o número solto: divergiu,
  a tela manda cadastrar **VIGÊNCIA NOVA** em vez de editar a antiga (editar
  reescreveria a competência que já saiu com a regra velha).
- **O CALENDÁRIO MUNICIPAL VIROU CADASTRO — o buraco maior do mês fechado**
  (15/08). Depois de aplicar a `abrangencia` estadual, sobrou o municipal, que
  era buraco INTEIRO: o ISS nascia `proposta` porque **não existe "dia do ISS"
  nacional** e carimbar o de SP seria inventar prazo — então ele nunca virava
  tarefa, e são ~157 empresas de serviço puro, as que NÃO fecham o mês no DAS.
  `prazos-municipais.js` (24 testes) + coleção `prazos_municipais` + painel
  **🏛️ Calendário municipal** no ⚙️ Config Admin. Cadastrado o calendário da
  CIDADE, o ISS deixa de ser pendência e vira obrigação **com vencimento** —
  para os clientes DAQUELA cidade, nunca para os outros.
  RÉGUAS COPIADAS DO IVA-ST, e pelas mesmas razões: **vigência resolve pela
  COMPETÊNCIA, nunca "o mais recente"** (competência velha sai com a regra que
  valia nela; o erro contrário só aparece na fiscalização) e **cadastro sem
  BASE LEGAL é RECUSADO** (prazo órfão não se confere depois — daqui a três
  meses ninguém lembra de onde veio aquele dia 15). Desativar **não apaga**: o
  calendário antigo continua explicando as competências que ele datou.
  DECISÕES: a fila é **POR MUNICÍPIO** (cadastrar uma cidade resolve todos os
  clientes dela — por cliente seriam 157 linhas dizendo a mesma coisa),
  ordenada por quantos clientes rende; **optante do Simples fica FORA** (LC 123
  art. 13 — o ISS dele já está no DAS, e cobrar calendário por causa dele
  inflaria a fila com trabalho que não muda guia); e cliente **sem município
  cadastrado** é contado à parte, porque a ação é OUTRA (é no cadastro dele).
  🐛 **O DESCASAMENTO DE FORMATO MORDEU PELA SEGUNDA VEZ NO MESMO DIA**: este
  catálogo fala `'MM/AAAA'` e o resto do app fala `'AAAA-MM'`. Na Rotina ele ao
  menos EXPLODIA; aqui o efeito era **silencioso** — a vigência nunca casava e
  o ISS continuava pendente como se ninguém tivesse cadastrado nada. Convertido
  na fronteira (mudar o formato do catálogo quebraria o cron do mês inteiro) e
  travado por teste, inclusive no limite do ano.
- **MATA-BURRO: CAMPO QUE EXISTE E NUNCA É APLICADO — o prazo de SP entregue ao
  Brasil inteiro** (15/08). O `abrangencia` ('BR' · 'UF:SP' · 'IBGE:?') está no
  catálogo desde 11/08, e o comentário no topo do próprio arquivo dizia *"o app
  prefere dizer 'não sei o prazo deste município' a carimbar o de SP"* — era
  exatamente o CONTRÁRIO que acontecia: o prazo do **SPED** (`UF:SP`, CAT
  147/2009) ia para TODO cliente do Lucro, morasse ele onde morasse. **Prazo
  errado entregue com confiança é o erro mais caro que este app comete**, porque
  quem lê não tem como desconfiar — a data está lá, formatada, parecendo certa.
  `alcanceDaObrigacao` + a UF do cliente na `mesDoCliente`: cliente de outra UF
  vira ALERTA nomeado ("a data que aparece é a de SP — confira na SEFAZ do
  estado dele"), entra em `coberturaIncompleta` e a Rotina põe essa causa **na
  FRENTE** das outras duas, porque regime indefinido e obrigação proposta o
  colaborador percebe, e prazo de outro estado não.
  ⚠️ **SEM UF CADASTRADA NÃO SE AFIRMA NADA**: assumir "é de SP" carimbaria o
  prazo paulista em quem talvez não seja, e assumir o contrário faria a obrigação
  SUMIR de quem tem ela. Vira `uf-desconhecida` e manda preencher a UF.
  ✂️ **E NÃO MEXI NO QUE O CRON GERA**: a tarefa continua nascendo (some da
  tela é pior que nascer com ressalva) e a data continua a mesma — o app DENUNCIA
  em vez de contornar, que é a regra de 06/08. Cadastrar prazo estadual de
  verdade é decisão do Paulo, obrigação por obrigação, com a base legal do lado.
- **MATA-BURRO: FUNÇÃO PRONTA, TESTADA E SEM NENHUMA TELA — a trava T1 do escopo
  passou 4 dias escrita e NÃO APLICADA** (15/08). `mesDoCliente` devolve
  `coberturaIncompleta` desde 11/08, com o comentário no próprio código dizendo
  *"a etapa 4 não pode dar verde nesse caso (trava T1 do escopo)"* — e NINGUÉM
  lia a flag. `pendenciasDeConfirmacao()` idem: 9 obrigações que o catálogo
  admite não conferir, testadas, e ZERO chamadas fora do teste.
  A cadeia do defeito é a que o próprio escopo descreve: obrigação não vira
  tarefa ⇒ não aparece em Vencimentos ⇒ não aparece no Guia do mês ⇒ **o farol
  diz "mês fechado" com obrigação que nunca foi listada**. Hoje isso valia para
  o **ISS** (prazo é do MUNICÍPIO, e carimbar o de SP seria inventar prazo — são
  157 empresas de serviço puro) e para o **INSS patronal** (depende da folha,
  que mora no módulo de DP). Agora a etapa 4 fica ÂMBAR nomeando o que ficou de
  fora, e o checklist aparece NA ROTINA (junto do número que ele qualifica), não
  numa aba de admin que ninguém abre.
  DUAS CAUSAS, DUAS AÇÕES: regime INDEFINIDO se resolve na FICHA; obrigação
  `proposta` se entrega POR FORA — fundir numa frase só repetiria o erro do
  "sem movimento" sem causa, então as duas aparecem quando as duas valem.
  ⚠️ **O SIMPLES NÃO É TRAVADO À TOA**: optante não recolhe ISS próprio (LC 123
  art. 13, já está no DAS), então `coberturaIncompleta` é false lá — alarme onde
  não há nada a fazer é o que ensina a ignorar o farol.
  🐛 **E o teste pegou um defeito MEU na hora**: a Rotina fala `'AAAA-MM'` e o
  catálogo fala `'MM/AAAA'` — passar direto EXPLODIA. A conversão ficou na
  FRONTEIRA (mudar o formato do catálogo quebraria o cron que cria o mês
  inteiro) e a falha **não derruba o painel**: a Rotina responde pela carteira
  toda, e um throw apagaria a tela de todo mundo por um cadastro torto.
  **REGRA QUE FICA: flag/checklist que o núcleo produz nasce com o LEITOR no
  mesmo PR** — é a mesma família do E510 "pronto" que ninguém gerava, da rota do
  fechamento sem botão (13/08) e do selo das Novidades apagado.
- **MATA-BURRO: NÚMERO DIGITADO SEM DOCUMENTO POR TRÁS — e a ROTINA pintava de
  VERDE** (15/08, caso EXPERTE 06/2026 — Paulo: *"antes de fazer qualquer
  captura, repare que a empresa teve IPI, geramos o imposto e relatório: como
  não houve captura de XML?"*). A ficha e a escrituração são trilhos
  INDEPENDENTES e ninguém cruzava os dois: R$ 7.352,90 de IPI apurado,
  relatório emitido, **ZERO documento no banco**, e nada acendia. É o retrato
  da colcha que o CFI existe para substituir.
  O farol nasceu na 🏭 Varredura de IPI, mas a doença **nunca foi do IPI** — a
  prova saiu da própria **Rotina do Mês**, que é o guia do colaborador: a etapa
  de APURAÇÃO fechava `concluida` só por EXISTIR ficha, com a etapa de CAPTURA
  logo acima dizendo *"nenhuma nota capturada"*. **Duas leituras do mesmo mês
  discordando na mesma tela**, e a de baixo é a que vira "mês fechado".
  `ficha-x-documentos.js` virou régua ÚNICA (`valorApurado` + `rotulo`, chamada
  pela varredura E pela rotina — a segunda cópia seria o defeito de sempre).
  QUATRO DECISÕES: (1) **âmbar, não vermelho** — o número pode estar certo (a
  ficha é digitada de propósito e há cliente que ainda não migrou a
  escrituração); o que não pode é passar por CONCLUÍDO sem ninguém ver, e âmbar
  já impede o "mês fechado"; (2) no **Simples o número é a RECEITA** (o
  `totalImpostos` fica null porque o DAS ainda não foi calculado) — olhar só o
  imposto deixaria a maior parte da carteira sem farol; (3) **ficha ZERADA com
  banco vazio NÃO acende** — isso é "sem movimento", outro assunto com trilho
  próprio, e alarme sem ação é o que ensina a ignorar o farol; (4) contagem que
  FALHA vira `null`, nunca zero — "sem lastro" com o banco cheio é o alarme
  falso que aparece justamente quando está tudo certo. ⚠️ E o farol diz na
  frase que **verde é EXISTÊNCIA, não valor**: quem confere valor é o E510 (🪞).
  🐛 Um defeito meu pego pelo próprio teste: `Number(null)` é 0 e
  `Number.isFinite(0)` é true, então o ramo "tem imposto" engolia o Simples
  inteiro e ele nunca acenderia.
- **MATA-BURRO: COMUNICADO ENTREGUE COM O SELO APAGADO — o par que envelhece em
  SILÊNCIO** (Paulo, 15/08: *"o botão novidade do CFI você não está inserindo o
  detalhe em vermelho que sinaliza que algo foi feito"*). Ele estava certo e a
  causa é velha conhecida: a regra *"mudou a página → muda `NOVIDADES_VERSAO`,
  no mesmo PR"* estava escrita DENTRO do próprio arquivo e **não tinha trava**.
  Resultado: onze dias de entrega — Ativar Empresa, nota digitada, farol de
  lastro, correlação de CFOP nos relatórios — com o selo escuro, então a equipe
  não tinha como saber que havia o que ler. Entregar sem avisar é quase não
  entregar. `__tests__/novidadesService.test.ts` passou a comparar a constante
  com o **"atualizado em" da própria página** e a exigir que o texto da revisão
  exista (versão nova sem texto novo é selo mentiroso — acende prometendo
  leitura que não está lá). É a mesma família do guia órfão de 12/08.
- **🐛 PRO E FLASH NÃO ANDAM NO MESMO NÚMERO — premissa minha, derrubada pelo
  print da conta** (16/08). Paulo mandou o seletor do Gemini dele mostrando, na
  MESMA lista: `3.5 Flash Lite`, **`3.7 Flash`** e **`3.1 Pro`**. Eu tinha
  escrito o resolvedor casando a família EXATA nos dois degraus, então ele
  procurava um **"3.7 Pro" que não existe** — e, não achando, concluía que *"a
  família 3.7 não aparece para esta conta"*. Era falso, e contradizia a sonda na
  mesma tela.
  A família virou **PISO, não casamento exato**: o app pina no **mais novo de
  CADA linha** e DIZ quando uma delas está atrás. "Atualizar para a 3.7" quer
  dizer não ficar para trás — não que exista um 3.7 em todo degrau.
  ⚠️ E conta atrás do piso **não volta mais para o alias**: ficar no alias
  existindo um modelo mais novo listado é abrir mão de escolher. Modelo sem
  versão no nome fica FORA (não dá para dizer se é novo).
  📌 A distinção que continua valendo: o app usa a **API** (`GEMINI_API_KEY`),
  não o app de consumo `gemini.google.com` — assinatura do consumidor não muda
  o que a API lista. Quem responde sobre a API é a sonda, e ela já mostrou
  `gemini-3.7-flash` atendendo.
- **🚨 O PRINT DO PAINEL DE GEMINI DERRUBOU O PRÓPRIO PAINEL — e revelou um
  defeito EM PRODUÇÃO** (15/08, print do Paulo). A tela mostrou, LADO A LADO:
  *"⚠ A família 3.7 ainda não aparece para esta conta"* e, duas linhas abaixo,
  **`gemini-flash-latest → gemini-3.7-flash · na família alvo`** DUAS VEZES.
  **DOIS ACHADOS, e os dois valem mais que a feature:**
  (1) **DUAS LEITURAS DO MESMO FATO DISCORDANDO NA MESMA TELA** — eu reproduzi,
  no meu próprio painel, a armadilha que este projeto mais pagou. A causa:
  `alvoEncontrado` responde sobre a **LISTAGEM** (`models.list` traz a família?)
  e o cabeçalho lia isso como resposta de *"estamos no 3.7?"*. São perguntas
  diferentes — listagem é STATUS, sonda é RESULTADO, e **nesta casa quem
  responde é o resultado**. `vereditoDaFamilia` decide pela SONDA e EXPLICA a
  aparente contradição em vez de escondê-la; sonda que não respondeu vira
  `indeterminado`, nunca "não estamos".
  ✅ **A RESPOSTA REAL É: ESTAMOS NO 3.7.** O alias já é servido pela família.
  (2) 🔴 **O ROTEADOR Pro×Flash ESTÁ SEM EFEITO EM PRODUÇÃO**: as duas linhas
  mostram `gemini-flash-latest`, ou seja **`GEMINI_MODEL_PRO` no Cloud Run está
  apontando para o alias do FLASH**. Anexo, prompt longo e **parecer jurídico**
  — o caso mais analítico do app — caem no modelo barato. O risco estava escrito
  num comentário do `server.js` desde sempre e **nada CONFERIA**; agora
  `conferirRoteador` diz qual env corrigir.
  ✅ **DECIDIDO EM 16/08 — E A DECISÃO TROCOU O ALARME DE LUGAR** (Paulo: *"não
  vejo problema em continuar no Gemini Flash desde que seja a última versão"*).
  Fica no Flash nos dois degraus: **não é defeito, é escolha**, e pintar de
  vermelho uma configuração que o dono escolheu é o alarme sem ação que ensina a
  equipe a ignorar os alarmes que importam. `conferirRoteador` virou NEUTRO e
  segue DIZENDO o fato (quem opera precisa saber que tudo — anexo, prompt longo,
  parecer jurídico — sai pelo mesmo degrau) com o caminho de volta na frase.
  ⚠️ **UM FATO QUE ELE PODE ESTAR JUNTANDO E SÃO DOIS EIXOS**: Pro e Flash não
  são versões um do outro, são **degraus de preço/capacidade** — a Flash 3.7 é
  mais NOVA que a Pro 3.1 em número e ainda assim é a mais barata. Dito uma vez
  e a decisão mantida; não relitigar.
  🚨 **A VIGILÂNCIA MIGROU PARA A CONDIÇÃO DELE**: `conferirAtualizacao(sondas,
  modelos)` acusa **em vermelho** quando o modelo que está RESPONDENDO ficou
  atrás do mais novo que a conta lista — que é a única coisa aqui que acontece
  SOZINHA, no dia em que a Google publicar a versão seguinte. Compara pelo
  `modelVersion` da sonda (alias não tem versão no nome, e é justo o alias que
  promove sozinho), julga **cada linha separada** (senão o Pro 3.1 apareceria
  atrasado por causa do Flash) e **sem a listagem devolve `indeterminado`,
  nunca "atrasado"** — afirmar atraso por rede que piscou faria alguém pinar à
  mão um modelo que já estava certo. `-lite` continua fora da vaga do Flash:
  um lite mais novo mandaria trocar para um modelo mais FRACO.
- **O GEMINI SE PINA PERGUNTANDO, NUNCA CRAVANDO O ID** (Paulo, 15/08: *"nosso
  motor de busca é o Gemini, usando minha conta paga; ele teve sua versão
  atualizada para 3.7, nós devemos nos atualizar também"* → e, quando respondi
  com a explicação dos aliases: *"o que você quer dizer? pedi para você
  atualizar p a versão 3.7"*). A ordem é PINAR — mas escrever `'gemini-3.7-pro'`
  à mão é apostar a produção num nome que ninguém viu responder: se o ID real
  tiver sufixo, for `-preview`, ou a família ainda não estiver liberada para a
  conta, a IA do escritório inteiro cai — e cai CALADA, no deploy.
  `sefaz-backend/gemini-modelo.js` faz o que o código 9 do ISS fixo e o R-2055
  ensinaram: **a FONTE responde**. O servidor lista os modelos da conta e
  escolhe o melhor da `FAMILIA_ALVO_GEMINI` ('3.7'); precedência **env do Cloud
  Run (pino humano) > família alvo listada > alias `-latest`**. Se a 3.7 não
  estiver lá, o app segue no alias FUNCIONANDO e o painel ⚙️ Config Admin diz
  que o alvo não foi encontrado — e pina sozinho, sem deploy, no dia em que a
  Google publicar (basta reabrir o painel). TRÊS TRAVAS testadas: `-lite` NÃO
  ocupa a vaga do Flash (outro degrau de preço, e o roteador manda prompt de
  trabalho ao Flash); a família casa com FRONTEIRA ('3.7' não pega '3.70' nem
  '13.7'); e sonda que falha devolve **null, nunca false** — afirmar "não
  estamos no 3.7" porque a rede piscou faria alguém pinar à mão um modelo que já
  estava certo. 🐛 **E a varredura achou a SEGUNDA CÓPIA da régua, já
  divergida**: `recuperacao-tributaria-routes.js` tinha o próprio
  `GEMINI_MODEL_PRO` caindo no **alias do FLASH** — o parecer jurídico, que é o
  caso mais analítico do app, saía no modelo barato. Os routers agora leem do
  servidor (`req.app.get('geminiModelos')`), e um teste barra tanto ID cravado
  quanto env lido fora do módulo dono.
- **MATA-BURRO: DOIS DOCUMENTOS COM AÇÕES OPOSTAS NÃO PODEM TER A MESMA CARA NA
  TELA** (14/08, NOVA ERA 07/2026 — o dia inteiro saiu daqui). A linha do
  FUNRURAL mostrava `nº 255273 · JOSE D. KOKI`. Paulo leu *"o CFI está levando a
  nota DELE e não está considerando a da NOVA ERA"* — leitura RAZOÁVEL e
  ERRADA: 255273 é a nota **da NOVA ERA** (nota própria de entrada, art. 136),
  e o nome do produtor aparece nela porque **na nota própria o produtor É o
  fornecedor**. A NF-e do KOKI é a **nº 98**, e estava certinha no bloco das 80
  excluídas. **O sistema estava certo o tempo todo.** O que mentia era a tela:
  a nota que SE ESCRITURA e a que NÃO se escritura saíam idênticas, e nenhuma
  das duas dizia qual era qual.
  O PREJUÍZO FOI REAL E EM TRÊS CAMADAS: (1) Paulo clicou **✕ tirar do
  FUNRURAL** em SEIS produtores para limpar a lista — tirando justamente as
  notas próprias que DEVEM gerar sub-rogação; (2) eu diagnostiquei a causa
  errada e gastei DOIS deploys (487-491) numa segunda cópia da régua de direção
  que era defeito real mas **não era este caso** — as notas vinham do importer
  principal, que já tinha a régua desde 31/07; (3) o número do ↩ prometia o
  DOBRO, porque a dedup do art. 136 exigia `funrural.aplica` e não rodava em
  quem saiu pelo ✕ (NUNO: 11 notas/R$ 309.645,94/"voltaria R$ 5.047,23", com
  cada compra contada duas vezes). Corrigido: `entraNoPar` inclui quem está
  fora por DECISÃO, e a exclusão **só derruba o que estava de pé** — em quem
  saiu pelo ✕ o motivo continua sendo a decisão, senão o caminho de volta (que
  é o cadastro) sumiria da vista.
  **A REGRA QUE FICA — e ela é mais forte que "causa junto do número": quando
  duas linhas da mesma lista pedem AÇÕES OPOSTAS, a linha tem que dizer QUAL
  DELAS ELA É.** Aqui virou 🟢 `nota própria de entrada (art. 136)` × 🟡 `NF-e
  do produtor — sem nota própria que a cubra`, com o CFOP e a PROVA da direção
  (`tpNF` × `cfop-de-entrada`) do lado. Foi essa linha que resolveu o caso em
  UM print, depois de dois dias — e é a mesma família do "Já importado" sem
  estado e do "sem movimento" sem causa. ⚠️ **CORRELATO QUE CUSTOU CARO: eu
  DEDUZI a causa em vez de instrumentar a tela.** Tinha o print, tinha o total,
  não tinha o dado — e saí consertando por hipótese. Instrumentar primeiro
  custaria um deploy; deduzir custou dois e uma decisão errada do dono.
- **MATA-BURRO: BOTÃO QUE TIRA COISA DO TOTAL NASCE COM O BOTÃO QUE DESFAZ**
  (14/08). O ✕ *"tirar do FUNRURAL"* subiu em 13/08 e no dia seguinte o Paulo
  clicou por engano: **o produtor sumiu da tela junto com o único botão que
  desfaria**. Pior, o texto do confirm PROMETIA *"dá pra reverter no cadastro"* —
  caminho que não existia, porque o produtor só aparece na lista quando tem nota
  somando FUNRURAL. Promessa que a tela não cumpre é pior que não prometer.
  Eu tinha escrito a régua um dia antes, na dedup do art. 136 — **"total que
  muda sozinho faz desconfiar do número certo: some da CONTA, não da TELA"** — e
  não apliquei ao meu próprio botão. Agora a saída por decisão vai carimbada
  (`funrural.decisao`) e volta em `tiradosPorDecisao`, agrupada por PRODUTOR
  (que é o eixo em que a decisão foi gravada), com **quanto voltaria ao total**
  do lado do ↩ — reverter imposto sem o número é decidir no escuro. O ↩ grava
  `funrural: ''` (LIMPA, devolvendo à régua automática); marcar `'sub_rogacao'`
  AFIRMARIA que ele é produtor rural PF, e desfazer um clique não verificou
  nada. A opção pela FOLHA aparece no mesmo bloco **sem** botão: é declaração do
  produtor (Lei 13.606/2018), não engano de clique.
- **MATA-BURRO: "JÁ EXISTE" NÃO É RESPOSTA — E EU GASTEI O DIA DO PAULO
  PERGUNTANDO O QUE O APP DEVERIA DIZER** (14/08, urgente, vencendo segunda).
  Ele arrastou 12 XMLs e levou `Já importado (chave 3526…)` doze vezes. A frase
  era VERDADE e não servia para nada: não dizia em qual empresa, quando, por
  qual trilho, nem se o documento estava visível. **A única saída que sobra para
  quem lê uma frase dessas é repetir o clique** — e foi o que ele fez, várias
  vezes, enquanto eu perguntava "onde você excluiu?" em vez de fazer a mensagem
  responder sozinha. Alarme sem ação gasta o tempo de quem lê, e desta vez gastou
  em cima de prazo.
  `services/importDuplicadoMotivo.ts` separa o que tem ação OPOSTA: **está aqui**
  (nada a fazer, e a linha avisa que sumir da APURAÇÃO é outro problema — regime,
  pendência, art. 136 — que o XML não toca) · **está em OUTRA empresa** (o caro:
  a nota existe, a apuração da certa fica a menor, e reimportar NÃO move a nota
  de dona ⇒ vermelho e contagem própria no toast, senão passa batida no meio de
  12 âmbares) · **está com lápide** (invisível no app E travando a reentrada ⇒
  aqui reimportar é a ação CERTA, e o nome dela é REINCLUSÃO).
  🚨 **E A PRIMEIRA VERSÃO DESSA CORREÇÃO ERROU PELA MESMA CAUSA DE SEMPRE:
  cobri UMA lápide** (`_deleted`) porque foi a que eu lembrei — e `_merged_into`
  esconde o documento igual. Paulo teve que apontar o mesmo problema DUAS vezes.
  A pergunta certa não é *"tem `_deleted`?"*, é **"este documento aparece no
  app?"**, respondida com a MESMA régua da listagem (`ocultoDoApp`, que devolve a
  CAUSA — mesclado avisa do risco de ressuscitar duplicata, excluído não).
  ✂️ **E O CASO REAL ERA MAIS SIMPLES QUE TUDO ISSO: o documento gravado estava
  ERRADO.** Não havia lápide nenhuma — a leitura honesta virou SONDA e provou:
  se houvesse, o app teria dito "estava excluído, reincluído agora". Faltava
  **↻ Substituir os que já estão no banco** (opt-in por importação, nasce
  DESLIGADO — ligado por padrão sobrescreveria documento certo; **nunca**
  substitui documento de OUTRA empresa, que seria mover a nota de dona por
  importação sem ninguém decidir e sem rastro na que a perdeu; grava
  `_substituidoEm`/`_substituidoPorEmail`, porque reescrita de dado fiscal sem
  quem/quando não se reconstrói; e a linha diz **"SUBSTITUÍDA"**, não
  "importada"). ✅ Provado em produção: 12 ok.
  **REGRA QUE FICA: recusa de gravação DIZ o estado do que já está lá e oferece
  a saída.** "Já existe", "duplicado", "já importado" sem estado e sem ação é
  beco — e beco na mão de quem está com prazo vira meia hora perdida.
- **MATA-BURRO: SENTINELA DE BACKFILL NÃO PODE SER CAMPO DE DADO** (13/08,
  print do Paulo na aba 🌾 da NOVA ERA). O botão ♻️ *"Reler participante e
  município dos XMLs"* examinou 692 documentos e respondeu **"0 recuperadas ·
  664 já tinham · 28 sem arquivo"** — enquanto o MESMO painel, logo abaixo,
  acusava **427 notas sem fornecedor e 14 sem município**. Duas leituras do
  mesmo dado discordando, a armadilha que mais mordeu este projeto.
  DUAS CAUSAS: (1) o sentinela era a **UF** (`ufEmit`), e a UF é gravada em TODA
  nota pelo importer — ele pulava justamente as que precisavam dele e chamava
  isso de "já tinham". Virou **carimbo de versão** (`participantesRelidos` +
  `VERSAO_RELEITURA_PARTICIPANTES`): sentinela responde *"já passei por aqui?"*,
  nunca *"tem algum campo preenchido?"* — e subir a versão reprocessa a base
  quando o extrator aprender a ler mais. (2) o patch **não gravava o CNPJ/CPF do
  participante**, embora o extrator devolva desde sempre: "nota sem fornecedor"
  é nota sem `cnpjEmit`, então nenhuma releitura ia resolver, por mais vezes que
  a pessoa clicasse. A varredura passou a cobrir **as duas direções** (nota
  própria de entrada pode estar gravada como 'saida' até o backfill de direção
  passar) e o backfill **só preenche o que está VAZIO** — sobrescrever com o XML
  seria "corrigir" divergência por escrita silenciosa, e divergência entre fonte
  e cadastro é ALERTA (06/08). O resultado agora responde POR CAUSA: *relido e o
  XML realmente não tem o dado* manda ao cadastro do produtor; *sem arquivo
  guardado* é buraco de captura; *já relidas antes* é o clique que não faz nada
  — três ações diferentes que o texto antigo fundia numa mentira só.
- **MATA-BURRO: QUOTA DO TRIMESTRAL NÃO SE EMITE ANTES DO MÊS DELA** (Paulo,
  13/08: *"as cotas devem ser enviadas todos os meses pois sofrem atualização da
  SELIC"*). Ele apontou o defeito com uma frase: escolher "3 quotas" emitia **as
  três no mesmo clique, hoje**. Pela Lei 9.430/96 art. 5º §3º o acréscimo é
  *SELIC acumulada do 1º dia do 2º mês subsequente ao trimestre até o último dia
  do mês ANTERIOR ao pagamento, + 1% no mês do pagamento* — então a quota 3
  depende da SELIC do 2º mês, **que só é divulgada no começo do 3º**. Gerada
  junto com a quota 1, ela sai **A MENOR**, e guia a menor NÃO AVISA: o cliente
  paga, fica com débito residual e a diferença aparece depois com multa. E as
  guias 2 e 3 ficavam na mão de quem clicou, para vencer dali a um e dois meses,
  sem nada no app cobrando o envio.
  Régua em `sefaz-backend/darf-quotas.js` (puro, 21 testes) — **cada quota se
  emite no MÊS DO VENCIMENTO dela**, uniforme e sem exceção sutil (a quota 2 é
  1% fixo e daria pra emitir antes; régua com exceção é régua que ninguém lembra
  na hora). O que espera vai pra `darf_quotas_agenda` e volta na aba **🧮 Cotas
  do mês** (DCTFWeb), onde a guia nasce com o SICALC calculando na data de hoje.
  DECISÕES QUE MANDAM: **atrasada NÃO some** da lista quando o mês vira (é ela
  que está gerando multa); id estável, então reemitir sobrescreve e quota já
  emitida é RECUSADA (duas guias da mesma cota = cobrança em dobro); falha ao
  gravar a agenda não derruba a emissão que já aconteceu, mas é DITA na tela
  (agenda perdida em silêncio é pior que não ter agenda). O mínimo de R$ 1.000
  por cota e a divisão em centavos saíram do orquestrador pro núcleo — eram
  cópia lá dentro.
  📅 **A COTA SAI NO DIA 1º DO MÊS DELA, NÃO NO DIA DO VENCIMENTO** (Paulo, no
  mesmo dia: *"não posso enviar na data para o cliente"*). O comportamento
  sempre foi esse — quem mentia era a FRASE, que dizia "geradas na data delas" e
  fazia parecer que a guia só nasceria no vencimento, sem tempo de mandar. Quem
  vence em 31/08 pode ser gerado e enviado em 01/08: **um mês inteiro de folga**.
  Régua que a tela agora diz junto do número. E a grafia é **COTA** em tudo que
  aparece (a lei escreve "quota"; quem lê a tela é o colaborador) — teste varre
  o painel e barra a mistura das duas grafias.
  ⚠️ **LISTA VAZIA NÃO É RESPOSTA**: o estado vazio dizia "ninguém escolheu
  parcelar", afirmação FALSA por construção — a agenda nasceu em 13/08 e tudo o
  que foi parcelado antes saiu de uma vez pelo caminho antigo, sem passar por
  ela. Agora ele diz o que NÃO sabe. **Paulo cortou a auditoria do passado**
  (*"só a partir da próxima cota"*): a régua vale daqui pra frente, e a tela NÃO
  manda ninguém varrer o e-CAC atrás das cotas velhas — aviso que pede varredura
  de histórico sem dizer EM QUEM é alarme sem alvo, e alarme sem alvo é o que faz
  a equipe parar de ler os avisos que importam.
- **MATA-BURRO: TRABALHO QUE *PARECE* ENTREGUE — as duas formas, no mesmo dia**
  (13/08). Não é preguiça nem falta de teste: nos dois casos o teste estava
  VERDE e o PR dizia "feito".
  **(1) TRAVA ESCRITA COMO LISTA só cobre o que EU LEMBREI.** Troquei o nome do
  anexo da guia (o cliente via `das_63787066000193_2026-07.pdf`, com o CNPJ cru
  na tela dele) e o teste conferia **dois arquivos enumerados à mão**. O DARF
  (4 botões de envio) e o DARE (3 chamadas) continuaram mandando o nome velho —
  o PR afirmava "os dois canais que chegam ao cliente" e era mentira, sem
  ninguém perceber. Refeito como **VARREDURA pelo comportamento**: percorre
  linha a linha quem manda ao cliente atrás de nome montado com CNPJ, e só
  aceita quando a linha é de DOWNLOAD (no disco do colaborador o CNPJ AJUDA —
  dezenas de empresas na mesma pasta; a régua distingue LEITOR, não formato).
  Foi a varredura que achou a TERCEIRA ocorrência do DARE, num `pdfFileName`
  condicional. **REGRA: régua que vale "em todo lugar que faz X" se trava
  varrendo o X, nunca listando arquivo** — lista envelhece no primeiro arquivo
  novo, e envelhece EM SILÊNCIO, que é o pior jeito.
  **(2) ROTA SEM BOTÃO NÃO É FUNCIONALIDADE — é código morto com cara de
  entrega.** O rito de fechamento da EFD-Reinf (conferir → arquivar → avisar)
  subiu de manhã com 23 testes e ZERO caminho na interface; ninguém no
  escritório conseguiria usá-lo. Mesma família do E510 "pronto" que ninguém
  gerava e do bloco que só o PVA prova. **REGRA: rota nova nasce com o botão
  que a chama NO MESMO PR** — e se o botão não cabe ainda, o PR diz isso em vez
  de deixar a fila achar que fechou.
- **MATA-BURRO: FILEIRA DE BOTÕES QUEBRA LINHA** (Paulo, 13/08: *"caralho meu!
  terceira vez erro de layout"*). Ele estava certo, e as três foram a MESMA
  causa que eu não olhei: o cabeçalho do detalhe do Simples tem **12 botões num
  `flex gap-2` sem `flex-wrap`** — a fileira transborda a viewport, empurra o
  cabeçalho e o nome da empresa desce numa coluna de uma palavra por linha. Eu
  vinha somando botão ali (🔎 Atividades, 📄 Sem movimento, 🔬 Sondar) sem olhar
  o conjunto, cada um "só mais um". `__tests__/cabecalhoNaoTransborda.test.ts`
  varre `components/` e acusa `className="flex gap-N"` com **≥5 `btn-press` na
  janela seguinte** — a contagem evita o falso positivo de fileira de 2-3
  botões, que cabe em qualquer tela (teste que grita sem motivo é teste
  desligado). `flex-wrap`, `grid` ou `overflow-x-auto` resolvem; o que não vale
  é não declarar o que acontece quando não cabe. Também trava `min-w-0` na
  coluna do nome (sem ele o flex item não encolhe) e `whitespace-nowrap` nos
  botões (senão o texto quebra em 3 linhas DENTRO do botão). Provado revertendo
  a correção de propósito. Corrigido no mesmo PR em `components/Das/index.tsx`,
  que tinha o mesmo padrão com 8 botões.
- **MATA-BURRO: TEXTO DE COMMIT NÃO PODE VIRAR CÓDIGO NO WORKFLOW** (13/08,
  deploy 470). O `Push image` caiu por INFRAESTRUTURA (gate verde: auditoria,
  testes e build passaram) — e a trava que existe pra transformar queda em issue
  **caiu junto**. A mensagem do commit era interpolada com `${{ }}` dentro do
  heredoc, e aquele squash tinha crases e parênteses (`ehDocumentoDeServico`,
  `useState(...)`): o bash leu tudo como substituição de comando, dezenas de
  "command not found", exit 1. **O deploy falhou e ninguém foi avisado** — o
  cenário exato de 12/08 que originou a trava. `${{ }}` é substituído pelo
  Actions ANTES de o bash existir, então texto de terceiro vira CÓDIGO (era
  também vetor de injeção, não só bug de aspas). REGRA: dado de fora entra por
  **`env:`** e o corpo vai por **`--body-file`**; só a 1ª linha da mensagem, que
  corpo de squash é muro de texto. Teste conta as ocorrências: exatamente UMA,
  a do `env:`.
- **MATA-BURRO: DEPLOY QUE FALHA VIRA ISSUE** (13/08, nos DOIS repos). Em 12/08
  dois deploys do app irmão caíram seguidos e ninguém viu: o trabalho ficou
  mesclado na main e FORA DO AR, e a descoberta veio de um print de tela
  desatualizada — depois de tempo gasto caçando um defeito já corrigido. A causa
  não é "esquecemos de olhar": **run vermelho num painel que ninguém abre não é
  aviso**. `if: failure()` no fim do `deploy-app.yml` abre (ou COMENTA, uma por
  incidente) issue com o commit, o link do run e o que fazer — inclusive a
  lição: *"enquanto isto estiver aberto, não confie em print de tela"*. No CCI a
  issue ainda aponta o caso conhecido do cache-buster (rodar `bump-version.sh`,
  não editar à mão). `__tests__/deployAvisaQuandoFalha.test.ts` impede a trava
  de ser esvaziada num refactor de workflow — ele NÃO prova que o GitHub abre a
  issue (só o próximo deploy quebrado prova).
  🔬 **SONDA DO "SEM MOVIMENTO" LIGADA** (mesmo dia): o `TRANSDECLARACAO11` tem
  modo VALIDAÇÃO (`indicadorTransmissao: false`) — é dele que a MSG_ISN_023 já
  vinha, e por isso a mensagem sempre pôde dizer "nada foi transmitido". Ou
  seja, existe oráculo GRÁTIS: `POST /api/admin/das/sondar-sem-movimento`
  (requireAdmin) pergunta ao SERPRO qual forma ele aceita, com 6 candidatos que
  levam a HIPÓTESE escrita. Perguntar é PROVA, não dedução — mesma técnica das
  sondas do R-2055. TRAVA: `assertSondaNaoTransmite` roda sobre o MESMO objeto
  que sai (gancho `antesDeEnviar` no provider, não sobre cópia) e violação PARA
  a sonda inteira em vez de virar "candidato recusado". Duas formas aceitas NÃO
  viram escolha silenciosa; nenhuma aceita mantém o bloqueio, mas com as recusas
  NOMEADAS para abrir o chamado. Botão 🔬 admin-only ao lado do bloqueado.
- **MATA-BURRO: GUIA DO COLABORADOR ANDA EM PAR** (12/08). A regra "atualizar as
  DUAS juntas" (página em `public/` + fonte em `docs/`) estava escrita TRÊS
  vezes neste arquivo e nunca teve trava: dava pra corrigir o HTML e deixar o
  `.md` velho, e a próxima pessoa a ler a fonte aprenderia o procedimento
  ERRADO. Como os nomes não casam (`guia-dipam-produtor-rural.html` ×
  `guia-colaborador-dipam.md`), o par se declara POR DENTRO — `<meta
  name="guia-id">` + `guia-revisao` no HTML, comentário equivalente no `.md`.
  `__tests__/guiaParDuplo.test.ts` barra: metade órfã (HTML sem fonte = texto
  que ninguém acha; `.md` sem página = procedimento que a equipe nunca vê) e
  revisões divergentes. Guia novo nasce com as duas metades e os dois
  marcadores. Provado divergindo uma revisão de propósito.
  📗 **`/guia-conferencia-entregas.html`** (link no RODAPÉ, ao lado da versão)
  nasceu do caso do dia: chegou print de tela com defeito **já corrigido** —
  o deploy do módulo é que tinha falhado, e não dava pra saber olhando. A régua
  que fica é **"print sem versão não é evidência, é narrativa"**, e o guia
  carrega a versão do `/version.json` na própria página, com botão de copiar.
  Ele ensina o rito de conferência (versão → resultado, nunca status → o que
  reportar) e traz o roteiro por entrega, com CRITÉRIO DE ACEITE por item. Vale
  lembrar da regra de 11/08: NÃO se pede ao colaborador que explique a causa —
  pede-se print inteiro com cliente, competência e versão.
- **MATA-BURRO: RÉGUA FISCAL MORA NUM LUGAR SÓ — e agora um teste barra a
  segunda cópia** (Paulo, 12/08: *"a maioria das situações de hoje são brechas e
  buracos SEUS. Não dá p passar por isso mais! Eu gasto token e tempo"* → e a
  ordem: *"finalizou uma tarefa, deu certo, passa o laço, carimba com o
  mata-burro e vai"*). Ele estava certo, e a causa era UMA só: quase todo
  defeito daquele dia foi uma **segunda cópia de uma regra que já existia** —
  não falta de conhecimento, já que a regra estava escrita, às vezes neste
  arquivo. R-2055 contando dígitos × cadastro do 🌾; réplica de CFOP no modal
  exibindo `1405` (inexistente) enquanto o arquivo gravava `1403`; `cfopConferencia.ts`
  com os sufixos copiados (a cópia se declarava "espelho"); fronteiras de prazo
  reescritas no `FiscalObligationsDashboard` E ainda vivas no
  `vencimentos-orchestrator` (que JÁ importava o núcleo ao lado, e a cópia já
  divergia — não tinha a faixa de 7d); versão do app irmão em 4 arquivos com o
  bump escrevendo 2.
  **`__tests__/reguaUnica.test.ts`** varre `components/`, `services/` e
  `sefaz-backend/` atrás das ASSINATURAS LITERAIS de cada régua fora do arquivo
  DONO. Três decisões: assinatura literal (nunca "parece uma régua" — falso
  positivo em teste que bloqueia build vira teste desligado); **teste fica FORA
  da varredura** (reproduzir a régua num teste é legítimo — foi assim que a
  divergência do CFOP virou número em `cfopCorrelacaoTelaXArquivo.test.ts`); e a
  falha ENSINA (diz o dono, o import e o caso real que custou).
  Exceção se declara em `permitido` COM o motivo escrito, nunca apagando a
  assinatura — hoje há duas, ambas de OUTRO domínio com número parecido: faixa
  de CNAE do ISS (`calendario-obrigacoes.js`) e validade de certificado A1
  (`cert-vencimento-helper.js`).
  **REGRA QUE MANDA: núcleo fiscal novo (tabela, fronteira, de-para, família de
  código) entra em `REGUAS_VIGIADAS` NO MESMO PR que o cria** — mesma regra dos
  `TOTAIS_VIGIADOS` da auditoria de saída do SPED. E a trava foi PROVADA contra
  o código do dia anterior: as 4 cópias casam com as assinaturas.

- **O QUE EXISTIA ANTES DO CFI ERA COLCHA DE RETALHOS — e isso muda o que
  significa "certo"** (Paulo, 11/08, posicionando a realidade): no E-Fiscal
  *"não eram usados todos os campos e funções; cada colaborador agia de uma
  forma, sem processos ou controles, cada um com o seu processo ou um controle
  paralelo que nem sempre usavam ou sabiam o que faziam, cada um com um Excel
  diferente, ajustes de arquivos na mão, tratativas para fechamento do mês sem
  controle, processos ou coordenação"* — ajuste manual em Excel, DENTRO do PVA
  e no próprio SPED. **CONSEQUÊNCIAS QUE MANDAM EM TODO O PROJETO:**
  (1) **O E-FISCAL É REFERÊNCIA, NUNCA GABARITO.** Arquivo aceito prova que a
  RECEITA aceitou, não que está CERTO. Divergir dele não é defeito do CFI — é
  uma PERGUNTA, e o juiz é o **XML-fonte** (o documento) + a lei. Bater dos
  dois lados é CORROBORAÇÃO (dois caminhos independentes, um deles manual, no
  mesmo número), nunca "passei no teste". Aplicado no espelho 🪞 em 11/08
  (`spedEspelho`/`ConferenciaEspelho`), que dizia "o gabarito está do lado" e
  agora manda ao XML — veredito que culpa o CFI ensina o colaborador a
  "consertar" o app até copiar um ajuste manual do outro sistema.
  CUIDADO: a lição estrutural que se tira de arquivo aceito CONTINUA valendo
  (VL_CONT_IPI inclui o IPI, CST de escrituração converte na entrada) — ajuste
  manual mexe em VALOR, não inventa leiaute. O que não vale é tratar o VALOR
  de lá como verdade.
  (2) **"MIGRAÇÃO 100% DOS DADOS" É META FALSA** (Paulo: *"a migração 100% dos
  dados e-Fiscal não é tão 100% assim"*). Paridade com uma colcha de retalhos é
  IMPORTAR a colcha. O alvo é ESTAR CERTO contra a fonte, não igual ao passado.
  (3) **O PRODUTO NÃO É "SUBSTITUIR O E-FISCAL", É SUBSTITUIR A AUSÊNCIA DE
  PROCESSO.** Rotina do Mês, Guia do mês da Carteira, faróis honestos, prova de
  captura, auditoria de envio — nada disso existia em lugar nenhum; não é
  "alcançar o E-Fiscal", é o que a casa nunca teve. Por isso a régua de valor
  de uma feature NÃO é "o E-Fiscal fazia?".
  (4) **É POR ISSO QUE OS DEFEITOS APARECEM AGORA** (FUNRURAL dobrado, IPI a
  menor, cancelada no faturamento): não são regressões do E-Fiscal — lá isso era
  feito (ou não) à mão, invisível, cliente a cliente. O CFI é a primeira vez que
  a conta é SISTEMÁTICA, e portanto a primeira vez que o erro é VISÍVEL. Achar
  defeito é o sistema funcionando, não o projeto atrasando.
  (5) **DIVERGÊNCIA PODE SER ACHADO SOBRE O PASSADO.** Se o CFI está certo e o
  declarado não estava, isso é assunto de RETIFICAÇÃO — decisão do Paulo, caso a
  caso, NUNCA automática e nunca escondida.

- **Deploy e merge automáticos**: todo trabalho vai em PR → squash-merge →
  acompanhar o deploy (GitHub Actions `deploy-app.yml`) até ficar VERDE, sem
  perguntar. Branch de trabalho designada pela sessão; nunca commitar direto
  na main.
- **Validação por RESULTADO, não por status**: "deploy verde" e "cron rodou"
  não significam "capturou nota". Sempre verificar o efeito real (docs
  capturados, painel Diagnóstico com farol honesto). Lição de 22/07/2026:
  NFS-e SP ficou semanas "verde" com 0 sucessos/121 falhas.
- Mensagens de erro para o usuário: em português, com a AÇÃO prática (padrão
  interpretarCstat). Módulos de lógica: puros e testados (jest), rotas = I/O.
- **CFI é CONCORRENTE da SIEG, não satélite** (Paulo, 23/07/2026): a prova de
  completude do produto é PRÓPRIA, contra a FONTE (SEFAZ) — cursor
  ultNSU=maxNSU, pendências de manifestação, resumos sem completo. NUNCA
  propor "comparar com a SIEG" como rito; a Conferência por chaves é só rede
  de segurança da migração.
- **ARQUIVO FISCAL SE CONFERE PELO RESULTADO, NÃO PELO TESTE VERDE** (Paulo,
  06/08: *"esses erros não podem acontecer"*). TRÊS defeitos da MESMA família
  passaram por teste unitário verde e só apareceram na leitura humana do
  código: IPI escriturado em E200/E210 (registro do ICMS-ST, 04/08); E110
  campo 11 recebendo saldo CREDOR num campo de saldo DEVEDOR (02/08); Bloco H
  com o inventário INTEIRO zerado (06/08 — qtd default 0 e nenhum lugar do app
  gravando o campo). Teste de unidade não pega: cada função fazia exatamente o
  que o próprio teste mandava. TRAVA PERMANENTE: `sped-auditoria-saida.js`
  roda em TODO arquivo gerado e acusa a CLASSE do erro — coluna de valor
  zerada (ou vazia) em 100% das linhas de um detalhe, total que não bate com a
  soma dos detalhes, bloco com IND_MOV=0 e nenhum registro de conteúdo. Sai no
  header `X-SPED-Auditoria` e nos warnings. REGRAS QUE VALEM PRA GERADOR NOVO:
  (1) campo de VALOR/QUANTIDADE nunca recebe default — ausência bloqueia ou
  vira bloco vazio + alerta, e zero só entra quando zero É a resposta ("não
  houve ajuste"), nunca quando é "não sabemos"; (2) registro novo com
  totalizador entra em `TOTAIS_VIGIADOS`, detalhe novo entra em
  `DETALHES_VIGIADOS`, NO MESMO PR; (3) bloco só conta como PRONTO no de-para
  depois de passar no PVA — "gera o arquivo" não é prova.
- **CADASTRO ERRADO OU FALTANDO = ALERTA, NUNCA CONTORNO** (Paulo, 06/08:
  *"erro de cadastro e/ou falta de informação LIGA UM SINAL DE ALERTA E O
  COLABORADOR QUE ARRUME, não vamos perder tempo em criar ferramentas p
  ajustar o que eles fizeram de errado"* — generaliza o que ele já tinha
  dito da UF em 05/08). Campo em branco ou torto: o app ACENDE o alerta,
  diz ONDE arrumar, e PARA. NÃO se constrói auto-preenchimento, dedução
  "esperta" nem tela de conserto em massa — isso gasta token, esconde o
  buraco e ensina a equipe que dá pra deixar em branco. TRÊS COISAS QUE
  CONTINUAM VALENDO e não confundir com contorno: (1) reler a FONTE quando
  o dado já existe nela (relê XML pra endereço, CCM/tomador do próprio
  documento) — é recuperação, não conserto de cadastro; (2) DIVERGÊNCIA
  entre cadastro e fonte é ALERTA de primeira classe (cadastro diz X, a
  nota diz Y ⇒ acende, não escolhe sozinho); (3) SUGERIR conhecimento
  fiscal carimbado com a origem (IVA-ST do cadastro NCM) — sugestão nunca
  sobrescreve o que a pessoa digitou. Aplicado no mesmo dia: o CCM do
  painel ISS deixou de se auto-preencher pela nota (#489) e passou a
  denunciar ausência e divergência.
- **AUSÊNCIA DE XML NA NFS-e DO PORTAL É NATUREZA, NÃO FALHA** (07/08, ELS
  COMERCIO DE BANANAS, nota 55758/1): clicar na nota derrubava a tela com
  `Cannot read properties of undefined (reading 'slice')` — era
  `d.xmlHash.slice(0,16)` sem guarda. Mas o `.slice` era só o sintoma: a tela
  assumia que TODO documento veio de um arquivo XML. A NFS-e do portal entra
  por CSV/TXT — **não tem XML, não tem hash e não tem chave de 44 dígitos**, e
  isso é a forma do trilho, não buraco de captura. Por isso a correção não foi
  um `?.`: `services/documentoProcedencia.ts` (11 testes) DIZ por que o campo
  está vazio, e distingue os dois casos — NFS-e sem XML é normal, **NF-e sem
  XML é anormal e manda conferir Erros & Logs**. Campo vazio sem explicação faz
  procurar problema que não existe (mesma lição do "CNPJ não cadastrado").
- **ERRO DE TELA TEM QUE DIZER QUAL TELA** (07/08): a `ErrorBoundary` mostrava
  só "Erro ao carregar modulo" + a mensagem crua, e um `Cannot read properties
  of undefined (reading 'slice')` num print virou caça com 261 candidatos no
  código. Agora toda fronteira leva `modulo="<nome>"` (10 arquivos), e o nome
  vai também pro Sentry. Módulo novo com ErrorBoundary DEVE nomear.
- **🚨 O TOAST VENDIA FALHA COMO SUCESSO — nos DOIS apps** (20/08, print da
  colaboradora na Legalização: *"Falha na análise: IA indisponível: Your
  prepayment credits are depleted"* com **✓ VERDE** do lado). `Toast.tsx` era
  verde com check SEMPRE, qualquer que fosse a mensagem: o farol honesto valia
  pro painel e não valia pro AVISO, que é justamente o que a pessoa lê na hora
  do erro. ✂️ `services/toastTone.ts` (puro, nos dois repos, IDÊNTICO): o tom
  sai da MENSAGEM — erro vermelho com ⛔, alerta âmbar, sucesso verde; erro fica
  **15s** (era 3s), porque a mensagem carrega a AÇÃO e 3s não dá pra ler.
  ⚠️ **Classificar pelo TEXTO foi decisão, não preguiça**: mudar as ~40 chamadas
  de `setToastMessage`/`onShowToast` uma a uma conserta as de hoje e deixa a
  próxima nascer verde — é a lição da "trava escrita como LISTA" (13/08).
  🚨 **E A REGRA QUE FICA É A DO INVARIANTE**: dois defeitos apareceram só
  quando o teste rodou, e os dois eram do MESMO tipo — mensagem de falha **sem
  palavra de falha** sai VERDE. (1) a minha própria frase nova *"Os créditos da
  IA acabaram"*; (2) o fallback do `getFriendlyErrorMessage`, que devolvia o
  erro CRU. Por isso o teste não confere frases: exige que **TODA saída do
  tradutor seja classificada como erro pelo toast**. Mensagem nova sem palavra
  de erro quebra a build em vez de chegar verde no usuário.
  ⚠️ **E O CONSELHO ESTAVA ERRADO NO CASO MAIS CARO**: crédito esgotado volta
  como **429**, igual a cota estourada, e o tradutor mandava *"aguarde alguns
  instantes"* — esperar NÃO recarrega saldo. O caso de billing passou a ser
  testado ANTES do 429 e manda recarregar no AI Studio; entrou também a chave
  **irrestrita** (a API Gemini não aceita desde 19/06/2026). Toda mensagem diz
  que o ARQUIVO NÃO SE PERDEU — era a dúvida imediata de quem viu o erro.
  📌 **CONTEXTO OPERACIONAL**: a `GEMINI_API_KEY` é a MESMA nos dois apps
  (espelhada do CFI), então saldo zerado derruba Contratos IA **e** o CFI de
  uma vez. O billing é POR PROJETO — conferir em qual projeto a chave vive
  (`aistudio.google.com/apikey`) antes de recarregar, senão o crédito entra no
  projeto errado. Mudar para pré-pago NÃO adiciona saldo: é preciso COMPRAR.
- **Farol honesto vale pra TODO painel** (não só o Diagnóstico): all-failed
  (0 ok + N falhas) nunca é verde; falha sempre com o MOTIVO dominante ao
  lado. Lições 23/07: "Saúde dos crons" dizia OK com 0/500; NFe ficou
  "inoperante" vermelho com 12k docs/7d (all-failed transitório com captura
  saudável = âmbar, não vermelho). Lição 27/07 (#319): status de heartbeat
  ('iniciado') NUNCA pode virar vermelho ETERNO — deploy mata o setImmediate
  e o doc ficava 'iniciado' pra sempre ("NFS-e SP travado há 9h" sem nada
  travado). Todo trilho com heartbeat DEVE ter as duas redes: SIGTERM
  (cron-heartbeat.registrarRunEmAndamento) marcando 'interrompido' na hora +
  auto-cura por idade (cron-health.decidirCuraOrfao, >2h). 'interrompido' =
  âmbar com a ação enquanto a próxima rodada cabe na janela; passou do
  maxIdle sem rodar = vermelho. Nunca verde (não capturou nada).
- **ORDEM TÉCNICA do envio de imposto** (Paulo, 24/07/2026 — vale pra TODO
  imposto/guia/obrigação enviada ao cliente, #293): 1) cópia do arquivo na
  pasta IMPOSTOS do cliente no SharePoint (mesma árvore do sync:
  `Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{empresaPasta}/IMPOSTOS`);
  2) gestor alexandre@spassessoriacontabil.com.br SEMPRE em cópia (BCC no
  Graph, CC no mailto); 3) baixa da obrigação na aba Vencimentos e
  Obrigações (reverso da pendência do cron mensal; obrigações zeram todo mês
  com as novas tarefas); 4) auditoria em `impostos_enviados`. Núcleo:
  `sefaz-backend/envio-imposto.js` (executarRitoEnvioImposto) + rota
  `/api/admin/envio-imposto/registrar` + `services/envioImpostoService.ts`.
  Fluxos ligados: DAS (Graph + "abrir no meu e-mail" + WhatsApp), DARF
  (DetalheDeclaracao) e DARE (DareSpModal). Feature nova de guia DEVE
  chamar o rito.
- **ICMS-ST no Bloco E + IPI estava no registro ERRADO** (04/08): a apuração
  de ST é POR UF DE DESTINO (cada estado vira uma GNRE) — `sped-bloco-e-st.js`
  (14 testes) monta E200/E210/E220/E250 do ST retido nas saídas. Ajuste de ST
  usa a MESMA aba do E111: o 3º caractere do COD_AJ_APUR decide o registro
  ('0'=E111 próprio, '1'=E220 ST) e `classificarAjustes(ajustes, uf, alvo)`
  filtra — ajuste da outra apuração NÃO é erro, é de outro registro. E250 só
  sai com vencimento+código de receita cadastrados (código de GNRE não se
  inventa); sem eles, aviso. CORREÇÃO GRAVE no mesmo PR: o gerador punha o
  **IPI em E200/E210**, que são registros do ICMS-ST — IPI é **E500/E520**.
  Nenhum cliente com IPI tinha gerado ainda, senão o PVA teria recusado.
  E510 (consolidação por CFOP/CST-IPI) não é gerado: o CST do IPI não é
  capturado hoje. Leiaute de ST e IPI PRECISA passar pelo PVA (a doc oficial é
  bloqueada pela rede do ambiente) — os testes travam a estrutura.
- **Bloco G / CIAP construído a partir do relatório REAL** (Paulo mandou o
  CIAP da EXPERTE 06/2026 em PDF, 03/08): crédito de ICMS do imobilizado sai
  em 48 parcelas (LC 87/96 art. 20 §5º) e cada parcela entra na PROPORÇÃO das
  saídas tributadas+exportação sobre o total — mês com muita saída isenta/ST
  credita menos. Núcleo puro `sped-bloco-g.js` (14 testes) REPRODUZ o
  relatório do PVA: parcela = crédito/48, Σ 527,53 × índice 0,86032111 (8
  casas) = 453,85. Cadastro em `sped_ciap_bens` (1 doc por EMPRESA — o bem
  atravessa 4 anos; o que muda é a parcela) + aba 🏭 CIAP no card SPED, com
  "⏭ Avançar parcelas" no fim do mês (48ª vira baixa). Saídas do índice
  derivam das notas do período (tributada = ICMS destacado; exportação =
  CFOP 7xxx) e podem ser sobrescritas à mão pra fechar com o controle do
  cliente. G110 tem a ordem CONFERIDA contra o relatório; G125 segue o Guia
  Prático (OP, ST, FRT, DIF) e só o PVA confirma. Empresa sem bens = bloco
  vazio (a maioria).
- **DECLARAÇÃO E GUIA SÃO OBRIGAÇÕES DIFERENTES — e estavam soldadas** (Paulo,
  07/08: *"empresas Simples Nacional, mês sem movimento, onde eu transmito
  agora?"*). Resposta que o código deu: **em lugar nenhum — era no e-CAC, à
  mão**. A transmissão do PGDAS-D só acontecia DENTRO do `emitirDasRegular`,
  que recusa valor < R$ 10,00 (`assertValorMinimoDas`); mês sem faturamento não
  passava pela porta. E não entregar custa **MAED de R$ 50,00 por
  competência**. Agora: `pgdas-sem-movimento.js` (15 testes) +
  `declararPgdasSemMovimento` + rota `/api/admin/das/declarar-sem-movimento` +
  botão **📄 Declarar sem movimento** (só aparece com apuração zerada).
  **NÃO GERA DAS de propósito** — guia de valor zero seria cobrança que não
  existe — e grava em coleção PRÓPRIA (`pgdas_sem_movimento`), porque em
  `das_emitidos` a listagem de guias mostraria uma cobrança inexistente.
  🚨 **O SN-Entregar RECUSOU a primeira transmissão real** (07/08, ELS COMERCIO
  DE BANANAS 07/2026): `MSG_ISN_023 — O valor da atividade deve ser maior que
  zero`. O app mandou `estabelecimentos: [{cnpj, atividades: []}]` e a forma
  não é essa. **NÃO ADIVINHAR O PAYLOAD**: entrega ao PGDAS-D não se desfaz, e
  declaração ACEITA com estrutura errada é pior que recusada. A recusa passou a
  sair TRADUZIDA (`interpretarRecusaSemMovimento`) mandando entregar no e-CAC
  enquanto isso — a competência continua vencendo. **DESTRAVA COM** o extrato
  de um PGDAS-D sem movimento já transmitido (o e-CAC mostra o XML), igual ao
  que destravou o R-4020: arquivo aceito vale mais que leiaute deduzido.
  🚨 **A SONDA ESTAVA PERGUNTANDO COM UM PAYLOAD INVÁLIDO — as 6 formas nunca
  foram avaliadas** (Paulo, 20/08, ELS 07/2026: *"fui testar mais uma vez o
  SIMPLES SM, testei essa aba e deu essas msg"*). Os seis candidatos voltaram
  com o MESMO erro, e o SERPRO **disse o campo na cara**:
  *"[EntradaIncorreta-PGDASD-MSG_ISN_036] — Required property **'TipoDeclaracao'**
  not found in JSON. Path 'declaracao'"*. `tipoDeclaracao` é obrigatório e quem
  o preenche no caminho real é o `transmitirPgdasD` (1 Original / 2
  Retificadora, decidido por `consultarDeclaracaoPa`) — a sonda chamava
  `validarDeclaracaoPgdas` DIRETO e o deixava de fora. A recusa foi de SCHEMA,
  antes de qualquer leitura de "sem movimento".
  ✂️ **REGRA QUE FICA: a sonda pergunta com o MESMO payload que o caminho real
  enviaria.** Sonda que monta payload próprio responde sobre uma forma que
  ninguém vai transmitir — e o "não" dela não vale nada. Consulta do tipo caída
  não para a sonda: cai em Original e **diz** qual usou.
  🚨 **E O VEREDITO PIORAVA O ESTRAGO**: ele lia "seis recusas com o mesmo
  código" e concluía *"pare de procurar estrutura, leve ESTE código ao SERPRO"*
  — mandando abrir chamado sobre um defeito NOSSO, com o campo escrito na
  própria resposta. Agora **campo nomeado VENCE "mesmo código"**: quando todas
  as recusas apontam o mesmo `Required property`, a ação é do app. É a mesma
  lição do `cStat 640` da SEFAZ no MESMO dia — **resposta que o app chama de
  silêncio manda a pessoa para o lugar errado**. O veredito antigo continua
  valendo para mensagem OPACA com o mesmo código: ele não estava errado, estava
  incompleto.
  🚨 **A TRAVA QUE MANDA**: "sem movimento" é uma AFIRMAÇÃO À RECEITA, e a
  diferença entre "não faturou" e "não capturamos" NÃO está no zero — está na
  SAÚDE DA CAPTURA (mesma lição da NFS-e SP, semanas verde com zero notas). O
  núcleo RECUSA em quatro casos: receita lançada, nota capturada sem receita
  (declarar aqui é afirmar à Receita o que o próprio app desmente), captura
  incerta (zero não prova ausência) e falta de confirmação humana — o app prova
  que NÃO CAPTUROU nada, quem afirma que não HOUVE faturamento é a pessoa, e
  fica gravado quem foi. As duas primeiras travas também impedem que este vire
  atalho pra escapar da conferência SERPRO × app.
- **FATOR R É SÉRIE MENSAL, E A FOLHA INCLUI CPP+FGTS** (colaboradora via
  Paulo, 08/08, com o extrato do PGDAS-D): a tela do Simples só tinha o campo
  ÚNICO "Folha 12m" — a folha DO MÊS (4.149,95) foi digitada nele e o Fator R
  saiu 0,54% em vez de ~6% (o DAS saiu certo por sorte de anexo). O modelo
  `folhaMensal` JÁ EXISTIA no serviço (janela móvel no cálculo + série mensal
  na declaração ao SERPRO via pgdasMapper) — faltava a TELA. Agora o card
  Folha tem editor dos 12 meses ANTERIORES ao PA (mesma janela do extrato),
  com a régua legal no rótulo: salários + pró-labore + **CPP e FGTS
  recolhidos** (Res. CGSN 140/2018 art. 26). Campo 12m virou LEGADO explícito
  (só vale sem série). Farol: mês vazio na janela acende "ausente ≠ zero —
  mês vazio derruba o Fator R". Zero digitado É resposta e o merge preserva
  meses fora da janela visível.
- **PGDAS-D: retenção de ISS vai no ID da atividade, NUNCA em dobro** (caso
  S&P, 03/08): id 15 (Anexo III), 12 (V) e 18 (IV) JÁ significam "ISS retido
  pelo tomador" — mandar também a qualificação {1010, 11} faz o SERPRO recusar
  a ENTREGA INTEIRA (MSG_ISN_032). Valia pra toda empresa de serviço com ISS
  retido; só o caminho da matriz caía (o de filial já montava sem
  qualificação). LACUNA CONHECIDA e AVISADA: `isSup` (ISS SUP) e `isImune`
  reduzem o DAS no cálculo do app mas NÃO viajam na declaração (`valorFixoIss`
  vai null) — `avisosDoPayload` mostra o buraco na confirmação do "Emitir DAS
  Regular" antes de transmitir. Campos `_*` do payload são meta do app — o
  backend só manda `declaracao` ao SERPRO.
- **ISS(SUP) = atividade própria do PGDAS-D, não é retenção** (Paulo, 03/08 —
  resposta do caso S&P): a indicação correta é "Prestação de Serviços, exceto
  para o exterior — **Escritórios de serviços contábeis autorizados pela
  legislação municipal a pagar o ISS em valor fixo em guia do Município**"
  (LC 123 art. 18 §22-A: alíquotas do Anexo III DESCONSIDERANDO o ISS, que o
  escritório paga direto ao município). NÃO usa `valorFixoIss` (esse é o §18,
  outro caso) e o DAS dá o MESMO valor da rota de ISS retido — por isso o erro
  passou despercebido. CAUSA de fundo: a tela do Simples não tinha marcação de
  SUP (só "ISS Retido"), então a equipe marcava retenção pra tirar o ISS do
  DAS e a declaração saía com natureza falsa ("o tomador reteve"). Feito:
  marcação **ISS fixo (SUP)** na tela (excludente com ISS Retido),
  `issForaDoDas` no mapper e aviso na confirmação. **RESOLVIDO 05/08: o código
  é o 9**, cadastrado pelo Paulo e com DAS gerado ("SUP - já foi deu certo já
  gerei DAS"). O número saiu da FONTE QUE NÃO MENTE — input escondido do e-CAC
  (`value="44388152000189-9"`), corroborado pela ordem da lista (7/8 locação,
  9 SUP, 10-12 fator r, 13-15 Anexo III) — e NUNCA de chute: a doc do SERPRO e
  o manual da Receita são bloqueados pela rede do ambiente. O código mora no
  BANCO (`pgdas_atividades_codigos`, cadastro pelo botão ⚙️ Código ISS fixo na
  ficha do Simples), não numa constante — foi essa decisão que permitiu
  destravar sem deploy. `ID_ATIVIDADE_ISS_FIXO_CONTABIL` em pgdasMapper segue
  null de propósito: a fonte é o banco.
  TRAVA QUE CONTINUA VALENDO: sem código cadastrado a emissão do DAS é RECUSADA
  pra receita marcada SUP (`bloqueiosDoPayload` + `_bloqueios` no payload,
  revalidado no `emitirDasRegular`) — Paulo viu o extrato saindo como "com
  retenção/substituição tributária de ISS" e cortou ("leva errado pro
  SIMPLES"). Entrega ao PGDAS-D não se desfaz. **CASO ENCERRADO 05/08: Paulo
  conferiu o extrato ("ISS validado")** — a natureza saiu certa, não mais "com
  retenção". Essa conferência é obrigatória em caso novo de SUP: o valor do DAS
  é o MESMO nas duas rotas, então gerar o DAS não prova nada; só o extrato
  denuncia (foi por isso que o erro passou meses despercebido). Ferramenta:
  botão **🔎 Atividades declaradas** (rota
  `/das/atividades-declaradas`, CONSULTIMADECREC14, consulta pura; extrator
  `pgdas-atividades-declaradas.js`, 9 testes) lê os ids de uma declaração já
  aceita e destaca o que o app não monta. Ids mapeados: 1/2/3 comércio, 4/5/6
  indústria, **9 ISS fixo (SUP)**, 11/12 Anexo V, 14/15 Anexo III, 17/18 Anexo
  IV, 29/30/31 exterior (V/III/IV).
- **PRESUMIDO tem os DOIS períodos e o mês decide** (colaborador via Paulo,
  03/08 — caso CLINICA MANTOAN 07/2026): IRPJ/CSLL são TRIMESTRAIS (Lei
  9.430/96 art. 1º) e PIS/COFINS/IPI são MENSAIS, então a ficha precisa dos
  dois botões. A trava de 27/07 (só "Trimestral (obrigatorio)") produziu
  JUSTAMENTE o cenário ilegal que queria evitar: julho lançado como
  fechamento com acumulados zerados = IRPJ/CSLL apurados sobre o mês e
  oferecidos ao MIT de 07 (débito trimestral no PA errado, duplicando em
  setembro). Regra: mês que NÃO encerra trimestre (≠ 3/6/9/12) não apura
  IRPJ/CSLL — a linha sai ZERADA com a observação de quando fecha e a
  receita vai pro "Acumulado do Trimestre"; `extrairTributosApp` então
  entrega IRPJ=0/CSLL=0 e o MIT propõe só os mensais. Núcleo puro em
  lucroService: `mesEncerraTrimestre`, `rotuloFechamentoTrimestre` e
  `avisoPeriodoApuracao` (aviso âmbar nos DOIS sentidos — fechar em mês que
  não fecha e não fechar no mês que fecha). NUNCA voltar a esconder o botão
  Mensal do Presumido; LIMITE_ADICIONAL_MENSAL (20k) só vale pro Lucro Real
  (estimativa). **MIT transmite o que for MARCADO**: `familiasSelecionadas`
  em `preencherEncerrarMit` só RESTRINGE (nunca inclui família que o app não
  apurou), seleção vazia é recusa, e o desmarcado fica na proposta e na
  auditoria (`familiasDesmarcadas`).
- **Retenções IRPJ/CSLL: conferência/MIT usam o LÍQUIDO** (Paulo, 24/07 —
  #298, reverte o critério do #205): retenção sofrida é deduzida NA
  APURAÇÃO (não é vinculação da DCTFWeb) e o débito do MIT vira o DARF.
  extrairTributosApp soma det.valor; valorBruto é só exibição. Caso de
  referência: HS PROJETOS 2026-06 (IRPJ 2.106,14 líq / 8.733,53 bruto).
- **Captura NUNCA assume SP Capital** (#296/#297): trilho NFSe SP (portal)
  só com codMunIBGE==3550308; demais municípios = ADN
  (caminhoNfseRecomendado — CUIDADO: devolve OBJETO, comparar .caminho).
  ADN 404+E2220 = "sem documento" (sucesso-vazio, #302). Farol ADN usa
  movimentoDisponivel (maxNSU==ultNSU ⇒ âmbar "sem movimento", #299).
- **MATRIZ ↔ FILIAL: cert vale pela RAIZ do CNPJ** (Paulo, 27/07 — #315,
  caso J.N. VINATEX 0002-78/0003-59): filial NÃO precisa de certificado
  próprio — usa o A1 válido da matriz (mesma raiz de 8 dígitos) até subir
  o seu, quando o próprio assume. Vale pra filial SEM cert, com A3 (não
  roda em nuvem) e com A1 vencido/incompleto. O E2243 do ADN barra só
  raiz DIVERGENTE — cert de outra raiz continua bloqueado. Helper único:
  `selecionarCertA1PorBase` (cert-base-helper.js); aplicado em NFe
  DistDFe, ADN client (`obterCertParaConsulta`, fonte 'a1-raiz', cache
  5min), elegibilidade ADN (param `certsMeta`) e painel Status
  (`temA1MesmaRaizValido` → via 'cloud-a1-raiz'). TRILHO NOVO que exigir
  certificado DEVE aceitar o da matriz pela raiz.
- **SELETOR DE EMPRESA É UM SÓ, e ⚡ Ativar só onde há CARGA** (07/08): o
  `EmpresaSearchSelect` (busca por Cod.Cliente, nome ou CNPJ) nasceu na
  Central de XMLs e ficou lá — 11 seletores de outras telas seguiam `<select>`
  cru de ~400 opções, onde achar cliente é rolar a lista. O que impedia
  reaproveitar não era o componente, era a FORMA: cada tela guarda a empresa
  do jeito da coleção dela (`nome` × `razaoSocial`, codCliente em
  `dadosFiscais` × topo legado). `services/empresaOption.ts` (20 testes)
  normaliza — e NÃO filtra: empresa com cadastro torto continua na lista,
  porque sumir do seletor faz o colaborador concluir que ela não existe
  (cadastro torto é alerta na tela de cadastro). REGRA DO ⚡ ATIVAR: só onde
  escolher DISPARA carga (DAS filtro, DARF filtro, Tarefas filtro,
  NfpProCloud) — ali o valor escolhido fica PENDENTE e só o clique commita.
  Em formulário e filtro em memória, ⚡ Ativar seria clique a mais por nada.
  Filtro ganhou `permitirLimpar` (o `<option value="">Todas</option>` que o
  select tinha): trocar de componente sem isso prenderia o colaborador na
  última empresa escolhida.
- **CARTA DE CORREÇÃO MUDA A ESCRITURAÇÃO — e ninguém estava vendo** (07/08):
  a CC-e é capturada desde sempre (`documentos_fiscais.eventos[]` com
  `xCorrecao`) e tem selo na lista de XMLs, mas NENHUM ponto da escrituração
  lia o array: nem o gerador do SPED, nem o Exportar SAGE. Pelo Ajuste SINIEF
  07/05 (cl. 14-A §1º) a CC-e corrige **natureza da operação e CFOP** — e o
  CFOP manda no C190, no DIFAL de aquisição, na DIPAM e no bloco K. O livro sai
  do XML ORIGINAL, então cliente que corrigiu o CFOP tinha o livro saindo com o
  CFOP errado, e só a fiscalização veria. `cce-escrituracao.js` (21 testes)
  classifica pelo TEXTO: `muda-escrituracao` (CFOP/natureza/NCM/CST ⇒
  conferir), `indevida-suspeita` (menciona valor/quantidade/partes/data —
  coisas que a CC-e NÃO PODE corrigir ⇒ ou o texto está torto, ou a nota
  precisava de cancelamento e reemissão) e `sem-efeito-fiscal`. A PROIBIDA
  vence a de escrituração. **O APP NÃO APLICA A CORREÇÃO**: `xCorrecao` é texto
  livre, não existe campo dizendo qual campo mudou, e deduzir seria inventar
  dado fiscal — é a regra do ALERTA, NUNCA CONTORNO. Ligado em DOIS pontos: os
  warnings da geração do SPED (antes do arquivo sair) e a etapa de VALIDAÇÃO da
  Rotina (âmbar, e com isso chega no guia do mês sozinho). CC-e sem texto NÃO é
  inofensiva: é CC-e que não dá pra avaliar, e também pede conferência.
- **A CARTEIRA É O GUIA DO MÊS DO COLABORADOR** (Paulo, 07/08: *"deve ser o
  guia, o norte do colaborador durante o mês fiscal de acordo com as
  obrigações e vencimentos das empresas que a ele respondem"*). A tela nasceu
  como ATRIBUIÇÃO (admin diz quem cuida de quem) e era admin-only; agora tem
  duas abas — 🧭 Guia do mês (TODO mundo, escopo na própria carteira) e 👥
  Atribuição (só admin). Uma linha por cliente, ordenada por cor e, dentro da
  cor, por QUEM VENCE ANTES. **O PDF DIZ DE QUEM É** (Paulo, 07/08): o
  colaborador imprime só a carteira dele (o escopo é do backend), e o ADMIN
  escolhe "Guia de: <colaborador>" — sem isso ele só imprimia a carteira
  inteira, e o papel sairia com o NOME DE QUEM CLICOU no cabeçalho, mentindo
  sobre a quem aquilo responde. Recorte impresso sempre diz o que ficou de
  fora, e "Empresas SEM responsável" é opção do seletor pra elas não sumirem de
  todas as visões (é pendência de atribuição, não invisibilidade).
  NENHUMA CONTA NOVA: `services/guiaDoMes.ts` (19
  testes) só condensa o payload de `/api/admin/rotina-fiscal/painel`, que já é
  a fonte das 5 etapas, do ISS e (desde este PR) do PRAZO — a rotina lia as
  tarefas e jogava a DATA fora, só contava quantas. Imprime em PDF pela casca
  única (`gerarRelatorioPdf`). A cor sai do farol da rotina; a ÚNICA coisa que
  a agrava é obrigação ATRASADA (âmbar ali esconderia multa correndo).
  **RÉGUA DE PRAZO NUM LUGAR SÓ** (`sefaz-backend/urgencia-vencimento.js`, 32
  testes): as fronteiras atrasada/hoje/amanhã/≤3d/≤7d estavam escritas à mão
  em DOIS lugares (vencimentosLogic.ts e o forEach do
  vencimentos-orchestrator.js) e o guia seria a terceira cópia — agora os três
  leem o mesmo módulo, e um teste cruzado prova que a porta TS devolve o mesmo
  que o núcleo. Dias contam DIA de calendário, não hora: vencer hoje às 23h é
  "hoje", não "0,04 dias".
  **OBSERVAÇÃO POR CLIENTE VAI PELO BACKEND** (coleção `carteira_observacoes`,
  1 doc por empresa × competência, rules `if false`): as subcoleções de
  empresa liberam escrita pelo `createdBy` da EMPRESA, e o colaborador da
  carteira quase nunca é quem cadastrou — ele ficaria sem escrever justo na
  tela que é o norte dele. A rota usa `podeAcessarEmpresaId`. Texto vazio
  APAGA. Observação NÃO é cadastro e não conserta cadastro: campo em branco
  continua acendendo alerta na tela de cadastro (regra de 06/08).
- **Campo novo do perfil precisa de TRÊS lugares** (03/08, caso KAWAI
  KODOMO — colaborador preencheu resp. legal e o selo não limpava): rota
  `empresas-perfil` (camposConferencia), `normalizarEmpresasPerfilResponse`
  (frontend — montava o objeto com lista explícita e DESCARTAVA os campos
  novos) e o fallback local do xmlFiscalService. É a lição da whitelist
  #382 do lado do cliente. Múltiplos responsáveis: `responsaveisLegais[]`
  com 1º espelhado em respLegal* (sanitize); contador tem CATÁLOGO
  (coleção `contadores`, escolhe no modal, empresa guarda cópia+contadorId).
- **Campo novo no modal Dados Fiscais EXIGE a whitelist do backend** (#382,
  31/07): a rota `/empresa-dados-fiscais` (o "Completar cadastro" do Status)
  filtra por `CAMPOS_DADOS_FISCAIS` — campo fora da lista é DESCARTADO EM
  SILÊNCIO (o modal diz "salvo" e nada persiste; foi o que quase engoliu a
  condicaoRural do 🌾 e deixou CNAE/dataAbertura sem tela de edição). Regra:
  campo novo no modal = entrada na whitelist NO MESMO PR + espelho top-level
  quando apuração/DAS leem de lá (cnae, dataAbertura, ccmSp, uf).
- **CCM-SP só existe pra SP capital** (#311): campo aceita ficar VAZIO —
  limpar e salvar APAGA (o sanitize não pode virar `undefined`, senão a
  chave some do JSON e o backend nunca apaga). CCM só-zeros (contorno da
  equipe pra campo que parecia obrigatório) = vazio. Empresa de outro
  município usa `inscricaoMunicipal` genérica; o modal avisa quando
  codMunIBGE != 3550308 e o CCM tem valor.
- **Gate de auditoria do deploy — REDESENHADO 03/08** (Paulo: "resolva de
  forma que não volta a acontecer, estamos FULL SERVICE"). Três deploys
  caíram por advisory publicado ENTRE deploys, nenhum ligado ao código
  entregue (postcss 24/07 #295; brace-expansion 25/07 #301 e 03/08 #416).
  Três mudanças de fundo: (1) **`overrides` SEMPRE em faixa `^x.y.z`, NUNCA
  versão exata** — pino exato cria TETO e impede o `npm audit fix` de
  resolver sozinho quando o próprio pinado ganha advisory (causa das 3
  quedas); a faixa preserva o PISO, que é o motivo do pino. (2) O gate
  bloqueia só em **produção** (`npm audit --omit=dev` — o que vai na
  imagem); advisory de dep de DESENVOLVIMENTO vai pro resumo do job e não
  segura entrega de imposto. CUIDADO: dev ≠ irrelevante — brace-expansion
  parecia dev e está na árvore de PRODUÇÃO (@google-cloud/secret-manager →
  google-gax → rimraf); conferir com `npm ls <pkg> --omit=dev` antes de
  concluir. (3) Robô diário `audit-deps.yml` (9h UTC, dias úteis): roda
  `npm audit fix` (sem `--force` — major é decisão humana), valida com
  lint+jest+build e só então abre PR já testado; sem correção possível abre
  ISSUE antes de virar bloqueio. Escape hatch `[skip-audit]` no ASSUNTO do
  commit segue valendo pra hotfix.
  **O ROBÔ FALHAVA NA ÚLTIMA ETAPA — e do jeito mais traiçoeiro** (07/08): ele
  achava o advisory, corrigia, validava, empurrava a branch… e morria em
  `gh pr create` com *"GitHub Actions is not permitted to create or approve
  pull requests"* (configuração do repo, não código). O efeito: a CORREÇÃO
  ficava PRONTA numa branch que ninguém sabia que existia, e o run vermelho
  diário não dizia o que fazer — robô que falha todo dia pelo mesmo motivo sem
  apontar a ação vira ruído que a equipe ignora, e aí ele para de proteger.
  Agora a falha vira ISSUE com a configuração exata (Settings → Actions →
  General → Workflow permissions → *Allow GitHub Actions to create and approve
  pull requests*) e o link de compare. O run segue VERMELHO de propósito: a
  correção não foi entregue. **CAIXA MARCADA pelo Paulo em 08/08** — falta a
  PROVA, que é a regra da casa: configuração salva não é robô funcionando. O
  próximo run com advisory é que prova, e há um esperando (`nanoid`, high, só
  de DESENVOLVIMENTO — `npm audit --omit=dev` dá 0, mas a auditoria do robô
  roda sem `--omit`, então ele morde). NÃO corrigir esse advisory à mão antes
  do run: seria tirar do robô justamente o caso que o valida.
  🚩 **A BRANCH DO ROBÔ ENVELHECE**: `chore/audit-deps` é recortada da main no
  momento do run (`checkout -B`), então ela se auto-corrige no run seguinte —
  mas enquanto está parada ela é uma MINA. A de 07/08 (9h53) ficou um dia de
  trabalho atrás: mesclá-la à tarde teria revertido ~4.900 linhas. NUNCA abrir
  PR de uma branch do robô sem conferir a data; a correção do lock cabe num
  `npm audit fix` sobre a main de hoje, que é o que foi feito.
  🚨 **E ELA VIROU A MINA QUE PREVIA — TRAVANDO O PRÓPRIO ROBÔ POR 3 DIAS**
  (17/08, achado num print do Paulo da LISTA DE RUNS, não por alarme). A branch
  parada de 07/08 (140 commits atrás) fazia o `git push` ser REJEITADO nos DOIS
  caminhos: `--force-with-lease` sem a remote-tracking ref recusa com *"stale
  info"*, e o fallback simples recusa com *"fetch first"*. O step morria em
  `exit 1` (bash -e) **ANTES** do passo que abre issue — então o robô de
  SEGURANÇA ficou quebrado em 14, 15 e 17/08 **sem uma única issue**. Ele achava
  o advisory, corrigia, validava, commitava… e morria no push, todo dia.
  ✂️ **A CORREÇÃO SÃO DUAS, e a segunda vale mais**: (1) `git fetch` da ref
  ANTES do push, senão o lease não tem com o que comparar; (2) um passo
  **`if: failure()`** no fim — a MESMA rede que o `deploy-app.yml` ganhou em
  13/08 e que ninguém tinha aplicado aqui. **REGRA QUE FICA: todo workflow que
  a casa depende nasce com o `if: failure()` que vira issue** — a lição de
  13/08 (*"run vermelho num painel que ninguém abre não é aviso; issue é"*)
  vale para o robô igual valia para o deploy, e foi só o olho do dono que
  cobriu a falta. `__tests__/roboAuditoriaAvisa.test.ts` trava as duas, provado
  removendo o fetch de propósito.
- **DEPLOY: automático VOLTOU em 07/08** (runs 345-348 verdes). O bloqueio de
  runner do dia 06 passou sozinho — merge na main dispara `deploy-app.yml` e
  sobe. **CONFERIR ANTES DE MANDAR RODAR SCRIPT À MÃO**: continuar pedindo
  deploy manual depois que a esteira voltou é repetir fato velho como verdade,
  o mesmo erro do "0/388". Um `list_workflow_runs` resolve.
- **DEPLOY TEM SAÍDA DE EMERGÊNCIA** (06/08): o GitHub Actions parou de
  atribuir runner — 3 deploys seguidos com `runner_id: 0`, cancelados aos
  15m00s cravados, ZERO passo executado (não é falha do workflow: é conta/
  cota, e o 340 tinha rodado normal 20 min antes). Com o CI fora a entrega
  ficou 100% bloqueada. `scripts/deploy-manual.sh` faz o mesmo caminho sem
  o GitHub: extrai VITE_* do bundle publicado, constrói no **Cloud Build**
  (NÃO precisa de Docker local — o Mac do Paulo não tem, e foi onde a 1ª
  tentativa parou com "command not found: docker"), sobe a revisão SEM
  tráfego, confere o `/ready` dela e só então roteia. Deploy manual sem
  health check seria pior que o CI: rotearia antes de saber. O rodapé mostra
  "local" em vez de número de build — honesto, entrega por fora não tem
  número de esteira. NUNCA usar como rotina: o gate de lint/testes/auditoria
  do workflow não roda aqui, então só depois do gate verde na máquina.
- CNPJ escritório: 44.388.152/0001-89. Projeto GCP `consultorfiscalapp`
  (us-west1). Scheduler: `scripts/setup-cloud-schedulers.sh` (idempotente;
  o Paulo roda no Mac dele — clone em `~/consultor-fiscal-inteligente`).
  Frontend+backend = MESMO serviço Cloud Run: deploy mata captura em
  andamento — checar o banner do Diagnóstico antes de mesclar (deploy
  20:19 de 24/07 matou o manifest-cron das 20:10 → alerta de FALHA).

- **REINF é do CONSULTOR CONTÁBIL, e agora é meu também** (Paulo, 07/08: *"o
  CODEX estava tocando este projeto, você consegue administrar? para que não
  fique mais confuso?"*). Repo `Paulocpjunior/plano-contas-iob`, Cloud Run
  `plano-contas-iob` (us-west1, projeto `projetos-app-sp`), MESMO Firestore do
  CFI. **Ele agora TEM CLAUDE.md** — o estado do módulo mora lá, não aqui; a
  falta dele era a causa da confusão entre sessões.
  O QUE O CFI DEVE AO REINF: as contas do R-4020 e do R-2055 já existem deste
  lado (NFS-e tomadas com `valores.ir/inss/csll/pis/cofins`, relatório de
  Retenções, aba 🌾 com FUNRURAL). A integração é LER A MESMA FONTE — o REINF
  hoje come planilha por upload, e redigitar é o que não pode.
  **ACHADO QUE MORDE OS DOIS LADOS (07/08)**: o export de NFS-e do portal de SP
  **não traz a CSLL individual** — a coluna rotulada "CSLL" é o **TOTAL** das
  três contribuições federais. Verdade conferida contra o print do IOB
  (CLINIPAR, base 590,10: 27,44 = PIS 3,84 + COFINS 17,70 + CSLL 5,90). O
  importer gravava `valorCsll` a partir dela, então o relatório de Retenções
  superestima a CSLL. `retencao-federal-coerencia.js` acusa pela ASSINATURA DE
  ALÍQUOTA (PIS 0,65 · COFINS 3 · CSLL 1 · CSRF 4,65) — e a derivação da CSLL
  por subtração só é aceita quando os TRÊS lados fecham (feita no repo do
  REINF). O portal também exporta o MESMO layout de 73 colunas em CSV (";") e
  TXT (TAB): o parser só lia ";" e devolvia zero nota em SILÊNCIO.
  🚨 **E A NOTA DE 07/08 MOSTROU A SEGUNDA DOENÇA, PIOR QUE A PRIMEIRA**
  (NFS-e 00375235, ELEVADORES ATLAS SCHINDLER → CONDOMINIO EDIFICIO MONTE
  CARLO, base 3.413,24): os campos **PIS 56,32 (1,65%) e COFINS 259,41
  (7,60%)** NÃO são retenção — são o tributo do PRESTADOR no regime
  **NÃO-CUMULATIVO**, e a própria nota diz isso em "Outras Informações"
  (*"Informações preenchidas nos campos de PIS e COFINS são referentes aos
  valores totais sobre a operação"*). A retenção de verdade estava no campo de
  **contribuições sociais retidas: 158,72 = 4,65% (CSRF)**. O importer grava
  esses campos como `pisRetido`/`cofinsRetida` — nome que MENTE — e mandá-los
  ao R-4020 declararia **315,73 no lugar de 158,72**, quase o dobro. A trava
  é a mesma ASSINATURA DE ALÍQUOTA: 1,65% + 7,60% juntos só existem no
  não-cumulativo, então `conferirRetencaoFederal` devolve a situação
  `campos-sao-totais-da-operacao` — que antes caía no genérico "alíquota fora
  ⇒ pode ser base com dedução ou valor digitado errado", alarme sem ação. A
  CAUSA VAI JUNTO DO NÚMERO também no payload do R-4020 (`camposDaOperacao`
  no resumo + ressalva própria), e a ressalva genérica desconta essas notas
  pra não contar a mesma duas vezes. Continua valendo o ALERTA, NUNCA
  CONTORNO: o app aponta o campo certo (CSRF) e NÃO rateia entre PIS/COFINS/
  CSLL — esse rateio não está no documento.
- **O APP É UM SAAS MODULAR, E O DESENHO É POR TÚNEL** (Paulo, 08/08 — o
  escopo de engenharia dele, palavra por palavra: banco Firebase; cadastro de
  empresas unificado; cofre de certificados que só ele acessa mas todos os
  módulos usam; usuários unificados com DEPARTAMENTO obrigatório em caixa de
  seleção; *"passamos a ser um App-SaaS completo dividido em módulos"*; mesmas
  URLs). DECISÕES FECHADAS: (1) **tudo VIA TÚNEL, nenhum projeto se move** —
  são projetos pagos, cada módulo fica no GCP dele; (2) **empresa se cadastra
  SÓ no CFI**; (3) os módulos são os 5 que existem — 🧾 Fiscal (CFI),
  📊 Contábil (`plano-contas-iob`), 👥 DP/Folha (`consultor-dp-folha`),
  📋 Legalização, 💰 Financeiro (`gen-lang-client-0888019226.web.app`).
  **DEPARTAMENTOS NO AR (08/08)**: `users.departamentos[]` (catálogo em
  `cadastro-central-departamentos.js`, 20 testes) + chips azuis no Gerenciar
  Usuários + túnel `GET /api/admin/cadastro/usuarios[/:email?modulo=]` e
  `POST /usuarios/:uid/departamentos` (SÓ requireAdmin — **app irmão pergunta,
  não define**: gravação via túnel seria auto-concessão com máquina no meio).
  Regras que mandam: departamento DESCONHECIDO é RECUSADO na gravação, nunca
  descartado (lição #382); usuário SEM departamento não some e a recusa de
  login no módulo DIZ "sem vínculo, peça ao admin" (não "usuário inexistente",
  que manda trocar senha à toa); admin abre tudo; rules com anti-autoconcessão
  espelhando modulosPermitidos (`departamentos` não nasce preenchido nem se
  auto-edita). `modulosPermitidos` continua sendo OUTRA coisa: libera cards
  DENTRO do CFI; departamento libera o app irmão INTEIRO.
  **GATES LIGADOS EM TRÊS MÓDULOS (08/08), todos em MODO AVISO** — mesma
  tabela de verdade (mudar um sem os outros faria os módulos responderem
  coisas diferentes à mesma pessoa): 📊 Contábil v3.4.84 (rota
  `/api/departamento/gate` + túnel; vira bloqueio com env
  `DEPARTAMENTO_GATE_MODO=bloqueio` no Cloud Run); 📋 Legalização v1.0.24
  (SEM túnel de propósito — mesmo Firestore do CFI, lê `users` direto;
  mesma env); 👥 DP/Folha v2.1.4 (SPA sem backend: chama o túnel DIRETO do
  navegador com o token do projeto `consultor-dp-folha`; CORS do CFI já
  conhecia as origens; virada é `VITE_DEPARTAMENTO_GATE_MODO=bloqueio` no
  BUILD, app estático não tem env de runtime). REGRA DOS GATES:
  indeterminado LIBERA nos dois modos (túnel fora/e-mail não verificado/
  banco piscando = log, nunca banner nem bloqueio — trancar o escritório
  porque um serviço piscou é o dano maior; contraste deliberado com emissão
  de guia, onde indeterminado PARA). SEQUÊNCIA COMBINADA (Paulo: "vamos na
  sequência, por último eu vinculo o colaborador"): falta 💰 Financeiro
  (`gen-lang-client-0888019226.web.app` — repo ainda não localizado; exige
  somar origem no CORS do CFI e projeto no crossProjectAuth do cadastro),
  depois Paulo vincula a equipe nos chips e as chaves viram bloqueio.
  **CHAVES VIRADAS PARA BLOQUEIO (08/08, ordem do Paulo após teste com 2
  vinculados)**: Contábil e Legalização por `--update-env-vars` no deploy
  (`DEPARTAMENTO_GATE_MODO=bloqueio`); DP e Financeiro por
  `VITE_DEPARTAMENTO_GATE_MODO=bloqueio` no build do workflow. A PARTIR DAÍ
  colaborador sem chip fica FORA do módulo (a tela de bloqueio diz onde se
  arruma); admin passa sempre; indeterminado segue liberando. Voltar pra
  aviso = reverter a env no workflow do módulo (um commit).
  **CONSUMO DO CADASTRO DE EMPRESAS FECHADO NOS 4 MÓDULOS (08/08)**: cada um
  no desenho que a FONTE dele pede — 📊 Contábil consome empresas/responsável/
  certificado nas telas do REINF (rotas /api/admin/reinf/* + túnel);
  📋 Legalização (fonte Jotform, mesmo Firestore) cruza itens direto com
  simples/lucro_empresas (v1.0.25); 👥 DP (cadastro próprio de empresas)
  cruza pelo túnel na aba Empresas (v2.1.5); 💰 Financeiro (fonte Jotform,
  Paulo confirmou 08/08) confere SÓ transações com CNPJ preenchido no
  Dashboard — nome livre e CPF de PF ficariam como alarme sem ação, então PF
  é CONTADA na frase e fica fora da lista. Regra comum: alerta nunca
  reescreve nada; túnel fora do ar devolve null (bloco some — lista vazia
  seria lida como "cadastro central vazio", mentira).
  **💰 FINANCEIRO LIGADO (08/08, mesmo dia)**: repo
  `Paulocpjunior/https-github.com-Paulocpjunior-sp_dashboard_financeiro`
  (nome torto é do GitHub; o `sp_dashboard_financeiro` sem prefixo é
  VERSÃO ANTIGA, push de maio). Gate no `ProtectedRoute` (mesmo desenho do
  DP: SPA chama o túnel direto do navegador; virada por
  `VITE_DEPARTAMENTO_GATE_MODO` no build). PECULIARIDADE: o login de lá
  aceita USERNAME (`loginIndex` → authEmail), então a pergunta ao túnel vai
  com o e-mail do PERFIL (`users.email`), não o do Firebase Auth — a
  credencial técnica daria "usuário não encontrado" pra usuário certo. No
  CFI: `PROJETO.financeiro='gen-lang-client-0888019226'` na lista da rota
  do cadastro + as duas origens `web.app`/`firebaseapp.com` no CORS.
  **FASE 4 NO AR NO LADO CFI (08/08)**: gateway completo — só "assinatura
  remota" NÃO elimina a 2ª cópia do A1 (o mTLS com a Receita exige a chave na
  máquina que abre a conexão), então o CFI assina E TRANSMITE.
  `POST /api/admin/reinf/gateway/transmitir` (eventos SEM Signature +
  contribuinte) e `GET /gateway/lote/:protocolo` → `reinf-gateway.js` (19
  testes) + `reinf-gateway-routes.js`. Assinador/lote são PORTES do código
  provado do plano-contas-iob (R-1000/R-4010 homologados) com UMA
  generalização: o elemento do evento é achado pelo id (`<evt* id="ID+34">`),
  não por lista de nomes — serve evtRetPJ/evtAqProd/série toda. Lições
  MS0017 preservadas e testadas (minifica antes de assinar; wrapper do lote
  não repete o id assinado; id duplicado é RECUSA). TRAVAS: produção restrita
  (tpAmb=2) é padrão e produção exige `confirmoProducao:true` (desenho da API
  DARE); auth = admin CFI ou túnel [fiscal, contabil] SÓ (DP/Financeiro não
  transmitem Reinf); cert sai do cofre pela RAIZ (`loadCertEmpresaPorCnpjBase`,
  padrão escritório 44388152000189); pfx→PEM reusa `pfx-to-pem.js` (NÃO criar
  cópia); auditoria em `reinf_gateway_lotes` SEM o conteúdo do evento (é
  declaração do cliente; guarda ids/elementos/protocolo/fingerprint).
  🧪 **GATEWAY PROVADO 09/08 (Paulo clicou, lote ACEITO)**: "PROVADO: lote
  aceito em produção restrita via gateway", protocolo 2.202608.33245995 — o
  CFI assinou com o A1 do cofre e a Receita aceitou. A chave
  `REINF_TRANSMISSOR=gateway` foi LIGADA no deploy do plano-contas-iob no
  mesmo dia (transmissões de lá agora saem por aqui; o A1 local deles nem é
  carregado). O caminho até o PROVADO custou 5 versões (v3.4.88-92, lições no
  CLAUDE.md de lá): 🧪 exigia beneficiário à toa; 401 de e-mail não
  verificado era a trava CERTA do túnel sem CAMINHO na tela (banner +
  verificação); e o 401 persistia após verificar porque getIdToken() cacheia
  1h — o getToken de lá agora se autocura lendo o claim. PENDENTE: uma
  transmissão REAL (R-1000 + movimento) via gateway com recibo conferido; só
  DEPOIS apagar o `reinf-cert-a1` de lá. Enquanto isso, a conferência dos
  DOIS COFRES pelo fingerprint (v3.4.83 do REINF) acusa divergência de
  renovação.
- **CADASTRO CENTRAL: o CFI é DONO do cadastro dos apps irmãos** (ideia do
  Paulo, 07/08, logo depois do "CNPJ não cadastrado" para empresa cadastrada:
  *"por que não construir um túnel que leva ao nosso BD — cadastros em geral,
  empresas, colaboradores, certificados?"*). O problema não é conveniência: o
  MESMO cliente vive no CFI, no Consultor Contábil e no Legalização, com
  cadastro e grafia próprios — e cadastro duplicado não fica igual, fica
  **PARECIDO**, que é pior porque ninguém desconfia.
  `GET /api/admin/cadastro/empresas[/:cnpj]` → `cadastro-central.js` (15
  testes). **O CNPJ SAI SEMPRE EM DÍGITOS** — normalizar na saída é o serviço
  que o túnel presta, e é a correção na raiz do erro que a colaboradora viu.
  As FILIAIS da raiz vão junto (o SN-Entregar exige todos os estabelecimentos).
  Duplicata e cadastro sem CNPJ **não somem**: vêm contados, porque esconder
  faria o outro app achar o cadastro limpo quando não está.
  🔒 **CERTIFICADO A1 NUNCA TRAFEGA NO TÚNEL**, e não é esquecimento: é CHAVE
  PRIVADA que assina documento fiscal em nome do cliente. Chave copiada é chave
  que não se controla mais — sai do Secret Manager, entra na memória de outro
  app, vira log, vira cache, e se vazar ninguém sabe de qual cópia veio. O
  desenho é **levar a OPERAÇÃO, não a chave**: o outro app pede "assine isto
  para o CNPJ X" e quem assina é o CFI, onde a chave já mora e onde já existe a
  regra de matriz/filial por raiz (`selecionarCertA1PorBase`). Do túnel o
  certificado sai só como METADADO (titular, validade, raiz, apto), que
  responde 100% do "dá pra transmitir?". FASES: 1) empresas ✅ · 2) colaborador
  responsável pela carteira ✅ · 3) metadados de certificado ✅ · 4) assinatura
  como operação remota.
  **FASE 3 NO AR (07/08)**: `GET /api/admin/cadastro/certificados[/:cnpj]` →
  `cadastro-central-certificados.js` (21 testes). Responde *"dá pra transmitir?"*
  SEM mover a chave: sai titular, emissor, validade, raiz, fingerprint e
  `temArquivo`/`temSenha` (a EXISTÊNCIA das partes sigilosas, nunca o conteúdo)
  — `storagePath` e `passwordEnc` não aparecem em caminho NENHUM, e um teste
  serializa as quatro situações pra provar. **A REGRA DA RAIZ VALE AQUI**:
  filial sem cert próprio é `apto-pela-raiz` e a resposta diz DE QUEM é o
  certificado (assinar em nome de terceiro não pode ser dedução); túnel que
  dissesse só "esta empresa tem cert?" faria o outro app deixar de transmitir
  por impedimento inexistente. Cinco situações com AÇÃO própria: apto-proprio,
  apto-pela-raiz, vencido (≠ sem-certificado — outra ação), a3-nao-assina-em-nuvem
  e cadastro-incompleto (aparece cadastrado e não assina: o pior dos dois
  mundos). Apto vencendo continua apto E já manda renovar. As faixas vêm de
  `cert-vencimento-helper.js` — NÃO escrever "≤30 dias" à mão aqui seria a
  terceira cópia da mesma régua.
  **FASE 2 NO AR (07/08)**: `GET /api/admin/cadastro/responsaveis[/:cnpj]` →
  `cadastro-central-responsaveis.js` (20 testes). Ela responde a pergunta que
  vem DEPOIS de "este CNPJ existe?": *"e quem eu procuro?"* — que hoje sai por
  WhatsApp, de memória. Isso já era necessário pela regra de 05/08 (envio sai
  da caixa de QUEM CUIDA da carteira): app irmão que não sabe quem cuida só
  tem duas saídas, mandar pela institucional (o problema que o Paulo mandou
  corrigir) ou não mandar. TRÊS DECISÕES: (1) **dois `principal` NÃO viram
  escolha silenciosa** — `principal` sai NULO, os dois vêm em `principais[]` e
  o conflito é nomeado; escolher aqui faria o outro app falar com a pessoa
  errada sem ninguém desconfiar; (2) **empresa sem responsável NÃO some** —
  vem com `pendenteDeAtribuicao`, e o `/responsaveis/:cnpj` dela responde
  **200, não 404** (ela existe; o que falta é atribuição — 404 mandaria
  procurar cadastro que está certo, o erro da manhã); (3) o **nome VIVO de
  `users` vence a cópia do vínculo** e a divergência ACENDE. Vínculo apontando
  pra empresa fora do cadastro vira `vinculosOrfaos` contado — quem olha a
  Carteira ainda os vê como atribuídos. O e-mail vem de `users` (o vínculo não
  guarda) porque é dele que o outro lado precisa; sem e-mail, acende.
- **EFD-Reinf: o CFI EXPÕE as notas, o Consultor Contábil apura** (07/08 —
  Paulo passou o projeto do CODEX pro Claude). Os dois apps **NÃO
  compartilham Firestore** (o mapa do outro repo dizia que sim e estava
  errado): `plano-contas-iob` fixa `projetos-app-sp`, o CFI roda em
  `consultorfiscalapp`. Integração por ROTA:
  `GET /api/admin/reinf/retencoes-pj?cnpj=&competencia=` →
  `reinf-retencoes-pj.js` (16 testes). **A rota mora AQUI de propósito**: quem
  conhece a forma do documento é o CFI (NFS-e do portal vem ACHATADA, a do XML
  em OBJETO) — reler isso lá seria a 7ª mordida da mesma armadilha, com as duas
  leituras divergindo sem ninguém ver. DOIS NOMES FEIOS que são o produto:
  **`csllOuTotal`** (no export do portal o campo "CSLL" é o TOTAL da CSRF —
  `csll` faria o outro lado declarar o total como CSLL) e
  **`codigoServicoMunicipal` + `itemLc116: null`** (o código da NFS-e paulistana
  é MUNICIPAL; a natureza do rendimento casa por LC 116 e esse de-para não
  existe aqui, então o campo vai NULO em vez de fingir). Prestador PF vira
  contagem `dePessoaFisica` (é R-4010, outro evento) — some da lista é o que faz
  alguém achar que declarou tudo. AUTH: `crossProjectAuth(projetos)` com a lista
  EXPLÍCITA por rota — pôr projeto na lista global abriria de lambuja o
  `/api/dp-integration/*`, que entrega dado SERPRO de qualquer CNPJ.
  **R-2055 (FUNRURAL sub-rogado) LIGADO no mesmo desenho** (07/08):
  `GET /api/admin/reinf/aquisicao-rural?cnpj=&competencia=` →
  `reinf-aquisicao-rural.js` (12 testes). Era o único evento da série R-2000
  com CÁLCULO PRONTO — a aba 🌾 já apura com vigência de alíquota (LC
  224/2025), tabela de segurado especial e conferência contra o infAdic. A rota
  chama a MESMA `montarDipamCompetencia` e só troca o EIXO: a aba responde por
  NOTA e por MUNICÍPIO, o R-2055 é declarado por PRODUTOR. **Nenhuma conta
  nova, e a ressalva PROÍBE recalcular do outro lado** — dois números pro mesmo
  fato é o pior defeito de um arquivo fiscal. `indAquis` vai NULO (tabela
  oficial que não está aqui) mas `seguradoEspecial` viaja, porque é ele que
  decide o indicador.
  Os nomes dos campos são os do CÁLCULO (inss/gilrat/senar), NUNCA os do
  leiaute: nome que finge ser do leiaute faz o outro lado escrever no campo
  errado achando que conferiu (lição do `csllOuTotal`).
  🐛 **DUAS RÉGUAS PRO MESMO FATO — corrigido 12/08 (caso VINCENZO GUERRA)**:
  Paulo, *"ta puxando aqui os valores de FUNRURAL certinho, mas quando vou CCI
  ele, fala que não tem"*. A aba 🌾 apurava R$ 308,07 de 4 notas de ANTONIO DIAS
  DA SILVA (**08.507.490/0001-29**, 14 dígitos) e esta casca respondia "NENHUMA
  aquisição encontrada", porque a linha era
  `if (doc.length !== 11) { dePessoaJuridica += 1; continue; }`. O 🌾 honra o
  cadastro `produtores_rurais` e a IE paulista com "P" — **CNPJ NÃO
  descaracteriza produtor rural PF** (Com. CAT 45/2008, regra que já estava
  escrita aqui) — e o R-2055 contava dígitos. **A casca NÃO julga natureza**:
  nota que entrou no FUNRURAL já teve a sub-rogação decidida lá. O que sobra é
  NOMEAR a forma: `tipoInscricao` ('cpf'/'cnpj'), `cpfProdutor` **NULO** quando
  é CNPJ (número de CNPJ em campo chamado "cpf" é o `csllOuTotal` de novo) e
  `provaDeProdutorPF` com o carimbo da origem (confiança + motivo + IE). Quem
  recebe bloqueia com a causa na mão; **ninguém deduz o `tpInscProd`**. Doc
  ilegível fica fora mas NOMEADO em `semInscricao` — nunca contador mudo.
  ✅ **E COMO SE RESOLVE: o CPF DO TITULAR** (12/08). O `ideProdutor` identifica a
  PESSOA e a única forma provada contra evento aceito é **tpInscProd=2 (CPF)** —
  a nota traz o CNPJ do ESTABELECIMENTO rural. Quem sabe o CPF é o CADESP, então
  ele entra no cadastro do produtor (`produtores_rurais.cpfTitular`, campo novo
  com bloco próprio na aba 🌾) e o payload passa a declarar por CPF, **carimbado
  com `origemDoCpf: 'cadastro-do-produtor'`** + ressalva mostrando `CNPJ → CPF`
  (declarar em nome da pessoa errada não se desfaz). NÃO é contorno: é o cadastro
  trazendo o que a nota não traz, igual ao `seguradoEspecial` e à opção pela
  folha — ninguém deduz, alguém digita e fica gravado quem foi. Trava: CPF só
  existe para produtor inscrito por CNPJ, e produtor já inscrito por CPF não tem
  "outro" CPF (seria declarar em nome de outra pessoa).
  ✅ **CICLO FECHADO EM PRODUÇÃO (13/08, VINCENZO GUERRA 07/2026)**: R-2055
  transmitido, **R-2099 fechado** (MS7001, recibo 11774083-10-2099-2607-…), e o
  "Totalizador das contribuições sociais sobre aquisição de produção rural"
  devolveu **1656-01 = 249,48 · 1646-03 = 20,79 · 1213-06 = 37,80**. A aba 🌾
  tinha apurado, sobre base 18.900,00 (LC 224/2025), INSS 1,32% = 249,48 ·
  GILRAT 0,11% = 20,79 · SENAR 0,20% = 37,80 — **total 308,07 nos dois lados**.
  Isso entrega DUAS coisas: (1) o **de-para código de receita → componente**,
  que não estava escrito em lugar nenhum e agora vem de RECIBO (as três
  alíquotas diferem entre si, então o casamento é único — não é dedução);
  (2) **corroboração** da apuração por dois caminhos independentes, um deles
  ⚠️ **O XML DO RECIBO ESCREVE O CÓDIGO SEM HÍFEN** (14/08, quando o Paulo mandou
  o arquivo): o de-para nasceu do recibo lido por HUMANO (`1656-01`) e o XML do
  MESMO recibo traz `<CRAquis>165601</CRAquis>`. A comparação só tirava ESPAÇOS
  — colando o XML, que é o caminho que a própria tela recomenda, os três códigos
  cairiam em "desconhecido" e a conferência sairia DIVERGENTE com tudo certo dos
  dois lados. É o pior tipo de alarme falso: o que aparece justamente quando
  está tudo certo, e ensina a equipe a ignorar a conferência que existe pra
  pegar o erro de verdade. Agora a chave é por DÍGITOS (a máscara é enfeite de
  tela), e o código desconhecido volta escrito como a RECEITA escreveu — é esse
  número que a pessoa vai procurar no e-CAC.
  ✅ **E O R-2099 GANHOU LEIAUTE PROVADO no mesmo arquivo** (evento do VINCENZO,
  07/2026, tpAmb=1, recibo 11774083-10-2099-2607-11774083). Ele derrubou DUAS
  deduções minhas do gerador que estava no app irmão: o **namespace é
  `evtFechamento`**, não o nome do elemento (`evtFechaEvPer`) — os dois NÃO
  batem, ao contrário do R-2055 —, e **`evtAquis` é o ÚLTIMO** dos sete grupos,
  depois do `evtCPRB`, e não antes. `infoFech` é `sequence` do XSD: trocar dois
  irmãos de lugar derruba o evento. Era exatamente por isso que produção estava
  fechada lá — a trava pagou o que prometia.
  fora do app. `CODIGOS_RECEITA_FUNRURAL` + `conferirTotalizadorR2099` em
  `reinf-aquisicao-rural.js`, na `REGUAS_VIGIADAS`. **TRAVA QUE MANDA: "MS7001
  evento recebido com sucesso" NÃO é conferência** — prova que o XML foi
  ACEITO, não que a Receita entendeu os mesmos valores, e é contra o
  TOTALIZADOR que a guia é paga (um evento pode ser aceito declarando a menor).
  Sem totalizador colado ⇒ `nao-conferido`, nunca verde por omissão; código que
  a Receita totalizou e o app não conhece fica FORA e NOMEADO (somar por engano
  inventaria divergência). Código novo entra aqui **com o recibo do lado**.
  🧾 **O RITO DO FECHAMENTO GANHOU TELA — e a lição é a falta dela** (13/08):
  a rota do rito (conferir → arquivar em `.../RECIBOS` no SharePoint → avisar o
  gestor da caixa de quem transmitiu) subiu de manhã e ficou **SEM BOTÃO**.
  **Rota que nenhuma tela chama não é funcionalidade — é código morto que dá a
  impressão de entregue**, e é a mesma família do E510 "pronto" que ninguém
  gerava. Agora é a sub-aba **🧾 Fechamento EFD-Reinf** no card DCTFWeb, com
  `GET /fechamento-competencia/preparar`: a lista de eventos sai da auditoria
  do gateway (`reinf_gateway_lotes`), não da digitação — lista digitada ESQUECE
  evento, que é o jeito de dar o mês por fechado com um R-2055 faltando. TRÊS
  TRAVAS: (1) toda linha nasce **sem recibo** (o gateway guarda PROTOCOLO, que
  é lote recebido, nunca recibo, que é evento processado — preencher por
  dedução transformaria "transmitiu" em "entregou"); (2) os códigos de receita
  descem do BACKEND pro front (`codigosFunrural`), senão a tela seria a segunda
  cópia da tabela; (3) valor em branco no totalizador **não vira zero**. O
  de-para `elemento → código` (`evtAqProd`→R-2055) nasceu em
  `reinf-recibo-entrega.js` e entrou na `REGUAS_VIGIADAS`: o gateway fala
  `evtAqProd`, a pessoa e o e-CAC falam `R-2055`, e nomear errado num papel que
  serve de PROVA é pior que não nomear.
  ✅ **RITO PROVADO NA TELA no mesmo dia — VINCENZO 07/2026** (Paulo: *"VINCENZO
  FOI !!!!!"*). Primeira competência fechada pelo painel: R-2055 transmitido,
  R-2099 fechado, totalizador conferido, recibo arquivado, extrato enviado.
  A trava que ficou é a **COMPOSIÇÃO**, não os núcleos: `conferirTotalizadorR2099`
  alimentando `montarExtratoEntregas` é o que roda em produção, e era só ela que
  ninguém testava — cada módulo passava fazendo exatamente o que o próprio teste
  mandava (a família do IPI no E200 e do Bloco H zerado). O que decide se alguém
  pode PARAR DE OLHAR a competência é o FAROL, e o farol nasce da junção. O teste
  ponta a ponta usa os números do RECIBO (base 18.900,00 ⇒ 249,48 · 20,79 ·
  37,80 = 308,07) e cobre **as três formas de não ser verde**: totalizador
  batendo NÃO salva evento sem recibo; sem totalizador é âmbar, nunca verde; um
  CENTAVO a menos derruba e DIZ em qual código. No caminho, o resumo da
  conferência passou a formatar dinheiro em pt-BR — ele vai por e-mail ao gestor,
  e "R$ 308.07" obriga quem lê a decidir se o ponto é decimal ou milhar.
  📌 **O `indAquis` do caso comum JÁ ESTÁ PROVADO: é `1`** — é o valor do
  `evtAqProd` ACEITO em produção (EDUARDO GUERRA × DAMIÃO, banana, 06/2026), e o
  teste do gerador o trava. Compra de produção rural de produtor PF por
  sub-rogação usa 1; outra natureza continua exigindo a tabela oficial.
  🐛 **"—: vende gênero agropecuário" — pendência sobre NINGUÉM** (12/08, mesmo
  print): sobrou uma nota sem participante nenhum, e ela caía no genérico
  "fornecedor com CNPJ e sem IE de produtor" mandando **consultar o CADESP de
  ninguém** (sem nome, sem doc, sem o botão de confirmar) e segurando o farol em
  vermelho. São causas com AÇÕES DIFERENTES: CNPJ sem IE se resolve no CADESP;
  nota sem fornecedor se resolve **relendo o XML** (o mesmo ♻️). Confiança nova
  `sem-contraparte` + pendência `contraparte-ausente` que DIZ qual nota; o
  FUNRURAL também parou de afirmar "não é produtor rural" sobre quem não foi
  lido. Continua BLOQUEANDO o farol — o que mudou é ter ação.
  🐛 **E nota excluída pelo art. 136 parou de cobrar pendência** (mesmo caso,
  notas 95-98): elas saíam do total pela dedup e ao mesmo tempo acusavam "CFOP
  5101 não está na régua de compra de produtor" — 5101 é o CFOP de quem VENDE, e
  a nota nem é escriturada. Alarme sem ação em nota que já não conta é o que
  ensina a equipe a ignorar a lista inteira.
  **R-2010 (retenção previdenciária de serviços tomados) LIGADO 12/08** —
  `GET /api/admin/reinf/servicos-tomados?cnpj=&competencia=` →
  `reinf-servicos-tomados.js` (19 testes). Paulo mandou o `evtServTom` REAL de
  06/2026 **com o recibo de SUCESSO da Receita** (tpEv 2010, CRTom 116201), e o
  módulo nasceu calibrado contra ele — a régua "arquivo aceito > leiaute
  deduzido" pela terceira vez (R-4020, E510, agora R-2010).
  🚨 **O ACHADO QUE MANDA: BASE ≠ BRUTO.** No evento aceito o bruto é 5.755,54 e
  a base retida é **4.604,43** — a `obs` da própria nota diz por quê: **INSUMOS**
  (dedução de material/insumo, IN RFB 971 arts. 121-124), e isso **não vem
  separado na NFS-e**. Declarar base = bruto seria declarar retenção sobre 25% a
  mais. Então a base se PROVA pela **assinatura de alíquota** (mesma técnica do
  PIS/COFINS não-cumulativo do R-4020): retido/bruto ≈ **11%** ⇒ base = bruto
  (provado, `indCPRB`=0); ≈ **3,5%** ⇒ **AMBÍGUO e o app NÃO escolhe** (CPRB
  desonerado × 11% sobre base muito deduzida são `indCPRB` diferentes); entre 0 e
  11% ⇒ houve dedução, a base derivada vai **MARCADA** (`baseOrigem`) e derivada
  não entra em declaração; fora disso ⇒ pendência. Total de base **incompleto sai
  NULO**, nunca parcial — parcial num campo chamado `vlrTotalBaseRet` seria lido
  como a base inteira. `tpServico` (tabela 06, 9 díg.) e `indObra` vão NULOS: não
  estão na nota, e "indObra quase sempre é 0" é o default proibido.
  🧰 **A TELA DO R-2010 ENTROU NO CFI (14/08)** — sub-aba **🧰 R-2010 serviços
  tomados** no card DCTFWeb. O núcleo e a rota existiam desde 12/08 e ninguém no
  escritório conseguia VER o que seria declarado (mesma família do fechamento
  sem botão). A tela CONFERE e não decide: alíquota, base e retenção vêm do
  backend, e um teste barra a tela de refazer a conta. Base **não provada**
  aparece como TEXTO, nunca número — parcial num campo de base seria lido como a
  base inteira. O que ficou de fora é contado na cara (`sem retenção` e
  `prestador PF`, que é eSocial), e lista vazia diz que **não prova ausência de
  retenção**. As ressalvas vêm do backend: repeti-las na tela faria as duas
  divergirem.
  Do lado do 📊 Contábil: `reinf/gerar-r2010.js` (12 blocos de asserção)
  reproduz o arquivo aceito campo a campo, inclusive o id
  `ID1326027010000002026070811123300001`; **UM PRESTADOR POR EVENTO** (decisão
  explícita — o arquivo prova UM `idePrestServ`, não a multiplicidade; empilhar
  foi o que derrubou o R-2055 três vezes com MS0030) e `nfs` repetindo, que é
  inferência DO PRÓPRIO documento (os campos se chamam **vlrTotal**\*).
  ✅ **CICLO FECHADO 14/08 (v3.4.109 de lá)**: tela, cadastro por prestador
  (`reinf_servicos_tomados_prestadores`), gerador e transmissão pelo gateway.
  Ao fechar apareceram TRÊS defeitos que nenhum teste pegava, e os três são a
  mesma família — **"o primeiro decide pelos outros"**, que não derruba nada:
  produz evento **ACEITO declarando outra coisa**, o pior desfecho, porque não
  volta recusa avisando. (1) `indObra` do primeiro prestador ia em TODOS os
  eventos (um `estab` só, repetido evento a evento) — limpeza mensal (0) e
  empreitada total (2) no mesmo mês ⇒ o segundo saía com a natureza do primeiro;
  (2) `indCPRB` saía de `notas[0]`, e ele é UM por evento enquanto o evento reúne
  o mês inteiro ⇒ agora só vale com CONSENSO, divergência é pendência nomeada;
  (3) **o assinador LOCAL achava o evento por LISTA DE NOMES**
  (`evtInfoContri|evtRetPF|evtFech`) e não conhecia `evtServTom`, `evtAqProd` nem
  `evtRetPJ` — só passou batido porque a produção transmite pelo gateway do CFI,
  que já tinha generalizado. Agora acha pelo **id** (`<evt*` + `ID`+34 díg.).
  **REGRA QUE FICA: campo ÚNICO por evento alimentado por uma LISTA não se
  resolve com `[0]`** — ou todos concordam, ou o campo é do ITEM, ou é pendência.
  ✅ **A PONTE ESTÁ VIVA** (07/08, testada pela colaboradora): a tela do R-4020
  chamou o app do REINF, que chamou o CFI, e a resposta que voltou foi a
  mensagem de erro do CFI palavra por palavra — round-trip provado.
  🐛 **E o primeiro teste real achou um defeito meu**: `acharEmpresa` consultava
  `where('cnpj','==',<só dígitos>)` e o cadastro guarda CNPJ em DUAS formas
  (`51227692000146` e `51.227.692/0001-46`). A empresa existia e a rota
  respondia "CNPJ não cadastrado" — **culpando o cadastro por um defeito da
  consulta**, que é pior que só falhar: manda a pessoa procurar problema que
  não existe. NENHUMA outra rota do CFI consulta por igualdade de CNPJ; todas
  varrem e normalizam na leitura. Corrigido em `empresa-por-cnpj.js` (12
  testes), que também devolve as FILIAIS da raiz. **REGRA: nunca consultar
  Firestore por igualdade de CNPJ neste projeto** — o dado tem duas formas.
- **Legalização é APP PRÓPRIO, fora do CFI** (Paulo, 26/07/2026 — corrigiu
  com ênfase a 1ª entrega como card interno): repo GitHub `legalizacao`,
  serviço Cloud Run `legalizacao` (us-west1, mesmo projeto), URL própria.
  MESMO Firebase Auth/`users` (login e roles do CFI valem lá) e MESMO
  Firestore — as rules das coleções `legalizacao_*` (vencimentos/alertas =
  só backend; processos = colaborador cria/edita, admin apaga; cron_logs =
  só admin lê) continuam NESTE repo (deploy-firestore.yml). Fonte = Jotform
  (secret JOTFORM_API_KEY; forms 203618343863862 certidões/certificados e
  210087778597674 parcelamentos; parser casa campo pelo TEXTO da pergunta e
  foi calibrado nos 850 registros reais: CNPJ zerado 00-000…→null,
  "7-PROCURAÇÃO ELETRONICA"→categoria procuracao, "8- NÃO POSSUE
  CERTIFICADO"→semDocumento sem alerta, prefixo (INATIVA)/(PARALIZADA)/
  (SUSPENSA)/(ENCERRADA)→empresaInativa sem alerta). Alertas ao cliente
  30/15/7/3/1/0 + vencido≤60d, idempotência {itemId}_{faixa}, gestor do
  DEPARTAMENTO (jefferson@ — Paulo 27/07: dept. próprio, gestor próprio;
  alexandre@ é só do fiscal/CFI) em BCC; Ajustes (admin) configura cópias,
  e-mails de renovação, link de compra + WhatsApp no alerta e pasta do
  Cofre de certificados no SharePoint (renovação detectada no sync copia
  o A1 pro Cofre e notifica). **Contratos IA** (v1.0.14): colaborador marca
  a flag do tipo (constituição/alteração/encerramento/ata/holding/S-A),
  sobe PDF-DOCX e a IA (gemini-pro-latest, GEMINI_API_KEY espelhada do
  CFI) devolve RESUMO TÉCNICO — adequação ao tipo, ortografia,
  concordância, cláusulas por tipo — NUNCA altera o documento; cópia por
  e-mail ao gestor (jefferson@) com colaborador em CC; auditoria em
  legalizacao_contratos_analises (arquivo NÃO é armazenado na análise, só o
  resumo). **ENVIOS AO CLIENTE PAUSADOS desde 28/07** (Paulo: clientes já
  receberam comunicados; regularizar o Jotform antes): chave `alertasAtivos`
  em Ajustes nasce DESLIGADA e o cron respeita — sync roda, nenhum e-mail
  sai; religar só na aba Ajustes. **Jotform Sign** (v1.0.17): a API do
  Jotform NÃO cria nem baixa documentos do Sign (limitação da plataforma,
  verificada 28/07) ⇒ o trilho é WEBHOOK. Fluxo: análise → colaborador
  corrige → "Validar e arquivar" anexa a versão FINAL (vai pro Cofre
  SharePoint em CONTRATOS/{empresa}) → botão abre o Sign → registra
  ID/link do documento → webhook POST /api/legalizacao/sign/webhook?token=
  {SEFAZ_CRON_SECRET} marca 'assinado' e avisa gestor+colaborador (payload
  cru guardado em legalizacao_sign_eventos pra aprender a forma real).
  PENDENTE do Paulo: cadastrar essa URL no Jotform Sign (Settings →
  Integrations → Webhooks) e preencher signLink/contratosPasta em Ajustes. Cron próprio `legalizacao-cron-diario` 7h30 BRT via
  scripts/setup-scheduler.sh DO REPO NOVO (o setup-cloud-schedulers.sh
  daqui NÃO tem esse job). Estado 27/07: **app NO AR** — repo real ficou
  `Paulocpjunior/legaliza-o` (GitHub cortou os acentos), URL fixa
  https://legalizacao-631239634290.us-west1.run.app (health verde no run 5).
  O workflow do repo novo é "instalador completo": pós-deploy grava
  jotform-api-key no Secret Manager (do GitHub secret JOTFORM_API_KEY),
  espelha do serviço do CFI os vínculos de SEFAZ_CRON_SECRET/GRAPH_* e
  tenta criar o scheduler (a SA github-deploy NÃO lê sefaz-cron-secret —
  o passo avisa e segue; quem cria o job é o script manual). **CONCLUÍDO
  27/07**: Paulo rodou `scripts/setup-scheduler.sh` → job
  `legalizacao-cron-diario` ENABLED (30 7 * * 1-5 BRT), apontando pra URL
  nova-geração do serviço (legalizacao-zricstsjqa-uw.a.run.app — mesma
  coisa que a URL numérica). v1.0.4 com identidade própria (nome/logo/
  tema no login). PENDÊNCIA de higiene: o valor do sefaz-cron-secret
  vazou 2× em colas de terminal no chat — na próxima manutenção, gerar
  versão nova do secret e rodar os DOIS scripts de scheduler (CFI + novo).
  Lição de gcloud: `--update-headers` só existe no `update`; `create` usa
  `--headers`. LIÇÕES 27/07 (tarde, v1.0.5→v1.0.10): (1) serviço Cloud Run
  NOVO nasce com CPU-por-requisição — o padrão do CFI "responde e trabalha
  em setImmediate" CONGELA (botão sync não fazia nada); rotas de
  cron/cron-now do app novo viraram SÍNCRONAS + serviço com
  --no-cpu-throttling --timeout 600. (2) Campo checkbox do Jotform devolve
  answer em ARRAY — parser v1 jogava fora e tudo virava "Certidão/Não
  informado". (3) `PARSER_VERSAO` carimbado na meta + `migrarSeNecessario()`
  no boot: parser novo re-sincroniza o banco sozinho no deploy (nunca
  depender de clique pós-deploy). (4) UpdateBanner obrigatório desde o
  1º deploy — Safari segura HTML antigo mesmo com no-store. O card
  Legalização foi REMOVIDO do CFI; deep-link `services/moduloDeepLink.ts`
  ficou (padrão de URL fixa pros hubs internos). **PARCELAMENTO vence MÊS A
  MÊS** (Paulo, 30/07 — v1.0.19): a data do Jotform é a DATA-BASE (1ª
  parcela), não vencimento; `projetarProximaParcela` devolve a próxima
  parcela + o número dela (`Parcela 47/60`), acordo cumprido vira 🏁
  concluído (não alerta, não é vencido) e a idempotência do alerta virou
  `{item}_p{parcela}_{faixa}`. Fim de 144 "vencidos" falsos. **FAROL HONESTO
  VALE PRA CONTAGEM** (Paulo, 30/07 — v1.0.20): o painel mostrava 20 de ~150
  itens na janela -7/+30d por um `slice(0,20)` mudo e contradizia os próprios
  selos dos cards. Regra: lista cortada SEMPRE diz "mostrando X de N";
  `/resumo` manda proximosTotal + quebra por categoria + proximosTruncado, e
  a janela é uma função pura só (`itensNaJanela` no back, `dentroDaJanela` no
  front, com teste cruzado) — nunca reimplementada por painel. **E-MAIL AO
  CLIENTE COM IDENTIDADE PRÓPRIA** (Paulo, 30/07 — v1.0.21→v1.0.23):
  destinatário sai do campo dedicado "E-mail Cliente" do Jotform
  (EMAIL_CLIENTE_TERMOS ordena específico→genérico; PARSER_VERSAO 3
  re-sincronizou sozinho). Casca `montarLayoutEmail` (pura) com logo da SP
  INLINE por `cid:` (anexo isInline no Graph — imagem hospedada fora chega
  bloqueada), cores do próprio logo (#0E3BFA/#091D8D) e rodapé Site ·
  Instagram · WhatsApp, tudo em Ajustes (Instagram nasce VAZIO de propósito).
  **A cor ALTERNA pelo farol** (`coresPorPrazo` → chama o mesmo
  `classificarVencimento`, sem limiar paralelo): vencido vermelho, ≤7d
  laranja, ≤30d âmbar, em dia verde, sem data azul; selo com o prazo na
  faixa e `EMOJI_FAROL` no assunto (antes 90d saía 🟡 com faixa azul).
  Botão "✉️ Enviar teste pra mim" (rota `/alertas/teste`) manda SÓ pro
  e-mail do admin do token — dá pra validar layout com os envios PAUSADOS.
  `departamento`/`motivoRodape` são parâmetros: a casca serve lembrete de
  QUALQUER departamento. ~~PENDENTE: portar a casca pro CFI~~ **FEITO
  02/08** (CFI, autorizado pelo Paulo): `sefaz-backend/email-layout.js`
  (casca + `montarEmailGuia` + `anexoLogo`, logo 21KB em
  sefaz-backend/assets/) aplicada na rota `/das/enviar-cliente`;
  graph-provider do CFI ganhou isInline/contentId. Os repos NÃO compartilham
  código: mudança de layout é NAS DUAS cascas. Farol honesto no e-mail: sem
  PDF do SERPRO, o corpo AVISA que a guia não foi anexada. DARF/DARE seguem
  mailto (sem HTML) — quando ganharem trilho Graph, usar montarEmailGuia.
- **`mailto:` NÃO FUNCIONA pra quem usa Outlook no NAVEGADOR** (equipe via
  Paulo, 05/08: *"clico nessa aba e nada acontece, não vai nem pra
  rascunhos"*) — e é a licença de **90% do escritório**. O `mailto:` exige
  programa de e-mail INSTALADO e registrado como handler do protocolo; sem
  ele o clique não faz NADA, em silêncio, e o app ainda dizia "e-mail
  aberto". Toda tela de envio ao cliente oferece **"Abrir no Outlook Web"**
  (`montarLinkOutlookWeb` → deep link `outlook.office.com/mail/deeplink/
  compose`, cópias separadas por `;`) como PRIMÁRIO e "app instalado"
  (mailto) como secundário — DAS, DARF e DARE já estão nos dois.
  `window.open` do deep link devolve null quando o pop-up é barrado: a
  mensagem diz isso em vez de mentir (`mensagemComposicao`).
  **DUAS COISAS DIFERENTES, e a equipe perguntou certo** ("como ter certeza
  de que a guia foi enviada?"): `email-graph` = o SERVIDOR enviou (Graph 202
  + cópia em Itens Enviados do remetente `GRAPH_REMETENTE`, hoje junior@) —
  ISSO é prova; `email-app` (mailto/Outlook Web) e `whatsapp` = o app só
  ABRIU a composição, quem clica em Enviar é a pessoa — NÃO é prova, e a
  frase da tela nunca pode afirmar envio. `canalComprovaEnvio` decide, o
  painel do rito conta `enviadosPeloServidor` e lista `semProvaDeEnvio` SEM
  transformar isso em rito incompleto (são coisas separadas: rito = arquivo
  + baixa + gestor em cópia). Gestor não recebeu o BCC? Conferir os Itens
  Enviados de junior@ e o lixo eletrônico dele — o BCC não aparece na cópia
  do cliente, então "o cliente recebeu" nunca prova a cópia oculta.
- **REMETENTE = a caixa do COLABORADOR, não a institucional** (Paulo, 05/08:
  *"o cliente tende a entender que eu que enviei e acaba me questionando"*):
  todo envio pelo Graph sai da caixa de QUEM CLICOU (`escolherRemetente` em
  graph-remetente.js, 9 testes), e o cliente responde a quem cuida da
  carteira. GUARDA: só caixa do domínio do escritório (env
  `GRAPH_DOMINIOS_REMETENTE` soma outros) — login de domínio pessoal cai no
  `GRAPH_REMETENTE`. Erro do Graph de caixa inexistente (`ErrorInvalidUser`,
  `MailboxNotEnabledForRESTAPI`) REFAZ pela institucional e o payload diz que
  caiu no fallback; erro de OUTRA natureza NUNCA repete (duplicaria a guia no
  cliente). A auditoria grava `remetente` + `fonteRemetente`. **DARF e DARE
  ganharam trilho Graph** (rota `/api/admin/envio-imposto/enviar-graph`,
  botão "📤 Enviar pelo sistema"): PDF anexado, gestor em BCC e rito #293 no
  mesmo passo. DARE só envia com PDF de PRODUÇÃO (homologação não é guia
  pagável).
- **O DOCUMENTO CHEGA EM DUAS FORMAS — CHATA e ANINHADA — e ler só uma é a
  armadilha que mais mordeu este projeto** (11/08, caso EDUARDO GUERRA ×
  DAMIÃO): o importer PRINCIPAL (`xml-importer.js` — SEFAZ, cofre, XML
  manual) grava os participantes em campos CHATOS (`cnpjDest`, `xNomeDest`,
  `ieDest`, `ufDest`…); `sync-routes` e o abrasf gravam ANINHADO
  (`emitente`/`destinatario`). A DIPAM lia SÓ o aninhado, então nota do
  trilho principal chegava com a **contraparte VAZIA** e caía em
  "fornecedor indefinido" — FUNRURAL R$ 0,00 com o CPF do produtor já
  capturado no banco. **Os 39 testes não pegaram porque TODOS usavam a forma
  aninhada** (o teste fazia exatamente o que ele mesmo mandava — a mesma
  família de defeito do IPI no E200 e do Bloco H zerado). É a 7ª mordida da
  mesma armadilha (NFS-e achatada × objeto, `csllOuTotal`, ISS por painel).
  RÉGUA: `normalizarParticipantesDoc(doc)` (idempotente) monta o aninhado a
  partir dos campos chatos — leitor NOVO de participante passa por ela, e
  teste de leitor DEVE ter caso nas DUAS formas. CUIDADO com `select()` de
  projection: sem os campos chatos na lista, a contraparte some de novo.
- **A TELA DE CORRELAÇÃO DE CFOP MOSTRAVA UM CFOP E O ARQUIVO GRAVAVA OUTRO**
  (Paulo, 12/08, DISTRIBUIDORA DE BANANAS ELS: *"confirma pra mim se é nesse
  campo a correlação de CFOP"*). É essa a tela — mas o `CfopCorrelacaoModal`
  carregava uma **"réplica simplificada da lógica do backend"**, escrita para
  "não acoplar o frontend", e as duas divergiram em DOIS pontos: (1) **venda com
  ST** — a cópia preservava o sufixo e exibia `1405`, **CFOP que não existe** (o
  próprio caso de 05/08: na entrada a família ST não tem 402/404/405, porque
  esses sufixos descrevem a POSIÇÃO DO VENDEDOR); (2) **natureza em branco** — a
  cópia caía em conversão mecânica (1101) enquanto `resolverNaturezaAtividade`
  DERIVA do `indAtividade` e, sem ele, usa o padrão comércio (1102), que é o
  caso COMUM em empresa do Simples. Agora o modal importa `correlacionarCfop`,
  igual ao `iobSageExportService`, e a natureza EFETIVA aparece na tela com a
  ORIGEM (cadastro × indicador × padrão). REGRA: **conferência que promete
  número diferente do arquivo é pior que não ter tela** — nenhuma tela de
  conferência reimplementa a régua que gera o arquivo.
  No mesmo PR, a lista vazia parou de ter uma cara só: "nenhum documento
  capturado" (captura), "documentos sem nota de ENTRADA 55/65" (normal em
  empresa de serviço) e "entradas sem CFOP legível" (buraco de captura) são
  causas com ações opostas. E o filtro passou a usar `direcaoEfetivaDoc` +
  `modeloDoDoc` em vez dos campos crus — nota própria de entrada (tpNF=0) e doc
  sem `modelo` gravado sumiam da conferência em silêncio.
- **CAMPO GRAVADO PODE MENTIR — A RÉGUA DECIDE NA LEITURA** (11/08, MV LIDER
  639: Livro de Saídas e faturamento contando nota CANCELADA). O filtro
  olhava só `d.status`, e o status mentia por DOIS buracos: cancelamento
  homologado **fora de prazo é cStat 155** (o importer só virava com 135, e a
  nota ficava 'autorizado' pra sempre); e evento chegando ANTES da nota criava
  stub 'cancelado' que o merge da NF-e completa **sobrescrevia** com o status
  do protocolo dela — a cancelada ressuscitava. Mesmo desenho da direção
  efetiva (tpNF): `docCancelado(d)` (xml-metadata-helper) decide na LEITURA
  por status OU cStat legado (101/151) OU `eventos[]` 110111 com 135/155 —
  cStat de REJEIÇÃO não cancela, CC-e não cancela, evento sem cStat conta (a
  SEFAZ só distribui evento registrado) — e o backfill idempotente
  (`corrigirStatusCanceladoPorEvento`, no sync-cron) conserta o banco aos
  poucos. Leitor novo de documento válido usa `docValido`/`docCancelado`;
  reimplementar o filtro é criar a divergência de novo.

- **A DCTFWeb É UMA DECLARAÇÃO DO CNPJ, E TRÊS DEPARTAMENTOS A ALIMENTAM**
  (Paulo, 12/08: *"cada dpto faz seu envio com geração de guia e vencimentos em
  datas distintas dentro do mês"*). PAGAR e TRANSMITIR são fatos DIFERENTES: a
  guia sai com a declaração **EM ANDAMENTO** (`GERARGUIAANDAMENTO313`, já no ar
  desde sempre — o app troca o serviço sozinho quando a situação é
  EM_ANDAMENTO), então quem tem guia vencendo cedo **não precisa transmitir pra
  pagar**. Transmitir pra "conseguir a guia" é o atalho que FECHA a competência
  para os outros dois departamentos e obriga retificadora — e era invisível.
  TRAVAS (decisões do Paulo no mesmo dia): **T1** o dono da transmissão é o
  **FISCAL** (`podeTransmitirDctfweb`; a recusa aponta a GUIA, porque é isso que
  o outro depto quase sempre quer); **T2** emitir guia não passa por trava
  nenhuma, só transmitir passa; **T3** insumo pendente NÃO bloqueia — exige
  **justificativa escrita** (≥15 caracteres) que vai pra `dctfweb_transmissoes`
  com o nome de quem seguiu (bloqueio puro faria perder o dia 15 por insumo que
  talvez não venha: multa certa contra retificadora barata; semáforo CAÍDO nunca
  trava); **T4** `dctfweb-retificadora.js` compara a entrada de cada insumo com
  a transmissão e acende "precisa de retificadora" — e se RECUSA a acusar sem
  prova dos dois lados (sem data, mesmo dia sem hora, `sem-movimento` e
  `indeterminado` NÃO acusam; mandar retificar declaração certa é pior que não
  avisar); **T5** retificar É transmitir de novo (o e-CAC monta a nova
  declaração em andamento com o insumo que chegou depois) — o que o app
  acrescenta é o RITO: motivo obrigatório + auditoria antes×depois. O app **NÃO
  promete preview do depois**: os débitos são montados pela RECEITA a partir do
  eSocial/Reinf/MIT. Retificadora **sem efeito** é sinalizada (o insumo pode não
  ter chegado na Receita). Transmitir de novo SEM dizer que é retificadora é
  RECUSADO — retificar às escondidas era possível.
  A transmissão passou a gravar `transmitidoPor`; declaração antiga sem o campo
  não mente, a ressalva diz que ela não guarda quem transmitiu.
- **O IRRF DA DCTFWEB TEM TRÊS ORIGENS E O CFI SÓ ENXERGAVA UMA** (12/08): o
  normalizador conhecia o código 1708 (PJ, R-4020) e mais nada, então as linhas
  de PESSOA FÍSICA do e-CAC (0588 sem vínculo, 3208 aluguéis a PF) não entravam
  em conta nenhuma. `irrf-dctfweb-familias.js` separa PF (R-4010) × PJ (R-4020)
  × folha (eSocial) e — como o de-para código→evento NÃO é oficial — quem manda
  é a **descrição da própria declaração**; o código só corrobora. Conflito entre
  os dois, ou código desconhecido, vai pra `nao-classificado`: FORA dos totais e
  NOMEADO na tela (somar por engano criaria divergência inventada). O cruzamento
  R-4010 × DCTFWeb (`reinf-irrf-r4010-cruzamento.js`) só fica VERDE se a pessoa
  afirmar que subiu todos os eventos — cobertura parcial nunca vira
  conformidade. Retificador SUBSTITUI o original do beneficiário (somar os dois
  dobraria a retenção — lição do FUNRURAL). O parser aprendeu R-4010/R-4020 pela
  forma do gerador HOMOLOGADO do app irmão (`evtRetPF > ideEstab > ideBenef >
  idePgto > infoPgto > vlrIR`) e o arquivo REAL cobrou duas correções: o evento
  pode ser a RAIZ (sem envelope `<Reinf>`) e o namespace pode estar nos FILHOS.
- **O MÊS DO COLABORADOR TEM ESCOPO ESCRITO — `docs/escopo-mes-fiscal.md`**
  (Paulo, 11/08: *"criar regras, processos, deixar claro o mês pro colaborador
  com base no tipo da empresa — Simples, Presumido ou Real — e na carteira dele;
  cria um escopo com regras, travas, processos"*, logo depois de *"cálculos em
  Excel! Eu abomino o uso do Excel para essas finalidades; relatórios sem
  padrão, muito feito na mão"*). É DOCUMENTO DE GOVERNO: feature do fiscal se
  justifica contra ele e mudança de regra/trava entra NO MESMO PR.
  PRINCÍPIO QUE MANDA: **o Excel não é ferramenta, é SINTOMA** — onde a equipe
  abre planilha existe lacuna do app, e a lacuna vira linha do §7, NUNCA um
  "modelo de planilha melhor" (vale pra relatório também: sem padrão é planilha
  com outro nome).
  🚨 **ACHADO ESTRUTURAL DO ESCOPO — TRÊS CATÁLOGOS DE OBRIGAÇÃO QUE NÃO
  CONCORDAM, e o mês nasce do MAIS POBRE**: `tarefas-orchestrator.js` (o cron do
  dia 1, quem CRIA as tarefas) só conhece SIMPLES=DAS+FGTS e LUCRO_REAL=DCTFWeb+
  FGTS+SPED, e mapeia `lucro_empresas → LUCRO_REAL` sempre — ou seja **LUCRO
  PRESUMIDO NÃO EXISTE PRO CRON**, enquanto `services/calendarioFiscal.ts` (que
  o comentário do backend jura ser "o mesmo mapa, sync manual") tem
  LUCRO_PRESUMIDO com PIS/COFINS, EFD-Contribuições, IRPJ/CSLL trimestrais, ECF
  e ECD; e `calendario-obrigacoes.js` é um TERCEIRO mapa. Cadeia do defeito:
  obrigação não vira tarefa ⇒ não aparece em Vencimentos ⇒ não aparece no Guia
  do mês ⇒ o farol diz "mês fechado" com obrigação nunca listada. Não é bug de
  cálculo: é o app REPRODUZINDO a colcha de retalhos. **REGRA Nº 1: um catálogo
  só, no backend, puro e testado; o front lê dele** — e enquanto ele não cobrir
  o regime do cliente, a etapa 4 NÃO pode dar verde (trava T1 do escopo).
  ✅ **FEITO 11/08 — `sefaz-backend/catalogo-obrigacoes.js` (23 testes)**: cron e
  front leem do MESMO módulo (o front virou porta fina, sem catálogo próprio);
  Presumido EXISTE; regime sai de `resolverRegime` e `lucro_empresas` sem
  `regimePadrao` vira INDEFINIDO (recebe só o comum aos dois e entra em
  `empresasSemRegime` no log — adivinhar regime é adivinhar imposto). Nome do
  campo é `obrigacao` (o mesmo do Firestore e do dedup), não "codigo".
  🚩 **ACHADO NO CAMINHO**: os dois catálogos ajustavam dia não útil em direções
  OPOSTAS — o cron ANTECIPAVA, a tela PRORROGAVA, então a MESMA obrigação tinha
  duas datas (FGTS 05/2026: 19/06 na tarefa, 22/06 na tela). Agora a direção é
  CAMPO da obrigação com `baseLegal`; onde discordavam ficou o que a TELA faz (é
  o que a equipe usa; trocar por dedução seria inventar prazo) e a pendência sai
  em `pendenciasDeConfirmacao()`. ✅ **RESOLVIDO 11/08 — Paulo: "SEMPRE
  ANTECIPA"**: é POLÍTICA DO ESCRITÓRIO e é segura por construção (pagar no dia
  útil anterior nunca gera multa; o inverso, sim), então toda obrigação recua.
  O campo continua POR OBRIGAÇÃO em vez de virar constante do módulo — se um
  prazo exigir prorrogação, muda-se UMA linha com a base legal do lado, e um
  teste prova que o mecanismo de prorrogar segue existindo. Segue pendente só a
  condição de folha do INSS patronal.
  **ESFERA É CAMPO DE PRIMEIRA CLASSE** (Paulo, 11/08: *"os vencimentos são
  datas definidas pelos órgãos governamentais, sempre separados por esferas —
  federal, estadual, municipal; isso nunca se altera e é onde deve ser feita a
  consulta"*): cada obrigação leva `esfera` + `abrangencia` ('BR', 'UF:SP',
  'IBGE:...'). Hoje o federal está completo, o ESTADUAL só tem o prazo de SP (o
  SPED — cliente de outra UF NÃO tem prazo cadastrado e a abrangência denuncia)
  e o MUNICIPAL era buraco inteiro: o **ISS entrou como pendência nomeada**
  (`dependeDe: 'calendário do município'`) porque não existe "dia do ISS"
  nacional e carimbar o de SP seria inventar prazo — e porque optante do Simples
  não recolhe ISS próprio (está no DAS, LC 123 art. 13). CONSULTA MENSAL pelo
  Gemini (já plugado com grounding: `googleSearch` + `groundingChunks` com URL)
  é PROPOSTA COM FONTE, nunca escrita direta: o app mostra a DIFERENÇA contra o
  catálogo e humano confirma — data de pagamento não muda sozinha (multa de um
  lado, "atrasada" falsa do outro), e modelo com busca reduz o chute mas pode
  citar blog no lugar do ato. O que a consulta achar vira CADASTRO com vigência
  (régua do IVA-ST: resolve pela DATA do fato, nunca "o mais recente").
  **MATA-BURRO** (palavra do Paulo, 11/08: *"colaborador que não sabe até hoje
  não vai saber amanhã; o que muda o jogo são os freios — prazos, obrigações,
  entregas, quem faz e como faz"*): trava é BARREIRA FÍSICA no caminho, não
  aviso que se lê nem treinamento. Quem não sabe não precisa saber — precisa não
  passar.
  **O PRINT É EVIDÊNCIA, NÃO NARRATIVA** (Paulo, 11/08: *"o colaborador não sabe
  falar o que quer pq não sabe fazer e não sabe explicar"*): NÃO propor campo de
  "descreva seu problema" — descrição errada de quem não sabe é premissa falsa,
  e vale aqui a mesma régua do XML-fonte (a fonte não mente, o relato mente).
  Melhora-se o CONTEXTO automático da evidência (cliente, competência, tela,
  módulo — como a ErrorBoundary), nunca pedindo explicação a quem não consegue
  dar. E a **qualificação da equipe é RESTRIÇÃO DE PROJETO**: minimizar
  julgamento fiscal exigido da pessoa; onde informar é inevitável, o valor entra
  CARIMBADO com a origem. O embasamento jurídico é do Paulo (não é achismo) — o
  meu trabalho é encodá-lo COM a citação e COM teste, pra a tradução cirúrgica
  dele ser feita UMA vez e valer pra sempre.

## Fila de features acordadas (com requisitos)

0. **PENDÊNCIAS 31/07 — decisões tomadas 01/08:**
   a) ~~Menu RELATÓRIOS~~ **v1 FEITA 01/08** (#389): card próprio no grupo
      Gestão (decisão do Paulo), 4 abas — Livro de Entradas/Saídas (por
      empresa, colunas Base/Isentos/Outras pela MESMA alocação do Exportar
      SAGE), Faturamento por carteira (rota nova
      `/api/admin/relatorios/faturamento`, agregação server-side com escopo de
      carteira), Impostos apurados × enviados (lê o painel da Rotina) e
      DIPAM/FUNRURAL (lê a varredura da aba 🌾). Formato escolhido: **PDF com
      identidade SP** (casca única `services/relatorioPdf.ts` — logo +
      #0E3BFA/#091D8D + paginação; toda aba nova DEVE usá-la). REGRA: relatório
      NUNCA tem conta própria — lê o endpoint da tela de origem (lição do card
      4). **v2 01/08 (#390)**: lista completa do Paulo — Resumo por CFOP,
      ICMS/IPI/ISS destacados, Serviços tomados/prestados, Retenções e Resumo
      por UF (agregações puras em `services/relatoriosAgregacoes.ts`, recorte
      buscado 1× por empresa/competência servindo todas as abas) + Ficha
      Financeira do Lucro em PDF. `valores` da NFSe passou a gravar
      ir/inss/csll/issRetido/valorIssRetido (docs antigos não têm — o
      relatório de Retenções SINALIZA "ausente ≠ zero retido"). **v3 01/08**:
      os 4 do inventário do E-Fiscal (Paulo confirmou: extinto/desuso fica
      FORA) — 🚫 NF Canceladas/Faltantes (numeração POR EMITENTE, não por
      direção: nota própria de entrada tpNF=0 consome número do talão;
      buraco ≠ nota perdida — pode ser inutilização na SEFAZ ou captura
      incompleta, ressalvas na tela e no PDF), ➗ Por alíquota (mesma régua
      CST do SAGE; deriva de vICMS/vBC quando pICMS não foi gravado), 📦 Por
      produto (NCM+descrição; qtd só com unidade única) e 👥 Por participante
      (fornecedores|clientes, cobre também a listagem "Clientes e
      fornecedores" do SAGE). Lista de tela cortada em 50 SEMPRE diz
      "mostrando X de N — o PDF traz todos".
   c) **Identificação obrigatória dos relatórios** (Paulo, 01/08): todo PDF
      POR EMPRESA leva o bloco "Responsável pela empresa" (sócio/adm, ≠
      colaborador da carteira) + "Contador responsável" (nome+CRC). Campos em
      `dadosFiscais` (respLegal*/contador*), seção ✍️ do modal Dados Fiscais,
      whitelist + rota de perfil no mesmo PR (regra #382). Farol honesto:
      faltou cadastro ⇒ o PDF IMPRIME "não cadastrado" (o buraco fica no
      papel) + aviso âmbar na tela + pendência 'atencao' na conferência de
      cadastro/Carteira. Relatórios de CARTEIRA (multi-empresa) não levam o
      bloco. `montarIdentificacao` (relatorioPdf.ts, pura). CRC é formato
      LIVRE (varia por regional — não stripar).
   b) **Varredura do E-Fiscal SAGE** — 1ª leva ANALISADA 01/08 (2 Gravadores
      de Passos do Paulo): inventário completo do menu Relatórios em
      `docs/inventario-relatorios-efiscal.md`. Achados: CFI já cobre livros/
      retenções/carteira/produtor rural (nosso 🌾 calcula FUNRURAL+1400, o
      SAGE só lista); **vale construir** na ordem — NF Saídas Canceladas/
      Faltantes (completude de numeração, casa com a Cobertura de Saída),
      Resumo por fornecedor/cliente, Resumo por alíquota, Lançamento por
      produto, listagem Clientes/Fornecedores; **não vale** — DIPJ (grupo
      inteiro é obrigação EXTINTA que o SAGE nunca removeu), fila de
      empresas, cadastros estáticos. PERGUNTAR ao Paulo: alguém usa "Simples
      Paulista – DIFAL" e "Método Permanente CAT 17/99"? REGRAVAR (limites
      do Gravador de Passos): topo da árvore de Relatórios (só guarda os
      últimos 25 prints — subir o limite nas configurações) e REINF de novo
      ABRINDO cada tela (menu suspenso aberto não sai no print; a gravação
      veio vazia). **REINF capturado 02/08** (menu completo no inventário):
      R-1000/R-1070/entidades ligadas/eventos periódicos/R-2050 + submenus
      Informações Complementares e Relatórios AINDA fechados. Achado REINF
      vai pro Consultor Contábil, não pro CFI — gancho: o FUNRURAL
      sub-rogado do 🌾 é a fonte natural do R-2055 lá.
      Demais menus (Movimentos/Imposto/Impressos/Diversos/Estaduais/
      Utilitários) seguem pendentes de gravação.

1. ~~Retificação DCTFWeb/MIT pelo CFI~~ **FEITA 24/07** (#292): seção
   "Retificar com os valores do app" (admin) na Conferência DCTFWeb ×
   Apuração. Regras implementadas: rota `/mit/retificar` com requireAdmin
   E revalidação de role no orquestrador; exige apuração ENCERRADA
   (situação 3 — senão aponta o fluxo de preenchimento); preview
   obrigatório antes → depois por tributo; débitos de família que o app
   não apura são PRESERVADOS (nunca remove tributo declarado); código de
   débito vem do débito atual da própria família (família nova cai no
   mês-modelo; sem código → falha clara); débito não classificável derruba
   tudo (e-CAC manual). Auditoria em `dctfweb_mit_retificacoes` (antes/
   depois/quem). Builder puro `montarDebitosRetificacaoMit` (11 testes).
   Validar com o caso real CLINICA MANTOAN 06/2026.
2. ~~Consolidação da Central de XMLs: 16 → 8 abas~~ **FEITA 24/07** (#277):
   8 grupos + sub-abas (padrão DctfwebHub), zero mudança de lógica. Grupos:
   Dashboard | Captura (Diagnóstico·Status·Backlog·NFC-e·Portal SP) | XMLs |
   Importar (Manual&Cofre·PDF·CSV) | Empresas | Integrações (SharePoint·SAGE)
   | Relatórios&Logs | Config.

## 🙋 FILA DO PAULO — só ele resolve (15/08, "5 pontos meu")

Não são trabalho de código: são LEITURA ou CLIQUE na produção, que este
ambiente não alcança (a rede do container não chega no Cloud Run). Enquanto
estiverem abertos, **não tratar o número da tela como fechado** — vale a regra
de 12/08: print sem versão não é evidência, e pendência aberta não vira fato.
Riscar daqui quando ele confirmar; nunca "concluir" por dedução.

0. **CLOUD RUN — sobraram DUAS, e nenhuma muda imposto** (16/08; a terceira,
   que era a única urgente, virou decisão e saiu da fila).
   a) ✅ **RESOLVIDO 16/08, e não por comando: por DECISÃO.** O
      `GEMINI_MODEL_PRO` aponta para o alias do Flash, e Paulo respondeu *"não
      vejo problema em continuar no Gemini Flash desde que seja a última
      versão"*. **SAIU DA FILA DELE** — não há nada a fazer no Cloud Run por
      causa disto. O app parou de acusar em vermelho e passou a vigiar a
      condição DELE (ver `conferirAtualizacao` acima). Se um dia quiser os dois
      degraus de volta, o caminho é remover os dois envs
      (`--remove-env-vars GEMINI_MODEL_PRO,GEMINI_MODEL_FLASH`).
   b) ✅ **RESOLVIDO 17/08** — `SISTEMA_DEV_EMAILS=p.c.pereira@me.com` gravado e
      **em vigor** (100% do tráfego na revisão `-01034-4r8`). Aberta desde 31/07.
      ⚠️ Confirmação por RESULTADO ainda pendente: abrir Sistema→Banco com um
      admin que NÃO seja esse e-mail e ver se é barrado.
   c) Rotação do `sefaz-cron-secret` (higiene: o valor vazou 2× em colas de
      terminal no chat). Exige rodar de novo os DOIS scripts de scheduler.
      🚨 **E ELA CAI NA ARMADILHA DO ITEM ABAIXO, com consequência pior**: env
      trocado por `services update` cria revisão a **0% de tráfego**, então os
      crons continuariam batendo com o segredo VELHO e falhariam **calados** até
      o próximo deploy. Trocar o secret exige conferir o tráfego depois.

🚨 **`gcloud run services update` CRIA REVISÃO A 0% DE TRÁFEGO NESTE SERVIÇO —
   env "gravado" não é env "em vigor"** (17/08, ao aplicar o `SISTEMA_DEV_EMAILS`).
   A causa: o `deploy-app.yml` roteia com `update-traffic --to-revisions REV=100`,
   ou seja o tráfego fica **PINADO** numa revisão; qualquer revisão criada depois
   nasce sem tráfego, e o gcloud diz isso na última linha (*"is serving 0 percent
   of traffic"*) — que é fácil de não ler depois de três "✓ Done".
   O env FICA salvo na configuração do serviço, então o **próximo deploy o leva
   sozinho** (o `gcloud run deploy` do workflow passa só a imagem e preserva env).
   Para valer NA HORA: testar pela URL com tag da revisão nova e só então
   `update-traffic --to-latest`.
   ⚠️ **Rotear para LATEST tem efeito colateral**: o serviço sai de "revisão
   fixa" e passa a promover automaticamente a mais nova. O próximo deploy re-fixa
   (sobe com `--no-traffic`, faz health check, então roteia), mas até lá revisão
   criada à mão assume tráfego SEM passar pelo health check.
   ⚠️ E **`--to-latest` às cegas é aposta**: neste serviço o workflow deixa
   revisão sem tráfego justamente quando o health check FALHA, então "latest" nem
   sempre é a boa. Conferir a imagem antes.

1. **NOVA ERA — os seis produtores tirados do FUNRURAL por engano** (14/08). Ele
   clicou ✕ para limpar a lista quando a tela ainda não dizia qual nota era
   qual; as excluídas eram justamente as notas PRÓPRIAS de entrada, que DEVEM
   gerar sub-rogação. O ↩ agora mostra **quanto volta ao total** antes do
   clique, e o bloco 🟢/🟡 diz qual documento é qual. Enquanto não reverter, o
   FUNRURAL da NOVA ERA está **a menor** — e a causa é decisão gravada, não
   defeito: o app está certo e continua obedecendo.
2. **EXPERTE — captura bloqueada** (15/08). Zero documento no banco em QUALQUER
   competência, com IPI apurado na ficha. O farol de lastro agora acende (na
   varredura e na Rotina), mas quem diz o bloqueio é o **📊 Status por Empresa**
   — certificado, procuração ou município sem trilho. É esta empresa que segura
   a prova final do E510.
3. **🏁 Fila de migração — a leitura de "quem pode migrar hoje"**. A tela junta
   as três provas (prova de captura, aptidão da saída, blocos do perfil) e
   ordena por esforço. É ela que decide o ritmo da migração agora que o
   histórico saiu do caminho crítico (decisão de 05/08).
4. **Bloco K — olhar o número da varredura**. A 🚦 Migração já DETECTA produção
   pelos CFOPs desde 06/08. **Zero empresa ⇒ o bloco é descartável como o SAT
   foi**; uma que seja ⇒ vira alvo nomeado. Não dá para decidir sem a leitura, e
   deduzir "deve ter alguém" seria inventar trabalho.
5. **JOAO EVANGELISTA — cadastro duplicado**. Mesma família do WALDESA (24/07):
   excluir é SOFT-DELETE e a lápide precisa aguentar F5 + outro navegador.
6. **ABERTAS EM 17-18/08, cada uma esperando UM dado dele** — nenhuma é trabalho
   de código, e enquanto não vierem **o número da tela não é fato**:
   a) ✅ **RESOLVIDO 21/08 — MV LIDER 639 · 07/2026** (Paulo: *"639 - MV LIDER
      - ok"*). O que fechou: o 🔎 passou a GRAVAR o cancelamento confirmado
      (653) na hora, a fila da reconferência anda (carimbo + antiguidade), o
      640 conta como "não cancelada por recusa" e os dois números da tela
      saem do mesmo instante. Ver o mata-burro "A TELA QUE VÊ A RESPOSTA E
      NÃO GRAVA" no topo.
   b) ✅ **RESOLVIDO 19/08 — KROYA × GOLDLOG.** `17.390.490/0001-82` é a
      GOLDLOG; a captura automática escriturou a entrada dela pela chave e a
      saída correspondente da KROYA foi lançada manualmente pelo ✍️ sem chave,
      exatamente como orientado. Os dois lados estão certos, sem duplicidade.
      Ver o "🚨 A MESMA NF-e É SAÍDA DE UMA EMPRESA E ENTRADA DA OUTRA" acima.
   c) ✅ **RESOLVIDO 20/08 — MANTOAN 0040 · EFD-Contribuições OK** (Paulo:
      *"0040 - MANTOAN - OK"*). O 1010 (que declarava ação judicial com os
      campos preenchidos com 'N'), o M200/M600 zerado, o COD_ITEM vazio dos
      A170 sintéticos e o IND_ORIG_CRED das entradas com CST 70 saíram todos.
      **O que fecha o caso é o recibo, não o arquivo** — e ele veio.
   d) ✅ **RESOLVIDO 18/08 — as ~144 notas da NOVA ERA em `1103`/`1929`/`2104`
      saem NA MÃO** (Paulo: *"decidimos que os demais ajustes faremos
      manualmente"*). O app continua fazendo o que faz: **DIZ** (`NÃO CONSTA` na
      linha + resumo vermelho no topo do ✏️) e **não escolhe o substituto** —
      escolher seria inventar, e inventar é o que produziu o 1405 e o 1655.
      ⚠️ **NÃO ressuscitar como "pendência do app"**: a correção nota a nota é
      decisão dele, não lacuna minha. O que o CFI deve é continuar denunciando.
   e) ✅ **RESOLVIDO 20/08 — PWR 1364 · APURAÇÃO (entrada/saída) + SPED ICMS/IPI
      OK** (Paulo, depois do deploy 626: *"SPED ICMS/IPI - 1364 - PWR - OK"* e,
      no fechamento do dia, *"1364 - PWR (APURAÇÃO ENTRADA/SAÍDA / SPED ICMS
      IPI) OK"*). Primeira empresa do Lucro com o EFD ICMS/IPI fechado ponta a
      ponta. **Não reabrir por dedução**: o cadastro de IPI dela (contribuinte +
      classificação do estabelecimento do 0002) deixou de ser bloqueio porque o
      arquivo passou — quem prova é o recibo, não este arquivo.
   f) 🚩 **PS VIDROS 0896 CONTINUA ABERTA — e a pendência é de CADASTRO, não de
      código**: *Contribuinte de IPI = **Não*** em Empresas → Dados Fiscais.
      Sem isso o E500/E520 continua saindo em comércio, onde o IPI da nota do
      fornecedor é **CUSTO**, não crédito — e o PVA recusa (*"Se não for
      contribuinte do IPI, não deve apresentar os registros E500 e filhos"*).
      A pré-validação já acusa isso antes do PVA, com a ação na frase.
   g) ✅ **RESOLVIDO 20/08 — HS PROJETOS 0304 · APURAÇÃO + EFD-Contribuições
      OK** (Paulo: *"0304 - HS PROJETOS - OK (APURAÇÃO / EFD CONTRIBUIÇÕES)"*).
      Fecha o caso do **F600**, que era um `buildBlocoF` STUB desde sempre: sem
      ele o `VL_RET_CUM` do M200/M600 não abatia nada e o arquivo declarava **a
      recolher MAIOR que o devido**. Fechou junto a correção do M200/M600, que
      punha a apuração CUMULATIVA na seção do não-cumulativo — e que o PVA
      **aceitava**.

## Pendências operacionais (23/07/2026)

- **DARE-SP — mapa dos trilhos (fechado 24/07 com prints reais do portal)**:
  unitário assistido no ar (#281); **Lote DARE TXT no ar (#287)** — formato
  oficial da página DareLote (`CNPJ;servico;MM/AAAA;DD/MM/AAAA;valor;1`,
  máx 50/lote, ponto decimal, serviços proibidos 06305/08101/1044/89202,
  flag 1 = portal calcula acréscimos; botão "🧾 Lote DARE" na lista do
  Lucro varre fichas da competência). **GNRE-lote NÃO serve pros RPA**
  (046-2/146-6) — só 8 receitas "de fora" (tabela CONVERSAO_GNRE_DARE_SP
  com guarda anti-rubrica-errada, #286). Portal tem reCAPTCHA (humano
  emite; app gera/valida/audita). NUNCA gerar número/barras de DARE
  localmente (é do sistema da SEFAZ).
- **API DARE-ICMS credenciada e NO AR (28/07, #325-#335)**: gateway
  `apigateway[-hml].fazenda.sp.gov.br/dare-icms`, header `api-key` do
  Secret Manager (`dare-icms-api-key-hml`/`-prod`), homologação como
  PADRÃO e produção só com confirmação explícita. Payload conferido
  contra o Swagger REAL: serviço vai em `receita.codigoServicoDARE`
  (INTEIRO, não `codigoServico` solto), `dataVencimento` é date-time.
  A API responde **HTTP 200 mesmo RECUSANDO** (`erro.estaOk=false` +
  `mensagens[]`) — 200 nunca é sucesso cego (extrairRecusa). Falha de
  REDE em POST é `indeterminado`, NUNCA 'falha': a guia pode ter sido
  emitida e reenviar duplica cobrança (só GET tem retry). Emissão
  valida e testada em homologação (número, barras 44/48, Pix, PDF); o
  PDF entra no rito #293 (SharePoint → gestor → baixa → auditoria), e
  PDF de homologação NUNCA vai ao cliente.
- **NUNCA emitir guia em LOTE pela API** (Paulo, 28/07 — "já foi
  alertado sobre isso"): imposto sai UMA A UMA, com preview conferido.
  Erro em lote vira dezenas de cobranças indevidas e a SEFAZ não desfaz
  emissão. A rota `/api/emitir-lote` foi REMOVIDA de propósito — não
  recriar. O "Lote DARE TXT" (#287) continua valendo porque é só
  GERAÇÃO de arquivo; quem emite é humano no portal, com reCAPTCHA.
- **PROVA DE CAPTURA é contra a SEFAZ, por CNPJ** (Paulo, 28/07 — NOVA ERA
  79 no CFI × 502 na SIEG, #343): enquanto o app não disser SOZINHO se falta
  documento, a equipe abre o concorrente — e isso é o oposto do produto. A
  prova é o cursor do DistDFe em `sefaz_state`: `ultNSU` (lido) × `maxNSU`
  (o que a SEFAZ tem); `maxNSU > ultNSU` = INCOMPLETO, com o número que
  falta. Núcleo puro `sefaz-backend/prova-captura.js` (18 testes) + rota
  `/api/admin/sefaz/prova-captura?cnpj=` + aba Captura → "🔎 Prova de
  captura" (link direto da lista de XMLs). SEMPRE por RAIZ, matriz e filial
  LADO A LADO (cadastro, certificado e cursor são próprios de cada CNPJ —
  ver a filial e concluir sobre a matriz foi a origem do caso). CNPJ da raiz
  SEM cadastro aparece com o motivo, nunca some da conta. Três ressalvas
  ficam SEMPRE na tela, senão comparar totais engana: (1) matriz ≠ filial;
  (2) DistDFe entrega só ~90 dias e a partir do 1º acesso — histórico
  anterior só por importação; (3) saída não vem ao emitente (Rej. 641).
- **A ROTINA tem ORDEM e ela é uma TELA** (Paulo, 28/07 — "o colaborador
  não está seguindo uma linha de processo: captura notas, valida as nfs,
  cálculo de impostos, entrega de obrigações e emissão de guias", #341):
  card "Rotina do Mês" (1º do menu) mostra, por cliente/competência, as 5
  etapas e o PRÓXIMO PASSO = primeira etapa não fechada, com a ação e o
  botão que leva à tela certa. Núcleo puro `sefaz-backend/rotina-fiscal.js`
  (montarRotinaFiscal/resumirFunil, 25 testes) + rota
  `/api/admin/rotina-fiscal/painel` (uma leitura por fonte, agrupada em
  memória — nada por empresa). Regras: NENHUMA etapa se marca à mão (toda
  prova vem de dado real); zero tarefa = âmbar (o cron mensal não gerou),
  nunca sucesso; guia só fecha com o rito #293 completo (SharePoint +
  baixa); apuração de Simples = faturamento lançado da competência
  (`saveHistoricoCalculo` não é chamado por tela nenhuma), do Lucro = ficha
  do mês. FEATURE NOVA de etapa fiscal DEVE aparecer nesse trilho.
- **ISS PRÓPRIO DE OPTANTE DO SIMPLES JÁ ESTÁ DENTRO DO DAS** (06/08, achado
  ao ligar o ISS na Rotina): o painel 🏛️ ISS SP somava no "a recolher" da
  carteira o ISS de empresas do Simples — mas optante não recolhe ISS próprio
  em guia do município (LC 123 art. 13), ele vai no DAS da MESMA competência.
  Cobrar essa guia é cobrar DUAS VEZES. Situação nova `iss-no-das`: o valor
  aparece na tela (`issForaDoTotal`), FORA do total. **NA VIDA REAL O CASO É
  OUTRO** (2ª varredura, mesmo dia): "dentro do DAS" deu ZERO empresa e "ISS
  zerado" pulou de 35 pra 67 — a NFS-e do optante sai com o ISS **ZERADO**,
  justamente PORQUE ele vai no DAS. Então optante com nota no mês é
  `iss-no-das` tenha ou não ISS destacado; mandar conferir nota zerada de
  optante é alarme sem ação (o DAS sai do FATURAMENTO, o ISS da nota não muda
  guia nenhuma). A tabela ganhou coluna REGIME — sem ela, "0 empresas dentro
  do DAS" é adivinhação. CONTINUA sendo guia do
  município mesmo pra optante: ISS RETIDO como tomadora, ISS fixo/SUP, e
  empresa impedida pelo sublimite (por isso a ação diz pra conferir). Foi o
  REGIME que faltava — a rota lia as duas coleções sem distinguir.
  **A ROTINA DO MÊS ENXERGA O ISS** (mesmo PR): a onda 1 são 157 empresas de
  SERVIÇO PURO, as que NÃO fecham o mês no DAS, e elas apareciam com "✓ Mês
  fechado" devendo ISS. `aplicarIssNaRotina` liga em TRÊS etapas, cada uma
  pelo motivo dela — captura (sem CCM a varredura nem roda; captura incerta),
  validação (nota com ISS zerado é conferência) e guias (ISS próprio e ISS
  RETIDO são DUAS guias, fecham SEPARADAS pelo tipo do envio no rito: /iss/
  sem "retid" = próprio, com = retido). Guias fica ÂMBAR, não vermelho: o app
  não emite guia do município (é no portal da PMSP), então não pode PROVAR que
  saiu — e vermelho eterno em coisa que ninguém consegue fechar vira ruído que
  a equipe aprende a ignorar. Âmbar já impede o "mês fechado".
  **CAUSA JUNTO DO NÚMERO, senão é meio farol** (mesmo dia): dizer "67
  empresas com ISS zerado, confira" é o mesmo erro de dizer "sem movimento" —
  o colaborador vê 67 alertas iguais e não tem por onde começar.
  `iss-zerado-causa.js` (22 testes) separa pelo PRÓPRIO documento: retido,
  optante (a nota carrega `prestadorOptanteSimples`), serviço fora de SP,
  dedução integral e alíquota zero NÃO pedem ação (situação
  `iss-zerado-explicado`); só `aliquota-ausente` (ausente ≠ zero ⇒ buraco de
  captura) e `inconsistente` (a nota diz que tributa e o ISS veio zero) viram
  pendência. A DOMINANTE é a que EXIGE AÇÃO, mesmo sendo minoria — 40 notas de
  optante e 2 inconsistentes ⇒ mostra as 2. Divergência cadastro × nota sobre
  optar pelo Simples ACENDE (`divergenciaRegimePelaNota`): as duas respostas
  dão guias diferentes. A conta do ISS
  virou núcleo (`acumularIssPorEmpresa` em iss-carteira.js) porque agora são
  DOIS painéis lendo o mesmo dado — painel com conta própria diverge sozinho
  (lição do card 4) e a leitura é justo a armadilha achatado/objeto.

- ~~Paulo rodar `setup-cloud-schedulers.sh`~~ **FEITO 24/07** (3 crons
  órfãos criados e rodando OK: das/dctfweb/caixa-postal).
- **Manifestações (ciência)**: 23/07 = TLS www→www1 (#273); 24-25/07 =
  491× "SEFAZ HTTP 500" SOAP Fault → causa-raiz achada 25/07 (#302):
  namespace WSDL sem o sufixo "4" no NFeRecepcaoEvento4 (nfeDadosMsg +
  SOAPAction) — .asmx não roteava. **VALIDAR**: cron roda a cada 2h
  (15 */2 * * *); esperar cStat 135 em massa e resumos virando procNFe.
  Erro agora extrai a razão do SOAP Fault (fim do XML truncado).
- **Obrigações de JULHO nunca geradas**: tarefas-cron-mensal (dia 1)
  falhou em 01/06 e 01/07; job recriado 24/07 mas só dispara 01/08.
  **Paulo: Cloud Scheduler → tarefas-cron-mensal → "Forçar execução"**
  (gera as pendências de julho e destrava as baixas do rito #293).
  vencimentos-cron-diario atrasado 3d — observar segunda 08:00.
- **4BZ CONSULTORIA (Jundiaí) — caso fechado no app, gap do município**:
  card ADN mostra "✓ ADN sem movimento · NSU 0/0" = consultamos certo e
  a prefeitura de Jundiaí NÃO transcreveu nada ao ADN (nem a NF emitida
  24/07). Acompanhar 2-3 dias úteis; se seguir vazio, cobertura via
  importação manual até Jundiaí aderir. TI do cliente configurou nosso
  CNPJ no lugar errado (Bloco 0100 do SPED — não roteia XML); o certo é
  cópia de e-mail no EMISSOR pro cofre OU autXML (instruções prontas na
  Cobertura de Saída).
- ~~SharePoint só recebe docs do cofre~~ **FEITO 24/07** (#279): arquiva
  TODAS as capturas, backfill progressivo por cursor (~2.6k XMLs/dia,
  cron 20 8-20h). SÓ sobe empresa com `sharePointConfig` (grupo+pasta)
  preenchido — equipe precisa preencher as configs; contador `semConfig`
  no resultado do cron mostra o gap. Resumos resNFe não sobem (só a
  completa pós-Ciência).
- **Adoção do cofre (saída mod 55) — NÚMERO SÓ SAI DO PAINEL, NUNCA DAQUI**
  (Paulo, 07/08: *"o cofre autXML não está em zero, eu mesmo te mandei print
  de clientes que já configuraram"*). O "0/388" que morava nesta linha era de
  ANTES da aptidão (#384, 04/08) e continuou sendo repetido como fato — é o
  mesmo erro que a própria `aptidao-saida.js` foi construída pra corrigir: a
  Cobertura de Saída olhava os últimos N dias e confundia "não configurou"
  com "configurou e não vendeu no mês", então cliente APTO aparecia como não
  apto. REGRA: número de adoção se lê no painel **✅ O cliente fez certo?**
  (`/api/admin/sefaz/aptidao-saida`), que prova pelo autXML/cofre de QUALQUER
  data — nunca de memória, nunca deste arquivo. A lista priorizada segue na
  Cobertura de Saída (🎯 prioritárias = emitem mod 55 e pararam de ser
  capturadas), e as "📋 Instruções" vão por ordem de volume só pra quem está
  em `sem-prova`.
- **Cofre de e-mail — 3 formatos reais** (prints do Paulo 27/07, #317/#318):
  anexo .xml, .zip com os XMLs do dia e LINK no corpo (ISS.NET-DF manda o
  .aspx do XML; ERP manda pacote do mês que expira em 7 dias). Cofre NÃO
  depende mais de "não lido" (idempotência própria em `cofre_email_mensagens`
  por messageId) e varre inbox + subpastas + lixo eletrônico. Link só é
  baixado com domínio na allowlist (`gov.br` + `XML_INGEST_LINK_DOMINIOS`),
  https e guarda de SSRF. **Paulo (#320)**: rodar "Recuperar histórico (180
  dias)" no painel do cofre pra trazer o que ficou preso, e autorizar o
  domínio do ERP da Ludus se aparecer em "link recusado".
- ~~Exclusão de empresa não acatada (WALDESA)~~ **FEITA 24/07** (#290):
  exclusão agora é SOFT-DELETE com lápide `_deleted` (deleteDoc físico
  ressuscitava via merge do localStorage de outros navegadores + re-sync do
  login). REGRA PERMANENTE: NUNCA voltar a deletar doc de empresa fisicamente
  nem re-adicionar cópia local de id que a nuvem conhece; enumeradores novos
  de simples_empresas/lucro_empresas DEVEM pular `_merged_into` E `_deleted`
  (padrão em ~35 pontos do backend). Rules: só admin mexe na lápide. Painel
  Simples padronizado = Lucro (fmtCnpj + badge "⚠ duplicada · qual excluir").
  Falta: Paulo excluir as duplicatas WALDESA (badge vermelho) e confirmar
  que não voltam (F5 + outro navegador).

## Contexto vivo (jul/2026)

- **MIGRAÇÃO E-Fiscal → CFI tem DE-PARA VIVO** (Paulo, 02/08: "sempre
  atualizando um de-para"): `docs/de-para-efiscal-cfi.md` — toda entrega que
  fechar/abrir lacuna atualiza o arquivo NO MESMO PR. **E111 FEITO 02/08**
  (era o bloqueio técnico nº 1): núcleo puro `sped-ajustes-apuracao.js`
  (tipo do ajuste sai do 4º caractere do COD_AJ_APUR; código de outra
  UF/ST recusado com aviso; dedução só abate saldo DEVEDOR e excedente é
  sinalizado), aba "Ajustes E111" no card SPED Fiscal, coleção
  `sped_ajustes_apuracao` ({empresaId}_{competencia}). CORREÇÃO embutida:
  E110 campo 11 é saldo DEVEDOR — gerador antigo punha o credor lá (abs);
  agora credor sai 0,00 e vai só pro campo 14. Faltam (por prioridade do
  F0): E220/ST, C800/SAT, bloco G/CIAP, bloco K.
- **F0 HUMANO RESPONDIDO (equipe via Paulo, 03/08)** — respostas que
  APAGARAM lacunas do de-para: (1) SAT NÃO existe mais na carteira (virou
  NFC-e mod 65, coberta) — C800 descartado; (2) regime de CAIXA no
  Presumido: NENHUM cliente — descartado; (3) CIAP: SÓ a EXPERTE — bloco G
  é caso único, EXPERTE fica pra onda FINAL da migração; (4) **DIFAL de
  aquisição EXISTE** (clientes compram de fora e pagam) — é a PRÓXIMA
  lacuna a construir: apuração/conta da guia + C197 (o débito no E110 já
  entra via E111). Validações 5-10 (JOTASUL, EDUARDO GUERRA, Canceladas,
  MANTOAN ok, resp+contador, e-mail DAS) em andamento com a equipe.
  **DIFAL FASE 1 no ar (03/08, desenho do Alexandre)**: consolidado NO MÊS
  pro Simples (consumo+revenda); 426-A (com ST) é INDIVIDUAL por documento
  — aba 🧭 DIFAL aquisição na Central XMLs (`difal-aquisicao.js` puro, 7
  testes + rotas `/api/admin/difal/*`): varredura da carteira Simples +
  apuração por cliente, interna 18% editável POR NOTA, interestadual da
  nota ou derivada (UF 12/7 + orig importado 4%), nota com ST separada da
  consolidação. Guia = trilho DARE existente. **FASE 2 (426-A por documento) e
  C197 do Lucro FEITOS 04/08**: `difal-426a.js` (IA = VA × (1+IVA-ST) × ALQ −
  IC; o IVA-ST vem da Portaria CAT e NÃO está na nota — sem ele o documento
  fica PENDENTE, fora do total) e `sped-difal-c197.js` (16 testes) escriturando
  C195/C197 das entradas interestaduais de uso/consumo e ativo (CFOP
  2551/2552/2555/2556/2557; revenda é outro trilho). CUIDADO: o C197 é a ORIGEM
  DOCUMENTAL, não a conta — o débito no E110 continua entrando pelo E111, e o
  aviso da geração lembra disso. COD_AJ da tabela 5.3 é ESTADUAL e não se
  inventa: sem ele cadastrado (no MESMO doc de `sped_ajustes_apuracao`, que já
  é a aba de ajustes), o registro não sai e vira aviso.
- **DIFAL é POR ITEM, NUNCA por documento** (Paulo, 04/08 — NF 6831 UNIVERSAL
  RJ→JOTASUL SP): "algumas notas podem ter mais de um CFOP, mais de um
  produto, mais de um NCM, isso deve ser tratado OBRIGATORIAMENTE, não pode
  aglutinar; alguns itens podem conter ST ou não". Naquela nota o item 1 é
  CFOP 6102/CST 00 (sem ST) e os itens 2-3 são 6403/CST 10 (com ST) — o app
  classificava pelo TOTAL (`totais.vST>0`) e jogava a nota inteira num lado
  só. Núcleo `difal-itens.js` (26 testes): `itemTemSt` (valor destacado →
  CST/CSOSN 10/30/60/70/201/202/203/500 → CFOP x40x), `encargosDoItem` (usa
  o valor do PRÓPRIO item; sem ele rateia o total e MARCA `encargosRateados`)
  e `classificarItensDifal` → {comSt, semSt, mista}. A MESMA nota aparece nas
  DUAS listas e isso NÃO é duplicidade. **IVA-ST é POR ITEM** (o índice é do
  SEGMENTO/NCM): `apurarAntecipacoes426APorItem`, query `?iva=CHAVE|NITEM:V`,
  e a **guia só libera com TODOS os itens do documento calculados** — faltando
  um, sairia a menor e o extrato não denuncia. ST no total sem destaque por
  item (captura antiga) vai INTEIRA ao 426-A (lado que não subtributa) com
  `stSemDetalhePorItem` + aviso. O importer passou a gravar vFrete/vSeg/vOutro
  POR ITEM.
- **CADASTRO DE NCM** (Paulo, 04/08: "o que nós não temos e devemos
  implementar: um cadastro de NCM, para melhor consulta e parâmetro de
  impostos e ST"): coleção `ncm_parametros` + `ncm-parametros.js` (26 testes)
  + aba 🏷️ Cadastro NCM na Central XMLs. Guarda alíquota interna, IVA-ST,
  CEST, redução de base e "sujeita a ST", POR UF (vazio = todas). DUAS regras
  que mandam: (1) **VIGÊNCIA** — o IVA-ST é de Portaria CAT e MUDA; a
  resolução é sempre pela DATA DO DOCUMENTO (`vigenteEm`), nunca "o mais
  recente", senão nota antiga recolhe com índice novo e o erro só aparece na
  fiscalização; (2) o cadastro **SUGERE, não decide** — `sugerirIvaPorItem`
  NUNCA sobrescreve o que o colaborador digitou, e cada valor sai carimbado
  com a portaria de origem (selo "do cadastro NCM" na linha). Campo vazio
  continua NULO, não vira zero. IVA-ST sem Portaria é RECUSADO na gravação
  (índice órfão não se confere depois). NCM casa por PREFIXO (cadastro de
  4/6 dígitos vale pra posição) e o mais ESPECÍFICO vence. Ligado no painel
  do DIFAL: era ali que o colaborador digitava o mesmo índice toda
  competência.
- **APTIDÃO da saída ≠ ATIVIDADE** (Paulo, 04/08: "como assegurar que o
  cliente fez correto, como podemos confirmar se o cadastro já está apto
  conforme ele informa"): a Cobertura de Saída olha os últimos N dias e por
  isso confundia "não configurou" com "configurou e não vendeu no mês" —
  cobrar quem já fez queima a relação. `aptidao-saida.js` (19 testes) resolve
  pela PROVA: **uma nota, de QUALQUER data**, que tenha chegado por trilho
  automático já comprova. A prova literal é o CNPJ do escritório no
  **`<autXML>`** da nota (`extrairAutXml`/`autorizadoNoXml` no metadata-helper;
  a captura grava `autXml[]` + `autXmlEscritorio` desde 04/08). Doc antigo
  segue provado pela ORIGEM: saída que chegou pela SEFAZ só existe com autXML
  (Rejeição 641). Importação manual/conferência/consulta-chave NÃO provam
  nada — o XML veio pela mão do colaborador. Cinco estados: apto-ativo,
  **apto-sem-fluxo** (o caso injusto que existia), apto-parou (suspeita de
  REGRESSÃO — confirmar, não reenviar instruções), sem-prova (é AQUI que se
  cobra) e sem-saida-55. Rota `/api/admin/sefaz/aptidao-saida` + painel
  "✅ O cliente fez certo?" na aba Importar.
- **GIA caiu em DESUSO** (Paulo, 02/08): não listar como rotina nem gastar
  feature com ela. **SPED Fiscal/Contribuições JÁ É módulo do CFI** (card
  SPED Fiscal: gera mensal/trimestral + conferências; transmissão é no PVA
  da Receita) — o E-Fiscal só fica com a escrituração dos clientes que
  ainda rodam lá (Exportar SAGE) e o REINF. A página /novidades-cfi.html
  reflete essa divisão — manter em dia quando módulos migrarem.

- **XML DE CLIENTE NUNCA ENTRA DIRETO NO IOB SAGE — entra pelo CFI, e o
  e-Fiscal recebe o .FML** (definição do Paulo, 10/08, após análise do zip de
  um cliente: 3.855 XMLs LIMPOS, mas 260 canceladas no formato LEGADO
  pré-2012 — `nfeProc` com o protocolo de CANCELAMENTO `cStat 101` no lugar
  do de autorização, sem o evento 110111 — e o importador do Sage recusa como
  "erro de schema"). A primeira leitura da equipe foi "cadastro sujo do
  cliente" e estava ERRADA: o defeito era de forma, não de dado. O CFI lê o
  legado nativamente (`xml-importer.js`: cStat 101 → status cancelado) e o
  Exportar SAGE grava cancelada como situação 2 do .FML, fora da validação de
  schema do Sage. Resposta padrão pro colaborador: nem alterar lançamento à
  mão, nem pedir arquivo novo ao cliente — rodar o lote pela ponte. Guia:
  `/guia-ponte-sage.html` (botão 📗 no Exportar SAGE; fonte dupla com
  `docs/guia-colaborador-ponte-sage.md`).
- Migração SIEG → CFI em andamento. Saída mod 55 = cofre de e-mail
  (`xml@spassessoriacontabil.com.br`); SEFAZ não entrega saída ao emissor
  (Rejeição 641). Checklist de migração do cofre lista os "falta migrar".
- NFS-e SP = trilho PORTAL CSV (WS legado aposentado — erro 1102; job
  `nfsesp-cron-noturno` pausado). NFS-e Nacional ADN: elegibilidade cruzada
  com município (SP capital fora); restavam 4 empresas para preencher codMun.
- Ferramenta "Conferência CFI × SIEG por chaves" valida migração e importa
  faltantes (cert da própria empresa, pacing anti-656).
- cStat 656: nunca insistir na mesma raiz; padrão round-robin + cooldown +
  circuit-breaker (manifesto) e cooldown 3h no "⟲ 90d" (resetNSU).

## Decisões e memória de 31/07/2026

- **Substituição do SAGE e-Fiscal: F2 (extração do PG12) está FORA DO PLANO**
  (Paulo, 05/08: "não me preocuparia com o passado, o e-fiscal continua ativo
  e servirá para consultas"). DECISÃO ESTRUTURAL — o E-Fiscal NÃO será
  desligado: ele vira sistema de CONSULTA do histórico, e a migração é só do
  que é OPERAÇÃO CORRENTE. Some do caminho crítico: extrair/transformar 89 GB,
  mapear 618 tabelas, bucket GCS, usuário `cfi_leitura`, volumetria do e0299
  (NÃO pedir de novo ao Paulo — o SQL em `docs/pg12/validacao-f2.md` ficou
  obsoleto). O plano virou TRÊS fases: F0 inventário (FEITO — automático pela
  aba 🚦 Migração + respostas da equipe) → F1 dois pilotos Lucro com
  conferência-espelho no PVA → F3 ondas por cliente.
  O QUE PASSOU A MANDAR NO RITMO: completude de captura por cliente (prova de
  captura + cofre de saída) — cliente só migra com a captura fechada, e é aí
  que está o gargalo agora, não mais no histórico. O placar de quem está
  pronto se lê na aba 🏁 Fila de migração; NÃO carimbar número de adoção
  neste arquivo (ver a regra da aptidão acima).
  **A FILA DE MIGRAÇÃO É UMA TELA** (Paulo, 07/08: *"precisamos acelerar"*):
  a resposta "quem pode migrar hoje" já existia espalhada em TRÊS painéis —
  🔎 Prova de captura, ✅ Aptidão da saída e 🚦 Migração — e ninguém abre três
  abas × 388 clientes, então ninguém respondia. `fila-migracao.js` (18 testes)
  + rota `/api/admin/sped/fila-migracao` + aba 🏁 no card SPED juntam as três
  numa fila ordenada por ESFORÇO, com UM próximo passo por cliente (mesmo
  desenho da Rotina do mês). REGRAS: ausência de sinal NUNCA vira prontidão
  (sem prova = bloqueio, não silêncio verde); âmbar da captura TAMBÉM trava
  (resumo sem completa = livro a menor, e migrar leva o erro junto); quem NÃO
  entrega EFD ICMS/IPI não é bloqueado por bloco nenhum — misturar as ondas
  fazia a fila parecer travada com metade dela já pronta. Nenhuma conta nova:
  a régua de cada pedaço fica no núcleo dela (vereditoDoCnpj,
  montarAptidaoSaida, montarProntidaoMigracao).
  O que foi feito na F2 e CONTINUA VALENDO: DDL dos 4 schemas validado e
  guardado (`docs/pg12/efiscal_ddl.zip` — 618 tabelas por empresa =
  pad_modelo, prova de que todo e#### é o mesmo molde) e o Cod.Cliente
  carregado em massa (390 ativas), que virou busca por código nas telas e o
  Nº Empresa automático do Exportar SAGE. PG12 (EOL nov/2024, 1.735 schemas,
  89,5 GB) segue de pé e NUNCA exposto à internet; dado fiscal de cliente
  NUNCA transita pelo chat.
  **O HISTÓRICO NO SAGE TEM BACKUP — não é ponto único de falha** (Paulo,
  11/08, corrigindo uma preocupação minha): **todo sistema da SAGE tem backup
  DIÁRIO em storage na REDE, feito POR PARTES, cobrindo `dbf` + `pg12`**. Ou
  seja, a decisão de 05/08 (e-Fiscal vira consulta do histórico) não deixa o
  passado fiscal pendurado numa máquina só, e NÃO existe pendência de "criar
  política de backup" — ela já existe e é do Paulo. NÃO ressuscitar esse tema
  como risco: é fato conferido com o dono da infra, e repetir preocupação já
  respondida é o mesmo vício de carimbar número velho ("0/388").
- **tpNF DECIDE a direção quando o cliente é o emitente** (#384, 31/07 —
  caso EDUARDO GUERRA no Exportar SAGE): compra de produtor rural PF é NOTA
  PRÓPRIA DE ENTRADA (RICMS/SP art. 136 — tpNF=0, cliente emite, produtor no
  bloco destinatário/remetente). O importer decidia direção só pelo CNPJ do
  emitente → essas notas viravam 'saida', o SAGE recusava o CFOP 1xxx/2xxx e a
  DIPAM não as via. Régua única: `decidirDirecao(..., tpNF)` no import,
  `direcaoEfetivaDoc` (xml-metadata-helper) na leitura, backfill idempotente
  `corrigirDirecaoEntradaPropria` no fim do sync-cron (tpNF==0 && direcao==
  'saida' && emit==empresa → 'entrada'; duas igualdades = sem índice composto).
  Na DIPAM, contraparte da nota própria é o DESTINATÁRIO. NÃO usar "Correlação
  CFOP" pra contornar isso — o CFOP está certo, a direção é que estava errada.
- **"A chave não mente" vale pro DONO da saída** (caso S&P 138, #373): em
  saída o dono é o EMITENTE e o CNPJ dele está na chave (pos 6-20). Dono de
  raiz ≠ raiz do emitente da chave = legado mal atribuído — descartar da
  conta (`docsDonoErrado` no cofre-checklist; card 4 deriva a identidade da
  chave). Régua ÚNICA de trilho automático (`trilhoAutomatico`): origem
  'email'→cofre; 'sefaz'/'autxml' sem fonte manual→autxml; manual/conferência/
  consulta-chave→não confirma. Painel novo de saída DEVE usar as duas réguas
  — o card 4 ficou 2 dias mentindo por ter contador próprio (lição repetida).
- **Material pra equipe NUNCA vai como artifact do claude.ai** (link é
  privado do dono — colaborador recebe "link inválido"). O trilho é HTML
  estático em `public/` servido pelo próprio app. Guia da saída mod 55:
  `/guia-saida-mod55.html` (#374; botão 📗 na aba Manual & Cofre) — fonte
  dupla `public/guia-saida-mod55.html` + `docs/guia-colaborador-saida-mod55.md`,
  atualizar as DUAS juntas.
- **Resumo da Carteira** (#375): tela Carteira abre com total por colaborador
  (principal+backup), quebra pelo farol da conferência de cadastro
  (`services/carteiraResumo.ts` puro — mesma régua do modal
  `cadastroClientePendencias`) e balde "sem responsável" (que também é
  pendência que TRAVA). Operacional: a conta só fica honesta com os vínculos
  da carteira preenchidos — lista grande em "sem responsável" é trabalho de
  atribuição, não bug.
- **COMPRA DE PRODUTOR RURAL = DUAS obrigações da MESMA nota** (Paulo, 31/07 —
  prints do SAGE + NF 425.231, #378): (1) **DIPAM 1.1** — só produtor PAULISTA,
  valor MENSAL agrupado POR MUNICÍPIO de origem, na ficha "Informações para a
  DIPAM B" da GIA **E** no Registro 1400 da EFD (`SPDIPAM11`; um não dispensa o
  outro, Manual pág. 29); (2) **FUNRURAL por sub-rogação** — produtor PF de
  QUALQUER estado (o caso MG do print gera FUNRURAL e NÃO gera DIPAM).
  Núcleo puro `sefaz-backend/dipam-produtor-rural.js` (39 testes) + rotas
  `/api/admin/dipam/*` + aba `XMLs → 🌾 DIPAM / Produtor rural`. REGRAS que não
  podem ser afrouxadas: só **Produtor Rural PF** entra (CNPJ NÃO descaracteriza
  — Comunicado CAT 45/2008; a prova forte é a IE paulista começando com **"P"**);
  lançar PJ no 1.1 é o erro que a SEFAZ desconsidera, então fornecedor sem prova
  fica FORA do total e vira pendência de CADESP — **uma por fornecedor, e só
  quando ele vende gênero agropecuário** (senão toda compra de PJ viraria
  pendência); devolução DEDUZ do município e mês negativo não vai ao arquivo;
  cooperativa usa 1.3; cliente que É produtor PF entrega DIPAM-A e não lança
  1.1. Cadastro em DOIS níveis: `dadosFiscais.condicaoRural` no CLIENTE (a
  marcação faz a obrigação aparecer em mês SEM nota — mês vazio pode ser falha
  de captura) e coleção `produtores_rurais` no FORNECEDOR (natureza CADESP,
  município e opção pela FOLHA, que zera a sub-rogação; só admin grava).
  **Alíquotas do FUNRURAL são TABELA COM VIGÊNCIA** e a base legal está
  CONFIRMADA (Paulo, 31/07): Lei 8.212/91 art. 25 — 1,2/0,1/0,2 (1,5%) até
  31/03/2026 e 1,32/0,11/0,20 (1,63%) a partir de **01/04/2026** pela
  **LC 224/2025**. A virada é pela DATA DA VENDA (não pela colheita); como cai
  no 1º dia do mês, comparar competência AAAA-MM dá o mesmo. **SEGURADO
  ESPECIAL (agricultura familiar) NÃO subiu — segue 1,5%** (tabela própria
  `ALIQUOTAS_FUNRURAL_SEGURADO_ESPECIAL`, ligada pelo campo `seguradoEspecial`
  do cadastro do produtor; a nota não diz isso). PJ não entra: sem sub-rogação,
  quem recolhe é o emitente. Centavo é DESPREZADO (IN RFB 971), igual ao
  SAGE. O app confere o cálculo contra o FUNRURAL declarado no infAdic da
  própria nota e aponta divergência. Bloco 1 do SPED: `IND_VA='S'` só existe COM
  1400 e vice-versa. Detalhes em `docs/dipam-produtor-rural.md`. Guia do
  colaborador: `/guia-dipam-produtor-rural.html` (botão 📗 na aba; fonte dupla
  `public/guia-dipam-produtor-rural.html` + `docs/guia-colaborador-dipam.md`,
  atualizar as DUAS juntas).
  🐛 **323 PENDÊNCIAS "sem código IBGE do município" — e o dado estava no
  ARQUIVO** (12/08): a DIPAM saía R$ 0,00 com o FUNRURAL calculado do lado (ele
  não depende de município). Causa: `preencherEnderecoDestinatario` nasceu pro
  Exportar SAGE e só varria `direcao == 'saida'` — **compra de produtor é
  ENTRADA**, então nenhuma foi tocada. Virou
  `preencherEnderecoParticipantes({direcao})`, com o campo-SENTINELA mudando com
  a direção (`ufEmit` na entrada, `ufDest` na saída — sentinela errado faria
  reler os mesmos docs pra sempre) e gravando os DOIS lados (a nota própria de
  entrada tem o produtor no destinatário). Botão **♻️ Reler município dos XMLs**
  no bloco de pendências + `POST /api/admin/dipam/reler-municipios`. É a regra
  de 06/08: **reler a FONTE é RECUPERAÇÃO, não conserto de cadastro** — mandar
  digitar 323 municípios seria pedir trabalho por dado que já existe. TRAVA:
  **backfill NÃO APAGA** — campo que o XML não trouxe nunca sobrescreve o que o
  importer já gravou; só a UF do lado varrido recebe `''` (é o sentinela).
- Painel Sistema→Banco (#371, dev-only): coleção nova no Firestore = linha no
  `catalogo-banco.js` no MESMO PR (o painel denuncia órfãs). Pendente Paulo:
  definir env `SISTEMA_DEV_EMAILS` no Cloud Run (sugerido p.c.pereira@me.com)
  pra restringir além de admin.

## Decisões e memória de 11/08/2026

- **E510 (IPI) — "ARQUIVO ACEITO > LEIAUTE DEDUZIDO" provou o próprio valor,
  inclusive contra a MINHA primeira conclusão**. Era o último 🔴 que travava
  indústria com IPI, e o de-para dizia "não gera: o CST do IPI não é
  capturado" — mas o CST **estava no XML** (IPITrib 50/99 e IPINT 01-05/51-55);
  o importer é que só lia vIPI/pIPI (#563). O gerador (`sped-bloco-ipi-e510.js`)
  nasceu conferido contra um SPED jun/2026 do e-Fiscal **aceito no PVA**, e a
  sequência de correções é a lição: (1) concluí `VL_CONT_IPI = Σ vProd` porque
  batia campo a campo com o `VL_OPR` do C190 — **errado**: a leitura do C170
  mostrou que o VL_CONT **INCLUI o IPI** (CFOP 1101: 138.396,70 + 4.389,15 =
  142.785,85) e o VL_OPR do C190 também já incluía, por isso "batia" (#565);
  **o PVA NÃO confere o VL_CONT** — só o arquivo real pega. (2) O CST do E510
  **não é o CST cru do XML**: na compra, o CST de SAÍDA do fornecedor vira o de
  ENTRADA do destinatário pela correspondência da IN RFB 932/2009 (50→00,
  51→01, 52→02, 53→03, 54→04, 55→05, 99→49), provado em 4 XMLs da EXPERTE
  (#566). SAÍDA fica com o CST da própria nota — **não** normalizo 99→55, que
  seria corrigir a nota do cliente: acende alerta "confira na origem". Item com
  IPI destacado SEM CST fica FORA com aviso (campo fiscal não recebe default).
  A prova ponta a ponta virou tela: a aba 🪞 **CFI × E-Fiscal compara o E510**
  por CFOP+CST (#568) — é exatamente a conferência que o PVA não dá.
  **FALTA**: backfill dos XMLs de jun/jul já capturados e reproduzir um mês
  INTEIRO a partir dos XMLs-fonte. ⚠️ **CORREÇÃO 12/08**: a linha anterior dizia
  "o doc guarda xmlHash, não o XML cru ⇒ re-capturar" — ERRADO. O
  **XML CRU ESTÁ NO CLOUD STORAGE** (`xml-importer` faz `bucket.file(storagePath)
  .save(xml)` em toda captura, e `storagePath` é gravado no documento). Backfill
  de campo novo de item (cstIpi, cstPis, cstCofins…) se faz REPROCESSANDO o XML
  do Storage — sem tocar na SEFAZ, sem pedir arquivo ao cliente. RISCO ABERTO no de-para: o e-Fiscal inclui
  itens sem CST no E510 derivando por operação (1124→05, 1407→49, 5901→55).
- **COMPRA DE PRODUTOR RURAL TEM DUAS NOTAS DA MESMA ENTRADA — e o FUNRURAL
  estava DOBRANDO** (#567): a NF-e do produtor (nota 1) e a nota própria de
  entrada que o cliente emite (nota 2, tpNF=0). A **RC 33068/2025** é
  categórica — o adquirente escritura SÓ a que ELE emitiu (RICMS/SP art. 136,
  I, "a"). O CFI capturava as duas: par real DAMIÃO × EDUARDO GUERRA (banana,
  R$ 8.400 cada) saía FUNRURAL R$ 273,84 no lugar de R$ 136,92.
  `dedupNotaProdutorComEntrada` pareia por produtor×competência (não há refNFe
  ligando) e exclui a NF-e do produtor **APENAS quando existe a nota de entrada
  que a cobre** — produtor sem par fica INTACTO, porque muitos clientes
  escrituram a nota do produtor direto e nagá-los seria alarme sem ação: a
  dedup desfaz DUPLICIDADE, não impõe processo. E **total que muda sozinho faz
  desconfiar do número certo**: o painel 🌾 lista as excluídas nomeadas em
  bloco âmbar (`excluidasArt136`, #569) — some da conta, não da tela.
- **⚙️ Config Admin** (#571, pedido do Paulo): o backend de templates do
  WhatsApp (Cloud API da Meta) já existia inteiro — faltava a TELA, e os
  horários "não apareciam" por morarem dentro do Gerenciar Usuários. Painel
  admin-only no topo com Templates (cadastro/edição/desativação, status do
  canal na cara pra não prometer envio que não sai) + atalho pros Horários
  (a régua continua por usuário lá; duplicá-la criaria a segunda cópia).
- **Isenção/imunidade no PGDAS-D — ACHADO ABERTO, esperando a fonte** (#573):
  casos **Jaguarexport** (isenção de ICMS — banana) e **POLO CULTURAL**
  (IMUNIDADE de ICMS e IPI, campos separados POR TRIBUTO). O app tira o valor
  do cálculo mas **não envia a qualificação ao SERPRO** — e payload não se
  chuta (entrega ao PGDAS-D não se desfaz; foi o que o MSG_ISN_023 do "sem
  movimento" já ensinou). O caminho é o MESMO que destravou o ISS fixo código
  9: ler a declaração **já ACEITA**. O botão 🔎 Atividades declaradas agora
  guarda a qualificação **BRUTA** (parcelas, percentuais, nomes reais dos
  campos), com dedup pelo CONTEÚDO. **PENDENTE DO PAULO**: rodar o 🔎 na
  Jaguarexport 07/2026 e na POLO CULTURAL 06/2026 e mandar o bloco
  "Qualificações por tributo" — só com ele nasce a marcação por tributo na
  tela (isenção ≠ imunidade: natureza e campo diferentes) e a qualificação no
  pgdasMapper, travada por teste contra o bruto real.
  📄 **EXTRATO REAL DA JAGUAREXPORT 07/2026 recebido (11/08) — o que ele
  RESOLVEU e o que ele NÃO resolve**. Números conferidos, que viram o alvo do
  teste: receita 63.878,60 · `Parcela 1: R$ 63.878,60` · `Isenção de ICMS:
  R$ 63.878,60` · coluna **ICMS = 0,00** (IRPJ 335,49 · CSLL 213,49 · COFINS
  777,12 · PIS 168,35 · CPP 2.561,92 · total 4.056,37); atividade "Revenda de
  mercadorias, exceto para o exterior — sem ST/monofásica/antecipação".
  RESOLVIDO: a SEMÂNTICA. A qualificação é **por PARCELA da receita da
  atividade** (natureza e tributo separados), e o payload do app **já comporta
  isso** — `ReceitaAtividade = {valor, qualificacoesTributarias[]}`, uma receita
  por parcela. NÃO resolvido: o **id numérico da isenção**. O extrato é a saída
  HUMANA ("Isenção de ICMS"); o par `{codigoTributo, id}` só existe no payload.
  Conhecidos hoje: 1004 PIS · 1005 COFINS · 1007 ICMS · 1010 ISS; ids 8 (ST),
  9 (monofásico), 11 (ISS retido). Falta o id de ISENÇÃO e o de IMUNIDADE (e o
  codigoTributo do IPI, pro caso POLO CULTURAL). **A FONTE É O 🔎 nessa MESMA
  empresa/competência** — a declaração foi ACEITA, então o CONSULTIMADECREC14
  devolve a qualificação que o SERPRO aceitou, e o #573 já faz o botão guardar
  o `bruto`. NÃO deduzir o id: MSG_ISN_032 provou que qualificação errada
  derruba a ENTREGA INTEIRA.
  ✅ **RESOLVIDO 13/08 — os ids vieram do FORMULÁRIO, como o código 9 do ISS
  fixo.** Paulo colou o `outerHTML` do `<select>` da coluna de cada tributo na
  tela de Receitas do PGDAS-D no e-CAC (POLO CULTURAL). O que ele entrega:
  **`data-cod-tributo` 1007 = ICMS · 1008 = IPI**, e as qualificações
  **1 = Imunidade · 2 = Exigibilidade Suspensa · 3 = Lançamento de Ofício ·
  4 = Isenção/Redução · 6 = Isenção/Redução Cesta Básica**. Os ids convivem com
  os já conhecidos (8 ST, 9 monofásico, 11 ISS retido) — é um espaço de
  numeração só. **O IPI PARA NO 3**: o `<select>` dele não tem
  "Isenção/Redução", e isso não é omissão do print — é o formulário dizendo que
  esse campo não existe pro IPI, então isenção NUNCA emite qualificação de IPI.
  `CODIGO_TRIBUTO` + `QUALIFICACAO` no pgdasMapper, com o HTML de origem no
  comentário. A imunidade agora VIAJA na declaração (antes o app só tirava
  ICMS/IPI do cálculo, e a Receita recalculava COM os dois — o DAS voltava maior
  que o previsto e ninguém sabia por quê). ⚠️ **A CONFERÊNCIA É OBRIGATÓRIA em
  caso novo**: o DAS é o MESMO com e sem a qualificação, então gerar a guia não
  prova nada — só o extrato denuncia ("Imunidade tributária de: ICMS, IPI."). É
  literalmente a armadilha do ISS fixo (SUP), que passou meses despercebida pela
  mesma razão. ✅ **ISENÇÃO FECHADA no mesmo desenho (#646)**: marcação "Isenção
  de ICMS" na tela, EXCLUDENTE com Imunidade (naturezas diferentes — a imunidade
  é constitucional e alcança ICMS **e** IPI; a isenção é lei estadual e o
  `<select>` do IPI nem oferece o campo), viajando como
  `{codigoTributo: 1007, id: 4}` e chegando no extrato como *"Isenção de ICMS:
  R$ ..."* COM VALOR — enquanto a imunidade sai sem valor, listando os tributos.
  Vale a MESMA conferência obrigatória: o DAS é igual com e sem a qualificação.
  ❌ **O 🔎 NÃO DEVOLVE O ID — premissa minha derrubada por resposta real
  (12/08)**: eu supunha que o `CONSULTIMADECREC14` trouxesse a declaração
  ESTRUTURADA, e o botão foi construído nessa aposta. A resposta de uma
  competência ENTREGUE mostrou outra coisa: `dados` = `{numeroDeclaracao,
  recibo:{pdf}, declaracao:{pdf}, maed}` — **só PDF**. Não vem idAtividade, não
  vem qualificação, não vem `{codigoTributo,id}`. E isso BATE COM A HISTÓRIA: o
  código 9 do ISS fixo nunca veio dessa consulta, veio do **input escondido do
  e-CAC**. A FONTE DO NÚMERO É O FORMULÁRIO: no PGDAS-D do e-CAC, o `<select>`
  de cada tributo (a coluna "Exigibilidade Suspensa, Imunidade, Isenção/Redução,
  Isenção/Redução Cesta Básica, Lançamento de Ofício") tem o id no `value` de
  cada `<option>` — um `Copy outerHTML` resolve isenção E imunidade de uma vez.
  O 🔎 continua útil pra DUAS coisas (provar que a declaração existe e trazer o
  nº) e agora DIZ que o id não sai por ele, em vez de gastar clique. Situação
  `so-pdf` em `interpretarConsultaAtividades`.
  🖥️ **A TELA DE RECEITAS DO e-CAC (print 12/08, JAGUAREXPORT 06/2026
  retificadora) CONFIRMOU A SEMÂNTICA**: a qualificação é **uma coluna por
  TRIBUTO** (COFINS · CSLL · ICMS · INSS/CPP · IRPJ · PIS), cada uma um
  `<select>` com a mesma lista; o ICMS estava em **Isenção/Redução** e abaixo
  aparece **"Parcela de receita com isenção" = 65.614,80** (a receita inteira do
  PA) e "Parcela de receita com redução" (R$ + %) vazia. Ou seja: isenção tem
  VALOR e a parcela é campo próprio — casa com o payload
  `ReceitaAtividade = {valor, qualificacoesTributarias[]}`.
  📄 **EXTRATO REAL DA POLO CULTURAL 06/2026 recebido (12/08) — e ele DESMENTE
  o que esta linha supunha**. Eu tinha escrito "campos separados POR TRIBUTO";
  o extrato mostra **UMA linha só, sem valor, listando os tributos**:
  `Parcela 1: R$ 22.169,56` / `Imunidade tributária de: ICMS, IPI.` — enquanto
  a isenção da Jaguarexport sai **com valor e um tributo por linha**
  (`Isenção de ICMS: R$ 63.878,60`). Isso não é detalhe de impressão: **isenção
  é um VALOR da parcela, imunidade é um ESTADO da parcela** (a receita inteira é
  imune, não existe "parte imune"), e por isso a imunidade cabe numa lista de
  tributos sem valor ao lado. Alvo do teste, conferido: receita 22.169,56 ·
  atividade "Venda de mercadorias industrializadas pelo contribuinte, exceto
  para o exterior — sem ST/monofásica/antecipação" · IRPJ 97,53 · CSLL 62,06 ·
  COFINS 204,10 · PIS 44,15 · CPP 664,96 · **ICMS 0,00 · IPI 0,00** · total
  1.072,80 (DAS 07202618912351835, venc. 20/07/2026, PAGO). Livro é imune por
  CF art. 150, VI, "d" — daí ICMS **e** IPI juntos, o que faz desta a única
  fonte que também entrega o `codigoTributo` do IPI.
  CONTINUA FALTANDO só o id numérico (imunidade, isenção e o código do IPI) —
  o extrato é a saída HUMANA. Mas 06/2026 foi **ACEITA e paga**, então é
  exatamente a competência em que o 🔎 Atividades declaradas responde.
- **R-2055: UM PRODUTOR POR EVENTO — RESOLVIDO POR ELIMINAÇÃO, sem o XSD**
  (12/08, EDUARDO GUERRA 07/2026). O v3.4.100 parou de pintar ✓ verde em "Lote
  processado com sucesso – Possui eventos com ocorrências de erro" e a recusa
  real apareceu; daí três sondas em produção restrita fecharam a questão:
  **1 produtor → MS1009** (regra de CADASTRO ⇒ o XSD passou) · **2 produtores
  empilhados em 1 `ideEstabAdquir` → MS0030 em `ideProdutor`** · **2 produtores
  em 2 `ideEstabAdquir` → MS0030 em `ideEstabAdquir`**. Logo `infoAquisProd`
  aceita UM `ideEstabAdquir`, que aceita UM `ideProdutor`: **vários produtores =
  vários EVENTOS no mesmo lote** (`gerarEventosR2055`, cada um com seu `seq` —
  id repetido é recusa do lote inteiro). Corrobora o R-4010 do mesmo repo ("um
  beneficiário por evento — ideBenef maxOccurs=1"). ✅ **PROVADO em 12/08: 2
  produtores → 2× MS1009**, ou seja o XSD aceitou. Empilhar produtor no mesmo
  evento passou a ser RECUSADO pelo gerador, e o teste que exigia "um
  ideProdutor por produtor" foi trocado — ele descrevia o leiaute REPROVADO.
  ⚠️ **MS1009 em produção restrita é ESPERADO e não é defeito**: restrita é
  ambiente próprio e o R-1000 do contribuinte vive na PRODUÇÃO (conferido no
  `evtInfoContri` real: `iniValid` 2019-01, tpAmb 1). A sonda só responde sobre
  ESTRUTURA — quem responde sobre cadastro é a produção.
  LIÇÃO QUE VALE PRA TODO RETORNO DE ÓRGÃO: **a Receita diz ONDE, e o app
  jogava fora** — o extrator procurava `localizacaoErroAviso` e a tag do retorno
  é **`localErroAviso`** (traz campo E XPath); o tipo é `tpOcorr`. Enquanto o
  nome não for conhecido, o **retorno CRU vai junto da ocorrência** (bloco
  recolhido, sem o `<Signature>`): print com a resposta do órgão vale mais que
  ocorrência que o app não soube nomear. A recusa também entra na AUDITORIA —
  sem isso "transmitiu" e "foi recusado" ficam iguais no log.
- **"IOB" DITO PELO PAULO É O APP IRMÃO (a URL `plano-contas-iob`), NUNCA o
  e-Fiscal IOB SAGE** — e a confusão custou um vai-e-volta em produção no
  mesmo dia. O R-2055 tinha destravado o transmitir pelo gateway (#41 de lá);
  ao ouvir *"vamos padronizar e deixar no IOB"* a sessão trocou o Transmitir
  por "📄 Gerar XML pra importar no IOB" (#42, v3.4.98) — o que colocaria o
  e-Fiscal no circuito OPERACIONAL, todo mês, do sistema que está sendo
  APOSENTADO. Paulo cortou: *"não faz sentido retroagir e deixar um rabo solto
  no e-Fiscal onde só vai gerar confusão no colaborador"*. Revertido em
  v3.4.99 (#43): botões 🧪/🚀 Transmitir de volta pelo gateway do CFI. REGRAS:
  (1) ordem que menciona "IOB"/nome de sistema e mudaria o DESTINO de uma
  transmissão se confirma ANTES de virar produção; (2) evento com dois
  transmissores possíveis tem UM dono — o risco de dupla transmissão se
  resolve escolhendo o dono, não gerando arquivo pro outro sistema; (3) a
  decisão de 05/08 (e-Fiscal = CONSULTA do histórico, operação migra) vale
  também pro Reinf.
