// ============================================================================
// sefaz-backend/rotina-fiscal.js  (PURO — sem io, testável)
// ----------------------------------------------------------------------------
// A ROTINA MENSAL do departamento fiscal, em ordem (Paulo, 28/07/2026: "o
// colaborador não está seguindo uma linha de processo"):
//
//   1. CAPTURAR as notas do cliente no período
//   2. VALIDAR o que entrou (resumo sem completa, sem valor, cancelada)
//   3. APURAR o imposto (ficha/histórico da competência)
//   4. ENTREGAR as obrigações (DCTFWeb, SPED, FGTS…)
//   5. EMITIR e ENVIAR a guia (com o rito #293: SharePoint, gestor, baixa)
//
// O app já tinha TODAS as telas — o que faltava era a LINHA: onde este cliente
// está, o que falta e onde se resolve. Cada etapa é derivada de dado real
// (documentos, apuração, tarefas, envios). Nada aqui "marca como feito" na
// mão: se a etapa não tem prova, ela não está concluída.
//
// Farol honesto: etapa seguinte NUNCA fica verde por si. O `proximoPasso` é
// sempre a PRIMEIRA etapa não fechada na ordem — é isso que dá a linha.
// ============================================================================

export const ETAPAS_ROTINA = [
    { id: 'captura',    ordem: 1, nome: 'Capturar notas',        onde: 'Central de XMLs → Captura' },
    { id: 'validacao',  ordem: 2, nome: 'Validar as notas',      onde: 'Central de XMLs → XMLs (Entrada/Saída)' },
    { id: 'apuracao',   ordem: 3, nome: 'Apurar impostos',       onde: 'Simples Nacional / Lucro Presumido' },
    { id: 'obrigacoes', ordem: 4, nome: 'Entregar obrigações',   onde: 'Vencimentos e Obrigações' },
    { id: 'guias',      ordem: 5, nome: 'Emitir e enviar guias', onde: 'Vencimentos e Obrigações → Envios (rito)' },
];

/**
 * Status de etapa:
 *   'pendente'  — falta fazer (vermelho, trava a linha)
 *   'atencao'   — feito pela metade / com ressalva (âmbar, trava a linha)
 *   'concluida' — tem prova de que fechou
 *   'na'        — não se aplica a este cliente/mês (não trava)
 */
const FECHADAS = new Set(['concluida', 'na']);

const etapa = (id, status, resumo, acao = null, extra = {}) => {
    const base = ETAPAS_ROTINA.find((e) => e.id === id);
    return { ...base, status, resumo, acao, ...extra };
};

const cancelado = (d) => d?.status === 'cancelado' || d?.status === 'cancelada'
    || d?.status === 'denegado' || d?.status === 'inutilizado';

// Resumo (resNFe) x completa — MESMA regra do importer (decidirGravacaoNFe):
// modelos 57/58 nunca têm itens, então `temItens === false` só significa
// "resumo" pra 55/65. Sem isso toda CTe capturada viraria pendência falsa.
const modeloComItens = (chave) => {
    const m = String(chave || '').slice(20, 22);
    return m === '55' || m === '65';
};

export function ehResumoSemCompleta(d) {
    if (!d || cancelado(d)) return false;
    if (/^res(NFe|NFCe|CTe|MDFe)/.test(String(d.schema || ''))) return true;
    if (/^res/.test(String(d.tipoDoc || ''))) return true;
    if (d.temItens === false && modeloComItens(d.chave)) return true;
    return d.valorTotal == null;
}

/**
 * Prova de APURAÇÃO da competência, lida do próprio doc da empresa.
 *
 * Cada regime guarda de um jeito (e é assim que o app já grava hoje):
 *   Lucro   → `fichaFinanceira[]`, uma ficha por mesReferencia 'AAAA-MM', com
 *             o totalImpostos calculado;
 *   Simples → o faturamento lançado do mês (`faturamentoManual['AAAA-MM']` ou
 *             `faturamentoMensalDetalhado['MM-AAAA']`). O histórico de cálculo
 *             NÃO serve de prova: `saveHistoricoCalculo` não é chamado por
 *             nenhuma tela — quem lança o faturamento é quem apura.
 *
 * @returns {null | {fonte: string, totalImpostos: number|null, receita: number|null}}
 */
