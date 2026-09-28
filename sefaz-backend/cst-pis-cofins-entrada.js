/**
 * cst-pis-cofins-entrada.js — a CST de PIS/COFINS de uma AQUISIÇÃO e a
 * natureza da base do crédito (Tabela 4.3.4 × 4.3.7). PURO.
 *
 * ELS (Distribuidora de Bananas) 08/2026, PVA de 28/09: 30 recusas "não deve
 * ser informado CST com direito a crédito (50 a 56) para participante pessoa
 * física" e 80 avisos "CST 50–56 em produto sujeito a alíquota zero". O
 * gerador carimbava 50 (com crédito) em TODA compra do não-cumulativo —
 * banana de produtor rural PF, fertilizante a alíquota zero, diesel — e o
 * M100 declarava R$ 15.822 de PIS de crédito que a lei não dá.
 *
 * A régua, em três degraus, do mais forte para o padrão:
 *   1. REGIME cumulativo → 70 (não há crédito por lei) — como era.
 *   2. PARTICIPANTE PESSOA FÍSICA → 70. Lei 10.637/02 e 10.833/03, art. 3º,
 *      § 3º, I: o crédito só alcança bens e serviços adquiridos de pessoa
 *      jurídica domiciliada no País. É lei, não cadastro — automático.
 *   3. CADASTRO NCM (`cstPisCofinsEntrada` + `natBcCred`, por NCM/prefixo,
 *      com vigência) → o cadastrado. É onde a alíquota zero (73), a ST (75),
 *      o monofásico sem crédito (70) e o insumo (50 + natureza 02) entram.
 *   4. PADRÃO → 50 com natureza 01 (bens para revenda) para mercadoria e 03
 *      (serviços utilizados como insumo) para serviço — o comportamento de
 *      antes, mantido de propósito (28/09: "um ajuste não pode parar outra
 *      produção"), agora DITO no aviso, NCM a NCM, com o valor.
 *
 * O que sai daqui carrega a FONTE (`cumulativo` · `pessoa-fisica` ·
 * `cadastro-ncm` · `padrao`) para o aviso da geração dizer de onde veio cada
 * decisão. Nada aqui inventa crédito novo: o cadastro só pode TIRAR crédito
 * (70–75) ou qualificá-lo (natureza); o padrão é o de sempre.
 */
import { resolverParametrosNcm } from './ncm-parametros.js';
import {
    CST_ENTRADA_COM_CREDITO, CST_ENTRADA_PRESUMIDO, CST_ENTRADA_SEM_CREDITO, CST_ENTRADA_VALIDOS,
} from './tabelas-cst-entrada.js';

/** Tabela 4.3.4 — CST de aquisição (as listas moram em tabelas-cst-entrada.js). */
export { CST_ENTRADA_COM_CREDITO, CST_ENTRADA_PRESUMIDO, CST_ENTRADA_SEM_CREDITO, CST_ENTRADA_VALIDOS };
export const ROTULO_CST_ENTRADA = Object.freeze({
    '50': 'Com direito a crédito — vinculada à receita tributada no mercado interno',
    '51': 'Com direito a crédito — vinculada à receita não tributada no mercado interno',
    '52': 'Com direito a crédito — vinculada à receita de exportação',
    '53': 'Com direito a crédito — receitas tributadas e não tributadas no MI',
    '54': 'Com direito a crédito — receitas tributadas no MI e de exportação',
    '55': 'Com direito a crédito — receitas não tributadas no MI e de exportação',
    '56': 'Com direito a crédito — receitas tributadas, não tributadas e de exportação',
    '60': 'Crédito presumido — vinculada à receita tributada no MI',
    '61': 'Crédito presumido — vinculada à receita não tributada no MI',
    '62': 'Crédito presumido — vinculada à receita de exportação',
    '63': 'Crédito presumido — receitas tributadas e não tributadas no MI',
    '64': 'Crédito presumido — receitas tributadas no MI e de exportação',
    '65': 'Crédito presumido — receitas não tributadas no MI e de exportação',
    '66': 'Crédito presumido — receitas tributadas, não tributadas e de exportação',
    '70': 'Aquisição sem direito a crédito',
    '71': 'Aquisição com isenção',
    '72': 'Aquisição com suspensão',
    '73': 'Aquisição a alíquota zero',
    '74': 'Aquisição sem incidência da contribuição',
    '75': 'Aquisição por substituição tributária',
    '98': 'Outras operações de entrada',
    '99': 'Outras operações',
});

