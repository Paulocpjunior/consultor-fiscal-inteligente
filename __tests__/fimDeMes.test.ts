// ============================================================================
// 🔒 DAR FIM DE MÊS — o ato que vira a régua de impostos, livros, ficha e CCI
//
// Paulo, 26/08: *"o fechamento do fim do mês no CFI exige (DAR FIM DE MÊS);
// essa função é que deve ser usada como régua para nos nortear, usar como base
// p impostos, livros, ficha financeira, exatamente o que o CCI deve usar como
// base para importação do contábil"*.
//
// As três decisões dele, que este teste trava:
//   1. fecha o COLABORADOR; reabre SÓ ADMIN
//   2. BLOQUEIA (etapa em âmbar não passa — não há justificativa que fure)
//   3. uma empresa por vez
// ============================================================================
import {
    podeDarFimDeMes, montarFimDeMes, montarCorte, valoresApuradosDaFicha,
    conferirReabertura, aplicarReabertura, competenciaFechada, descreverFechamento,
    MOTIVO_REABERTURA_MINIMO, CAMPOS_APURADOS,
} from '../sefaz-backend/fim-de-mes.js';
// ⚠️ `rotina-fiscal.js` não tem `.d.ts` — o silenciador aqui é LEGÍTIMO, e a
// trava `dtsNaoPrometeFantasma` barra só o que cala um aviso inexistente.
// @ts-ignore — módulo JS do backend, sem `.d.ts`
import { montarRotinaFiscal, etapaFechada } from '../sefaz-backend/rotina-fiscal.js';

const AGORA = '2026-09-05T13:00:00.000Z';
const QUEM = { uid: 'u1', email: 'colaborador@spassessoriacontabil.com.br', nome: 'Fulano' };
const ADMIN = { uid: 'a1', email: 'admin@spassessoriacontabil.com.br', nome: 'Gestor' };

const etapas = (over: Record<string, string> = {}) =>
    ['captura', 'validacao', 'apuracao', 'obrigacoes', 'guias'].map((id, i) => ({
        id, ordem: i + 1, nome: id, onde: `onde-${id}`,
        status: over[id] || 'concluida',
        resumo: `resumo de ${id}`, acao: `ação de ${id}`,
    }));

const rotina = (over: Record<string, string> = {}) => ({ etapas: etapas(over) });

const FICHA = {
    id: 'f-2026-08', mesReferencia: '2026-08',
    // insumos — NÃO podem viajar no carimbo
    faturamentoMesComercio: 100000, despesas: 4000, folha: 9000, cmv: 30000,
    // apurados
    totalImpostos: 4056.37, cargaTributaria: 6.35,
    ipiRecolher: 2200.45, icmsProprioRecolher: 3272.22,
    saldoCredorIcmsTransportar: 521793.35,
};

const fechar = (over: Record<string, unknown> = {}) => montarFimDeMes({
    empresaId: 'emp-1', competencia: '2026-08', regime: 'LUCRO_PRESUMIDO',
    rotina: rotina(), ficha: FICHA,
    corte: montarCorte({ agoraIso: AGORA, state: { ultNSU: 4210, maxNSU: 4210 }, documentos: { entradas: 131, saidas: 12, total: 143 } }),
    quem: QUEM, agoraIso: AGORA,
    ...over,
} as never);

