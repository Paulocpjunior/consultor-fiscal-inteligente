import type { NfpAnaliseEmpresa, NfpPlanoAcao } from '../types';
import { criarAnaliseManual, gerarPlanoAcaoAutomatico, mesclarPlanoAcao } from '../services/nfpManualAnalysis';

function baseAnalise(): NfpAnaliseEmpresa {
    return {
        empresaId: 'empresa_1',
        empresaNome: 'Empresa Teste',
        empresaCnpj: '12345678000199',
        dataAnalise: '2026-01-01T00:00:00.000Z',
        analisadoPor: 'Anterior',
        fonte: 'certificado_escritorio',
        debitos: [],
        parcelamentos: [],
        certidoes: [],
        obrigacoes: [],
        acoes: [],
        planoAcao: [],
    };
}

function makeUid() {
    let seq = 0;
    return () => `id_${++seq}`;
}

describe('criarAnaliseManual', () => {
    it('gera análise offline com dashboard data e plano de ação priorizado', () => {
        const analise = criarAnaliseManual({
            baseAnalise: baseAnalise(),
            activeEmpresaId: 'empresa_1',
            analisadoPor: 'Paulo',
            uid: makeUid(),
            hoje: new Date('2026-07-01T12:00:00.000Z'),
            debitos: [{
                esfera: 'federal',
                orgao: 'Receita Federal',
                descricao: 'IRPJ em aberto',
                valorOriginal: 12500,
                dataVencimento: '2026-05-20',
                status: 'aberto',
            }],
            certidoes: [{
                esfera: 'federal',
                orgao: 'Receita Federal / PGFN',
                tipo: 'CND Federal',
                status: 'positiva',
                motivoImpedimento: 'Débito RFB',
            }],
            obrigacoes: [{
                esfera: 'federal',
                nome: 'DCTFWeb',
                sigla: 'DCTFWeb',
                periodicidade: 'mensal',
                competencia: '05/2026',
                status: 'atrasada',
            }],
            parcelamentos: [{
                esfera: 'federal',
                programa: 'Parcelamento Simples',
                valorTotal: 3000,
                parcelas: 12,
                parcelasPagas: 2,
                valorParcela: 250,
                status: 'inadimplente',
                dataInicio: '2026-01-10',
            }],
            acoes: [],
        });

        expect(analise.fonte).toBe('offline');
        expect(analise.analisadoPor).toBe('Paulo');
        expect(analise.debitos).toHaveLength(1);
        expect(analise.certidoes).toHaveLength(1);
        expect(analise.obrigacoes).toHaveLength(1);
        expect(analise.parcelamentos).toHaveLength(1);
        expect(analise.planoAcao).toHaveLength(4);
        expect(analise.planoAcao.filter(p => p.gravidade === 'alta')).toHaveLength(4);
        expect(analise.planoAcao.map(p => p.descricao).join('\n')).toContain('Regularizar débito');
        expect(analise.planoAcao.map(p => p.descricao).join('\n')).toContain('Tratar certidão');
    });

    it('não cria ações para itens já resolvidos', () => {
        const analise = criarAnaliseManual({
            baseAnalise: baseAnalise(),
            activeEmpresaId: 'empresa_1',
            analisadoPor: 'Paulo',
            uid: makeUid(),
            hoje: new Date('2026-07-01T12:00:00.000Z'),
            debitos: [{
                esfera: 'federal',
                orgao: 'Receita Federal',
                descricao: 'Débito baixado',
                valorOriginal: 100,
                dataVencimento: '2026-05-20',
                status: 'quitado',
            }],
            certidoes: [{
                esfera: 'federal',
                orgao: 'Receita Federal / PGFN',
                tipo: 'CND Federal',
                status: 'negativa',
            }],
            obrigacoes: [{
                esfera: 'federal',
                nome: 'DCTFWeb',
                sigla: 'DCTFWeb',
                periodicidade: 'mensal',
                competencia: '05/2026',
                status: 'entregue',
            }],
            parcelamentos: [{
                esfera: 'federal',
                programa: 'Parcelamento regular',
                valorTotal: 1000,
                parcelas: 10,
                parcelasPagas: 3,
                valorParcela: 100,
                status: 'ativo',
                dataInicio: '2026-01-10',
            }],
            acoes: [{
                tipo: 'tributaria',
                descricao: 'Ação encerrada',
                status: 'encerrada',
            }],
        });

        expect(analise.planoAcao).toHaveLength(0);
    });
});

