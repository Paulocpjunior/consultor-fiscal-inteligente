# CFI — Consultor Fiscal Inteligente (SP Assessoria Contábil)

Memória de trabalho para sessões do Claude. Atualize ao assumir compromissos
com o Paulo (admin/dono) — é daqui que a próxima sessão retoma.

## Regras permanentes de operação

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
  decide o indicador. Produtor PJ vira contagem `dePessoaJuridica` (é R-2050).
  Os nomes dos campos são os do CÁLCULO (inss/gilrat/senar), NUNCA os do
  leiaute: nome que finge ser do leiaute faz o outro lado escrever no campo
  errado achando que conferiu (lição do `csllOuTotal`).
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
  **FALTA**: backfill dos XMLs de jun/jul já capturados (o doc guarda xmlHash,
  não o XML cru ⇒ re-capturar os poucos clientes de IPI) e reproduzir um mês
  INTEIRO a partir dos XMLs-fonte. RISCO ABERTO no de-para: o e-Fiscal inclui
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
