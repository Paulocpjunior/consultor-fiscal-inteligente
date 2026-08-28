/**
 * 📋 A ENTREGA DECLARADA DA OBRIGAÇÃO QUE O CATÁLOGO NÃO COBRE.
 *
 * 28/08, CLINICA MEDICA MANTOAN 07/2026 (Paulo, com o print): *"Das empresas
 * que são só serviços e obrigações e envio de impostos, para encerrar o mês…
 * pra encerrar o mês essas duas etapas está como se não tivesse feita"*.
 *
 * A etapa 4 dizia *"7 obrigação(ões) entregue(s) · o catálogo NÃO cobre 1
 * obrigação(ões) deste regime: INSS Patronal (depende de folha)"* — e ela NUNCA
 * ia fechar: o INSS patronal depende da FOLHA, que vive no módulo de DP. O app
 * mandava, para sempre, não fechar o mês de quem já tinha feito o trabalho.
 */
// @ts-expect-error — módulo .js puro
import { coberturaDeclarada, conferirDeclaracaoCobertura, MOTIVO_MINIMO, podeDeclararCobertura, textoDaDeclaracaoCobertura } from '../sefaz-backend/obrigacao-fora-do-catalogo.js';

/** A etapa 4 da MANTOAN, como a Rotina a monta. */
const ETAPA_MANTOAN = {
    coberturaIncompleta: true,
    regimeIndefinido: false,
    propostas: ['INSS Patronal (depende de folha)'],
    prazoDeOutraUf: [],
};

describe('🚨 quem PODE declarar — e é aqui que mora a trava', () => {
    it('a MANTOAN pode: o que trava é obrigação que o catálogo admite não cobrir', () => {
        expect(podeDeclararCobertura(ETAPA_MANTOAN)).toBe(true);
    });

    // ⚠️ AS TRÊS CAUSAS COM CONSERTO NÃO ABREM A PORTA. Declarar por cima delas
    // apagaria o caminho — e no caso da UF a data ESTÁ na tela e parece certa.
    it('regime INDEFINIDO não abre a porta — resolve-se na ficha', () => {
        expect(podeDeclararCobertura({ ...ETAPA_MANTOAN, regimeIndefinido: true })).toBe(false);
    });

    it('prazo de OUTRA UF não abre a porta — a data na tela é de outro estado', () => {
        expect(podeDeclararCobertura({ ...ETAPA_MANTOAN, prazoDeOutraUf: ['SPED'] })).toBe(false);
    });

    it('etapa sem cobertura incompleta não abre a porta', () => {
        expect(podeDeclararCobertura({ ...ETAPA_MANTOAN, coberturaIncompleta: false })).toBe(false);
        expect(podeDeclararCobertura(null)).toBe(false);
    });

    it('cobertura incompleta SEM obrigação proposta não abre a porta', () => {
        expect(podeDeclararCobertura({ ...ETAPA_MANTOAN, propostas: [] })).toBe(false);
    });
});

describe('a declaração é CONFERIDA antes de gravar', () => {
    const base = {
        obrigacoes: ['INSS Patronal (depende de folha)'],
        comoFoi: 'Entregue pelo DP no e-CAC junto com a DCTFWeb.',
        quando: '2026-08-10',
        quem: 'paulo@sp',
        hojeIso: '2026-08-28',
    };

    it('a declaração completa passa e carimba o autor', () => {
        const r = conferirDeclaracaoCobertura(base);
        expect(r.ok).toBe(true);
        expect(r.declaracao.declaradoPor).toBe('paulo@sp');
        expect(r.declaracao.obrigacoes).toEqual(['INSS Patronal (depende de folha)']);
    });

    // A obrigação vai NOMEADA: "declarei que entreguei tudo" não responde nada
    // daqui a três meses, e é o nome que liga a declaração à lista da etapa.
    it('sem obrigação nomeada, RECUSA', () => {
        expect(conferirDeclaracaoCobertura({ ...base, obrigacoes: [] }).ok).toBe(false);
        expect(conferirDeclaracaoCobertura({ ...base, obrigacoes: ['   '] }).ok).toBe(false);
    });

    it(`texto abaixo de ${MOTIVO_MINIMO} caracteres, RECUSA`, () => {
        const r = conferirDeclaracaoCobertura({ ...base, comoFoi: 'entreguei' });
        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(new RegExp(String(MOTIVO_MINIMO)));
    });

    // 🚨 Declarar entrega que ainda não aconteceu fecharia o mês sobre trabalho
    // não feito. No passado é legítimo — é o caso.
    it('data no FUTURO, RECUSA; no passado, passa', () => {
        expect(conferirDeclaracaoCobertura({ ...base, quando: '2026-09-01' }).ok).toBe(false);
        expect(conferirDeclaracaoCobertura({ ...base, quando: '2026-08-28' }).ok).toBe(true);
    });

    it('data ilegível, RECUSA', () => {
        expect(conferirDeclaracaoCobertura({ ...base, quando: '10/08/2026' }).ok).toBe(false);
        expect(conferirDeclaracaoCobertura({ ...base, quando: '' }).ok).toBe(false);
    });

    // Declaração sem autor é declaração de ninguém — e é o autor que a torna
    // aceitável no lugar da tarefa que o catálogo não gerou.
    it('sem autor, RECUSA', () => {
        expect(conferirDeclaracaoCobertura({ ...base, quem: null }).ok).toBe(false);
    });
});

describe('a leitura compara os NOMES — e é ela que tira a trava', () => {
    const dec = { obrigacoes: ['INSS Patronal (depende de folha)'], comoFoi: 'x'.repeat(20), quando: '2026-08-10', declaradoPor: 'paulo@sp' };

    it('cobre quando a declaração menciona todas as obrigações da etapa', () => {
        expect(coberturaDeclarada(ETAPA_MANTOAN, dec)).toEqual({ cobre: true, faltam: [] });
    });

    // ⚠️ Quitação de julho não alcança obrigação que apareceu depois dela: se o
    // catálogo passar a admitir uma obrigação NOVA, a etapa volta a acusar.
    it('obrigação NOVA que a declaração não menciona faz a etapa voltar a acusar', () => {
        const etapa = { ...ETAPA_MANTOAN, propostas: ['INSS Patronal (depende de folha)', 'ISS (depende de calendário do município)'] };
        const r = coberturaDeclarada(etapa, dec);
        expect(r.cobre).toBe(false);
        expect(r.faltam).toEqual(['ISS (depende de calendário do município)']);
    });

    it('sem declaração, não cobre', () => {
        expect(coberturaDeclarada(ETAPA_MANTOAN, null).cobre).toBe(false);
    });

    // Declaração gravada numa etapa que não admite a porta NÃO vale — senão
    // uma declaração velha daria quitação a um regime indefinido de hoje.
    it('etapa que não admite a porta não é coberta nem com declaração', () => {
        expect(coberturaDeclarada({ ...ETAPA_MANTOAN, regimeIndefinido: true }, dec).cobre).toBe(false);
    });
});

describe('a frase que fica', () => {
    it('DIZ que o app não tem prova da entrega, com autor, data e obrigação', () => {
        const t = textoDaDeclaracaoCobertura({
            obrigacoes: ['INSS Patronal (depende de folha)'],
            comoFoi: 'Entregue pelo DP no e-CAC.',
            quando: '2026-08-10',
            declaradoPor: 'paulo@sp',
        });
        expect(t).toMatch(/paulo@sp/);
        expect(t).toMatch(/10\/08\/2026/);
        expect(t).toMatch(/INSS Patronal/);
        expect(t).toMatch(/não tem prova da entrega/);
    });
});
