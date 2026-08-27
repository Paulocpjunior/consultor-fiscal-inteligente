/**
 * O NORTE do colaborador durante o mês fiscal (Paulo, 07/08).
 *
 * A Rotina do mês já responde "onde este cliente está", mas em cinco etapas
 * por linha. O colaborador precisa da MESMA verdade condensada: uma linha por
 * cliente, com a cor certa, o prazo mais apertado e a única coisa a fazer.
 *
 * O que este teste protege: NENHUMA conta nova. A cor sai do farol que a
 * rotina já calcula, o prazo sai da régua única, e nada aqui reinterpreta
 * etapa. Painel com conta própria diverge sozinho.
 */
import { montarLinhaGuia, montarGuiaDoMes, corDaEmpresa, resumirGuia, guiaParaPdf } from '../services/guiaDoMes';

const etapa = (id: string, status: string, over: any = {}) => ({
    id, ordem: 1, nome: id, onde: 'algum lugar', status, resumo: `resumo ${id}`, acao: null, ...over,
});

const rotina = (over: any = {}): any => ({
    empresa: { id: 'e1', nome: 'CLIENTE LTDA', cnpj: '11111111000191', regime: 'lucro' },
    competencia: '2026-08',
    iss: null,
    etapas: [
        etapa('captura', 'concluida', { resumo: '12 entrada(s) e 4 saída(s).' }),
        etapa('validacao', 'concluida'),
        etapa('apuracao', 'concluida'),
        etapa('obrigacoes', 'concluida', { resumo: '5 obrigação(ões) entregue(s).', atrasadas: 0, prazo: null }),
        etapa('guias', 'concluida'),
    ],
    proximoPasso: null,
    progresso: { concluidas: 5, total: 5 },
    // 🔒 'fechado' é o CARIMBO do "Dar fim de mês" — o fato. Esta fixture dizia
    // `'ok'` para significar "mês fechado", e isso deixou de ser verdade em
    // 26/08: `'ok'` passou a querer dizer **pronto para fechar**. Trocar a
    // fixture é o certo; ela descrevia um mundo que a produção não vive mais.
    farol: 'fechado',
    ...over,
});

describe('a cor é a do farol da rotina — sem régua paralela', () => {
    it('mês FECHADO é verde', () => {
        expect(corDaEmpresa(rotina())).toBe('verde');
    });

    it('pronto para fechar também é verde — mas é outro estado', () => {
        expect(corDaEmpresa(rotina({ farol: 'ok' }))).toBe('verde');
    });

    it('farol pendente é vermelho', () => {
        expect(corDaEmpresa(rotina({ farol: 'pendente' }))).toBe('vermelho');
    });

    it('farol de atenção é âmbar', () => {
        expect(corDaEmpresa(rotina({ farol: 'atencao' }))).toBe('ambar');
    });

    it('sem etapa nenhuma é CINZA, nunca verde', () => {
        // Ausência de dado não é "tudo certo" — é "não sabemos".
        expect(corDaEmpresa({ etapas: [], farol: 'ok' } as any)).toBe('cinza');
    });

    it('obrigação ATRASADA agrava para vermelho mesmo com farol âmbar', () => {
        // Atraso é a única faixa em que o prazo já foi perdido: âmbar ali
        // esconderia multa correndo.
        const r = rotina({
            farol: 'atencao',
            etapas: [
                etapa('captura', 'concluida'), etapa('validacao', 'concluida'), etapa('apuracao', 'concluida'),
                etapa('obrigacoes', 'atencao', { atrasadas: 2 }),
                etapa('guias', 'concluida'),
            ],
        });
        expect(corDaEmpresa(r)).toBe('vermelho');
    });

    // 🔒 Paulo, 27/08: *"empresa fechada, imposto enviado, página virada! Não
    // pode ficar em vermelho"*. As etapas são RECALCULADAS a cada abertura da
    // tela; o carimbo é FATO. Fato vence dedução — inclusive a agravação por
    // atrasada, já que o fim de mês só passa com as obrigações entregues.
    it('mês FECHADO não volta ao vermelho por obrigação que atrasou depois', () => {
        const r = rotina({
            farol: 'fechado',
            etapas: [
                etapa('captura', 'concluida'), etapa('validacao', 'concluida'), etapa('apuracao', 'concluida'),
                etapa('obrigacoes', 'pendente', { atrasadas: 3 }),
                etapa('guias', 'pendente'),
            ],
        });
        expect(corDaEmpresa(r)).toBe('verde');
    });
});

