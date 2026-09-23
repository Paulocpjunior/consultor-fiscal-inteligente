// ============================================================================
// R-2020 — retenção previdenciária SOFRIDA em serviços PRESTADOS.
//
// CALIBRADO CONTRA UM EVENTO ACEITO. Paulo mandou em 08/09/2026 o `evtServPrest`
// real de 07/2026, transmitido pelo REINF.Web e aceito em produção:
//
//   ideEstabPrest > ideTomador (indObra 0)
//     vlrTotalBruto 9.105,95 · vlrTotalBaseRet 9.105,95 · vlrTotalRetPrinc 1.001,65
//     nfs: serie E · numDocto 572 · dtEmissaoNF 2026-07-23 · vlrBruto 9.105,95
//       infoTpServ: tpServico 100000003 · vlrBaseRet 9.105,95 · vlrRetencao 1.001,65
//
// 1.001,65 ÷ 9.105,95 = 11,0% ⇒ a base É o bruto, provada pela alíquota. É a
// MESMA régua do R-2010 (importada, nunca copiada) — e o eixo é o TOMADOR.
//
// ⚠️ Os CNPJs aqui são FICTÍCIOS: dado de cliente não entra no repositório.
// ============================================================================
import { montarPayloadR2020, normalizarServicoPrestado } from '../sefaz-backend/reinf-servicos-prestados.js';
import { conferirBaseRetencaoInss } from '../sefaz-backend/reinf-servicos-tomados.js';
import { readFileSync } from 'fs';
import { join } from 'path';

const PRESTADOR = '12345678000195'; // o cliente do escritório
const TOMADOR = '98765432000100';

const notaPrestada = (over: any = {}) => ({
    tipoDoc: 'NFSe', tipo: 'NFSe', direcao: 'saida', status: 'autorizado',
    numero: '572', serie: 'E', competencia: '2026-07',
    dataFatoGerador: '2026-07-23',
    prestadorCnpj: PRESTADOR, prestadorNome: 'CLIENTE PRESTADOR LTDA',
    tomadorCnpj: TOMADOR, tomadorNome: 'TOMADOR EXEMPLO SA',
    valorServicos: 9105.95,
    valores: { inss: 1001.65 },
    ...over,
});

describe('o caso REAL do evento aceito', () => {
    test('9.105,95 com 1.001,65 retido é 11% ⇒ a base É o bruto', () => {
        const c = conferirBaseRetencaoInss({ bruto: 9105.95, retido: 1001.65 });
        expect(c.situacao).toBe('base-e-o-bruto');
        expect(c.base).toBe(9105.95);
    });

    test('vira UM tomador com os totais que o evento aceito traz', () => {
        const r = montarPayloadR2020({ cnpjPrestador: PRESTADOR, competencia: '2026-07', documentos: [notaPrestada()] });
        expect(r.tomadores).toHaveLength(1);
        const t = r.tomadores[0];
        expect(t.cnpjTomador).toBe(TOMADOR);
        expect(t.nrInscEstabPrest).toBe(PRESTADOR);
        expect(t.vlrTotalBruto).toBe(9105.95);
        expect(t.vlrTotalBaseRet).toBe(9105.95);
        expect(t.vlrTotalRetPrinc).toBe(1001.65);
        expect(t.notas[0].serie).toBe('E');
        expect(t.notas[0].numero).toBe('572');
        expect(t.notas[0].dtEmissao).toBe('2026-07-23');
        expect(t.notas[0].inssOrigem).toBe('documento');
    });

    test('o R-2020 NÃO tem indCPRB — a nota não carrega o campo', () => {
        const n = normalizarServicoPrestado(notaPrestada());
        expect(Object.keys(n)).not.toContain('indCPRB');
        expect(n.tpServico).toBeNull();
        expect(n.indObra).toBeNull();
    });
});

