/**
 * spedFiscalExcelEditor.ts
 *
 * Pipeline UI do editor SPED Fiscal:
 *   SPED (.txt)
 *     → parseSpedFiscalParaEdicao (backend module, dynamic import)
 *     → exportarXlsx(): 1 aba por tipo editavel (C170, C190, E110...) + aba
 *       "Resumo" + aba "Outros (preservados)" so-leitura
 *   ↓ (admin edita no Excel)
 *   XLSX corrigido
 *     → lerXlsx(): aplica edicoes preservando idx → SpedEdicao[]
 *     → reconstruirSped() do backend module
 *     → SPED corrigido (.txt), com Bloco 9 (R9900/R9990/R9999) recalculado
 *
 * Modulos puros vivem em sefaz-backend/sped-fiscal-editor-*.js (testaveis).
 * Aqui ficam so I/O e xlsx — sem logica.
 */

import * as XLSX from 'xlsx';

// Dynamic import: sao .js ESM em sefaz-backend; ts-jest precisa de .js literal
// pra encontrar via moduleNameMapper. Em prod, vite resolve.
type TipoSped = 'fiscal' | 'contribuicoes';
type ParseResult = {
    tipoSped: TipoSped;
    linhas: Array<{ idx: number; tipo: string; campos: string[]; original: string }>;
    editaveis: Record<string, Array<{ idx: number; campos: Record<string, string> }>>;
    resumo: {
        totalLinhas: number;
        registrosPorTipo: Record<string, number>;
        tipoSped: TipoSped;
        layoutMismatch: Record<string, { esperado: number; real: number }>;
    };
};
type SpedEdicao = { idx: number; campos: string[] };

export async function parseSped(text: string): Promise<ParseResult> {
    const mod = await import('../sefaz-backend/sped-fiscal-editor-parser.js' as any);
    return mod.parseSpedFiscalParaEdicao(text);
}

export async function colunasDoTipo(tipo: string, tipoSped: TipoSped = 'fiscal'): Promise<string[] | null> {
    const mod = await import('../sefaz-backend/sped-fiscal-editor-parser.js' as any);
    return mod.colunasDoTipo(tipo, tipoSped);
}

export async function reconstruirSped(parsed: ParseResult, edicoes: SpedEdicao[]): Promise<string> {
    const mod = await import('../sefaz-backend/sped-fiscal-editor-rebuilder.js' as any);
    return mod.reconstruirSped(parsed, edicoes);
}

/**
 * Exporta o SPED parseado pra XLSX editavel.
 * - 1 aba "Resumo" com contagem por tipo.
 * - 1 aba por tipo editavel (C170, C190, E110, etc) com colunas nomeadas + idx (somente leitura).
 * - 1 aba "Outros (preservados)" com linhas dos tipos sem layout — read-only, round-trip mantem.
 */
export async function exportarXlsx(parsed: ParseResult, nomeArquivo: string): Promise<Blob> {
    const wb = XLSX.utils.book_new();

    // Resumo
    const resumoRows: any[][] = [
        ['SPED Fiscal — Editor', ''],
        ['Arquivo origem', nomeArquivo],
        ['Total de linhas', parsed.resumo.totalLinhas],
        [],
        ['Tipo', 'Ocorrencias', 'Editavel?'],
    ];
    const tiposOrdenados = Object.keys(parsed.resumo.registrosPorTipo).sort();
    for (const t of tiposOrdenados) {
        resumoRows.push([t, parsed.resumo.registrosPorTipo[t], parsed.editaveis[t] ? 'Sim' : 'Nao']);
    }
    const wsResumo = XLSX.utils.aoa_to_sheet(resumoRows);
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

    // Uma aba por tipo editavel
    for (const tipo of Object.keys(parsed.editaveis).sort()) {
        const itens = parsed.editaveis[tipo];
        const cols = await colunasDoTipo(tipo, parsed.tipoSped);
        if (!cols || !itens.length) continue;
        const header = ['_idx_NAO_MEXER', ...cols];
        const data = itens.map(it => [it.idx, ...cols.map(c => it.campos[c] ?? '')]);
        const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
        // Trava coluna idx
        if (!ws['!cols']) ws['!cols'] = [];
        ws['!cols'][0] = { hidden: false, wch: 12 };
        XLSX.utils.book_append_sheet(wb, ws, tipo);
    }

    // Outros — linhas preservadas (read-only)
    const outros = parsed.linhas.filter(l => !parsed.editaveis[l.tipo]);
    if (outros.length) {
        const outrosRows: any[][] = [
            ['_idx_NAO_MEXER', 'Tipo', 'Linha original (READ-ONLY)'],
            ...outros.map(l => [l.idx, l.tipo, l.original]),
        ];
        const ws = XLSX.utils.aoa_to_sheet(outrosRows);
        XLSX.utils.book_append_sheet(wb, ws, 'Outros (preservados)');
    }

    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Le XLSX editado e devolve a lista de edicoes (compativel com reconstruirSped).
 * Sheets "Resumo" e "Outros (preservados)" sao IGNORADAS — round-trip mantem.
 * Outras sheets sao interpretadas como tipos editaveis.
 */
export async function lerXlsx(arrayBuffer: ArrayBuffer, tipoSped: TipoSped = 'fiscal'): Promise<SpedEdicao[]> {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: false, cellText: true });
    const edicoes: SpedEdicao[] = [];

    for (const sheetName of wb.SheetNames) {
        if (sheetName === 'Resumo' || sheetName === 'Outros (preservados)') continue;
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: '' });
        if (!rows.length) continue;
        const header = (rows[0] || []).map((c: any) => String(c).trim());
        const idxCol = header.indexOf('_idx_NAO_MEXER');
        if (idxCol === -1) continue; // sheet desconhecida
        const cols = await colunasDoTipo(sheetName, tipoSped);
        if (!cols) continue;

        for (let r = 1; r < rows.length; r++) {
            const row = rows[r] || [];
            const idx = Number(row[idxCol]);
            if (!Number.isFinite(idx)) continue;
            // Reconstroi array de campos preservando ordem do LAYOUT (campos[0] = tipo)
            const campos = [sheetName];
            for (const colName of cols) {
                const headerPos = header.indexOf(colName);
                const v = headerPos === -1 ? '' : row[headerPos];
                campos.push(v == null ? '' : String(v).trim());
            }
            edicoes.push({ idx, campos });
        }
    }
    return edicoes;
}

/**
 * Pipeline completo: SPED-original-text + XLSX-editado → SPED-corrigido-text.
 * Usado pelo componente como uma chamada so.
 */
export async function aplicarEdicoesXlsx(spedTextOriginal: string, xlsxBuffer: ArrayBuffer): Promise<string> {
    const parsed = await parseSped(spedTextOriginal);
    // tipoSped do arquivo original define o layout usado pra reler o XLSX —
    // garante que C170 contribuicoes nao seja lido com layout fiscal.
    const edicoes = await lerXlsx(xlsxBuffer, parsed.tipoSped);
    return await reconstruirSped(parsed, edicoes);
}