export function acharApuracaoDaCompetencia(empresa, competencia) {
    if (!empresa || !/^\d{4}-\d{2}$/.test(String(competencia || ''))) return null;
    const [ano, mes] = String(competencia).split('-');

    const ficha = (empresa.fichaFinanceira || []).find((f) => f?.mesReferencia === competencia);
    if (ficha) {
        return {
            fonte: 'lucro',
            totalImpostos: Number.isFinite(Number(ficha.totalImpostos)) ? Number(ficha.totalImpostos) : null,
            receita: Number.isFinite(Number(ficha.faturamentoMesTotal)) ? Number(ficha.faturamentoMesTotal) : null,
        };
    }

    const manual = empresa.faturamentoManual || {};
    if (Object.prototype.hasOwnProperty.call(manual, competencia)) {
        const receita = Number(manual[competencia]) || 0;
        // Receita zero no mês = sem DAS a pagar (a declaração sem movimento
        // continua sendo obrigação, e ela vive na etapa 4).
        return { fonte: 'simples', totalImpostos: receita === 0 ? 0 : null, receita };
    }

    const detalhado = empresa.faturamentoMensalDetalhado || {};
    const chaveDetalhada = `${mes}-${ano}`; // o Simples grava 'MM-AAAA' aqui
    if (Object.prototype.hasOwnProperty.call(detalhado, chaveDetalhada)) {
        return { fonte: 'simples-detalhado', totalImpostos: null, receita: null };
    }
    return null;
}

/**
 * Monta a rotina de UMA empresa numa competência.
 *
 * @param {object} p
 * @param {object}  p.empresa      { id, nome, cnpj, regime }
 * @param {string}  p.competencia  'AAAA-MM'
 * @param {Array}   p.documentos   docs da competência (entrada e saída)
 * @param {object}  p.apuracao     ficha/histórico da competência (null se não há)
 * @param {Array}   p.tarefas      tarefas (obrigações) da competência
 * @param {Array}   p.envios       registros de impostos_enviados da competência
 * @param {boolean} [p.capturaAtiva] a empresa está elegível à captura automática
 * @param {object}  [p.dipam]        { produtores, indefinidos } — compras de
 *   produtor rural detectadas no mês. Entra na etapa de OBRIGAÇÕES porque é lá
 *   que a DIPAM é entregue (ficha da GIA + Registro 1400 da EFD).
 */
