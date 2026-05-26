// ============================================================================
// sefaz-backend/sped-fiscal-validador.js
//
// Validador server-side do SPED Fiscal (EFD ICMS/IPI) — simula regras do PVA
// (Programa Validador e Assinador) antes do download.
//
// Funcao principal: validarSpedFiscal(txt)
//   Recebe o TXT completo e retorna { valido, erros, avisos }.
//
// Regras implementadas:
//   1. Estrutura geral (0000/9999, blocos X001/X990, contagens)
//   2. Registro 0000 (COD_VER, datas, CNPJ, UF)
//   3. C100 consistencia (C190 somas, COD_PART, cancelados sem filhos)
//   4. C170 consistencia (COD_ITEM, UNID, CFOP)
//   5. C190 consistencia (CST_ICMS, CFOP)
//   6. 0150 orfaos (referencia cruzada com C100/D100)
//   7. 0200 orfaos (referencia cruzada com C170)
//   8. Bloco 9 consistencia (9900 registros, contagens)
//
// Layout: Guia Pratico 3.2.2, Leiaute 020.
// ============================================================================

const UFS_VALIDAS = new Set([
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO',
    'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR',
    'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

// Blocos oficiais do EFD ICMS/IPI na ordem canonica
const BLOCOS_OFICIAIS = ['0', 'B', 'C', 'D', 'E', 'G', 'H', 'K', '1', '9'];

/**
 * Faz o parse de uma linha SPED em campos.
 * Formato: |REG|campo1|campo2|...|
 * Retorna array onde [0] = REG, [1] = campo1, etc.
 */
function parseLinha(linha) {
    // Remove \r\n trailing
    const limpa = linha.replace(/\r?\n$/, '');
    // Split por | e remove primeiro elemento vazio (antes do primeiro |)
    const parts = limpa.split('|');
    // parts[0] = '' (antes do primeiro |), parts[1] = REG, ..., parts[last] = '' (apos ultimo |)
    // Retorna a partir do indice 1, excluindo o ultimo vazio
    return parts.slice(1, parts.length - 1);
}

/**
 * Retorna o prefixo do bloco a partir de um tipo de registro.
 * Ex: 'C100' -> 'C', '0000' -> '0', '9999' -> '9', '1010' -> '1'
 */
function blocoDoRegistro(tipo) {
    if (!tipo || tipo.length < 1) return '';
    return tipo.charAt(0);
}

/**
 * Valida se uma string DDMMAAAA eh uma data valida.
 */
function isDataValida(ddmmaaaa) {
    if (!ddmmaaaa || ddmmaaaa.length !== 8) return false;
    const dia = parseInt(ddmmaaaa.substring(0, 2), 10);
    const mes = parseInt(ddmmaaaa.substring(2, 4), 10);
    const ano = parseInt(ddmmaaaa.substring(4, 8), 10);
    if (isNaN(dia) || isNaN(mes) || isNaN(ano)) return false;
    if (mes < 1 || mes > 12) return false;
    if (dia < 1 || dia > 31) return false;
    // Verifica com Date
    const d = new Date(ano, mes - 1, dia);
    return d.getFullYear() === ano && d.getMonth() === mes - 1 && d.getDate() === dia;
}

/**
 * Parse de valor SPED (virgula decimal) pra float.
 * Retorna 0 se vazio/invalido.
 */
function parseValorSped(s) {
    if (!s || s === '') return 0;
    return parseFloat(s.replace(',', '.')) || 0;
}

/**
 * Validador principal do SPED Fiscal.
 *
 * @param {string} txt - conteudo completo do arquivo .txt
 * @returns {{ valido: boolean, erros: string[], avisos: string[] }}
 */
export function validarSpedFiscal(txt) {
    const erros = [];
    const avisos = [];

    if (!txt || typeof txt !== 'string') {
        erros.push('Arquivo vazio ou invalido.');
        return { valido: false, erros, avisos };
    }

    // Faz split por \r\n (SPED usa CRLF). Remove linhas vazias finais.
    const linhasRaw = txt.split(/\r\n/).filter(l => l.length > 0);
    const totalLinhas = linhasRaw.length;

    if (totalLinhas === 0) {
        erros.push('Arquivo nao contem nenhuma linha.');
        return { valido: false, erros, avisos };
    }

    // Parse todas as linhas
    const registros = linhasRaw.map((linha, idx) => ({
        num: idx + 1,
        campos: parseLinha(linha + '\r\n'),
        tipo: parseLinha(linha + '\r\n')[0] || '',
        raw: linha,
    }));

    // ================================================================
    // 1. ESTRUTURA GERAL
    // ================================================================

    // 1a. Primeira linha deve ser 0000
    if (registros[0].tipo !== '0000') {
        erros.push(`Linha 1: primeira linha deve ser registro 0000, encontrado "${registros[0].tipo}".`);
    }

    // 1b. Exatamente um 0000 e um 9999
    const count0000 = registros.filter(r => r.tipo === '0000').length;
    const count9999 = registros.filter(r => r.tipo === '9999').length;
    if (count0000 !== 1) {
        erros.push(`Deve haver exatamente 1 registro 0000, encontrado ${count0000}.`);
    }
    if (count9999 !== 1) {
        erros.push(`Deve haver exatamente 1 registro 9999, encontrado ${count9999}.`);
    }

    // 1c. Ultima linha deve ser 9999
    if (registros[registros.length - 1].tipo !== '9999') {
        erros.push(`Ultima linha deve ser registro 9999, encontrado "${registros[registros.length - 1].tipo}".`);
    }

    // Agrupa registros por bloco pra validacoes de abertura/encerramento
    const registrosPorBloco = {};
    for (const reg of registros) {
        const bloco = blocoDoRegistro(reg.tipo);
        if (!registrosPorBloco[bloco]) registrosPorBloco[bloco] = [];
        registrosPorBloco[bloco].push(reg);
    }

    // 1d. Cada bloco deve ter X001 (abertura) e X990 (encerramento)
    for (const bloco of BLOCOS_OFICIAIS) {
        const regsBloco = registrosPorBloco[bloco] || [];
        if (regsBloco.length === 0) {
            // Bloco 0 e 9 sao obrigatorios
            if (bloco === '0' || bloco === '9') {
                erros.push(`Bloco ${bloco}: ausente (obrigatorio).`);
            }
            continue;
        }

        // Bloco 0 usa 0001/0990 mas tambem tem 0000 (que fica FORA do bloco logico).
        // Bloco 9 usa 9001/9990 mas tambem tem 9999.
        const siglaAbertura = `${bloco}001`;
        const siglaEncerramento = `${bloco}990`;

        // 0000 e 9999 sao registros especiais do bloco 0 e 9 respectivamente
        // mas X001 e X990 sao obrigatorios pra cada bloco
        const temAbertura = regsBloco.some(r => r.tipo === siglaAbertura);
        const temEncerramento = regsBloco.some(r => r.tipo === siglaEncerramento);

        if (!temAbertura) {
            erros.push(`Bloco ${bloco}: registro de abertura ${siglaAbertura} ausente.`);
        }
        if (!temEncerramento) {
            erros.push(`Bloco ${bloco}: registro de encerramento ${siglaEncerramento} ausente.`);
        }

        // 1e. X990 QTD_LIN deve bater com contagem real do bloco
        if (temEncerramento) {
            const regEnc = regsBloco.find(r => r.tipo === siglaEncerramento);
            const qtdDeclarada = parseInt(regEnc.campos[1] || '0', 10);

            // Contagem real: todas as linhas desse bloco
            // Bloco 0 inclui 0000 na contagem? Nao — 0000 eh registro de abertura do ARQUIVO,
            // nao do bloco 0. Segundo o Guia Pratico, 0990 conta: 0001 + 0005 + 0100 + 0150s + ... + 0990.
            // Mas na pratica, a contagem inclui 0000 tambem pois ele esta no bloco 0.
            // Bloco 9 inclui 9999? 9990 conta 9001 + 9900s + 9990. 9999 eh contado separado.
            let linhasDoBloco = regsBloco.length;

            // Pra Bloco 9, 9999 nao conta no 9990
            if (bloco === '9') {
                linhasDoBloco = regsBloco.filter(r => r.tipo !== '9999').length;
            }

            if (qtdDeclarada !== linhasDoBloco) {
                erros.push(
                    `Bloco ${bloco}: ${siglaEncerramento} declara QTD_LIN=${qtdDeclarada}, ` +
                    `mas contagem real eh ${linhasDoBloco}.`
                );
            }
        }
    }

    // 1f. 9999 QTD_LIN deve bater com total de linhas do arquivo
    const reg9999 = registros.find(r => r.tipo === '9999');
    if (reg9999) {
        const qtdDeclarada = parseInt(reg9999.campos[1] || '0', 10);
        if (qtdDeclarada !== totalLinhas) {
            erros.push(
                `9999: QTD_LIN declarada=${qtdDeclarada}, total real de linhas=${totalLinhas}.`
            );
        }
    }

    // ================================================================
    // 2. REGISTRO 0000
    // ================================================================

    const reg0000 = registros.find(r => r.tipo === '0000');
    if (reg0000) {
        const campos = reg0000.campos;

        // 2a. COD_VER deve ser '020'
        const codVer = campos[1] || '';
        if (codVer !== '020') {
            erros.push(`0000: COD_VER deve ser '020' (leiaute vigente), encontrado '${codVer}'.`);
        }

        // 2b. DT_INI e DT_FIN devem ser datas validas
        const dtIni = campos[3] || '';
        const dtFin = campos[4] || '';
        if (!isDataValida(dtIni)) {
            erros.push(`0000: DT_INI invalida '${dtIni}' (esperado DDMMAAAA).`);
        }
        if (!isDataValida(dtFin)) {
            erros.push(`0000: DT_FIN invalida '${dtFin}' (esperado DDMMAAAA).`);
        }

        // 2c. CNPJ deve ser 14 digitos
        const cnpj = campos[6] || '';
        if (!/^\d{14}$/.test(cnpj)) {
            erros.push(`0000: CNPJ deve ter 14 digitos, encontrado '${cnpj}'.`);
        }

        // 2d. UF deve ser codigo de estado valido
        const uf = campos[8] || '';
        if (!UFS_VALIDAS.has(uf.toUpperCase())) {
            erros.push(`0000: UF invalida '${uf}'.`);
        }
    }

    // ================================================================
    // Coletar tabelas de referencia (0150, 0190, 0200)
    // ================================================================

    // 0150 — Participantes cadastrados
    const participantes0150 = new Set();
    for (const reg of registros.filter(r => r.tipo === '0150')) {
        const codPart = reg.campos[1] || '';
        if (codPart) participantes0150.add(codPart);
    }

    // 0190 — Unidades cadastradas
    const unidades0190 = new Set();
    for (const reg of registros.filter(r => r.tipo === '0190')) {
        const unid = reg.campos[1] || '';
        if (unid) unidades0190.add(unid);
    }

    // 0200 — Itens cadastrados
    const itens0200 = new Set();
    for (const reg of registros.filter(r => r.tipo === '0200')) {
        const codItem = reg.campos[1] || '';
        if (codItem) itens0200.add(codItem);
    }

    // ================================================================
    // 3. C100 CONSISTENCIA
    // ================================================================

    // Agrupar C100 com seus C170s e C190s filhos
    // Estrutura: C100 eh seguido por seus C170s e C190s ate o proximo C100 ou C990
    const gruposC100 = [];
    let grupoAtual = null;
    const participantesReferenciadosC100 = new Set();

    for (const reg of registros) {
        if (reg.tipo === 'C100') {
            if (grupoAtual) gruposC100.push(grupoAtual);
            grupoAtual = { c100: reg, c170s: [], c190s: [] };
        } else if (reg.tipo === 'C170' && grupoAtual) {
            grupoAtual.c170s.push(reg);
        } else if (reg.tipo === 'C190' && grupoAtual) {
            grupoAtual.c190s.push(reg);
        } else if (reg.tipo !== 'C170' && reg.tipo !== 'C190' && grupoAtual) {
            gruposC100.push(grupoAtual);
            grupoAtual = null;
        }
    }
    if (grupoAtual) gruposC100.push(grupoAtual);

    for (const grupo of gruposC100) {
        const campos = grupo.c100.campos;
        const numDoc = campos[7] || '?';
        const codSit = campos[5] || '00';
        const codPart = campos[3] || '';
        const linhaRef = grupo.c100.num;

        // 3a. COD_PART deve existir em 0150
        if (codPart) {
            participantesReferenciadosC100.add(codPart);
            if (!participantes0150.has(codPart)) {
                erros.push(
                    `C100 linha ${linhaRef} (NF ${numDoc}): COD_PART '${codPart}' nao cadastrado no 0150.`
                );
            }
        }

        // 3b. Cancelados/denegados/inutilizados NAO devem ter C170/C190 filhos
        const cancelados = ['02', '03', '04', '05'];
        if (cancelados.includes(codSit)) {
            if (grupo.c170s.length > 0) {
                erros.push(
                    `C100 linha ${linhaRef} (NF ${numDoc}): COD_SIT=${codSit} (cancelado/denegado) ` +
                    `nao deve ter registros C170 filhos (encontrados ${grupo.c170s.length}).`
                );
            }
            if (grupo.c190s.length > 0) {
                erros.push(
                    `C100 linha ${linhaRef} (NF ${numDoc}): COD_SIT=${codSit} (cancelado/denegado) ` +
                    `nao deve ter registros C190 filhos (encontrados ${grupo.c190s.length}).`
                );
            }
            continue; // Nao valida somas pra cancelados
        }

        // 3c. VL_BC_ICMS e VL_ICMS do C100 devem bater com soma dos C190s
        if (grupo.c190s.length > 0) {
            const vlBcIcmsC100 = parseValorSped(campos[20] || '');
            const vlIcmsC100 = parseValorSped(campos[21] || '');

            let somaVlBcIcmsC190 = 0;
            let somaVlIcmsC190 = 0;
            for (const c190 of grupo.c190s) {
                somaVlBcIcmsC190 += parseValorSped(c190.campos[5] || '');
                somaVlIcmsC190 += parseValorSped(c190.campos[6] || '');
            }

            // Tolerancia de arredondamento: 0.02
            const tol = 0.02;
            if (Math.abs(vlBcIcmsC100 - somaVlBcIcmsC190) > tol) {
                erros.push(
                    `C100 linha ${linhaRef} (NF ${numDoc}): VL_BC_ICMS=${vlBcIcmsC100.toFixed(2)} ` +
                    `difere da soma C190 VL_BC_ICMS=${somaVlBcIcmsC190.toFixed(2)}.`
                );
            }
            if (Math.abs(vlIcmsC100 - somaVlIcmsC190) > tol) {
                erros.push(
                    `C100 linha ${linhaRef} (NF ${numDoc}): VL_ICMS=${vlIcmsC100.toFixed(2)} ` +
                    `difere da soma C190 VL_ICMS=${somaVlIcmsC190.toFixed(2)}.`
                );
            }
        }
    }

    // ================================================================
    // 4. C170 CONSISTENCIA
    // ================================================================

    const itensReferenciadosC170 = new Set();

    for (const reg of registros.filter(r => r.tipo === 'C170')) {
        const campos = reg.campos;
        const linhaRef = reg.num;

        // 4a. COD_ITEM deve existir em 0200
        const codItem = campos[2] || '';
        if (codItem) {
            itensReferenciadosC170.add(codItem);
            if (!itens0200.has(codItem)) {
                erros.push(
                    `C170 linha ${linhaRef}: COD_ITEM '${codItem}' nao cadastrado no 0200.`
                );
            }
        }

        // 4b. UNID deve existir em 0190
        const unid = campos[5] || '';
        if (unid && !unidades0190.has(unid)) {
            erros.push(
                `C170 linha ${linhaRef}: UNID '${unid}' nao cadastrada no 0190.`
            );
        }

        // 4c. CFOP deve ser 4 digitos
        const cfop = campos[10] || '';
        if (cfop && !/^\d{4}$/.test(cfop)) {
            erros.push(
                `C170 linha ${linhaRef}: CFOP '${cfop}' deve ter 4 digitos numericos.`
            );
        }
    }

    // ================================================================
    // 5. C190 CONSISTENCIA
    // ================================================================

    for (const reg of registros.filter(r => r.tipo === 'C190')) {
        const campos = reg.campos;
        const linhaRef = reg.num;

        // 5a. CST_ICMS deve ser 3 digitos
        const cstIcms = campos[1] || '';
        if (cstIcms && !/^\d{3}$/.test(cstIcms)) {
            erros.push(
                `C190 linha ${linhaRef}: CST_ICMS '${cstIcms}' deve ter 3 digitos.`
            );
        }

        // 5b. CFOP deve ser 4 digitos
        const cfop = campos[2] || '';
        if (cfop && !/^\d{4}$/.test(cfop)) {
            erros.push(
                `C190 linha ${linhaRef}: CFOP '${cfop}' deve ter 4 digitos numericos.`
            );
        }
    }

    // ================================================================
    // 6. 0150 ORFAOS
    // ================================================================

    // Coletar participantes referenciados em D100 tambem
    const participantesReferenciadosD100 = new Set();
    for (const reg of registros.filter(r => r.tipo === 'D100')) {
        const codPart = reg.campos[3] || '';
        if (codPart) {
            participantesReferenciadosD100.add(codPart);
            // Tambem validar que D100 COD_PART existe no 0150
            if (!participantes0150.has(codPart)) {
                erros.push(
                    `D100 linha ${reg.num}: COD_PART '${codPart}' nao cadastrado no 0150.`
                );
            }
        }
    }

    // Todos referenciados (C100 + D100)
    const todosPartReferenciados = new Set([
        ...participantesReferenciadosC100,
        ...participantesReferenciadosD100,
    ]);

    // 6a. Cada COD_PART em 0150 deveria ser referenciado por algum C100/D100
    for (const codPart of participantes0150) {
        if (!todosPartReferenciados.has(codPart)) {
            avisos.push(
                `0150: participante '${codPart}' cadastrado mas nao referenciado por nenhum C100/D100.`
            );
        }
    }

    // 6b. Cada COD_PART em C100/D100 deve existir em 0150 (ja validado acima)
    // (ja coberto no loop de C100 e D100)

    // ================================================================
    // 7. 0200 ORFAOS
    // ================================================================

    // 7a. Cada COD_ITEM em 0200 deveria ser referenciado por algum C170
    for (const codItem of itens0200) {
        if (!itensReferenciadosC170.has(codItem)) {
            avisos.push(
                `0200: item '${codItem}' cadastrado mas nao referenciado por nenhum C170.`
            );
        }
    }

    // 7b. Cada COD_ITEM em C170 deve existir em 0200 (ja validado acima)

    // ================================================================
    // 8. BLOCO 9 CONSISTENCIA
    // ================================================================

    // Contar registros reais por tipo
    const contagemReal = {};
    for (const reg of registros) {
        contagemReal[reg.tipo] = (contagemReal[reg.tipo] || 0) + 1;
    }

    // 8a. 9900 deve listar cada tipo de registro que aparece no arquivo
    const tipos9900 = new Map(); // tipo -> QTD declarada
    for (const reg of registros.filter(r => r.tipo === '9900')) {
        const tipoRef = reg.campos[1] || '';
        const qtd = parseInt(reg.campos[2] || '0', 10);
        if (tipoRef) {
            tipos9900.set(tipoRef, qtd);
        }
    }

    // 8b. Todo tipo que aparece no arquivo deve ter um 9900 correspondente
    for (const tipo of Object.keys(contagemReal)) {
        if (!tipos9900.has(tipo)) {
            erros.push(
                `Bloco 9: tipo de registro '${tipo}' aparece ${contagemReal[tipo]} vez(es) ` +
                `no arquivo mas nao tem registro 9900 correspondente.`
            );
        }
    }

    // 8c. QTD_REG_BLC em cada 9900 deve bater com contagem real
    for (const [tipo, qtdDeclarada] of tipos9900) {
        const qtdReal = contagemReal[tipo] || 0;
        if (qtdDeclarada !== qtdReal) {
            erros.push(
                `9900: tipo '${tipo}' declara QTD=${qtdDeclarada}, contagem real=${qtdReal}.`
            );
        }
    }

    return {
        valido: erros.length === 0,
        erros,
        avisos,
    };
}