// ═══ 2. BLOQUEIA ════════════════════════════════════════════════════════════
describe('🚨 decisão do Paulo: etapa aberta BLOQUEIA — não há justificativa que fure', () => {
    it.each([
        ['pendente (vermelho)', 'pendente'],
        ['atencao (âmbar)', 'atencao'],
    ])('etapa em %s não deixa fechar', (_n, status) => {
        const r = podeDarFimDeMes(rotina({ guias: status }));
        expect(r.pode).toBe(false);
        expect(r.bloqueios.map(b => b.id)).toEqual(['guias']);
    });

    it('as cinco fechadas liberam', () => {
        expect(podeDarFimDeMes(rotina()).pode).toBe(true);
    });

    // 'na' (não se aplica) fecha a etapa — empresa sem guia a enviar não pode
    // ficar presa por uma etapa que não é dela.
    it("etapa 'na' não bloqueia", () => {
        expect(podeDarFimDeMes(rotina({ guias: 'na' })).pode).toBe(true);
    });

    // 🚨 O bloqueio NOMEIA e diz ONDE — trava sem caminho é trava que a equipe
    // contorna (13/08). É o que faz o "bloqueia" ser usável.
    it('o bloqueio diz qual etapa, o que falta e onde se resolve', () => {
        const b = podeDarFimDeMes(rotina({ captura: 'atencao' })).bloqueios[0];
        expect(b).toMatchObject({ id: 'captura', status: 'atencao', onde: 'onde-captura' });
        expect(b.acao).toBeTruthy();
        expect(b.resumo).toBeTruthy();
    });

    it('duas etapas abertas saem as DUAS — não só a primeira', () => {
        const r = podeDarFimDeMes(rotina({ captura: 'atencao', guias: 'pendente' }));
        expect(r.bloqueios.map(b => b.id)).toEqual(['captura', 'guias']);
    });

    // Rotina que não pôde ser lida NÃO libera: fechar sem saber o que está
    // aberto é fechar sem base, que é o oposto do que este ato existe para ser.
    it('rotina ilegível não libera', () => {
        expect(podeDarFimDeMes(null as never).pode).toBe(false);
        expect(podeDarFimDeMes({ etapas: [] } as never).pode).toBe(false);
    });
});

// ═══ A PRÉ-CONDIÇÃO SAI DO DONO, NUNCA DE UMA CÓPIA ═════════════════════════
describe('🚨 quem decide se a etapa fechou é a Rotina', () => {
    it('`etapaFechada` é o dono, e o fim de mês concorda com ele', () => {
        for (const status of ['concluida', 'na', 'atencao', 'pendente']) {
            const bloqueado = podeDarFimDeMes(rotina({ guias: status })).bloqueios.length > 0;
            expect(bloqueado).toBe(!etapaFechada({ status } as never));
        }
    });

    // A rotina REAL (não uma fixture) — sem documento nenhum a etapa 1 abre, e
    // o mês não fecha. É o caso EXPERTE: número apurado sem lastro.
    it('sobre a rotina real: carteira sem documento não fecha o mês', () => {
        const real = montarRotinaFiscal({
            empresa: { id: 'e', nome: 'EXPERTE' }, competencia: '2026-08',
            docs: [], tarefas: [], envios: [], apuracao: { totalImpostos: 7352.9 },
        } as never);
        expect(podeDarFimDeMes(real).pode).toBe(false);
        expect(podeDarFimDeMes(real).bloqueios.map((b: any) => b.id)).toContain('captura');
    });
});

