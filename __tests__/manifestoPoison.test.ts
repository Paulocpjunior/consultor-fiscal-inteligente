// @ts-expect-error — módulo .js puro (sem tipos)
import { estaEnvenenado, planejarLiberacao, resumirLiberacao } from '../sefaz-backend/manifesto-poison';
import { resumoManifestacao, temChaveEnvenenada, resumoLiberacaoPoison } from '../services/manifestoService';

/**
 * Caso KJM (05/08): a colaboradora recebeu "6× Desistimos após 8 falhas" e
 * pronto. O motivo passou a aparecer (#485), mas a chave seguia fora do lote
 * PRA SEMPRE — corrigir a causa não trazia nada de volta. Esta é a porta.
 */
describe('poison da manifestação — só sai do lote quem BATEU no teto', () => {
    it('conta como envenenado a partir de 8 falhas', () => {
        expect(estaEnvenenado({ manifestacaoFalhas: 8 })).toBe(true);
        expect(estaEnvenenado({ manifestacaoFalhas: 9 })).toBe(true);
    });

    it('7 falhas ainda está no lote — liberar ali mascararia o cooldown', () => {
        expect(estaEnvenenado({ manifestacaoFalhas: 7 })).toBe(false);
        expect(estaEnvenenado({})).toBe(false);
    });
});

describe('planejarLiberacao', () => {
    const doc = (over: any = {}) => ({ id: over.id || 'd1', manifestacaoFalhas: 8, ...over });

    it('devolve só as envenenadas, com o motivo pelo qual estavam fora', () => {
        const p = planejarLiberacao([
            doc({ id: 'a', ultimaFalhaManifestacaoMotivo: 'Certificado A1 vencido' }),
            doc({ id: 'b', ultimaFalhaManifestacaoMotivo: 'Certificado A1 vencido' }),
            doc({ id: 'c', manifestacaoFalhas: 2, ultimaFalhaManifestacaoMotivo: 'cStat 656' }),
        ]);
        expect(p.total).toBe(2);
        expect(p.liberar.map((d: any) => d.id)).toEqual(['a', 'b']);
        expect(p.porMotivo).toEqual({ 'Certificado A1 vencido': 2 });
    });

    it('separa a conta de INFRA — rede ruim não é causa que alguém corrigiu', () => {
        const p = planejarLiberacao([
            doc({ id: 'a', ultimaFalhaManifestacaoMotivo: 'ECONNRESET' }),
            doc({ id: 'b', ultimaFalhaManifestacaoMotivo: 'Rejeicao 573: Duplicidade de evento' }),
        ]);
        expect(p.total).toBe(2);
        expect(p.infra).toBe(1);
    });

    it('sem motivo gravado não inventa causa', () => {
        const p = planejarLiberacao([doc({ id: 'a' })]);
        expect(p.porMotivo).toEqual({ 'motivo não registrado': 1 });
    });

    it('lista vazia não quebra', () => {
        expect(planejarLiberacao([]).total).toBe(0);
        expect(planejarLiberacao(undefined as any).total).toBe(0);
    });
});

describe('resumirLiberacao — nunca promete conserto', () => {
    it('diz quantas voltaram, por que estavam fora e que podem falhar igual', () => {
        const t = resumirLiberacao(planejarLiberacao([
            { id: 'a', manifestacaoFalhas: 8, ultimaFalhaManifestacaoMotivo: 'Certificado A1 vencido' },
        ]));
        expect(t).toMatch(/1 chave\(s\) voltaram ao lote/);
        expect(t).toMatch(/Certificado A1 vencido/);
        expect(t).toMatch(/se a causa não foi corrigida, elas falham igual/);
    });

    it('nada envenenado: aponta os OUTROS motivos em vez de dizer "pronto"', () => {
        expect(resumirLiberacao(planejarLiberacao([]))).toMatch(/cooldown, idade ou já manifestada/);
    });
});

describe('a saída aparece na frase do colaborador', () => {
    it('poison no diagnóstico acende o "Tentar de novo"', () => {
        const r = { total: 0, diagnostico: { porMotivo: { 'Desistimos após 8 falhas': 6 } } };
        expect(temChaveEnvenenada(r)).toBe(true);
        expect(resumoManifestacao(r)).toMatch(/Tentar de novo/);
    });

    it('cooldown NÃO acende — ali clicar de novo não resolve nada', () => {
        const r = { total: 0, diagnostico: { porMotivo: { 'Falhou há pouco — volta ao lote em ~4h': 3 } } };
        expect(temChaveEnvenenada(r)).toBe(false);
        expect(resumoManifestacao(r)).not.toMatch(/Tentar de novo/);
    });

    it('erro do backend na liberação aparece inteiro', () => {
        expect(resumoLiberacaoPoison({ erro: 'Empresa fora da sua carteira' }))
            .toMatch(/Empresa fora da sua carteira/);
    });
});