describe('gerarPlanoAcaoAutomatico', () => {
    it('gera plano com as mesmas regras do fluxo manual a partir de dados de varredura', () => {
        const uid = makeUid();
        const plano = gerarPlanoAcaoAutomatico({
            empresaId: 'prospect_12345678000199',
            hoje: new Date('2026-07-01T12:00:00.000Z'),
            uid,
            debitos: [{
                id: 'd1', empresaId: 'prospect_12345678000199', esfera: 'federal',
                orgao: 'PGFN', descricao: 'Dívida Ativa 123', valorOriginal: 50000,
                dataVencimento: '2026-01-15', status: 'aberto',
            }],
            certidoes: [
                {
                    id: 'c1', empresaId: 'prospect_12345678000199', esfera: 'federal',
                    orgao: 'RFB/PGFN', tipo: 'CND Federal', status: 'positiva',
                },
                {
                    // não consultada não pode virar item de plano
                    id: 'c2', empresaId: 'prospect_12345678000199', esfera: 'municipal',
                    orgao: 'Prefeitura', tipo: 'CND Municipal', status: 'nao_consultada',
                },
            ],
            obrigacoes: [
                {
                    id: 'o1', empresaId: 'prospect_12345678000199', esfera: 'federal',
                    nome: 'DCTFWeb', sigla: 'DCTFWeb', periodicidade: 'mensal', status: 'atrasada',
                },
                {
                    // não verificada não pode virar item de plano
                    id: 'o2', empresaId: 'prospect_12345678000199', esfera: 'federal',
                    nome: 'EFD-Contribuições', sigla: 'EFD', periodicidade: 'mensal', status: 'nao_verificada',
                },
            ],
            parcelamentos: [],
            acoes: [],
        });

        expect(plano).toHaveLength(3);
        expect(plano.every(p => p.status === 'pendente')).toBe(true);
        expect(plano.every(p => p.empresaId === 'prospect_12345678000199')).toBe(true);
        const descricoes = plano.map(p => p.descricao).join('\n');
        expect(descricoes).toContain('Regularizar débito - PGFN');
        expect(descricoes).toContain('Tratar certidão - RFB/PGFN');
        expect(descricoes).toContain('Regularizar obrigação - DCTFWeb');
        expect(descricoes).not.toContain('CND Municipal');
        // débito vencido/alto valor = alta gravidade, prazo +3 dias
        const debitoItem = plano.find(p => p.descricao.startsWith('Regularizar débito'));
        expect(debitoItem?.gravidade).toBe('alta');
        expect(debitoItem?.prazo).toBe('2026-07-04');
    });
});

describe('mesclarPlanoAcao', () => {
    const item = (id: string, descricao: string): NfpPlanoAcao => ({
        id, empresaId: 'e1', descricao, gravidade: 'media', esfera: 'federal', status: 'pendente',
    });

    it('preserva itens existentes e adiciona apenas gerados inéditos', () => {
        const existentes = [item('a', 'Regularizar débito - PGFN')];
        const gerados = [
            item('b', 'regularizar débito - pgfn'),      // duplicado (case/acentos)
            item('c', 'Tratar certidão - RFB'),
            item('d', 'Tratar certidao - RFB'),           // duplicado do anterior
        ];
        const resultado = mesclarPlanoAcao(existentes, gerados);
        expect(resultado.map(p => p.id)).toEqual(['a', 'c']);
    });
});
