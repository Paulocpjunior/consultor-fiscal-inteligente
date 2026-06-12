// ============================================================================
// sped-fiscal-editor-rebuilder.js
//
// Reconstroi um SPED Fiscal valido a partir do parser-editor + edicoes do
// usuario. PRESERVA round-trip 100% (linhas nao editadas saem identicas) e
// RECALCULA os totalizadores do Bloco 9 (Guia Pratico EFD ICMS/IPI 3.2.2):
//
//   9900: ocorrencias de cada tipo de registro (1 linha por tipo)
//   9990: total de linhas do Bloco 9 (inclui ele proprio + 9999)
//   9999: total de linhas do arquivo inteiro
//
// Sem o recalculo, o PVA da Receita rejeita o arquivo com erro de
// integridade ("contagem incompativel com registros gerados").
//
// Modulo PURO — testavel.
// ============================================================================

/**
 * @typedef {Object} Edicao
 * @property {number} idx        indice (do parser) da linha a editar
 * @property {number=} insertAfterIdx indice depois do qual inserir nova linha
 * @property {string[]} campos   campos NOVOS — 1-based: campos[0]=tipo (deve bater
 *                               com o tipo do registro original). NUNCA muda o tipo.
 */

/**
 * @param {Object} parsed     resultado do parseSpedFiscalParaEdicao
 * @param {Edicao[]} edicoes  lista de edicoes; idx que nao aparecem ficam intactos
 * @returns {string}          conteudo do SPED reconstruido (CRLF entre linhas)
 */
export function reconstruirSped(parsed, edicoes = []) {
    if (!parsed || !Array.isArray(parsed.linhas)) {
        throw new Error('parsed invalido: faltam linhas');
    }
    // Indexa edicoes por idx pra lookup O(1) e separa insercoes controladas
    // (usadas para criar C190 faltante antes de recalcular o Bloco 9).
    const porIdx = new Map();
    const insercoesPorAfterIdx = new Map();
    for (const e of edicoes) {
        if (!Array.isArray(e.campos)) throw new Error(`edicao idx=${e?.idx}: campos deve ser array`);
        if (typeof e?.insertAfterIdx === 'number') {
            const tipo = e.campos[0];
            if (!tipo) throw new Error(`insercao after=${e.insertAfterIdx}: tipo ausente`);
            const lista = insercoesPorAfterIdx.get(e.insertAfterIdx) || [];
            lista.push({ idx: -1, tipo, campos: e.campos });
            insercoesPorAfterIdx.set(e.insertAfterIdx, lista);
            continue;
        }
        if (typeof e?.idx !== 'number') continue;
        porIdx.set(e.idx, e.campos);
    }

    // 1) Aplica edicoes e insercoes (preservando tipo original nas edicoes).
    const linhas = [];
    for (const l of parsed.linhas) {
        const ed = porIdx.get(l.idx);
        if (!ed) {
            linhas.push({ ...l });
        } else {
            // Sanity: tipo no campo 0 nao pode mudar (estrutura SPED amarra
            // por tipo de registro — trocar tipo invalida hierarquia).
            if (ed[0] && ed[0] !== l.tipo) {
                throw new Error(`edicao idx=${l.idx}: nao pode trocar tipo ${l.tipo} -> ${ed[0]}`);
            }
            const campos = [l.tipo, ...ed.slice(1)];
            linhas.push({ idx: l.idx, tipo: l.tipo, campos });
        }
        const insercoes = insercoesPorAfterIdx.get(l.idx);
        if (insercoes) linhas.push(...insercoes);
    }

    // 2) REMOVE registros antigos do Bloco 9 — vamos recriar (9001, 9900*, 9990, 9999)
    const linhasSemBloco9 = linhas.filter(l =>
        l.tipo !== '9001' && l.tipo !== '9900' && l.tipo !== '9990' && l.tipo !== '9999'
    );

    // 3) Recalcula 9900 (ocorrencias por tipo) — exclui ele mesmo + 9990 + 9999
    //    pois esses sao adicionados depois.
    const ocorrencias = {};
    for (const l of linhasSemBloco9) {
        ocorrencias[l.tipo] = (ocorrencias[l.tipo] || 0) + 1;
    }
    // Adiciona registros que VAMOS criar (9001 + N x 9900 + 9990 + 9999)
    // ao contador — o 9900 conta a si mesmo tambem.
    const tipos9900 = Object.keys(ocorrencias).sort(); // ordem alfabetica (canonica)
    ocorrencias['9001'] = 1;
    ocorrencias['9990'] = 1;
    ocorrencias['9999'] = 1;
    // Quantidade de 9900: um por tipo (inclusive os meta acima) + 1 pra si mesmo
    const tiposComBloco9 = [...tipos9900, '9001', '9900', '9990', '9999'].sort();
    ocorrencias['9900'] = tiposComBloco9.length;

    // 4) Monta linhas do Bloco 9
    const linhas9 = [];
    linhas9.push({ idx: -1, tipo: '9001', campos: ['9001', '0'] }); // IND_MOV=0 (com dados)
    for (const t of tiposComBloco9) {
        linhas9.push({ idx: -1, tipo: '9900', campos: ['9900', t, String(ocorrencias[t])] });
    }
    // 9990 = total de linhas do Bloco 9 inteiro (= linhas9.length + 9990 + 9999)
    const qtdBloco9 = linhas9.length + 2; // +9990 +9999
    linhas9.push({ idx: -1, tipo: '9990', campos: ['9990', String(qtdBloco9)] });

    // 5) 9999 = total de linhas do arquivo
    const totalLinhas = linhasSemBloco9.length + qtdBloco9;
    linhas9.push({ idx: -1, tipo: '9999', campos: ['9999', String(totalLinhas)] });

    // 6) Renderiza: |campos|\r\n
    const todasLinhas = [...linhasSemBloco9, ...linhas9];
    const out = todasLinhas
        .map(l => '|' + l.campos.join('|') + '|')
        .join('\r\n');
    return out + '\r\n';
}
