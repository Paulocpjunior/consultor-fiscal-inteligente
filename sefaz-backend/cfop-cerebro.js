// ============================================================================
// sefaz-backend/cfop-cerebro.js  (PURO — testável)
// ----------------------------------------------------------------------------
// O "CÉREBRO" DO CFOP — a decisão humana numa nota vira PARÂMETRO para as
// próximas, em vez de morrer naquela linha.
//
// ═══ POR QUE EXISTE (Paulo, 18/08) ══════════════════════════════════════════
//
// *"Poderíamos fazer o ajuste manual da reclassificação… um cérebro que, quando
// o usuário faz a alteração de forma manual, ele deve gravar, criando um
// parâmetro para os próximos meses."*
//
// E o número que justifica: no Relatório de Notas de um cliente (2.330 entradas
// em 6 meses), **914 notas (39%)** foram escrituradas como uso/consumo ou ativo
// — destino que o XML NÃO carrega, porque o fornecedor emite 5102/5405 (para
// ELE é venda de mercadoria). A régua não tem como saber, e corrigir 914 notas
// à mão por semestre não é processo, é penitência.
//
// ═══ A MEDIÇÃO QUE DEFINIU A CHAVE ══════════════════════════════════════════
//
// No mesmo arquivo: **apenas 6 de 311 fornecedores** aparecem em mais de um
// grupo de destino. Ou seja, **o FORNECEDOR determina o destino em 98% dos
// casos** — e 10 fornecedores cobrem 66% daquelas 914 notas.
//
// Mas 98% não é 100%, e é por isso que a chave NÃO é só o fornecedor: ela é
// **fornecedor + CFOP de origem**, com o parâmetro "todo CFOP deste fornecedor"
// como escopo mais largo. O CFOP que o fornecedor emitiu já separa venda normal
// de venda com ST e de venda de ativo, então os 6 casos mistos se resolvem sem
// ninguém adivinhar. O MAIS ESPECÍFICO vence.
//
// ═══ TRÊS TRAVAS QUE O DESENHO CARREGA ══════════════════════════════════════
//
// 1. **VIGÊNCIA, e ela NÃO RETROAGE.** O parâmetro vale da competência em que
//    nasceu em diante. Competência anterior continua com o que valia nela —
//    mesma régua do IVA-ST e do calendário municipal. Sem isso, um mês já
//    entregue mudaria de CFOP depois do SPED transmitido.
// 2. **O CÉREBRO NÃO VENCE A NOTA.** Precedência: decisão explícita NAQUELA NF
//    > parâmetro do fornecedor > override da empresa > régua automática. Quem
//    corrigiu a nota olhou a nota; o parâmetro é o palpite melhor, não a
//    verdade.
// 3. **PARÂMETRO SE VÊ E SE DESLIGA.** Ele carrega quem criou, quando e a
//    partir de qual competência — e a tela DIZ, em cada linha, que o CFOP veio
//    dele. Parâmetro invisível que decide imposto é o que ninguém audita depois.
//
// ⚠️ O QUE ESTE CÉREBRO DELIBERADAMENTE NÃO FAZ: aprender por NCM ou pela
// descrição do produto. Acertaria na maioria e erraria EM SILÊNCIO na minoria —
// e num livro fiscal o erro silencioso é o caro. Ele aprende do que uma PESSOA
// decidiu, e só disso.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const soCfop = (v) => {
    const c = soDigitos(v);
    return c.length === 4 ? c : '';
};

/** 'AAAA-MM' — a competência em que o parâmetro passa a valer. */
const soComp = (v) => {
    const s = String(v ?? '').trim();
    return /^\d{4}-\d{2}$/.test(s) ? s : '';
};

/**
 * A chave do parâmetro. Dois escopos, e o mais específico vence:
 *   'CNPJ|CFOP'  → só quando o fornecedor emitir aquele CFOP
 *   'CNPJ|*'     → qualquer CFOP daquele fornecedor
 */
export function chaveParametro(cnpjFornecedor, cfopOrigem) {
    const cnpj = soDigitos(cnpjFornecedor);
    if (!cnpj) return '';
    const cfop = soCfop(cfopOrigem);
    return `${cnpj}|${cfop || '*'}`;
}