describe('a linha condensa a rotina sem reinterpretar', () => {
    it('mês fechado não tem próximo passo', () => {
        const l = montarLinhaGuia(rotina());
        expect(l.proximoPasso).toBeNull();
        expect(l.progresso).toBe('5/5');
        expect(l.captura).toBe('12 entrada(s) e 4 saída(s).');
    });

    it('o próximo passo vira UMA frase, com o nome da etapa e a ação', () => {
        const l = montarLinhaGuia(rotina({
            farol: 'pendente',
            proximoPasso: { id: 'captura', ordem: 1, nome: 'Capturar notas', onde: 'Central de XMLs → Captura', acao: 'Rode a captura.', resumo: 'x' },
        }));
        expect(l.proximoPasso).toBe('Capturar notas: Rode a captura.');
        expect(l.onde).toBe('Central de XMLs → Captura');
    });

    it('o prazo mais apertado vem com rótulo e cor', () => {
        const l = montarLinhaGuia(rotina({
            farol: 'pendente',
            etapas: [
                etapa('captura', 'concluida'), etapa('validacao', 'concluida'), etapa('apuracao', 'concluida'),
                etapa('obrigacoes', 'pendente', { atrasadas: 0, prazo: { obrigacao: 'DAS', dias: 1, urgencia: 'amanha' } }),
                etapa('guias', 'pendente'),
            ],
        }));
        expect(l.prazo).toEqual({ obrigacao: 'DAS', dias: 1, urgencia: 'amanha', rotulo: 'VENCE AMANHÃ', cor: 'ambar' });
    });

    it('obrigação sem data não vira prazo — ausente ≠ no prazo', () => {
        const l = montarLinhaGuia(rotina({
            etapas: [etapa('obrigacoes', 'pendente', { prazo: null, semData: 3 })],
        }));
        expect(l.prazo).toBeNull();
    });

    it('pendência de ISS vira frase própria — é guia do município', () => {
        const l = montarLinhaGuia(rotina({ iss: { pendencias: ['ISS próprio R$ 1.520,33'], situacao: 'a-recolher' } }));
        expect(l.iss).toBe('ISS próprio R$ 1.520,33');
    });

    it('sem ISS (fora de SP capital) não inventa linha', () => {
        expect(montarLinhaGuia(rotina()).iss).toBeNull();
    });
});

describe('a fila: cor primeiro, prazo desempata', () => {
    const comPrazo = (id: string, nome: string, farol: string, dias: number | null) => rotina({
        empresa: { id, nome, cnpj: '1', regime: 'lucro' },
        farol,
        proximoPasso: farol === 'ok' ? null : { id: 'obrigacoes', ordem: 4, nome: 'Entregar obrigações', onde: 'x', acao: 'y', resumo: 'z' },
        etapas: [
            etapa('obrigacoes', farol === 'ok' ? 'concluida' : 'pendente', {
                atrasadas: 0,
                prazo: dias === null ? null : { obrigacao: 'DAS', dias, urgencia: dias <= 1 ? 'hoje' : '7d' },
            }),
        ],
    });

    it('vermelho vem antes de âmbar, que vem antes de verde', () => {
        const g = montarGuiaDoMes([
            comPrazo('c', 'VERDE', 'ok', null),
            comPrazo('a', 'VERMELHO', 'pendente', 5),
            comPrazo('b', 'AMBAR', 'atencao', 5),
        ]);
        expect(g.linhas.map((l) => l.nome)).toEqual(['VERMELHO', 'AMBAR', 'VERDE']);
    });

    it('dentro da mesma cor, quem vence antes vem primeiro', () => {
        const g = montarGuiaDoMes([
            comPrazo('a', 'DEPOIS', 'pendente', 6),
            comPrazo('b', 'ANTES', 'pendente', 0),
        ]);
        expect(g.linhas.map((l) => l.nome)).toEqual(['ANTES', 'DEPOIS']);
    });

    it('sem prazo não fura a fila de quem tem', () => {
        const g = montarGuiaDoMes([
            comPrazo('a', 'SEM PRAZO', 'pendente', null),
            comPrazo('b', 'COM PRAZO', 'pendente', 3),
        ]);
        expect(g.linhas.map((l) => l.nome)).toEqual(['COM PRAZO', 'SEM PRAZO']);
    });
});

