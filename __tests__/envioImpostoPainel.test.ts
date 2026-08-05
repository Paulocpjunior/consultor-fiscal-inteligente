/**
 * Farol da ordem técnica do envio de imposto (#293).
 *
 * A auditoria já registrava cada etapa; faltava o agregado. Regra: envio pela
 * METADE não é sucesso — cópia no SharePoint e baixa da obrigação fazem parte
 * do envio, e cada pendência precisa sair com motivo e ação.
 */
import { montarPainelEnvios, pendenciaSharePoint, pendenciaBaixa } from '../sefaz-backend/envio-imposto-painel.js';

const envio = (over: any = {}) => ({
    empresaNome: 'CLIENTE LTDA',
    empresaCnpj: '11111111000191',
    tipo: 'DARE',
    competencia: '2026-07',
    valor: 1000,
    copiaPara: ['alexandre@spassessoriacontabil.com.br'],
    sharePoint: { status: 'arquivado' },
    baixa: { status: 'baixada' },
    ...over,
});

describe('pendências por etapa', () => {
    it('SharePoint arquivado ou sem PDF não é pendência', () => {
        expect(pendenciaSharePoint(envio())).toBeNull();
        expect(pendenciaSharePoint(envio({ sharePoint: { status: 'sem-pdf' } }))).toBeNull();
    });

    it('empresa sem pasta configurada vira causa única com a ação', () => {
        const p = pendenciaSharePoint(envio({ sharePoint: { status: 'sem-config' } }));
        expect(p!.causa).toMatch(/sem pasta do SharePoint/i);
        expect(p!.acao).toMatch(/Integrações → SharePoint/);
    });

    it('erro de gravação leva o motivo técnico junto', () => {
        const p = pendenciaSharePoint(envio({ sharePoint: { status: 'erro', motivo: '403 Forbidden' } }));
        expect(p!.acao).toMatch(/403 Forbidden/);
    });

    it('baixa sem tarefa explica que a obrigação do mês não existe', () => {
        const p = pendenciaBaixa(envio({ baixa: { status: 'sem-tarefa' } }));
        expect(p!.causa).toMatch(/Sem obrigação correspondente/);
        expect(p!.acao).toMatch(/Gere as tarefas da competência/);
    });
});

describe('montarPainelEnvios', () => {
    it('tudo completo → farol ok', () => {
        const p = montarPainelEnvios([envio(), envio({ tipo: 'DAS' })], { competencia: '2026-07' });
        expect(p.total).toBe(2);
        expect(p.completos).toBe(2);
        expect(p.farol).toBe('ok');
        expect(p.porTipo).toEqual({ DARE: 1, DAS: 1 });
        expect(p.valorTotal).toBe(2000);
    });

    it('envio pela metade NÃO é sucesso — vira atenção com a causa', () => {
        const p = montarPainelEnvios([
            envio(),
            envio({ empresaNome: 'OUTRA LTDA', sharePoint: { status: 'sem-config' } }),
        ], { competencia: '2026-07' });
        expect(p.completos).toBe(1);
        expect(p.incompletos).toBe(1);
        expect(p.farol).toBe('atencao');
        expect(p.resumo).toMatch(/ficaram pela metade/);
        const causa = Object.keys(p.pendencias)[0];
        expect(p.pendencias[causa].qtd).toBe(1);
        expect(p.pendencias[causa].empresas[0]).toMatch(/OUTRA LTDA/);
    });

    it('agrupa a MESMA causa de várias empresas (uma tarefa, não N mistérios)', () => {
        const p = montarPainelEnvios([
            envio({ empresaNome: 'A', sharePoint: { status: 'sem-config' } }),
            envio({ empresaNome: 'B', sharePoint: { status: 'sem-config' } }),
            envio({ empresaNome: 'C', sharePoint: { status: 'sem-config' } }),
        ]);
        const causa = 'Empresa sem pasta do SharePoint';
        expect(p.pendencias[causa].qtd).toBe(3);
        expect(p.pendencias[causa].empresas).toHaveLength(3);
    });

    it('um envio com DUAS pendências conta nas duas causas, mas incompleto uma vez só', () => {
        const p = montarPainelEnvios([
            envio({ sharePoint: { status: 'sem-config' }, baixa: { status: 'sem-tarefa' } }),
        ]);
        expect(p.incompletos).toBe(1);
        expect(Object.keys(p.pendencias)).toHaveLength(2);
    });

    it('gestor fora da cópia é desvio da ordem técnica e aparece', () => {
        const p = montarPainelEnvios([envio({ copiaPara: ['outro@empresa.com'] })]);
        expect(p.semGestorEmCopia).toHaveLength(1);
        expect(montarPainelEnvios([envio()]).semGestorEmCopia).toHaveLength(0);
    });

    it('competência sem envio nenhum não é verde — é vazio', () => {
        const p = montarPainelEnvios([envio({ competencia: '2026-06' })], { competencia: '2026-07' });
        expect(p.total).toBe(0);
        expect(p.farol).toBe('vazio');
        expect(p.resumo).toMatch(/Nenhum imposto enviado/);
    });
});
