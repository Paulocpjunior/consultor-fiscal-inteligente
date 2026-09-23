// ============================================================================
// R-2010 — retenção previdenciária sobre serviços tomados.
//
// CALIBRADO CONTRA UM EVENTO ACEITO. Paulo mandou em 12/08/2026 o `evtServTom`
// real de 06/2026 (contribuinte 32602701, prestador 03222111000130) COM o
// recibo da Receita ao lado (`cdRetorno 0 — SUCESSO`, `tpEv 2010`).
//
// Os números dele são o alvo destes testes:
//   vlrTotalBruto    5.755,54
//   vlrTotalBaseRet  4.604,43   ← NÃO é o bruto: houve dedução de INSUMOS
//   vlrTotalRetPrinc   506,49   ← 11% da base, não do bruto
//
// É essa diferença que este módulo existe para não deixar passar: declarar
// base = bruto seria declarar retenção sobre 25% a mais de base.
// ============================================================================
// O módulo ganhou `.d.ts` em 14/08, quando a tela do R-2010 passou a importá-lo
import { readFileSync } from 'fs';
import { join } from 'path';
import { conferirBaseRetencaoInss, montarPayloadR2010, normalizarServicoTomado, ALIQUOTA_ART31, ALIQUOTA_CPRB } from '../sefaz-backend/reinf-servicos-tomados.js';

const notaTomada = (over: any = {}) => ({
    tipoDoc: 'NFSe', direcao: 'entrada', status: 'autorizado',
    numero: '30349', serie: '0', competencia: '2026-06',
    dataFatoGerador: '2026-06-24',
    prestadorCnpj: '03222111000130', prestadorNome: 'LIMPEZA TOTAL LTDA',
    tomadorCnpj: '32602701000197',
    valorServicos: 5755.54,
    valores: { inss: 506.49 },
    ...over,
});

describe('a assinatura de alíquota decide a base — não o palpite', () => {
    test('11% cheios: a base É o bruto, e isso está PROVADO pela razão', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 110 });
        expect(c.situacao).toBe('base-e-o-bruto');
        expect(c.base).toBe(1000);
        expect(c.baseOrigem).toBe('bruto-sem-deducao');
        expect(c.indCPRB).toBe(0);
        expect(c.exigeAcao).toBe(false);
    });

    test('o caso REAL do evento aceito: 506,49 sobre 5.755,54 é 8,8% ⇒ houve dedução', () => {
        const c = conferirBaseRetencaoInss({ bruto: 5755.54, retido: 506.49 });
        expect(c.situacao).toBe('base-deduzida-nao-informada');
        expect(c.exigeAcao).toBe(true);
        expect(c.motivo).toMatch(/abaixo dos 11%/);
        expect(c.motivo).toMatch(/971/);
        // A base derivada CHEGA PERTO da real (4.604,43) mas não é ela — por
        // isso ela é marcada, nunca apresentada como a base.
        expect(c.base).toBeCloseTo(4604.45, 2);
        expect(c.baseOrigem).toBe('derivada-da-retencao');
        expect(c.acao).toMatch(/valor estimado não vai para declaração/);
    });

    test('3,5% é AMBÍGUO e o app NÃO escolhe — são indCPRB diferentes', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 35 });
        expect(c.situacao).toBe('aliquota-ambigua-cprb-ou-deducao');
        expect(c.indCPRB).toBeNull();
        expect(c.base).toBeNull();
        expect(c.motivo).toMatch(/DUAS leituras/);
        expect(c.acao).toMatch(/desoneração \(CPRB\)/);
    });

    test('alíquota que nenhuma regra explica vira pendência com a suspeita nomeada', () => {
        const c = conferirBaseRetencaoInss({ bruto: 1000, retido: 300 });
        expect(c.situacao).toBe('aliquota-fora-da-regua');
        expect(c.acao).toMatch(/outra natureza lançada no campo de INSS/);
    });

    test('sem bruto ou sem retenção não se estima nada', () => {
        expect(conferirBaseRetencaoInss({ bruto: 0, retido: 110 }).situacao).toBe('sem-dados');
        expect(conferirBaseRetencaoInss({ bruto: 1000 }).situacao).toBe('sem-dados');
        expect(conferirBaseRetencaoInss({}).acao).toMatch(/não se estima/);
    });

    test('a tolerância cobre o arredondamento por nota (4.604,43 × 11% = 506,4873)', () => {
        expect(conferirBaseRetencaoInss({ bruto: 4604.43, retido: 506.49 }).situacao).toBe('base-e-o-bruto');
        expect(ALIQUOTA_ART31).toBe(11);
        expect(ALIQUOTA_CPRB).toBe(3.5);
    });
});

