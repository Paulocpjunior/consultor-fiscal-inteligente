// ============================================================================
// 🏦 DeRE — o INSUMO CONTÁBIL (plano de contas + balancete) lido da planilha.
//
// Nasceu do arquivo de TESTE do Paulo (27/09/2026). O que estes testes travam
// vem da MEDIÇÃO daquele arquivo, reproduzida aqui com contas FICTÍCIAS (dado
// de cliente não entra no repo): hierarquia por PREFIXO com segmentos de
// tamanho variável; sinal do saldo pela natureza da RAIZ (retificadora "(-)"
// tipo C sai NEGATIVA e a aritmética só fecha lendo pela raiz); compensação e
// apuração FORA do PGCC, contadas; PL reconhecido pelo NOME do grupo; nome
// cortado em 100 DITO; ausência de valor nunca vira zero.
// ============================================================================
import {
    lerPlanoDeContas, lerBalancete, natSaldoPelaRaiz, conferirAritmeticaDaLinha, lerNumeroCelula, cCtaDe, competenciaDoTitulo,
} from '../sefaz-backend/dere-insumo-contabil';

export const PLANO_FICTICIO: unknown[][] = [
    ['EMPRESA FICTÍCIA - PLANO DE CONTAS - Exercício', null, null, null, null],
    ['Cód. Reduzido', 'Conta Contábil', 'Descrição', 'Conta de Lançamento(S/N)', 'Tipo de Conta (C/D)'],
    ['000001', '1', 'ATIVO', 'N', 'D'],
    ['000002', '12', 'ATIVO CIRCULANTE', 'N', 'D'],
    ['000003', '121', 'DISPONÍVEL', 'N', 'D'],
    ['000004', '1211', 'CAIXA', 'N', 'D'],
    ['000005', '1211.9', 'Caixa', 'N', 'D'],
    ['000006', '1211.901', 'Caixa geral', 'S', 'D'],
    ['000007', '13', 'ATIVO NÃO CIRCULANTE', 'N', 'D'],
    ['000008', '131', 'IMOBILIZADO', 'N', 'D'],
    ['000009', '131.9', 'Depreciação', 'N', 'C'],
    ['000010', '131.901', '(-) Depreciação acumulada', 'S', 'C'],
    ['000011', '19', 'COMPENSAÇÃO - ATIVO', 'N', 'D'],
    ['000012', '191', 'Bens de terceiros em nosso poder', 'S', 'D'],
    ['000013', '2', 'PASSIVO', 'N', 'C'],
    ['000014', '21', 'PASSIVO CIRCULANTE', 'N', 'C'],
    ['000015', '211', 'FORNECEDORES', 'N', 'C'],
    ['000016', '211.901', 'Fornecedores nacionais', 'S', 'C'],
    ['000017', '25', 'PATRIMÔNIO LÍQUIDO / PATRIMÔNIO SOCIAL', 'N', 'C'],
    ['000018', '251', 'CAPITAL SOCIAL', 'N', 'C'],
    ['000019', '251.901', 'Capital subscrito', 'S', 'C'],
    ['000020', '3', 'RECEITAS', 'N', 'C'],
    ['000021', '31', 'RECEITAS COM OPERAÇÕES DE ASSISTÊNCIA À SAÚDE', 'N', 'C'],
    ['000022', '311', 'Contraprestações', 'N', 'C'],
    ['000023', '311.901', 'Contraprestações efetivas', 'S', 'C'],
    ['000024', '4', 'DESPESAS', 'N', 'D'],
    ['000025', '41', 'EVENTOS INDENIZÁVEIS LÍQUIDOS', 'N', 'D'],
    ['000026', '411', 'Despesas com eventos', 'N', 'D'],
    ['000027', '411.901', 'Despesas com eventos / sinistros conhecidos ou avisados de assistência médico-hospitalar — beneficiários de planos individuais', 'S', 'D'],
    ['000028', '411.902', '(-) Glosas', 'S', 'C'],
    ['000029', '6', 'CONTAS DE DESTINAÇÃO/APURAÇÃO DE RESULTADO', 'N', 'D'],
    ['000030', '69', 'APURAÇÃO DO RESULTADO', 'N', 'D'],
    ['000031', '691.901', 'Apuração do resultado do período', 'S', 'D'],
];

export const BALANCETE_FICTICIO: unknown[][] = [
    ['Balancete Analítico de Julho/2026', null, null, null, null, null],
    ['Código', 'Conta', 'Saldo Inicial', 'Débitos', 'Créditos', 'Saldo Final'],
    ['1', 'ATIVO', 700, 500, 250, 950],
    ['1211.901', 'Caixa geral', 1000, 500, 200, 1300],
    ['131.901', '(-) Depreciação acumulada', -300, 0, 50, -350],
    ['191', 'Bens de terceiros em nosso poder', 10, 0, 0, 10],
    ['211.901', 'Fornecedores nacionais', 800, 100, 300, 1000],
    ['251.901', 'Capital subscrito', 500, 0, 0, 500],
    ['311.901', 'Contraprestações efetivas', 2000, 0, 700, 2700],
    ['411.901', 'Despesas com eventos / sinistros', 900, 400, 0, 1300],
    ['411.902', '(-) Glosas', -100, 0, 30, -130],
    ['691.901', 'Apuração do resultado do período', 0, 0, 0, 0],
];

