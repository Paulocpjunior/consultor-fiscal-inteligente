/**
 * 📅 DATA DE ENTRADA E COMPETÊNCIA DE ESCRITURAÇÃO (Paulo, 29/09, print do
 * SAGE IOB "Emissão 30/07/2026 · Entrada 01/08/2026": *"nota do mês anterior
 * que foi escriturada no 08, no consultor não temos essa opção"*).
 *
 * Fatos cobrados: a competência de escrituração é a da ENTRADA quando há (só
 * na entrada); entrada antes da emissão é recusa; o patch move a competência
 * e guarda a da emissão, e limpar devolve; a nota digitada nasce na
 * competência da entrada; o C100 dos DOIS arquivos escreve DT_E_S pela
 * entrada; o SAGE escreve DATA DE ENTRADA/SAÍDA e LANÇAMENTO pela entrada; o
 * reimport preserva a decisão; a tela tem os dois lados (digitação e
 * documento capturado).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    competenciaDeEscrituracao, conferirDataEntrada, patchDataEntrada, dataEntradaDoDocumento,
} from '../sefaz-backend/data-entrada-escrituracao.js';
import { buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
import { montarNotaDigitada, validarNotaDigitada } from '../services/notaDigitada';
import { exportarParaIobSage } from '../services/iobSageExportService';

const RAIZ = join(__dirname, '..');
const campos = (l: string) => l.trim().split('|');

describe('a régua: competência de escrituração', () => {
    it('entrada com data de entrada → mês da entrada; sem ela → mês da emissão; saída ignora', () => {
        expect(competenciaDeEscrituracao({ direcao: 'entrada', dhEmi: '2026-07-30T10:00:00-03:00', dataEntrada: '2026-08-01' })).toBe('2026-08');
        expect(competenciaDeEscrituracao({ direcao: 'entrada', dhEmi: '2026-07-30T10:00:00-03:00' })).toBe('2026-07');
        expect(competenciaDeEscrituracao({ direcao: 'saida', dhEmi: '2026-07-30', dataEntrada: '2026-08-01' })).toBe('2026-07');
        expect(competenciaDeEscrituracao({ direcao: 'entrada', dhEmi: '30/07/2026', dataEntrada: '01/08/2026' })).toBe('2026-08');
    });

    it('conferir: ok e mudaCompetencia; entrada antes da emissão é recusa; saída com data é recusa; ilegível é recusa', () => {
        const ok = conferirDataEntrada({ direcao: 'entrada', dhEmi: '2026-07-30', dataEntrada: '2026-08-01' });
        expect(ok).toMatchObject({ ok: true, dataEntrada: '2026-08-01', competencia: '2026-08', competenciaEmissao: '2026-07', mudaCompetencia: true });
        expect(conferirDataEntrada({ direcao: 'entrada', dhEmi: '2026-08-10', dataEntrada: '2026-08-12' }).mudaCompetencia).toBe(false);
        const antes = conferirDataEntrada({ direcao: 'entrada', dhEmi: '2026-07-30', dataEntrada: '2026-07-29' });
        expect(antes.ok).toBe(false);
        expect(antes.erros[0]).toMatch(/anterior à emissão/);
        expect(conferirDataEntrada({ direcao: 'saida', dhEmi: '2026-07-30', dataEntrada: '2026-08-01' }).ok).toBe(false);
        expect(conferirDataEntrada({ direcao: 'entrada', dhEmi: '2026-07-30', dataEntrada: 'ontem' }).ok).toBe(false);
        expect(conferirDataEntrada({ direcao: 'entrada', dhEmi: '2026-07-30', dataEntrada: '' })).toMatchObject({ ok: true, dataEntrada: '', competencia: '2026-07' });
    });

    it('patch: move a competência e guarda a da emissão UMA vez; limpar devolve à emissão', () => {
        const doc = { direcao: 'entrada', dhEmi: '2026-07-30T22:30:00-03:00', competencia: '2026-07' };
        const r = patchDataEntrada({ doc, dataEntrada: '2026-08-01', autor: { email: 'sandra@sp.com' } });
        expect(r.ok).toBe(true);
        expect(r.patch).toMatchObject({ dataEntrada: '2026-08-01', competencia: '2026-08', competenciaEmissao: '2026-07', dataEntradaDefinidaPor: 'sandra@sp.com' });
        const movido = { ...doc, ...r.patch };
        const r2 = patchDataEntrada({ doc: movido, dataEntrada: '2026-09-02', autor: {} });
        expect(r2.patch).toMatchObject({ competencia: '2026-09', competenciaEmissao: '2026-07' });
        const limpo = patchDataEntrada({ doc: { ...movido, ...r2.patch }, dataEntrada: '', autor: {} });
        expect(limpo.patch).toMatchObject({ dataEntrada: '', competencia: '2026-07', competenciaEmissao: '2026-07' });
        expect(patchDataEntrada({ doc, dataEntrada: '2026-07-01' }).ok).toBe(false);
        expect(dataEntradaDoDocumento(movido)).toBe('2026-08-01');
        expect(dataEntradaDoDocumento(doc)).toBe('');
    });
});

// ─── A nota digitada ─────────────────────────────────────────────────────────
const digitada = (extra: Record<string, unknown> = {}) => ({
    empresaId: 'emp1', empresaCnpj: '65671243000105', empresaNome: 'ELS', direcao: 'entrada' as const,
    numero: '25824', serie: '1', dhEmi: '2026-07-30', participanteNome: 'WALDESA MOTOMERCANTIL', participanteDoc: '05049535000332', participanteUf: 'RJ',
    valorTotal: 1741.6, itens: [{ cfop: '2152', descricao: 'Peças', vProd: 1741.6 }], digitadaPorEmail: 'x@sp.com', createdByUid: 'uid1',
    ...extra,
});

describe('a nota digitada de entrada nasce na competência da ENTRADA', () => {
    it('emissão 30/07, entrada 01/08 → competencia 2026-08, competenciaEmissao 2026-07, dataEntrada gravada', () => {
        const i = digitada({ dataEntrada: '2026-08-01' });
        expect(validarNotaDigitada(i as any)).toEqual([]);
        const doc = montarNotaDigitada(i as any) as any;
        expect(doc.competencia).toBe('2026-08');
        expect(doc.competenciaEmissao).toBe('2026-07');
        expect(doc.dataEntrada).toBe('2026-08-01');
        expect(doc.dhEmi).toBe('2026-07-30');
    });

    it('sem data de entrada: tudo como antes (competência da emissão, sem o campo)', () => {
        const doc = montarNotaDigitada(digitada() as any) as any;
        expect(doc.competencia).toBe('2026-07');
        expect('dataEntrada' in doc).toBe(false);
    });

    it('entrada antes da emissão é recusada na validação, com a causa', () => {
        const erros = validarNotaDigitada(digitada({ dataEntrada: '2026-07-01' }) as any);
        expect(erros.some((e) => /anterior à emissão/.test(e))).toBe(true);
    });

    it('serviço e transporte digitados seguem a mesma régua', () => {
        const nfse = montarNotaDigitada(digitada({ especie: 'servico', servico: { discriminacao: 'x' }, itens: [], dataEntrada: '2026-08-03' }) as any) as any;
        const cte = montarNotaDigitada(digitada({ especie: 'transporte', transporte: { modelo: '57', cfop: '2353' }, itens: [], dataEntrada: '2026-08-03' }) as any) as any;
        expect(nfse.competencia).toBe('2026-08');
        expect(cte.competencia).toBe('2026-08');
    });
});

// ─── C100 DT_E_S nos dois arquivos ───────────────────────────────────────────
const nfeEntrada = (extra: Record<string, unknown> = {}) => ({
    tipo: 'NFe', modelo: '55', direcao: 'entrada', numero: '25824', serie: '1', modFrete: '9', tpNF: '1',
    chave: '33260705049535000332550010000258241000000015',
    dhEmi: '2026-07-30T10:00:00-03:00', dataEmissao: '2026-07-30', cnpjEmit: '05049535000332', cnpjDest: '65671243000105',
    emitente: { cnpj: '05049535000332', nome: 'WALDESA', uf: 'RJ' }, destinatario: { cnpj: '65671243000105' },
    totais: { vNF: 1741.6, vProd: 1741.6, vDesc: 0 },
    itens: [{ nItem: 1, codigo: 'P1', descricao: 'Peça', cfop: '2152', ncm: '87089990', unidade: 'UN', quantidade: 1, vUnCom: 1741.6, vProd: 1741.6, vDesc: 0, cstPis: '50', cstCofins: '50', vPIS: 0, vCOFINS: 0, vICMS: 208.99, vBC: 1741.6 }],
    ...extra,
});

describe('C100: DT_DOC é a emissão e DT_E_S é a ENTRADA', () => {
    it('EFD-Contribuições', () => {
        const linhas: string[] = buildBlocoC_Contrib({ empresa: { cnpj: '65671243000105' }, notas: [nfeEntrada({ dataEntrada: '2026-08-01' })], regimeApuracao: '1', warnings: [] });
        const c = campos(linhas.find((l) => l.startsWith('|C100|')) as string);
        expect(c[10]).toBe('30072026');
        expect(c[11]).toBe('01082026');
    });

    it('EFD-Contribuições sem data de entrada: DT_E_S continua na emissão', () => {
        const linhas: string[] = buildBlocoC_Contrib({ empresa: { cnpj: '65671243000105' }, notas: [nfeEntrada()], regimeApuracao: '1', warnings: [] });
        const c = campos(linhas.find((l) => l.startsWith('|C100|')) as string);
        expect(c[11]).toBe('30072026');
    });

    it('EFD ICMS/IPI: a data de entrada vence o dhSaiEnt do emitente', () => {
        const linhas: string[] = buildBlocoC({
            empresa: { cnpj: '65671243000105', dadosFiscais: { uf: 'BA' } }, competencia: '2026-08',
            notas: [nfeEntrada({ dataEntrada: '2026-08-01', dhSaiEnt: '2026-07-31T08:00:00-03:00' })], warnings: [],
        });
        const c = campos(linhas.find((l) => l.startsWith('|C100|')) as string);
        expect(c[10]).toBe('30072026');
        expect(c[11]).toBe('01082026');
    });
});

// ─── SAGE IOB: DATA DE ENTRADA/SAÍDA e LANÇAMENTO pela entrada ───────────────
describe('SAGE IOB (E200): a entrada sai com a data de entrada', () => {
    it('DATA DE ENTRADA/SAÍDA e DATA DE LANÇAMENTO = entrada; DATA DE EMISSÃO = emissão', () => {
        const doc = { ...nfeEntrada({ dataEntrada: '2026-08-01' }), id: 'd1', empresaCnpj: '65671243000105', empresaId: 'emp1', status: 'autorizado', competencia: '2026-08',
            emitente: { cnpjCpf: '05049535000332', nome: 'WALDESA', uf: 'RJ', logradouro: 'RUA A', numero: '1', bairro: 'C', codMunIBGE: '3304557' }, destinatario: { cnpjCpf: '65671243000105', nome: 'ELS', uf: 'BA' } };
        const r = exportarParaIobSage({ documentos: [doc as any], empresaCnpj: '65671243000105', numeroEmpresaEfiscal: 1 });
        const e200 = r.conteudo.split(/\r?\n/).find((l) => l.startsWith('E200'));
        expect(r.falhas).toEqual([]);
        expect(e200).toBeDefined();
        // Leiaute IOB: DATA DE EMISSÃO nas posições 56–63, DATA DE ENTRADA/SAÍDA 64–71.
        expect((e200 as string).slice(55, 63)).toBe('20260730');
        expect((e200 as string).slice(63, 71)).toBe('20260801');
        expect((e200 as string).indexOf('20260801', 71)).toBeGreaterThan(-1); // DATA DE LANÇAMENTO NO SISTEMA
    });
});

// ─── Os dois lados e o reimport ──────────────────────────────────────────────
describe('a decisão tem tela nos dois lados e sobrevive ao reimport', () => {
    it('a digitação tem o campo, o documento capturado tem a ação, e o serviço grava pelo dono', () => {
        const form = readFileSync(join(RAIZ, 'components/xml/NotaDigitadaForm.tsx'), 'utf8');
        const detalhe = readFileSync(join(RAIZ, 'components/xml/XmlDocumentoDetalhe.tsx'), 'utf8');
        const servico = readFileSync(join(RAIZ, 'services/xmlFiscalService.ts'), 'utf8');
        expect(form).toContain('Data de entrada (escrituração)');
        expect(form).toMatch(/dataEntrada:\s*direcao === 'entrada'/);
        expect(detalhe).toContain('definirDataEntradaDaNota(');
        expect(servico).toContain('patchDataEntrada({');
    });

    it('o importador preserva dataEntrada e a competência de escrituração ao regravar o documento', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/xml-importer.js'), 'utf8');
        const i = src.indexOf('if (ex.dataEntrada)');
        expect(i).toBeGreaterThan(-1);
        const trecho = src.slice(i, i + 400);
        expect(trecho).toContain('docData.dataEntrada = ex.dataEntrada');
        expect(trecho).toContain('competenciaDeEscrituracao(');
    });
});
