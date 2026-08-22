// ============================================================================
// 🚨 A PROJEÇÃO CEGAVA A RÉGUA — três apurações de imposto, corrigidas na
// véspera, respondendo como se o campo não existisse
//
// Em 21/08 as três passaram por `docCancelado`: crédito acumulado, DIFAL de
// aquisição e FUNRURAL/DIPAM. Em 22/08 a varredura das PROJEÇÕES mostrou que
// nenhuma das três consultas trazia `eventos` nem `cStat` — e o cancelamento
// chega por EVENTO, com o `status` ainda 'autorizado'.
//
// Ou seja: a régua estava certa, o leitor estava certo, e a nota cancelada
// continuava gerando imposto. **Campo fora da projeção some da leitura**, e a
// régua responde "não cancelada" com toda confiança.
//
// ⚠️ A trava é ESTREITA de propósito: ela só cobra o trio de quem consulta
// `documentos_fiscais`, e a exceção se declara COM o motivo. Painel de
// diagnóstico que conta documento não precisa do trio — cobrar dele faria a
// trava gritar sem motivo, e teste que grita sem motivo é teste desligado.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
// @ts-expect-error — módulo backend .js sem .d.ts
import { CAMPOS_PARA_DOC_CANCELADO } from '../sefaz-backend/xml-metadata-helper.js';

const RAIZ = join(__dirname, '..');

/**
 * Consultas de `documentos_fiscais` que NÃO precisam do trio — cada uma com o
 * motivo. Todas foram conferidas: nenhuma decide se o documento conta no
 * livro ou no imposto.
 */
const SEM_PERGUNTA_DE_CANCELAMENTO: Record<string, string> = {
    'sefaz-backend/backlog-entrada-routes.js': 'conta resumo × completa (a fila da manifestação), não valor',
    'sefaz-backend/cofre-checklist-routes.js': 'mede ADOÇÃO do cofre de saída — quem chegou, não quanto vale',
    'sefaz-backend/conferencia-chaves-routes.js': 'presença da chave; a 2ª consulta do arquivo TEM o trio',
    'sefaz-backend/fila-migracao-routes.js': 'diagnóstico da fila de migração (mesma exceção da varredura de cancelada)',
    'sefaz-backend/migracao-prontidao-routes.js': 'diagnóstico de prontidão',
    'sefaz-backend/nfse-sp-routes.js': 'NFS-e não tem evento de cancelamento — ali o campo é a fonte',
    'sefaz-backend/prova-captura-routes.js': 'prova de captura conta documentos; cancelada é uma das contagens',
    'sefaz-backend/sync-routes.js': 'backfill de participante/endereço — não decide imposto',
};

function varrer(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, out);
        else if (nome.endsWith('.js')) out.push(p);
    }
    return out;
}

<<<<<<< HEAD
/**
 * Cada `.select(...)` que sai de uma consulta a `documentos_fiscais`.
 *
 * 🐛 A 1ª versão casava o fechamento do `.select(` no primeiro `)` — e as
 * projeções são COMENTADAS, então um parêntese dentro do comentário fechava a
 * captura no meio e a varredura acusava campo que estava lá. Comentário é
 * removido ANTES de ler os campos; a linha, calculada sobre o texto original.
 */
