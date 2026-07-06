/**
 * __tests__/nfpAnaliseMerge.test.ts
 *
 * Merge colaborativo da análise NFP Pro Cloud: vários colaboradores
 * (departamentos) lançam apontamentos no mesmo documento — salvar não pode
 * apagar o que os outros incluíram.
 */
import { mesclarAnaliseComRemota } from '../services/nfpAnaliseMerge';
import type {
    NfpAnaliseEmpresa,
    NfpDebito,
    NfpCertidao,
    NfpObrigacao,
    NfpPlanoAcao,
} from '../types';

const EMPRESA = 'prospect_37148545000150';

function baseAnalise(over: Partial<NfpAnaliseEmpresa> = {}): NfpAnaliseEmpresa {
    return {
        empresaId: EMPRESA,
        empresaNome: 'CLICKPISCINAS',
        empresaCnpj: '37148545000150',
        dataAnalise: '2026-07-06T10:00:00.000Z',
        analisadoPor: 'alexandre',
        fonte: 'offline',
        debitos: [],
        parcelamentos: [],
        certidoes: [],
        obrigacoes: [],
        acoes: [],
        planoAcao: [],
        ...over,
    };
}

function debito(id: string, over: Partial<NfpDebito> = {}): NfpDebito {
    return {
        id, empresaId: EMPRESA, esfera: 'federal', orgao: 'Receita Federal',
        descricao: `Débito ${id}`, valorOriginal: 100, dataVencimento: '2026-01-10',
        status: 'aberto', ...over,
    };
}

function certidao(id: string, over: Partial<NfpCertidao> = {}): NfpCertidao {
    return {
        id, empresaId: EMPRESA, esfera: 'federal', orgao: 'RFB/PGFN',
        tipo: 'CND Federal', status: 'nao_consultada', ...over,
    };
}

function obrigacao(id: string, over: Partial<NfpObrigacao> = {}): NfpObrigacao {
    return {
        id, empresaId: EMPRESA, nome: 'DCTFWeb', sigla: 'DCTFWEB',
        esfera: 'federal', periodicidade: 'mensal', status: 'nao_verificada', ...over,
    };
}

function planoItem(id: string, descricao: string): NfpPlanoAcao {
    return {
        id, empresaId: EMPRESA, descricao, gravidade: 'alta',
        esfera: 'federal', status: 'pendente',
    };
}