export function montarRotinaFiscal({
    empresa, competencia, documentos = [], apuracao = null, tarefas = [], envios = [], capturaAtiva = true,
    dipam = null,
}) {
    const docs = documentos || [];
    const entradas = docs.filter((d) => d.direcao === 'entrada').length;
    const saidas = docs.filter((d) => d.direcao === 'saida').length;

    // ── 1. CAPTURA ──────────────────────────────────────────────────────────
    let eCaptura;
    if (docs.length === 0) {
        eCaptura = etapa('captura', 'pendente',
            'Nenhuma nota capturada nesta competência.',
            capturaAtiva
                ? 'Rode a captura do cliente e confira o Diagnóstico — pode ser certificado, procuração ou município sem trilho.'
                : 'A empresa não está elegível à captura automática — confira o cadastro em Status por Empresa.',
            { entradas, saidas, total: 0 });
    } else if (saidas === 0) {
        // Saída não vem pela SEFAZ (Rejeição 641): depende do cofre/autXML.
        eCaptura = etapa('captura', 'atencao',
            `${entradas} entrada(s) capturada(s), nenhuma nota de SAÍDA.`,
            'Saída mod 55 só chega pelo cofre de e-mail ou pelo autXML. Confira a ligação do cliente na Cobertura de Saída.',
            { entradas, saidas, total: docs.length });
    } else {
        eCaptura = etapa('captura', 'concluida', `${entradas} entrada(s) e ${saidas} saída(s).`, null,
            { entradas, saidas, total: docs.length });
    }

    // ── 2. VALIDAÇÃO ────────────────────────────────────────────────────────
    // Resumo sem a completa não tem valor nem itens: entra na apuração a menor.
    const resumos = docs.filter(ehResumoSemCompleta).length;
    const canceladas = docs.filter(cancelado).length;
    let eValidacao;
    if (docs.length === 0) {
        eValidacao = etapa('validacao', 'pendente', 'Sem notas para validar.',
            'Conclua a captura primeiro — a validação vem depois.', { resumos: 0, canceladas: 0 });
    } else if (resumos > 0) {
        eValidacao = etapa('validacao', 'atencao',
            `${resumos} nota(s) sem valor/itens (resumo da SEFAZ, aguardando a completa).`,
            'Manifeste a ciência (libera o XML completo) ou importe o arquivo do cliente. Sem isso a apuração sai a menor.',
            { resumos, canceladas });
    } else {
        eValidacao = etapa('validacao', 'concluida',
            `${docs.length} nota(s) com valor${canceladas ? ` · ${canceladas} cancelada(s) fora do cálculo` : ''}.`,
            null, { resumos, canceladas });
    }

    // ── 3. APURAÇÃO ─────────────────────────────────────────────────────────
    const eApuracao = apuracao
        ? etapa('apuracao', 'concluida',
            `Apuração registrada${apuracao.totalImpostos != null ? ` · ${fmtBRL(apuracao.totalImpostos)}` : ''}.`,
            null, { totalImpostos: apuracao.totalImpostos ?? null, fonte: apuracao.fonte || null })
        : etapa('apuracao', 'pendente', 'Sem apuração para esta competência.',
            'Abra a ficha do cliente (Simples ou Lucro) e feche o cálculo do mês.');

    // ── 4. OBRIGAÇÕES ───────────────────────────────────────────────────────
    const concluidas = tarefas.filter((t) => t.status === 'concluida').length;
    const abertas = tarefas.filter((t) => t.status !== 'concluida' && t.status !== 'cancelada');
    let eObrigacoes;
    if (tarefas.length === 0) {
        // Sem tarefa NÃO é "tudo certo" — é sinal de que o cron mensal não gerou.
        eObrigacoes = etapa('obrigacoes', 'atencao',
            'Nenhuma obrigação cadastrada nesta competência.',
            'As tarefas do mês não foram geradas. Rode a geração mensal em Vencimentos e Obrigações antes de dar qualquer coisa por entregue.',
            { concluidas: 0, total: 0 });
    } else if (abertas.length > 0) {
        eObrigacoes = etapa('obrigacoes', 'pendente',
            `${concluidas}/${tarefas.length} obrigação(ões) entregue(s).`,
            `Falta: ${abertas.map((t) => t.obrigacao || t.titulo || '—').join(', ')}.`,
            { concluidas, total: tarefas.length, abertas: abertas.map((t) => t.obrigacao || t.titulo || '—') });
    } else {
        eObrigacoes = etapa('obrigacoes', 'concluida', `${tarefas.length} obrigação(ões) entregue(s).`, null,
            { concluidas, total: tarefas.length, abertas: [] });
    }

    // DIPAM: a compra de produtor rural entra na GIA e no Registro 1400 da EFD
    // — ou seja, é entrega de obrigação. Fornecedor não confirmado NÃO deixa a
    // etapa fechar: o arquivo sairia com valor a menos e ninguém veria.
    const dipamProdutores = Number(dipam?.produtores || 0);
    const dipamIndefinidos = Number(dipam?.indefinidos || 0);
    if (dipamProdutores > 0 || dipamIndefinidos > 0) {
        const acaoDipam = 'Abra XMLs → 🌾 DIPAM / Produtor rural: confirme os fornecedores e leve o Registro 1400 para a GIA/EFD.';
        if (dipamIndefinidos > 0) {
            eObrigacoes = etapa('obrigacoes', 'atencao',
                `${eObrigacoes.resumo} · DIPAM: ${dipamIndefinidos} fornecedor(es) a confirmar.`,
                acaoDipam,
                {
                    concluidas: eObrigacoes.concluidas, total: eObrigacoes.total, abertas: eObrigacoes.abertas || [],
                    dipam: { produtores: dipamProdutores, indefinidos: dipamIndefinidos },
                });
        } else {
            eObrigacoes = { ...eObrigacoes,
                resumo: `${eObrigacoes.resumo} · DIPAM: ${dipamProdutores} compra(s) de produtor rural.`,
                acao: eObrigacoes.acao || acaoDipam,
                dipam: { produtores: dipamProdutores, indefinidos: 0 } };
        }
    }

    // ── 5. GUIAS ────────────────────────────────────────────────────────────
    // Completo = enviada COM o rito (arquivada no SharePoint e com baixa).
    const enviosOk = envios.filter((e) => e.sharePoint?.status === 'arquivado' && e.baixa?.status === 'baixada').length;
    // Apuração fechada em ZERO não gera guia — cobrar envio aqui seria pendência
    // falsa (empresa sem movimento no mês).
    const semImpostoAPagar = !!apuracao && Number(apuracao.totalImpostos) === 0;
    let eGuias;
    if (envios.length === 0 && semImpostoAPagar) {
        eGuias = etapa('guias', 'na', 'Apuração fechou sem imposto a pagar — não há guia a enviar.', null,
            { envios: 0, completos: 0 });
    } else if (envios.length === 0) {
        eGuias = etapa('guias', 'pendente', 'Nenhuma guia enviada ao cliente.',
            'Envie a guia pelo app — a cópia na pasta IMPOSTOS, o gestor em cópia e a baixa da obrigação saem automáticos.',
            { envios: 0, completos: 0 });
    } else if (enviosOk < envios.length) {
        eGuias = etapa('guias', 'atencao',
            `${envios.length} envio(s), ${enviosOk} completo(s) pelo rito.`,
            'Veja em Envios (rito) o que ficou sem cópia no SharePoint ou sem baixa da obrigação.',
            { envios: envios.length, completos: enviosOk });
    } else {
        eGuias = etapa('guias', 'concluida', `${envios.length} guia(s) enviada(s) com o rito completo.`, null,
            { envios: envios.length, completos: enviosOk });
    }

    const etapas = [eCaptura, eValidacao, eApuracao, eObrigacoes, eGuias];

    // PRÓXIMO PASSO = a primeira etapa não fechada, na ordem. É a "linha" que
    // faltava: o colaborador não precisa decidir por onde começar.
    const proxima = etapas.find((e) => !FECHADAS.has(e.status)) || null;
    const fechadas = etapas.filter((e) => FECHADAS.has(e.status)).length;

    return {
        empresa: empresa || null,
        competencia,
        etapas,
        proximoPasso: proxima
            ? { id: proxima.id, ordem: proxima.ordem, nome: proxima.nome, onde: proxima.onde, acao: proxima.acao, resumo: proxima.resumo }
            : null,
        progresso: { concluidas: fechadas, total: etapas.length },
        // Só é 'ok' quando as CINCO fecham — mês pela metade não é mês fechado.
        farol: fechadas === etapas.length ? 'ok'
            : etapas.some((e) => e.status === 'pendente') ? 'pendente' : 'atencao',
    };
}

function fmtBRL(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Funil da carteira: quantos clientes estão parados em cada etapa, na ordem.
 * É a visão do gestor — "onde a carteira está travada hoje".
 */
export function resumirFunil(rotinas) {
    const funil = ETAPAS_ROTINA.map((e) => ({ id: e.id, ordem: e.ordem, nome: e.nome, empresas: [] }));
    let completos = 0;
    for (const r of rotinas || []) {
        if (!r?.proximoPasso) { completos++; continue; }
        const alvo = funil.find((f) => f.id === r.proximoPasso.id);
        if (alvo) alvo.empresas.push(r.empresa?.nome || r.empresa?.cnpj || '—');
    }
    const total = (rotinas || []).length;
    return {
        total,
        completos,
        etapas: funil.map((f) => ({ ...f, qtd: f.empresas.length, empresas: f.empresas.slice(0, 100) })),
        resumo: total === 0
            ? 'Nenhuma empresa na seleção.'
            : completos === total
                ? `${total} empresa(s) com o mês fechado.`
                : `${completos} de ${total} empresa(s) com o mês fechado — ${total - completos} paradas em alguma etapa.`,
    };
}
