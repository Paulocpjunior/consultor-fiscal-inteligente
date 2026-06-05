// ============================================================================
// sped-fiscal-editor-validador.js  (PURO)
//
// Validacao ESTRUTURAL generica de SPED (serve pra EFD ICMS/IPI E EFD
// Contribuicoes) — focada no que importa pro editor: integridade que o PVA
// exige antes de aceitar o arquivo.
//
// Diferente de sped-fiscal-validador.js (que e rico mas ESPECIFICO do EFD
// ICMS/IPI — checa blocos C/D/E, CFOP, etc; daria falso-erro num Contribuicoes).
// Este aqui valida so a espinha dorsal comum a qualquer SPED:
//   1. 0000 primeira linha, 9999 ultima; exatamente 1 de cada.
//   2. Cada bloco presente tem abertura (X001) e fechamento (X990).
//   3. 9900: cada tipo declara contagem == ocorrencias reais (PEGA EDICAO RUIM).
//   4. 9990 == linhas do Bloco 9; 9999 == total de linhas do arquivo.
//
// Opera sobre o `parsed` do sped-fiscal-editor-parser (nao re-parseia).
// ============================================================================

// Deriva a letra/numero do bloco a partir do tipo de registro.
// '0000'->'0', 'C170'->'C', 'M210'->'M', '9900'->'9', 'E110'->'E'.
function blocoDoTipo(tipo) {
    return String(tipo || '').charAt(0);
}

/**
 * @param {{ linhas: Array<{tipo:string, campos:string[]}>, resumo: { registrosPorTipo: Record<string,number> } }} parsed
 * @returns {{ valido: boolean, erros: string[], avisos: string[] }}
 */
export function validarEstruturaSped(parsed) {
    const erros = [];
    const avisos = [];
    const linhas = (parsed && parsed.linhas) || [];
    if (!linhas.length) {
        return { valido: false, erros: ['Arquivo sem registros validos.'], avisos };
    }

    const porTipo = (parsed.resumo && parsed.resumo.registrosPorTipo) || {};

    // 1) 0000 primeira, 9999 ultima, unicidade
    if (linhas[0].tipo !== '0000') {
        erros.push(`Primeira linha deve ser 0000 (encontrado "${linhas[0].tipo}").`);
    }
    if (linhas[linhas.length - 1].tipo !== '9999') {
        erros.push(`Ultima linha deve ser 9999 (encontrado "${linhas[linhas.length - 1].tipo}").`);
    }
    if ((porTipo['0000'] || 0) !== 1) erros.push(`Deve haver exatamente 1 registro 0000 (encontrado ${porTipo['0000'] || 0}).`);
    if ((porTipo['9999'] || 0) !== 1) erros.push(`Deve haver exatamente 1 registro 9999 (encontrado ${porTipo['9999'] || 0}).`);

    if (porTipo['_invalida']) {
        avisos.push(`${porTipo['_invalida']} linha(s) mal-formada(s) ignorada(s) (sem | inicial/final).`);
    }

    // 2) Abertura/fechamento de cada bloco presente.
    // Bloco 9 fecha em 9990 (e 9999 e o total do arquivo, parte do bloco 9).
    const blocosPresentes = new Set();
    for (const t of Object.keys(porTipo)) {
        if (t === '_invalida') continue;
        blocosPresentes.add(blocoDoTipo(t));
    }
    for (const bloco of blocosPresentes) {
        const abertura = `${bloco}001`;
        const fechamento = `${bloco}990`;
        if (!porTipo[abertura]) erros.push(`Bloco ${bloco}: registro de abertura ${abertura} ausente.`);
        if (!porTipo[fechamento]) erros.push(`Bloco ${bloco}: registro de encerramento ${fechamento} ausente.`);
    }

    // 3) 9900: contagem declarada x real (o check que pega edicao que mudou
    //    quantidade de registros sem recalcular Bloco 9).
    const ocorrenciasReais = { ...porTipo };
    delete ocorrenciasReais['_invalida'];
    for (const l of linhas) {
        if (l.tipo === '9900') {
            const tipoContado = l.campos[1];
            const qtdDeclarada = Number(l.campos[2]);
            const qtdReal = ocorrenciasReais[tipoContado] || 0;
            if (!Number.isFinite(qtdDeclarada)) {
                erros.push(`9900 de '${tipoContado}': quantidade invalida "${l.campos[2]}".`);
            } else if (qtdDeclarada !== qtdReal) {
                erros.push(`9900 '${tipoContado}': declara ${qtdDeclarada}, contagem real ${qtdReal}.`);
            }
        }
    }

    // 4) 9990 (linhas do Bloco 9) e 9999 (total do arquivo)
    const linhasBloco9 = linhas.filter(l => blocoDoTipo(l.tipo) === '9').length;
    const r9990 = linhas.find(l => l.tipo === '9990');
    if (r9990) {
        const declarado = Number(r9990.campos[1]);
        if (declarado !== linhasBloco9) {
            erros.push(`9990 declara ${declarado} linhas no Bloco 9, real ${linhasBloco9}.`);
        }
    }
    const r9999 = linhas.find(l => l.tipo === '9999');
    if (r9999) {
        const declarado = Number(r9999.campos[1]);
        if (declarado !== linhas.length) {
            erros.push(`9999 declara ${declarado} linhas no arquivo, real ${linhas.length}.`);
        }
    }

    return { valido: erros.length === 0, erros, avisos };
}
