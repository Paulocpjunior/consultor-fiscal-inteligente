// ============================================================================
// 👥 "pode tirar, INSS, FGTS, CPP é do DP" (Paulo, 22/09).
// O que este teste prende: o catálogo do CFI não tem FGTS/INSS_CPP em regime
// nenhum; a etapa 4 da Rotina não conta tarefa dessas obrigações (nem como
// entregue, nem como falta) e DIZ quantas ficaram fora; e a régua do
// cancelamento em lote só alcança tarefa automática e aberta.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { CATALOGO, OBRIGACOES_DO_DP, OBRIGACOES_DO_CONTABIL, OBRIGACOES_FORA_DO_FISCAL, departamentoDaObrigacao, tarefaDoDpParaCancelar, tarefaDeOutroDepartamentoParaCancelar } from '../sefaz-backend/catalogo-obrigacoes.js';
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
        expect(e4.resumo).toMatch(/2 tarefa\(s\) de outro departamento fora da conta \(DP: FGTS, INSS_CPP\)/);
        expect(e4.acao).toMatch(/Cancelar tarefas de outro departamento/);
        expect(e4.tarefasDoDp).toBe(2);
    });
    it('a porta existe: rota admin + botão em Tarefas', () => {
        const raiz = join(__dirname, '..');
        expect(readFileSync(join(raiz, 'server.js'), 'utf8')).toContain("'/api/admin/tarefas/cancelar-outro-departamento'");
        const tela = readFileSync(join(raiz, 'components', 'Tarefas.tsx'), 'utf8');
        expect(tela).toContain('/api/admin/tarefas/cancelar-outro-departamento');
        expect(tela).toMatch(/Cancelar tarefas de outro departamento/);
    });
});

// ── 23/09: "pode tirar eSocial também, é do DP" ─────────────────────────────
describe('👥 eSocial também é do DP', () => {
    it('o calendário do Fiscal não lista eSocial', () => {
        const tipos = Object.values(OBRIGACOES as any).map((o: any) => o.tipo);
        expect(tipos).not.toContain('ESOCIAL');
    });
});

// ── 25/09: "como adotamos para outras obrigações federais, vamos replicar p
// ECD/ECF que não é do departamento fiscal e sim do contábil" ─────────────
describe('🏢 ECD e ECF são do Contábil', () => {
    it('OBRIGACOES_DO_CONTABIL nomeia as duas e nenhuma lista do CATALOGO as tem (nem a da imune/isenta)', () => {
        expect([...OBRIGACOES_DO_CONTABIL]).toEqual(['ECD', 'ECF']);
        expect([...OBRIGACOES_FORA_DO_FISCAL]).toEqual(['FGTS', 'INSS_CPP', 'ECD', 'ECF']);
        for (const [regime, lista] of Object.entries(CATALOGO)) {
            const cods = (lista as any[]).map((r) => r.obrigacao);
            expect({ regime, temEcd: cods.includes('ECD'), temEcf: cods.includes('ECF') }).toEqual({ regime, temEcd: false, temEcf: false });
        }
    });
    it('o calendário do Fiscal não lista ECD nem ECF', () => {
        const tipos = Object.values(OBRIGACOES as any).map((o: any) => o.tipo);
        expect(tipos).not.toContain('ECD');
        expect(tipos).not.toContain('ECF');
    });
    it('cada obrigação diz quem a entrega', () => {
        expect(departamentoDaObrigacao('ECD')).toBe('Contábil');
        expect(departamentoDaObrigacao('ECF')).toBe('Contábil');
        expect(departamentoDaObrigacao('FGTS')).toBe('DP');
        expect(departamentoDaObrigacao('DCTFWEB')).toBeNull();
    });
    it('a régua do cancelamento em lote alcança ECD/ECF automática e aberta — e o nome antigo é a mesma régua', () => {
        expect(tarefaDeOutroDepartamentoParaCancelar({ obrigacao: 'ECD', status: 'a_fazer', origem: 'automatica' })).toBe(true);
        expect(tarefaDeOutroDepartamentoParaCancelar({ obrigacao: 'ECF', status: 'a_fazer', origem: 'manual' })).toBe(false);
        expect(tarefaDeOutroDepartamentoParaCancelar({ obrigacao: 'ECF', status: 'concluida' })).toBe(false);
        expect(tarefaDoDpParaCancelar({ obrigacao: 'ECD', status: 'a_fazer' })).toBe(true);
    });
    it('etapa 4 da Rotina: ECD aberta não vira "Falta:", sai contada e nomeada com o departamento', () => {
        const empresa = { id: 'e1', nome: 'EDUARDO GUERRA', cnpj: '00005430000104', regimePadrao: 'presumido' };
        const t = (obrigacao: string, status = 'a_fazer') => ({
            id: obrigacao, empresaId: 'e1', obrigacao, status, competencia: '12/2026', origem: 'automatica',
            vencimento: new Date('2027-06-30T12:00:00Z'),
        });
        const r: any = montarRotinaFiscal({
            empresa, competencia: '2026-12', documentos: [], apuracao: null,
            tarefas: [t('DCTFWEB', 'concluida'), t('ECD'), t('ECF'), t('FGTS')],
            envios: [], agoraMs: Date.parse('2027-01-10T12:00:00Z'),
        });
        const e4 = r.etapas.find((e: any) => e.id === 'obrigacoes');
        expect(e4.status).toBe('concluida');
        expect(e4.resumo).not.toMatch(/Falta:/);
        expect(e4.resumo).toMatch(/3 tarefa\(s\) de outro departamento fora da conta/);
        expect(e4.resumo).toMatch(/Contábil: ECD, ECF/);
        expect(e4.resumo).toMatch(/DP: FGTS/);
        expect(e4.tarefasDoDp).toBe(3);
    });
});
