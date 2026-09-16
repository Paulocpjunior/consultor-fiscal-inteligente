// ============================================================================
// sefaz-backend/dere.js  (PURO — sem I/O, testável)
// ----------------------------------------------------------------------------
// 🏦 DeRE — Declaração de Regimes Específicos (IBS/CBS/IS).
//
// O que este módulo RESPONDE, para a carteira e para um cliente:
//   · QUEM está na DeRE (pelo dono `dere-regimes.js`);
//   · QUANDO ela vence numa competência (pelo catálogo, que é o dono do prazo);
//   · QUAIS eventos a competência exige, e em que fase do cronograma estamos;
//   · a FILA da carteira: obrigadas (por CNPJ RAIZ — a declaração é uma por
//     raiz), candidatas a confirmar (CNAE), regimes fora do leiaute, e o que
//     ficou de fora — DITO, nunca sumido;
//   · as RÉGUAS DE FORMA do Anexo II que o app já pode conferir sem gerar nada:
//     o Id do evento (42 caracteres), o número do recibo (31) e o protocolo do
//     lote (até 28) — quem transmitir por fora e colar o recibo aqui tem como
//     saber se colou o que a Receita devolveu.
//
// ═══ FONTES (02/09, à tarde): os LEIAUTES v1.1.0 e o MANUAL DO DESENVOLVEDOR
// v1.0.2 foram entregues pelo Paulo em PDF e estão em `docs/dere/` (texto
// grep-ável) e `public/docs/dere/` (PDF, servido pelo app). Cada afirmação
// abaixo cita a fonte. O que continua por resumo de terceiros é o PRAZO (Ato
// Conjunto RFB/CGIBS 4/2026 + esclarecimento de 26/08) — ver `FONTES_DERE`.
//
// ═══ O QUE ELE NÃO FAZ, e por quê (decisão desta rodada) ═══════════════════
//   · **não gera nem transmite evento**. Agora o leiaute está lido e os XSD
//     chegaram (02/09, à noite — "Arquivos XSD (Nota Orientativa 2026)"),
//     mas o pacote é PARCIAL: cobre lote, D-1001, D-1011, D-1101, D-1106 e os
//     retornos D-9001/9101/9106 — **D-1199 (fechamento), D-2101, D-9121 e
//     D-9199 NÃO vieram** — e em 16/09 VIERAM, no pacote 1.2.0 (`XSD_DERE` cobre os 28).
//     Montar XML de um evento sem o XSD dele é o `1405` num arquivo que a
//     Receita processa. E o INSUMO dos eventos periódicos é CONTÁBIL (PGCC,
//     balancete) — mora no Consultor Contábil.
//     Além do código há pré-requisito ADMINISTRATIVO do dono: piloto da Reforma,
//     procuração no e-CAC e credencial no portal da produção restrita
//     (`INTEGRACAO_DERE.preRequisitos`). Onde a geração nasce é decisão dele;
//     enquanto ela não existir, a tela diz que a entrega é por fora.
// ============================================================================

import { OBRIGACAO_DERE, calcularVencimento, compararCompetencias, competenciaIsoDe } from './catalogo-obrigacoes.js';
import { decidirDereNoCadastro, FONTES_DERE, REGIMES_ESPECIFICOS_IBS_CBS, raizDoCnpj } from './dere-regimes.js';

/** Primeira competência com escrituração mensal (Ato Conjunto RFB/CGIBS 4/2026). */
export const VIGENCIA_DERE = OBRIGACAO_DERE.vigenciaDesde;

/**
 * O CRONOGRAMA — as três datas do Ato Conjunto 4/2026, na leitura oficial de
 * 26/08: 01/10/2026 é o INÍCIO da recepção dos eventos de tabela (não é prazo
 * final); 15/11/2026 é o prazo da 1ª escrituração mensal (competência 10/2026),
 * e os eventos de tabela precisam estar processados ANTES dela.
 *
 * ⚠️ O Ato Conjunto em si NÃO foi lido (gov.br bloqueado); o leiaute 1.1.0
 * não separa eventos por fase — então a terceira data fica como a divulgação
 * a descreve, sem o app afirmar QUAIS eventos ela alcança.
 */
export const CRONOGRAMA_DERE = Object.freeze([
    {
        dataIso: '2026-10-01',
        marco: 'Ambiente da DeRE passa a receber os EVENTOS DE TABELA (D-1001 e D-1011).',
        detalhe: 'É início de recepção, não prazo final — mas eles precisam estar processados com sucesso antes da '
            + '1ª escrituração mensal (15/11/2026).',
        fonte: FONTES_DERE.ESCLARECIMENTO_26_08,
    },
    {
        dataIso: '2026-11-15',
        marco: 'Prazo da 1ª escrituração mensal — competência 10/2026 (eventos periódicos).',
        detalhe: 'Dia 15 do mês seguinte à competência; o prazo NÃO se prorroga quando cai em dia não útil '
            + '(15/11/2026 é domingo — a política da casa antecipa para 13/11).',
        fonte: FONTES_DERE.ATO_CONJUNTO_4,
    },
    {
        dataIso: '2027-01-01',
        marco: 'Obrigatoriedade alcança os demais eventos da DeRE.',
        detalhe: 'Cronograma do Ato Conjunto 4/2026 conforme divulgação oficial; o Ato não foi lido e o leiaute 1.1.0 '
            + 'não separa eventos por fase — o app não afirma QUAIS eventos entram aqui.',
        fonte: FONTES_DERE.ATO_CONJUNTO_4,
    },
]);

/**
 * OS EVENTOS — Leiautes da DeRE v1.1.0 (22/06/2026), sumário e seções 1-3,
 * mais os que a **v1.2.0 (05/09/2026)** incluiu — lidos do Histórico de
 * Versões 1.2.0, seção 3.1 (docs/dere/05-historico-de-versoes-v1.2.0.txt) e
 * conferidos contra os 28 XSD do pacote 1.2.0.
 *
 * `grupo`: 'tabela' (enviado uma vez, vale até ser alterado) · 'mensal'
 * (por competência) · 'transacional' (por adquirente/operação — leiaute
 * PRELIMINAR na 1.2.0) · 'retorno' (a Receita devolve; ninguém envia).
 * `mensalDesde`: competência a partir da qual o evento mensal é exigido.
 * `condicional`: o evento só é exigido de quem tem no PGCC conta com um dos
 * `codTribs` — Anexo II 1.2.0, "RN - Tabela de codtribs obrigatórios para
 * eventos auxiliares" (e EVENTOS_OBRIGATORIOS_PERIODO, MS1146-MS1148).
 * `preliminar`: a própria Receita chama o leiaute de PRELIMINAR (transacionais)
 * — o app lista, não cobra.
 *
 * `xsd`: o arquivo do schema em `docs/dere/xsd/` (servido em `/docs/dere/xsd/`).
 * Com o pacote 1.2.0 TODO evento tem XSD (`xsdFaltando()` devolve []).
 *
 * 🚨 **D-1121 — a história inteira, porque ela derruba uma afirmação deste
 * módulo**: em 02/09 este arquivo dizia "D-1121 NÃO EXISTE", lendo o leiaute
 * 1.1.0 — e estava CERTO para a 1.1.0 (o resumo de terceiros que o listava
 * afirmava um evento que a versão vigente não tinha). A **1.2.0 o INCLUIU**
 * ("Relação de Deduções Utilizadas na Apuração", XSD evtRelDeducoes), com o
 * retorno D-9112. O que fica: evento entra aqui quando a FONTE o publica,
 * nunca antes — e a fonte publicou em 05/09.
 */