describe('a nota chega nas DUAS formas do documento', () => {
    test('forma ACHATADA do portal de SP', () => {
        const n = normalizarServicoTomado(notaTomada({ valores: undefined, valorInss: 506.49 }));
        expect(n.inssRetido).toBe(506.49);
        expect(n.vlrBruto).toBe(5755.54);
        expect(n.prestadorCnpj).toBe('03222111000130');
    });

    test('forma ANINHADA do XML', () => {
        const n = normalizarServicoTomado({
            tipoDoc: 'NFSe', direcao: 'entrada',
            prestador: { cnpjCpf: '03222111000130', nome: 'LIMPEZA TOTAL LTDA' },
            tomador: { cnpjCpf: '32602701000197' },
            valores: { valorServicos: 5755.54, inss: 506.49 },
        });
        expect(n.prestadorCnpj).toBe('03222111000130');
        expect(n.prestadorNome).toBe('LIMPEZA TOTAL LTDA');
        expect(n.tomadorCnpj).toBe('32602701000197');
        expect(n.inssRetido).toBe(506.49);
    });

    test('nome de campo não finge conferência: é `inssRetido`, o que a NOTA diz', () => {
        const n = normalizarServicoTomado(notaTomada());
        expect(Object.keys(n)).toEqual(expect.arrayContaining(['inssRetido', 'vlrBruto', 'baseRetencao', 'baseOrigem']));
        expect(Object.keys(n)).not.toEqual(expect.arrayContaining(['vlrRetencao', 'vlrBaseRet']));
    });
});

describe('o que NÃO está no documento vai nulo e nomeado', () => {
    test('tpServico e indObra são nulos — nem o XML nem o portal os têm', () => {
        const n = normalizarServicoTomado(notaTomada());
        expect(n.tpServico).toBeNull();
        expect(n.indObra).toBeNull();
    });

    test('e a ressalva PROÍBE o default de indObra', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06', documentos: [notaTomada()],
        });
        expect(r.ressalvas[0]).toMatch(/tpServico/);
        expect(r.ressalvas[0]).toMatch(/indObra/);
        expect(r.ressalvas[0]).toMatch(/quase sempre é 0/);
    });
});

describe('o eixo é o PRESTADOR, como no evento aceito', () => {
    test('duas notas do mesmo prestador viram UM bloco com os totais somados', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ numero: '1', valorServicos: 1000, valores: { inss: 110 } }),
                notaTomada({ numero: '2', valorServicos: 2000, valores: { inss: 220 } }),
            ],
        });
        expect(r.prestadores).toHaveLength(1);
        const p = r.prestadores[0];
        expect(p.notas).toHaveLength(2);
        expect(p.vlrTotalBruto).toBe(3000);
        expect(p.vlrTotalRetPrinc).toBe(330);
        // As duas provaram a base pela alíquota, então o total sai.
        expect(p.vlrTotalBaseRet).toBe(3000);
        expect(p.nrInscEstab).toBe('32602701000197');
    });

    test('base não provada derruba o TOTAL da base para nulo, nunca para parcial', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ numero: '1', valorServicos: 1000, valores: { inss: 110 } }),
                notaTomada({ numero: '2', valorServicos: 5755.54, valores: { inss: 506.49 } }),
            ],
        });
        const p = r.prestadores[0];
        // Total parcial num campo chamado "vlrTotalBaseRet" seria lido como a
        // base inteira do prestador — e ninguém desconfiaria.
        expect(p.vlrTotalBaseRet).toBeNull();
        expect(p.baseCompleta).toBe(false);
        expect(r.resumo.semBaseProvada).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/BASE não está provada/);
        // Bruto e retenção continuam somando: esses SÃO conhecidos.
        expect(p.vlrTotalRetPrinc).toBe(616.49);
    });

    test('prestadores diferentes viram blocos diferentes, ordenados por nome', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ prestadorCnpj: '11222333000181', prestadorNome: 'ZELADORIA SA' }),
                notaTomada({ prestadorCnpj: '03222111000130', prestadorNome: 'ALFA SERVICOS' }),
            ],
        });
        expect(r.prestadores.map((p: any) => p.nome)).toEqual(['ALFA SERVICOS', 'ZELADORIA SA']);
    });
});