function projecoes(src: string): Array<{ linha: number; campos: Set<string> }> {
    const out: Array<{ linha: number; campos: Set<string> }> = [];
    // Preserva o número de linhas (troca o comentário por vazio, não o apaga).
    const limpo = src.replace(/\/\/[^\n]*/g, '');
    const re = /collection\('documentos_fiscais'\)(?:.|\n){0,900}?\.select\(((?:.|\n){0,900}?)\)/g;
    for (const m of limpo.matchAll(re)) {
=======
/** Cada `.select(...)` que sai de uma consulta a `documentos_fiscais`. */
function projecoes(src: string): Array<{ linha: number; campos: Set<string> }> {
    const out: Array<{ linha: number; campos: Set<string> }> = [];
    const re = /collection\('documentos_fiscais'\)(?:.|\n){0,900}?\.select\(((?:.|\n){0,700}?)\)/g;
    for (const m of src.matchAll(re)) {
>>>>>>> origin/main
        const campos = new Set<string>();
        for (const c of m[1].matchAll(/'([^']+)'/g)) {
            campos.add(c[1]);
            campos.add(c[1].split('.')[0]);   // 'totais.vICMS' → 'totais'
        }
<<<<<<< HEAD
        out.push({ linha: limpo.slice(0, m.index).split('\n').length, campos });
=======
        out.push({ linha: src.slice(0, m.index).split('\n').length, campos });
>>>>>>> origin/main
    }
    return out;
}

describe('🚨 projeção que alimenta docCancelado carrega o que ela lê', () => {
    it('os três sinais do cancelamento estão declarados junto do dono', () => {
        expect([...CAMPOS_PARA_DOC_CANCELADO]).toEqual(['status', 'cStat', 'eventos']);
    });

    it('nenhuma consulta de documentos_fiscais cega a régua sem declarar por quê', () => {
        const infratores: string[] = [];
        for (const arquivo of [...varrer(join(RAIZ, 'sefaz-backend')), join(RAIZ, 'server.js')]) {
            const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
            if (SEM_PERGUNTA_DE_CANCELAMENTO[rel]) continue;
            const src = readFileSync(arquivo, 'utf8');
            for (const { linha, campos } of projecoes(src)) {
                const faltam = CAMPOS_PARA_DOC_CANCELADO.filter((c: string) => !campos.has(c));
                if (faltam.length) infratores.push(`${rel}:${linha}  faltam ${faltam.join(', ')}`);
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 PROJEÇÃO CEGANDO A RÉGUA DO CANCELAMENTO\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\n`docCancelado` decide na LEITURA por status, cStat legado e o EVENTO 110111.\n'
                + 'O caminho NORMAL é o evento — e nele o `status` continua "autorizado". Sem\n'
                + '`eventos` na projeção, a régua responde "não cancelada" com toda confiança, e\n'
                + 'a nota cancelada volta a gerar imposto (22/08: crédito acumulado, DIFAL de\n'
                + 'aquisição e FUNRURAL/DIPAM, os três corrigidos na véspera).\n\n'
                + 'Some os três campos ao `.select(...)`, ou declare a consulta em\n'
                + 'SEM_PERGUNTA_DE_CANCELAMENTO COM o motivo — nunca apague a varredura.\n',
            );
        }
    });

    // As três que este PR corrigiu, travadas pelo que ficou. Elas decidem
    // IMPOSTO: crédito de ICMS, DIFAL a pagar e FUNRURAL/DIPAM.
    it('e as três apurações trazem o trio', () => {
        for (const rel of [
            'sefaz-backend/credito-acumulado-routes.js',
            'sefaz-backend/difal-routes.js',
            'sefaz-backend/dipam-routes.js',
        ]) {
            const [proj] = projecoes(readFileSync(join(RAIZ, rel), 'utf8'));
            expect({ rel, faltam: CAMPOS_PARA_DOC_CANCELADO.filter((c: string) => !proj.campos.has(c)) })
                .toEqual({ rel, faltam: [] });
        }
    });

    // `direcaoEfetivaDoc` só reconhece a nota PRÓPRIA de entrada (art. 136,
    // compra de produtor rural) pelo `tpNF` — e ela decide se o ICMS é
    // crédito ou débito.
    it('e o crédito acumulado traz o tpNF, que decide entrada × saída', () => {
        const [proj] = projecoes(readFileSync(join(RAIZ, 'sefaz-backend/credito-acumulado-routes.js'), 'utf8'));
        expect(proj.campos.has('tpNF')).toBe(true);
    });

<<<<<<< HEAD
    // ═══════════════════════════════════════════════════════════════════════
    // A IRMÃ, um campo adiante: o VALOR também chega em várias formas, e o
    // import pelo NAVEGADOR grava só `totais.vNF`. Projeção que traz apenas
    // `valorTotal` faz a nota entrar valendo ZERO — e nada acusa.
    //
    // Quem soma dinheiro carrega as formas; quem só CONTA documento, não.
    // ═══════════════════════════════════════════════════════════════════════
    const SOMAM_DINHEIRO: Record<string, string> = {
        'sefaz-backend/relatorios-routes.js': 'faturamento da carteira e a Declaração ASSINADA ao banco',
        'sefaz-backend/dipam-routes.js': 'base do FUNRURAL e da DIPAM',
    };

    it('quem SOMA valor carrega as formas em que o valor chega', () => {
        const faltas: string[] = [];
        for (const [rel, oQue] of Object.entries(SOMAM_DINHEIRO)) {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            for (const { linha, campos } of projecoes(src)) {
                // `totais.vNF` é a forma do import pelo navegador — é ela que
                // some quando a projeção traz só o campo cru.
                if (!campos.has('totais.vNF')) faltas.push(`${rel}:${linha} (${oQue})`);
            }
        }
        if (faltas.length) {
            throw new Error(
                '\n\n🚧 PROJEÇÃO QUE SOMA DINHEIRO SEM AS FORMAS DO VALOR\n\n'
                + faltas.map((x) => `  · ${x}`).join('\n')
                + '\n\nO import pelo NAVEGADOR grava só `totais.vNF` — nunca `valorTotal`. Sem ela\n'
                + 'na projeção, essas notas entram valendo ZERO e ninguém percebe.\n',
            );
        }
    });

    it('e o relatório lê pelo DONO, não pelo campo cru', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/relatorios-routes.js'), 'utf8');
        expect(src).toContain('valorDoDocumento');
        expect(src).not.toMatch(/Number\(d\.valorTotal\)/);
    });

=======
>>>>>>> origin/main
    it('toda exceção declarada tem motivo escrito', () => {
        for (const [rel, motivo] of Object.entries(SEM_PERGUNTA_DE_CANCELAMENTO)) {
            expect({ rel, ok: motivo.trim().length >= 10 }).toEqual({ rel, ok: true });
        }
    });
});
