// ============================================================================
// 🚨 "PRECISO TER A OPÇÃO DE AJUSTAR AS RETENÇÕES PARA ENTREGAR COM O VALOR
// CORRETO" (31/08, Paulo, no R-4020 da CONDOMINIO EDIFICIO MONTE CARLO).
//
// O CASO, com os números do print — NFS-e 377235, ELEVADORES ATLAS SCHINDLER:
//
//   VALOR TOTAL DO SERVIÇO ............ 3.413,24
//   PIS/PASEP (campo da nota) ............ 56,32   = 1,65% da base
//   COFINS    (campo da nota) ........... 259,41   = 7,60% da base
//   Contribuições Sociais - Retidas ..... 158,72   = 4,65% da base
//
// E a própria nota avisa: *"(5) Informações preenchidas nos campos de PIS e
// COFINS são referentes aos valores totais sobre a operação"*.
//
// 🔴 O app JÁ DENUNCIAVA (desde 07/08) e PARAVA AÍ — o evento não saía, ou
// sairia declarando 315,73 no lugar de 158,72, quase o DOBRO.
// ============================================================================
import {
    ALIQ_LEGAL, MIN_MOTIVO, decomporCsrf, validarAjusteRetencao,
    retencaoEfetivaDaNota, chaveDoAjuste, resumirRetencoesEfetivas,
} from '../sefaz-backend/retencao-pj-ajuste.js';
import { conferirRetencaoFederal } from '../sefaz-backend/retencao-federal-coerencia.js';
import { montarPayloadReinfPJ } from '../sefaz-backend/reinf-retencoes-pj.js';

const BASE = 3413.24;
const CSRF = 158.72;
const PIS_OPERACAO = 56.32;
const COFINS_OPERACAO = 259.41;

