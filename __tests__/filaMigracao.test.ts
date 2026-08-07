/**
 * QUEM PODE MIGRAR HOJE (Paulo, 07/08: "precisamos acelerar").
 *
 * A resposta já existia — espalhada em três telas. Ninguém abre três abas
 * vezes 388 clientes, então na prática ninguém responde. Aqui vira UMA fila,
 * ordenada, com UM próximo passo por cliente.
 *
 * O que este teste protege: ausência de sinal NUNCA vira prontidão, e a ordem
 * é por esforço (quem está a um passo vem antes de quem está a três).
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { montarFilaEmpresa, montarFilaMigracao, resumirFila } from '../sefaz-backend/fila-migracao';

const emp = (over: any = {}) => ({ id: 'e1', nome: 'CLIENTE LTDA', cnpj: '11111111000191', regime: 'lucro', ...over });
const capturaOk = { farol: 'ok', codigo: 'em-dia-na-fonte', motivo: 'Lemos tudo que a SEFAZ tem.', acao: null };
const saidaOk = { status: 'apto-ativo', apto: true, acao: 'Nada a fazer.' };
const blocosOk = { entregaEfdIcms: true, bloqueios: [], atencoes: [] };

const pronta = (over: any = {}) => montarFilaEmpresa({
    empresa: emp(), veredito: capturaOk, aptidao: saidaOk, prontidao: blocosOk, ...over,
});

describe('veredito de UMA empresa', () => {
    it('captura fechada dos dois lados e sem bloco pendente: pronta', () => {
        const r = pronta();
        expect(r.pronta).toBe(true);
        expect(r.esforco).toBe(0);
        expect(r.proximoPasso).toBeNull();
    });

    it('captura de ENTRADA incompleta na fonte trava a migração', () => {
        const r = pronta({
            veredito: {
                farol: 'falha', codigo: 'incompleta-na-fonte',
                motivo: 'A SEFAZ tem 12 documento(s) ALÉM do que já lemos.',
                acao: 'Rode a sincronização até o cursor alcançar o máximo.',
            },
        });
        expect(r.pronta).toBe(false);
        expect(r.proximoPasso.area).toBe('captura-entrada');
        expect(r.proximoPasso.onde).toMatch(/Prova de captura/);
    });

    it('ÂMBAR da captura também trava — resumo sem completa é livro a menor', () => {
        const r = pronta({
            veredito: { farol: 'atencao', codigo: 'resumos-sem-completa', motivo: '3 nota(s) só como RESUMO.', acao: 'Manifeste a ciência.' },
        });
        expect(r.pronta).toBe(false);
        expect(r.proximoPasso.area).toBe('captura-entrada');
    });

    it('cliente que nunca ligou o autXML/cofre trava na saída — é o 0/388', () => {
        const r = pronta({ aptidao: { status: 'sem-prova', apto: false, acao: 'Envie as instruções.' } });
        expect(r.proximoPasso.area).toBe('captura-saida');
        expect(r.proximoPasso.motivo).toMatch(/não ligou o autXML nem o cofre/);
    });

    it('apto-sem-fluxo é APTO — configurou e não vendeu no mês', () => {
        const r = pronta({ aptidao: { status: 'apto-sem-fluxo', apto: true } });
        expect(r.pronta).toBe(true);
    });

    it('apto-parou trava: a saída chegava e parou, é suspeita de regressão', () => {
        const r = pronta({ aptidao: { status: 'apto-parou', apto: true, acao: 'Confirme com o cliente.' } });
        expect(r.pronta).toBe(false);
        expect(r.proximoPasso.motivo).toMatch(/PAROU/);
    });

    it('quem não emite mod 55 não é cobrado por saída', () => {
        const r = pronta({ aptidao: { status: 'sem-saida-55', apto: false } });
        expect(r.pronta).toBe(true);
    });
});

describe('ausência de sinal NUNCA vira prontidão', () => {
    it('sem prova de captura a empresa não é pronta', () => {
        const r = pronta({ veredito: null });
        expect(r.pronta).toBe(false);
        expect(r.proximoPasso.motivo).toMatch(/Sem prova de captura/);
    });

    it('sem leitura de aptidão a empresa não é pronta', () => {
        const r = pronta({ aptidao: null });
        expect(r.pronta).toBe(false);
        expect(r.proximoPasso.area).toBe('captura-saida');
    });

    it('empresa sem NENHUM sinal acumula os dois bloqueios', () => {
        const r = montarFilaEmpresa({ empresa: emp() });
        expect(r.pronta).toBe(false);
        expect(r.esforco).toBe(2);
    });
});

describe('onda 1 (serviço puro) não é travada por bloco de ICMS', () => {
    it('sem entrega de EFD ICMS, bloco pendente não bloqueia', () => {
        const r = pronta({ prontidao: { entregaEfdIcms: false, bloqueios: ['Bloco K'], atencoes: [] } });
        expect(r.pronta).toBe(true);
        expect(r.onda).toBe('servico-puro');
    });

    it('quem ENTREGA EFD é bloqueado pelo bloco que falta', () => {
        const r = pronta({ prontidao: { entregaEfdIcms: true, bloqueios: ['Bloco K'], atencoes: [] } });
        expect(r.pronta).toBe(false);
        expect(r.proximoPasso.area).toBe('blocos');
        expect(r.onda).toBe('efd-icms');
    });

    it('atenção é RESSALVA, não bloqueio — aparece e deixa migrar', () => {
        const r = pronta({ prontidao: { entregaEfdIcms: true, bloqueios: [], atencoes: ['CIAP a conferir'] } });
        expect(r.pronta).toBe(true);
        expect(r.ressalvas).toEqual(['CIAP a conferir']);
    });
});

describe('a fila é ordenada por ESFORÇO — quem está a um passo vem antes', () => {
    const fila = () => montarFilaMigracao({
        empresas: [
            emp({ id: 'tres', nome: 'TRES PASSOS' }),
            emp({ id: 'zero', nome: 'PRONTA' }),
            emp({ id: 'um', nome: 'UM PASSO' }),
        ],
        vereditos: { zero: capturaOk, um: capturaOk, tres: null },
        aptidoes: { zero: saidaOk, um: { status: 'sem-prova', apto: false }, tres: null },
        prontidoes: {
            zero: blocosOk, um: blocosOk,
            tres: { entregaEfdIcms: true, bloqueios: ['Bloco K'], atencoes: [] },
        },
    });

    it('a ordem é pronta → um bloqueio → três bloqueios', () => {
        expect(fila().linhas.map((l: any) => l.nome)).toEqual(['PRONTA', 'UM PASSO', 'TRES PASSOS']);
    });

    it('o resumo nomeia o gargalo dominante, com onde resolver', () => {
        const r = fila().resumo;
        expect(r.total).toBe(3);
        expect(r.prontas).toBe(1);
        expect(r.bloqueadas).toBe(2);
        expect(r.gargalo.area).toBe('captura-entrada');
        expect(r.gargalo.onde).toMatch(/Prova de captura/);
        expect(r.resumo).toMatch(/1 de 3 empresa\(s\) prontas/);
    });

    it('separa a onda de serviço puro — senão a fila parece travada à toa', () => {
        const r = montarFilaMigracao({
            empresas: [emp({ id: 'a' }), emp({ id: 'b' })],
            vereditos: { a: capturaOk, b: capturaOk },
            aptidoes: { a: saidaOk, b: saidaOk },
            prontidoes: { a: { entregaEfdIcms: false }, b: { entregaEfdIcms: true, bloqueios: ['Bloco K'] } },
        }).resumo;
        expect(r.servicoPuro).toBe(1);
        expect(r.servicoPuroPronto).toBe(1);
        expect(r.prontas).toBe(1);
    });

    it('carteira vazia não vira "tudo pronto"', () => {
        expect(resumirFila([]).resumo).toMatch(/Nenhuma empresa/);
        expect(resumirFila([]).prontas).toBe(0);
        expect(resumirFila([]).gargalo).toBeNull();
    });

    it('aceita Map além de objeto — as rotas montam com Map', () => {
        const r = montarFilaMigracao({
            empresas: [emp({ id: 'a' })],
            vereditos: new Map([['a', capturaOk]]),
            aptidoes: new Map([['a', saidaOk]]),
            prontidoes: new Map([['a', blocosOk]]),
        });
        expect(r.linhas[0].pronta).toBe(true);
    });
});