export const EVENTOS_DERE = Object.freeze([
    { codigo: 'D-1001', nome: 'Informações do Contribuinte', grupo: 'tabela', desde: '2026-10-01', xsd: 'evtInfoContrib-v1_0_1.xsd',
        nota: 'Regime específico PRINCIPAL ({regTribPrinc} = 1 serviços financeiros · 2 planos de saúde · 3 concursos '
            + 'de prognósticos · 9 outros) e até três secundários; atividades das Tabelas 21/31/41 do Anexo I. '
            + 'É aqui que a empresa declara em qual regime está. Por CNPJ RAIZ ({nrInsc} tem 8 posições). '
            + 'O XSD veio IDÊNTICO no pacote 1.2.0 — o evento não mudou.' },
    { codigo: 'D-1011', nome: 'Plano Geral de Contas Comentado (PGCC)', grupo: 'tabela', desde: '2026-10-01', xsd: 'evtPGCC-v1_0_3.xsd',
        nota: 'Obrigatório para todo contribuinte da DeRE — plano referencial COSIF/ANS/SUSEP/SPED/PREVIC ({planoCtaRef} '
            + '1-5; o 5 PREVIC entrou na 1.2.0), contas com {codTrib} da Tabela 11, até 150.000 contas (era 50.000 na '
            + '1.1.0). Insumo CONTÁBIL: o plano de contas mora no Consultor Contábil.' },
    { codigo: 'D-1101', nome: 'Balancete Mensal', grupo: 'mensal', mensalDesde: '10/2026', xsd: 'evtBalancete-v1_0_1.xsd',
        nota: 'Saldo inicial, movimentos, saldo final e {vApur} por conta analítica (até 90.000 na 1.2.0; era 10.000). '
            + 'Insumo CONTÁBIL — não sai deste app. É o evento que o D-1199 exige (MS1146). A 1.2.0 rejeita '
            + 'competência FUTURA (REJEITAR_PERAPUR_FUTURO) e período já FECHADO (PERAPUR_FECHADO).' },
    { codigo: 'D-1106', nome: 'Identificação de Aplicações Financeiras', grupo: 'mensal', mensalDesde: '10/2026', xsd: 'evtAplicResTec-v1_0_0.xsd',
        condicional: { codTribs: ['120130001', '120230001', '120330001', '111112701'],
            texto: 'Só de quem tem no PGCC conta com codTrib 120130001/120230001/120330001 (saúde) ou 111112701 '
                + '(seguros) — Anexo II 1.2.0, RN Tabela de codtribs obrigatórios; MS1135/MS1147.' } },
    { codigo: 'D-1121', nome: 'Relação de Deduções Utilizadas na Apuração', grupo: 'mensal', mensalDesde: '10/2026', xsd: 'evtRelDeducoes-v0_0_1.xsd',
        condicional: { codTribs: ['110211611', '110324611', '110324801', '111111622', '111112612', '111112614', '111126103',
            '111270002', '111290001', '111361003', '411011105', '411012101', '411021111', '411021211', '411031211', '411031281',
            '411031411', '411032411', '411051101', '120161002', '120161006', '120161007', '120261002', '120261005', '120261006',
            '120261099', '120361002', '120361005', '120361006', '120361099', '120420001', '220420002', '230161002', '431300002'],
            texto: 'INCLUÍDO NA 1.2.0. Só de quem tem no PGCC conta com um dos 34 codTribs de dedução (Anexo II 1.2.0, RN '
                + 'Tabela de codtribs obrigatórios) E não marcou {indInexistDedu} no D-1199 — EVENTOS_OBRIGATORIOS_PERIODO, item 4.' },
        nota: 'Conta-corrente dos documentos fiscais eletrônicos (chDFe) e aquisições de imóveis que lastreiam deduções da '
            + 'base de cálculo. Modelo HÍBRIDO: antes do fechamento admite inclusão/alteração/exclusão; depois, só a '
            + 'retificação por documento ({tpOper} = 4), condicionada à REABERTURA pelo D-1198 (TPOPER_D1121_STATUS_PERIODO).' },
    { codigo: 'D-2101', nome: 'Débito em Operações com Títulos de Dívida com Oferta Pública', grupo: 'mensal', mensalDesde: '10/2026', xsd: 'evtDebOpOfPublic-v0_0_2.xsd',
        condicional: { codTribs: ['110113001', '110113002'],
            texto: 'Só de quem tem no PGCC conta com codTrib 110113001 ou 110113002 — Anexo II 1.2.0, RN Tabela de codtribs '
                + 'obrigatórios; MS1135/MS1148.' },
        nota: 'REESTRUTURADO na 1.2.0: passa a operar por saldos contábeis e movimentações agregadas ({vSaldoContIni}, '
            + '{vEntradas}, {vSaidas}, {vJurosRec}, {vJurosApropr}, {vSaldoContFin}), chave {idTitulo (ISIN, 12), cCta}, até '
            + '10.000 títulos; {vApur} = MENORENTRE({vSelic}, {vJurosApropr}) − {vPisCofins} (VALIDAR_VAPUR_D2101).' },
    { codigo: 'D-1198', nome: 'Reabertura de Período de Apuração', grupo: 'mensal', mensalDesde: '10/2026', xsd: 'evtReabertMensal-v0_0_1.xsd',
        eventual: true,
        nota: 'INCLUÍDO NA 1.2.0. Reabre competência já fechada pelo D-1199 — exige o recibo do último fechamento ativo '
            + '(EXISTE_RECIBO_FECH_ATIVO) e só entra com o período FECHADO (PERMITIR_PERAPUR_FECHADO). Só existe quando há '
            + 'o que retificar; não é exigido de ninguém por padrão.' },
    { codigo: 'D-1199', nome: 'Fechamento Mensal', grupo: 'mensal', mensalDesde: '10/2026', xsd: 'evtFechMensal-v0_0_2.xsd',
        nota: 'Fecha a competência — só admite INCLUSÃO, exige D-1101 ativo (MS1146) e os auxiliares condicionais '
            + '(MS1147/MS1148, e D-1121 salvo {indInexistDedu} — grupo novo da 1.2.0); retificar exige REABERTURA pelo '
            + 'D-1198. A 1.2.0 ainda exige que o PGCC dos mensais seja o vigente no fechamento (CONSISTIR_PGCC_EVENTOS_PERIODO, '
            + 'MS1158). É o análogo do R-2099 da Reinf.' },
    // Série transacional (D-2000/3000/4000) — leiautes PRELIMINARES da 1.2.0
    // (Histórico, 2.1.a). Operação por adquirente, com a chave da DeRE de 53
    // caracteres ({chDeRE}, `montarChaveDere`). O app LISTA; não cobra.
    { codigo: 'D-2201', nome: 'Serviços Remunerados por Preço — Identificação de Adquirentes', grupo: 'transacional', preliminar: true, xsd: 'evtServRemPreco-v0_0_1.xsd' },
    { codigo: 'D-2202', nome: 'Tarifas do Regime Geral — Identificação de Adquirentes', grupo: 'transacional', preliminar: true, xsd: 'evtServRemTarifa-v0_0_1.xsd' },
    { codigo: 'D-2211', nome: 'Operações de Crédito e Valores Mobiliários (TVM) — Identificação de Adquirentes', grupo: 'transacional', preliminar: true, xsd: 'evtOperFinanc-v0_0_1.xsd' },
    { codigo: 'D-2221', nome: 'Antecipação de Recebíveis (Securitização, Faturização e Arranjos) — Identificação de Adquirentes', grupo: 'transacional', preliminar: true, xsd: 'evtAntecReceb-v0_0_1.xsd' },
    { codigo: 'D-2231', nome: 'Arrendamento Mercantil — Identificação de Adquirentes', grupo: 'transacional', preliminar: true, xsd: 'evtArrendMerc-v0_0_1.xsd' },
    { codigo: 'D-2241', nome: 'Arranjos de Pagamento — Identificação de Credenciados ou Destinatários dos Serviços', grupo: 'transacional', preliminar: true, xsd: 'evtArranjoCredDest-v0_0_1.xsd' },
    { codigo: 'D-2242', nome: 'Arranjos de Pagamento — Operações entre Participantes', grupo: 'transacional', preliminar: true, xsd: 'evtArranjoPartic-v0_0_1.xsd' },
    { codigo: 'D-2251', nome: 'Seguros, Previdência Complementar e Capitalização — Identificação de Adquirentes', grupo: 'transacional', preliminar: true, xsd: 'evtSegPrevCap-v0_0_1.xsd' },
    { codigo: 'D-3201', nome: 'Planos de Assistência à Saúde — Identificação de Adquirentes e Beneficiários', grupo: 'transacional', preliminar: true, xsd: 'evtPlAssistSaude-v0_0_1.xsd' },
    { codigo: 'D-4201', nome: 'Concursos de Prognósticos — Discriminação de Apostas, Prêmios e Apostadores', grupo: 'transacional', preliminar: true, xsd: 'evtIdApostPrem-v0_0_1.xsd' },
    // Retornos
    { codigo: 'D-9001', nome: 'Retorno — Eventos de Tabela', grupo: 'retorno', xsd: 'evtRetornoTabela-v1_0_1.xsd' },
    { codigo: 'D-9101', nome: 'Retorno Totalizador — Balancete Mensal', grupo: 'retorno', xsd: 'evtRetornoBalan-v1_0_0.xsd',
        nota: 'Na 1.2.0 devolve {infoAdic.nrReciboPGCC} — o recibo do PGCC usado no processamento.' },
    { codigo: 'D-9106', nome: 'Retorno Totalizador — Identificação de Aplicações Financeiras', grupo: 'retorno', xsd: 'evtRetornoAplicFin-v1_0_0.xsd' },
    { codigo: 'D-9112', nome: 'Retorno — Relação de Deduções Utilizadas na Apuração', grupo: 'retorno', xsd: 'evtRetornoRDed-v0_0_1.xsd',
        nota: 'INCLUÍDO NA 1.2.0 — o recibo do D-1121.' },
    { codigo: 'D-9121', nome: 'Retorno Totalizador — Débito em Operações com Títulos de Dívida com Oferta Pública', grupo: 'retorno', xsd: 'evtRetornoTitPub-v0_0_2.xsd' },
    { codigo: 'D-9198', nome: 'Retorno — Reabertura de Período de Apuração', grupo: 'retorno', xsd: 'evtRetornoReabert-v0_0_1.xsd',
        nota: 'INCLUÍDO NA 1.2.0 — confirma a competência como "Reaberto".' },
    { codigo: 'D-9199', nome: 'Retorno Totalizador — Fechamento Mensal', grupo: 'retorno', xsd: 'evtRetornoMensal-v0_0_2.xsd',
        nota: 'A memória de cálculo do débito de IBS, CBS e IS do mês ({totalTributosGeral}) — é contra ele que se '
            + 'confere o que foi declarado. Na 1.2.0 traz {infoAdic} com os recibos de TODOS os eventos do mês e '
            + '{gCoeficientes} (rateio de captação, atos cooperados, exportação); memória a 8 casas (NBR 5891).' },
    { codigo: 'D-9209', nome: 'Retorno — Eventos Transacionais', grupo: 'retorno', xsd: 'evtRetornoTransac-v0_0_1.xsd',
        nota: 'INCLUÍDO NA 1.2.0 — recibo padronizado da série transacional (e {detRateioPremio} dos planos de saúde).' },
]);