// ════════════════════════════════════════════════════════════════════════════
// 📖 A DECOMPOSIÇÃO É DE LEI, E A PROVA É A SOMA FECHAR COM A NOTA.
//
// Lei 10.833/2003 art. 30: 4,65% = 1% CSLL + 3% COFINS + 0,65% PIS.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 a CSRF se decompõe pelas alíquotas legais', () => {
    it('as três alíquotas são as da lei', () => {
        expect(ALIQ_LEGAL).toEqual({ pis: 0.65, cofins: 3, csll: 1 });
        expect(ALIQ_LEGAL.pis + ALIQ_LEGAL.cofins + ALIQ_LEGAL.csll).toBeCloseTo(4.65, 10);
    });

    // 🚨 O NÚMERO DO PRINT, ao centavo — é ele que autoriza a derivação.
    it('a nota da ATLAS fecha EXATAMENTE: 22,19 + 102,40 + 34,13 = 158,72', () => {
        const d = decomporCsrf({ base: BASE, csrf: CSRF });
        expect(d.fecha).toBe(true);
        expect(d.valores).toEqual({ pis: 22.19, cofins: 102.40, csll: 34.13 });
        expect(d.soma).toBe(CSRF);
    });

    // ⚠️ A SOBRA VAI À COFINS (a maior das três) — a soma TEM de dar o que a
    // nota declara, senão o evento declara um total que o documento desmente.
    it('a soma bate com o campo da nota mesmo com sobra de arredondamento', () => {
        for (const base of [1000, 1234.56, 999.99, 3413.24, 87654.21, 7.53]) {
            const csrf = Math.round(base * 0.0465 * 100) / 100;
            const d = decomporCsrf({ base, csrf });
            if (!d.fecha) continue;
            expect(d.valores!.pis + d.valores!.cofins + d.valores!.csll).toBeCloseTo(csrf, 2);
        }
    });

    // 🚨 SÓ DECOMPÕE QUANDO FECHA EM 4,65%. Base com dedução ou retenção
    // parcial não se decompõe por proporção deduzida — ali o app não sabe, e
    // decompor "quase" é o rateio inventado com outra roupa.
    it('alíquota que não é a CSRF NÃO se decompõe', () => {
        expect(decomporCsrf({ base: BASE, csrf: 100 }).fecha).toBe(false);
        expect(decomporCsrf({ base: BASE, csrf: 100 }).motivo).toBe('aliquota-nao-e-csrf');
    });

    it('sem base ou sem valor não afirma nada', () => {
        expect(decomporCsrf({ base: 0, csrf: CSRF }).fecha).toBe(false);
        expect(decomporCsrf({ base: BASE, csrf: 0 }).fecha).toBe(false);
        expect(decomporCsrf({}).fecha).toBe(false);
        expect(decomporCsrf().fecha).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 A RESPOSTA: quanto esta nota reteve, e de ONDE veio o número.
// ════════════════════════════════════════════════════════════════════════════
const notaAtlas = (over = {}) => ({
    base: BASE, ir: 0, pis: PIS_OPERACAO, cofins: COFINS_OPERACAO,
    csllOuTotal: CSRF, inss: 0, ...over,
});
const efetiva = (nota: any, ajuste?: any) => retencaoEfetivaDaNota({
    nota,
    coerencia: conferirRetencaoFederal({
        base: nota.base, pis: nota.pis, cofins: nota.cofins, csll: nota.csllOuTotal,
    }),
    ajuste,
});

describe('🚨 o caso ATLAS — 315,73 virava a declaração, e o certo é 158,72', () => {
    const r = efetiva(notaAtlas());

    it('a retenção declarada passa a ser a CSRF decomposta', () => {
        expect(r.origem).toBe('csrf-decomposta');
        expect(r.pis).toBe(22.19);
        expect(r.cofins).toBe(102.40);
        expect(r.csll).toBe(34.13);
        expect(r.pis + r.cofins + r.csll).toBeCloseTo(CSRF, 2);
    });

    // 🔴 O que saía antes: os campos crus, quase o DOBRO.
    it('e NÃO é mais o tributo da operação do prestador', () => {
        expect(PIS_OPERACAO + COFINS_OPERACAO).toBeCloseTo(315.73, 2);
        expect(r.pis).not.toBe(PIS_OPERACAO);
        expect(r.cofins).not.toBe(COFINS_OPERACAO);
    });

    // ⚠️ NÚMERO DERIVADO SAI DITO — número derivado que se apresenta como fato
    // lido do documento é o começo de uma divergência que só a fiscalização acha.
    it('a origem e o motivo saem na ressalva, com a citação da lei', () => {
        expect(r.ressalva).toMatch(/DERIVAD/i);
        expect(r.ressalva).toMatch(/10\.833\/2003/);
        expect(r.ressalva).toMatch(/tributo da OPERAÇÃO/);
        expect(r.exigeAjuste).toBe(false);
    });

    // ⚠️ E o que o DOCUMENTO diz continua ao lado, para conferência: substituir
    // sem guardar o original tiraria de quem confere o número que ele vê na nota.
    it('o valor do documento continua visível', () => {
        expect(r.doDocumento).toEqual({ ir: 0, pis: PIS_OPERACAO, cofins: COFINS_OPERACAO, csll: CSRF, inss: 0 });
    });
});

describe('🚨 sem o campo da CSRF, o app NÃO deriva — e diz que só o ajuste resolve', () => {
    // É o caso do print: a tela mostra CSLL R$ 0,00 ao lado dos campos da
    // operação. Não há de onde derivar.
    const r = efetiva(notaAtlas({ csllOuTotal: 0 }));

    it('não inventa: marca a nota como exigindo ajuste', () => {
        expect(r.origem).toBe('documento-suspeito');
        expect(r.exigeAjuste).toBe(true);
        expect(r.ressalva).toMatch(/NÃO tem como derivar/);
        expect(r.ressalva).toMatch(/Ajuste a retenção à mão/);
    });

    // 🚨 As duas saídas fáceis MENTEM, e por isso nenhuma foi tomada: devolver
    // o documento declara o tributo do prestador como retido; devolver zero
    // declara que não houve retenção.
    it('e não devolve zero disfarçado de "não houve retenção"', () => {
        expect(r.pis).toBe(PIS_OPERACAO);
        expect(r.cofins).toBe(COFINS_OPERACAO);
    });
});

describe('✍️ o AJUSTE declarado vence tudo — é o que o Paulo pediu', () => {
    const ajuste = {
        pis: 22.19, cofins: 102.40, csll: 34.13,
        autor: 'sandra@spassessoriacontabil.com.br',
        motivo: 'CSRF 158,72 lida no campo de contribuições sociais retidas da NFS-e 377235',
        em: '2026-08-31T12:00:00Z',
    };

    it('substitui o documento e diz quem, quando e por quê', () => {
        const r = efetiva(notaAtlas({ csllOuTotal: 0 }), ajuste);
        expect(r.origem).toBe('ajuste-declarado');
        expect(r.pis).toBe(22.19);
        expect(r.cofins).toBe(102.40);
        expect(r.csll).toBe(34.13);
        expect(r.ajustadoPor).toBe('sandra@spassessoriacontabil.com.br');
        expect(r.motivo).toMatch(/377235/);
        expect(r.exigeAjuste).toBe(false);
        expect(r.ressalva).toMatch(/AJUSTADA à mão/);
    });

    // ⚠️ Vence inclusive a derivação — quem ajustou olhou a nota.
    it('vence a CSRF decomposta', () => {
        const r = efetiva(notaAtlas(), { ...ajuste, pis: 1, cofins: 2, csll: 3 });
        expect(r.origem).toBe('ajuste-declarado');
        expect(r.pis).toBe(1);
    });

    // ⚠️ Campo não informado no ajuste NÃO vira zero: ele mantém o do
    // documento. Zerar o que ninguém mencionou apagaria retenção existente.
    it('campo ausente no ajuste preserva o do documento', () => {
        const r = efetiva(notaAtlas({ ir: 51.2, csllOuTotal: 0 }), { pis: 10, autor: 'a', motivo: 'x'.repeat(20) });
        expect(r.pis).toBe(10);
        expect(r.ir).toBe(51.2);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ A CSLL QUE É O TOTAL TEM OUTRA RESPOSTA — ali PIS e COFINS já estão certos
// no documento, e o que falta é só a CSLL individual. Tratar como o caso da
// ATLAS sobrescreveria dado BOM.
// ════════════════════════════════════════════════════════════════════════════
describe('⚠️ CSLL igual ao total das três é outro caso, com outro dono', () => {
    it('deriva só a CSLL, preservando PIS e COFINS do documento', () => {
        const nota = { base: 1000, ir: 0, pis: 6.5, cofins: 30, csllOuTotal: 46.5, inss: 0 };
        const r = efetiva(nota);
        expect(r.origem).toBe('csll-derivada-da-base');
        expect(r.pis).toBe(6.5);
        expect(r.cofins).toBe(30);
        expect(r.csll).toBe(10);
        expect(r.ressalva).toMatch(/TOTAL das três/);
    });
});

describe('✅ a nota normal não muda de nada — e é a maioria esmagadora', () => {
    it('retenção coerente vem do DOCUMENTO, sem ressalva', () => {
        const nota = { base: 1000, ir: 15, pis: 6.5, cofins: 30, csllOuTotal: 10, inss: 0 };
        const r = efetiva(nota);
        expect(r.origem).toBe('documento');
        expect(r).toMatchObject({ ir: 15, pis: 6.5, cofins: 30, csll: 10 });
        expect(r.ressalva).toBeNull();
        expect(r.exigeAjuste).toBe(false);
    });

    it('nota sem retenção nenhuma continua sem retenção', () => {
        const r = efetiva({ base: 1000, ir: 0, pis: 0, cofins: 0, csllOuTotal: 0, inss: 0 });
        expect(r.origem).toBe('documento');
        expect(r.exigeAjuste).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ✍️ O AJUSTE É UMA DECLARAÇÃO — autor, motivo escrito, e o impossível recusado
// com o campo NOMEADO.
// ════════════════════════════════════════════════════════════════════════════
describe('✍️ o ajuste se valida antes de gravar', () => {
    const bom = { base: BASE, pis: 22.19, cofins: 102.40, csll: 34.13, autor: 'a@b.com', motivo: 'x'.repeat(MIN_MOTIVO) };

    it('o caminho feliz passa', () => {
        const v = validarAjusteRetencao(bom);
        expect(v.ok).toBe(true);
        expect(v.valores).toMatchObject({ pis: 22.19, cofins: 102.40, csll: 34.13, autor: 'a@b.com' });
        expect(v.valores!.soma).toBeCloseTo(CSRF, 2);
    });

    it('sem autor é recusado — declaração sem autor é declaração de ninguém', () => {
        const v = validarAjusteRetencao({ ...bom, autor: '' });
        expect(v.ok).toBe(false);
        expect(v.erros.join(' ')).toMatch(/Sem autor/);
    });

    it('motivo curto é recusado, com o piso na mensagem', () => {
        const v = validarAjusteRetencao({ ...bom, motivo: 'errado' });
        expect(v.ok).toBe(false);
        expect(v.erros.join(' ')).toMatch(new RegExp(`${MIN_MOTIVO} caracteres`));
    });

    it('valor negativo é recusado, com o campo nomeado', () => {
        const v = validarAjusteRetencao({ ...bom, pis: -1 });
        expect(v.ok).toBe(false);
        expect(v.erros.join(' ')).toMatch(/PIS negativo/);
    });

    // ⚠️ Retenção maior que o serviço é sempre erro de digitação ou de campo.
    it('retenção maior que a base é recusada, com os dois números', () => {
        const v = validarAjusteRetencao({ ...bom, cofins: 99999 });
        expect(v.ok).toBe(false);
        expect(v.erros.join(' ')).toMatch(/MAIOR que o valor do serviço/);
    });

    // ⚠️ ZERO É RESPOSTA LEGÍTIMA ("esta nota não teve retenção") — o que não
    // vale é o ajuste VAZIO, que não diz nada.
    it('zero declarado passa; ajuste sem nenhum campo não', () => {
        expect(validarAjusteRetencao({ ...bom, pis: 0, cofins: 0, csll: 0 }).ok).toBe(true);
        const vazio = validarAjusteRetencao({ base: BASE, autor: 'a@b.com', motivo: 'x'.repeat(20) });
        expect(vazio.ok).toBe(false);
        expect(vazio.erros.join(' ')).toMatch(/Nenhum valor informado/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 A CHAVE É A DA NOTA, NUNCA A DO PRESTADOR — a lição de 30/08 (o ✕ do
// FUNRURAL, que tirava TODAS as notas do produtor).
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 o ajuste é da NOTA', () => {
    it('a chave da nota manda', () => {
        expect(chaveDoAjuste({ chave: 'ABC', numero: '1', prestadorCnpj: '00028986000730' })).toBe('ABC');
    });

    it('sem chave, cai em prestador+número — que ainda é UMA nota', () => {
        expect(chaveDoAjuste({ numero: '377235', prestadorCnpj: '00.028.986/0007-30' }))
            .toBe('00028986000730-377235');
    });

    it('sem nada legível NÃO se ajusta', () => {
        expect(chaveDoAjuste({})).toBe('');
        expect(chaveDoAjuste({ numero: '1' })).toBe('');
        expect(chaveDoAjuste()).toBe('');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 PONTA A PONTA, com o payload que o REINF consome de verdade.
// ════════════════════════════════════════════════════════════════════════════
const CNPJ_TOMADOR = '54661145000162';
const docAtlas = (over = {}) => ({
    tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado',
    chave: 'NFSE-377235', numero: '377235', competencia: '2026-08',
    prestadorCnpj: '00028986000730', prestadorNome: 'ELEVADORES ATLAS SCHINDLER LTDA.',
    tomadorCnpj: CNPJ_TOMADOR,
    valorServicos: BASE,
    valorPis: PIS_OPERACAO, valorCofins: COFINS_OPERACAO, valorCsll: CSRF, valorIr: 0,
    ...over,
});

describe('🚨 o payload do R-4020 entrega a retenção EFETIVA', () => {
    it('a linha leva o bloco `retencao` com a CSRF decomposta', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: CNPJ_TOMADOR, competencia: '2026-08', documentos: [docAtlas()],
        });
        expect(p.notas).toHaveLength(1);
        expect(p.notas[0].retencao.origem).toBe('csrf-decomposta');
        expect(p.notas[0].retencao.pis).toBe(22.19);
        // Os campos CRUS continuam ao lado — é contra eles que se confere.
        expect(p.notas[0].pis).toBe(PIS_OPERACAO);
    });

    // 🚨 O TOTAL DO RESUMO SAI DO BLOCO EFETIVO: um resumo que soma os campos
    // crus desmentiria as linhas que ele resume.
    it('o total declarado é 158,72, não 315,73', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: CNPJ_TOMADOR, competencia: '2026-08', documentos: [docAtlas()],
        });
        expect(p.resumo.totalRetencaoDeclarada).toBeCloseTo(CSRF, 2);
        expect(p.resumo.csrfDecomposta).toBe(1);
        expect(p.ressalvas.join(' ')).toMatch(/DERIVADA da CSRF/);
    });

    it('o ajuste declarado chega à linha e é contado', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: CNPJ_TOMADOR, competencia: '2026-08',
            documentos: [docAtlas({ valorCsll: 0 })],
            ajustes: {
                'NFSE-377235': {
                    pis: 22.19, cofins: 102.40, csll: 34.13,
                    autor: 'sandra@spassessoriacontabil.com.br', motivo: 'x'.repeat(20),
                },
            },
        });
        expect(p.notas[0].retencao.origem).toBe('ajuste-declarado');
        expect(p.resumo.ajustadas).toBe(1);
        expect(p.resumo.totalRetencaoDeclarada).toBeCloseTo(CSRF, 2);
        expect(p.ressalvas.join(' ')).toMatch(/AJUSTADA à mão/);
    });

    // 🚨 O AJUSTE TRAZ A NOTA DE VOLTA. Sem isto, nota cujo documento não traz
    // retenção nenhuma sairia em `semRetencao` ANTES do ajuste ser lido — e o
    // ajuste ficaria gravado sem efeito, com a retenção sumindo.
    it('nota sem retenção no documento entra quando alguém ajusta', () => {
        const doc = docAtlas({ valorPis: 0, valorCofins: 0, valorCsll: 0, valorIr: 0 });
        const sem = montarPayloadReinfPJ({ cnpjTomador: CNPJ_TOMADOR, competencia: '2026-08', documentos: [doc] });
        expect(sem.notas).toHaveLength(0);
        expect(sem.resumo.semRetencao).toBe(1);

        const com = montarPayloadReinfPJ({
            cnpjTomador: CNPJ_TOMADOR, competencia: '2026-08', documentos: [doc],
            ajustes: { 'NFSE-377235': { csll: 34.13, autor: 'a@b.com', motivo: 'x'.repeat(20) } },
        });
        expect(com.notas).toHaveLength(1);
        expect(com.notas[0].retencao.origem).toBe('ajuste-declarado');
    });

    // ⚠️ O ajuste de UMA nota não alcança a outra — nem do mesmo prestador.
    it('ajustar uma nota não mexe na outra do mesmo prestador', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: CNPJ_TOMADOR, competencia: '2026-08',
            documentos: [
                docAtlas({ chave: 'NFSE-1', numero: '1', valorCsll: 0 }),
                docAtlas({ chave: 'NFSE-2', numero: '2', valorCsll: 0 }),
            ],
            ajustes: { 'NFSE-1': { pis: 1, cofins: 2, csll: 3, autor: 'a@b.com', motivo: 'x'.repeat(20) } },
        });
        const [a, b] = p.notas;
        expect(a.retencao.origem).toBe('ajuste-declarado');
        expect(b.retencao.origem).toBe('documento-suspeito');
        expect(b.retencao.exigeAjuste).toBe(true);
        expect(p.ressalvas.join(' ')).toMatch(/SEM valor confiável/);
    });

    it('o resumo conta as origens separadamente', () => {
        const r = resumirRetencoesEfetivas([
            { retencao: { origem: 'ajuste-declarado', exigeAjuste: false } as never },
            { retencao: { origem: 'csrf-decomposta', exigeAjuste: false } as never },
            { retencao: { origem: 'documento-suspeito', exigeAjuste: true } as never },
        ]);
        expect(r).toEqual({ ajustadas: 1, csrfDecomposta: 1, csllDerivada: 0, exigemAjuste: 1 });
    });
});
