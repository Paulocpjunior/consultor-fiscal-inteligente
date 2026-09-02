/**
 * Extrato de entregas da EFD-Reinf — o que fecha a competência.
 *
 * Paulo, 13/08: e-mail com "somente o que foi enviado e seu status", disparado
 * no fechamento do R-2099, SharePoint na pasta do cliente.
 *
 * A trava que manda: TRANSMITIDO ≠ ENTREGUE. Protocolo prova que a Receita
 * RECEBEU o lote; recibo prova que ela PROCESSOU o evento. Entre um e outro
 * cabe uma recusa.
 */
import {
    situacaoDaEntrega, montarExtratoEntregas, montarEmailFechamento,
    nomeArquivoExtrato, competenciaHumana, codigoDoEvento, CODIGO_DO_EVENTO,
} from '../sefaz-backend/reinf-recibo-entrega.js';
import { conferirTotalizadorR2099 } from '../sefaz-backend/reinf-aquisicao-rural.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const EMPRESA = { nome: 'VINCENZO GUERRA', cnpj: '63027940000194' };
const entregue = (over: any = {}) => ({
    evento: 'ID1630279400001942026070811123300001', tipo: 'R-2055',
    recibo: '11774083-10-2055-2607-11774082', protocolo: '2.202608.33245995',
    transmitidoEm: '13/08/2026 10:41', ...over,
});

// Conferência real do R-2099 da VINCENZO 07/2026.
const CONFERE = {
    situacao: 'confere',
    linhas: [
        { componente: 'inss', apurado: 249.48 },
        { componente: 'gilrat', apurado: 20.79 },
        { componente: 'senar', apurado: 37.80 },
    ],
    resumo: '✓ O totalizador do R-2099 bate com a apuração da aba 🌾 nos três componentes (total R$ 308,07).',
};

describe('situação de uma entrega', () => {
    it('com recibo é ENTREGUE', () => {
        expect(situacaoDaEntrega(entregue()).situacao).toBe('entregue');
    });

    it('SEM recibo não é entregue, mesmo com protocolo do lote', () => {
        const s = situacaoDaEntrega(entregue({ recibo: null }));
        expect(s.situacao).toBe('sem-recibo');
        expect(s.detalhe).toMatch(/Recebido não é processado/);
    });

    it('sem protocolo E sem recibo diz que não há prova nenhuma', () => {
        const s = situacaoDaEntrega({ evento: 'x' });
        expect(s.situacao).toBe('sem-recibo');
        expect(s.detalhe).toMatch(/não há prova/);
    });

    it('ocorrência VENCE o recibo — evento recusado não entrou', () => {
        const s = situacaoDaEntrega(entregue({ ocorrencias: [{ codigo: 'MS0030', descricao: 'ideProdutor' }] }));
        expect(s.situacao).toBe('recusado');
        expect(s.detalhe).toMatch(/MS0030/);
    });
});

describe('farol da competência', () => {
    it('tudo entregue + totalizador batendo = fechado', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue()], conferencia: CONFERE,
        });
        expect(e.farol.cor).toBe('ok');
        expect(e.resumo).toEqual({ total: 1, entregues: 1, recusados: 0, semRecibo: 0 });
        expect(e.competenciaHumana).toBe('07/2026');
    });

    it('evento sem recibo derruba o farol — some é o que faz achar que fechou', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue(), entregue({ evento: 'B', recibo: null })],
            conferencia: CONFERE,
        });
        expect(e.farol.cor).toBe('falha');
        expect(e.farol.resumo).toMatch(/Transmitido não é entregue/);
        expect(e.resumo.semRecibo).toBe(1);
        // E ele CONTINUA na lista, nomeado.
        expect(e.linhas.map((l: any) => l.evento)).toContain('B');
    });

    it('recusado é falha e vence o resto', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue({ ocorrencias: [{ codigo: 'MS0030' }] })],
            conferencia: CONFERE,
        });
        expect(e.farol.cor).toBe('falha');
        expect(e.farol.resumo).toMatch(/RECUSADO/);
    });

    it('totalizador divergente NÃO fecha, mesmo com tudo entregue', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA, entregas: [entregue()],
            conferencia: { situacao: 'divergente', linhas: [], resumo: 'INSS: app 249,48 × Receita 200,00.' },
        });
        expect(e.farol.cor).toBe('falha');
        expect(e.farol.resumo).toMatch(/contra o totalizador que a guia é paga/);
    });

    it('sem totalizador fica ÂMBAR — entregue não é o mesmo que conferido', () => {
        const e = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA, entregas: [entregue()],
            conferencia: { situacao: 'nao-conferido', linhas: [], resumo: '' },
        });
        expect(e.farol.cor).toBe('atencao');
        expect(e.farol.resumo).toMatch(/não dá para afirmar que a Receita entendeu/);
    });

    it('ZERO evento não é sucesso — manda olhar apuração e captura', () => {
        const e = montarExtratoEntregas({ competencia: '2026-07', empresa: EMPRESA, entregas: [] });
        expect(e.farol.cor).toBe('atencao');
        expect(e.farol.resumo).toMatch(/falha de apuração ou de captura/);
        // A frase NEGA a leitura confortável: "não é ausência de obrigação".
        expect(e.farol.resumo).toMatch(/não é ausência de obrigação/);
    });
});

