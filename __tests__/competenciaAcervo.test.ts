/**
 * A metade que faltou em 03/09: a nota JÁ GRAVADA no mês errado.
 *
 * Naquele dia os quatro trilhos passaram a gravar a competência pelo FATO
 * GERADOR, e ficou escrito que *"o ACERVO não se conserta sozinho"*. Este
 * módulo é a lista e a decisão; a gravação é um clique por nota.
 *
 * O caso que fixa os números é o do próprio mata-burro (CASA DA CRIANCA
 * BETINHO): `Emissão 02/09/2026 · Data Fato Gerador 31/08/2026`, listada pelo
 * portal dentro de AGOSTO.
 */
import {
    classificarCompetenciaDoAcervo,
    montarFilaCompetencia,
    patchCorrecaoCompetencia,
} from '../sefaz-backend/competencia-acervo.js';

const NOTA_ERRADA = {
    id: 'doc-205',
    tipo: 'NFSe',
    numero: '205',
    competencia: '2026-09',
    dataFatoGerador: '2026-08-31',
    dhEmi: '2026-09-02T08:36:34-03:00',
    prestadorNome: 'S&P ASSESSORIA CONTABIL',
    valorServicos: 1500,
};

describe('classificar a nota do acervo', () => {
    it('acusa o mês errado com os dois meses nomeados', () => {
        const r = classificarCompetenciaDoAcervo(NOTA_ERRADA);
        expect(r.situacao).toBe('mes-errado');
        expect(r.precisaCorrigir).toBe(true);
        expect(r.competenciaGravada).toBe('2026-09');
        expect(r.competenciaCerta).toBe('2026-08');
        // A consequência é dita ANTES do clique: corrigir mexe nos DOIS meses.
        expect(r.consequencia).toMatch(/08\/2026/);
        expect(r.consequencia).toMatch(/09\/2026/);
        expect(r.consequencia).toMatch(/regerad/i);
    });

    it('NÃO acusa quando emissão e prestação caem no mesmo mês (o caso comum)', () => {
        // A maioria do acervo antigo foi gravada pela emissão e está CERTA.
        // Acusar tudo encheria a fila de nota correta.
        const r = classificarCompetenciaDoAcervo({
            ...NOTA_ERRADA, competencia: '2026-08',
            dataFatoGerador: '2026-08-15', dhEmi: '2026-08-20T10:00:00-03:00',
        });
        expect(r.situacao).toBe('confere');
        expect(r.precisaCorrigir).toBe(false);
    });

    it('lê as formas em que a competência foi gravada, sem inventar divergência', () => {
        for (const forma of ['2026-08', '08/2026', '202608', '2026-08-31']) {
            const r = classificarCompetenciaDoAcervo({
                ...NOTA_ERRADA, competencia: forma, dataFatoGerador: '2026-08-31',
            });
            expect(r.situacao).toBe('confere');
        }
    });

    it('documento SEM fato gerador não vira pendência — não há o que comparar', () => {
        const { dataFatoGerador, ...semFg } = NOTA_ERRADA;
        const r = classificarCompetenciaDoAcervo(semFg);
        expect(r.situacao).toBe('sem-fato-gerador');
        expect(r.precisaCorrigir).toBe(false);
    });

    it('NF-e fica fora: ali a emissão É a competência', () => {
        // Perguntar na mercadoria inventaria divergência — é a triagem que
        // poupou o `xml-importer` em 03/09.
        const r = classificarCompetenciaDoAcervo({
            ...NOTA_ERRADA, tipo: 'NFe', modelo: '55', chave: '3'.repeat(44),
        });
        expect(r.situacao).toBe('fora-do-escopo');
    });

    it('nota tirada do livro fica fora', () => {
        const r = classificarCompetenciaDoAcervo({ ...NOTA_ERRADA, _deleted: true });
        expect(r.situacao).toBe('fora-do-escopo');
    });

    it('nota já corrigida não é reoferecida', () => {
        const r = classificarCompetenciaDoAcervo({
            ...NOTA_ERRADA,
            competenciaCorrigida: { em: '2026-09-11T10:00:00Z', porEmail: 'a@b.c' },
        });
        expect(r.situacao).toBe('ja-corrigida');
        expect(r.precisaCorrigir).toBe(false);
    });

    it('nunca lança sobre documento torto', () => {
        for (const lixo of [null, undefined, {}, { tipo: 'NFSe' }]) {
            expect(() => classificarCompetenciaDoAcervo(lixo as never)).not.toThrow();
        }
    });
});

