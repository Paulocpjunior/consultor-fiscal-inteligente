export function competenciaFromDhEmi(value) {
    const raw = String(value || '').trim();
    const iso = raw.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;

    const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2]}`;

    return null;
}

function pickFirstBlock(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1] : '';
}

function pickTag(xml, tag) {
    const m = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

/**
 * CNPJ/CPF autorizados a baixar o XML — bloco <autXML> da NF-e.
 *
 * É a PROVA de que o cliente configurou o escritório no emissor dele: com o
 * nosso CNPJ aqui, a SEFAZ entrega a nota de SAÍDA para nós (sem isso não
 * entrega — Rejeição 641). Paulo, 04/08: "como assegurar que o cliente fez
 * correto, como podemos confirmar se o cadastro já está apto conforme ele
 * informa". A resposta está escrita na própria nota.
 *
 * Uma NF-e aceita até 10 autorizados, então devolve LISTA.
 */
export function extrairAutXml(xml) {
    const fora = [];
    const re = /<autXML\b[^>]*>([\s\S]*?)<\/autXML>/gi;
    let m;
    while ((m = re.exec(String(xml || ''))) !== null) {
        const doc = pickTag(m[1], 'CNPJ') || pickTag(m[1], 'CPF');
        const d = String(doc || '').replace(/\D/g, '');
        if (d) fora.push(d);
    }
    return fora;
}

/** O escritório está entre os autorizados desta nota? */
export function autorizadoNoXml(xml, cnpjEscritorio) {
    const alvo = String(cnpjEscritorio || '').replace(/\D/g, '');
    if (!alvo) return false;
    return extrairAutXml(xml).includes(alvo);
}

export function extrairParticipantesNfe(xml) {
    const emit = pickFirstBlock(xml, 'emit');
    const dest = pickFirstBlock(xml, 'dest');

    // ENDEREÇO importa: o Exportar SAGE cadastra o participante (registro
    // E010) e o E-Fiscal RECUSA sem UF ("Campo 10, UF inválida"). Até 04/08 só
    // guardávamos o CNPJ do destinatário — nas SAÍDAS, que é justamente onde o
    // participante É o destinatário, o E010 saía com nome "CLIENTE" e UF em
    // branco e derrubava a importação inteira em cascata (caso 04/08: 30 sem
    // UF ⇒ 54 notas recusadas). O bloco <enderDest> sempre veio no XML.
    const endEmit = pickFirstBlock(emit, 'enderEmit');
    const endDest = pickFirstBlock(dest, 'enderDest');

    return {
        emitente: {
            cnpj: pickTag(emit, 'CNPJ') || pickTag(emit, 'CPF') || null,
            nome: pickTag(emit, 'xNome') || null,
            uf: pickTag(endEmit, 'UF') || null,
            codMunIBGE: pickTag(endEmit, 'cMun') || null,
            ie: pickTag(emit, 'IE') || null,
        },
        destinatario: {
            cnpj: pickTag(dest, 'CNPJ') || pickTag(dest, 'CPF') || null,
            nome: pickTag(dest, 'xNome') || null,
            uf: pickTag(endDest, 'UF') || null,
            codMunIBGE: pickTag(endDest, 'cMun') || null,
            ie: pickTag(dest, 'IE') || null,
        },
    };
}

/**
 * Direção EFETIVA de um doc já gravado — a régua única de leitura.
 *
 * O importer antigo marcava 'saida' sempre que a empresa era a emitente,
 * ignorando o tpNF: nota própria de ENTRADA (tpNF=0 — compra de produtor
 * rural PF, retorno etc.) ficava como saída, o Exportar SAGE recusava o CFOP
 * 1xxx/2xxx e a DIPAM não via a compra (31/07, caso EDUARDO GUERRA). O
 * backfill do sync-cron corrige o banco aos poucos; esta função corrige a
 * LEITURA na hora, para o painel não depender do próximo ciclo.
 */
export function direcaoEfetivaDoc(d) {
    if (!d) return undefined;
    if (d.direcao === 'saida' && String(d.tpNF ?? '') === '0') return 'entrada';
    return d.direcao;
}

// ── Cancelamento EFETIVO — mesma lição da direção: o campo gravado pode mentir ──
// Duas formas de o status ficar torto (bug 11/08, MV LIDER 639 — cancelada
// contada no Livro de Saídas e no fechamento):
//   1. o importer só virava status com evento cStat 135; cancelamento homologado
//      FORA DE PRAZO é cStat 155 e é cancelamento igual — ficava 'autorizado';
//   2. evento chegando ANTES da nota (stub 'cancelado') era atropelado pelo
//      merge quando a NF-e completa chegava com o protocolo dela (autorizado).
// Esta função decide na LEITURA, olhando o que o doc CARREGA: o status, o cStat
// da própria nota (legado 101/151 = cancelamento homologado) e os eventos[]
// (110111 registrado = 135/155). O backfill do sync-cron conserta o banco aos
// poucos; a leitura não espera o próximo ciclo.

const STATUS_CANCELADO = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);
/** cStat da PRÓPRIA nota que significa cancelamento (legado pré-evento). */
const CSTAT_NOTA_CANCELADA = new Set(['101', '151']);
/** cStat de EVENTO 110111 registrado (135) ou homologado fora de prazo (155). */
export const CSTAT_EVENTO_CANCELAMENTO = new Set(['135', '155']);

export function docCancelado(d) {
    if (!d) return false;
    if (STATUS_CANCELADO.has(String(d.status || '').toLowerCase())) return true;
    if (CSTAT_NOTA_CANCELADA.has(String(d.cStat || ''))) return true;
    const eventos = Array.isArray(d.eventos) ? d.eventos : [];
    return eventos.some((e) => {
        if (!e) return false;
        const ehCancelamento = String(e.tpEvento || '') === '110111'
            || String(e.tipo || '') === 'cancelamento';
        if (!ehCancelamento) return false;
        const cStat = String(e.cStat || '');
        // Sem cStat gravado (captura antiga/cofre): a SEFAZ só distribui evento
        // REGISTRADO, então cancelamento anexado sem cStat conta como cancelado.
        // cStat presente e fora de 135/155 (ex.: rejeição) NÃO cancela.
        return cStat === '' || CSTAT_EVENTO_CANCELAMENTO.has(cStat);
    });
}