describe('mesclarAnaliseComRemota', () => {
    it('retorna a análise local intacta quando não há versão remota', () => {
        const local = baseAnalise({ debitos: [debito('d1')] });
        expect(mesclarAnaliseComRemota(local, null)).toBe(local);
    });

    it('preserva débitos lançados por outro colaborador depois do carregamento', () => {
        // Depto A carregou a análise vazia (baseline vazio) e lançou d1.
        // Enquanto isso, depto B salvou d2 no servidor.
        const baseline = baseAnalise();
        const local = baseAnalise({ debitos: [debito('d1')] });
        const remota = baseAnalise({ debitos: [debito('d2', { orgao: 'PGFN' })] });

        const merged = mesclarAnaliseComRemota(local, remota, baseline);
        expect(merged.debitos.map(d => d.id).sort()).toEqual(['d1', 'd2']);
    });

    it('a edição local vence quando o item existe nos dois lados (mesmo id)', () => {
        const baseline = baseAnalise({ debitos: [debito('d1', { valorOriginal: 100 })] });
        const local = baseAnalise({ debitos: [debito('d1', { valorOriginal: 250 })] });
        const remota = baseAnalise({ debitos: [debito('d1', { valorOriginal: 100 })] });

        const merged = mesclarAnaliseComRemota(local, remota, baseline);
        expect(merged.debitos).toHaveLength(1);
        expect(merged.debitos[0].valorOriginal).toBe(250);
    });

    it('mantém a exclusão intencional (item estava no baseline e foi removido localmente)', () => {
        const baseline = baseAnalise({ debitos: [debito('d1'), debito('d2')] });
        const local = baseAnalise({ debitos: [debito('d1')] }); // usuário removeu d2
        const remota = baseAnalise({ debitos: [debito('d1'), debito('d2')] });

        const merged = mesclarAnaliseComRemota(local, remota, baseline);
        expect(merged.debitos.map(d => d.id)).toEqual(['d1']);
    });

    it('não duplica certidões-base criadas por rascunhos independentes (chave natural)', () => {
        // Dois colaboradores geraram rascunhos com uid() diferentes para a
        // mesma certidão (mesma esfera/órgão/tipo).
        const local = baseAnalise({ certidoes: [certidao('c-local', { status: 'positiva' })] });
        const remota = baseAnalise({ certidoes: [certidao('c-remoto')] });

        const merged = mesclarAnaliseComRemota(local, remota, baseAnalise());
        expect(merged.certidoes).toHaveLength(1);
        expect(merged.certidoes[0].id).toBe('c-local');
        expect(merged.certidoes[0].status).toBe('positiva');
    });

    it('preserva certidão de outra esfera/órgão lançada remotamente', () => {
        const local = baseAnalise({ certidoes: [certidao('c1')] });
        const remota = baseAnalise({
            certidoes: [certidao('c2', { esfera: 'estadual', orgao: 'SEFAZ', tipo: 'CND Estadual' })],
        });

        const merged = mesclarAnaliseComRemota(local, remota, baseAnalise());
        expect(merged.certidoes.map(c => c.id).sort()).toEqual(['c1', 'c2']);
    });

    it('não duplica obrigações com a mesma sigla/esfera', () => {
        const local = baseAnalise({ obrigacoes: [obrigacao('o-local', { status: 'entregue' })] });
        const remota = baseAnalise({
            obrigacoes: [obrigacao('o-remoto'), obrigacao('o2', { sigla: 'EFD', nome: 'EFD Contribuições' })],
        });

        const merged = mesclarAnaliseComRemota(local, remota, baseAnalise());
        expect(merged.obrigacoes.map(o => o.id).sort()).toEqual(['o-local', 'o2']);
        expect(merged.obrigacoes.find(o => o.id === 'o-local')?.status).toBe('entregue');
    });

    it('não duplica itens do plano de ação com a mesma descrição (ignorando acentos/caixa)', () => {
        const local = baseAnalise({ planoAcao: [planoItem('p1', 'Regularizar débito de IRPJ')] });
        const remota = baseAnalise({
            planoAcao: [planoItem('p2', 'regularizar debito de irpj'), planoItem('p3', 'Emitir CND estadual')],
        });

        const merged = mesclarAnaliseComRemota(local, remota, baseAnalise());
        expect(merged.planoAcao.map(p => p.id).sort()).toEqual(['p1', 'p3']);
    });

    it('mantém a Análise da IA remota quando o estado local não tem uma', () => {
        const ia = { texto: 'Parecer…', geradoEm: '2026-07-06T12:00:00.000Z', geradoPor: 'maria' };
        const local = baseAnalise();
        const remota = baseAnalise({ analiseIA: ia });

        expect(mesclarAnaliseComRemota(local, remota, baseAnalise()).analiseIA).toEqual(ia);
    });

    it('rascunho vazio salvo por cima não zera os lançamentos remotos', () => {
        // Cenário do bug reportado: a tela de um colaborador iniciou uma
        // análise vazia e salvou — antes isso zerava débitos/certidões/
        // obrigações lançados pelos demais.
        const local = baseAnalise();
        const remota = baseAnalise({
            debitos: [debito('d1')],
            certidoes: [certidao('c1')],
            obrigacoes: [obrigacao('o1')],
            planoAcao: [planoItem('p1', 'Regularizar débito')],
        });

        const merged = mesclarAnaliseComRemota(local, remota, null);
        expect(merged.debitos).toHaveLength(1);
        expect(merged.certidoes).toHaveLength(1);
        expect(merged.obrigacoes).toHaveLength(1);
        expect(merged.planoAcao).toHaveLength(1);
    });

    it('trata listas ausentes no documento remoto (docs antigos) sem quebrar', () => {
        const local = baseAnalise({ debitos: [debito('d1')] });
        const remota = { ...baseAnalise(), debitos: undefined, planoAcao: undefined } as unknown as NfpAnaliseEmpresa;

        const merged = mesclarAnaliseComRemota(local, remota, null);
        expect(merged.debitos.map(d => d.id)).toEqual(['d1']);
        expect(merged.planoAcao).toEqual([]);
    });
});
