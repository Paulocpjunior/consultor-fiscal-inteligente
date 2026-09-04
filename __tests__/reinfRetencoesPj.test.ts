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
import { readFileSync } from 'fs';
import { join } from 'path';
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
    prestador: { cnpjCpf: '60532082000147', nome: 'CLINIPAR SERVICOS MEDICOS LTDA' },
    tomador: { cnpjCpf: TOMADOR },
    valores: { valorServicos: 590.10, pis: 3.84, cofins: 17.70, csll: 5.90, ir: 0 },
    ...over,
});

describe('lê as DUAS formas do documento', () => {
    it('forma achatada do portal', () => {
        const n = normalizarNotaTomada(achatada());
        expect(n.prestadorCnpj).toBe('60532082000147');
        expect(n.prestadorNome).toBe('CLINIPAR SERVICOS MEDICOS LTDA');
        expect(n.base).toBe(590.10);
        expect(n.pis).toBe(3.84);
    });

    it('forma objeto do XML', () => {
        const n = normalizarNotaTomada(objeto());
        expect(n.prestadorCnpj).toBe('60532082000147');
        expect(n.prestadorNome).toBe('CLINIPAR SERVICOS MEDICOS LTDA');
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

    /**
     * Nota REAL (07/08): NFS-e 00375235, ELEVADORES ATLAS SCHINDLER →
     * CONDOMINIO EDIFICIO MONTE CARLO. PIS 56,32 (1,65%) e COFINS 259,41
     * (7,60%) são o tributo do PRESTADOR no não-cumulativo — a própria nota
     * avisa em "Outras Informações". A retenção é 158,72 (CSRF 4,65%).
     *
     * Mandados ao R-4020 como retidos, PIS+COFINS declarariam 315,73 no lugar
     * de 158,72 — quase o dobro.
     */
    const ATLAS = () => achatada({
        numero: '00375235',
        prestadorCnpj: '00.028.986/0001-08', prestadorNome: 'ELEVADORES ATLAS SCHINDLER LTDA',
        valorServicos: 3413.24, valorPis: 56.32, valorCofins: 259.41, valorCsll: 158.72, valorIr: 0,
        codigoServico: '07498',
    });

    it('a nota da ATLAS é marcada pela CAUSA, não como "alíquota fora"', () => {
        const p = montarPayloadReinfPJ({ cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [ATLAS()] });
        expect(p.notas[0].coerencia.situacao).toBe('campos-sao-totais-da-operacao');
        expect(p.resumo.camposDaOperacao).toBe(1);
        expect(p.ressalvas.join(' ')).toMatch(/tributo do PRESTADOR/);
        expect(p.ressalvas.join(' ')).toMatch(/CSRF de 4,65%/);
    });

    it('a ressalva genérica não conta duas vezes a mesma nota', () => {
        const p = montarPayloadReinfPJ({ cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [ATLAS()] });
        expect(p.resumo.comIncoerencia).toBe(1);
        expect(p.ressalvas.join(' ')).not.toMatch(/não bate com a alíquota legal/);
    });

    it('as DUAS doenças convivem, cada uma com o seu número', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: TOMADOR, competencia: '2026-07', documentos: [ATLAS(), achatada()],
        });
        expect(p.resumo.camposDaOperacao).toBe(1);
        expect(p.resumo.comIncoerencia).toBe(2);
        expect(p.ressalvas.join(' ')).toMatch(/tributo do PRESTADOR/);
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

// ============================================================================
// 🚨 A NOTA SEM RETENÇÃO SAI DO R-4020 — e NOMEADA (02/09, HS PROJETOS)
//
// Paulo: *"puxou uma nota que não tem retenção, mas foi informado errado, como
// não considerar ela?"*. A EMBRATOP ficava PENDENTE esperando um ajuste que não
// existe: o R-4020 declara RETENÇÃO, e naquela nota não houve nenhuma.
// ============================================================================
describe('🚫 nota que o documento declara sem retenção', () => {
    // Os números são os do PDF: base 140,00 · PIS 2,31 (1,65%) · COFINS 10,64
    // (7,60%) · contribuições retidas 0,00.
    const nota = (extra: any = {}) => ({
        tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado',
        numero: '22243',
        prestadorCnpj: '03497158000107', prestadorNome: 'EMBRATOP GEO TECNOLOGIAS LTDA',
        tomadorCnpj: '05147016000145',
        valores: { valorServicos: 140, pis: 2.31, cofins: 10.64, csll: 0 },
        ...extra,
    });

    it('não vira evento, e o beneficiário deixa de ficar pendente', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: '05147016000145', competencia: '2026-08', documentos: [nota()],
        });
        expect(p.notas).toHaveLength(0);
        expect(p.resumo.semRetencaoDeclarada).toBe(1);
        // ⚠️ Contado À PARTE de `semRetencao`: lá o documento não trouxe campo
        // nenhum; aqui ele trouxe e DECLAROU que não houve retenção.
        expect(p.resumo.semRetencao).toBe(0);
    });

    it('NÃO some calada — sai nomeada, com prestador e nota', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: '05147016000145', competencia: '2026-08', documentos: [nota()],
        });
        expect(p.resumo.forasSemRetencao[0]).toMatchObject({
            prestadorNome: 'EMBRATOP GEO TECNOLOGIAS LTDA', numero: '22243',
        });
        const texto = p.ressalvas.join(' | ');
        expect(texto).toMatch(/EMBRATOP GEO TECNOLOGIAS LTDA \(nota 22243\)/);
        expect(texto).toMatch(/Não Retidos/);
        expect(texto).toMatch(/Não há ajuste a fazer/);
    });

    // ⚠️ IRRF É OUTRA RETENÇÃO: havendo IR retido a nota FICA, mesmo com a CSRF
    // zerada — tirá-la deixaria de declarar o IR que houve.
    it('com IRRF retido a nota FICA', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: '05147016000145', competencia: '2026-08',
            documentos: [nota({ valores: { valorServicos: 140, pis: 2.31, cofins: 10.64, csll: 0, ir: 2.1 } })],
        });
        expect(p.notas).toHaveLength(1);
        expect(p.resumo.semRetencaoDeclarada).toBe(0);
    });

    // ⚠️ E O AJUSTE TRAZ A NOTA DE VOLTA: quem tem prova de que houve retenção
    // declara, e a declaração vence o documento.
    it('o ajuste declarado traz a nota de volta', () => {
        const doc = nota({ chave: 'CH-22243' });
        const p = montarPayloadReinfPJ({
            cnpjTomador: '05147016000145', competencia: '2026-08', documentos: [doc],
            ajustes: { 'CH-22243': { pis: 0.91, cofins: 4.2, csll: 1.4, autor: 'sandra', motivo: 'retencao conferida no banco' } },
        });
        expect(p.notas).toHaveLength(1);
        expect(p.resumo.semRetencaoDeclarada).toBe(0);
    });
});