describe('e-mail do fechamento', () => {
    const extrato = montarExtratoEntregas({
        competencia: '2026-07', empresa: EMPRESA,
        entregas: [entregue()], conferencia: CONFERE,
        fechamento: { recibo: '11774083-10-2099-2607-11774083', processadoEm: '13/08/2026 10:47:37' },
    });

    it('o ASSUNTO carrega o farol — 30 e-mails iguais no mês ninguém tria', () => {
        const { assunto } = montarEmailFechamento(extrato);
        expect(assunto).toMatch(/^✅/);
        expect(assunto).toContain('EFD-Reinf 07/2026');
        expect(assunto).toContain('VINCENZO GUERRA');
    });

    it('o corpo traz o recibo do R-2099 e a situação de cada evento', () => {
        const { corpo } = montarEmailFechamento(extrato);
        expect(corpo).toContain('11774083-10-2099-2607-11774083');
        expect(corpo).toMatch(/✓ ID1630279400001942026070811123300001 \(R-2055\)/);
        expect(corpo).toContain('11774083-10-2055-2607-11774082');
        expect(corpo).toMatch(/308,07/);
    });

    it('NÃO leva o conteúdo do evento — é declaração do cliente', () => {
        const { corpo } = montarEmailFechamento(extrato);
        expect(corpo).toMatch(/conteúdo dos eventos não é enviado/);
    });

    it('farol vermelho aparece no assunto, para triagem', () => {
        const ruim = montarExtratoEntregas({
            competencia: '2026-07', empresa: EMPRESA,
            entregas: [entregue({ recibo: null })],
        });
        expect(montarEmailFechamento(ruim).assunto).toMatch(/^🔴/);
    });
});

describe('arquivo no SharePoint', () => {
    it('um por empresa × competência — refechar SOBRESCREVE', () => {
        const e = montarExtratoEntregas({ competencia: '2026-07', empresa: EMPRESA, entregas: [entregue()] });
        expect(nomeArquivoExtrato(e)).toBe('reinf-entregas-63027940000194-202607.pdf');
    });
});

describe('competenciaHumana', () => {
    it('AAAA-MM vira MM/AAAA (é como o e-CAC mostra)', () => {
        expect(competenciaHumana('2026-07')).toBe('07/2026');
        expect(competenciaHumana('')).toBe('—');
    });
});

/**
 * A ROTA — o que ela promete tem que existir, e na ORDEM certa.
 *
 * Rito das guias (#293) aplicado ao fechamento: arquiva, depois avisa. Avisar
 * antes de arquivar produziria "extrato enviado" com o arquivo em lugar nenhum
 * — e é justamente o e-mail que faz a pessoa parar de procurar.
 */
