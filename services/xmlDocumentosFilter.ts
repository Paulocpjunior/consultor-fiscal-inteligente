/**
 * xmlDocumentosFilter.ts
 *
 * Filtro EM MEMÓRIA dos documentos fiscais da Central de Documentos.
 *
 * Extraído de xmlFiscalService.ts (que importa firebase e não é testável em
 * jest por causa de `import.meta.env`). Este módulo é PURO — sem firebase,
 * sem import.meta — então tem teste de regressão dedicado
 * (__tests__/xmlDocumentosFilter.test.ts). É o hotspot que mais quebrou
 * (PRs #44/#45/#46): busca por CNPJ parcial/completo, direção relativa ao
 * CNPJ buscado, token-match de nome e fallback CNPJ→nome.
 *
 * Regras de busca:
 *  - termo numérico (só dígitos)  -> CNPJ substring | número exato | chave (≥15 chars)
 *  - termo textual <4 chars       -> token EXATO     (evita "sp" casar "spa"/"hsprojetos")
 *  - termo textual ≥4 chars       -> token SUBSTRING (permite "limpo" achar "braslimpo",
 *                                                     "auto" achar "autopecas")
 */

import type { DocumentoFiscal } from '../types';

/** Subconjunto de filtros que o filtro em memória entende. */
export interface DocumentosFiltroMem {
    direcao?: 'entrada' | 'saida';
    competencia?: string;
    competenciaInicio?: string;
    competenciaFim?: string;
    status?: DocumentoFiscal['status'];
    origem?: string;
    tipoDoc?: string;
    /** CNPJ da EMPRESA dona do XML (so digitos ou formatado). Match exato no
     *  campo `empresaCnpj` do doc — diferente do `busca`, que tambem casa em
     *  emitente/destinatario. Util pro dropdown explicito de empresa. */
    empresaCnpj?: string;
    busca?: string;
}

