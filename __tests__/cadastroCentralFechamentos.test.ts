// ============================================================================
// 🔒 FASE 5 DO TÚNEL: o Contábil importa o FECHAMENTO, nunca a ficha
//
// Paulo, 26/08: *"o departamento contábil, através do CCI, deve fazer a
// importação com a mesma exatidão dos valores apurados e o mês fechado"*.
//
// A ficha é um registro VIVO — alguém edita e o número muda. Servir a ficha
// pelo túnel faria o Contábil puxar um valor que pode mudar depois, e a
// divergência voltaria pela porta de trás, calada.
// ============================================================================
// O módulo tem `.d.ts` — o tsc confere o que se importa dele.
import {
    linhaDoFechamento, resumirFechamentos, RESSALVA_NAO_RECALCULAR,
} from '../sefaz-backend/cadastro-central-fechamentos.js';

const EMPRESA = { id: 'emp-1', cnpj: '31.947.349/0001-69', nome: 'PWR INDUSTRIA' };
const COMP = '2026-08';

const carimbo = (over: Record<string, unknown> = {}) => ({
    estado: 'fechada',
    versao: 1,
    fechadoEm: '2026-09-05T13:00:00.000Z',
    fechadoPor: { email: 'colaborador@spassessoriacontabil.com.br' },
    apurado: { totalImpostos: 4056.37, ipiRecolher: 2200.45, icmsStRecolher: null },
    lastro: { situacao: 'com-lastro', cor: 'ok', mensagem: 'A apuração tem 143 documento(s) por trás.' },
    corte: { instante: '2026-09-05T13:00:00.000Z', ultNSU: 4210, maxNSU: 4210, documentos: { total: 143 } },
    reaberturas: [],
    ...over,
});

const linha = (fechamento: unknown) =>
    linhaDoFechamento({ empresa: EMPRESA, competencia: COMP, fechamento } as never);

describe('🚨 competência FECHADA: entrega o resultado, com a prova e a ressalva', () => {
    const l = linha(carimbo());

    it('pode importar, e diz a versão', () => {
        expect(l).toMatchObject({ estado: 'fechada', podeImportar: true, versao: 1 });
        expect(l.cnpj).toBe('31947349000169');
        expect(l.fechadoPor).toBe('colaborador@spassessoriacontabil.com.br');
    });

    // 🚨 A régua já provada no R-2055: a ressalva PROÍBE recalcular. Dois
    // números para o mesmo fato é o defeito que este túnel existe para matar.
    it('a ressalva vai junto e PROÍBE recalcular', () => {
        expect(l.ressalva).toBe(RESSALVA_NAO_RECALCULAR);
        expect(l.ressalva).toMatch(/não recalcule/i);
    });

    it('leva os apurados como estão — inclusive o null', () => {
        // O `.d.ts` tipa `apurado` como nullable de propósito: na competência
        // ABERTA ele É null, e o tsc obriga a estreitar antes de ler.
        if (!l.apurado) throw new Error('competência fechada tem de trazer os apurados');
        expect(l.apurado.totalImpostos).toBe(4056.37);
        // Ausência é null, nunca zero: zero num campo de saldo é uma AFIRMAÇÃO,
        // e esta atravessa para a contabilidade.
        expect(l.apurado.icmsStRecolher).toBeNull();
    });

    // A prova de QUAL acervo virou este número.
    it('o corte atravessa com o NSU e a contagem', () => {
        expect(l.corte).toMatchObject({ ultNSU: 4210, maxNSU: 4210, documentos: 143 });
    });

    // 🚨 Sem o lastro, o Contábil importa número fechado que pode ter ZERO
    // documento por trás (o caso EXPERTE) sem nenhuma ressalva na tela dele.
    it('o lastro atravessa', () => {
        expect(l.lastro).toMatchObject({ situacao: 'com-lastro', cor: 'ok' });
    });
});

describe('🚨 competência ABERTA não entrega valor — e NÃO some da lista', () => {
    const l = linha(null);

    it('não pode importar e diz por quê', () => {
        expect(l).toMatchObject({ estado: 'aberta', podeImportar: false, versao: null });
        expect(l.motivo).toMatch(/ainda não foi dado/);
    });

    // Sumir faria o Contábil concluir "este cliente não teve movimento" — uma
    // afirmação que ninguém fez.
    it('a empresa continua na resposta, com nome e CNPJ', () => {
        expect(l.cnpj).toBe('31947349000169');
        expect(l.nome).toBe('PWR INDUSTRIA');
    });

    it('e NENHUM valor viaja', () => {
        expect(l.apurado).toBeNull();
        expect(l.corte).toBeNull();
    });
});

describe('🚨 REABERTA BLOQUEIA — decisão do Paulo, e ele abriu exceção à régua da casa', () => {
    const reaberto = carimbo({
        estado: 'reaberta', versao: 1,
        reaberturas: [{
            em: '2026-09-10T10:00:00.000Z', por: 'admin@spassessoriacontabil.com.br',
            motivo: 'Nota da GLOBAL chegou depois do corte.', versaoReaberta: 1,
        }],
    });
    const l = linha(reaberto);

    it('não pode importar', () => {
        expect(l).toMatchObject({ estado: 'reaberta', podeImportar: false });
        expect(l.apurado).toBeNull();
    });

    // 🚨 Sem isto o Contábil fica com o número velho SEM SABER que ele mudou —
    // que é exatamente a divergência que o túnel existe para matar.
    it('diz QUAL versão ele pode ter importado, e por que ela mudou', () => {
        expect(l.versaoQueVoceTalvezTenha).toBe(1);
        expect(l.motivo).toMatch(/GLOBAL/);
        expect(l.motivo).toMatch(/desatualizada/);
        expect(l.motivo).toMatch(/admin@spassessoriacontabil\.com\.br/);
    });
});

describe('🚨 o resumo diz o que ainda falta fechar', () => {
    it('conta importáveis, abertas e reabertas', () => {
        const r = resumirFechamentos([
            linha(carimbo()),
            linha(null),
            linha(carimbo({ estado: 'reaberta', reaberturas: [{ versaoReaberta: 1 }] })),
        ]);
        expect(r).toMatchObject({ total: 3, importaveis: 1, abertas: 1, reabertas: 1 });
    });

    // ⚠️ Contado À PARTE: número fechado SEM documento por trás é importável e
    // merece olho humano do outro lado. Fundi-lo no total esconderia o caso
    // EXPERTE justamente de quem vai lançar na contabilidade.
    it('e conta à parte o fechado SEM lastro', () => {
        const semLastro = linha(carimbo({
            lastro: { situacao: 'sem-documento', cor: 'falha', mensagem: 'A apuração na ficha SEM NENHUM documento por trás.' },
        }));
        expect(semLastro.podeImportar).toBe(true);
        expect(resumirFechamentos([semLastro]).semLastro).toBe(1);
        expect(resumirFechamentos([linha(carimbo())]).semLastro).toBe(0);
    });
});
