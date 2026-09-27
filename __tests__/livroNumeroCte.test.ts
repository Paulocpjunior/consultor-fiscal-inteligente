// ============================================================================
// __tests__/livroNumeroCte.test.ts — o NÚMERO do CT-e no Livro de Entradas
//
// 21/09/2026, EDUARDO GUERRA · 08/2026 (a única empresa com CT-e no livro):
// o PDF do Livro de Entradas saía com "Ø=Þš —" na coluna Nº NF de todo
// conhecimento, enquanto a lista de XMLs mostrava "2589/2". Duas causas:
//
//   1. o prefixo era o emoji 🚚, e a Helvetica do jsPDF não o tem — o par
//      substituto UTF-16 (D83D DE9A) virava "Ø=Þš" em WinAnsi;
//   2. o Livro lia `d.numero` CRU, e os CT-e capturados antes de 18/09 foram
//      gravados sem `numero` (a captura lia `nNF`, tag da NF-e). A lista de
//      XMLs recupera o número da CHAVE (posições 26-34); o Livro não.
//
// A régua é a MESMA do D100 do SPED (`numeroDoDocumento`): o gravado vence, a
// chave é a reserva, sem os dois fica "—" (ausência, nunca número inventado).
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { numeroDoDocumento } from '../sefaz-backend/sped-selecao-documentos.js';
import { escrituraveisNoLivroDeEntradas } from '../services/livroNotaProdutor';

const RAIZ = join(__dirname, '..');
// CT-e (modelo 57) da TR CASSOL: série 002, número 000002589.
const CHAVE_CTE = '35260845374898000104570020000025891000025897';

describe('o número do CT-e vem da chave quando o gravado está vazio', () => {
    it('gravado vence', () => {
        expect(numeroDoDocumento({ numero: '2589', chave: CHAVE_CTE })).toBe('2589');
    });
    it('sem `numero`, a chave responde (posições 26-34, sem zeros à esquerda)', () => {
        expect(numeroDoDocumento({ numero: null, chave: CHAVE_CTE })).toBe('2589');
        expect(numeroDoDocumento({ chave: CHAVE_CTE })).toBe('2589');
    });
    it('sem número e sem chave: vazio — ausência não vira zero', () => {
        expect(numeroDoDocumento({})).toBe('');
    });
});

describe('o Livro de Entradas usa a régua do D100, e o marcador de frete é texto', () => {
    const src = readFileSync(join(RAIZ, 'components/Relatorios/index.tsx'), 'utf8');

    it('importa `numeroDoDocumento` do dono', () => {
        expect(src).toMatch(/import \{[^}]*numeroDoDocumento[^}]*\} from '\.\.\/\.\.\/sefaz-backend\/sped-selecao-documentos\.js'/);
    });
    it('a linha do livro monta o número por `numeroDoDocumento(d)`', () => {
        expect(src).toContain("numero: (ehCte ? 'CT-e ' : '') + (numeroDoDocumento(d) || '—')");
    });
    it('a ✏️ CFOP por nota também', () => {
        expect(src).toContain("numero: numeroDoDocumento(d) || '—'");
    });
    it('🚨 nenhuma linha de relatório recebe o emoji no número (a Helvetica do jsPDF não o tem)', () => {
        expect(src).not.toContain("'🚚 ' + ");
        expect(src).not.toMatch(/numero:\s*\(ehCte \? '🚚/);
    });
});

describe('as notas EXCLUÍDAS do livro também saem com número', () => {
    it('CT-e sem `numero` gravado sai nomeado pelo número da chave', () => {
        const empresa = '00005430000104';
        // Entrada DO EMITENTE (tpNF=0 de terceiro) — a causa 2 tira do livro.
        const doc = {
            chave: CHAVE_CTE, dhEmi: '2026-08-19', tpNF: '0', direcao: 'entrada',
            cnpjEmit: '45374898000104', xNomeEmit: 'TR CASSOL LTDA',
            cnpjDest: '11111111000191', xNomeDest: 'OUTRO',
            empresaCnpj: empresa, totais: { vNF: 4600 },
        };
        const r = escrituraveisNoLivroDeEntradas([doc], (d: any) => d, () => 4600, empresa);
        const todas = [...r.excluidas.map(e => e.numero), ...r.linhas.map((l: any) => numeroDoDocumento(l))];
        expect(todas).toContain('2589');
        expect(todas).not.toContain('—');
    });
});
