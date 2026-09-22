// ============================================================================
// 👥 "pode tirar, INSS, FGTS, CPP é do DP" (Paulo, 22/09).
// O que este teste prende: o catálogo do CFI não tem FGTS/INSS_CPP em regime
// nenhum; a etapa 4 da Rotina não conta tarefa dessas obrigações (nem como
// entregue, nem como falta) e DIZ quantas ficaram fora; e a régua do
// cancelamento em lote só alcança tarefa automática e aberta.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO, OBRIGACOES_DO_DP, tarefaDoDpParaCancelar } from '../sefaz-backend/catalogo-obrigacoes.js';
// @ts-expect-error — módulo .js puro
import { OBRIGACOES } from '../sefaz-backend/calendario-obrigacoes.js';
// @ts-expect-error — módulo .js puro
import { montarRotinaFiscal } from '../sefaz-backend/rotina-fiscal.js';

describe('catálogo e calendário sem FGTS/INSS', () => {
    it('OBRIGACOES_DO_DP nomeia as duas; nenhuma lista do CATALOGO as tem', () => {
        expect([...OBRIGACOES_DO_DP]).toEqual(['FGTS', 'INSS_CPP']);
        for (const [regime, lista] of Object.entries(CATALOGO)) {
            const cods = (lista as any[]).map((r) => r.obrigacao);
            expect({ regime, temFgts: cods.includes('FGTS'), temInss: cods.includes('INSS_CPP') }).toEqual({ regime, temFgts: false, temInss: false });
        }
    });
    it('o calendário do Fiscal também não lista FGTS nem INSS patronal', () => {
        const tipos = Object.values(OBRIGACOES as any).map((o: any) => o.tipo);
        expect(tipos).not.toContain('FGTS');
        expect(tipos).not.toContain('INSS');
    });
});

describe('tarefaDoDpParaCancelar', () => {
    it('só automática e aberta; manual, concluída e cancelada ficam', () => {
        expect(tarefaDoDpParaCancelar({ obrigacao: 'FGTS', status: 'a_fazer', origem: 'automatica' })).toBe(true);
        expect(tarefaDoDpParaCancelar({ obrigacao: 'INSS_CPP', status: 'em_andamento' })).toBe(true);
        expect(tarefaDoDpParaCancelar({ obrigacao: 'FGTS', status: 'concluida' })).toBe(false);
        expect(tarefaDoDpParaCancelar({ obrigacao: 'FGTS', status: 'a_fazer', origem: 'manual' })).toBe(false);
        expect(tarefaDoDpParaCancelar({ obrigacao: 'DCTFWEB', status: 'a_fazer' })).toBe(false);
        expect(tarefaDoDpParaCancelar(null)).toBe(false);
    });
});

describe('etapa 4 da Rotina ignora as tarefas do DP e diz quantas', () => {
    const empresa = { id: 'e1', nome: 'AFFITTARE', cnpj: '17213641000127', regimePadrao: 'presumido' };
    const t = (obrigacao: string, status = 'a_fazer') => ({
        id: obrigacao, empresaId: 'e1', obrigacao, status, competencia: '08/2026', origem: 'automatica',
        vencimento: new Date('2026-09-20T12:00:00Z'),
    });
    it('FGTS e INSS abertas não viram "Falta:" — e a ação manda cancelar em lote', () => {
        const r: any = montarRotinaFiscal({
            empresa, competencia: '2026-08', documentos: [], apuracao: null,
            tarefas: [t('DCTFWEB', 'concluida'), t('PIS_COFINS', 'concluida'), t('FGTS'), t('INSS_CPP')],
            envios: [], agoraMs: Date.parse('2026-09-22T12:00:00Z'),
        });
        const e4 = r.etapas.find((e: any) => e.id === 'obrigacoes');
        expect(e4.status).toBe('concluida');
        expect(e4.resumo).toMatch(/2 obrigação\(ões\) entregue\(s\)/);
        expect(e4.resumo).toMatch(/2 tarefa\(s\) do DP \(FGTS\/INSS\) fora da conta/);
        expect(e4.acao).toMatch(/Cancelar tarefas do DP/);
        expect(e4.tarefasDoDp).toBe(2);
    });
    it('a porta existe: rota admin + botão em Tarefas', () => {
        const raiz = join(__dirname, '..');
        expect(readFileSync(join(raiz, 'server.js'), 'utf8')).toContain("'/api/admin/tarefas/cancelar-dp'");
        expect(readFileSync(join(raiz, 'components', 'Tarefas.tsx'), 'utf8')).toContain('Cancelar tarefas do DP (FGTS/INSS)');
    });
});
