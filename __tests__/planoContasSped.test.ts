/**
 * 📗 PLANO DE CONTAS DO SPED (0500) COM USO + COD_CTA NO C170/A170/F100.
 *
 * ELS 08/2026, PVA de 28/09: 1259 recusas "cadastre e/ou selecione previamente
 * a conta contábil analítica representativa da operação, no registro 0500"
 * (1249 C170 + 6 A170 + F100). O app só tinha UMA conta (a da receita
 * financeira) e Paulo pôs nela a conta de VENDAS. Agora o cadastro é uma LISTA
 * com USO; o gerador emite um 0500 por conta e preenche o COD_CTA pelo lado
 * do documento. Sem conta, o campo fica vazio e o aviso diz QUAL uso falta.
 *
 * Fatos cobrados: a conferência (uma conta por uso, natureza do leiaute), a
 * escolha por uso, o 0500 por conta sem duplicar a legada, o COD_CTA do C170
 * (campo 37) e do A170 (campo 17), o aviso com uso e contagem, e os DOIS lados
 * do cadastro (whitelist da rota + editor no modal).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    USOS_PLANO_CONTAS, NATUREZAS_CONTA, conferirPlanoContasSped, contaDoUso,
    contas0500DoPlano, criarSeletorDeConta,
} from '../sefaz-backend/plano-contas-sped.js';
import { buildBlocoA, buildBlocoC_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error módulo .js puro sem tipos
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

const RAIZ = join(__dirname, '..');
const campos = (l: string) => l.trim().split('|');
const reg = (linhas: string[], r: string) => linhas.filter((l) => l.startsWith(`|${r}|`));

const PLANO = [
    { codigo: '3.1.1.01.0002', nome: 'VENDAS DE MERCADORIAS', nivel: '5', uso: 'receita-vendas' as const },
    { codigo: '1.1.3.01.0001', nome: 'ESTOQUE DE MERCADORIAS', nivel: '5', uso: 'compras' as const },
    { codigo: '4.1.2.01.0003', nome: 'SERVICOS TOMADOS', nivel: '5', natureza: '04', uso: 'servicos-tomados' as const },
];

describe('conferirPlanoContasSped — uma conta por uso, natureza do leiaute', () => {
    it('lista válida sai normalizada, com a natureza padrão do uso quando não informada', () => {
        const r = conferirPlanoContasSped(PLANO);
        expect(r.ok).toBe(true);
        expect(r.contas.map((c) => c.natureza)).toEqual(['04', '01', '04']);
        expect(r.contas[0]).toEqual({ codigo: '3.1.1.01.0002', nome: 'VENDAS DE MERCADORIAS', nivel: '5', natureza: '04', uso: 'receita-vendas' });
    });

    it('linha totalmente vazia cai fora; lista ausente é ok e vazia', () => {
        expect(conferirPlanoContasSped([{ codigo: '', nome: '', nivel: '', uso: '' }]).contas).toEqual([]);
        expect(conferirPlanoContasSped(undefined)).toEqual({ ok: true, erros: [], contas: [] });
        expect(conferirPlanoContasSped('x').ok).toBe(false);
    });

    it('recusa código vazio, nível fora de 1–99, natureza fora do leiaute, uso desconhecido e uso repetido', () => {
        const r = conferirPlanoContasSped([
            { codigo: '', nome: 'X', nivel: '5', uso: 'compras' },
            { codigo: 'A', nome: 'X', nivel: 'abc', uso: 'compras' },
            { codigo: 'B', nome: 'X', nivel: '5', natureza: '07', uso: 'receita-vendas' },
            { codigo: 'C', nome: 'X', nivel: '5', uso: 'despesa-qualquer' },
        ]);
        expect(r.ok).toBe(false);
        expect(r.erros.some((e) => /CÓDIGO/.test(e))).toBe(true);
        expect(r.erros.some((e) => /NÍVEL/.test(e))).toBe(true);
        expect(r.erros.some((e) => /natureza "07"/.test(e))).toBe(true);
        expect(r.erros.some((e) => /USO/.test(e))).toBe(true);
        expect(r.erros.some((e) => /já tem conta/.test(e))).toBe(true);
    });

    it('as naturezas são as seis do Guia (0500 campo 03) e todo uso tem natureza padrão válida', () => {
        expect(Object.keys(NATUREZAS_CONTA).sort()).toEqual(['01', '02', '03', '04', '05', '09']);
        for (const u of Object.values(USOS_PLANO_CONTAS)) expect(NATUREZAS_CONTA[u.naturezaPadrao]).toBeTruthy();
    });

    it('contaDoUso acha a conta do uso e devolve null sem ela', () => {
        expect(contaDoUso(PLANO, 'compras')?.codigo).toBe('1.1.3.01.0001');
        expect(contaDoUso(PLANO, 'receita-financeira')).toBeNull();
        expect(contaDoUso(undefined, 'compras')).toBeNull();
    });
});

describe('contas0500DoPlano — um 0500 por código, a conta legada sem duplicar', () => {
    const legado = { codigo: '3.1.1.01.0002', nome: 'VENDAS DE MERCADORIA A PRAZO', nivel: '5' };

    it('a conta legada da receita financeira entra quando o plano não traz esse uso', () => {
        const out = contas0500DoPlano({ plano: [PLANO[1]], ano: '2026', legadoReceitaFinanceira: legado });
        expect(out.map((c) => c.uso)).toEqual(['compras', 'receita-financeira']);
        expect(out[0]).toMatchObject({ dtAlt: '01012026', codNatCc: '01', indCta: 'A', nivel: '5', codCta: '1.1.3.01.0001' });
    });

    it('mesmo código no plano e no legado sai UMA vez (o caso da ELS: a conta de vendas nos dois lugares)', () => {
        const out = contas0500DoPlano({ plano: PLANO, ano: '2026', legadoReceitaFinanceira: legado });
        expect(out.map((c) => c.codCta)).toEqual(['3.1.1.01.0002', '1.1.3.01.0001', '4.1.2.01.0003']);
    });

    it('com receita-financeira no plano, o legado não entra', () => {
        const plano = [...PLANO, { codigo: '3.2.1.01.0001', nome: 'RENDIMENTOS', nivel: '5', uso: 'receita-financeira' as const }];
        const out = contas0500DoPlano({ plano, ano: '2026', legadoReceitaFinanceira: { codigo: '9.9.9', nome: 'X', nivel: '1' } });
        expect(out.some((c) => c.codCta === '9.9.9')).toBe(false);
        expect(out).toHaveLength(4);
    });
});

describe('criarSeletorDeConta — COD_CTA por uso e a contagem do que ficou sem', () => {
    it('devolve o código do uso, vazio sem conta, e o aviso nomeia o uso e quantos itens', () => {
        const sel = criarSeletorDeConta(PLANO);
        expect(sel.codCta('compras')).toBe('1.1.3.01.0001');
        expect(sel.codCta('receita-servicos')).toBe('');
        expect(sel.codCta('receita-servicos')).toBe('');
        const aviso = sel.aviso();
        expect(aviso).toContain('2 item(ns)');
        expect(aviso).toContain(USOS_PLANO_CONTAS['receita-servicos'].onde);
        expect(aviso).toContain('0500');
    });

    it('plano completo para o que foi pedido → aviso null', () => {
        const sel = criarSeletorDeConta(PLANO);
        sel.codCta('compras'); sel.codCta('receita-vendas');
        expect(sel.aviso()).toBeNull();
    });
});

// ─── O gerador: 0500 por conta, C170 campo 37, A170 campo 17 ─────────────────
const nfe = (numero: number, direcao: 'saida' | 'entrada', vProd: number) => ({
    tipo: 'NFe', direcao, numero: String(numero), modFrete: '9',
    chave: `3526080000543000010455001000${String(numero).padStart(6, '0')}1000000001`,
    dataEmissao: '2026-08-10', cnpjEmit: direcao === 'saida' ? '65671243000105' : '00005430000104',
    cnpjDest: direcao === 'saida' ? '00005430000104' : '65671243000105',
    itens: [{
        nItem: 1, codigo: 'P1', descricao: 'Banana', cfop: direcao === 'saida' ? '5102' : '1102', ncm: '08039000',
        unidade: 'KG', quantidade: 1, vUnCom: vProd, vProd, vDesc: 0, cstPis: '01', cstCofins: '01', vPIS: 0, vCOFINS: 0, vICMS: 0,
    }],
});
const nfse = (numero: number, direcao: 'saida' | 'entrada') => ({
    tipo: 'NFSe', direcao, numero: String(numero), dataEmissao: '2026-08-10', status: 'autorizado',
    cnpjEmit: direcao === 'saida' ? '65671243000105' : '00621930000162',
    cnpjDest: direcao === 'saida' ? '00621930000162' : '65671243000105',
    valorTotal: 1000,
});
const empresa = { cnpj: '65671243000105', nome: 'ELS' };

describe('C170 campo 37 e A170 campo 17 saem do plano; sem conta, vazio e DITO', () => {
    it('C170: venda → receita-vendas; compra → compras', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoC_Contrib({
            empresa, notas: [nfe(1, 'saida', 100), nfe(2, 'entrada', 50)], regimeApuracao: '1', warnings, planoContasSped: PLANO,
        });
        const c170 = reg(linhas, 'C170').map(campos);
        expect(c170).toHaveLength(2);
        expect(c170.map((c) => c[37])).toEqual(['3.1.1.01.0002', '1.1.3.01.0001']);
        expect(warnings.filter((w) => /COD_CTA/.test(w))).toEqual([]);
    });

    it('C170 sem plano: campo 37 vazio e UM aviso do bloco C dizendo o uso e a contagem', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoC_Contrib({ empresa, notas: [nfe(1, 'saida', 100), nfe(2, 'saida', 100)], regimeApuracao: '1', warnings });
        expect(reg(linhas, 'C170').map((l) => campos(l)[37])).toEqual(['', '']);
        const avisos = warnings.filter((w) => /COD_CTA vazio/.test(w));
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toContain('2 item(ns)');
        expect(avisos[0]).toContain(USOS_PLANO_CONTAS['receita-vendas'].onde);
    });

    it('A170: NFS-e tomada → servicos-tomados; emitida sem conta → vazio e dito', () => {
        const warnings: string[] = [];
        const linhas: string[] = buildBlocoA({
            empresa, notas: [nfse(1, 'entrada'), nfse(2, 'saida')], regimeApuracao: '1', warnings, planoContasSped: PLANO,
        });
        const a170 = reg(linhas, 'A170').map(campos);
        expect(a170).toHaveLength(2);
        expect(a170.map((c) => c[17])).toEqual(['4.1.2.01.0003', '']);
        const avisos = warnings.filter((w) => /COD_CTA vazio/.test(w));
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toContain(USOS_PLANO_CONTAS['receita-servicos'].onde);
    });

    it('bloco 0: um 0500 por conta do plano, e a conta legada da receita financeira não duplica', () => {
        const linhas: string[] = buildBloco0Contrib({
            empresa, competencia: '2026-08', regimeApuracao: '1', notas: [], itens: [], unidades: [], participantes: [],
            contaContabilReceitaFinanceira: '3.1.1.01.0002', contaContabilReceitaFinanceiraNome: 'VENDAS', contaContabilReceitaFinanceiraNivel: '5',
            planoContasSped: PLANO, warnings: [],
        });
        const r0500 = reg(linhas, '0500').map(campos);
        expect(r0500.map((c) => c[6])).toEqual(['3.1.1.01.0002', '1.1.3.01.0001', '4.1.2.01.0003']);
        expect(r0500.map((c) => c[3])).toEqual(['04', '01', '04']);
        // REG + 8 campos (o 0500 do Contribuições termina no NOME_CTA_REF; o do ICMS/IPI tem COD_CCUS a mais).
        for (const c of r0500) { expect(c[4]).toBe('A'); expect(c.length - 2).toBe(9); }
    });
});

// ─── Os DOIS lados do cadastro ────────────────────────────────────────────────
describe('o plano de contas tem rota que grava E tela que edita', () => {
    const rota = readFileSync(join(RAIZ, 'sefaz-backend/empresa-status-routes.js'), 'utf8');
    const modal = readFileSync(join(RAIZ, 'components/EmpresaDadosFiscaisModal.tsx'), 'utf8');

    it('a rota aceita `planoContasSped` na whitelist e o confere antes de gravar', () => {
        const m = /CAMPOS_DADOS_FISCAIS\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(rota);
        expect(m && m[1]).toContain("'planoContasSped'");
        expect(rota).toContain('conferirPlanoContasSped(');
    });

    it('o modal edita a lista e oferece TODOS os usos do módulo', () => {
        expect(modal).toContain("handleField('planoContasSped'");
        expect(modal).toContain('USOS_PLANO_CONTAS');
        expect(modal).toContain('NATUREZAS_CONTA');
    });
});