describe('a fila da empresa', () => {
    it('conta o que ficou de fora, por causa — some da fila, nunca da conta', () => {
        const { dataFatoGerador, ...semFg } = NOTA_ERRADA;
        const f = montarFilaCompetencia([
            NOTA_ERRADA,
            { ...NOTA_ERRADA, id: 'ok', competencia: '2026-08' },
            { ...semFg, id: 'sem-fg' },
            { ...NOTA_ERRADA, id: 'nfe', tipo: 'NFe', modelo: '55' },
        ]);
        expect(f.paraCorrigir).toHaveLength(1);
        expect(f.contagem.conferem).toBe(1);
        expect(f.contagem.semFatoGerador).toBe(1);
        expect(f.contagem.foraDoEscopo).toBe(1);
        expect(f.contagem.examinadas).toBe(3);
    });

    it('fila vazia SEM nada examinado não diz "está tudo certo"', () => {
        // Farol honesto: ausência de nota de serviço é resposta sobre a
        // ausência, não sobre a saúde do acervo.
        const f = montarFilaCompetencia([{ tipo: 'NFe', modelo: '55' }]);
        expect(f.paraCorrigir).toHaveLength(0);
        expect(f.resumo).toMatch(/Nenhum documento de serviço/i);
        expect(f.resumo).not.toMatch(/nenhuma está no mês errado/i);
    });

    it('a mais antiga vem primeiro', () => {
        const f = montarFilaCompetencia([
            { ...NOTA_ERRADA, id: 'b', dataFatoGerador: '2026-08-31', competencia: '2026-09' },
            { ...NOTA_ERRADA, id: 'a', dataFatoGerador: '2026-06-30', competencia: '2026-07' },
        ]);
        expect(f.paraCorrigir.map((x) => x.id)).toEqual(['a', 'b']);
    });
});

describe('o patch da correção', () => {
    it('monta a competência certa e guarda a antiga', () => {
        const r = patchCorrecaoCompetencia({
            doc: NOTA_ERRADA, porEmail: 'colab@sp.com.br',
            motivo: 'fato gerador 31/08 conferido no portal',
            agoraIso: '2026-09-11T12:00:00Z',
        });
        if (!r.ok) throw new Error(r.erro);
        expect(r.patch.competencia).toBe('2026-08');
        expect(r.patch.competenciaOrigem).toBe('fato-gerador');
        // Sem a competência antiga não há como responder depois "este livro
        // foi gerado antes ou depois da correção?".
        expect(r.patch.competenciaCorrigida.de).toBe('2026-09');
        expect(r.patch.competenciaCorrigida.porEmail).toBe('colab@sp.com.br');
    });

    it('RECUSA sem autor e sem motivo escrito', () => {
        const semAutor = patchCorrecaoCompetencia({ doc: NOTA_ERRADA, motivo: 'motivo bem escrito aqui' });
        if (semAutor.ok) throw new Error('deveria ter recusado sem autor');
        expect(semAutor.erro).toMatch(/quem está corrigindo/i);

        const motivoCurto = patchCorrecaoCompetencia({ doc: NOTA_ERRADA, porEmail: 'a@b.c', motivo: 'erro' });
        if (motivoCurto.ok) throw new Error('deveria ter recusado motivo curto');
        expect(motivoCurto.erro).toMatch(/15 caracteres/);
    });

    it('RECUSA nota que não está no mês errado', () => {
        const r = patchCorrecaoCompetencia({
            doc: { ...NOTA_ERRADA, competencia: '2026-08' },
            porEmail: 'a@b.c', motivo: 'motivo bem escrito aqui',
        });
        if (r.ok) throw new Error('deveria ter recusado nota que confere');
        expect(r.erro).toMatch(/confere/);
    });

    it('o patch NÃO apaga o fato gerador nem o documento', () => {
        const r = patchCorrecaoCompetencia({
            doc: NOTA_ERRADA, porEmail: 'a@b.c', motivo: 'motivo bem escrito aqui',
        });
        if (!r.ok) throw new Error(r.erro);
        expect(Object.keys(r.patch).sort())
            .toEqual(['competencia', 'competenciaCorrigida', 'competenciaOrigem']);
    });
});
