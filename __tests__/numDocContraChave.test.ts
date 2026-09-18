// ============================================================================
// 🚨 O D100 SAÍA SEM NÚMERO — e o PVA quebrava o relatório de entradas
//
// 18/09, EDUARDO GUERRA · 08/2026. O arquivo IMPORTOU (a contagem de 25 campos
// fechava, R42 verde) e o PVA respondeu "Ocorreu um erro ao gerar o relatório"
// em Relatórios → Documentos → Entradas de Mercadorias e Aquisição de Serviços
// — só nesta empresa, a única da carteira com CT-e no livro. Medido no gerador
// com um CT-e como a captura grava: `|D100|0|1|…|57|00|001|||3526…|`, o campo
// 09 (NUM_DOC) VAZIO em 100% das linhas. Causa: `extrairMetadados` lia o número
// pela tag `nNF` (da NF-e) e o conhecimento traz `nCT`.
//
// O Guia 3.2.3 exige NUM_DOC "maior que zero" e confere NUM_DOC/SER contra a
// chave — e nada na casa perguntava isso: a contagem e o tamanho estavam certos.
//
// Três metades no mesmo PR: o GERADOR lê o número pelo dono (a chave carrega
// o número nas posições 26-34), a PREVALIDAÇÃO acusa NUM_DOC vazio/divergente
// nas DUAS famílias, e a AUDITORIA vigia o campo vazio em 100% das linhas.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { conferirNumDocContraChave } from '../sefaz-backend/sped-c100-regras-comuns.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';
import { numeroDoDocumento } from '../sefaz-backend/sped-selecao-documentos.js';
import { auditarSaidaSped } from '../sefaz-backend/sped-auditoria-saida.js';

/** Chave real de CT-e (modelo 57 nas posições 21-22, número 3 nas 26-34). */
const CHAVE_CTE = '35260731947349000169570010000000031705547508';
const CHAVE_NFE = '35260731947349000169550010000012341000012348';

/** Como o importer PRINCIPAL gravava um CT-e tomado: SEM `numero`. */
const cteCapturado = (over: any = {}) => ({
    chave: CHAVE_CTE, tipoDoc: 'CTe', direcao: 'entrada', status: 'autorizado',
    dhEmi: '2026-07-10T10:00:00-03:00', valorTotal: 1500,
    cfop: '6353', cstIcms: '90', aliqIcms: 0, codMunIniCte: '3550308', codMunFimCte: '3509502',
    cnpjEmit: '47252373000113', xNomeEmit: 'TRANSPORTADORA LTDA',
    ...over,
});
const dados = (notas: any[]) => ({
    empresa: { _regime: 'lucro', cnpj: '31947349000169', dadosFiscais: { uf: 'SP' } },
    competenciaInicio: '2026-07', competenciaFim: '2026-07', notas, warnings: [] as string[],
});

describe('numeroDoDocumento — o gravado vence, a chave é a reserva', () => {
    it('lê o número gravado', () => {
        expect(numeroDoDocumento({ numero: '0042', chave: CHAVE_CTE })).toBe('42');
    });
    it('sem número gravado, lê o da CHAVE (posições 26-34)', () => {
        expect(numeroDoDocumento({ chave: CHAVE_CTE })).toBe('3');
        expect(numeroDoDocumento({ chaveAcesso: CHAVE_NFE })).toBe('1234');
    });
    it('sem os dois devolve vazio — número não se inventa', () => {
        expect(numeroDoDocumento({ chave: '123' })).toBe('');
        expect(numeroDoDocumento({})).toBe('');
    });
});