describe('a nota chega nas formas do documento', () => {
    test('ACHATADA do portal de SP (valorInss na raiz, xNomeDest/cnpjDest)', () => {
        const n = normalizarServicoPrestado({
            valorServicos: 1000, valorInss: 110, cnpjEmit: PRESTADOR, cnpjDest: TOMADOR, xNomeDest: 'TOMADOR ACHATADO',
        });
        expect(n.inssRetido).toBe(110);
        expect(n.tomadorCnpj).toBe(TOMADOR);
        expect(n.tomadorNome).toBe('TOMADOR ACHATADO');
        expect(n.prestadorCnpj).toBe(PRESTADOR);
    });

    test('ANINHADA do XML', () => {
        const n = normalizarServicoPrestado({
            prestador: { cnpjCpf: PRESTADOR }, tomador: { cnpjCpf: TOMADOR, nome: 'TOMADOR XML' },
            valores: { valorServicos: 1000, inss: 110 },
        });
        expect(n.tomadorNome).toBe('TOMADOR XML');
        expect(n.baseOrigem).toBe('bruto-sem-deducao');
    });

    test('importada de PDF (valores.servicos / totais.vProd) — o bruto não sai 0,00', () => {
        const n = normalizarServicoPrestado({ valores: { servicos: 1000, inss: 110 }, totais: { vProd: 1000 } });
        expect(n.vlrBruto).toBe(1000);
    });

    test('INSS ausente é ausente, nunca zero', () => {
        const n = normalizarServicoPrestado({ valorServicos: 1000 });
        expect(n.inssRetido).toBeNull();
        expect(n.inssOrigem).toBeNull();
    });
});

describe('✍️ o ajuste declarado VENCE o documento — e sai carimbado', () => {
    // O caso FRONTINI (04/09): nota de SAÍDA capturada com retenção ZERO, e o
    // cliente informou depois. Sem este leitor o R-2020 sairia com o zero.
    const chave = `${PRESTADOR}-572`;
    const ajustes = { [chave]: { inss: 1001.65, autor: 'colaboradora@escritorio', motivo: 'cliente esqueceu de informar a retenção', em: '2026-09-08T10:00:00Z' } };

    test('nota SEM inss no documento entra pelo ajuste, com quem declarou', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [notaPrestada({ valores: undefined })],
            ajustes,
        });
        expect(r.tomadores).toHaveLength(1);
        const n = r.tomadores[0].notas[0];
        expect(n.inssRetido).toBe(1001.65);
        expect(n.inssOrigem).toBe('ajuste-declarado');
        expect(n.ajuste?.autor).toBe('colaboradora@escritorio');
        expect(r.resumo.comAjuste).toBe(1);
        expect(r.tomadores[0].comAjuste).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/INFORMADO À MÃO/);
        expect(r.ressalvas.join(' ')).toMatch(/nº 572 \(colaboradora@escritorio\)/);
    });

    test('ajuste vence mesmo quando o documento traz outro número', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [notaPrestada({ valores: { inss: 0 } })],
            ajustes,
        });
        expect(r.tomadores[0].notas[0].inssRetido).toBe(1001.65);
    });

    test('o ajuste casa pela CHAVE quando ela existe', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [notaPrestada({ chave: 'CHAVE-ABC', valores: undefined })],
            ajustes: { 'CHAVE-ABC': { inss: 50, autor: 'x' } },
        });
        expect(r.tomadores[0].notas[0].inssRetido).toBe(50);
    });

    test('ajuste declarando ZERO é "conferi e não houve" — a nota sai da lista, contada', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [notaPrestada()],
            ajustes: { [chave]: { inss: 0, autor: 'x' } },
        });
        expect(r.tomadores).toHaveLength(0);
        expect(r.resumo.semRetencaoPrevidenciaria).toBe(1);
    });
});

describe('o eixo é o TOMADOR, como no evento aceito', () => {
    test('duas notas do mesmo tomador viram UM bloco com os totais somados', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [
                notaPrestada({ numero: '1', valorServicos: 1000, valores: { inss: 110 } }),
                notaPrestada({ numero: '2', valorServicos: 2000, valores: { inss: 220 } }),
            ],
        });
        expect(r.tomadores).toHaveLength(1);
        expect(r.tomadores[0].notas).toHaveLength(2);
        expect(r.tomadores[0].vlrTotalBruto).toBe(3000);
        expect(r.tomadores[0].vlrTotalBaseRet).toBe(3000);
        expect(r.tomadores[0].vlrTotalRetPrinc).toBe(330);
    });

    test('base não provada derruba o TOTAL da base para nulo, nunca parcial', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [
                notaPrestada({ numero: '1', valorServicos: 1000, valores: { inss: 110 } }),
                notaPrestada({ numero: '2', valorServicos: 5755.54, valores: { inss: 506.49 } }),
            ],
        });
        expect(r.tomadores[0].vlrTotalBaseRet).toBeNull();
        expect(r.tomadores[0].baseCompleta).toBe(false);
        expect(r.resumo.semBaseProvada).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/BASE não está provada/);
    });

    test('tomadores diferentes viram blocos diferentes, ordenados por nome', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [
                notaPrestada({ tomadorCnpj: '11222333000181', tomadorNome: 'ZETA' }),
                notaPrestada({ tomadorNome: 'ALFA' }),
            ],
        });
        expect(r.tomadores.map((t: any) => t.nome)).toEqual(['ALFA', 'ZETA']);
    });
});

