/**
 * Direitos do titular (LGPD art. 18) — o mecanismo que dá lastro ao selo.
 *
 * 🚨 O QUE ESTE TESTE PROTEGE é a diferença entre "estamos em conformidade" e
 * "fazemos isto": se o app promete apagar tudo e guarda comprovante de envio
 * (que a lei manda guardar, art. 16), a promessa vira informação enganosa ao
 * titular. Então o plano de eliminação tem que DIZER o que fica — sempre, e
 * com o motivo do lado.
 */
import {
    montarRelatorioTitular, planoDeEliminacao, registroDaSolicitacao, GUARDA_OBRIGATORIA,
} from '../sefaz-backend/lgpd-titular';

const catalogo = [
    { id: 'marketing', rotulo: 'Marketing', finalidade: 'Envio de comunicação promocional.', baseLegal: 'consentimento' },
];

describe('relatório de acesso (art. 18, II)', () => {
    it('entrega o CONTEÚDO das mensagens, não só a contagem', () => {
        // "Temos 40 mensagens suas" não é acesso: é avisar que se tem algo.
        const r = montarRelatorioTitular({
            numero: '5511999990000',
            mensagens: [{ timestamp: '2026-08-01T10:00:00Z', direcao: 'entrada', texto: 'bom dia' }],
        });
        expect(r.mensagens.total).toBe(1);
        expect(r.mensagens.itens[0].texto).toBe('bom dia');
    });

    it('a etiqueta vem com a FINALIDADE — é o que o titular quer saber', () => {
        const r = montarRelatorioTitular({ numero: '55', contato: { etiquetas: ['marketing'] }, catalogoEtiquetas: catalogo });
        expect(r.etiquetas[0].finalidade).toMatch(/promocional/i);
        expect(r.etiquetas[0].baseLegal).toBe('consentimento');
    });

    it('etiqueta sem finalidade cadastrada NÃO passa calada no relatório', () => {
        const r = montarRelatorioTitular({ numero: '55', contato: { etiquetas: ['orfa'] }, catalogoEtiquetas: [] });
        expect(r.etiquetas[0].finalidade).toMatch(/não cadastrada|revista/i);
    });

    it('quem não tem cadastro recebe resposta clara, não um relatório vazio ambíguo', () => {
        const r = montarRelatorioTitular({ numero: '5511999990000' });
        expect(r.temCadastro).toBe(false);
        expect(r.cadastro).toBeNull();
    });

    it('o relatório carrega o que a lei obriga a guardar — sem isso o titular acha que tudo pode sumir', () => {
        const r = montarRelatorioTitular({ numero: '55' });
        expect(r.guardaObrigatoria.length).toBeGreaterThan(0);
        expect(r.guardaObrigatoria.every((g) => g.motivo.length > 20)).toBe(true);
    });

    it('o módulo puro NÃO carimba a data (relógio é da rota)', () => {
        expect(montarRelatorioTitular({ numero: '55' }).geradoEm).toBeNull();
    });
});

describe('🚨 plano de eliminação (art. 18, VI) — o que SAI e o que FICA', () => {
    it('comprovante de envio de guia NÃO some, e o motivo vem junto', () => {
        const p = planoDeEliminacao({ numero: '55', contato: { numero: '55' }, mensagens: 12, envios: 3 });
        const mantido = p.mantem.find((m) => /[Cc]omprovante/.test(m.item));
        expect(mantido).toBeTruthy();
        expect(mantido!.motivo).toMatch(/art\. 16/);
    });

    it('o registro da própria solicitação SEMPRE fica (art. 37)', () => {
        const p = planoDeEliminacao({ numero: '55' });
        expect(p.mantem.some((m) => /solicitação/i.test(m.item))).toBe(true);
    });

    it('cadastro e mensagens entram no que sai, com a quantidade', () => {
        const p = planoDeEliminacao({ numero: '55', contato: { numero: '55' }, mensagens: 12 });
        expect(p.remove.find((r) => /[Mm]ensagens/.test(r.item))!.quantidade).toBe(12);
    });

    it('🚨 nada a remover NÃO devolve um "ok" que faz achar que algo aconteceu', () => {
        const p = planoDeEliminacao({ numero: '55' });
        expect(p.nadaARemover).toBe(true);
        expect(p.aviso).toMatch(/Não há dado/i);
    });

    it('havendo o que remover, o aviso diz que não dá pra desfazer', () => {
        const p = planoDeEliminacao({ numero: '55', contato: { numero: '55' } });
        expect(p.nadaARemover).toBe(false);
        expect(p.aviso).toMatch(/não há como desfazer/i);
    });
});

describe('registro da solicitação', () => {
    it('exige quem atendeu — "atendemos o pedido" sem autor não prova nada', () => {
        const r = registroDaSolicitacao({ numero: '55', tipo: 'acesso', quem: '', em: '2026-08-17' });
        expect(r.ok).toBe(false);
    });

    it('recusa tipo desconhecido em vez de gravar um registro sem sentido', () => {
        const r = registroDaSolicitacao({ numero: '55', tipo: 'outro' as any, quem: 'a@b.c', em: 'x' });
        expect(r.ok).toBe(false);
    });

    it('guarda o que foi removido E o que foi mantido', () => {
        const plano = planoDeEliminacao({ numero: '55', contato: { numero: '55' }, mensagens: 2, envios: 1 });
        const r = registroDaSolicitacao({ numero: '55', tipo: 'eliminacao', quem: 'a@b.c', em: '2026-08-17', plano });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect((r.registro as any).removidos.length).toBeGreaterThan(0);
            expect((r.registro as any).mantidos.length).toBeGreaterThan(0);
        }
    });
});

describe('a guarda obrigatória é honesta', () => {
    it('cada item diz o QUE é e POR QUE fica — lista sem motivo viraria desculpa', () => {
        GUARDA_OBRIGATORIA.forEach((g) => {
            expect(g.rotulo.length).toBeGreaterThan(5);
            expect(g.motivo).toMatch(/art\.|legisla/i);
        });
    });
});
