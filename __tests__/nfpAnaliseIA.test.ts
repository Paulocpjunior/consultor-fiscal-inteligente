import type { NfpAnaliseEmpresa } from '../types';
import { montarPromptAnaliseIA } from '../services/nfpAnaliseIA';

jest.mock('../services/firebaseConfig', () => ({
    auth: { currentUser: { getIdToken: jest.fn() } },
}));

function analiseBase(fonte: NfpAnaliseEmpresa['fonte']): NfpAnaliseEmpresa {
    return {
        empresaId: 'prospect_12345678000199',
        empresaNome: 'Prospect Ltda',
        empresaCnpj: '12345678000199',
        dataAnalise: '2026-07-01T12:00:00.000Z',
        analisadoPor: 'Paulo',
        fonte,
        debitos: [{
            id: 'd1', empresaId: 'prospect_12345678000199', esfera: 'federal',
            orgao: 'Receita Federal', descricao: 'IRPJ em aberto', valorOriginal: 12500,
            dataVencimento: '2026-05-20', status: 'aberto',
        }],
        parcelamentos: [],
        certidoes: [
            {
                id: 'c1', empresaId: 'prospect_12345678000199', esfera: 'federal',
                orgao: 'RFB/PGFN', tipo: 'CND Federal', status: 'positiva',
                motivoImpedimento: 'Débito RFB',
            },
            {
                id: 'c2', empresaId: 'prospect_12345678000199', esfera: 'municipal',
                orgao: 'Prefeitura', tipo: 'CND Municipal', status: 'nao_consultada',
            },
        ],
        obrigacoes: [{
            id: 'o1', empresaId: 'prospect_12345678000199', esfera: 'federal',
            nome: 'DCTFWeb', sigla: 'DCTFWeb', periodicidade: 'mensal', status: 'atrasada',
        }],
        acoes: [],
        planoAcao: [{
            id: 'p1', empresaId: 'prospect_12345678000199',
            descricao: 'Regularizar débito - Receita Federal - IRPJ em aberto',
            gravidade: 'alta', esfera: 'federal', prazo: '2026-07-04', status: 'pendente',
        }],
    };
}

describe('montarPromptAnaliseIA', () => {
    it('inclui todos os blocos de apontamentos e o plano de ação', () => {
        const prompt = montarPromptAnaliseIA(analiseBase('offline'), {
            regime: 'Simples Nacional',
            atividade: 'Comércio varejista',
        });

        expect(prompt).toContain('Prospect Ltda');
        expect(prompt).toContain('Regime tributário: Simples Nacional');
        expect(prompt).toContain('diagnóstico manual lançado pelo colaborador');
        expect(prompt).toContain('DÉBITOS (1)');
        expect(prompt).toContain('IRPJ em aberto');
        expect(prompt).toContain('CERTIDÕES (1 consultadas)');
        expect(prompt).not.toContain('CND Municipal'); // não consultada fica de fora
        expect(prompt).toContain('OBRIGAÇÕES ACESSÓRIAS (1 verificadas)');
        expect(prompt).toContain('PLANO DE AÇÃO PROPOSTO (1 itens)');
        expect(prompt).toContain('Resumo executivo');
    });

    it('inclui os apontamentos trabalhistas (Folha × eSocial) no prompt', () => {
        const analise = analiseBase('offline');
        analise.apontamentosTrabalhistas = [
            {
                id: 't1', empresaId: analise.empresaId, funcionario: 'João da Silva',
                tipo: 'sem_registro', dataInicioTrabalho: '2026-03-01',
                fonte: 'folha', gravidade: 'alta', status: 'pendente',
            },
            {
                id: 't2', empresaId: analise.empresaId, funcionario: 'Maria Souza',
                tipo: 'registro_fora_prazo', dataInicioTrabalho: '2026-02-01', dataRegistro: '2026-04-15',
                fonte: 'esocial', gravidade: 'media', status: 'em_regularizacao',
            },
        ];

        const prompt = montarPromptAnaliseIA(analise);
        expect(prompt).toContain('APONTAMENTOS TRABALHISTAS — FOLHA × E-SOCIAL (2)');
        expect(prompt).toContain('João da Silva: funcionário SEM REGISTRO');
        expect(prompt).toContain('sem registro até a data da análise');
        expect(prompt).toContain('Maria Souza: registro efetivado FORA DO PRAZO');
        expect(prompt).toContain('registro em 2026-04-15');
    });

    it('gera o mesmo formato de prompt para varredura com certificado do cliente', () => {
        const manual = montarPromptAnaliseIA(analiseBase('offline'));
        const automatica = montarPromptAnaliseIA(analiseBase('certificado_cliente'));

        expect(automatica).toContain('varredura automática com certificado digital fornecido pelo cliente');
        // Fora a linha de origem dos dados, os prompts são idênticos
        const semOrigem = (s: string) => s.split('\n').filter(l => !l.startsWith('Origem dos dados:')).join('\n');
        expect(semOrigem(automatica)).toBe(semOrigem(manual));
    });
});