describe('lerPlanoDeContas — a planilha vira PGCC pela hierarquia por PREFIXO', () => {
    const p = lerPlanoDeContas(PLANO_FICTICIO);
    it('acha o cabeçalho pelo NOME das colunas (não pela posição) e lê todas as contas', () => {
        expect(p.ok).toBe(true);
        expect(p.colunas).toMatchObject({ codigo: 1, nome: 2, lancamento: 3, tipo: 4, reduzido: 0 });
        expect(p.resumo!.total + p.resumo!.foraDoPgcc).toBe(31);
    });
    it('o pai é o MAIOR código que é prefixo — segmentos de tamanho variável (1211.9 → 1211.901), nunca "tira um dígito"', () => {
        const c = Object.fromEntries(p.contas.map((x) => [x.codigo, x]));
        expect(c['1211.901']).toMatchObject({ cCta: '1211901', cCtaSup: '12119', nivelCta: 6, indCta: 'A' });
        expect(c['1211.9']).toMatchObject({ cCtaSup: '1211', nivelCta: 5, indCta: 'S' });
        expect(c['1']).toMatchObject({ cCtaSup: null, nivelCta: 1 });
        // Toda analítica tem pai sintético — a régua PAI_CTA_ANALITICA do Anexo II.
        for (const a of p.contas.filter((x) => x.indCta === 'A')) {
            expect(a.cCtaSup).toBeTruthy();
            expect(p.contas.find((x) => x.cCta === a.cCtaSup)!.indCta).toBe('S');
        }
    });
    it('{codNat} pela raiz: 1 ativo · 2 passivo · 3 PL (pelo NOME do grupo) · 4 receita · 5 despesa', () => {
        const c = Object.fromEntries(p.contas.map((x) => [x.codigo, x]));
        expect(c['1211.901'].codNat).toBe(1);
        expect(c['211.901'].codNat).toBe(2);
        expect(c['251.901'].codNat).toBe(3);
        expect(c['25'].codNat).toBe(3);
        expect(c['311.901'].codNat).toBe(4);
        expect(c['411.902'].codNat).toBe(5);
        expect(p.resumo!.porCodNat).toEqual({ 1: 10, 2: 4, 3: 3, 4: 4, 5: 5 });
    });
    it('COMPENSAÇÃO e APURAÇÃO ficam FORA do PGCC, contadas e ditas — o XSD não tem {codNat} para elas', () => {
        expect(p.foraDoPgcc.map((x) => [x.codigo, x.motivo])).toEqual([
            ['19', 'compensacao'], ['191', 'compensacao'],
            ['6', 'apuracao-do-resultado'], ['69', 'apuracao-do-resultado'], ['691.901', 'apuracao-do-resultado'],
        ]);
        expect(p.resumo).toMatchObject({ compensacao: 2, apuracao: 3, foraDoPgcc: 5 });
        expect(p.avisos.join(' ')).toMatch(/5 conta\(s\) FORA do PGCC: 2 de COMPENSAÇÃO, 3 de APURAÇÃO/);
        expect(p.avisos.join(' ')).toMatch(/não inventa código de natureza/);
    });
    it('a retificadora mantém o TIPO do plano (C) — o sinal do balancete é outra pergunta', () => {
        expect(p.contas.find((x) => x.codigo === '131.901')).toMatchObject({ natCta: 'C', codNat: 1 });
    });
    it('nome com mais de 100 caracteres é CORTADO em 100 e isso é DITO, contado', () => {
        const longa = p.contas.find((x) => x.codigo === '411.901')!;
        expect(longa.nome.length).toBe(100);
        expect(p.resumo!.nomesCortados).toBe(1);
        expect(p.avisos.join(' ')).toMatch(/1 descrição\(ões\) com mais de 100 caracteres foram CORTADAS/);
    });
    it('colunas OPCIONAIS (Conta Referencial, Código de Tributação) são lidas quando existem', () => {
        const linhas = PLANO_FICTICIO.map((r, i) => (i === 1 ? [...r, 'Conta Referencial', 'Código de Tributação'] : [...r, i > 1 ? '1211' : null, i === 7 ? '120110001' : null]));
        const q = lerPlanoDeContas(linhas);
        expect(q.ok).toBe(true);
        expect(q.contas.find((x) => x.codigo === '1211.901')).toMatchObject({ cCtaRef: '1211', codTrib: '120110001' });
        expect(q.resumo!.analiticasComCodTrib).toBe(1);
    });
    it('sem a coluna S/N não há como dizer {indCta} — recusa nomeando a coluna, nunca chuta sintética', () => {
        const semLanc = PLANO_FICTICIO.map((r) => [r[0], r[1], r[2], r[4]]).map((r, i) => (i === 1 ? ['Cód. Reduzido', 'Conta Contábil', 'Descrição', 'Tipo de Conta (C/D)'] : r));
        const q = lerPlanoDeContas(semLanc);
        expect(q.ok).toBe(false);
        expect(q.pendencias.join(' ')).toMatch(/Conta de Lançamento \(S\/N\)/);
        expect(q.contas).toEqual([]);
    });
    it('código repetido depois de tirar os pontos é recusa — {cCta} tem de ser único', () => {
        const q = lerPlanoDeContas([...PLANO_FICTICIO, ['000099', '12.11', 'Colide com 1211', 'N', 'D']]);
        expect(q.ok).toBe(false);
        expect(q.pendencias.join(' ')).toMatch(/repetido/);
    });
});

