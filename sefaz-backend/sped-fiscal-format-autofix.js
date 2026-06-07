// ============================================================================
// sped-fiscal-format-autofix.js  (PURO — testavel)
//
// AUTO-CORRECAO de FORMATO de campos do SPED Fiscal — coisas que o PVA da
// Receita rejeita por motivo puramente sintatico (formato), nao por decisao
// fiscal. Cobre o problema #1 de SPED rejeitado: "campo com formato
// invalido" / "caracteres nao permitidos".
//
// PRINCIPIO: so corrige o que e NORMALIZACAO de formato. Nao mexe em CFOP,
// CST, NCM (numero diferente), nem em valores semanticos. Cada ajuste gera
// um aviso com de/para legivel.
//
// Regras (conservadoras):
//
//   F1 TRIM_CODIGO       — campos de codigo (NCM, CFOP, CST_ICMS, COD_ITEM)
//                          com espacos em branco nas pontas ou no meio.
//                          PVA exige sem espacos. "1234 5678" → "12345678".
//                          NAO altera digitos.
//
//   F2 DECIMAL_PONTO     — valores monetarios com ponto decimal em vez de
//                          virgula. "1956.03" → "1956,03". Manual 3.2.2
//                          item 2: "separador decimal: virgula".
//                          NAO altera milhar (SPED nao usa separador de
//                          milhar — se vier "1.956,03", isso e formato
//                          ABNT, o ponto sai virando "195603,00"? NAO.
//                          So mexe se houver UM unico ponto e UMA possicao
//                          consistente com decimal: \d+\.\d{1,2}$.
//
//   F3 COD_ITEM_PAD      — COD_ITEM no 0200 com tamanho diferente do COD_ITEM
//                          referenciado em C170. Se o C170 referencia
//                          "0001" e o 0200 tem "1", deve ser "0001" (PVA
//                          falha integridade referencial). Conservador:
//                          NAO normaliza ainda — fica pro proximo PR (precisa
//                          decidir qual virou padrao).
//
// Layout dos campos por registro (apenas onde mexemos):
//   0200: [0]='0200' [1]=COD_ITEM [7]=COD_NCM
//   C170: [0]='C170' [1]=NUM_ITEM [2]=COD_ITEM [6]=VL_ITEM [9]=CST_ICMS
//         [10]=CFOP [12]=VL_BC_ICMS [13]=ALIQ_ICMS [14]=VL_ICMS
//         [15]=VL_BC_ICMS_ST [16]=ALIQ_ST [17]=VL_ICMS_ST [18]=IND_APUR
//         [19]=CST_IPI [20]=COD_ENQ [21]=VL_BC_IPI [22]=ALIQ_IPI [23]=VL_IPI
//         [24]=CST_PIS [25]=VL_BC_PIS [26]=ALIQ_PIS_PERC [27]=QTD_BC_PIS
//         [28]=ALIQ_PIS_RS [29]=VL_PIS [30]=CST_COFINS [31]=VL_BC_COFINS
//         [32]=ALIQ_COFINS_PERC [33]=QTD_BC_COFINS [34]=ALIQ_COFINS_RS
//         [35]=VL_COFINS
//   C190: [0]='C190' [1]=CST_ICMS [2]=CFOP [3]=ALIQ_ICMS [4]=VL_OPR
//         [5]=VL_BC_ICMS [6]=VL_ICMS [7]=VL_BC_ICMS_ST [8]=VL_ICMS_ST [9]=VL_RED_BC
// ============================================================================

// Campos de codigo por registro — indice 0-based no array `campos` (onde [0]=tipo).
const CAMPOS_CODIGO = {
    '0200': [1, 7],                          // COD_ITEM, COD_NCM
    'C170': [2, 9, 10, 19, 24, 30],          // COD_ITEM, CST_ICMS, CFOP, CST_IPI, CST_PIS, CST_COFINS
    'C190': [1, 2],                          // CST_ICMS, CFOP
    '0150': [1],                             // COD_PART
    'C100': [9],                             // COD_SIT (situacao)
};