/** Tabela 4.3.7 — natureza da base de cálculo do crédito. */
export const NAT_BC_CRED = Object.freeze({
    '01': 'Aquisição de bens para revenda',
    '02': 'Aquisição de bens utilizados como insumo',
    '03': 'Aquisição de serviços utilizados como insumo',
    '04': 'Energia elétrica e térmica, inclusive sob a forma de vapor',
    '05': 'Aluguéis de prédios',
    '06': 'Aluguéis de máquinas e equipamentos',
    '07': 'Armazenagem de mercadoria e frete na operação de venda',
    '08': 'Contraprestações de arrendamento mercantil',
    '09': 'Máquinas, equipamentos e outros bens do ativo imobilizado (depreciação)',
    '10': 'Máquinas, equipamentos e outros bens do ativo imobilizado (valor de aquisição)',
    '11': 'Amortização e depreciação de edificações e benfeitorias em imóveis',
    '12': 'Devolução de vendas sujeitas à incidência não cumulativa',
    '13': 'Outras operações com direito a crédito',
    '14': 'Atividade de transporte de cargas — subcontratação',
    '15': 'Atividade imobiliária — custo incorrido de unidade imobiliária',
    '16': 'Atividade imobiliária — custo orçado de unidade não concluída',
    '17': 'Serviços de limpeza, conservação e manutenção — vale-transporte, refeição, uniforme',
    '18': 'Estoque de abertura de bens',
});
export const NAT_BC_CRED_PADRAO_MERCADORIA = '01';
export const NAT_BC_CRED_PADRAO_SERVICO = '03';

const so = (v) => String(v ?? '').replace(/\D/g, '');

export function cstGeraCredito(cst) {
    const c = String(cst ?? '').padStart(2, '0');
    return CST_ENTRADA_COM_CREDITO.includes(c) || CST_ENTRADA_PRESUMIDO.includes(c);
}

/** Participante pessoa física = CPF (11 dígitos) no COD_PART. */
export function ehPessoaFisica(codPart) {
    return so(codPart).length === 11;
}

/**
 * @param {object} p
 * @param {string}  p.regimeApuracao  '1' não-cumulativo · '2' cumulativo · '3' ambos
 * @param {string}  [p.codPart]       CNPJ/CPF do participante (a régua da PF)
 * @param {string}  [p.ncm]           NCM do item (mercadoria)
 * @param {Array}   [p.catalogo]      cadastro de NCM (ncm_parametros)
 * @param {string}  [p.dataRef]       data do documento (vigência do cadastro)
 * @param {string}  [p.uf]            UF (o cadastro pode ser por UF)
 * @param {boolean} [p.ehServico]     A170: serviço tomado (sem NCM)
 * @returns {{cst:string, natBcCred:string|null, fonte:'cumulativo'|'pessoa-fisica'|'cadastro-ncm'|'padrao', ncmCadastrado:string|null, motivo:string}}
 */
export function cstDaAquisicao({ regimeApuracao, codPart = '', ncm = '', catalogo = null, dataRef = '', uf = '', ehServico = false } = {}) {
    const naoCumulativo = regimeApuracao === '1' || regimeApuracao === '3';
    if (!naoCumulativo) {
        return { cst: '70', natBcCred: null, fonte: 'cumulativo', ncmCadastrado: null, motivo: 'regime cumulativo: não há crédito' };
    }
    if (ehPessoaFisica(codPart)) {
        return {
            cst: '70', natBcCred: null, fonte: 'pessoa-fisica', ncmCadastrado: null,
            motivo: 'fornecedor pessoa física: sem direito a crédito (Lei 10.637/02 e 10.833/03, art. 3º, § 3º, I)',
        };
    }
    if (!ehServico && Array.isArray(catalogo) && catalogo.length && so(ncm)) {
        const r = resolverParametrosNcm(ncm, catalogo, { uf, dataRef });
        if (r.achou && r.cstPisCofinsEntrada) {
            const cst = r.cstPisCofinsEntrada;
            const geraCredito = cstGeraCredito(cst);
            return {
                cst,
                natBcCred: geraCredito ? (r.natBcCred || NAT_BC_CRED_PADRAO_MERCADORIA) : null,
                fonte: 'cadastro-ncm', ncmCadastrado: r.ncmCadastrado,
                motivo: `cadastro NCM ${r.ncmCadastrado}: CST ${cst}${geraCredito && !r.natBcCred ? ' (natureza 01 por padrão)' : ''}`,
            };
        }
    }
    return {
        cst: '50',
        natBcCred: ehServico ? NAT_BC_CRED_PADRAO_SERVICO : NAT_BC_CRED_PADRAO_MERCADORIA,
        fonte: 'padrao', ncmCadastrado: null,
        motivo: ehServico
            ? 'padrão do não-cumulativo: serviço tomado com crédito (natureza 03) — cadastro por empresa ainda não existe'
            : 'padrão do não-cumulativo: 50 com natureza 01 — NCM sem cadastro de CST de entrada',
    };
}

