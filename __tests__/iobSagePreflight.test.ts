/**
 * FREIO antes de gerar o .FML.
 *
 * Paulo, 29/07: "pensando racionalmente, tudo isso pode ser evitado criando
 * um freio, um alerta que resume os erros encontrados antes de gerar o
 * arquivo". Cada recusa de hoje custou um ciclo completo — gerar, importar,
 * ler o demonstrativo, voltar — para descobrir algo que já dava pra saber.
 *
 * As causas testadas aqui são as REAIS do dia: CFOP de saída em nota de
 * entrada (89), número zerado (56) e nota sem participante.
 */
import { conferirAntesDeGerar } from '../services/iobSagePreflight';
import type { DocumentoFiscal } from '../types';

const chave = (serie: string, numero: string) =>
    '35' + '2607' + '32602701000197' + '55'
    + serie.padStart(3, '0') + numero.padStart(9, '0') + '1'.repeat(10);

const doc = (over: any = {}) => ({
    id: 'd1',
    chave: chave('1', '209514'),
    numero: '209514',
    serie: '1',
    direcao: 'entrada',
    tipo: 'NFe',
    dhEmi: '2026-07-10T10:00:00-03:00',
    importadoEm: Date.parse('2026-07-11T10:00:00Z'),
    valorTotal: 500,
    cnpjEmit: '11222333000181',
    xNomeEmit: 'FORNECEDOR LTDA',
    cnpjDest: '32602701000197',
    itens: [{ cProd: 'T1', xProd: 'TECIDO', uCom: 'MT', ncm: '54075210', cfop: '6102', quantidade: 1, valorUnitario: 500, vProd: 500 }],
    ...over,
}) as unknown as DocumentoFiscal;

const opts = { numeroEmpresaEfiscal: 587 };
const causas = (r: ReturnType<typeof conferirAntesDeGerar>) => r.problemas.map((p) => p.causa);

describe('o freio deixa passar o que está certo', () => {
    it('nota completa não vira alarme falso', () => {
        const r = conferirAntesDeGerar([doc()], opts);
        expect(r.farol).toBe('ok');
        expect(r.problemas).toHaveLength(0);
        expect(r.notasNoArquivo).toBe(1);
        expect(r.resumo).toMatch(/nada que o E-Fiscal costume recusar/);
    });

    it('CFOP de saída convertido para entrada NÃO é problema (é o esperado)', () => {
        // 6102 numa entrada vira 2102 — o freio confere o resultado, não a origem.
        expect(causas(conferirAntesDeGerar([doc({ itens: [{ cProd: 'A', cfop: '6102', vProd: 1 }] })], opts)))
            .not.toContain('CFOP inválido para nota de entrada');
    });

    it('recorte vazio diz isso, sem inventar problema', () => {
        const r = conferirAntesDeGerar([], opts);
        expect(r.resumo).toMatch(/Nenhum documento/);
        expect(r.farol).toBe('ok');
    });
});

describe('as causas reais do dia', () => {
    it('nota sem número: antecipa o "E200 campo 06"', () => {
        const p = conferirAntesDeGerar([doc({ numero: '', chave: '' })], opts)
            .problemas.find((x) => x.causa === 'Nota sem número')!;
        expect(p.gravidade).toBe('bloqueia');
        expect(p.oQueAconteceLa).toMatch(/campo 06/);
    });

    it('CFOP que não converte: antecipa o "E201 campo 08"', () => {
        const p = conferirAntesDeGerar([doc({ itens: [{ cProd: 'A', cfop: '9999', vProd: 1 }] })], opts)
            .problemas.find((x) => x.causa.startsWith('CFOP inválido'))!;
        expect(p.gravidade).toBe('bloqueia');
        expect(p.oQueAconteceLa).toMatch(/campo 08/);
        expect(p.acao).toMatch(/Correlação CFOP/);
    });

    it('nota sem participante é bloqueio, com a nota nomeada', () => {
        const r = conferirAntesDeGerar([doc({ cnpjEmit: undefined })], opts);
        expect(causas(r)).toContain('Nota sem CNPJ do participante');
        expect(r.bloqueios).toBeGreaterThan(0);
    });

    it('resumo diz quantas chegariam inteiras — não só quantas foram buscadas', () => {
        const r = conferirAntesDeGerar([doc(), doc({ id: 'd2', cnpjEmit: undefined })], opts);
        expect(r.documentos).toBe(2);
        expect(r.notasNoArquivo).toBe(1);
        expect(r.resumo).toMatch(/1 de 2 chegariam/);
    });
});

describe('ressalvas que não travam', () => {
    it('nota sem itens é atenção (resumo da SEFAZ), não bloqueio', () => {
        const r = conferirAntesDeGerar([doc({ itens: [] })], opts);
        const p = r.problemas.find((x) => x.causa === 'Nota sem itens')!;
        expect(p.gravidade).toBe('atencao');
        expect(p.acao).toMatch(/ciência/i);
        expect(r.farol).toBe('atencao');
        expect(r.bloqueios).toBe(0);
    });

    it('CT-e/NFS-e no recorte avisa que não entra no layout', () => {
        const r = conferirAntesDeGerar([doc({ tipo: 'CTe' })], opts);
        expect(causas(r)[0]).toMatch(/CTe não entra/);
        expect(r.problemas[0]!.gravidade).toBe('atencao');
    });
});

describe('agrupamento por causa (é assim que se resolve)', () => {
    it('mesma causa em várias notas vira UMA linha com a contagem', () => {
        const ruins = [1, 2, 3, 4].map((i) => doc({ id: `x${i}`, numero: '', chave: '' }));
        const p = conferirAntesDeGerar(ruins, opts).problemas.find((x) => x.causa === 'Nota sem número')!;
        expect(p.qtd).toBe(4);
        expect(p.exemplos.length).toBeGreaterThan(0);
    });

    it('exemplos são limitados — a lista serve pra conferir, não pra despejar', () => {
        const muitas = Array.from({ length: 30 }, (_, i) => doc({ id: `y${i}`, numero: '', chave: '' }));
        const p = conferirAntesDeGerar(muitas, opts).problemas.find((x) => x.causa === 'Nota sem número')!;
        expect(p.qtd).toBe(30);
        expect(p.exemplos.length).toBeLessThanOrEqual(8);
    });

    it('bloqueios aparecem antes das ressalvas', () => {
        const r = conferirAntesDeGerar([doc({ itens: [] }), doc({ id: 'z', numero: '', chave: '' })], opts);
        expect(r.problemas[0]!.gravidade).toBe('bloqueia');
        expect(r.farol).toBe('bloqueado');
    });
});