describe('lerBalancete — competência do título, números como números, sinal pela RAIZ', () => {
    const b = lerBalancete(BALANCETE_FICTICIO);
    it('lê a competência do título em português ("Julho/2026" → 2026-07) e todas as linhas', () => {
        expect(b.ok).toBe(true);
        expect(b.competencia).toBe('2026-07');
        expect(b.linhas.length).toBe(10);
        expect(competenciaDoTitulo([['Balancete de 07/2026']], 1)).toBe('2026-07');
        expect(competenciaDoTitulo([['Balancete 2026-03']], 1)).toBe('2026-03');
        expect(competenciaDoTitulo([['Balancete sem data']], 1)).toBeNull();
    });
    it('sinal pela natureza da RAIZ: positivo = natureza da raiz, negativo = a oposta — e a aritmética fecha assim', () => {
        // Retificadora do ativo, tipo C no plano, NEGATIVA no balancete: saldo CREDOR de 350 (não "devedor" pelo sinal nem "credor 300" pelo tipo).
        expect(natSaldoPelaRaiz('131901', -350)).toEqual({ nat: 'C', valor: 350, raiz: 'D' });
        expect(natSaldoPelaRaiz('1211901', 1300)).toEqual({ nat: 'D', valor: 1300, raiz: 'D' });
        expect(natSaldoPelaRaiz('211901', 1000)).toEqual({ nat: 'C', valor: 1000, raiz: 'C' });
        expect(natSaldoPelaRaiz('211901', -5)).toEqual({ nat: 'D', valor: 5, raiz: 'C' });
        // Sufixo D/C explícito na célula VENCE o sinal.
        expect(natSaldoPelaRaiz('1211901', 10, 'C')).toMatchObject({ nat: 'C', valor: 10 });
        for (const l of b.linhas) expect(conferirAritmeticaDaLinha(l).ok).toBe(true);
        expect(conferirAritmeticaDaLinha({ ...b.linhas[1], saldoFinal: 1200 })).toMatchObject({ ok: false, esperado: 1300 });
    });
    it('célula de valor vazia NÃO vira zero — a linha é recusada nomeando a coluna', () => {
        const q = lerBalancete(BALANCETE_FICTICIO.map((r, i) => (i === 3 ? [r[0], r[1], null, r[3], r[4], r[5]] : r)));
        expect(q.ok).toBe(false);
        expect(q.pendencias.join(' ')).toMatch(/saldoInicial.*vazio ou ilegível/);
    });
    it('lê número JS, texto pt-BR, texto com sufixo D/C e parênteses — e devolve null para o ilegível', () => {
        expect(lerNumeroCelula(1234.56)).toEqual({ valor: 1234.56, natureza: null });
        expect(lerNumeroCelula('1.234,56')).toEqual({ valor: 1234.56, natureza: null });
        expect(lerNumeroCelula('-1.234,56')).toEqual({ valor: -1234.56, natureza: null });
        expect(lerNumeroCelula('(200,00)')).toEqual({ valor: -200, natureza: null });
        expect(lerNumeroCelula('1.234,56 C')).toEqual({ valor: 1234.56, natureza: 'C' });
        expect(lerNumeroCelula('1234.56')).toEqual({ valor: 1234.56, natureza: null });
        expect(lerNumeroCelula('')).toEqual({ valor: null, natureza: null });
        expect(lerNumeroCelula('abc')).toEqual({ valor: null, natureza: null });
    });
    it('cCtaDe tira pontos/traços/barras e recusa o que não é alfanumérico', () => {
        expect(cCtaDe('21111.1031.10691')).toBe('21111103110691');
        expect(cCtaDe('1.2-3/4 5')).toBe('12345');
        expect(cCtaDe('12@3')).toBeNull();
        expect(cCtaDe('')).toBeNull();
    });
});