/**
 * A INTEGRAÇÃO — o que o Manual de Orientação ao Desenvolvedor v1.0.2 diz
 * sobre COMO se fala com a DeRE. É dado de REFERÊNCIA (para a tela e para o
 * dia em que alguém decidir a casa da geração), não código que transmite.
 */
export const INTEGRACAO_DERE = Object.freeze({
    fonte: FONTES_DERE.MANUAL_DEV_1_0_2,
    autenticacao: {
        padrao: 'OAuth 2.0 client credentials no Receita Integra — Bearer Token em toda requisição',
        tokenUrl: 'https://api.receitafederal.gov.br/token',
        validadeMin: 60,
    },
    ambiente: 'Produção RESTRITA (o Manual 1.0.2 só documenta este ambiente)',
    urlBase: 'https://api.receitafederal.gov.br/prr-dere',
    endpoints: Object.freeze([
        { metodo: 'POST', caminho: '/v1/recepcao/lotes', oQue: 'recepção do lote de eventos (XML assinado) — devolve PROTOCOLO' },
        { metodo: 'GET', caminho: '/v1/consulta/lotes/{protocolo}', oQue: 'situação do lote e o RECIBO de cada evento processado' },
        { metodo: 'DELETE', caminho: '/v1/recepcao/limpezaDadosContribuinte/{cnpj8}', oQue: 'apaga os dados do contribuinte na produção restrita (só lá)' },
    ]),
    assinatura: {
        padrao: 'XMLDSig Enveloped, RSA-SHA256 (digest SHA-256), canonicalização C14N, cadeia EndCertOnly',
        certificado: 'A1 ou A3 ICP-Brasil — e-CNPJ/e-PJ do declarante, e-CPF/e-PF do responsável ou de procurador, '
            + 'e-Aplicação; só o certificado final vai no <X509Data>',
    },
    namespaces: 'Um por evento e versão — ex.: http://www.dere.gov.br/schemas/evtInfoContrib/v1_0_1; o lote é '
        + 'envioLoteDere/v1_0_1. Namespace de versão antiga é RECUSADO (MS0009) — por isso o repo serve só a vigente.',
    preRequisitos: Object.freeze([
        'Participar do grupo PILOTO da Reforma Tributária (cadastramento pelo Fale Conosco).',
        'Procuração eletrônica no e-CAC para o CPF de quem gera a credencial: "Piloto da CBS na Reforma Tributária '
            + 'sobre o Consumo" e, se não assinar com o e-CNPJ da própria empresa, "DeRE - Declaração de Regimes Específicos".',
        'Gerar client_id/client_secret em https://piloto-cbs.tributos.gov.br ("Gerar Credencial de Acesso para API").',
    ]),
    // A diferença que a tela precisa dizer, senão "transmitiu" vira "entregou":
    protocoloNaoEhRecibo: 'O POST devolve PROTOCOLO (lote recebido). O processamento é assíncrono: o RECIBO de cada '
        + 'evento só existe depois, na consulta do lote — e é o recibo que prova a entrega.',
});

