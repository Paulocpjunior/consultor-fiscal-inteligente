/**
 * data-entrada-escrituracao.js — a DATA DE ENTRADA de um documento de entrada
 * e a competência em que ele é ESCRITURADO. PURO.
 *
 * Paulo, 29/09, com o print do SAGE IOB (Notas Fiscais de Entrada: "Emissão
 * 30/07/2026 · Entrada 01/08/2026"): *"nota do mês anterior que foi
 * escriturada no 08, no consultor não temos essa opção … esse campo aqui está
 * incompleto"*. A nota do fornecedor é emitida num mês e ENTRA no
 * estabelecimento no seguinte; o livro de entradas, o C100 (DT_E_S) e o
 * arquivo do SAGE (DATA DE ENTRADA/SAÍDA) escrituram pela ENTRADA. O app só
 * conhecia a emissão, então a nota de 30/07 caía em julho — e no SPED de
 * agosto ela simplesmente não existia.
 *
 * Régua:
 *  · `dataEntrada` é decisão de quem escritura (não está no XML: o `dhSaiEnt`
 *    é a saída do EMITENTE). Vem da digitação ou da ação "📅 Data de entrada"
 *    no documento capturado.
 *  · competência de escrituração = mês da data de ENTRADA quando há; senão o
 *    mês da emissão (o de sempre). O campo `competencia` do documento É o de
 *    escrituração — é por ele que todo recorte (SPED, livros, DIPAM, fechamento)
 *    já pergunta, então mover a nota é mudar esse campo, com a emissão guardada
 *    em `competenciaEmissao`.
 *  · entrada antes da emissão é recusa (o documento ainda não existia).
 *  · sem data de entrada, nada muda: DT_E_S continua caindo na emissão.
 */
import { dataDeclaradaDoDocumento, competenciaFromDhEmi, direcaoEfetivaDoc } from './xml-metadata-helper.js';

const s = (v) => String(v ?? '').trim();

/** A data de ENTRADA declarada (AAAA-MM-DD) ou '' — nunca a de emissão. */
export function dataEntradaDoDocumento(d) {
    return dataDeclaradaDoDocumento(d?.dataEntrada) || '';
}

/** Competência em que o documento é ESCRITURADO (AAAA-MM). */
export function competenciaDeEscrituracao({ direcao, dhEmi, dataEntrada } = {}) {
    const daEntrada = direcao === 'entrada' ? dataDeclaradaDoDocumento(dataEntrada) : '';
    if (daEntrada) return daEntrada.slice(0, 7);
    return competenciaFromDhEmi(dataDeclaradaDoDocumento(dhEmi) || dhEmi) || '';
}

/**
 * Confere uma data de entrada contra a emissão.
 * @returns {{ok:boolean, erros:string[], dataEntrada:string, competencia:string, competenciaEmissao:string, mudaCompetencia:boolean}}
 */
export function conferirDataEntrada({ direcao = 'entrada', dhEmi, dataEntrada } = {}) {
    const erros = [];
    const emissao = dataDeclaradaDoDocumento(dhEmi);
    const competenciaEmissao = competenciaFromDhEmi(emissao || dhEmi) || '';
    const bruta = s(dataEntrada);
    const entrada = bruta ? dataDeclaradaDoDocumento(bruta) : '';
    if (direcao !== 'entrada' && bruta) {
        erros.push('Data de entrada só existe em documento de ENTRADA — a saída é escriturada pela emissão.');
    }
    if (bruta && !entrada) erros.push('Data de entrada ilegível — use o formato dd/mm/aaaa.');
    if (bruta && entrada && !emissao) erros.push('Sem data de emissão legível não dá para conferir a entrada.');
    if (entrada && emissao && entrada < emissao) {
        erros.push(`Data de entrada (${brDe(entrada)}) anterior à emissão (${brDe(emissao)}) — o documento ainda não existia. Confira as duas datas.`);
    }
    const competencia = erros.length ? competenciaEmissao
        : competenciaDeEscrituracao({ direcao, dhEmi: emissao || dhEmi, dataEntrada: entrada });
    return {
        ok: erros.length === 0, erros, dataEntrada: erros.length ? '' : entrada,
        competencia, competenciaEmissao, mudaCompetencia: !!entrada && competencia !== competenciaEmissao,
    };
}

/**
 * O que se grava no documento ao definir (ou limpar) a data de entrada. A
 * competência de emissão fica guardada UMA vez (a primeira) e é para ela que
 * o documento volta quando a data é limpa.
 */
export function patchDataEntrada({ doc, dataEntrada, autor = {} } = {}) {
    // A direção sai da RÉGUA (nota própria de entrada, art. 136, fica gravada como 'saida').
    const direcao = direcaoEfetivaDoc(doc) === 'saida' ? 'saida' : 'entrada';
    const conf = conferirDataEntrada({ direcao, dhEmi: doc?.dhEmi, dataEntrada });
    if (!conf.ok) return { ok: false, motivo: conf.erros.join(' '), patch: null, conf };
    const competenciaEmissao = s(doc?.competenciaEmissao) || conf.competenciaEmissao || s(doc?.competencia);
    const carimbo = { dataEntradaDefinidaEm: new Date().toISOString(), dataEntradaDefinidaPor: s(autor?.email || autor?.uid) || 'desconhecido' };
    if (!conf.dataEntrada) {
        return { ok: true, patch: { dataEntrada: '', competencia: competenciaEmissao, competenciaEmissao, ...carimbo }, conf };
    }
    return { ok: true, patch: { dataEntrada: conf.dataEntrada, competencia: conf.competencia, competenciaEmissao, ...carimbo }, conf };
}

export function brDe(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s(iso));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s(iso);
}
