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
- **CCM-SP só existe pra SP capital** (#311): campo aceita ficar VAZIO —
  limpar e salvar APAGA (o sanitize não pode virar `undefined`, senão a
  chave some do JSON e o backend nunca apaga). CCM só-zeros (contorno da
  equipe pra campo que parecia obrigatório) = vazio. Empresa de outro
  município usa `inscricaoMunicipal` genérica; o modal avisa quando
  codMunIBGE != 3550308 e o CCM tem valor.
- **Gate de auditoria do deploy**: bloqueia em high/critical de QUALQUER
  dep (dev incluso). 2 falhas em 30 runs, ambas por advisory novo
  publicado entre deploys (postcss 24/07 #295; brace-expansion 25/07
  #301). LIÇÃO: pino de segurança em `overrides` do package.json trava o
  audit fix quando o pinado ganha advisory — revisitar os pinos ao
  destravar (hoje: brace-expansion 5.0.8, protobufjs 7.6.5).
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
  legalizacao_contratos_analises (arquivo NÃO é armazenado, só o resumo). Cron próprio `legalizacao-cron-diario` 7h30 BRT via
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
  ficou (padrão de URL fixa pros hubs internos).

## Fila de features acordadas (com requisitos)

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