export function applyDocumentosFilters(
    docs: DocumentoFiscal[],
    filters: DocumentosFiltroMem = {},
): DocumentoFiscal[] {
    const normTop = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Mapa CNPJ→nome derivado dos próprios docs carregados. Necessário pra
    // achar docs cujo `empresaNome` está vazio mas `empresaCnpj` aponta pra
    // uma empresa que aparece NOMEADA em outros docs.
    //
    // Caso real: o resumo da BRASLIMPO tem empresaCnpj=44388152000189 mas
    // empresaNome=null (importer SEFAZ não popula nome). Buscar "S&P" só
    // achava os 24 NFSe (todos tem empresaNome="S&P ASSESSORIA CONTABIL S/S"),
    // a BRASLIMPO ficava fora. Já buscar "44388" (numerico) bate em
    // empresaCnpj direto e inclui — daí a divergencia (25 vs 24) que o
    // usuario reportou. Com o mapa, "S&P" agora resolve o nome da S&P pelo
    // CNPJ da BRASLIMPO e inclui ela.
    const nomePorCnpj = new Map<string, string>();
    for (const d of docs) {
        if (d.empresaCnpj && d.empresaNome) {
            const k = normTop(d.empresaCnpj);
            if (k && !nomePorCnpj.has(k)) nomePorCnpj.set(k, d.empresaNome);
        }
    }

    return docs.filter(d => {
        const e = d as any;
        const norm = (s: any) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // ── Blobs de CNPJ (reusados por busca E direção) ──────────────────
        const destCnpjs = [e.destinatario?.cnpj, e.tomador?.cnpj, e.cnpjDest, e.cpfDest].map(norm).join(' ');
        const emitCnpjs = [e.emitente?.cnpj, e.prestador?.cnpj, e.cnpjEmit].map(norm).join(' ');
        const empresaCnpjN = norm(d.empresaCnpj);
        const cnpjBlob = [empresaCnpjN, destCnpjs, emitCnpjs].join(' ');

        const term = filters.busca ? norm(filters.busca) : '';
        // Termo "CNPJ-like": SÓ dígitos, de QUALQUER tamanho. Cobre o CNPJ
        // completo (14) e o prefixo digitado pelo usuário (ex: '44388').
        const termIsNumeric = !!term && /^\d+$/.test(term);
        const termInDest = !!term && destCnpjs.includes(term);
        const termInEmit = !!term && emitCnpjs.includes(term);
        const termIsEmpresa = !!term && !!empresaCnpjN && empresaCnpjN.includes(term);
        const termMatchesCnpj = termIsNumeric && (termInDest || termInEmit || termIsEmpresa);

        // ── Direção (relativa ao CNPJ buscado) ────────────────────────────
        if (filters.direcao) {
            if (termMatchesCnpj) {
                let isEntradaForTerm = termInDest;
                let isSaidaForTerm = termInEmit;
                if (!termInDest && !termInEmit && termIsEmpresa) {
                    isEntradaForTerm = d.direcao === 'entrada';
                    isSaidaForTerm = d.direcao === 'saida';
                }
                if (filters.direcao === 'entrada' && !isEntradaForTerm) return false;
                if (filters.direcao === 'saida' && !isSaidaForTerm) return false;
            } else if (d.direcao !== filters.direcao) {
                return false;
            }
        }

        if (filters.status && d.status !== filters.status) return false;
        if (filters.origem && d.origem !== filters.origem) return false;
        if (filters.empresaCnpj) {
            const alvo = norm(filters.empresaCnpj);
            // Match exato — usuario escolheu UMA empresa especifica do dropdown.
            // Diferente do `busca`, que faz substring em emitente/destinatario.
            if (!alvo || empresaCnpjN !== alvo) return false;
        }
        if (filters.tipoDoc) {
            const t = String((d as any).tipoDoc || d.tipo || '').toLowerCase();
            if (t !== filters.tipoDoc.toLowerCase()) return false;
        }
        if (filters.competencia && d.competencia !== filters.competencia) return false;
        if (filters.competenciaInicio && d.competencia < filters.competenciaInicio) return false;
        if (filters.competenciaFim && d.competencia > filters.competenciaFim) return false;

        // ── Busca textual / numérica ──────────────────────────────────────
        if (term) {
            if (termIsNumeric) {
                // Numérico: substring em CNPJ blob, OU em numero, OU em chave
                // (chave só se termo ≥15 dígitos pra evitar falso-positivo de
                // prefixo curto bater dentro da chave de 44 dígitos).
                const numeroN = norm(d.numero);
                const chaveN = norm(d.chave);
                const matchNum = !!numeroN && numeroN.includes(term);
                const matchChave = term.length >= 15 && chaveN.includes(term);
                if (!cnpjBlob.includes(term) && !matchNum && !matchChave) return false;
            } else {
                // Textual: TOKEN match (não substring solto).
                // Substring solto era o bug do "S&P" trazendo HS PROJETOS,
                // R A CARPETES, S.P.A. SAUDE etc — porque norm("S&P")="sp" e
                // "sp" aparece DENTRO de "hsprojetos", "carpetespisos", "spa".
                const splitTokens = (s: any): string[] =>
                    String(s ?? '').toLowerCase().split(/\s+/)
                        .map(t => t.replace(/[^a-z0-9]/g, ''))
                        .filter(Boolean);
                // Fallback: docs sem empresaNome (ex: BRASLIMPO resumo) puxam
                // o nome do mapa CNPJ→nome construido acima.
                const empresaNomeResolved =
                    d.empresaNome || (empresaCnpjN ? nomePorCnpj.get(empresaCnpjN) : undefined);
                const nameTokens = [
                    ...splitTokens(empresaNomeResolved),
                    ...splitTokens(e.emitente?.nome),
                    ...splitTokens(e.prestador?.nome),
                    ...splitTokens(e.destinatario?.nome),
                    ...splitTokens(e.tomador?.nome),
                ];
                const nameMatch = term.length < 4
                    ? nameTokens.some(t => t === term)            // <4: exato (evita "sp"→"spa")
                    : nameTokens.some(t => t.includes(term));     // ≥4: substring (limpo→braslimpo, auto→autopecas)
                // Tambem permite achar pelo numero/chave/CNPJ digitados como texto
                const numeroN = norm(d.numero);
                const chaveN = norm(d.chave);
                const numMatch =
                    (!!numeroN && numeroN === term) ||
                    (term.length >= 15 && chaveN.includes(term)) ||
                    cnpjBlob.includes(term);
                if (!nameMatch && !numMatch) return false;
            }
        }
        return true;
    });
}
