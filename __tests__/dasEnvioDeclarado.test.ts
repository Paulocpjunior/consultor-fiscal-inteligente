// ============================================================================
// 📤 "JÁ ENVIEI ESTA GUIA POR FORA" NA CENTRAL DE DAS — em lote (25/09)
//
// A decisão do Paulo: a declaração preenche a coluna Envio, fecha a etapa 5 da
// Rotina daquela competência (pelo rito, canal fora-do-app) e tira a guia do
// "não enviado". NÃO inventa pagamento, e NUNCA sobrepõe um envio registrado.
// As asserções cobram o FATO gravado, nunca a redação.
// ============================================================================
import {
    planejarDeclaracaoEmLote, snapshotEnvioDeclarado, logEnvioDeclarado,
    resumoDaDeclaracaoEmLote, declararEnvioDasEmLote, CANAL_FORA_DO_APP,
// @ts-expect-error módulo .js puro sem tipos
} from '../sefaz-backend/das-envio-declarado.js';
import { canalComprovaEnvio } from '../sefaz-backend/envio-imposto-painel.js';

const guia = (id: string, extra: Record<string, unknown> = {}) => ({
    id, empresaId: `emp-${id}`, empresaCnpj: '11.111.111/0001-91', empresaNome: `EMPRESA ${id}`,
    competencia: '2026-08', valor: 1234.5, vencimento: '2026-09-20', statusPagamento: 'vencido',
    ...extra,
});

const declaracaoBoa = {
    meio: 'whatsapp-pessoal',
    comoFoi: 'Mandei pelo WhatsApp do escritório com o PDF da guia.',
    quando: '2026-09-10',
    quem: 'ana@spassessoriacontabil.com.br',
    hojeIso: '2026-09-25',
};

describe('quais guias entram no lote', () => {
    it('guia sem envio entra; guia com envio registrado é PULADA e dita', () => {
        const r = planejarDeclaracaoEmLote([
            guia('a'),
            guia('b', { ultimoEnvioCliente: { canal: 'email', para: 'x@y', enviadoEm: '2026-09-01T10:00:00Z' } }),
        ]);
        expect(r.declarar.map((g: any) => g.id)).toEqual(['a']);
        expect(r.puladas).toHaveLength(1);
        expect(r.puladas[0].id).toBe('b');
        expect(r.puladas[0].motivo).toMatch(/já tem envio/i);
    });

    it('id não encontrado sai nomeado, e id repetido conta uma vez', () => {
        const r = planejarDeclaracaoEmLote([guia('a'), null, guia('a')], ['a', 'zzz', 'a']);
        expect(r.declarar).toHaveLength(1);
        expect(r.puladas).toEqual([expect.objectContaining({ id: 'zzz' })]);
    });

    it('guia sem CNPJ legível não entra — não há como registrar o envio', () => {
        const r = planejarDeclaracaoEmLote([guia('a', { empresaCnpj: '' })]);
        expect(r.declarar).toHaveLength(0);
        expect(r.puladas[0].motivo).toMatch(/CNPJ/);
    });
});

describe('o que a guia e o histórico passam a carregar', () => {
    const declaracao = {
        meio: 'whatsapp-pessoal', meioLabel: 'WhatsApp pessoal / do escritório',
        comoFoi: 'Mandei pelo WhatsApp.', quando: '2026-09-10', declaradoPor: 'ana@x',
    };

    it('o snapshot diz que foi DECLARADO, sem destinatário, sem PDF — e o canal não prova envio', () => {
        const s = snapshotEnvioDeclarado(declaracao, { enviadoPor: 'ana@x', agoraIso: '2026-09-25T12:00:00.000Z' });
        expect(s.canal).toBe(CANAL_FORA_DO_APP);
        expect(canalComprovaEnvio(s.canal)).toBe(false);
        expect(s.para).toBe('');
        expect(s.anexouPdf).toBe(false);
        expect(s.quando).toBe('2026-09-10');
        expect(s.declaradoPor).toBe('ana@x');
        expect(s.enviadoEm).toBe('2026-09-25T12:00:00.000Z');
        // Envio não é pagamento: o snapshot não carrega nada do eixo Pagamento.
        expect(s).not.toHaveProperty('statusPagamento');
        expect(s).not.toHaveProperty('dataPagamento');
    });

    it('o registro do histórico diz que o app NÃO enviou', () => {
        const log = logEnvioDeclarado(guia('a'), declaracao, { enviadoPor: 'ana@x' });
        expect(log.dasId).toBe('a');
        expect(log.empresaCnpj).toBe('11111111000191');
        expect(log.canal).toBe(CANAL_FORA_DO_APP);
        expect(log.mensagem).toMatch(/NÃO enviou/);
        expect(log.anexouPdf).toBe(false);
    });
});

