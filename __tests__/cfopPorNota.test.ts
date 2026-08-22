// ============================================================================
// ✏️ CFOP POR NOTA — o "campo para lançamento das notas escrituradas".
//
// Paulo, 17/08, com o Resumo por CFOP do CFI ao lado do livro de Entradas do
// E-Fiscal: *"é necessário incluir um campo para lançamento das notas
// escrituradas, a fim de corrigir esses detalhes e facilitar a conferência"*.
// Perguntei se era por NOTA ou por ITEM — ele respondeu: **"é por NF"**.
//
// ═══ A TRAVA QUE MAIS IMPORTA AQUI ══════════════════════════════════════════
//
// Campo novo que só UMA tela honra é o defeito que este projeto mais pagou (o
// `condicaoRural` descartado pela whitelist, o E510 pronto que ninguém gerava,
// a rota de fechamento sem botão). Um CFOP corrigido na tela e ignorado pelo
// ARQUIVO seria pior que não ter o campo: a conferência daria certo e o SPED
// sairia com o CFOP velho.
//
// Por isso a régua mora num lugar só (`cfopDoLancamento`) e este teste VARRE os
// leitores exigindo que todos passem o DOCUMENTO — não só o CFOP do item.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    cfopDoLancamento, origemDoCfopLancamento, cfopsDistintosDaNota, validarCfopEscriturado,
} from '../sefaz-backend/cfop-correlacao.js';

const RAIZ = join(__dirname, '..');
const ctx = { naturezaAtividade: 'comercio' };

describe('a precedência: NF > empresa > régua automática', () => {
    it('sem nada informado, vale a régua', () => {
        expect(cfopDoLancamento({}, '5151', 'entrada', ctx)).toBe('1152');
    });

    it('override da EMPRESA vence a régua', () => {
        expect(cfopDoLancamento({}, '5151', 'entrada', { ...ctx, cfopOverrides: { '5151': '1949' } }))
            .toBe('1949');
    });

    it('🚨 o CFOP informado NA NF vence os dois — é o mais específico', () => {
        const doc = { cfopEscriturado: '1202' };
        expect(cfopDoLancamento(doc, '5151', 'entrada', { ...ctx, cfopOverrides: { '5151': '1949' } }))
            .toBe('1202');
    });

    it('e vale para TODOS os itens da nota (foi o que o dono pediu)', () => {
        const doc = { cfopEscriturado: '1102', itens: [{ cfop: '5102' }, { cfop: '5405' }] };
        expect(cfopDoLancamento(doc, '5102', 'entrada', ctx)).toBe('1102');
        expect(cfopDoLancamento(doc, '5405', 'entrada', ctx)).toBe('1102');
    });

    it('campo em branco devolve a nota à régua — não vira CFOP vazio', () => {
        expect(cfopDoLancamento({ cfopEscriturado: '' }, '5151', 'entrada', ctx)).toBe('1152');
        expect(cfopDoLancamento({ cfopEscriturado: '  ' }, '5151', 'entrada', ctx)).toBe('1152');
    });
});

describe('a ORIGEM vai junto do número — sem ela ninguém confere', () => {
    it('diz quando veio da NF, e de quem', () => {
        const o = origemDoCfopLancamento(
            { cfopEscriturado: '1202', cfopEscrituradoPor: 'colab@sp.com.br', cfopEscrituradoEm: '2026-08-17T12:00:00Z' },
            '5151', 'entrada', ctx,
        );
        expect(o.origem).toBe('nota');
        expect(o.por).toBe('colab@sp.com.br');
    });

    it('distingue override da empresa de correlação automática', () => {
        expect(origemDoCfopLancamento({}, '5151', 'entrada', { ...ctx, cfopOverrides: { '5151': '1949' } }).origem)
            .toBe('empresa');
        expect(origemDoCfopLancamento({}, '5151', 'entrada', ctx).origem).toBe('regra');
    });
});

describe('🚨 nota MISTA: a consequência é DITA antes do clique', () => {
    it('lista os CFOPs distintos que o carimbo vai colapsar', () => {
        const doc = { itens: [{ cfop: '5102' }, { cfop: '5405' }, { cfop: '5102' }] };
        expect(cfopsDistintosDaNota(doc, 'entrada', ctx)).toEqual(['1102', '1403']);
    });

    it('nota de um CFOP só não vira alarme — alarme sem ação é o que se aprende a ignorar', () => {
        expect(cfopsDistintosDaNota({ itens: [{ cfop: '5102' }, { cfop: '5102' }] }, 'entrada', ctx))
            .toEqual(['1102']);
    });
});

describe('🚨 CFOP digitado não entra torto', () => {
    it('entrada recusa CFOP de saída — e DIZ por quê', () => {
        const r = validarCfopEscriturado('5102', 'entrada') as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/ENTRADA/);
        expect(r.motivo).toMatch(/1, 2 ou 3/);
    });

    it('saída recusa CFOP de entrada', () => {
        const r = validarCfopEscriturado('1102', 'saida') as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/SAÍDA/);
    });

    it('tamanho errado é recusado com o número de dígitos na frase', () => {
        const r = validarCfopEscriturado('110', 'entrada') as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/tem 3/);
    });

    it('vazio é ACEITO — é o caminho de volta para a régua automática', () => {
        const r = validarCfopEscriturado('', 'entrada') as any;
        expect(r.ok).toBe(true);
        expect(r.cfop).toBe('');
    });

    it('máscara com ponto é aceita — quem digita lê 1.102 no livro', () => {
        expect((validarCfopEscriturado('1.102', 'entrada') as any).cfop).toBe('1102');
    });
});

