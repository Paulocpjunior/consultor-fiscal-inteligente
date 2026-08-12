/**
 * "Esta competência precisa de retificadora?" — a pergunta que ninguém fazia.
 *
 * Paulo, 12/08/2026: cada departamento fecha em dia diferente e as guias vencem
 * em datas distintas dentro do mês. Quem tem guia vencendo cedo transmite pra
 * conseguir a guia e FECHA a declaração para os outros dois. Quando o insumo do
 * outro chega, a DCTFWeb já está transmitida a menos — e nada na tela dizia isso.
 *
 * Os testes travam as duas pontas: acusar quando há prova dos dois lados, e
 * CALAR quando não há (insumo sem data, mesmo dia, consulta indisponível).
 * Mandar retificar declaração correta é pior que não avisar.
 */
// @ts-nocheck — módulo .js do backend
import { avaliarRetificadora } from '../sefaz-backend/dctfweb-retificadora.js';

const selo = (rotulo: string, estado: string, quando: string | null = null, departamento = 'dp-folha') =>
    ({ rotulo, estado, quando, departamento });

const TRANSMITIDA = { situacao: 'ATIVA', transmitidoEm: '2026-08-12T10:00:00Z', transmitidoPor: 'sandra@sp.com.br' };

describe('declaração ainda não transmitida', () => {
    it('não há o que retificar — e se falta insumo, o caminho é a guia EM ANDAMENTO', () => {
        const r = avaliarRetificadora({
            declaracao: { situacao: 'EM_ANDAMENTO' },
            selos: [selo('👥 DP/Folha — eSocial', 'pendente')],
        });
        expect(r.situacao).toBe('nao-transmitida');
        expect(r.precisaRetificar).toBe(false);
        expect(r.acao).toMatch(/EM ANDAMENTO/);
        expect(r.acao).toMatch(/pagar não exige transmitir/i);
    });

    it('sem pendência nenhuma, segue o rito normal', () => {
        const r = avaliarRetificadora({ declaracao: { situacao: 'EM_ANDAMENTO' }, selos: [] });
        expect(r.severidade).toBe('ok');
    });
});

describe('insumo que chegou DEPOIS da transmissão', () => {
    it('acusa, diz QUEM transmitiu e QUANDO', () => {
        const r = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('👥 DP/Folha — eSocial', 'recebido', '2026-08-18')],
        });
        expect(r.situacao).toBe('precisa-retificar');
        expect(r.precisaRetificar).toBe(true);
        expect(r.severidade).toBe('alta');
        expect(r.mensagem).toMatch(/sandra@sp.com.br/);
        expect(r.mensagem).toMatch(/está a MENOS/);
        expect(r.tardios[0].rotulo).toMatch(/eSocial/);
    });

    it('compara por INSTANTE quando os dois lados têm hora', () => {
        const antes = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('📊 Contábil — EFD-Reinf', 'recebido', '2026-08-12T09:00:00Z')],
        });
        expect(antes.situacao).toBe('em-dia');
        const depois = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('📊 Contábil — EFD-Reinf', 'recebido', '2026-08-12T11:00:00Z')],
        });
        expect(depois.situacao).toBe('precisa-retificar');
    });
});

describe('o que NÃO pode virar acusação', () => {
    it('mesmo dia sem hora dos dois lados: a ordem não é conferível', () => {
        const r = avaliarRetificadora({
            declaracao: { situacao: 'ATIVA', transmitidoEm: '2026-08-12', transmitidoPor: 'x@y.com' },
            selos: [selo('👥 DP/Folha — eSocial', 'recebido', '2026-08-12')],
        });
        expect(r.precisaRetificar).toBe(false);
        expect(r.situacao).toBe('em-dia');
        expect(r.severidade).toBe('atencao');          // não é verde
        expect(r.ressalvas.join(' ')).toMatch(/MESMO dia/i);
    });

    it('insumo recebido SEM data vira ressalva, nunca "chegou depois"', () => {
        const r = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('🧾 Fiscal — MIT', 'recebido', null)],
        });
        expect(r.precisaRetificar).toBe(false);
        expect(r.semData[0].rotulo).toMatch(/MIT/);
        expect(r.ressalvas.join(' ')).toMatch(/SEM data/);
    });

    it('sem-movimento não gera retificadora — não ter o que entregar não é atraso', () => {
        const r = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('📊 Contábil — EFD-Reinf', 'sem-movimento', '2026-08-20')],
        });
        expect(r.situacao).toBe('em-dia');
        expect(r.tardios).toEqual([]);
    });

    it('consulta indisponível não vira culpa nem alívio', () => {
        const r = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('👥 DP/Folha — eSocial', 'indeterminado')],
        });
        expect(r.precisaRetificar).toBe(false);
        expect(r.severidade).toBe('atencao');
        expect(r.ressalvas.join(' ')).toMatch(/consulta indisponível/i);
    });
});

describe('transmitida com insumo ainda pendente', () => {
    it('avisa que VAI precisar de retificadora quando o insumo entrar', () => {
        const r = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [selo('🧾 Fiscal — MIT', 'pendente')],
        });
        expect(r.situacao).toBe('vai-precisar');
        expect(r.precisaRetificar).toBe(false);
        expect(r.severidade).toBe('atencao');
        expect(r.mensagem).toMatch(/VAI precisar de retificadora/);
    });
});

describe('declaração antiga sem responsável gravado', () => {
    it('diz que não guarda quem transmitiu, em vez de omitir', () => {
        const r = avaliarRetificadora({
            declaracao: { situacao: 'ATIVA', transmitidoEm: '2026-08-12T10:00:00Z', transmitidoPor: null },
            selos: [selo('👥 DP/Folha — eSocial', 'recebido', '2026-08-11')],
        });
        expect(r.transmitidaPor).toBeNull();
        expect(r.ressalvas.join(' ')).toMatch(/não guarda QUEM transmitiu/);
    });
});

describe('tudo dentro', () => {
    it('todos os insumos antes da transmissão = nada a retificar', () => {
        const r = avaliarRetificadora({
            declaracao: TRANSMITIDA,
            selos: [
                selo('👥 DP/Folha — eSocial', 'recebido', '2026-08-10'),
                selo('📊 Contábil — EFD-Reinf', 'recebido', '2026-08-11T08:00:00Z'),
                selo('🧾 Fiscal — MIT', 'recebido', '2026-08-11'),
            ],
        });
        expect(r.situacao).toBe('em-dia');
        expect(r.severidade).toBe('ok');
        expect(r.mensagem).toMatch(/Nada a retificar/);
    });
});