describe('🚨 o D100 do CT-e capturado sai COM número', () => {
    it('NUM_DOC vem da chave quando o banco não tem o número', () => {
        const linhas = buildBlocoD(dados([cteCapturado()]));
        const d100 = linhas.find((l: string) => l.startsWith('|D100|'))!.split('|');
        expect(d100[9]).toBe('3');
        expect(d100[10]).toBe(CHAVE_CTE);
    });

    it('o arquivo REAL nasce VERDE na regra nova e na auditoria', () => {
        const linhas = buildBlocoD(dados([cteCapturado()]));
        expect(conferirNumDocContraChave(linhas)).toEqual([]);
        const aud = auditarSaidaSped(linhas);
        expect(aud.suspeitas.filter((s: any) => /NUM_DOC/.test(s.detalhe))).toEqual([]);
    });
});

describe('conferirNumDocContraChave — a recusa que ninguém conferia', () => {
    const d100SemNumero = `|D100|0|1|47252373000113|57|00|001|||${CHAVE_CTE}|10072026|10072026|0||1500,00|0,00|9|1500,00|0,00|0,00|0,00|||3550308|3509502|`;
    const d100Divergente = d100SemNumero.replace('|001|||', '|001||99|');
    const c100SemNumero = `|C100|0|1|47252373000113|55|00|001||${CHAVE_NFE}|10072026|10072026|100,00|0|0,00|100,00|9|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|`;

    it('acusa o D100 sem número — e diz o número que a chave carrega', () => {
        const [e] = conferirNumDocContraChave([d100SemNumero]);
        expect(e).toBeTruthy();
        expect(e.regra).toBe('num-doc-vazio');
        expect(e.registro).toBe('D100');
        expect(e.campo).toBe('9 - NUM_DOC');
        expect(e.acao).toMatch(/número 3/);
        expect(e.acao).toMatch(/Reler cabeçalho dos CT-e/);
    });

    it('acusa NUM_DOC divergente da chave', () => {
        const [e] = conferirNumDocContraChave([d100Divergente]);
        expect(e.regra).toBe('num-doc-x-chave');
        expect(e.valor).toBe('99');
        expect(e.esperado).toBe('3');
    });

    it('vale para o C100 também (campo 08) — os dez primeiros campos são os mesmos', () => {
        const [e] = conferirNumDocContraChave([c100SemNumero]);
        expect(e.registro).toBe('C100');
        expect(e.campo).toBe('8 - NUM_DOC');
    });

    it('está LIGADA nas duas prevalidações', () => {
        expect(prevalidarSpedFiscal([d100SemNumero]).erros.some((e: any) => e.regra === 'num-doc-vazio')).toBe(true);
        expect(avisosDaPrevalidacaoContrib([d100SemNumero]).some((a: any) => /NUM_DOC/.test(String(a)))).toBe(true);
    });

    it('a auditoria vigia o NUM_DOC vazio em 100% dos D100', () => {
        const aud = auditarSaidaSped(['|D001|0|', d100SemNumero, '|D990|3|']);
        expect(aud.suspeitas.some((s: any) => s.registro === 'D100' && /NUM_DOC/.test(s.detalhe))).toBe(true);
    });
});

// ═══ A CAPTURA lê o número pelo DONO do cabeçalho do CT-e ═══════════════════
// Varredura de fonte (o importer puxa firebase-admin e não carrega no jest):
// `extrairMetadados` não pode voltar a ler SÓ `nNF` — foi isso que deixou todo
// CT-e sem número. Quem lê `nCT` é `lerCabecalhoCte`, e o importer pergunta a
// ele; reler a tag à mão aqui seria a segunda cópia.
import { readFileSync } from 'fs';
import { join } from 'path';
describe('o importer pergunta o número do CT-e ao dono', () => {
    const fonte = readFileSync(join(__dirname, '..', 'sefaz-backend', 'xml-importer.js'), 'utf8')
        .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    it('extrairMetadados cai em cabecalhoCte.numero quando não há nNF', () => {
        expect(fonte).toMatch(/const numero = pickTag\(ide, 'nNF'\) \|\| cabecalhoCte\?\.numero/);
    });
    it('e não relê a tag nCT à mão', () => {
        expect(fonte).not.toMatch(/pickTag\([^)]*'nCT'\)/);
    });
});