// ═══ O CARIMBO ══════════════════════════════════════════════════════════════
describe('🚨 o carimbo congela ACERVO, VALORES e LASTRO', () => {
    it('fecha e grava quem, quando, versão 1', () => {
        const r = fechar() as any;
        expect(r.ok).toBe(true);
        expect(r.fechamento).toMatchObject({
            empresaId: 'emp-1', competencia: '2026-08', estado: 'fechada', versao: 1,
            fechadoEm: AGORA,
        });
        expect(r.fechamento.fechadoPor.email).toBe(QUEM.email);
    });

    // 🚨 RESULTADO, nunca insumo: levar faturamento/despesa/folha convidaria o
    // outro lado a recalcular, e dois números para o mesmo fato é o defeito que
    // este ato existe para matar (a régua do R-2055).
    it('leva os APURADOS e NENHUM insumo', () => {
        const { apurado } = (fechar() as any).fechamento;
        expect(apurado.totalImpostos).toBe(4056.37);
        expect(apurado.ipiRecolher).toBe(2200.45);
        expect(apurado.saldoCredorIcmsTransportar).toBe(521793.35);
        for (const insumo of ['faturamentoMesComercio', 'despesas', 'folha', 'cmv']) {
            expect(apurado).not.toHaveProperty(insumo);
        }
        expect(Object.keys(apurado).sort()).toEqual([...CAMPOS_APURADOS].sort());
    });

    // ⚠️ Campo ausente vira NULL. Zero num campo de saldo é uma AFIRMAÇÃO — e
    // esta atravessa para a contabilidade.
    it('apurado ausente é null, nunca zero', () => {
        const v = valoresApuradosDaFicha({ totalImpostos: 10 });
        expect(v.totalImpostos).toBe(10);
        expect(v.saldoCredorIpiTransportar).toBeNull();
        expect(v.icmsStRecolher).toBeNull();
    });

    it('zero DIGITADO continua zero — ele é resposta', () => {
        expect(valoresApuradosDaFicha({ icmsStRecolher: 0 }).icmsStRecolher).toBe(0);
    });

    // O NSU é a PROVA do acervo; o instante é a régua. Ausência de NSU não
    // vira 0 — NSU 0 afirma "cursor no começo".
    it('o corte guarda instante e a prova do cursor', () => {
        const c = montarCorte({ agoraIso: AGORA, state: { ultNSU: 4210, maxNSU: 4215 }, documentos: { total: 143 } } as never);
        expect(c).toMatchObject({ instante: AGORA, ultNSU: 4210, maxNSU: 4215 });
        expect(c.documentos.total).toBe(143);
    });

    it('sem cursor gravado o NSU é null, nunca 0', () => {
        const c = montarCorte({ agoraIso: AGORA, state: null, documentos: null } as never);
        expect(c.ultNSU).toBeNull();
        expect(c.maxNSU).toBeNull();
        expect(c.documentos.total).toBe(0);
    });

    it('guarda o RETRATO das etapas no instante do fechamento', () => {
        const { etapas: retrato } = (fechar() as any).fechamento;
        expect(retrato).toHaveLength(5);
        expect(retrato[0]).toMatchObject({ id: 'captura', status: 'concluida' });
    });
});

describe('🚨 e recusa sem lançar — a rota precisa entregar o motivo à tela', () => {
    it('etapa aberta: devolve ok:false com os bloqueios', () => {
        const r = fechar({ rotina: rotina({ apuracao: 'pendente' }) }) as any;
        expect(r.ok).toBe(false);
        expect(r.bloqueios.map((b: any) => b.id)).toEqual(['apuracao']);
    });

    it('sem ficha não há valor a fechar', () => {
        expect((fechar({ ficha: null }) as any).ok).toBe(false);
    });

    // Competência ilegível é o campo mais caro: fechar o mês errado entrega o
    // número certo na competência errada.
    it('competência ilegível recusa dizendo a consequência', () => {
        const r = fechar({ competencia: 'agosto' }) as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/competência errada/i);
    });

    // As quatro formas legítimas normalizam pelo dono — '08/2026' é a forma do
    // catálogo, e recusá-la seria alarme sobre entrada correta.
    it('as outras formas da competência normalizam', () => {
        expect(((fechar({ competencia: '08/2026' }) as any).fechamento).competencia).toBe('2026-08');
        expect(((fechar({ competencia: '202608' }) as any).fechamento).competencia).toBe('2026-08');
    });

    it('competência já fechada recusa e aponta a reabertura', () => {
        const r = fechar({ anterior: { estado: 'fechada', versao: 1, fechadoEm: AGORA, fechadoPor: QUEM } }) as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/admin/i);
    });
});