/**
 * 🚨 O CT-e OS COM RETENÇÃO É BENEFICIÁRIO DO R-4020 — e a rota o descartava.
 *
 * O CASO (04/09, J.P. PISSATO LOTERIAS · 08/2026): o CT-e OS 114.924 da PROTEGE
 * foi lançado com o modelo CERTO (67) e a retenção que o papel declara — IRRF
 * de 1%, art. 55 da Lei 7.713/1988. Ele apareceu no Relatório de Retenções do
 * CFI, com IR 39,02… e o Consultor Contábil respondeu **"Nenhum beneficiário PJ
 * com retenção nesta competência"**.
 *
 * A causa era UMA linha: `if (!/NFSe/i.test(tipoDoc || tipo)) continue`. O CT-e
 * é `tipo: 'CTe'` e caía fora. Ou seja: em 04/09 de manhã eu corrigi o
 * RELATÓRIO e deixei a rota que alimenta o R-4020 com a régua antiga —
 * instância fechada, classe aberta.
 *
 * E o custo não era só a ausência: a tela do Contábil MANDAVA PROCURAR NO LUGAR
 * ERRADO — *"o problema é de CAPTURA no Consultor Fiscal"* — sobre um documento
 * capturado, com a retenção gravada, visível no relatório ao lado.
 *
 * Os números são os do DACTE-OS: prestação 3.901,37 e IRRF 39,02 (o emitente
 * arredondou para cima; 1% dá 39,01, e é o 39,02 que fecha o líquido 3.862,35).
 */
