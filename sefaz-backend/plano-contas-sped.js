/**
 * plano-contas-sped.js — o PLANO DE CONTAS mínimo do SPED (registro 0500) e o
 * COD_CTA de cada item (C170 campo 37, A170 campo 17, F100). PURO.
 *
 * ELS 08/2026, PVA de 28/09: **1259 recusas** "O campo é de preenchimento
 * obrigatório. Cadastre e/ou selecione previamente a conta contábil
 * analítica representativa da operação, no registro 0500" — 1249 C170 + 6
 * A170 sem COD_CTA. O Guia 1.35 (C170 campo 37): *"para os fatos geradores a
 * partir de novembro de 2017 o campo COD_CTA é de preenchimento obrigatório,
 * exceto se a pessoa jurídica estiver dispensada de escrituração contábil"* —
 * a ELS é Lucro Real, tem ECD, o campo é obrigatório.
 *
 * O app só tinha UMA conta cadastrável (a da receita financeira, para o F100),
 * e Paulo pôs nela a conta de VENDAS (3.1.1.01.0002). Em vez de "mais
 * receitas financeiras", o cadastro passa a ser uma LISTA de contas com USO:
 * o gerador escolhe a conta pelo lado do documento e pelo tipo do item, emite
 * um 0500 por conta declarada e preenche o COD_CTA. Sem conta para um uso, o
 * campo continua vazio e o aviso diz QUAL uso falta e quantos itens ficaram
 * sem — nunca conta inventada (Guia: "deve ser a conta credora ou devedora
 * principal"; qual é, só o plano de contas da empresa sabe).
 *
 * COD_NAT_CC (Guia, 0500 campo 03): 01 ativo · 02 passivo · 03 patrimônio
 * líquido · 04 resultado · 05 compensação · 09 outras. IND_CTA sempre `A`
 * (analítica) — só a analítica pode ser referenciada por um lançamento.
 */

export const USOS_PLANO_CONTAS = Object.freeze({
    'receita-vendas': Object.freeze({ rotulo: 'Receita de vendas de mercadorias', onde: 'C170 de SAÍDA (NF-e/NFC-e)', naturezaPadrao: '04' }),
    'receita-servicos': Object.freeze({ rotulo: 'Receita de prestação de serviços', onde: 'A170 de SAÍDA (NFS-e emitida)', naturezaPadrao: '04' }),
    'compras': Object.freeze({ rotulo: 'Compras de mercadorias / estoque', onde: 'C170 de ENTRADA (NF-e de compra)', naturezaPadrao: '01' }),
    'servicos-tomados': Object.freeze({ rotulo: 'Serviços tomados (despesa)', onde: 'A170 de ENTRADA (NFS-e tomada)', naturezaPadrao: '04' }),
    'receita-financeira': Object.freeze({ rotulo: 'Receita financeira (aplicações)', onde: 'F100 (rendimentos da ficha)', naturezaPadrao: '04' }),
});
export const NATUREZAS_CONTA = Object.freeze({
    '01': 'Contas de ativo', '02': 'Contas de passivo', '03': 'Patrimônio líquido',
    '04': 'Contas de resultado', '05': 'Contas de compensação', '09': 'Outras',
});

const s = (v) => String(v ?? '').trim();

/**
 * Confere a lista vinda da tela. Devolve as contas NORMALIZADAS e os erros
 * DITOS (a rota recusa com eles). Linha totalmente vazia cai fora.
 * @returns {{ok:boolean, erros:string[], contas:Array<{codigo:string,nome:string,nivel:string,natureza:string,uso:string}>}}
 */