// ═══ 1. REABRE SÓ ADMIN ═════════════════════════════════════════════════════
describe('🚨 decisão do Paulo: fecha o colaborador, reabre SÓ admin', () => {
    const FECHADO = (fechar() as any).fechamento;
    const MOTIVO = 'Nota da GLOBAL chegou depois do corte e muda o ICMS.';

    it('colaborador NÃO reabre — e a recusa diz por quê', () => {
        const r = conferirReabertura({ fechamento: FECHADO, motivo: MOTIVO, ehAdmin: false });
        expect(r.pode).toBe(false);
        expect(r.erro).toMatch(/contabilidade|administrador/i);
    });

    it('admin reabre com motivo escrito', () => {
        expect(conferirReabertura({ fechamento: FECHADO, motivo: MOTIVO, ehAdmin: true }).pode).toBe(true);
    });

    it('motivo curto é recusado — "ajuste" não explica nada em três meses', () => {
        const r = conferirReabertura({ fechamento: FECHADO, motivo: 'ajuste', ehAdmin: true });
        expect(r.pode).toBe(false);
        expect(r.erro).toContain(String(MOTIVO_REABERTURA_MINIMO));
    });

    it('competência aberta não tem o que reabrir', () => {
        expect(conferirReabertura({ fechamento: null, motivo: MOTIVO, ehAdmin: true }).pode).toBe(false);
    });

    it('reabrir PRESERVA o que estava fechado, com o valor da versão', () => {
        const r = aplicarReabertura({ fechamento: FECHADO, motivo: MOTIVO, quem: ADMIN, agoraIso: '2026-09-10T10:00:00.000Z' });
        expect(r.estado).toBe('reaberta');
        expect(r.reaberturas).toHaveLength(1);
        expect(r.reaberturas[0]).toMatchObject({ por: ADMIN.email, motivo: MOTIVO, versaoReaberta: 1 });
        // É a única forma de responder depois "o Contábil importou QUAL número?"
        expect(r.reaberturas[0].apuradoNaVersao?.totalImpostos).toBe(4056.37);
    });

    // ⚠️ Reaberta é ABERTA — tratá-la como fechada travaria justamente a edição
    // que a reabertura veio permitir.
    it('reaberta NÃO conta como fechada', () => {
        const r = aplicarReabertura({ fechamento: FECHADO, motivo: MOTIVO, quem: ADMIN, agoraIso: AGORA });
        expect(competenciaFechada(FECHADO)).toBe(true);
        expect(competenciaFechada(r)).toBe(false);
        expect(competenciaFechada(null)).toBe(false);
    });

    // 🚨 A VERSÃO É O QUE O CCI COMPARA — sem ela o Contábil fica com o número
    // velho sem saber que ele mudou, que é a divergência que o ato mata.
    it('fechar de novo depois de reabrir sobe a versão e mantém o histórico', () => {
        const reaberto = aplicarReabertura({ fechamento: FECHADO, motivo: MOTIVO, quem: ADMIN, agoraIso: AGORA });
        const r2 = fechar({ anterior: reaberto, ficha: { ...FICHA, totalImpostos: 4100 } }) as any;
        expect(r2.ok).toBe(true);
        expect(r2.fechamento.versao).toBe(2);
        expect(r2.fechamento.apurado.totalImpostos).toBe(4100);
        expect(r2.fechamento.reaberturas).toHaveLength(1);
    });
});

describe('🚨 a frase da tela nasce junto do estado', () => {
    it.each([
        ['aberta', null],
        ['fechada', (fechar() as any).fechamento],
    ])('%s', (estado, f) => {
        expect(descreverFechamento(f as never).estado).toBe(estado);
        expect(descreverFechamento(f as never).texto).toBeTruthy();
    });

    it('reaberta diz o motivo e o que fazer em seguida', () => {
        const r = aplicarReabertura({
            fechamento: (fechar() as any).fechamento,
            motivo: 'Nota da GLOBAL chegou depois do corte.', quem: ADMIN, agoraIso: AGORA,
        });
        const d = descreverFechamento(r);
        expect(d.estado).toBe('reaberta');
        expect(d.texto).toMatch(/GLOBAL/);
        expect(d.texto).toMatch(/Feche de novo/);
    });
});

