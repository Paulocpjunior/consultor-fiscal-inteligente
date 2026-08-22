// ============================================================================
// 🚨 A CONFERÊNCIA CFI × SPED ACUSAVA "NÃO ESCRITURADA" EM TODA NOTA CANCELADA
// POR EVENTO — sobre um arquivo CERTO
//
// O DESENHO já estava certo, e escrito no cabeçalho do próprio módulo desde
// sempre: *"só cruza NF-e capturadas com status='autorizado' (canceladas,
// denegadas, inutilizadas não devem estar no SPED — incluir geraria
// falso-positivo)"*. A **LEITURA** é que era cega: o cancelamento por EVENTO
// não muda o `status` (régua de 11/08, MV LIDER 639), então a cancelada
// passava pelo filtro.
//
// 🔴 E o falso-positivo que o cabeçalho previa acontecia do jeito mais
// alarmante possível. O C100 de uma cancelada sai com **COD_SIT 02**, que não
// está em `COD_SIT_EFETIVO` — logo ela nem entra no índice do SPED, e a nota
// capturada virava **`NAO_ESCRITURADA`, severidade ERRO**: *"capturada
// (autorizada) e NÃO encontrada na escrituração do SPED Fiscal"*. É a mensagem
// mais grave da tela, disparando justamente quando os dois lados estão certos
// — o jeito mais rápido de ensinar a equipe a ignorar a conferência que existe
// para pegar a omissão de verdade.
//
// ✂️ Quem responde agora é `docCancelado`, que enxerga o evento. E o descarte
// é **CONTADO À PARTE e DITO na tela** (`canceladasNaoConferidas`): "não
// conferi porque foi cancelada" e "não conferi porque o documento está torto"
// pedem ações opostas, e um número só faria as duas parecerem a mesma coisa.
// Ausência de alarme não pode ser indistinguível de "os números batem".
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { cruzarSpedComCapturadas } from '../sefaz-backend/sped-cruzamento-xml-capturados.js';

const CHAVE_OK = '35260731947349000169550010000034853106861510';
const CHAVE_CANC = '35260731947349000169550010000034863106861511';
const CNPJ_EMPRESA = '31947349000169';

/** SPED Fiscal parseado, no shape que o cruzamento lê (`linhas` + `campos`). */
const spedCom = (linhas: string[][]) => ({
    tipoSped: 'fiscal',
    linhas: linhas.map((campos, i) => ({ tipo: campos[0], campos, idx: i })),
});

// C100 regular e C100 de CANCELADA. Na cancelada tudo depois do CHV_NFE sai
// VAZIO e o COD_SIT é 02 — Guia 3.2.3, C100, Exceção 1.
const C100_REGULAR = ['C100', '0', '1', 'PART1', '55', '00', '1', '3485', CHAVE_OK, '10072026', '10072026', '1000,00'];
const C100_CANCELADA = ['C100', '0', '1', '', '55', '02', '1', '3486', CHAVE_CANC, '', '', ''];

const capturada = (over: any = {}) => ({
    chave: CHAVE_OK, numero: '3485', direcao: 'saida', status: 'autorizado',
    valorTotal: 1000, ...over,
});

/** Cancelada pelo EVENTO 110111 — o `status` continua 'autorizado'. */
const canceladaPorEvento = capturada({
    chave: CHAVE_CANC, numero: '3486', valorTotal: 2000,
    status: 'autorizado',
    eventos: [{ tpEvento: '110111', cStat: '135' }],
});

const tipos = (r: any) => (r.achados || []).map((a: any) => a.tipo);

describe('🚨 a cancelada por EVENTO não vira "NÃO escriturada"', () => {
    const r = cruzarSpedComCapturadas(
        spedCom([C100_REGULAR, C100_CANCELADA]),
        [capturada(), canceladaPorEvento],
    );

    it('nenhum achado — os dois lados estão certos', () => {
        expect(tipos(r)).toEqual([]);
        expect(r.resumo.naoEscrituradas).toBe(0);
        expect(r.resumo.divergenciasValor).toBe(0);
    });

    // 🚨 A OUTRA METADE: sair calada seria trocar um alarme falso por um
    // silêncio falso.
    it('o descarte é CONTADO à parte, com causa própria', () => {
        expect(r.resumo.canceladasNaoConferidas).toBe(1);
        // Não se mistura com o descarte por documento torto (sem chave etc.).
        expect(r.resumo.descartadasCapturadas).toBe(0);
    });

    it('e a nota regular segue conferida normalmente', () => {
        expect(r.resumo.emAmbos).toBe(1);
        expect(r.resumo.totalCapturadas).toBe(1);
    });
});

describe('🚨 a régua não pode calar o achado de verdade', () => {
    it('valor divergente numa nota REGULAR continua acusando', () => {
        const r = cruzarSpedComCapturadas(spedCom([C100_REGULAR]), [capturada({ valorTotal: 900 })]);
        expect(r.resumo.divergenciasValor).toBe(1);
        expect(tipos(r)).toEqual(['DIVERGENCIA_VALOR']);
    });

    it('e a nota capturada que o SPED não tem continua sendo ERRO', () => {
        const r = cruzarSpedComCapturadas(spedCom([]), [capturada()]);
        expect(tipos(r)).toEqual(['NAO_ESCRITURADA']);
        expect(r.achados[0].severidade).toBe('erro');
    });

    // Denegada/inutilizada continuam no descarte de sempre — mas elas TAMBÉM
    // passam por `docCancelado` (ele trata as três como "não conta no livro"),
    // então caem no contador da causa que a tela nomeia.
    it('denegada sai da conferência, contada', () => {
        const r = cruzarSpedComCapturadas(spedCom([C100_REGULAR]), [capturada({ status: 'denegado' })]);
        expect(r.resumo.totalCapturadas).toBe(0);
        expect(r.resumo.canceladasNaoConferidas).toBe(1);
    });

    it('documento sem chave legível segue no descarte por documento torto', () => {
        const r = cruzarSpedComCapturadas(spedCom([]), [capturada({ chave: '123' })]);
        expect(r.resumo.descartadasCapturadas).toBe(1);
        expect(r.resumo.canceladasNaoConferidas).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 E A DIREÇÃO DO ACHADO SAI PELA RÉGUA — ele é lido LADO A LADO com o
// registro do SPED, e o SPED declara a compra de produtor rural (art. 136)
// como ENTRADA. Dizer "saída" aqui faria a conferência discordar do arquivo
// que ela confere.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 a direção do achado concorda com o arquivo conferido', () => {
    it('a compra de produtor (tpNF=0) sai como ENTRADA', () => {
        const r = cruzarSpedComCapturadas(spedCom([]), [capturada({
            direcao: 'saida', tpNF: '0',
            cnpjEmit: CNPJ_EMPRESA, empresaCnpj: CNPJ_EMPRESA,
        })]);
        expect(r.achados[0].direcao).toBe('entrada');
    });

    it('e a venda normal continua saída — a régua não inverte o caso comum', () => {
        const r = cruzarSpedComCapturadas(spedCom([]), [capturada({ tpNF: '1' })]);
        expect(r.achados[0].direcao).toBe('saida');
    });
});