export function conferirPlanoContasSped(lista) {
    const erros = [];
    const contas = [];
    if (lista == null) return { ok: true, erros, contas };
    if (!Array.isArray(lista)) return { ok: false, erros: ['planoContasSped precisa ser uma lista de contas.'], contas };
    const usosVistos = new Set();
    lista.forEach((c, i) => {
        const codigo = s(c?.codigo); const nome = s(c?.nome); const nivel = s(c?.nivel);
        const natureza = s(c?.natureza); const uso = s(c?.uso);
        if (!codigo && !nome && !nivel && !uso) return; // linha vazia
        const n = i + 1;
        if (!codigo) erros.push(`Conta ${n}: informe o CÓDIGO da conta (COD_CTA, até 60 caracteres).`);
        if (codigo.length > 60) erros.push(`Conta ${n}: código com ${codigo.length} caracteres; o 0500 aceita até 60.`);
        if (!nome) erros.push(`Conta ${n} (${codigo || '?'}): informe o NOME da conta (NOME_CTA).`);
        if (nome.length > 60) erros.push(`Conta ${n} (${codigo}): nome com ${nome.length} caracteres; o 0500 aceita até 60.`);
        if (!/^\d{1,2}$/.test(nivel)) erros.push(`Conta ${n} (${codigo || '?'}): informe o NÍVEL no plano de contas (1 a 99).`);
        if (!USOS_PLANO_CONTAS[uso]) erros.push(`Conta ${n} (${codigo || '?'}): escolha o USO (${Object.keys(USOS_PLANO_CONTAS).join(', ')}).`);
        else if (usosVistos.has(uso)) erros.push(`Conta ${n} (${codigo || '?'}): o uso "${uso}" já tem conta — é uma conta por uso.`);
        else usosVistos.add(uso);
        const nat = natureza || USOS_PLANO_CONTAS[uso]?.naturezaPadrao || '';
        if (!NATUREZAS_CONTA[nat]) erros.push(`Conta ${n} (${codigo || '?'}): natureza "${natureza}" não está no leiaute (01 ativo, 02 passivo, 03 PL, 04 resultado, 05 compensação, 09 outras).`);
        contas.push({ codigo, nome, nivel, natureza: nat, uso });
    });
    return { ok: erros.length === 0, erros, contas };
}

/** A conta de um USO, já conferida — ou null (e o COD_CTA fica vazio, dito). */
export function contaDoUso(plano, uso) {
    const r = conferirPlanoContasSped(plano);
    return r.contas.find((c) => c.uso === uso) || null;
}

/**
 * As linhas 0500 do plano (uma por CÓDIGO, deduplicadas), na forma que o
 * bloco 0 escreve. A conta LEGADA da receita financeira (os três campos
 * antigos) entra como uso 'receita-financeira' quando o plano não a traz.
 * @returns {Array<{dtAlt:string,codNatCc:string,indCta:'A',nivel:string,codCta:string,nomeCta:string,uso:string}>}
 */
export function contas0500DoPlano({ plano, ano, legadoReceitaFinanceira = null } = {}) {
    const r = conferirPlanoContasSped(plano);
    const a = String(ano || '').replace(/\D/g, '').slice(0, 4);
    const dtAlt = a ? `0101${a}` : '';
    const lista = [...r.contas];
    const leg = legadoReceitaFinanceira;
    if (leg?.codigo && leg?.nome && leg?.nivel && !lista.some((c) => c.uso === 'receita-financeira')) {
        lista.push({ codigo: s(leg.codigo), nome: s(leg.nome), nivel: s(leg.nivel), natureza: '04', uso: 'receita-financeira' });
    }
    const vistos = new Set();
    const out = [];
    for (const c of lista) {
        if (vistos.has(c.codigo)) continue;
        vistos.add(c.codigo);
        out.push({ dtAlt, codNatCc: c.natureza, indCta: 'A', nivel: c.nivel, codCta: c.codigo, nomeCta: c.nome, uso: c.uso });
    }
    return out;
}

/**
 * O SELETOR de conta de um bloco: confere o plano UMA vez, devolve o COD_CTA
 * de cada uso e conta o que ficou sem — `aviso()` no fim (ou null).
 */
export function criarSeletorDeConta(plano) {
    const contas = conferirPlanoContasSped(plano).contas;
    const contagem = criarContagemSemConta();
    return {
        codCta(uso) {
            const c = contas.find((x) => x.uso === uso);
            if (!c) contagem.registrar(uso);
            return c ? c.codigo : '';
        },
        aviso: () => contagem.aviso(),
        porUso: contagem.porUso,
    };
}

/**
 * Contagem do que ficou SEM conta, por uso — vira o aviso da geração.
 * `registrar(uso)` a cada item sem COD_CTA; `aviso()` no fim (ou null).
 */
export function criarContagemSemConta() {
    const porUso = {};
    return {
        registrar(uso) { porUso[uso] = (porUso[uso] || 0) + 1; },
        aviso() {
            const usos = Object.keys(porUso);
            if (!usos.length) return null;
            const partes = usos.map((u) => `${porUso[u]} item(ns) em ${USOS_PLANO_CONTAS[u]?.onde || u} (uso "${USOS_PLANO_CONTAS[u]?.rotulo || u}")`);
            return `[0500] COD_CTA vazio em ${partes.join(' · ')}. Desde 11/2017 o campo é obrigatório para quem tem ECD `
                + '(Lucro Real/Presumido com escrituração contábil) — o PVA recusa cada item: "cadastre e/ou selecione previamente a '
                + 'conta contábil analítica no registro 0500". Cadastre em Empresas → Dados Fiscais → "Plano de contas do SPED (0500)", '
                + 'uma conta por uso (código, nome, nível e natureza do plano de contas da empresa). O app não inventa conta.';
        },
        porUso,
    };
}