// ============================================================================
// 🚨 O FIM DE MÊS NUNCA FUNCIONOU PARA O SIMPLES — e o Simples é a maior parte
// da carteira (27/08, print do Paulo: REGINA CELIA PIRES · 07/2026).
//
// A tela mostrava as cinco etapas verdes e **"✓ Pronto para dar fim de mês"**;
// o botão recusava com *"Sem apuração registrada nesta competência não há valor
// a fechar"*. Duas leituras do mesmo fato na mesma tela, pela terceira vez na
// semana.
//
// A causa está no comentário que eu mesmo escrevi na recusa: *"a etapa 3 da
// rotina já teria barrado, então isto é cinto e suspensório"*. **Premissa
// errada** — a etapa 3 fecha pelo DONO (`acharApuracaoDaCompetencia`), que
// conhece TRÊS fontes: a `fichaFinanceira[]` do Lucro, o `faturamentoManual` e
// o `faturamentoMensalDetalhado` do Simples. Só a primeira é "ficha".
// ============================================================================
describe('🚨 o fim de mês do SIMPLES', () => {
    const rotinaOk = {
        etapas: [
            { id: 'captura', nome: 'Capturar notas', status: 'concluida', resumo: '1 saída' },
            { id: 'validacao', nome: 'Validar', status: 'concluida' },
            { id: 'apuracao', nome: 'Apurar', status: 'concluida' },
            { id: 'obrigacoes', nome: 'Entregar', status: 'concluida' },
            { id: 'guias', nome: 'Guias', status: 'na' },
        ],
    };
    const fechar = (extra: any = {}): any => montarFimDeMes({
        empresaId: 'e1', competencia: '2026-07', regime: 'SIMPLES',
        rotina: rotinaOk, ficha: null,
        corte: { instante: '2026-08-27T12:00:00.000Z' },
        quem: { email: 'ana@x' }, agoraIso: '2026-08-27T12:00:00.000Z',
        ...extra,
    });

    it('fecha com a apuração do Simples — sem ficha nenhuma', () => {
        const r = fechar({ apuracao: { fonte: 'simples', totalImpostos: null, receita: 5000 } });
        expect(r.ok).toBe(true);
        expect(r.fechamento.apuradoFonte).toBe('simples');
    });

    // 🔒 Sem a FONTE, o Contábil recebe um `apurado` todo null e conclui "este
    // cliente não teve movimento" — afirmação que ninguém fez.
    it('diz de onde veio o apurado e leva a ressalva do DAS', () => {
        const f = fechar({ apuracao: { fonte: 'simples', totalImpostos: null, receita: 5000 } }).fechamento;
        expect(f.apuradoRessalva).toMatch(/Simples Nacional/);
        expect(f.apuradoRessalva).toMatch(/o valor do DAS não vive na ficha/);
        expect(f.apuradoRessalva).toMatch(/ACERVO e o LASTRO/);
    });

    // ⚠️ A RECEITA NÃO ENTRA NO APURADO. Ela é INSUMO, e insumo convida o outro
    // lado a RECALCULAR — a régua do R-2055, que este carimbo existe para
    // honrar. O que atravessa é RESULTADO.
    it('a receita lançada NÃO vira valor apurado', () => {
        const f = fechar({ apuracao: { fonte: 'simples', totalImpostos: null, receita: 5000 } }).fechamento;
        expect(Object.values(f.apurado)).not.toContain(5000);
        expect(f.apurado.totalImpostos).toBeNull();
    });

    // A recusa continua existindo — para quem não tem apuração NENHUMA.
    it('sem ficha E sem apuração, continua recusando', () => {
        const r = fechar({ apuracao: null });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/Sem apuração registrada/);
    });

    it('no Lucro nada muda — a ficha continua sendo a fonte', () => {
        const f = fechar({
            ficha: { id: 'f1', totalImpostos: 1234.56, ipiRecolher: 200 },
            apuracao: { fonte: 'lucro', totalImpostos: 1234.56 },
        }).fechamento;
        expect(f.apuradoFonte).toBe('ficha-lucro');
        expect(f.apurado.totalImpostos).toBe(1234.56);
        expect(f.apuradoRessalva).toBeNull();
    });
});