/**
 * O parâmetro que se aplica a esta nota, ou null.
 *
 * @param {Array} parametros  [{cnpjFornecedor, cfopOrigem|null, cfopDestino,
 *                              vigenciaInicio:'AAAA-MM', ativo, criadoPor, criadoEm}]
 * @param {object} p
 * @param {string} p.cnpjFornecedor  o CNPJ de quem emitiu a nota
 * @param {string} p.cfopOrigem      o CFOP que veio no XML
 * @param {string} p.competencia     'AAAA-MM' da nota
 */
export function parametroAplicavel(parametros, { cnpjFornecedor, cfopOrigem, competencia } = {}) {
    const cnpj = soDigitos(cnpjFornecedor);
    const comp = soComp(competencia);
    if (!cnpj || !comp) return null;   // sem fornecedor ou sem competência não se decide nada
    const cfop = soCfop(cfopOrigem);

    let especifico = null;
    let amplo = null;
    for (const p of (parametros || [])) {
        if (!p || p.ativo === false) continue;
        if (soDigitos(p.cnpjFornecedor) !== cnpj) continue;
        // ⚠️ VIGÊNCIA NÃO RETROAGE: competência anterior à do parâmetro fica com
        // o que valia nela. Sem isto, um mês já entregue mudaria de CFOP depois
        // do SPED transmitido.
        const ini = soComp(p.vigenciaInicio);
        if (!ini || comp < ini) continue;
        if (!soCfop(p.cfopDestino)) continue;   // parâmetro sem destino não decide

        const doCfop = soCfop(p.cfopOrigem);
        if (doCfop) {
            if (doCfop !== cfop) continue;
            // Entre dois específicos, vence o de vigência MAIS RECENTE que já
            // começou — é a régua do IVA-ST: resolve pela DATA do fato.
            if (!especifico || soComp(especifico.vigenciaInicio) < ini) especifico = p;
        } else {
            if (!amplo || soComp(amplo.vigenciaInicio) < ini) amplo = p;
        }
    }
    return especifico || amplo || null;
}

/**
 * A sugestão de virar parâmetro, depois de alguém corrigir uma nota à mão.
 *
 * ⚠️ É SUGESTÃO, e o desenho é OPT-IN: quem corrigiu decide se aquilo vale para
 * as próximas. Nascer ligado faria o app aprender com um clique de teste — e um
 * parâmetro errado é pior que a correção nota a nota, porque ele se aplica
 * calado a tudo que vier depois.
 */
export function sugerirParametro({ cnpjFornecedor, nomeFornecedor, cfopOrigem, cfopDestino, competencia } = {}) {
    const cnpj = soDigitos(cnpjFornecedor);
    const destino = soCfop(cfopDestino);
    const origem = soCfop(cfopOrigem);
    const comp = soComp(competencia);

    if (!destino) return { pode: false, motivo: 'Sem CFOP informado não há o que aprender.' };
    if (!cnpj) {
        return {
            pode: false,
            motivo: 'Esta nota não tem o CNPJ do fornecedor gravado — o parâmetro é POR FORNECEDOR, '
                + 'então não dá para criá-lo aqui. Releia o XML (♻️) e tente de novo.',
        };
    }
    if (!comp) return { pode: false, motivo: 'Nota sem competência legível — o parâmetro precisa de uma data de início.' };

    const quem = String(nomeFornecedor || '').trim() || `CNPJ ${cnpj}`;
    return {
        pode: true,
        chave: chaveParametro(cnpj, origem),
        // A frase diz as TRÊS coisas que a pessoa precisa antes de aceitar:
        // o que passa a valer, de quando em diante, e o que NÃO muda.
        pergunta: origem
            ? `Aplicar ${destino} nas próximas notas de ${quem} que chegarem com CFOP ${origem}?`
            : `Aplicar ${destino} em TODAS as próximas notas de ${quem}?`,
        detalhe: `Vale de ${comp} em diante. Competências anteriores não mudam, e uma nota com CFOP `
            + 'informado à mão continua vencendo o parâmetro.',
        parametro: {
            cnpjFornecedor: cnpj,
            nomeFornecedor: quem,
            cfopOrigem: origem || null,
            cfopDestino: destino,
            vigenciaInicio: comp,
            ativo: true,
        },
    };
}

/** Rótulo do parâmetro para a tela — origem sem carimbo não se confere. */
export function rotuloParametro(p) {
    if (!p) return '';
    const alvo = soCfop(p.cfopOrigem) ? `CFOP ${soCfop(p.cfopOrigem)}` : 'qualquer CFOP';
    return `parâmetro do fornecedor (${alvo}, desde ${soComp(p.vigenciaInicio) || '—'})`;
}