/** Os documentos oficiais servidos pelo app (PDF) e o texto grep-ável no repo. */
export const DOCUMENTOS_DERE = Object.freeze([
    { titulo: 'Histórico de Versões v1.2.0 (o que mudou da 1.1.0 para a 1.2.0)', versao: '1.2.0', data: '05/09/2026', pdf: '/docs/dere/05-historico-de-versoes-v1.2.0.pdf', texto: 'docs/dere/05-historico-de-versoes-v1.2.0.txt' },
    { titulo: 'Anexo II — Regras de Validação v1.2.0 (inclui as Mensagens de Erro)', versao: '1.2.0', data: '05/09/2026', pdf: '/docs/dere/04-anexo-ii-regras-de-validacao-v1.2.0.pdf', texto: 'docs/dere/04-anexo-ii-regras-de-validacao-v1.2.0.txt' },
    { titulo: 'Leiautes da DeRE — Eventos v1.1.0 (campo a campo; a 1.2.0 deste documento não veio)', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/02-leiautes-eventos-v1.1.0.pdf', texto: 'docs/dere/02-leiautes-eventos-v1.1.0.txt' },
    { titulo: 'Anexo I — Tabelas v1.1.0 (a 1.2.0 deste documento não veio)', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/03-anexo-i-tabelas-v1.1.0.pdf', texto: 'docs/dere/03-anexo-i-tabelas-v1.1.0.txt' },
    { titulo: 'Anexo II — Regras de Validação v1.1.0 (superado pela 1.2.0; fica pelo histórico)', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/04-anexo-ii-regras-de-validacao-v1.1.0.pdf', texto: 'docs/dere/04-anexo-ii-regras-de-validacao-v1.1.0.txt' },
    { titulo: 'Histórico de Versões v1.1.0', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/05-historico-de-versoes-v1.1.0.pdf', texto: 'docs/dere/05-historico-de-versoes-v1.1.0.txt' },
    { titulo: 'Manual de Orientação ao Desenvolvedor v1.0.2', versao: '1.0.2', data: '18/08/2026', pdf: '/docs/dere/07-manual-do-desenvolvedor-v1.0.2.pdf', texto: 'docs/dere/07-manual-do-desenvolvedor-v1.0.2.txt' },
]);

/**
 * Os XSD — pacote "06 - Arquivos XSD v1.2.0" (Paulo, 16/09), que SUBSTITUI o
 * pacote parcial "Nota Orientativa 2026" de 02/09. Texto em `docs/dere/xsd/`,
 * servido em `/docs/dere/xsd/`. `evento` liga o schema ao código do leiaute
 * (pelo elemento-raiz `evt*`, pelo namespace e pela documentação do próprio
 * arquivo); os dois de lote não têm evento.
 *
 * O que MUDOU entre os pacotes, medido por diff: evtBalancete 1_0_0→1_0_1 e
 * evtPGCC 1_0_2→1_0_3 mudaram SÓ o namespace e o `maxOccurs` de `infoConta`
 * (10.000→90.000 e 50.000→150.000); os outros sete vieram byte a byte iguais
 * — inclusive o evtInfoContrib do D-1001. Os 19 restantes são novos.
 * As versões antigas SAÍRAM do repo: namespace de versão antiga é recusado
 * (MS0009), e servir a versão velha ao lado da nova é convite à segunda cópia.
 *
 * O que o XSD já CONFIRMOU contra o módulo: `{nrInsc}` é `[0-9A-Z]{8}` (raiz,
 * alfanumérica); o `id` do evento casa `DeRE[0-9]{4}[1-2][A-Z0-9]{14}[0-9]{19}`
 * (o mesmo 42 = 4+4+1+14+8+6+5 de `montarIdEventoDere`); `{tpAtividade}` é
 * `[0-9]{2}[A-Z]` (a máscara NNC de `ATIVIDADES_DERE`); o recibo tem no máximo
 * 31 e o protocolo 28 caracteres (`lerRecibo`/`lerProtocolo`).
 */
export const XSD_DERE = Object.freeze([
    { arquivo: 'envioLoteDere-v1_0_1.xsd', elemento: 'loteEventos', evento: null, versao: '1.0.1',
        namespace: 'http://www.dere.gov.br/schemas/envioLoteDere/v1_0_1', oQue: 'Envelope do lote (ideContrib.nrInsc raiz + eventos assinados)' },
    { arquivo: 'retornoLoteDere-v1_0_1.xsd', elemento: 'retornoLoteEventos', evento: null, versao: '1.0.1',
        namespace: 'http://www.dere.gov.br/schemas/retornoLoteDere/v1_0_1', oQue: 'Retorno do lote (situação, protocolo ≤ 28)' },
    { arquivo: 'evtInfoContrib-v1_0_1.xsd', elemento: 'evtInfoContrib', evento: 'D-1001', versao: '1.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtInfoContrib/v1_0_1', oQue: 'Informações do Contribuinte (regTribPrinc 1/2/3/9, tpAtividade NNC, indNatTrib) — idêntico ao de 02/09' },
    { arquivo: 'evtPGCC-v1_0_3.xsd', elemento: 'evtPGCC', evento: 'D-1011', versao: '1.0.3',
        namespace: 'http://www.dere.gov.br/schemas/evtPGCC/v1_0_3', oQue: 'Plano Geral de Contas Comentado (planoCtaRef 1-5, codTrib, até 150.000 contas)' },
    { arquivo: 'evtBalancete-v1_0_1.xsd', elemento: 'evtBalancete', evento: 'D-1101', versao: '1.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtBalancete/v1_0_1', oQue: 'Balancete Mensal (até 90.000 contas)' },
    { arquivo: 'evtAplicResTec-v1_0_0.xsd', elemento: 'evtAplicResTec', evento: 'D-1106', versao: '1.0.0',
        namespace: 'http://www.dere.gov.br/schemas/evtAplicResTec/v1_0_0', oQue: 'Identificação de Aplicações Financeiras' },
    { arquivo: 'evtRelDeducoes-v0_0_1.xsd', elemento: 'evtRelDeducoes', evento: 'D-1121', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtRelDeducoes/v0_0_1', oQue: 'Relação de Deduções Utilizadas na Apuração (infoDFe/chDFe, infoImovel, tpOper 1-4)' },
    { arquivo: 'evtDebOpOfPublic-v0_0_2.xsd', elemento: 'evtDebOpOfPublic', evento: 'D-2101', versao: '0.0.2',
        namespace: 'http://www.dere.gov.br/schemas/evtDebOpOfPublic/v0_0_2', oQue: 'Débito em Operações com Títulos de Dívida com Oferta Pública (reestruturado: saldos + ISIN)' },
    { arquivo: 'evtReabertMensal-v0_0_1.xsd', elemento: 'evtReabertMensal', evento: 'D-1198', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtReabertMensal/v0_0_1', oQue: 'Reabertura de Período de Apuração (nrReciboReab do D-1199)' },
    { arquivo: 'evtFechMensal-v0_0_2.xsd', elemento: 'evtFechMensal', evento: 'D-1199', versao: '0.0.2',
        namespace: 'http://www.dere.gov.br/schemas/evtFechMensal/v0_0_2', oQue: 'Fechamento Mensal (infoParamFech/indInexistDedu, usarBCNAcum, metodoAproveit, detBCNeg)' },
    { arquivo: 'evtServRemPreco-v0_0_1.xsd', elemento: 'evtServRemPreco', evento: 'D-2201', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtServRemPreco/v0_0_1', oQue: 'Transacional PRELIMINAR — serviços remunerados por preço, por adquirente (chDeRE)' },
    { arquivo: 'evtServRemTarifa-v0_0_1.xsd', elemento: 'evtServRemTarifa', evento: 'D-2202', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtServRemTarifa/v0_0_1', oQue: 'Transacional PRELIMINAR — tarifas do regime geral' },
    { arquivo: 'evtOperFinanc-v0_0_1.xsd', elemento: 'evtOperFinanc', evento: 'D-2211', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtOperFinanc/v0_0_1', oQue: 'Transacional PRELIMINAR — operações de crédito e TVM' },
    { arquivo: 'evtAntecReceb-v0_0_1.xsd', elemento: 'evtAntecReceb', evento: 'D-2221', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtAntecReceb/v0_0_1', oQue: 'Transacional PRELIMINAR — antecipação de recebíveis' },
    { arquivo: 'evtArrendMerc-v0_0_1.xsd', elemento: 'evtArrendMerc', evento: 'D-2231', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtArrendMerc/v0_0_1', oQue: 'Transacional PRELIMINAR — arrendamento mercantil' },
    { arquivo: 'evtArranjoCredDest-v0_0_1.xsd', elemento: 'evtArranjoCredDest', evento: 'D-2241', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtArranjoCredDest/v0_0_1', oQue: 'Transacional PRELIMINAR — arranjos de pagamento: credenciados/destinatários' },
    { arquivo: 'evtArranjoPartic-v0_0_1.xsd', elemento: 'evtArranjoPartic', evento: 'D-2242', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtArranjoPartic/v0_0_1', oQue: 'Transacional PRELIMINAR — arranjos de pagamento: entre participantes' },
    { arquivo: 'evtSegPrevCap-v0_0_1.xsd', elemento: 'evtSegPrevCap', evento: 'D-2251', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtSegPrevCap/v0_0_1', oQue: 'Transacional PRELIMINAR — seguros, previdência complementar e capitalização' },
    { arquivo: 'evtPlAssistSaude-v0_0_1.xsd', elemento: 'evtPlAssistSaude', evento: 'D-3201', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtPlAssistSaude/v0_0_1', oQue: 'Transacional PRELIMINAR — planos de assistência à saúde: adquirentes e beneficiários' },
    { arquivo: 'evtIdApostPrem-v0_0_1.xsd', elemento: 'evtIdApostPrem', evento: 'D-4201', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtIdApostPrem/v0_0_1', oQue: 'Transacional PRELIMINAR — concursos de prognósticos: apostas, prêmios e apostadores' },
    { arquivo: 'evtRetornoTabela-v1_0_1.xsd', elemento: 'evtRetornoTabela', evento: 'D-9001', versao: '1.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoTabela/v1_0_1', oQue: 'Retorno dos eventos de tabela (nrRecibo ≤ 31, protocoloLote)' },
    { arquivo: 'evtRetornoBalan-v1_0_0.xsd', elemento: 'evtRetornoBalan', evento: 'D-9101', versao: '1.0.0',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoBalan/v1_0_0', oQue: 'Retorno totalizador do balancete' },
    { arquivo: 'evtRetornoAplicFin-v1_0_0.xsd', elemento: 'evtRetornoAplicFin', evento: 'D-9106', versao: '1.0.0',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoAplicFin/v1_0_0', oQue: 'Retorno totalizador das aplicações financeiras' },
    { arquivo: 'evtRetornoRDed-v0_0_1.xsd', elemento: 'evtRetornoRDed', evento: 'D-9112', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoRDed/v0_0_1', oQue: 'Retorno da Relação de Deduções (recibo do D-1121)' },
    { arquivo: 'evtRetornoTitPub-v0_0_2.xsd', elemento: 'evtRetornoTitPub', evento: 'D-9121', versao: '0.0.2',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoTitPub/v0_0_2', oQue: 'Retorno totalizador dos títulos de dívida com oferta pública' },
    { arquivo: 'evtRetornoReabert-v0_0_1.xsd', elemento: 'evtRetornoReabert', evento: 'D-9198', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoReabert/v0_0_1', oQue: 'Retorno da reabertura de período' },
    { arquivo: 'evtRetornoMensal-v0_0_2.xsd', elemento: 'evtRetornoMensal', evento: 'D-9199', versao: '0.0.2',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoMensal/v0_0_2', oQue: 'Retorno totalizador do fechamento mensal (totalTributosGeral, infoAdic, gCoeficientes)' },
    { arquivo: 'evtRetornoTransac-v0_0_1.xsd', elemento: 'evtRetornoTransac', evento: 'D-9209', versao: '0.0.1',
        namespace: 'http://www.dere.gov.br/schemas/evtRetornoTransac/v0_0_1', oQue: 'Retorno dos eventos transacionais' },
]);

/** Os eventos do leiaute que ainda NÃO têm XSD no repo — para ninguém montar XML deles por dedução. Vazio desde o pacote 1.2.0. */
export function xsdFaltando() {
    return EVENTOS_DERE.filter((e) => !e.xsd).map((e) => e.codigo).sort();
}

/** O que NÃO está no repo — dito, para ninguém deduzir que o app leu. */
export const DOCUMENTOS_DERE_FALTANDO = Object.freeze([
    'Manual de Orientação do Usuário (MOD) v1.0.1 — quem está obrigado em linguagem de negócio, prazos, penalidades.',
    'Leiautes da DeRE — Eventos v1.2.0 (documento 02) e Anexo I — Tabelas v1.2.0 (documento 03): da 1.2.0 vieram só o '
        + 'Histórico, o Anexo II e os XSD. O campo a campo de D-1121, D-1198 e dos transacionais só se conhece pelo XSD; '
        + 'as Tabelas 11/12 novas (codTrib/codBC), 15 (países) e 24 (PREVIC) não estão aqui — o histórico as descreve, '
        + 'não as lista.',
    ...(xsdFaltando().length ? [`XSD dos eventos ${xsdFaltando().join(', ')}.`] : []),
]);

// ═══ RÉGUAS DE FORMA DO ANEXO II ══════════════════════════════════════════════

const CODIGOS_EVENTO = new Set(EVENTOS_DERE.map((e) => e.codigo.slice(2)));

function partesBrasilia(data) {
    // O Anexo II manda hora de BRASÍLIA (UTC-3). O Cloud Run é UTC: ler
    // getHours() aqui produziria um Id com a hora errada — e Id é UNICIDADE.
    const f = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const p = {};
    for (const { type, value } of f.formatToParts(data)) p[type] = value;
    return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

/**
 * O Id do evento — Anexo II, "RN - Unicidade Recepção Evento" (MS1050):
 * `DeRE` + NNNN (evento) + `1` (CNPJ) + CNPJ em 14 posições (alfanumérico em
 * MAIÚSCULAS, zeros à esquerda) + AAAAMMDD + HHMMSS (Brasília) + QQQQQ
 * (00001-99999). 42 caracteres.
 *
 * O XSD (evtBalancete/evtAplicResTec/retornos) CONFIRMA a forma:
 * `DeRE[0-9]{4}[1-2][A-Z0-9]{14}[0-9]{19}` — os 19 finais são AAAAMMDD+HHMMSS+
 * QQQQQ. O XSD admite T = 2 no padrão; a RN do Anexo II só define 1 (CNPJ), e
 * é a RN que este módulo segue — um Id com 2 não é "outro tipo", é um valor
 * que a regra de negócio não descreve.
 *
 * Isto NÃO gera evento: é a régua de FORMA, para o dia em que houver gerador
 * e para conferir um Id que chegue de fora. Entrada torta é RECUSA nomeada,
 * nunca um Id "mais ou menos".
 */
export function montarIdEventoDere({ codigoEvento, cnpj, data, sequencial = 1 } = {}) {
    const ev = String(codigoEvento || '').replace(/^D-/, '');
    if (!CODIGOS_EVENTO.has(ev)) return { ok: false, id: null, motivo: `Evento "${codigoEvento}" não existe no leiaute 1.2.0.` };
    const ni = String(cnpj || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!ni || ni.length > 14) return { ok: false, id: null, motivo: 'CNPJ do declarante ausente ou com mais de 14 posições.' };
    if (!(data instanceof Date) || Number.isNaN(data.getTime())) return { ok: false, id: null, motivo: 'Data de geração ausente ou ilegível.' };
    const seq = Number(sequencial);
    if (!Number.isInteger(seq) || seq < 1 || seq > 99999) return { ok: false, id: null, motivo: 'Sequencial fora de 00001-99999.' };
    const id = `DeRE${ev}1${ni.padStart(14, '0')}${partesBrasilia(data)}${String(seq).padStart(5, '0')}`;
    return { ok: true, id, motivo: null };
}

/** Confere um Id (o que a RN exige) e devolve as partes — sem afirmar nada além da forma. */
export function lerIdEventoDere(id) {
    const s = String(id || '').trim();
    const m = /^DeRE(\d{4})(\d)([0-9A-Z]{14})(\d{8})(\d{6})(\d{5})$/.exec(s);
    if (!m) return { ok: false, motivo: 'Id fora da forma DeRE+NNNN+T+NI(14)+AAAAMMDD+HHMMSS+QQQQQ (42 caracteres, maiúsculas).' };
    const [, evento, tipoInsc, ni, dia, hora, seq] = m;
    if (!CODIGOS_EVENTO.has(evento)) return { ok: false, motivo: `Evento ${evento} não existe no leiaute 1.2.0.` };
    if (tipoInsc !== '1') return { ok: false, motivo: `Tipo de inscrição ${tipoInsc} — o leiaute só admite 1 (CNPJ).` };
    return {
        ok: true, evento: `D-${evento}`, tipoInscricao: tipoInsc, cnpj: ni,
        geradoEm: `${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6, 8)}T${hora.slice(0, 2)}:${hora.slice(2, 4)}:${hora.slice(4, 6)}-03:00`,
        sequencial: Number(seq),
    };
}

/**
 * O número do RECIBO — Anexo II, "RN - Formação do Número do Recibo do Evento":
 * `0000-AAAAMM-<id interno, 1 a 19>` (evento · período de apuração ou ano/mês
 * da recepção · id interno). Até 31 caracteres.
 */
export function lerRecibo(recibo) {
    const s = String(recibo || '').trim();
    const m = /^(\d{4})-(\d{6})-(\d{1,19})$/.exec(s);
    if (!m) return { ok: false, motivo: 'Recibo fora da forma 0000-AAAAMM-<até 19 dígitos> (Anexo II).' };
    const [, evento, periodo, idInterno] = m;
    if (!CODIGOS_EVENTO.has(evento)) return { ok: false, motivo: `Evento ${evento} não existe no leiaute 1.2.0.` };
    const mes = Number(periodo.slice(4, 6));
    if (mes < 1 || mes > 12) return { ok: false, motivo: `Período ${periodo} tem mês inválido.` };
    return { ok: true, evento: `D-${evento}`, periodo: `${periodo.slice(4, 6)}/${periodo.slice(0, 4)}`, idInterno };
}

/**
 * O número do PROTOCOLO do lote — Anexo II, "RN - Numero do Protocolo do Lote":
 * `T.AAAAMM.N…` com T = 1 produção · 2 pré-produção, até 28 caracteres.
 * Protocolo NÃO é recibo — é só "o lote chegou".
 */
export function lerProtocolo(protocolo) {
    const s = String(protocolo || '').trim();
    const m = /^([12])\.(\d{6})\.(\d{1,19})$/.exec(s);
    if (!m) return { ok: false, motivo: 'Protocolo fora da forma T.AAAAMM.N (T = 1 produção, 2 pré-produção; Anexo II).' };
    const [, t, periodo, numero] = m;
    const mes = Number(periodo.slice(4, 6));
    if (mes < 1 || mes > 12) return { ok: false, motivo: `Período ${periodo} tem mês inválido.` };
    return {
        ok: true, ambiente: t === '1' ? 'producao' : 'pre-producao',
        recebidoEm: `${periodo.slice(4, 6)}/${periodo.slice(0, 4)}`, numero,
        ressalva: INTEGRACAO_DERE.protocoloNaoEhRecibo,
    };
}

/**
 * ARREDONDAMENTO — Anexo II 1.2.0, "RN - Critério de Arredondamento" (ABNT
 * NBR 5891): memória e cálculos intermediários a 8 casas, valores finais a 2
 * — e o empate (primeiro descartado = 5 seguido só de zeros) vai para o
 * algarismo PAR (18,245 → 18,24 · 18,235 → 18,24). `Math.round` e `toFixed`
 * arredondam o 5 sempre para cima, então NÃO servem aqui: o D-9199 devolve a
 * memória a 8 casas e quem conferir contra ele com a régua errada acusa
 * divergência de um centavo sobre número certo.
 *
 * A conta é feita sobre a REPRESENTAÇÃO DECIMAL (string), não sobre o float:
 * 18.245 em binário não é 18.245, e o empate só se reconhece olhando os dígitos.
 */
export function arredondarDere(valor, casas = 2) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return { ok: false, valor: null, motivo: 'Valor ausente ou ilegível — não se arredonda o que não é número.' };
    const c = Number(casas);
    if (!Number.isInteger(c) || c < 0 || c > 8) return { ok: false, valor: null, motivo: 'Casas fora de 0-8 (a RN só define 8 intermediárias e 2 finais).' };
    // toFixed(12) fixa a representação sem chegar no ruído do binário; a partir
    // dela a decisão é por DÍGITO, como a norma descreve.
    const neg = n < 0;
    const [intPart, fracRaw = ''] = Math.abs(n).toFixed(12).split('.');
    const frac = fracRaw.padEnd(c + 1, '0');
    const mantidos = frac.slice(0, c);
    const primeiroDescartado = Number(frac[c]);
    const resto = frac.slice(c + 1).replace(/0+$/, '');
    let digitos = (intPart + mantidos).split('').map(Number);
    let subir = false;
    if (primeiroDescartado > 5) subir = true;
    else if (primeiroDescartado === 5) {
        if (resto.length > 0) subir = true;            // 5 seguido de algo ≠ 0 → sobe
        else subir = digitos[digitos.length - 1] % 2 === 1; // empate → vai para o PAR
    }
    if (subir) {
        for (let i = digitos.length - 1; i >= 0; i--) {
            if (digitos[i] === 9) { digitos[i] = 0; if (i === 0) digitos.unshift(1); }
            else { digitos[i] += 1; break; }
        }
    }
    const txt = digitos.join('');
    const inteiro = txt.slice(0, txt.length - c) || '0';
    const decimal = c ? '.' + txt.slice(txt.length - c) : '';
    const valorFinal = Number((neg ? '-' : '') + inteiro + decimal);
    return { ok: true, valor: valorFinal === 0 ? 0 : valorFinal, motivo: null };
}

const TP_INSC_ADQ = Object.freeze({ 1: 'CNPJ', 2: 'CPF', 3: 'NIF', 4: 'PDV CNPJ', 5: 'PDV CPF', 9: 'Outro' });

function valorDvDere(ch) {
    // Anexo II: letras valem código ASCII − 48 (A=17 … Z=42); dígitos valem o dígito.
    return ch.charCodeAt(0) - 48;
}

/**
 * DV da chave da DeRE — Anexo II 1.2.0, "RN - Formação da Chave da DeRE":
 * módulo 11 sobre as 49 posições anteriores ao DV; pesos de 2 a 9 da DIREITA
 * para a esquerda, reiniciando em 2; resto 0 ou 1 → DV 0, senão 11 − resto.
 * Provado contra o EXEMPLO da própria RN (`…0001` → DV 2).
 */
export function dvChaveDere(quarentaENove) {
    const s = String(quarentaENove || '');
    if (!/^[0-9A-Z]{49}$/.test(s)) return null;
    let soma = 0; let peso = 2;
    for (let i = s.length - 1; i >= 0; i--) {
        soma += valorDvDere(s[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto <= 1 ? 0 : 11 - resto;
}

/**
 * A CHAVE DA DeRE ({chDeRE}, 53 caracteres) dos eventos TRANSACIONAIS — Anexo
 * II 1.2.0: `RRRRRRRR PP T C(20) BBBB AAAAMMD1D2 GGGG V SSS` = raiz do
 * declarante · país (Tabela 15, alfa-2) · tipo de inscrição do adquirente ·
 * inscrição em 20 posições (zeros à esquerda; NIF/Outro > 20 fica com os 20
 * ÚLTIMOS) · codBC (Tabela 12) · período de agrupamento (ano, mês, 1º dia, último
 * dia) · série 0001-9999 · DV · sequencial (000 = chave-mãe; 001-999 filhas).
 *
 * Isto é a régua de FORMA — como `montarIdEventoDere`. O app NÃO gera evento
 * transacional (leiaute PRELIMINAR, insumo operacional que não está aqui); a
 * função existe para o dia em que houver gerador e para conferir chave que
 * chegue de fora. ⚠️ A Tabela 15 (países) NÃO está no repo: `pais` é conferido
 * na FORMA (duas letras maiúsculas), nunca contra a lista.
 */
export function montarChaveDere({ raiz, pais = 'BR', tpInscAdq, nrInscAdq, codBC, ano, mes, diaIni, diaFim, serie = 1, seq = 0 } = {}) {
    const r = String(raiz || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (r.length !== 8) return { ok: false, chave: null, motivo: 'Raiz do declarante precisa ter 8 posições alfanuméricas.' };
    const p = String(pais || '').toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(p)) return { ok: false, chave: null, motivo: 'País precisa ser o alfa-2 da Tabela 15 (ex.: BR) — a tabela não está no repo, só a forma é conferida.' };
    const t = String(tpInscAdq || '');
    if (!TP_INSC_ADQ[t]) return { ok: false, chave: null, motivo: 'tpInscAdq fora de 1 CNPJ · 2 CPF · 3 NIF · 4 PDV CNPJ · 5 PDV CPF · 9 Outro.' };
    let ni = String(nrInscAdq || '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    if (!ni) return { ok: false, chave: null, motivo: 'Inscrição do adquirente ausente.' };
    if (ni.length > 20) {
        if (t !== '3' && t !== '9') return { ok: false, chave: null, motivo: 'Inscrição com mais de 20 posições — só NIF (3) e Outro (9) admitem truncar aos 20 últimos.' };
        ni = ni.slice(-20);
    }
    const bc = String(codBC || '').toUpperCase();
    if (!/^[0-9A-Z]{4}$/.test(bc)) return { ok: false, chave: null, motivo: 'codBC precisa ter 4 posições (Tabela 12).' };
    const a = Number(ano); const m = Number(mes); const d1 = Number(diaIni); const d2 = Number(diaFim);
    if (!Number.isInteger(a) || a < 2026 || a > 9999) return { ok: false, chave: null, motivo: 'Ano do agrupamento ilegível (a DeRE começa em 2026).' };
    if (!Number.isInteger(m) || m < 1 || m > 12) return { ok: false, chave: null, motivo: 'Mês do agrupamento fora de 1-12.' };
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    if (!Number.isInteger(d1) || !Number.isInteger(d2) || d1 < 1 || d2 > ultimo || d1 > d2) {
        return { ok: false, chave: null, motivo: `Dias do agrupamento fora do mês (1-${ultimo}) ou invertidos — a RN veda agrupar competências distintas.` };
    }
    const g = Number(serie);
    if (!Number.isInteger(g) || g < 1 || g > 9999) return { ok: false, chave: null, motivo: 'Série fora de 0001-9999.' };
    const q = Number(seq);
    if (!Number.isInteger(q) || q < 0 || q > 999) return { ok: false, chave: null, motivo: 'Sequencial fora de 000 (mãe) a 999 (filhas).' };
    const p49 = `${r}${p}${t}${ni.padStart(20, '0')}${bc}${String(a).padStart(4, '0')}${String(m).padStart(2, '0')}`
        + `${String(d1).padStart(2, '0')}${String(d2).padStart(2, '0')}${String(g).padStart(4, '0')}`;
    const dv = dvChaveDere(p49);
    const chave = `${p49}${dv}${String(q).padStart(3, '0')}`;
    return { ok: true, chave, motivo: null };
}

/** Lê uma {chDeRE}: forma, DV e as partes — sem afirmar nada sobre país ou codBC além da forma. */
export function lerChaveDere(chave) {
    const s = String(chave || '').trim();
    const m = /^([0-9A-Z]{8})([0-9A-Z]{2})([1-59])([0-9A-Z]{20})([0-9A-Z]{4})(\d{4})(\d{2})(\d{2})(\d{2})(\d{4})(\d)(\d{3})$/.exec(s);
    if (!m) return { ok: false, motivo: 'Chave fora da forma RRRRRRRR PP T C(20) BBBB AAAAMMD1D2 GGGG V SSS (53 caracteres, maiúsculas) — Anexo II 1.2.0.' };
    const [, raiz, pais, t, ni, codBC, ano, mes, d1, d2, serie, dv, seq] = m;
    const dvCalc = dvChaveDere(s.slice(0, 49));
    if (Number(dv) !== dvCalc) return { ok: false, motivo: `DV ${dv} não confere — pelo módulo 11 da RN o dígito seria ${dvCalc}.` };
    return {
        ok: true, raiz, pais, tpInscAdq: t, tpInscAdqRotulo: TP_INSC_ADQ[t], nrInscAdq: ni.replace(/^0+(?=.)/, ''),
        codBC, periodo: `${mes}/${ano}`, diaIni: Number(d1), diaFim: Number(d2), serie: Number(serie), dv: Number(dv),
        seq: Number(seq), chaveMae: Number(seq) === 0,
    };
}

// ═══ CRONOGRAMA, PRAZO, SITUAÇÃO, TRIAGEM ════════════════════════════════════

/** Os eventos que UMA competência exige de quem está obrigado. */
export function eventosDaCompetencia(competencia) {
    const tabela = EVENTOS_DERE.filter((e) => e.grupo === 'tabela');
    // `eventual` (D-1198) não é exigido de ninguém: só existe quando há fechamento
    // a reabrir. Listá-lo como "mensal exigido" cobraria retificação de quem não
    // retificou.
    const mensais = EVENTOS_DERE.filter((e) => e.grupo === 'mensal' && !e.eventual
        && compararCompetencias(competencia, e.mensalDesde) >= 0);
    const eventuais = EVENTOS_DERE.filter((e) => e.grupo === 'mensal' && e.eventual);
    // Leiaute PRELIMINAR (1.2.0): a Receita ainda não o fechou — o app lista e
    // não cobra. Cobrar evento preliminar é cobrar o que ainda pode mudar.
    const transacionais = EVENTOS_DERE.filter((e) => e.grupo === 'transacional');
    return { tabela, mensais, eventuais, transacionais };
}

/** Vencimento da DeRE numa competência (pelo catálogo — dono único do prazo). */
export function prazoDere(competencia) {
    if (compararCompetencias(competencia, VIGENCIA_DERE) < 0) return null;
    return calcularVencimento(competencia, OBRIGACAO_DERE);
}

function fmtData(d) {
    if (!(d instanceof Date)) return null;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

const RESSALVA_ENTREGA = 'O CFI NÃO gera nem transmite os eventos da DeRE. Os leiautes, o manual do desenvolvedor e '
    + 'parte dos XSD estão lidos e servidos no app — mas faltam os XSD do fechamento (D-1199), do D-2101 e dos '
    + 'retornos D-9121/D-9199, o insumo (PGCC, balancete) é contábil e a transmissão exige credencial do piloto '
    + 'da Reforma. A entrega é por fora (portal/API da DeRE) e se registra em Vencimentos como as demais '
    + 'obrigações entregues fora do app.';

/**
 * A SITUAÇÃO de uma empresa numa competência — a linha que a tela mostra.
 *
 * `regimeCatalogo` é o regime fiscal já resolvido ('SIMPLES' | 'LUCRO_*' |
 * 'IMUNE' | 'ISENTA' | 'INDEFINIDO'). Competência anterior à vigência devolve
 * `ainda-nao-vigente` mesmo para quem está obrigado — cobrar 09/2026 seria
 * cobrar o que não existia.
 */
export function situacaoDere(empresa, competencia, { regimeCatalogo } = {}) {
    const veredicto = decidirDereNoCadastro(empresa, { regimeCatalogo });
    const vigente = compararCompetencias(competencia, VIGENCIA_DERE) >= 0;
    const prazo = vigente ? prazoDere(competencia) : null;
    const eventos = vigente ? eventosDaCompetencia(competencia) : { tabela: [], mensais: [] };

    let situacao = veredicto.decisao;
    if (veredicto.decisao === 'obrigada' && !vigente) situacao = 'ainda-nao-vigente';

    return {
        competencia,
        competenciaIso: competenciaIsoDe(competencia),
        situacao,
        ...veredicto,
        raiz: raizDoCnpj(empresa?.cnpj),
        vigente,
        vigenciaDesde: VIGENCIA_DERE,
        prazo,
        prazoTexto: fmtData(prazo),
        eventos,
        // O que este app NÃO faz vai DITO na própria resposta — some da tela é
        // o que faz alguém achar que a declaração saiu.
        entregaPeloApp: false,
        ressalvaEntrega: RESSALVA_ENTREGA,
    };
}

/**
 * A FILA DA CARTEIRA — para o pedido à equipe ser "confirme estes N", não
 * "preencham 400". Mesmo desenho da triagem do terceiro setor (18/08).
 *
 * `empresas` vêm do cadastro central (`normalizarEmpresaCadastro`), que já
 * carrega `regimeTributario`, `cnae` e `regimeEspecificoIbsCbs`.
 *
 * As obrigadas saem também AGRUPADAS POR RAIZ: `{nrInsc}` tem 8 posições em
 * todo evento, então matriz e filiais são UMA declaração — contar "3 obrigadas"
 * quando são três estabelecimentos do mesmo banco faria alguém esperar três
 * entregas.
 */
export function triarCarteiraDere(empresas = [], competencia) {
    const obrigadas = [];
    const candidatas = [];
    const foraDoLeiaute = [];
    const naoSeAplica = [];
    let dispensadasSimples = 0;
    let semSinal = 0;

    for (const e of empresas || []) {
        const s = situacaoDere(e, competencia, { regimeCatalogo: e?.regimeTributario });
        const linha = {
            id: e?.id || null,
            cnpj: e?.cnpj || null,
            raiz: s.raiz,
            nome: e?.nome || '(sem nome)',
            regimeTributario: e?.regimeTributario || null,
            cnae: e?.cnae || null,
            regimeEspecifico: s.regimeEspecifico,
            regimeEspecificoRotulo: s.rotulo,
            codigoD1001: s.codigoD1001,
            situacao: s.situacao,
            motivo: s.motivo,
            acao: s.acao,
            sinalCnae: s.sinalCnae ? s.sinalCnae.rotulo : null,
            prazoTexto: s.prazoTexto,
        };
        switch (s.decisao) {
            case 'obrigada': obrigadas.push(linha); break;
            case 'candidata': candidatas.push(linha); break;
            case 'regime-fora-do-leiaute': foraDoLeiaute.push(linha); break;
            case 'nao-se-aplica': naoSeAplica.push(linha); break;
            case 'dispensada-simples': dispensadasSimples += 1; break;
            default: semSinal += 1;
        }
    }

    const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    obrigadas.sort(porNome);
    candidatas.sort(porNome);
    foraDoLeiaute.sort(porNome);
    naoSeAplica.sort(porNome);

    // Uma declaração por RAIZ. Raiz ilegível (CNPJ torto) fica NOMEADA à
    // parte — juntar num balde "sem raiz" apagaria a diferença entre "um
    // banco com três filiais" e "três cadastros sem CNPJ legível".
    const porRaiz = new Map();
    const semRaiz = [];
    for (const l of obrigadas) {
        if (!l.raiz) { semRaiz.push(l); continue; }
        if (!porRaiz.has(l.raiz)) porRaiz.set(l.raiz, { raiz: l.raiz, regimeEspecifico: l.regimeEspecifico, codigoD1001: l.codigoD1001, estabelecimentos: [], regimesDivergem: false });
        const g = porRaiz.get(l.raiz);
        g.estabelecimentos.push({ id: l.id, cnpj: l.cnpj, nome: l.nome });
        if (g.regimeEspecifico !== l.regimeEspecifico) g.regimesDivergem = true;
    }
    const declaracoes = [...porRaiz.values()];

    const vigente = compararCompetencias(competencia, VIGENCIA_DERE) >= 0;
    return {
        competencia,
        vigente,
        vigenciaDesde: VIGENCIA_DERE,
        prazoTexto: fmtData(prazoDere(competencia)),
        eventos: vigente ? eventosDaCompetencia(competencia) : { tabela: [], mensais: [], eventuais: [], transacionais: [] },
        cronograma: CRONOGRAMA_DERE,
        regimes: REGIMES_ESPECIFICOS_IBS_CBS,
        fontes: FONTES_DERE,
        documentos: DOCUMENTOS_DERE,
        documentosFaltando: DOCUMENTOS_DERE_FALTANDO,
        xsd: XSD_DERE,
        xsdFaltando: xsdFaltando(),
        integracao: INTEGRACAO_DERE,
        obrigadas,
        declaracoes,
        obrigadasSemRaiz: semRaiz,
        candidatas,
        foraDoLeiaute,
        naoSeAplica,
        resumo: {
            total: (empresas || []).length,
            obrigadas: obrigadas.length,
            declaracoes: declaracoes.length,
            obrigadasSemRaiz: semRaiz.length,
            candidatas: candidatas.length,
            foraDoLeiaute: foraDoLeiaute.length,
            naoSeAplica: naoSeAplica.length,
            dispensadasSimples,
            // Contado, nunca escondido: "sem sinal" é o caso comum e NÃO é
            // prova de que ninguém está fora — a frase da tela diz isso.
            semSinal,
        },
        ressalvas: [
            'Sem regime no cadastro e sem sinal no CNAE não é prova de que a empresa está fora da DeRE — é o app '
                + 'dizendo que não tem como saber. Quem souber de uma, marque no cadastro.',
            'O leiaute vigente (v1.2.0, 05/09/2026 — o D-1001 não mudou desde a 1.1.0) só tem lugar para serviços '
                + 'financeiros, planos de saúde e concursos de prognósticos (D-1001 {regTribPrinc} = 1, 2, 3). Os demais regimes específicos do Título V ficam '
                + '"fora do leiaute": não há como declará-los hoje, e o app passa a cobrar sozinho se uma versão '
                + 'futura os incluir.',
            'A declaração é por CNPJ RAIZ: matriz e filiais entram numa só. O número que importa é o de '
                + 'DECLARAÇÕES, não o de estabelecimentos.',
            RESSALVA_ENTREGA,
            'O que ainda não foi lido vai dito: o Manual do Usuário (MOD 1.0.1) e, da 1.2.0, o leiaute campo a campo dos '
                + 'eventos (02) e o Anexo I (03) — dos eventos novos (D-1121, D-1198, transacionais) só se conhece o XSD. '
                + 'O prazo (dia 15, 1ª competência 10/2026) vem do Ato Conjunto RFB/CGIBS 4/2026 por resumo de terceiros.',
            'A 1.2.0 trouxe leiautes TRANSACIONAIS (D-2201…D-4201) como PRELIMINARES: o app os lista e não os cobra — '
                + 'cobrar leiaute preliminar é cobrar o que a Receita ainda pode mudar.',
        ],
    };
}
