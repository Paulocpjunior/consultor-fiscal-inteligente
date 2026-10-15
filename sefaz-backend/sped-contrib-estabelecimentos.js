// ============================================================================
// sefaz-backend/sped-contrib-estabelecimentos.js  (PURO — testável)
// ----------------------------------------------------------------------------
// 🏢 EFD-CONTRIBUIÇÕES CENTRALIZADA NA MATRIZ, COM AS FILIAIS (15/10).
//
// Paulo, 0181 · SBE EDIÇÕES: *"EFD CONTRIBUIÇÕES é entregue pela MATRIZ,
// precisa vincular a filial"*. O PIS/COFINS é apurado pela pessoa jurídica
// (CNPJ raiz) e a escrituração é UMA, da matriz — mas cada estabelecimento
// tem o seu 0140 (com os 0150/0190/0200 dele) e o seu C010/A010/D010 com os
// documentos dele. O arquivo real dele (07/2026) traz três 0140 — matriz
// 0001-06 (DF), filiais 0003-78 (DF) e 0004-59 (SP) — e dois C010, cada um com
// as notas do seu CNPJ; o bloco M sai UM, consolidado.
//
// A régua (alerta, nunca contorno):
//  · quem diz QUAIS filiais entram é a pessoa, na matriz — o app não deduz
//    vínculo pela raiz (a tela só SUGERE as cadastradas da mesma raiz);
//  · filial só se vincula da MESMA raiz, cadastrada no CFI com UF e município
//    (o 0140 dela sai do cadastro DELA — sem eles, o vínculo é recusado, dito);
//  · o documento vai para o estabelecimento do CNPJ que ele carrega
//    (`empresaCnpj`), nunca para "a matriz" por padrão quando o CNPJ é de uma
//    filial vinculada.
// ============================================================================

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '');
export const raizDoCnpj = (v) => soDigitos(v).slice(0, 8);

/**
 * Confere a lista de filiais que a matriz quer na escrituração.
 *
 * @param {{matrizCnpj: string, filiais: string[], cadastradas: Array<{cnpj?: string, nome?: string,
 *   dadosFiscais?: {uf?: string, codMunIBGE?: string}, _deleted?: boolean, _merged_into?: string}>}} p
 * @returns {{ok: true, filiais: string[]} | {ok: false, erros: string[]}}
 */
export function conferirFiliaisContrib({ matrizCnpj, filiais, cadastradas }) {
    const matriz = soDigitos(matrizCnpj);
    const erros = [];
    const vistas = new Set();
    const vivas = (cadastradas || []).filter((e) => e && !e._deleted && !e._merged_into);
    for (const bruto of Array.isArray(filiais) ? filiais : []) {
        const cnpj = soDigitos(bruto);
        if (cnpj.length !== 14) { erros.push(`"${bruto}" não é um CNPJ de 14 dígitos.`); continue; }
        if (cnpj === matriz) { erros.push(`${cnpj} é a própria matriz.`); continue; }
        if (raizDoCnpj(cnpj) !== raizDoCnpj(matriz)) {
            erros.push(`${cnpj} é de outra raiz (${raizDoCnpj(cnpj)}) — só filial da mesma pessoa jurídica (${raizDoCnpj(matriz)}) entra na escrituração da matriz.`);
            continue;
        }
        if (vistas.has(cnpj)) { erros.push(`${cnpj} informada duas vezes.`); continue; }
        vistas.add(cnpj);
        const cad = vivas.find((e) => soDigitos(e.cnpj) === cnpj);
        if (!cad) {
            erros.push(`${cnpj} não está cadastrada no CFI — cadastre a filial (Empresas) com UF e município antes de vincular: o 0140 dela sai do cadastro dela.`);
            continue;
        }
        const df = cad.dadosFiscais || {};
        if (!df.uf || !df.codMunIBGE) {
            erros.push(`${cnpj} (${cad.nome || 'sem nome'}) está sem UF ou município nos Dados Fiscais — preencha no cadastro da filial antes de vincular.`);
        }
    }
    if (erros.length) return { ok: false, erros };
    return { ok: true, filiais: [...vistas] };
}

/**
 * O estabelecimento de um documento: o CNPJ que ELE carrega (`empresaCnpj`),
 * quando é um dos estabelecimentos do arquivo; senão, o da empresa sob a qual
 * o documento foi lido (`cnpjDaCarga`).
 */
