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
//   · **não gera nem transmite evento**. Agora o leiaute está lido — mas o
//     leiaute descreve CAMPOS, e quem os valida é o XSD, que não está no repo
//     (o Manual diz onde baixar: Portal SPED e cgibs.gov.br). Montar XML sem o
//     XSD é o `1405` num arquivo que a Receita processa. E o INSUMO dos eventos
//     periódicos é CONTÁBIL (PGCC, balancete) — mora no Consultor Contábil.
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
 * OS EVENTOS — Leiautes da DeRE v1.1.0 (22/06/2026), sumário e seções 1-3.
 *
 * `grupo`: 'tabela' (enviado uma vez, vale até ser alterado) · 'mensal'
 * (por competência) · 'retorno' (a Receita devolve; ninguém envia).
 * `mensalDesde`: competência a partir da qual o evento mensal é exigido.
 * `condicional`: o evento só é exigido de quem tem no PGCC conta com um dos
 * `codTribs` — Anexo II, "RN - Tabela de codtribs obrigatórios para eventos
 * auxiliares" (e EVENTOS_OBRIGATORIOS_PERIODO, MS1146-MS1148).
 *
 * 🚨 **D-1121 NÃO EXISTE** no leiaute 1.1.0 — o resumo de terceiros que este
 * módulo usou de manhã o listava como "Relação de Deduções". O que existe com
 * 1121 no nome é o RETORNO D-9121 (totalizador do D-2101). Corrigido lendo a
 * fonte, e travado por teste.
 */