/**
 * Acumula as decisões de um arquivo para o aviso da geração: quantos itens e
 * quanto por fonte, e os NCM que caíram no PADRÃO (com valor) — é essa lista
 * que vira cadastro. PURO; `registrar` item a item, `avisos` no fim.
 */
export function criarResumoDaCstDeEntrada() {
    const porFonte = {};
    const ncmNoPadrao = {};
    const cadastrados = {};
    return {
        registrar({ decisao, valor = 0, ncm = '', descricao = '' }) {
            const f = porFonte[decisao.fonte] || (porFonte[decisao.fonte] = { itens: 0, valor: 0 });
            f.itens += 1; f.valor += Number(valor) || 0;
            if (decisao.fonte === 'padrao' && !decisao.motivo.includes('serviço')) {
                const k = so(ncm) || '(sem NCM)';
                const n = ncmNoPadrao[k] || (ncmNoPadrao[k] = { itens: 0, valor: 0, descricao: descricao || '' });
                n.itens += 1; n.valor += Number(valor) || 0;
            }
            if (decisao.fonte === 'cadastro-ncm') {
                const k = `${decisao.ncmCadastrado}→${decisao.cst}`;
                const n = cadastrados[k] || (cadastrados[k] = { itens: 0, valor: 0 });
                n.itens += 1; n.valor += Number(valor) || 0;
            }
        },
        avisos() {
            const out = [];
            const pf = porFonte['pessoa-fisica'];
            if (pf) {
                out.push(`[crédito] ${pf.itens} item(ns) de fornecedor PESSOA FÍSICA (${pf.valor.toFixed(2)}) saíram com CST 70, sem crédito — `
                    + 'Lei 10.637/02 e 10.833/03, art. 3º, § 3º, I. O PVA recusa CST 50–56 com participante pessoa física.');
            }
            const cad = Object.entries(cadastrados);
            if (cad.length) {
                out.push(`[crédito] cadastro NCM aplicado na entrada: ${cad.map(([k, v]) => `${k} (${v.itens} item(ns), ${v.valor.toFixed(2)})`).join(' · ')}.`);
            }
            const pad = Object.entries(ncmNoPadrao).sort((a, b) => b[1].valor - a[1].valor);
            if (pad.length) {
                const total = pad.reduce((s, [, v]) => s + v.valor, 0);
                const lista = pad.slice(0, 12).map(([k, v]) => `${k}${v.descricao ? ` ${String(v.descricao).slice(0, 24)}` : ''} (${v.itens}, ${v.valor.toFixed(2)})`).join(' · ');
                out.push(`[crédito] ${pad.length} NCM sem cadastro de CST de entrada saíram no PADRÃO 50 (com crédito, natureza 01), `
                    + `total ${total.toFixed(2)}: ${lista}${pad.length > 12 ? ` e mais ${pad.length - 12}` : ''}. `
                    + 'Se a compra é a alíquota zero (73), ST (75) ou sem direito a crédito (70), cadastre em Central de XMLs → XMLs → '
                    + 'Cadastro NCM → "CST PIS/COFINS na entrada" — o app não decide isso sozinho.');
            }
            return out;
        },
        porFonte,
    };
}