// Campos de valor monetario por registro. SPED exige virgula decimal.
const CAMPOS_VALOR = {
    'C170': [6, 12, 14, 15, 17, 21, 23, 25, 29, 31, 35],
    'C190': [4, 5, 6, 7, 8, 9],
    'E110': [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    'E111': [4],                             // VL_AJ_APUR
    'E116': [3, 5],                          // VL_OR, VL_OR_DAR
    'H010': [3, 4, 5],                       // QTD, VL_UNIT, VL_ITEM
    'H020': [2, 3, 4],                       // VL_BC_ICMS, ALIQ, VL_ICMS
    'M210': [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    'M610': [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
};

/**
 * Normaliza valor de campo de codigo: tira espacos internos e nas pontas.
 * Retorna {novo, mudou}.
 */
function normalizarCodigo(orig) {
    if (orig == null) return { novo: orig, mudou: false };
    const semEspacos = String(orig).replace(/\s+/g, '');
    return { novo: semEspacos, mudou: semEspacos !== String(orig) };
}

/**
 * Normaliza valor monetario: ponto decimal vira virgula, SE for o padrao
 * "inteiros.decimais1ou2". Nao mexe em "1.234,56" (separador de milhar) nem
 * em valores ja com virgula.
 */
function normalizarValor(orig) {
    if (orig == null) return { novo: orig, mudou: false };
    const s = String(orig).trim();
    if (s === '') return { novo: s, mudou: s !== String(orig) };
    // Ja esta no formato SPED (com virgula ou sem decimal).
    if (s.includes(',')) return { novo: s, mudou: false };
    // Apenas digitos — sem decimal. OK.
    if (/^-?\d+$/.test(s)) return { novo: s, mudou: false };
    // Padrao "inteiros.decimais" com 1 ou 2 casas → virgula.
    if (/^-?\d+\.\d{1,2}$/.test(s)) {
        const novo = s.replace('.', ',');
        return { novo, mudou: true };
    }
    // Qualquer outro formato (com 'e', com milhar, etc.) — nao mexe.
    return { novo: s, mudou: s !== String(orig) };
}

/**
 * Nome simbolico do campo pro aviso. Indices nao listados saem como "campo[N]".
 */
const NOME_CAMPO = {
    '0200': { 1: 'COD_ITEM', 7: 'COD_NCM' },
    'C170': { 2: 'COD_ITEM', 6: 'VL_ITEM', 9: 'CST_ICMS', 10: 'CFOP', 12: 'VL_BC_ICMS', 14: 'VL_ICMS', 15: 'VL_BC_ICMS_ST', 17: 'VL_ICMS_ST', 19: 'CST_IPI', 21: 'VL_BC_IPI', 23: 'VL_IPI', 24: 'CST_PIS', 25: 'VL_BC_PIS', 29: 'VL_PIS', 30: 'CST_COFINS', 31: 'VL_BC_COFINS', 35: 'VL_COFINS' },
    'C190': { 1: 'CST_ICMS', 2: 'CFOP', 4: 'VL_OPR', 5: 'VL_BC_ICMS', 6: 'VL_ICMS', 7: 'VL_BC_ICMS_ST', 8: 'VL_ICMS_ST', 9: 'VL_RED_BC' },
    'E110': { 2: 'VL_TOT_DEBITOS', 3: 'VL_AJ_DEBITOS', 4: 'VL_TOT_AJ_DEBITOS', 5: 'VL_ESTORNOS_CRED', 6: 'VL_TOT_CREDITOS', 7: 'VL_AJ_CREDITOS', 8: 'VL_TOT_AJ_CREDITOS', 9: 'VL_ESTORNOS_DEB', 10: 'VL_SLD_CREDOR_ANT', 11: 'VL_SLD_APURADO', 12: 'VL_TOT_DED', 13: 'VL_ICMS_RECOLHER', 14: 'VL_SLD_CREDOR_TRANSPORTAR', 15: 'DEB_ESP' },
};

function nomeCampo(tipo, i) {
    return (NOME_CAMPO[tipo] && NOME_CAMPO[tipo][i]) || `campo[${i}]`;
}

/**
 * @param {{ tipoSped?:string, linhas: Array<{idx:number, tipo:string, campos:string[]}> }} parsed
 * @returns {{
 *   edicoes: Array<{idx:number, campos:string[]}>,
 *   ajustes: Array<{registro:string, idx:number, campo:string, regra:'TRIM_CODIGO'|'DECIMAL_PONTO', de:string, para:string, mensagem:string}>,
 *   resumo: { linhasAjustadas:number, camposAjustados:number, porRegra:Record<string,number> }
 * }}
 */
export function corrigirFormato(parsed) {
    const out = {
        edicoes: [],
        ajustes: [],
        resumo: { linhasAjustadas: 0, camposAjustados: 0, porRegra: {} },
    };
    if (!parsed || !Array.isArray(parsed.linhas)) return out;
    if (parsed.tipoSped && parsed.tipoSped !== 'fiscal') return out;

    const bumpRegra = (r) => { out.resumo.porRegra[r] = (out.resumo.porRegra[r] || 0) + 1; };

    for (const l of parsed.linhas) {
        const codigos = CAMPOS_CODIGO[l.tipo] || [];
        const valores = CAMPOS_VALOR[l.tipo] || [];
        if (codigos.length === 0 && valores.length === 0) continue;

        const campos = l.campos.slice();
        const mudancas = [];

        for (const i of codigos) {
            if (i >= campos.length) continue;
            const { novo, mudou } = normalizarCodigo(campos[i]);
            if (mudou) {
                mudancas.push({ campo: nomeCampo(l.tipo, i), regra: 'TRIM_CODIGO', de: String(campos[i]), para: novo });
                campos[i] = novo;
            }
        }
        for (const i of valores) {
            if (i >= campos.length) continue;
            const { novo, mudou } = normalizarValor(campos[i]);
            if (mudou) {
                mudancas.push({ campo: nomeCampo(l.tipo, i), regra: 'DECIMAL_PONTO', de: String(campos[i]), para: novo });
                campos[i] = novo;
            }
        }

        if (mudancas.length > 0) {
            out.edicoes.push({ idx: l.idx, campos });
            out.resumo.linhasAjustadas++;
            for (const m of mudancas) {
                out.resumo.camposAjustados++;
                bumpRegra(m.regra);
                out.ajustes.push({
                    registro: l.tipo,
                    idx: l.idx,
                    campo: m.campo,
                    regra: m.regra,
                    de: m.de,
                    para: m.para,
                    mensagem: m.regra === 'TRIM_CODIGO'
                        ? `${l.tipo} ${m.campo}: "${m.de}" → "${m.para}" (espaços removidos).`
                        : `${l.tipo} ${m.campo}: "${m.de}" → "${m.para}" (ponto decimal → vírgula).`,
                });
            }
        }
    }

    return out;
}