export const EVENTOS_DERE = Object.freeze([
    { codigo: 'D-1001', nome: 'Informações do Contribuinte', grupo: 'tabela', desde: '2026-10-01',
        nota: 'Regime específico PRINCIPAL ({regTribPrinc} = 1 serviços financeiros · 2 planos de saúde · 3 concursos '
            + 'de prognósticos · 9 outros) e até três secundários; atividades das Tabelas 21/31/41 do Anexo I. '
            + 'É aqui que a empresa declara em qual regime está. Por CNPJ RAIZ ({nrInsc} tem 8 posições).' },
    { codigo: 'D-1011', nome: 'Plano Geral de Contas Comentado (PGCC)', grupo: 'tabela', desde: '2026-10-01',
        nota: 'Obrigatório para todo contribuinte da DeRE — plano referencial COSIF/ANS/SUSEP/SPED ({planoCtaRef} '
            + '1-4), contas com {codTrib} da Tabela 11, até 50.000 contas. Insumo CONTÁBIL: o plano de contas '
            + 'mora no Consultor Contábil.' },
    { codigo: 'D-1101', nome: 'Balancete Mensal', grupo: 'mensal', mensalDesde: '10/2026',
        nota: 'Saldo inicial, movimentos, saldo final e {vApur} por conta analítica (até 10.000). Insumo CONTÁBIL — '
            + 'não sai deste app. É o evento que o D-1199 exige (MS1146).' },
    { codigo: 'D-1106', nome: 'Identificação de Aplicações Financeiras', grupo: 'mensal', mensalDesde: '10/2026',
        condicional: { codTribs: ['120130001', '120230001', '120330001', '111112701'],
            texto: 'Só de quem tem no PGCC conta com codTrib 120130001/120230001/120330001 (saúde) ou 111112701 '
                + '(seguros) — Anexo II, RN Tabela de codtribs obrigatórios; MS1135/MS1147.' } },
    { codigo: 'D-2101', nome: 'Débito em Operações com Títulos de Dívida com Oferta Pública', grupo: 'mensal', mensalDesde: '10/2026',
        condicional: { codTribs: ['110113001', '110113002'],
            texto: 'Só de quem tem no PGCC conta com codTrib 110113001 ou 110113002 — Anexo II, RN Tabela de codtribs '
                + 'obrigatórios; MS1135/MS1148.' } },
    { codigo: 'D-1199', nome: 'Fechamento de Eventos Mensais', grupo: 'mensal', mensalDesde: '10/2026',
        nota: 'Fecha a competência — só admite INCLUSÃO, exige D-1101 ativo (MS1146) e os auxiliares condicionais '
            + '(MS1147/MS1148); retificar exige REABERTURA (Leiautes, seção 2.3). É o análogo do R-2099 da Reinf.' },
    { codigo: 'D-9001', nome: 'Retorno — Eventos de Tabela', grupo: 'retorno' },
    { codigo: 'D-9101', nome: 'Retorno Totalizador — Balancete Mensal', grupo: 'retorno' },
    { codigo: 'D-9106', nome: 'Retorno Totalizador — Identificação de Aplicações Financeiras', grupo: 'retorno' },
    { codigo: 'D-9121', nome: 'Retorno Totalizador — Débito em Operações com Títulos de Dívida com Oferta Pública', grupo: 'retorno' },
    { codigo: 'D-9199', nome: 'Retorno Totalizador — Fechamento de Eventos Mensais', grupo: 'retorno',
        nota: 'A memória de cálculo do débito de IBS, CBS e IS do mês ({totalTributosGeral}) — é contra ele que se '
            + 'confere o que foi declarado.' },
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
        + 'envioLoteDere/v1_0_1. O XSD não está neste repo.',
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
    { titulo: 'Leiautes da DeRE — Eventos v1.1.0', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/02-leiautes-eventos-v1.1.0.pdf', texto: 'docs/dere/02-leiautes-eventos-v1.1.0.txt' },
    { titulo: 'Anexo I — Tabelas v1.1.0', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/03-anexo-i-tabelas-v1.1.0.pdf', texto: 'docs/dere/03-anexo-i-tabelas-v1.1.0.txt' },
    { titulo: 'Anexo II — Regras de Validação v1.1.0', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/04-anexo-ii-regras-de-validacao-v1.1.0.pdf', texto: 'docs/dere/04-anexo-ii-regras-de-validacao-v1.1.0.txt' },
    { titulo: 'Histórico de Versões v1.1.0', versao: '1.1.0', data: '22/06/2026', pdf: '/docs/dere/05-historico-de-versoes-v1.1.0.pdf', texto: 'docs/dere/05-historico-de-versoes-v1.1.0.txt' },
    { titulo: 'Manual de Orientação ao Desenvolvedor v1.0.2', versao: '1.0.2', data: '18/08/2026', pdf: '/docs/dere/07-manual-do-desenvolvedor-v1.0.2.pdf', texto: 'docs/dere/07-manual-do-desenvolvedor-v1.0.2.txt' },
]);

/** O que NÃO está no repo — dito, para ninguém deduzir que o app leu. */
export const DOCUMENTOS_DERE_FALTANDO = Object.freeze([
    'Manual de Orientação do Usuário (MOD) v1.0.1 — quem está obrigado em linguagem de negócio, prazos, penalidades.',
    'Mensagens de Erro do Sistema (documento 08, citado no Anexo II).',
    'XSD dos eventos e do lote — o Manual do Desenvolvedor diz onde baixar (Portal SPED e cgibs.gov.br).',
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
 * Isto NÃO gera evento: é a régua de FORMA, para o dia em que houver gerador
 * e para conferir um Id que chegue de fora. Entrada torta é RECUSA nomeada,
 * nunca um Id "mais ou menos".
 */
export function montarIdEventoDere({ codigoEvento, cnpj, data, sequencial = 1 } = {}) {
    const ev = String(codigoEvento || '').replace(/^D-/, '');
    if (!CODIGOS_EVENTO.has(ev)) return { ok: false, id: null, motivo: `Evento "${codigoEvento}" não existe no leiaute 1.1.0.` };
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
    if (!CODIGOS_EVENTO.has(evento)) return { ok: false, motivo: `Evento ${evento} não existe no leiaute 1.1.0.` };
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
    if (!CODIGOS_EVENTO.has(evento)) return { ok: false, motivo: `Evento ${evento} não existe no leiaute 1.1.0.` };
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

// ═══ CRONOGRAMA, PRAZO, SITUAÇÃO, TRIAGEM ════════════════════════════════════

/** Os eventos que UMA competência exige de quem está obrigado. */
export function eventosDaCompetencia(competencia) {
    const tabela = EVENTOS_DERE.filter((e) => e.grupo === 'tabela');
    const mensais = EVENTOS_DERE.filter((e) => e.grupo === 'mensal'
        && compararCompetencias(competencia, e.mensalDesde) >= 0);
    return { tabela, mensais };
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

const RESSALVA_ENTREGA = 'O CFI NÃO gera nem transmite os eventos da DeRE. Os leiautes e o manual do desenvolvedor '
    + 'estão lidos e servidos no app, mas o XSD não está no repo, o insumo (PGCC, balancete) é contábil e a '
    + 'transmissão exige credencial do piloto da Reforma. A entrega é por fora (portal/API da DeRE) e se '
    + 'registra em Vencimentos como as demais obrigações entregues fora do app.';

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
        eventos: vigente ? eventosDaCompetencia(competencia) : { tabela: [], mensais: [] },
        cronograma: CRONOGRAMA_DERE,
        regimes: REGIMES_ESPECIFICOS_IBS_CBS,
        fontes: FONTES_DERE,
        documentos: DOCUMENTOS_DERE,
        documentosFaltando: DOCUMENTOS_DERE_FALTANDO,
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
            'O leiaute vigente (v1.1.0) só tem lugar para serviços financeiros, planos de saúde e concursos de '
                + 'prognósticos (D-1001 {regTribPrinc} = 1, 2, 3). Os demais regimes específicos do Título V ficam '
                + '"fora do leiaute": não há como declará-los hoje, e o app passa a cobrar sozinho se uma versão '
                + 'futura os incluir.',
            'A declaração é por CNPJ RAIZ: matriz e filiais entram numa só. O número que importa é o de '
                + 'DECLARAÇÕES, não o de estabelecimentos.',
            RESSALVA_ENTREGA,
            'O que ainda não foi lido vai dito: o Manual do Usuário (MOD 1.0.1), as Mensagens de Erro e os XSD. O '
                + 'prazo (dia 15, 1ª competência 10/2026) vem do Ato Conjunto RFB/CGIBS 4/2026 por resumo de terceiros.',
        ],
    };
}