export function estabelecimentoDoDoc(doc, cnpjsDoArquivo, cnpjDaCarga) {
    const proprio = soDigitos(doc?.empresaCnpj);
    if (proprio && cnpjsDoArquivo.includes(proprio)) return proprio;
    return soDigitos(cnpjDaCarga);
}

/**
 * Reparte os documentos pelos estabelecimentos, na ordem dada (matriz
 * primeiro). Cada documento ganha `_cnpjEstab` — quem precisa saber o "lado
 * nosso" de um documento consolidado (o bloco M) lê dali.
 *
 * @param {Array<{doc: object, cnpjDaCarga: string}>} carregados
 * @param {string[]} cnpjsDoArquivo  matriz primeiro
 * @returns {Map<string, object[]>}
 */
export function repartirPorEstabelecimento(carregados, cnpjsDoArquivo) {
    const porEstab = new Map(cnpjsDoArquivo.map((c) => [c, []]));
    for (const { doc, cnpjDaCarga } of carregados) {
        const cnpj = estabelecimentoDoDoc(doc, cnpjsDoArquivo, cnpjDaCarga);
        const lista = porEstab.get(cnpj) || porEstab.get(cnpjsDoArquivo[0]);
        doc._cnpjEstab = porEstab.has(cnpj) ? cnpj : cnpjsDoArquivo[0];
        lista.push(doc);
    }
    return porEstab;
}

/**
 * A identidade do estabelecimento para os registros dele: o cadastro da
 * MATRIZ (regime, plano de contas, parâmetros — a escrituração é uma só) com
 * nome, CNPJ, UF, município, IE, IM e SUFRAMA do PRÓPRIO estabelecimento.
 */
export function identidadeDoEstabelecimento(matriz, filial) {
    if (!filial) return matriz;
    const dfM = matriz?.dadosFiscais || {};
    const dfF = filial?.dadosFiscais || {};
    return {
        ...matriz,
        cnpj: filial.cnpj,
        nome: filial.nome || matriz?.nome,
        ccmSp: filial.ccmSp,
        dadosFiscais: {
            ...dfM,
            uf: dfF.uf,
            codMunIBGE: dfF.codMunIBGE,
            inscricaoEstadual: dfF.inscricaoEstadual,
            ccmSp: dfF.ccmSp,
            codSuframa: dfF.codSuframa,
        },
    };
}

/**
 * Um bloco (A, C ou D) com um "X010" POR ESTABELECIMENTO: roda o gerador do
 * bloco para cada um (com os documentos dele) e junta os corpos sob um único
 * X001/X990. Abertura e encerramento de cada rodada são descartados; o X001
 * diz "com dados" quando algum estabelecimento teve registro.
 *
 * @param {string} bloco  'A' | 'C' | 'D'
 * @param {Array<object>} visoes  um `dados` por estabelecimento
 * @param {(dados: object) => string[]} gerar
 * @param {(campos: Array<string|number>) => string} buildLine
 */
export function blocoPorEstabelecimento(bloco, visoes, gerar, buildLine) {
    const abre = `|${bloco}001|`;
    const fecha = `|${bloco}990|`;
    const corpo = [];
    for (const v of visoes) {
        for (const l of gerar(v)) {
            if (l.startsWith(abre) || l.startsWith(fecha)) continue;
            corpo.push(l);
        }
    }
    if (!corpo.length) return [buildLine([`${bloco}001`, '1']), buildLine([`${bloco}990`, '2'])];
    return [buildLine([`${bloco}001`, '0']), ...corpo, buildLine([`${bloco}990`, corpo.length + 2])];
}

/**
 * O `dados` de cada estabelecimento (15/10): a escrituração inteira da matriz
 * com a identidade, os documentos e os cadastros DELE. Sem filial vinculada,
 * devolve o próprio `dados` — o arquivo sai exatamente como antes.
 */
export function visoesPorEstabelecimento(dados) {
    const ests = Array.isArray(dados?.estabelecimentos) ? dados.estabelecimentos : [];
    if (!ests.length) return [dados];
    return ests.map((e) => ({
        ...dados, empresa: e.empresa, notas: e.notas,
        participantes: e.participantes, itens: e.itens, unidades: e.unidades,
    }));
}