describe('o que fica de fora NÃO some em silêncio', () => {
    test('nota prestada sem INSS retido é contagem — é a maioria', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [notaPrestada(), notaPrestada({ numero: '9', valores: { inss: 0 } })],
        });
        expect(r.resumo.semRetencaoPrevidenciaria).toBe(1);
        expect(r.tomadores).toHaveLength(1);
    });

    test('tomador PESSOA FÍSICA e tomador ilegível ficam de fora, contados e ditos', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [
                notaPrestada({ tomadorCnpj: '11122233344' }),
                notaPrestada({ numero: '2', tomadorCnpj: '', tomador: undefined }),
            ],
        });
        expect(r.resumo.tomadorPessoaFisica).toBe(1);
        expect(r.resumo.semTomadorLegivel).toBe(1);
        expect(r.ressalvas.join(' ')).toMatch(/PESSOA FÍSICA/);
        expect(r.ressalvas.join(' ')).toMatch(/SEM CNPJ do tomador/);
    });

    test('nota CANCELADA (por status e por EVENTO), nota TOMADA e nota de OUTRA empresa não entram', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [
                notaPrestada({ status: 'cancelado' }),
                notaPrestada({ eventos: [{ tpEvento: '110111', cStat: '135' }] }),
                notaPrestada({ direcao: 'entrada' }),
                notaPrestada({ prestadorCnpj: '55666777000188' }),
            ],
        });
        expect(r.tomadores).toHaveLength(0);
    });

    test('NF-e de mercadoria não é serviço — fica fora', () => {
        const r = montarPayloadR2020({
            cnpjPrestador: PRESTADOR, competencia: '2026-07',
            documentos: [notaPrestada({ tipoDoc: 'NFe', tipo: 'NFe', modelo: '55' })],
        });
        expect(r.tomadores).toHaveLength(0);
    });

    test('zero tomador NÃO é sucesso — e a ação aponta o ajuste, não a captura', () => {
        const r = montarPayloadR2020({ cnpjPrestador: PRESTADOR, competencia: '2026-07', documentos: [] });
        expect(r.ressalvas.join(' ')).toMatch(/ajuste declarado/);
        expect(r.ressalvas.join(' ')).toMatch(/não é ausência de obrigação/);
    });

    test('as ressalvas fixas dizem que tpServico/indObra são por TOMADOR e que não há indCPRB', () => {
        const r = montarPayloadR2020({ cnpjPrestador: PRESTADOR, competencia: '2026-07', documentos: [notaPrestada()] });
        expect(r.ressalvas[0]).toMatch(/por TOMADOR/);
        expect(r.ressalvas[2]).toMatch(/NÃO tem `indCPRB`/);
        expect(r.ressalvas[2]).toMatch(/R-1000/);
    });
});

// ═══ A LIGAÇÃO É TRAVADA POR VARREDURA ══════════════════════════════════════
//
// Régua que só escreve não é entrega (04/09): o ajuste declarado existe desde
// 31/08 e a lição foi que EU criei o parâmetro e não liguei o consumidor. Aqui
// a rota tem de LER os ajustes e PASSÁ-LOS à montagem — senão o INSS informado
// à mão ficaria gravado e o R-2020 sairia com o zero do documento.
describe('a rota passa os ajustes à montagem', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend', 'reinf-retencoes-pj-routes.js'), 'utf8');

    it('lê os ajustes ANTES de montar e os entrega ao montarPayloadR2020', () => {
        const bloco = rota.slice(rota.indexOf("router.get('/servicos-prestados'"));
        const chamada = bloco.match(/montarPayloadR2020\(\{([^}]*)\}/);
        expect(chamada).toBeTruthy();
        expect(chamada![1]).toMatch(/ajustes/);
        expect(bloco.slice(0, bloco.indexOf('montarPayloadR2020('))).toMatch(/lerAjustesDeRetencao\(db, cnpj, competencia\)/);
    });
});