describe('🚚 CT-e OS com retenção entra no R-4020', () => {
    const PISSATO = '00593774000173';

    const cte = (over: any = {}) => ({
        tipo: 'CTe', tipoDoc: 'CTe', modelo: '67',
        direcao: 'entrada', status: 'autorizado', competencia: '2026-08',
        numero: '114924', dhEmi: '2026-08-31T10:00:00-03:00',
        cnpjEmit: '17.428.731/0001-50', xNomeEmit: 'PROTEGE PROTECAO E TRANSPORTE DE VALORES LTDA',
        cnpjDest: PISSATO, xNomeDest: 'J.P. PISSATO LOTERIAS LTDA',
        valorTotal: 3901.37,
        valorIr: 39.02,
        ...over,
    });

    it('o beneficiário aparece — era isto que o Contábil não via', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08', documentos: [cte()],
        });
        expect(p.notas).toHaveLength(1);
        expect(p.notas[0].prestadorNome).toMatch(/PROTEGE/);
        expect(p.notas[0].prestadorCnpj).toBe('17428731000150');
        expect(p.notas[0].numero).toBe('114924');
    });

    it('a base e o IR são os do documento — o app não recalcula o papel', () => {
        // 1% de 3.901,37 é 39,01 e o DACTE-OS diz 39,02. Recalcular declararia
        // um centavo A MENOS do que foi retido, e a Receita não devolve.
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08', documentos: [cte()],
        });
        expect(p.notas[0].base).toBe(3901.37);
        expect(p.notas[0].ir).toBe(39.02);
    });

    // ⚠️ FRETE SEM RETENÇÃO É O CASO NORMAL. Se ele entrasse, a contagem de
    // "sem retenção" encheria de documento CORRETO — o alarme que ensina a
    // equipe a ignorar a lista.
    it('CT-e SEM retenção não entra e NÃO vira contagem de "sem retenção"', () => {
        const semIr = cte();
        delete (semIr as any).valorIr;
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08', documentos: [semIr],
        });
        expect(p.notas).toHaveLength(0);
        expect(p.resumo.semRetencao).toBe(0);
    });

    // ⚠️ ZERO DIGITADO É RESPOSTA ("conferi e não houve"), e é diferente de
    // campo que nunca existiu. Ele entra na seleção e cai em `semRetencao`,
    // onde a pessoa o vê — não some.
    it('zero DIGITADO no CT-e é afirmação, e não some da conta', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08', documentos: [cte({ valorIr: 0 })],
        });
        expect(p.notas).toHaveLength(0);
        expect(p.resumo.semRetencao).toBe(1);
    });

    // ⚠️ O AJUSTE TRAZ A NOTA DE VOLTA, aqui igual ao resto: por isso a espécie
    // decide DEPOIS de o ajuste ser lido — barrá-la antes deixaria o ajuste
    // gravado sem efeito, que é a "flag que ninguém lê" na pior forma.
    it('CT-e sem retenção no documento volta pelo ajuste declarado', () => {
        const semIr = cte({ chave: 'CTE-114924' });
        delete (semIr as any).valorIr;
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08', documentos: [semIr],
            ajustes: {
                'CTE-114924': {
                    ir: 39.02, autor: 'priscila.lopes',
                    motivo: 'IRRF art 55 declarado no DACTE-OS',
                },
            },
        });
        expect(p.notas).toHaveLength(1);
        expect(p.notas[0].retencao.ir).toBe(39.02);
    });

    it('NF-e de MERCADORIA continua de fora — ela não carrega retenção federal', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08',
            documentos: [{ ...cte(), tipo: 'NFe', tipoDoc: 'NFe', modelo: '55' }],
        });
        expect(p.notas).toHaveLength(0);
    });

    // NADA REGRIDE: a NFS-e sem retenção continua contada, porque lá a ausência
    // é suspeita de captura incompleta — não é o caso normal.
    it('NFS-e sem retenção segue caindo em "sem retenção"', () => {
        const p = montarPayloadReinfPJ({
            cnpjTomador: PISSATO, competencia: '2026-08',
            documentos: [{
                tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado',
                competencia: '2026-08', numero: '10',
                prestadorCnpj: '17428731000150', prestadorNome: 'X LTDA',
                tomadorCnpj: PISSATO, valorServicos: 100,
            }],
        });
        expect(p.notas).toHaveLength(0);
        expect(p.resumo.semRetencao).toBe(1);
    });
});

/**
 * 🔒 A CLASSE, não a instância.
 *
 * Corrigir a linha fecha o caso da J.P. PISSATO; o que impede a próxima é a
 * régua da espécie ter UM dono. Ela já nasceu duplicada — o relatório aceitava
 * o CT-e e esta rota continuava com `/NFSe/i`, e as duas telas contaram
 * histórias diferentes sobre o MESMO documento no mesmo dia.
 *
 * A varredura lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS, 22/08):
 * os comentários deste módulo citam `NFSe` justamente para contar o defeito.
 */
describe('🔒 a espécie de documento tem UM dono', () => {
    const semComentarios = (src: string) => src
        .split('\n')
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n');

    const rota = semComentarios(
        readFileSync(join(__dirname, '..', 'sefaz-backend/reinf-retencoes-pj.js'), 'utf8'));
    const relatorio = semComentarios(
        readFileSync(join(__dirname, '..', 'services/relatoriosAgregacoes.ts'), 'utf8'));

    it('a rota do R-4020 não decide a espécie com regex de `tipo`', () => {
        // Era exatamente isto: `if (!/NFSe/i.test(texto(d?.tipoDoc || d?.tipo)))`.
        expect(rota).not.toMatch(/\/NFSe\/i\s*\.test/);
    });

    it('a rota delega ao dono', () => {
        expect(rota).toMatch(/documentoEntraEmRetencoes\(d,\s*\{\s*temAjuste/);
    });

    it('o relatório NÃO reimplementa a união das duas espécies', () => {
        // A cópia era `ehNotaDeServico(d) || (ehConhecimentoDeTransporte(d) && …)`.
        expect(relatorio).not.toMatch(/ehConhecimentoDeTransporte/);
        expect(relatorio).toMatch(/documentoEntraEmRetencoes/);
    });
});