describe('o lote de ponta a ponta (I/O injetado)', () => {
    const montar = (guias: any[], extra: Record<string, unknown> = {}) => {
        const ritos: any[] = [];
        const logs: any[] = [];
        const guiasGravadas: Array<{ id: string; snapshot: any }> = [];
        const deps = {
            carregarGuias: async (ids: string[]) => ids.map((id) => guias.find((g) => g.id === id) || null),
            podeAcessar: async () => ({ ok: true }),
            executarRito: async (p: any) => { ritos.push(p); return { sharePoint: { status: 'sem-pdf' }, baixa: { status: 'baixada' }, logId: 'log1' }; },
            gravarLog: async (l: any) => { logs.push(l); },
            atualizarGuia: async (id: string, snapshot: any) => { guiasGravadas.push({ id, snapshot }); },
            agoraIso: '2026-09-25T12:00:00.000Z',
            ...extra,
        };
        return { deps, ritos, logs, guiasGravadas };
    };

    it('declaração incompleta é RESPOSTA 400 e nada é gravado', async () => {
        const { deps, ritos, logs } = montar([guia('a')]);
        const r = await declararEnvioDasEmLote({ dasIds: ['a'], ...declaracaoBoa, comoFoi: 'curto', ...deps });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(400);
        expect(r.erro).toMatch(/mínimo/);
        expect(ritos).toHaveLength(0);
        expect(logs).toHaveLength(0);
    });

    it('sem guia nenhuma é 400, não 500', async () => {
        const { deps } = montar([]);
        const r = await declararEnvioDasEmLote({ dasIds: [], ...declaracaoBoa, ...deps });
        expect(r.ok).toBe(false);
        expect(r.status).toBe(400);
    });

    it('cada guia passa pelo rito como DAS fora-do-app, entra no histórico e ganha a coluna Envio', async () => {
        const { deps, ritos, logs, guiasGravadas } = montar([guia('a'), guia('b')]);
        const r = await declararEnvioDasEmLote({ dasIds: ['a', 'b'], ...declaracaoBoa, ...deps });
        expect(r.ok).toBe(true);
        expect(r.declaradas.map((d: any) => d.id)).toEqual(['a', 'b']);
        expect(ritos).toHaveLength(2);
        for (const p of ritos) {
            expect(p.tipo).toBe('DAS');
            expect(p.canal).toBe(CANAL_FORA_DO_APP);
            expect(p.competencia).toBe('2026-08');
            expect(p.empresaCnpj).toBe('11111111000191');
            expect(p.declaracao.declaradoPor).toBe(declaracaoBoa.quem);
            expect(p.enviadoPor).toBe(declaracaoBoa.quem);
        }
        expect(logs.map((l) => l.dasId)).toEqual(['a', 'b']);
        expect(guiasGravadas.map((g) => g.id)).toEqual(['a', 'b']);
        expect(guiasGravadas[0].snapshot.canal).toBe(CANAL_FORA_DO_APP);
        expect(r.declaracao.texto).toMatch(/NÃO enviou/);
        expect(r.resumo).toMatch(/2 guia/);
    });

    it('guia já enviada é pulada — a declaração nunca sobrepõe um envio com prova', async () => {
        const { deps, ritos, guiasGravadas } = montar([
            guia('a', { ultimoEnvioCliente: { canal: 'email', para: 'c@x', enviadoEm: '2026-09-01T00:00:00Z' } }),
            guia('b'),
        ]);
        const r = await declararEnvioDasEmLote({ dasIds: ['a', 'b'], ...declaracaoBoa, ...deps });
        expect(r.declaradas.map((d: any) => d.id)).toEqual(['b']);
        expect(r.puladas.map((p: any) => p.id)).toEqual(['a']);
        expect(ritos).toHaveLength(1);
        expect(guiasGravadas.map((g) => g.id)).toEqual(['b']);
        expect(r.resumo).toMatch(/1 pulada/);
    });

    it('guia de empresa fora da carteira é pulada, com o motivo, e o resto do lote segue', async () => {
        const { deps, ritos } = montar([guia('a'), guia('b')], {
            podeAcessar: async (g: any) => (g.id === 'a' ? { ok: false, error: 'Empresa fora da sua carteira.' } : { ok: true }),
        });
        const r = await declararEnvioDasEmLote({ dasIds: ['a', 'b'], ...declaracaoBoa, ...deps });
        expect(r.declaradas.map((d: any) => d.id)).toEqual(['b']);
        expect(r.puladas[0]).toMatchObject({ id: 'a', motivo: 'Empresa fora da sua carteira.' });
        expect(ritos).toHaveLength(1);
    });

    it('rito que falha numa guia vira erro nomeado, sem derrubar as outras', async () => {
        const { deps, guiasGravadas } = montar([guia('a'), guia('b')], {
            executarRito: async (p: any) => {
                if (p.empresaId === 'emp-a') throw new Error('Firestore indisponível');
                return { sharePoint: { status: 'sem-pdf' }, baixa: { status: 'baixada' } };
            },
        });
        const r = await declararEnvioDasEmLote({ dasIds: ['a', 'b'], ...declaracaoBoa, ...deps });
        expect(r.erros).toEqual([expect.objectContaining({ id: 'a', motivo: 'Firestore indisponível' })]);
        expect(r.declaradas.map((d: any) => d.id)).toEqual(['b']);
        // A guia cujo rito falhou NÃO ganha a coluna Envio.
        expect(guiasGravadas.map((g) => g.id)).toEqual(['b']);
    });

    it('a baixa que não achou tarefa em Vencimentos é DITA no resumo — é ela que segura a etapa 5', async () => {
        const { deps } = montar([guia('a')], {
            executarRito: async () => ({ sharePoint: { status: 'sem-pdf' }, baixa: { status: 'sem-tarefa' } }),
        });
        const r = await declararEnvioDasEmLote({ dasIds: ['a'], ...declaracaoBoa, ...deps });
        expect(r.declaradas).toHaveLength(1);
        expect(r.resumo).toMatch(/sem tarefa/i);
    });
});

describe('o resumo é farol honesto', () => {
    it('conta declaradas, puladas e erros — nada some', () => {
        const t = resumoDaDeclaracaoEmLote({
            declaradas: [{ id: 'a', rito: { baixa: { status: 'baixada' } } }],
            puladas: [{ id: 'b', motivo: 'x' }, { id: 'c', motivo: 'y' }],
            erros: [{ id: 'd', motivo: 'z' }],
        });
        expect(t).toMatch(/1 guia/);
        expect(t).toMatch(/2 pulada/);
        expect(t).toMatch(/1 com erro/);
    });
});