describe('🚨 TODOS os leitores honram o campo — campo que uma tela só honra é pior que não ter', () => {
    const leitor = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

    // ⚠️ COMO O TESTE DO SAGE, este travava a FORMA LITERAL e reprovou a
    // correção de 22/08, que trocou `d.direcao` por `direcaoDoc(d)` (a direção
    // gravada mente na nota própria de entrada). O que ele garante é a
    // INTENÇÃO: o DOCUMENTO chega como 1º argumento, senão o CFOP informado na
    // NF não vence a régua automática.
    it('Resumo por CFOP e Por produto passam o DOCUMENTO', () => {
        const f = leitor('services/relatoriosAgregacoes.ts');
        expect((f.match(/cfopDoLancamento\(d, cru, [^,]+, ctx\)/g) || []).length).toBe(2);
        // E a direção não volta a ser lida crua nessas chamadas.
        expect(f).not.toMatch(/cfopDoLancamento\(d, cru, d\.direcao/);
    });

    it('Livro de Entradas/Saídas passa o documento', () => {
        expect(leitor('components/Relatorios/index.tsx')).toMatch(/cfopDoLancamento\(d, c, direcao,/);
    });

    // ⚠️ ESTE TESTE TRAVAVA A FORMA LITERAL DA CHAMADA e por isso reprovou a
    // própria correção de 22/08, que trocou `d.direcao` por `direcaoDoDoc(d)`
    // (a direção gravada MENTE na nota própria de entrada — art. 136). O que
    // ele existe para garantir é a INTENÇÃO: o DOCUMENTO chega como 4º
    // argumento, senão o CFOP informado na NF não vence o override. Travar a
    // fonte impediria a correção — é a mesma troca do IND_REG_CUM, que
    // prendia o '9' no texto do arquivo.
    it('Exportar SAGE passa o documento nas DUAS saídas (.FML e planilha)', () => {
        const f = leitor('services/iobSageExportService.ts');
        expect((f.match(/cfopParaEscriturar\(it\.cfop, [^,]+, ctxCfop, d\)/g) || []).length).toBe(2);
        // E a direção NÃO pode voltar a ser lida crua nessas duas chamadas.
        expect(f).not.toMatch(/cfopParaEscriturar\(it\.cfop, d\.direcao/);
    });

    // ⚠️ QUARTA VEZ QUE ESTA TRAVA LITERAL MORDE (22/08). Ela prendia
    // `nota.direcao` no texto — e esse campo É o defeito: a nota PRÓPRIA de
    // entrada fica gravada como 'saida', então a correlação devolvia **5102**
    // no C170 e no C190 do SPED enquanto o `.FML` gravava 1102.
    //
    // O que ela existe para garantir é a INTENÇÃO: o DOCUMENTO chega à
    // correlação (senão o CFOP informado na NF é ignorado) e a direção vem da
    // RÉGUA. Trava que prende a FORMA impede a correção que a régua manda.
    it('SPED C170 e C190 passam a nota, e a direção vem da RÉGUA', () => {
        const f = leitor('sefaz-backend/sped-fiscal-blocoC.js');
        expect(f).toMatch(/convertCfopParaEntrada\([\s\S]{0,80}item\.CFOP \|\| '0000', direcaoEfetivaDoc\(nota\), nota\._dados, nota,?\s*\)/);
        expect(f).toMatch(/convertCfopParaEntrada\(cfopRaw, direcaoEfetivaDoc\(nota\), nota\._dados, nota\)/);
        // O campo CRU não pode voltar a alimentar a correlação.
        expect(f).not.toMatch(/convertCfopParaEntrada\([^)]*nota\.direcao/);
        // E o wrapper tem que chamar a régua COM documento, não a correlação crua.
        expect(f).toMatch(/cfopDoLancamento\(doc, rawCfop, direcao,/);
    });

    // ⚠️ TERCEIRA trava literal do dia. O que ela garante é que a NOTA chega
    // à callback (senão o E510 divergiria do C190); a direção passou a vir da
    // régua em 22/08, porque ela decide também o CST de escrituração.
    it('E510 (IPI) recebe a nota pela callback — senão divergiria do C190', () => {
        const f = leitor('sefaz-backend/sped-bloco-ipi-e510.js');
        expect(f).toMatch(/conv\(item\.cfop \|\| item\.CFOP \|\| '0000', [^,]+, nota\._dados, nota\)/);
        expect(f).not.toMatch(/conv\(item\.cfop \|\| item\.CFOP \|\| '0000', nota\.direcao/);
        expect(leitor('sefaz-backend/sped-fiscal-blocoE.js'))
            .toMatch(/convertCfop: \(cfop, direcao, notaDados, nota\)/);
    });
});

describe('a gravação é carimbada — reescrita de dado fiscal sem quem/quando não se reconstrói', () => {
    const fonte = readFileSync(join(RAIZ, 'services/cfopEscrituradoService.ts'), 'utf8');

    it('grava quem informou e quando', () => {
        expect(fonte).toMatch(/cfopEscrituradoPor: i\.porEmail/);
        expect(fonte).toMatch(/cfopEscrituradoEm: new Date\(\)\.toISOString\(\)/);
    });

    it('limpar APAGA o carimbo junto — não sobra "informado por" órfão', () => {
        expect(fonte).toMatch(/cfopEscrituradoPor: deleteField\(\)/);
        expect(fonte).toMatch(/cfopEscrituradoEm: deleteField\(\)/);
    });

    it('sem usuário identificado a recusa DIZ a causa, em vez de deixar o banco responder', () => {
        expect(fonte).toMatch(/saia e entre de novo/);
    });

    it('valida ANTES de gravar — a trava não pode viver só na tela', () => {
        expect(fonte).toMatch(/validarCfopEscriturado\(i\.cfop, i\.direcao\)/);
    });
});
