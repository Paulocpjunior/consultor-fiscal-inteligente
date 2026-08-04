/**
 * DIFAL de aquisição do Simples (desenho do Alexandre, 03/08): consolidado
 * no mês; nota com ST (art. 426-A) é individual e fica FORA da consolidação.
 */
import { montarDifalMensal, aliqInterestadualDoItem } from '../sefaz-backend/difal-aquisicao.js';

const EMPRESA = { cnpj: '22222222000122', uf: 'SP' };

const nota = (over: any = {}) => ({
    chave: 'CH1', numero: '10', status: 'autorizado', modelo: '55',
    dhEmi: '2026-07-10', direcao: 'entrada',
    emitente: { cnpjCpf: '11111111000111', nome: 'FORN MG', uf: 'MG' },
    totais: {},
    itens: [{ vProd: 1000, aliqIcms: 12, orig: '0' }],
    ...over,
});

describe('aliqInterestadualDoItem', () => {
    it('destacada na nota vence; sem destaque deriva por UF e origem', () => {
        expect(aliqInterestadualDoItem({ aliqIcms: 4 }, 'MG')).toEqual({ aliq: 4, derivada: false });
        expect(aliqInterestadualDoItem({ orig: '0' }, 'MG')).toEqual({ aliq: 12, derivada: true });
        expect(aliqInterestadualDoItem({ orig: '0' }, 'BA')).toEqual({ aliq: 7, derivada: true });
        expect(aliqInterestadualDoItem({ orig: '0' }, 'ES')).toEqual({ aliq: 7, derivada: true });
        expect(aliqInterestadualDoItem({ orig: '1' }, 'MG')).toEqual({ aliq: 4, derivada: true });
    });
});

describe('montarDifalMensal', () => {
    it('consolida o mês: 18% interna − 12% inter sobre a base', () => {
        const r = montarDifalMensal({ docs: [nota()], empresa: EMPRESA });
        expect(r.linhas).toHaveLength(1);
        expect(r.linhas[0].difal).toBe(60);       // 1000 × 6%
        expect(r.totalDifal).toBe(60);
    });

    it('nota com ST vai pro balde INDIVIDUAL (426-A), fora da consolidação', () => {
        const r = montarDifalMensal({
            docs: [nota(), nota({ chave: 'CH2', totais: { vST: 50 } })],
            empresa: EMPRESA,
        });
        expect(r.linhas).toHaveLength(1);
        expect(r.antecipacaoIndividual).toHaveLength(1);
        expect(r.antecipacaoIndividual[0].chave).toBe('CH2');
        expect(r.totalDifal).toBe(60);            // só a consolidada
    });

    it('override de alíquota interna por chave muda a conta da nota', () => {
        const r = montarDifalMensal({
            docs: [nota()], empresa: EMPRESA,
            aliqInternaPorChave: { CH1: 25 },
        });
        expect(r.linhas[0].difal).toBe(130);      // 1000 × (25−12)%
    });

    it('interna menor que a interestadual não vira crédito (clamp em zero)', () => {
        const r = montarDifalMensal({
            docs: [nota({ itens: [{ vProd: 1000, aliqIcms: 12 }] })],
            empresa: EMPRESA, aliqInternaPadrao: 7,
        });
        expect(r.linhas[0].difal).toBe(0);
    });

    it('fica de fora: mesma UF, nota própria (tpNF=0), fornecedor PF, cancelada, mod 65', () => {
        const r = montarDifalMensal({
            docs: [
                nota({ chave: 'A', emitente: { cnpjCpf: '1', nome: 'SP', uf: 'SP' } }),
                nota({ chave: 'B', emitente: { cnpjCpf: EMPRESA.cnpj, nome: 'NOS', uf: 'SP' }, tpNF: '0' }),
                nota({ chave: 'C', emitente: { cnpjCpf: '52998224725', nome: 'PF MG', uf: 'MG' } }),
                nota({ chave: 'D', status: 'cancelado' }),
                nota({ chave: 'E', modelo: '65' }),
            ],
            empresa: EMPRESA,
        });
        expect(r.linhas).toHaveLength(0);
        expect(r.antecipacaoIndividual).toHaveLength(0);
    });

    it('item sem pICMS marca a linha como alíquota derivada (farol honesto)', () => {
        const r = montarDifalMensal({
            docs: [nota({ itens: [{ vProd: 500, orig: '0' }] })],
            empresa: EMPRESA,
        });
        expect(r.linhas[0].aliqInterDerivada).toBe(true);
        expect(r.linhas[0].difal).toBe(30);       // 500 × (18−12)%
    });
});

describe('nota capturada da SEFAZ (campos achatados) — caso SAINT PATRICK 04/08', () => {
    // NF 110497, CMC INDUSTRIA (RJ) → cliente SP, CFOP 6101, R$ 945,43 com
    // ICMS de 12%. O painel dizia "0 cliente(s) com compra interestadual"
    // porque a apuração só lia `emitente.uf` — que a captura nunca gravou.
    const notaCapturada = {
        chave: '33260608825779000196550010001104971117647682',
        numero: '110497',
        dhEmi: '2026-06-29T11:18:00',
        status: 'autorizado',
        direcao: 'entrada',
        // Sem objeto `emitente`: só os campos achatados da captura.
        cnpjEmit: '08825779000196',
        xNomeEmit: 'CMC INDUSTRIA E PROCESSOS PRODUTIVOS LTDA',
        totais: { vProd: 945.43, vNF: 945.43, vICMS: 113.45, vST: 0 },
        itens: [{ cfop: '6101', vProd: 945.43, vDesc: 0, vICMS: 113.45, aliqIcms: 12 }],
    };

    it('ACHA a nota mesmo sem o objeto emitente (UF vem da chave: cUF 33 = RJ)', () => {
        const r = montarDifalMensal({
            docs: [notaCapturada],
            empresa: { cnpj: '96616974000173', uf: 'SP' },
        });

        expect(r.linhas).toHaveLength(1);
        expect(r.linhas[0]).toMatchObject({
            numero: '110497',
            ufOrigem: 'RJ',
            fornecedor: 'CMC INDUSTRIA E PROCESSOS PRODUTIVOS LTDA',
            base: 945.43,
        });
        // 945,43 × (18% − 12%) = 56,73
        expect(r.linhas[0].difal).toBeCloseTo(56.73, 2);
    });

    it('compra DENTRO do estado continua fora (não virou "acha tudo")', () => {
        const dentroDeSP = {
            ...notaCapturada,
            chave: '35260608825779000196550010001104971117647682',
        };
        const r = montarDifalMensal({
            docs: [dentroDeSP],
            empresa: { cnpj: '96616974000173', uf: 'SP' },
        });
        expect(r.linhas).toEqual([]);
    });
});