describe('o que fica de fora NÃO some em silêncio', () => {
    test('nota tomada sem INSS retido é contagem, não pendência — é a maioria', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [notaTomada(), notaTomada({ numero: '9', valores: { inss: 0 } })],
        });
        expect(r.resumo.semRetencaoPrevidenciaria).toBe(1);
        expect(r.prestadores).toHaveLength(1);
    });

    test('prestador PESSOA FÍSICA fica de fora — é eSocial, não R-2010', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [notaTomada({ prestadorCnpj: '11122233344' })],
        });
        expect(r.resumo.dePessoaFisica).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/eSocial/);
    });

    test('nota CANCELADA e nota de SAÍDA não entram', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [
                notaTomada({ status: 'cancelado' }),
                notaTomada({ direcao: 'saida' }),
            ],
        });
        expect(r.prestadores).toHaveLength(0);
    });

    // 📌 ASSERÇÃO TROCADA PELA INTENÇÃO (09/09): ela prendia o TEXTO
    // *"o problema é de CAPTURA"* — e essa frase afirmava a causa ERRADA.
    // Zero prestador tem DUAS causas com ações opostas: a nota não chegou
    // (captura) ou ela chegou sem o INSS retido, e aí o caminho é o ajuste
    // declarado, que agora existe. Mandar procurar só na captura é o achado 18.
    //
    // A INTENÇÃO que esta seção protege continua travada: zero NUNCA é sucesso,
    // e a frase diz o que fazer.
    test('zero prestador NÃO é sucesso — e as DUAS causas saem com a ação', () => {
        const r = montarPayloadR2010({ cnpjTomador: '32602701000197', competencia: '2026-06', documentos: [] });
        const txt = r.ressalvas.join(' ');
        expect(txt).toMatch(/NENHUMA nota tomada com retenção previdenciária/);
        expect(txt).toMatch(/cessão de mão de obra/);
        expect(txt).toMatch(/CAPTURA/);
        expect(txt).toMatch(/ajuste declarado/);
    });

    // ═══ O AJUSTE DECLARADO — 09/09, Paulo: "corrige o r-2010 também" ═══════
    //
    // A lacuna estava NOMEADA desde 09/09: esta rota era a única das três que
    // não carregava `reinf_retencoes_ajustadas`, então INSS informado à mão não
    // chegava ao R-2010 e o evento saía com o ZERO do documento.
    describe('o INSS informado à mão vence o documento', () => {
        // A chave do ajuste é a da NOTA (`prestadorCnpj-numero` quando não há
        // chave), porque o ajuste é da NOTA — dois serviços do mesmo prestador
        // podem reter diferente.
        const CHAVE = '03222111000130-30349';

        test('o valor DECLARADO entra no evento, carimbado', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                // O documento chegou SEM retenção — é o caso que a declaração corrige.
                documentos: [notaTomada({ valores: {} })],
                ajustes: { [CHAVE]: { inss: 506.49, autor: 'sandra@exemplo', motivo: 'retenção informada na nota' } },
            });
            expect(r.prestadores).toHaveLength(1);
            const n = r.prestadores[0].notas[0];
            expect(n.inssRetido).toBe(506.49);
            expect(n.inssOrigem).toBe('ajuste-declarado');
            expect(n.ajuste.autor).toBe('sandra@exemplo');
            expect(r.resumo.comAjuste).toBe(1);
            expect(r.resumo.vlrTotalRetPrinc).toBe(506.49);
        });

        test('a declaração vence o documento quando os dois existem', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada({ valores: { inss: 100 } })],
                ajustes: { [CHAVE]: { inss: 506.49, autor: 'sandra@exemplo', motivo: 'valor corrigido' } },
            });
            expect(r.prestadores[0].notas[0].inssRetido).toBe(506.49);
            expect(r.prestadores[0].notas[0].inssOrigem).toBe('ajuste-declarado');
        });

        test('sem ajuste, o documento continua mandando — nada regride', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada()],
                ajustes: {},
            });
            expect(r.prestadores[0].notas[0].inssRetido).toBe(506.49);
            expect(r.prestadores[0].notas[0].inssOrigem).toBe('documento');
            expect(r.prestadores[0].notas[0].ajuste).toBeNull();
            expect(r.resumo.comAjuste).toBe(0);
        });

        // ⚠️ "Conferi e não houve" é um FATO: zero declarado sai da lista, mas
        // CONTADO — sumir calado é o que faz alguém achar que declarou tudo.
        test('ajuste ZERO tira a nota do evento, contada', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada()],
                ajustes: { [CHAVE]: { inss: 0, autor: 'sandra@exemplo', motivo: 'conferi: não houve retenção' } },
            });
            expect(r.prestadores).toHaveLength(0);
            expect(r.resumo.semRetencaoPrevidenciaria).toBe(1);
        });

        // 🚨 O número que vem de DECLARAÇÃO HUMANA sai DITO na ressalva, com a
        // nota e quem declarou — quem conferir daqui a três meses precisa saber
        // que aquele número não saiu do documento.
        test('a ressalva NOMEIA a nota e quem declarou', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada({ valores: {} })],
                ajustes: { [CHAVE]: { inss: 506.49, autor: 'sandra@exemplo', motivo: 'retenção informada na nota' } },
            });
            const txt = r.ressalvas.join(' ');
            expect(txt).toMatch(/INFORMADO À MÃO/);
            expect(txt).toMatch(/30349/);
            expect(txt).toMatch(/sandra@exemplo/);
        });

        // ⚠️ O ajuste é lido ANTES da seleção: nota cujo documento não trouxe
        // INSS mas que alguém DECLAROU tem de entrar. Barrá-la antes deixaria o
        // ajuste gravado sem efeito — a retenção some.
        test('ajuste de nota SEM retenção no documento a traz de volta', () => {
            const semAjuste = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada({ valores: {} })],
            });
            expect(semAjuste.resumo.semRetencaoPrevidenciaria).toBe(1);
            expect(semAjuste.prestadores).toHaveLength(0);
        });
    });

    // 🚨 ESPÉCIE, CANCELAMENTO E DIREÇÃO VÊM DOS DONOS (09/09) — as três
    // leituras cruas que moravam aqui já custaram um caso cada nesta casa.
    describe('as leituras do documento vêm dos donos', () => {
        test('cancelamento por EVENTO tira a nota — o `status` continua autorizado', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada({
                    status: 'autorizado',
                    eventos: [{ tpEvento: '110111', cStat: '135' }],
                })],
            });
            expect(r.prestadores).toHaveLength(0);
        });

        test('o BRUTO da NFS-e importada de PDF é lido — ela grava `valores.servicos`', () => {
            const r = montarPayloadR2010({
                cnpjTomador: '32602701000197', competencia: '2026-06',
                documentos: [notaTomada({
                    valorServicos: undefined, valorTotal: undefined,
                    valores: { servicos: 5755.54, inss: 506.49 },
                })],
            });
            // O bruto FOI lido — antes ele vinha nulo e a nota caía em
            // "sem dados". 506,49 sobre 5.755,54 é 8,8%, então a base é a
            // derivada, como no evento aceito de referência.
            expect(r.prestadores[0].vlrTotalBruto).toBe(5755.54);
            expect(r.prestadores[0].notas[0].baseOrigem).toBe('derivada-da-retencao');
        });
    });

    test('a ambiguidade do CPRB sobe como ressalva de primeira classe', () => {
        const r = montarPayloadR2010({
            cnpjTomador: '32602701000197', competencia: '2026-06',
            documentos: [notaTomada({ valorServicos: 1000, valores: { inss: 35 } })],
        });
        expect(r.ressalvas.join(' ')).toMatch(/DUAS leituras/);
        expect(r.ressalvas.join(' ')).toMatch(/indCPRB/);
        expect(r.resumo.comPendencia).toBe(1);
    });
});