describe('rota do fechamento da competência', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/reinf-retencoes-pj-routes.js'), 'utf8');

    it('existe e é admin — fechamento não é leitura', () => {
        expect(rota).toMatch(/router\.post\('\/fechamento-competencia', requireAdmin/);
    });

    it('o APURADO sai da régua da casa, nunca do corpo da requisição', () => {
        // montarDipamCompetencia é a MESMA função da aba 🌾. Aceitar o apurado
        // por parâmetro criaria dois números pro mesmo fato.
        const posPainel = rota.indexOf('const painel = montarDipamCompetencia({\n            documentos, competencia');
        const posConferencia = rota.indexOf('conferirTotalizadorR2099({');
        expect(posPainel).toBeGreaterThan(-1);
        expect(posConferencia).toBeGreaterThan(posPainel);
        expect(rota).toMatch(/apurado: painel\.funrural/);
        expect(rota).not.toMatch(/apurado: req\.body/);
    });

    it('ARQUIVA antes de AVISAR', () => {
        const posUpload = rota.indexOf('await uploadRecibo(');
        const posEmail = rota.indexOf('await enviarEmail({');
        expect(posUpload).toBeGreaterThan(-1);
        expect(posEmail).toBeGreaterThan(posUpload);
    });

    it('remetente é a caixa de quem clicou e o gestor vai em CÓPIA OCULTA', () => {
        expect(rota).toMatch(/escolherRemetente\(\{/);
        expect(rota).toMatch(/bcc: \[GESTOR_EMAIL\]/);
        // O cliente NÃO entra: é comunicação interna.
        expect(rota).toMatch(/para: \[escolha\.remetente\]/);
    });

    it('falha de e-mail não apaga o arquivamento — cada etapa tem seu status', () => {
        expect(rota).toMatch(/resultado\.email = \{ status: 'erro'/);
        expect(rota).toMatch(/resultado\.sharePoint = \{ status: 'erro'/);
    });

    it('a auditoria guarda recibos e situação, NUNCA o conteúdo dos eventos', () => {
        expect(rota).toMatch(/collection\('reinf_fechamentos'\)/);
        expect(rota).toMatch(/recibos: extrato\.linhas\.map/);
        expect(rota).not.toMatch(/reinf_fechamentos[\s\S]{0,600}eventoXml|conteudo:/);
    });

    // 🚨 FIXTURE TROCADA EM 02/09: ela exigia o TEXTO `DEPARTAMENTO FISCAL…
    // RECIBOS` dentro da rota — ou seja, exigia que a rota montasse o caminho
    // à mão, que é justamente o defeito. A árvore medida não tem grupo, e o
    // caminho passou a ter DONO. Travar a forma antiga impediria a correção.
    it('RECIBOS é pasta irmã de IMPOSTOS — guia e prova de entrega não se misturam', () => {
        expect(rota).toMatch(/from '\.\/caminho-sharepoint\.js'/);
        expect(rota).toMatch(/caminhoRecibos\(\{ pastaEmpresa/);
    });

    // ⚠️ A pasta é ACHADA pelo Cod.Cliente e a frase da recusa vem do DONO:
    // uma cópia aqui divergiria da que o auto-sync mostra no MESMO caso, e o
    // colaborador leria duas instruções diferentes para o mesmo problema.
    it('a pasta da empresa vem do dono, não de um sharePointConfig do cadastro', () => {
        expect(rota).toMatch(/from '\.\/sharepoint-pastas\.js'/);
        expect(rota).toMatch(/resolverPastaDaEmpresa\(empresa\._doc\)/);
        // ⚠️ Lê CÓDIGO, nunca a prosa: o comentário que EXPLICA a correção cita
        // o campo morto, e a asserção sobre o arquivo inteiro reprovava a
        // própria correção (a mordida do ISS, 22/08).
        const codigo = rota.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(codigo).not.toMatch(/sharePointConfig/);
    });
});

/**
 * DE-PARA elemento → código do evento.
 *
 * O gateway guarda o ELEMENTO (`evtAqProd`); a pessoa, o e-CAC e o extrato
 * falam em CÓDIGO (`R-2055`). Sem este de-para o extrato diria "evtAqProd
 * entregue" para quem passou o mês procurando o R-2055 — e nomear errado num
 * papel que serve de prova é pior que não nomear.
 */
describe('de-para elemento → código do evento', () => {
    it('traduz os eventos que este projeto já transmitiu ou leu', () => {
        expect(codigoDoEvento('evtAqProd')).toBe('R-2055');   // aceito em produção restrita
        expect(codigoDoEvento('evtServTom')).toBe('R-2010');  // aceito, 06/2026
        expect(codigoDoEvento('evtRetPJ')).toBe('R-4020');
        expect(codigoDoEvento('evtRetPF')).toBe('R-4010');
        expect(codigoDoEvento('evtInfoContri')).toBe('R-1000');
    });

    it('elemento desconhecido vira NULL, nunca um palpite', () => {
        // Inventar um código faz alguém dar por entregue um evento que não é o
        // que ele pensa.
        expect(codigoDoEvento('evtQualquerCoisa')).toBeNull();
        expect(codigoDoEvento('')).toBeNull();
        expect(codigoDoEvento(undefined)).toBeNull();
    });

    it('os dois fechamentos apontam para o R-2099 (o leiaute tem dois nomes)', () => {
        expect(CODIGO_DO_EVENTO.evtFech).toBe('R-2099');
        expect(CODIGO_DO_EVENTO.evtFechaEvPer).toBe('R-2099');
    });
});

/**
 * A ROTA QUE PREPARA — o que o app já sabe não se redigita, e o que ele NÃO
 * sabe não se preenche por dedução.
 */
describe('rota que prepara o fechamento', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend/reinf-retencoes-pj-routes.js'), 'utf8');

    it('existe e é admin', () => {
        expect(rota).toMatch(/router\.get\('\/fechamento-competencia\/preparar', requireAdmin/);
    });

    it('a lista de eventos sai da auditoria do gateway, não da digitação', () => {
        expect(rota).toMatch(/collection\('reinf_gateway_lotes'\)/);
        // Lista digitada à mão ESQUECE evento — que é o jeito de dar o mês por
        // fechado com um R-2055 faltando.
        expect(rota).toMatch(/competencias/);
    });

    it('toda linha nasce SEM recibo — o gateway guarda protocolo, não recibo', () => {
        // Preencher recibo por dedução transformaria "transmitiu" em "entregou",
        // que é a única coisa que este extrato existe para não deixar acontecer.
        const bloco = rota.slice(rota.indexOf("router.get('/fechamento-competencia/preparar'"), rota.indexOf('POST /api/admin/reinf/fechamento-competencia'));
        expect(bloco).toMatch(/recibo: null/);
        expect(bloco).not.toMatch(/recibo: l\.|recibo: lote\./);
    });

    it('o apurado vem da régua da casa e os códigos de receita também', () => {
        const bloco = rota.slice(rota.indexOf("router.get('/fechamento-competencia/preparar'"), rota.indexOf('POST /api/admin/reinf/fechamento-competencia'));
        expect(bloco).toMatch(/montarDipamCompetencia\(\{/);
        expect(bloco).toMatch(/codigosFunrural: CODIGOS_RECEITA_FUNRURAL/);
    });

    it('lote com mais de um tipo de evento NÃO adivinha qual id é qual', () => {
        expect(rota).toMatch(/elementoIncerto/);
    });
});

/**
 * A TELA — porque rota sem botão não é funcionalidade, é código morto que dá a
 * impressão de entregue. Foi o que aconteceu com este rito: subiu no dia 13/08
 * e ficou sem caminho na interface.
 */
describe('a tela do fechamento existe e não tem régua própria', () => {
    const painel = readFileSync(join(__dirname, '..', 'components/EfdReinf/FechamentoReinfPanel.tsx'), 'utf8');
    const hub = readFileSync(join(__dirname, '..', 'components/DCTFWeb/DctfwebHub.tsx'), 'utf8');

    it('está montada no hub de DCTFWeb/Reinf', () => {
        expect(hub).toMatch(/FechamentoReinfPanel/);
        expect(hub).toMatch(/Fechamento EFD-Reinf/);
    });

    it('chama as DUAS pontas do rito', () => {
        expect(painel).toMatch(/prepararFechamentoReinf/);
        expect(painel).toMatch(/fecharCompetenciaReinf/);
    });

    it('NÃO escreve os códigos de receita — eles vêm do backend', () => {
        // Segunda cópia do de-para mandaria a contribuição para o código de
        // outro tributo, e o erro só apareceria na cobrança.
        expect(painel).not.toMatch(/1656-01|1646-03|1213-06/);
        expect(painel).toMatch(/codigosFunrural/);
    });

    it('valor em branco no totalizador NÃO vira zero', () => {
        // Ausente ≠ zero: linha sem número tem que acusar "a Receita não
        // totalizou este código", não "bateu em zero".
        expect(painel).toMatch(/String\(t\.valor\)\.trim\(\) !== ''/);
    });
});

// ============================================================================
// O CASO REAL — VINCENZO GUERRA 07/2026, fechado pelo Paulo em 13/08.
//
// *"VINCENZO FOI !!!!!"* — o rito rodou na tela pela primeira vez: R-2055
// transmitido, R-2099 fechado, totalizador conferido contra a apuração da aba
// 🌾, recibo arquivado e extrato enviado.
//
// ═══ POR QUE ESTE TESTE, SE OS DOIS NÚCLEOS JÁ TÊM OS SEUS ═════════════════
//
// Porque o que roda em produção é a COMPOSIÇÃO — `conferirTotalizadorR2099`
// alimentando `montarExtratoEntregas` —, e era só ela que ninguém testava: cada
// módulo passava fazendo exatamente o que o próprio teste mandava (a família de
// defeito do IPI no E200 e do Bloco H zerado). O que decide se alguém pode
// parar de olhar a competência é o FAROL, e o farol nasce da junção.
//
// Os números vêm do RECIBO, não de dedução: base 18.900,00 (LC 224/2025) ⇒
// INSS 1,32% = 249,48 · GILRAT 0,11% = 20,79 · SENAR 0,20% = 37,80 = 308,07,
// casando com 1656-01 / 1646-03 / 1213-06 do totalizador da Receita. As três
// alíquotas diferem entre si, então o casamento é ÚNICO.
// ============================================================================
describe('ponta a ponta: o caso que fechou (VINCENZO 07/2026)', () => {
    const APURADO = { base: 18900, inss: 249.48, gilrat: 20.79, senar: 37.80, total: 308.07 };
    const TOTALIZADOR = [
        { codigoReceita: '1656-01', valor: 249.48 },
        { codigoReceita: '1646-03', valor: 20.79 },
        { codigoReceita: '1213-06', valor: 37.80 },
    ];
    const R2055 = {
        evento: 'R-2055', tipo: 'ID1630279400001942026070811123300001',
        protocolo: '2.202608.33245995', recibo: '11774083-10-2055-2607-11774082',
    };
    const montar = (over: any = {}) => montarExtratoEntregas({
        competencia: '2026-07',
        empresa: EMPRESA,
        entregas: over.entregas || [R2055],
        conferencia: conferirTotalizadorR2099({
            apurado: APURADO,
            totalizador: 'totalizador' in over ? over.totalizador : TOTALIZADOR,
        }),
        fechamento: { recibo: '11774083-10-2099-2607-11774083', processadoEm: '2026-08-13' },
    });

    it('com tudo no lugar, o farol fecha VERDE', () => {
        const e = montar();
        expect(e.farol.cor).toBe('ok');
        expect(e.resumo).toMatchObject({ total: 1, entregues: 1, recusados: 0, semRecibo: 0 });
        expect(e.conferencia?.situacao).toBe('confere');
        expect(e.conferencia?.resumo).toContain('R$ 308,07');
    });

    it('e o de-para casa componente a componente com o recibo', () => {
        const linhas = montar().conferencia!.linhas;
        const por = Object.fromEntries(linhas.map((l: any) => [l.componente, l]));
        expect(por.inss).toMatchObject({ codigoReceita: '1656-01', apurado: 249.48, confere: true });
        expect(por.gilrat).toMatchObject({ codigoReceita: '1646-03', apurado: 20.79, confere: true });
        expect(por.senar).toMatchObject({ codigoReceita: '1213-06', apurado: 37.80, confere: true });
    });

    // ── AS TRÊS FORMAS DE NÃO SER VERDE ────────────────────────────────────
    // Verde é o estado que faz a pessoa PARAR DE OLHAR. Cada uma destas já
    // aconteceu de verdade em algum trilho deste projeto.

    it('totalizador batendo NÃO salva evento sem recibo (transmitido ≠ entregue)', () => {
        const e = montar({ entregas: [{ ...R2055, recibo: null }] });
        expect(e.farol.cor).toBe('falha');
        expect(e.resumo.semRecibo).toBe(1);
    });

    it('sem totalizador NÃO é verde, é âmbar — "MS7001" não é conferência', () => {
        const e = montar({ totalizador: [] });
        expect(e.farol.cor).toBe('atencao');
        expect(e.conferencia?.situacao).toBe('nao-conferido');
    });

    it('um centavo a menos derruba o verde E diz onde (a guia é paga pelo totalizador)', () => {
        const e = montar({ totalizador: [
            { codigoReceita: '1656-01', valor: 249.47 },
            { codigoReceita: '1646-03', valor: 20.79 },
            { codigoReceita: '1213-06', valor: 37.80 },
        ] });
        expect(e.farol.cor).toBe('falha');
        expect(e.conferencia?.resumo).toContain('1656-01');
        expect(e.conferencia?.linhas.find((l: any) => l.componente === 'inss')?.diferenca).toBeCloseTo(-0.01, 2);
    });

    it('evento RECUSADO vence tudo — protocolo não apaga ocorrência', () => {
        const e = montar({ entregas: [{ ...R2055, ocorrencias: [{ codigo: 'MS0030', descricao: 'ideProdutor' }] }] });
        expect(e.farol.cor).toBe('falha');
        expect(e.resumo.recusados).toBe(1);
    });

    it('o e-mail do fechamento leva o farol no assunto e o recibo do R-2099', () => {
        const { assunto, corpo } = montarEmailFechamento(montar());
        expect(assunto).toContain('✅');
        expect(assunto).toContain('07/2026');
        expect(corpo).toContain('11774083-10-2099-2607-11774083');
        // O conteúdo do evento é declaração do cliente — nunca viaja por e-mail.
        expect(corpo).toContain('conteúdo dos eventos não é enviado');
    });
});
