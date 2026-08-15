# CFI — Consultor Fiscal Inteligente (SP Assessoria Contábil)

Memória de trabalho para sessões do Claude. Atualize ao assumir compromissos
com o Paulo (admin/dono) — é daqui que a próxima sessão retoma.

## Regras permanentes de operação

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
  mesma razão. PENDENTE: a marcação de ISENÇÃO por tributo (id 4) ainda não tem
  campo na tela — o caso Jaguarexport segue esperando isso, não o número.
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
