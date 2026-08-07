/**
 * As NFS-e TOMADAS com retenção, no formato que o EFD-Reinf consome pro R-4020.
 *
 * A casca mora no CFI de propósito: o REINF é OUTRO app, em OUTRO projeto GCP
 * (o roadmap dele dizia que compartilhavam Firestore — não compartilham), e
 * quem conhece a forma do documento é este repo. A NFS-e do PORTAL vem
 * ACHATADA e a do XML vem em OBJETO; ler isso do outro lado seria reescrever a
 * armadilha que já mordeu seis vezes aqui.
 *
 * O que este teste protege acima de tudo: NOME DE CAMPO QUE MENTE é pior que
 * campo faltando — o outro lado usa e ninguém descobre até a declaração.
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { montarPayloadReinfPJ, normalizarNotaTomada } from '../sefaz-backend/reinf-retencoes-pj';

const TOMADOR = '51227692000146';

/** CLINIPAR, como o portal entrega (forma ACHATADA). */
const achatada = (over: any = {}) => ({
    tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado', competencia: '2026-07',
    numero: '63549', dataFatoGerador: '2026-07-06',
    prestadorCnpj: '60.532.082/0001-47', prestadorNome: 'CLINIPAR SERVICOS MEDICOS LTDA',
    tomadorCnpj: '51.227.692/0001-46',
    valorServicos: 590.10, valorPis: 3.84, valorCofins: 17.70, valorCsll: 27.44, valorIr: 0,
    codigoServico: '4030', discriminacaoServicos: 'SERVICOS DE MEDICINA OCUPACIONAL',
    ...over,
});

/** A mesma nota vinda de XML importado (forma OBJETO). */
const objeto = (over: any = {}) => ({
    tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado', competencia: '2026-07',
    emitente: { cnpjCpf: '60532082000147', nome: 'CLINIPAR SERVICOS MEDICOS LTDA' },
    destinatario: { cnpjCpf: TOMADOR },
    valores: { valorServicos: 590.10, pis: 3.84, cofins: 17.70, csll: 5.90, ir: 0 },
    ...over,
});

describe('lê as DUAS formas do documento', () => {
    it('forma achatada do portal', () => {
        const n = normalizarNotaTomada(achatada());
        expect(n.prestadorCnpj).toBe('60532082000147');
        expect(n.base).toBe(590.10);
        expect(n.pis).toBe(3.84);
    });

    it('forma objeto do XML', () => {
        const n = normalizarNotaTomada(objeto());
        expect(n.prestadorCnpj).toBe('60532082000147');
        expect(n.base).toBe(590.10);
        expect(n.csllOuTotal).toBe(5.90);
    });
});

describe('nome de campo não pode mentir', () => {
    it('o campo do portal viaja como `csllOuTotal`, nunca como `csll`', () => {
        // No export do portal ele é o TOTAL das três. Chamar de `csll` faria o
        // outro lado declarar o total como CSLL, e ninguém veria.
        const n = normalizarNotaTomada(achatada());
        expect(n.csllOuTotal).toBe(27.44);
        expect(n).not.toHaveProperty('csll');
    });

    it('o código de serviço viaja como MUNICIPAL, e itemLc116 vai nulo', () => {
        // 4030 é código da prefeitura de SP, não o item 4.02 da LC 116. A
        // tabela de natureza casa por LC 116 — fingir que é o mesmo enquadraria
        // errado.
        const n = normalizarNotaTomada(achatada());
        expect(n.codigoServicoMunicipal).toBe('4030');
        expect(n.itemLc116).toBeNull();
    });

    it('a discriminação viaja inteira — é dela que sai a natureza', () => {
        const n = normalizarNotaTomada(achatada({
            discriminacaoServicos: 'MANUTENCAO|15044 - REMUNERACAO DE SERVICOS DE CONSERVACAO',
        }));
        expect(n.discriminacao).toMatch(/15044/);
    });
});

describe('o que entra e o que fica de fora', () => {
    const payload = (docs: any[]) => montarPayloadReinfPJ({
        cnpjTomador: TOMADOR, competencia: '2026-07', documentos: docs,
    });

    it('nota tomada com retenção entra', () => {
        expect(payload([achatada()]).resumo.notas).toBe(1);
    });

    it('nota SEM retenção não entra, mas é CONTADA', () => {
        const p = payload([achatada({ valorPis: 0, valorCofins: 0, valorCsll: 0, valorIr: 0 })]);
        expect(p.resumo.notas).toBe(0);
        expect(p.resumo.semRetencao).toBe(1);
    });

    it('prestador PESSOA FÍSICA fica fora, mas NÃO some em silêncio', () => {
        // É R-4010, outro evento. Sumir da lista é o que faz alguém achar que
        // declarou tudo.
        const p = payload([achatada({ prestadorCnpj: '123.456.789-00' })]);
        expect(p.resumo.notas).toBe(0);
        expect(p.resumo.dePessoaFisica).toBe(1);
        expect(p.ressalvas.join(' ')).toMatch(/R-4010, outro evento/);
    });

    it('nota EMITIDA pelo cliente não entra — o R-4020 é de quem TOMA', () => {
        expect(payload([achatada({ direcao: 'saida' })]).resumo.notas).toBe(0);
    });

    it('cancelada não entra', () => {
        expect(payload([achatada({ status: 'cancelado' })]).resumo.notas).toBe(0);
    });

    it('nota de OUTRO tomador não entra', () => {
        expect(payload([achatada({ tomadorCnpj: '11.111.111/0001-91' })]).resumo.notas).toBe(0);
    });

    it('NFe (não é serviço) não entra', () => {
        expect(payload([achatada({ tipoDoc: 'NFe' })]).resumo.notas).toBe(0);
    });
});

describe('o payload carrega o diagnóstico da retenção', () => {
    it('a nota do portal vem marcada: a CSLL é o total', () => {
        const p = montarPayloadReinfPJ({ cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [achatada()] });
        expect(p.notas[0].coerencia.situacao).toBe('csll-e-o-total');
        expect(p.resumo.comIncoerencia).toBe(1);
    });

    it('a mesma nota com a CSLL verdadeira vem coerente', () => {
        const p = montarPayloadReinfPJ({ cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [objeto()] });
        expect(p.notas[0].coerencia.situacao).toBe('coerente');
        expect(p.resumo.comIncoerencia).toBe(0);
    });
});

describe('as ressalvas nunca somem', () => {
    it('sempre dizem que csllOuTotal pode ser o total, e que o código é municipal', () => {
        const p = montarPayloadReinfPJ({ cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [achatada()] });
        expect(p.ressalvas.join(' ')).toMatch(/CSLL individual NÃO vem/);
        expect(p.ressalvas.join(' ')).toMatch(/NÃO o item da LC 116/);
    });

    it('zero nota NÃO é sucesso — pode ser buraco de captura', () => {
        const p = montarPayloadReinfPJ({ cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [] });
        expect(p.resumo.notas).toBe(0);
        expect(p.ressalvas.join(' ')).toMatch(/problema é de CAPTURA/);
    });
});
