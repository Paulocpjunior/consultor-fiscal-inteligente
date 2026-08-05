import { diagnosticoRetencoes } from '../services/relatoriosAgregacoes';

/**
 * Caso real que originou o teste (HS PROJETOS, 07/2026): a aba Retenções dizia
 * "Nenhuma NFS-e prestada com retenção neste recorte" enquanto o relatório de
 * Serviços prestados, no MESMO recorte, avisava que as 9 notas não têm
 * IR/INSS/CSLL gravados. Ausente não é zero — e nesse caso o app não sabe.
 */
const nfse = (over: any = {}) => ({
    id: over.id || 'x',
    tipo: 'NFSe',
    direcao: 'saida',
    status: 'autorizado',
    dhEmi: '2026-07-02T10:00:00',
    numero: '2892',
    valorTotal: 2000,
    tomador: { nome: 'TOMADOR LTDA', cnpjCpf: '11111111000191' },
    valores: { baseCalculo: 2000, iss: 0 },
    ...over,
}) as any;

describe('diagnosticoRetencoes — o relatório só afirma o que o dado sustenta', () => {
    it('nota SEM os campos federais não deixa afirmar "nenhuma retenção"', () => {
        const d = diagnosticoRetencoes([nfse(), nfse({ id: 'y', numero: '2893' })], 'saida');
        expect(d.totalNotas).toBe(2);
        expect(d.comRetencao).toBe(0);
        expect(d.semCamposGravados).toBe(2);
        expect(d.podeAfirmarZero).toBe(false);
        expect(d.mensagem).toMatch(/NÃO é possível afirmar/);
        expect(d.mensagem).toMatch(/Reimporte o XML/);
    });

    it('com TODOS os campos gravados e nenhuma retenção, aí sim afirma', () => {
        const completa = nfse({ valores: { baseCalculo: 2000, iss: 100, ir: 0, inss: 0, csll: 0 } });
        const d = diagnosticoRetencoes([completa], 'saida');
        expect(d.podeAfirmarZero).toBe(true);
        expect(d.mensagem).toMatch(/Nenhuma das 1 NFS-e prestada do recorte tem retenção/);
        expect(d.mensagem).toMatch(/campos conferidos/);
    });

    it('mistura: lista o que achou E avisa que pode haver mais', () => {
        const comRet = nfse({ id: 'a', valores: { baseCalculo: 1000, ir: 15, inss: 0, csll: 0 } });
        const semCampos = nfse({ id: 'b', numero: '2894' });
        const d = diagnosticoRetencoes([comRet, semCampos], 'saida');
        expect(d.comRetencao).toBe(1);
        expect(d.semCamposGravados).toBe(1);
        expect(d.podeAfirmarZero).toBe(false);
        expect(d.mensagem).toMatch(/pode haver retenção além da listada/);
    });

    it('recorte sem NFS-e nenhuma diz isso, e não "sem retenção"', () => {
        const d = diagnosticoRetencoes([], 'saida');
        expect(d.totalNotas).toBe(0);
        expect(d.podeAfirmarZero).toBe(false);
        expect(d.mensagem).toBe('Nenhuma NFS-e prestada neste recorte.');
    });

    it('ISS retido sozinho já conta como retenção', () => {
        const d = diagnosticoRetencoes([
            nfse({ valores: { baseCalculo: 1000, valorIssRetido: 50, ir: 0, inss: 0, csll: 0 } }),
        ], 'saida');
        expect(d.comRetencao).toBe(1);
        expect(d.podeAfirmarZero).toBe(true);
    });
});