describe('o resumo da carteira é honesto', () => {
    it('conta fechadas, atrasadas e quem vence na semana', () => {
        const g = montarGuiaDoMes([
            rotina(),
            rotina({
                empresa: { id: 'e2', nome: 'B', cnpj: '2', regime: 'simples' },
                farol: 'pendente',
                proximoPasso: { id: 'obrigacoes', ordem: 4, nome: 'x', onde: 'y', acao: 'z', resumo: 'w' },
                etapas: [etapa('obrigacoes', 'pendente', { atrasadas: 2, prazo: { obrigacao: 'DAS', dias: -3, urgencia: 'atrasada' } })],
            }),
        ]);
        expect(g.resumo.total).toBe(2);
        expect(g.resumo.fechadas).toBe(1);
        expect(g.resumo.atrasadas).toBe(2);
        expect(g.resumo.naSemana).toBe(1);
        expect(g.resumo.frase).toMatch(/2 obrigação\(ões\) ATRASADA\(S\)/);
    });

    // 🚨 "FECHADA" ERA DEDUZIDA de `!proximoPasso` — e desde 26/08 quem não tem
    // próximo passo pode estar apenas PRONTO, esperando o clique do ato. Fundir
    // os dois faria empresa pronta passar por entregue, que é a diferença entre
    // "nada a fazer" e "um clique a dar".
    it('PRONTA para fechar não é contada como fechada', () => {
        const g = montarGuiaDoMes([
            rotina(),
            rotina({ empresa: { id: 'e2', nome: 'B', cnpj: '2', regime: 'lucro' }, farol: 'ok' }),
        ]);
        expect(g.resumo.fechadas).toBe(1);
        expect(g.resumo.frase).toMatch(/1 pronto\(s\) para dar fim de mês/);
        expect(guiaParaPdf(g.linhas).map((l) => l[2])).toEqual(
            expect.arrayContaining(['FECHADO', 'PRONTO P/ FECHAR']));
    });

    it('carteira VAZIA não vira "tudo certo" — é falta de vínculo', () => {
        const r = resumirGuia([]);
        expect(r.frase).toMatch(/Nenhuma empresa na sua carteira/);
        expect(r.frase).toMatch(/peça ao admin/);
        expect(r.fechadas).toBe(0);
    });

    it('prazo "futura" não conta como vencimento da semana', () => {
        const g = montarGuiaDoMes([rotina({
            farol: 'pendente',
            etapas: [etapa('obrigacoes', 'pendente', { atrasadas: 0, prazo: { obrigacao: 'ECF', dias: 40, urgencia: 'futura' } })],
        })]);
        expect(g.resumo.naSemana).toBe(0);
    });
});

describe('PDF', () => {
    it('cada cliente vira uma linha da tabela, com o próximo passo por extenso', () => {
        const g = montarGuiaDoMes([rotina({
            farol: 'pendente',
            proximoPasso: { id: 'captura', ordem: 1, nome: 'Capturar notas', onde: 'x', acao: 'Rode a captura.', resumo: 'r' },
        })]);
        const [linha] = guiaParaPdf(g.linhas);
        expect(linha[0]).toBe('CLIENTE LTDA');
        expect(linha[2]).toBe('ATENÇÃO');
        expect(linha[7]).toBe('Capturar notas: Rode a captura.');
    });

    it('mês fechado sai escrito no papel, não em branco', () => {
        const [linha] = guiaParaPdf(montarGuiaDoMes([rotina()]).linhas);
        expect(linha[2]).toBe('FECHADO');
        expect(linha[7]).toBe('Mês fechado');
    });
});