// ═══ A LIGAÇÃO É TRAVADA POR VARREDURA ══════════════════════════════════════
//
// Régua que só escreve não é entrega (04/09), e esta rota foi a última das três
// a ligar: em 09/09 a lacuna ficou NOMEADA no CLAUDE.md (*"a rota
// /servicos-tomados NÃO carrega os ajustes"*), e o efeito era o INSS informado
// à mão ficar gravado enquanto o R-2010 saía com o zero do documento.
describe('a rota passa os ajustes à montagem', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend', 'reinf-retencoes-pj-routes.js'), 'utf8');

    it('lê os ajustes ANTES de montar e os entrega ao montarPayloadR2010', () => {
        const bloco = rota.slice(rota.indexOf("router.get('/servicos-tomados'"));
        const chamada = bloco.match(/montarPayloadR2010\(\{([^}]*)\}/);
        expect(chamada).toBeTruthy();
        expect(chamada![1]).toMatch(/ajustes/);
        expect(bloco.slice(0, bloco.indexOf('montarPayloadR2010('))).toMatch(/lerAjustesDeRetencao\(db, cnpj, competencia\)/);
    });

    // ⚠️ E as TRÊS rotas do Reinf que consomem nota lêem o MESMO dono: uma que
    // ficasse para trás voltaria a declarar o número do documento em silêncio.
    it('as três rotas do Reinf carregam os ajustes', () => {
        for (const r of ['/retencoes-pj', '/servicos-tomados', '/servicos-prestados']) {
            const i = rota.indexOf(`router.get('${r}'`);
            expect(i).toBeGreaterThan(-1);
            const bloco = rota.slice(i, i + 4000);
            expect(bloco).toMatch(/lerAjustesDeRetencao\(db, cnpj, competencia\)/);
        }
    });
});
