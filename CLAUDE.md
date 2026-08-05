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
  `issForaDoDas` no mapper e aviso na confirmação. FALTA SÓ O NÚMERO da
  atividade na tabela do SERPRO — `ID_ATIVIDADE_ISS_FIXO_CONTABIL` (null hoje,
  em pgdasMapper). Enquanto null, SUP viaja como 15/12/18 (valor certo,
  natureza a corrigir). A doc do SERPRO e o manual da Receita são BLOQUEADOS
  pela política de rede do ambiente — então o número sai da FONTE QUE NÃO
  MENTE: botão **🔎 Atividades declaradas** na tela do Simples (rota
  `/das/atividades-declaradas`, CONSULTIMADECREC14, consulta pura) lê os ids de
  uma declaração já aceita da própria empresa e destaca o que o app ainda não
  monta. Mesmo princípio do mês-modelo do MIT: NUNCA chutar código de tributo.
  Extrator puro `pgdas-atividades-declaradas.js` (varredura profunda — o shape
  do SERPRO varia; 9 testes). **Enquanto o código não entra, a emissão do DAS é
  RECUSADA** pra receita marcada SUP (`bloqueiosDoPayload` + `_bloqueios` no
  payload, revalidado no `emitirDasRegular` do backend): Paulo viu o extrato
  saindo como "com retenção/substituição tributária de ISS" e cortou —
  "leva errado pro SIMPLES". Entrega ao PGDAS-D não se desfaz: sem o código, a
  competência vai pelo e-CAC. Ids já mapeados: 1/2/3 comércio, 4/5/6 indústria,
  11/12 Anexo V, 14/15 Anexo III, 17/18 Anexo IV, 29/30/31 exterior (V/III/IV).
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
- CNPJ escritório: 44.388.152/0001-89. Projeto GCP `consultorfiscalapp`
  (us-west1). Scheduler: `scripts/setup-cloud-schedulers.sh` (idempotente;
  o Paulo roda no Mac dele — clone em `~/consultor-fiscal-inteligente`).
  Frontend+backend = MESMO serviço Cloud Run: deploy mata captura em
  andamento — checar o banner do Diagnóstico antes de mesclar (deploy
  20:19 de 24/07 matou o manifest-cron das 20:10 → alerta de FALHA).

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
- **Adoção do cofre (saída mod 55) = 0/388**: lista priorizada na Cobertura
  de Saída (🎯 prioritárias = emitem mod 55 e pararam de ser capturadas);
  equipe deve enviar as "📋 Instruções" por ordem de volume.
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

- **Substituição do SAGE e-Fiscal: plano FECHADO, execução ADIADA** (Paulo,
  31/07: "algumas coisas não faremos de imediato como a migração do
  postgresql"). NÃO iniciar a migração do PG12 sem o Paulo mandar. O plano de
  4 fases fica registrado pra quando retomar: F0 inventário (quem entrega
  EFD); F1 gerador EFD ICMS/IPI + conferência-espelho (2 pilotos Lucro que o
  Paulo escolher); F2 extração do PG12 — **ARQUIVOS RECEBIDOS E VALIDADOS
  05/08** (`docs/pg12/validacao-f2.md` + DDL guardado em
  `docs/pg12/efiscal_ddl.zip`): DDL dos 4 schemas OK (618 tabelas por
  empresa = pad_modelo; gen 273; tabelas de movimento mapeadas —
  nfentrad/nfsaida/nf_iss/lcereg54/nfdipam); \dt gen.* OK; SÓ FALTA a
  volumetria do e0299 refeita (a 1ª veio com 80/618 tabelas e contagem
  zero — pg_stat sem ANALYZE; o SQL certo por pg_total_relation_size está
  no doc). Cod.Cliente carregado em massa 05/08 (390 ativas, via Listagem
  de Empresas HTML) = amarração e{código}↔CNPJ pronta; F3 ondas por
  cliente.
  Arquitetura já mapeada (schemas_efiscal.csv): PG12 (EOL nov/2024), 1 schema
  por empresa (e0001–e9996, 1.735 schemas), `gen` compartilhado 625MB, total
  real 84GB (cuidado: o CSV tem linha TOTAL — não somar duas vezes), 29
  empresas >500MB = 55% do volume. REGRAS ao retomar: PG12 NUNCA exposto à
  internet; dado fiscal de cliente NUNCA transita pelo chat (só
  schema/estrutura — extração vai pra bucket GCS privado do projeto
  consultorfiscalapp); acesso por usuário read-only (`cfi_leitura`).
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
