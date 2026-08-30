// ============================================================================
// 🏭 BLOCO K — CONTROLE DA PRODUÇÃO E DO ESTOQUE
//
// 29/08, Paulo: *"pode fazer o bloco k"* — o último 🔴 do de-para.
//
// 🚨 A TRAVA QUE DECIDE O MÓDULO é a lição do BLOCO H (06/08): quantidade que
// ninguém informou NUNCA vira zero. Bloco vazio diz *"não declarei"*; bloco
// zerado diz *"declarei que não tenho estoque"* — e a segunda é uma AFIRMAÇÃO
// falsa ao fisco, que o PVA aceita sem reclamar.
//
// O Guia Prático 3.2.3 é a fonte de cada leiaute conferido aqui.
// ============================================================================
import {
    LEIAUTES_BLOCO_K, IND_EST_VALIDOS, TIPOS_ITEM_ESTOQUE,
    quantidadeInformada, exigenciaBlocoK, exigeInsumos, exigeProducao,
    planejarBlocoK, montarBlocoK,
    OBRIGATORIEDADE_POR_LEIAUTE, REGISTROS_GERADOS, registrosExigidosQueFaltam,
} from '../sefaz-backend/sped-bloco-k.js';

const DT_INI = '01072026';
const DT_FIN = '31072026';

const estoque = (over = {}) => ({ codItem: 'P1', qtd: 10, indEst: '0', codPart: '', ...over });
const apontamento = (over = {}) => ({
    dtIniOp: '01072026', dtFinOp: '05072026', codDocOp: 'OP-1',
    codItem: 'PA1', qtdEnc: 100, insumos: [], ...over,
});
const exigOk = (leiaute = '1') => exigenciaBlocoK({ regime: 'lucro', entregaBlocoK: true, leiauteBlocoK: leiaute });

// ════════════════════════════════════════════════════════════════════════════
// 📖 QUEM APRESENTA — e o Guia responde as duas pontas.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 quem entrega o bloco K', () => {
    // *"Os contribuintes optantes pelo Simples Nacional estão dispensados de
    // apresentarem este bloco, em virtude da Resolução CGSN nº 94"*.
    it('optante do Simples é DISPENSADO — e nem o cadastro marcado fura', () => {
        const e = exigenciaBlocoK({ regime: 'simples', entregaBlocoK: true, leiauteBlocoK: '1' });
        expect(e.exige).toBe(false);
        expect(e.motivo).toBe('simples-dispensado');
        expect(String(e.texto)).toMatch(/CGSN 94/);
    });

    // 🚨 O app NÃO DEDUZ quem é industrial. Detectar CFOP de produção é SINAL,
    // não enquadramento — quem responde é o CADASTRO.
    it('sem marcação no cadastro, não exige — mesmo com produção no movimento', () => {
        const e = exigenciaBlocoK({ regime: 'lucro', entregaBlocoK: false });
        expect(e.exige).toBe(false);
        expect(e.motivo).toBe('nao-marcado');
    });

    // ⚠️ O leiaute é ESCOLHA do contribuinte (K010, Ajuste SINIEF 02/09).
    // Escolher por ele faria o arquivo prometer detalhamento que o PVA cobra.
    it('marcado sem leiaute EXIGE e NÃO gera — a falta vai nomeada com o lugar', () => {
        const e = exigenciaBlocoK({ regime: 'lucro', entregaBlocoK: true });
        expect(e.exige).toBe(true);
        expect(e.motivo).toBe('sem-leiaute');
        expect(e.leiaute).toBeNull();
        expect(String(e.texto)).toMatch(/Dados Fiscais/);
    });

    it('leiaute fora de 0/1/2 é recusado, nunca corrigido para um palpite', () => {
        expect(exigenciaBlocoK({ regime: 'lucro', entregaBlocoK: true, leiauteBlocoK: '9' }).motivo).toBe('sem-leiaute');
    });

    it('os três leiautes do Ajuste SINIEF 02/09 são aceitos', () => {
        expect(Object.keys(LEIAUTES_BLOCO_K)).toEqual(['0', '1', '2']);
        for (const l of ['0', '1', '2']) expect(exigOk(l).leiaute).toBe(l);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 O QUE CADA LEIAUTE OBRIGA. O simplificado (0) DESOBRIGA o K235 — que é
// justamente o registro que exige apontamento insumo a insumo, o dado mais
// difícil de o cliente ter. O restrito (2) só leva saldo.
// ════════════════════════════════════════════════════════════════════════════
describe('📖 o leiaute decide quais registros saem', () => {
    it('só o completo (1) obriga o consumo por item (K235)', () => {
        expect(exigeInsumos('1')).toBe(true);
        expect(exigeInsumos('0')).toBe(false);
        expect(exigeInsumos('2')).toBe(false);
    });

    it('o restrito (2) não leva produção — só o saldo de estoque', () => {
        expect(exigeProducao('0')).toBe(true);
        expect(exigeProducao('1')).toBe(true);
        expect(exigeProducao('2')).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚨 A REGRA DO BLOCO H, APLICADA AQUI: ausência nunca vira zero.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 quantidade não informada NUNCA vira zero', () => {
    it('zero INFORMADO é resposta; vazio/null não é', () => {
        expect(quantidadeInformada(0)).toBe(true);
        expect(quantidadeInformada('0')).toBe(true);
        expect(quantidadeInformada(null)).toBe(false);
        expect(quantidadeInformada('')).toBe(false);
        expect(quantidadeInformada(undefined)).toBe(false);
        expect(quantidadeInformada('abc')).toBe(false);
    });

    it('linha sem quantidade fica FORA e sai contada, nunca com 0,000', () => {
        const p = planejarBlocoK({ estoques: [estoque({ qtd: null })], leiaute: '1' });
        expect(p.estoqueOk).toHaveLength(0);
        expect(p.avisos.join(' ')).toMatch(/1 sem quantidade informada/);
        expect(p.avisos.join(' ')).toMatch(/não vira zero/);
    });

    it('estoque ZERO informado ENTRA — ali o zero É a resposta', () => {
        const p = planejarBlocoK({ estoques: [estoque({ qtd: 0 })], leiaute: '1' });
        expect(p.estoqueOk).toEqual([{ codItem: 'P1', qtd: 0, indEst: '0', codPart: '' }]);
    });

    // 🚨 O CORAÇÃO DO MÓDULO. Empresa que ENTREGA o bloco e não informou nada
    // sai SEM DADOS com o gerador gritando — nunca com um K200 zerado.
    it('sem nenhum apontamento o bloco sai SEM DADOS e o gerador GRITA', () => {
        const r = montarBlocoK({ exigencia: exigOk('1'), dtIni: DT_INI, dtFin: DT_FIN });
        expect(r.linhas).toEqual([['K001', '1'], ['K990', 2]]);
        expect(r.indMov).toBe('1');
        expect(r.avisos.join(' ')).toMatch(/SEM DADOS/);
        expect(r.avisos.join(' ')).toMatch(/não sai zerado de propósito/);
        // e nenhuma linha de conteúdo — a prova de que nada foi inventado
        expect(r.linhas.some((l) => String(l[0]).startsWith('K2'))).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 K200 — REG|DT_EST|COD_ITEM|QTD|IND_EST|COD_PART
// ════════════════════════════════════════════════════════════════════════════
describe('📖 K200 — estoque escriturado', () => {
    const r = montarBlocoK({
        exigencia: exigOk('2'),
        estoques: [estoque({ codItem: 'P1', qtd: 12.5 })],
        dtIni: DT_INI, dtFin: DT_FIN,
    });

    it('abre o bloco COM dados e declara o leiaute no K010', () => {
        expect(r.indMov).toBe('0');
        expect(r.linhas[0]).toEqual(['K001', '0']);
        expect(r.linhas[1]).toEqual(['K010', '2']);
        expect(r.linhas[2]).toEqual(['K100', DT_INI, DT_FIN]);
    });

    // 📖 K200 campo 02, Validação: *"a data do estoque deve ser igual à data
    // final do período de apuração – campo DT_FIN do Registro K100"*.
    it('a DT_EST é a DT_FIN do K100, nunca a data de hoje', () => {
        const k200 = r.linhas.find((l) => l[0] === 'K200');
        expect(k200).toEqual(['K200', DT_FIN, 'P1', 12.5, '0', '']);
    });

    it('IND_EST fora de [0,1,2] cai no 0 (estoque próprio em poder próprio)', () => {
        expect(IND_EST_VALIDOS).toEqual(['0', '1', '2']);
        const p = planejarBlocoK({ estoques: [estoque({ indEst: '7' })], leiaute: '1' });
        expect(p.estoqueOk[0].indEst).toBe('0');
    });

    // 📖 K200 campo 05: IND_EST 1 ou 2 ⇒ COD_PART obrigatório (e no 0150).
    it('estoque de/em poder de terceiro SEM participante fica fora, nomeado', () => {
        const p = planejarBlocoK({ estoques: [estoque({ indEst: '1', codPart: '' })], leiaute: '1' });
        expect(p.estoqueOk).toHaveLength(0);
        expect(p.avisos.join(' ')).toMatch(/de terceiro sem participante/);
    });

    it('com participante, o estoque de terceiro entra', () => {
        const p = planejarBlocoK({ estoques: [estoque({ indEst: '2', codPart: 'F9' })], leiaute: '1' });
        expect(p.estoqueOk[0]).toEqual({ codItem: 'P1', qtd: 10, indEst: '2', codPart: 'F9' });
    });

    // 📖 K200 campo 03: o COD_ITEM tem de existir no 0200 — item órfão é
    // recusa do PVA (a família do 0150/0200 sem referência).
    it('item que o 0200 não declara fica fora e sai contado', () => {
        const p = planejarBlocoK({ estoques: [estoque({ codItem: 'XX' })], leiaute: '1', itensDo0200: ['P1'] });
        expect(p.estoqueOk).toHaveLength(0);
        expect(p.avisos.join(' ')).toMatch(/o 0200 não declara/);
    });

    // 📖 TIPO_ITEM de serviço (09) não entra no controle de estoque.
    it('TIPO_ITEM que o K200 não admite fica fora', () => {
        expect(TIPOS_ITEM_ESTOQUE).not.toContain('09');
        const p = planejarBlocoK({
            estoques: [estoque({ codItem: 'SERV-GENERICO' })],
            leiaute: '1', tipoPorItem: { 'SERV-GENERICO': '09' },
        });
        expect(p.estoqueOk).toHaveLength(0);
        expect(p.avisos.join(' ')).toMatch(/TIPO_ITEM que o K200 não admite/);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 K230 — REG|DT_INI_OP|DT_FIN_OP|COD_DOC_OP|COD_ITEM|QTD_ENC
// 📖 K235 — REG|DT_SAÍDA|COD_ITEM|QTD|COD_INS_SUBST
// ════════════════════════════════════════════════════════════════════════════
describe('📖 K230/K235 — produção e o consumo dela', () => {
    const r = montarBlocoK({
        exigencia: exigOk('1'),
        producao: [apontamento({ insumos: [{ dtSaida: '03072026', codItem: 'MP1', qtd: 250, codInsSubst: '' }] })],
        dtIni: DT_INI, dtFin: DT_FIN,
    });

    it('o K230 sai no leiaute do Guia', () => {
        expect(r.linhas.find((l) => l[0] === 'K230'))
            .toEqual(['K230', '01072026', '05072026', 'OP-1', 'PA1', 100]);
    });

    it('o K235 do insumo vem logo abaixo do K230 que o consome', () => {
        const i230 = r.linhas.findIndex((l) => l[0] === 'K230');
        expect(r.linhas[i230 + 1]).toEqual(['K235', '03072026', 'MP1', 250, '']);
    });

    // ⚠️ Insumo apontado num leiaute que o DESOBRIGA não some calado: o dado
    // existe e não vai ao arquivo, então alguém precisa saber.
    it('no simplificado o K235 não sai — e a ausência é DITA', () => {
        const s = montarBlocoK({
            exigencia: exigOk('0'),
            producao: [apontamento({ insumos: [{ codItem: 'MP1', qtd: 250 }] })],
            dtIni: DT_INI, dtFin: DT_FIN,
        });
        expect(s.linhas.some((l) => l[0] === 'K235')).toBe(false);
        expect(s.linhas.some((l) => l[0] === 'K230')).toBe(true);
        expect(s.avisos.join(' ')).toMatch(/DESOBRIGA o K235/);
    });

    // ⚠️ No restrito (2) a produção inteira fica fora — e isso é escolha do
    // contribuinte, não perda silenciosa.
    it('no restrito aos saldos a produção não entra, e sai dito', () => {
        const s = montarBlocoK({
            exigencia: exigOk('2'),
            estoques: [estoque()],
            producao: [apontamento()],
            dtIni: DT_INI, dtFin: DT_FIN,
        });
        expect(s.linhas.some((l) => l[0] === 'K230')).toBe(false);
        expect(s.avisos.join(' ')).toMatch(/restrito aos saldos/);
    });

    it('apontamento sem quantidade produzida fica fora, contado', () => {
        const p = planejarBlocoK({ producao: [apontamento({ qtdEnc: '' })], leiaute: '1' });
        expect(p.producaoOk).toHaveLength(0);
        expect(p.avisos.join(' ')).toMatch(/sem quantidade produzida/);
    });

    it('insumo sem quantidade não entra no K235 — mesma régua', () => {
        const p = planejarBlocoK({
            producao: [apontamento({ insumos: [{ codItem: 'MP1', qtd: null }, { codItem: 'MP2', qtd: 3 }] })],
            leiaute: '1',
        });
        expect(p.producaoOk[0].insumos.map((i) => i.codItem)).toEqual(['MP2']);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 📖 K990 — QTD_LIN_K conta as linhas do bloco INCLUINDO ela mesma. É uma das
// três aritméticas que o PVA confere (a família do 9900/9990/9999).
// ════════════════════════════════════════════════════════════════════════════
describe('📖 K990 conta o bloco inteiro, inclusive a própria linha', () => {
    it('bate com o número de linhas produzidas', () => {
        const r = montarBlocoK({
            exigencia: exigOk('1'),
            estoques: [estoque({ codItem: 'P1' }), estoque({ codItem: 'P2', qtd: 4 })],
            producao: [apontamento({ insumos: [{ codItem: 'MP1', qtd: 2 }] })],
            dtIni: DT_INI, dtFin: DT_FIN,
        });
        // K001 K010 K100 K200 K200 K230 K235 K990 = 8
        expect(r.linhas).toHaveLength(8);
        expect(r.linhas.at(-1)).toEqual(['K990', 8]);
    });

    it('no bloco sem dados, K990 = 2', () => {
        const r = montarBlocoK({ exigencia: exigenciaBlocoK({ regime: 'simples' }), dtIni: DT_INI, dtFin: DT_FIN });
        expect(r.linhas.at(-1)).toEqual(['K990', 2]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ ALARME SÓ ONDE HÁ AÇÃO. Empresa do Simples receberia o aviso TODO MÊS
// sobre um bloco que a lei dispensa dela — é o alarme que ninguém consegue
// apagar (a lição do aluguel na Rotina, 27/08).
// ════════════════════════════════════════════════════════════════════════════
describe('⚠️ o aviso nasce só onde alguém pode agir', () => {
    it('Simples dispensado NÃO gera aviso', () => {
        const r = montarBlocoK({ exigencia: exigenciaBlocoK({ regime: 'simples' }), dtIni: DT_INI, dtFin: DT_FIN });
        expect(r.avisos).toEqual([]);
    });

    it('marcado sem leiaute gera aviso com o lugar de preencher', () => {
        const r = montarBlocoK({
            exigencia: exigenciaBlocoK({ regime: 'lucro', entregaBlocoK: true }),
            dtIni: DT_INI, dtFin: DT_FIN,
        });
        expect(r.linhas).toEqual([['K001', '1'], ['K990', 2]]);
        expect(r.avisos.join(' ')).toMatch(/Dados Fiscais/);
    });

    it('exigência ausente não explode — devolve bloco vazio', () => {
        expect(montarBlocoK().linhas).toEqual([['K001', '1'], ['K990', 2]]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🚦 R27–R29 — A PREVALIDAÇÃO NASCE JUNTO DO GERADOR.
//
// 📌 O bloco K é o primeiro deste projeto a estrear com as regras no MESMO PR.
// As quatro pendências que a auditoria de 29/08 achou (H005, H010, ST, E510)
// existiam pelo contrário: código primeiro, regra depois — e "depois" custou
// uma volta de PVA por cliente.
//
// 🚨 E a prova que vale é esta: as regras leem o arquivo que o GERADOR produz,
// nunca uma linha escrita à mão (fixture que não é o que o gerador emite é
// teste verde sobre defeito vivo).
// ════════════════════════════════════════════════════════════════════════════
describe('🚦 as regras do bloco K NASCEM VERDES sobre o gerador real', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prevalidarSpedFiscal } = require('../sefaz-backend/sped-prevalidacao.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { buildBlocoK } = require('../sefaz-backend/sped-fiscal-blocoK.js');

    const L = (...campos: (string | number)[]) => `|${campos.join('|')}|`;
    const REG0000 = L('0000', '020', '0', '01072026', '31072026', 'EMPRESA X', '11111111000191',
        '', 'SP', '123456789012', '3550308', '', '', 'A', '1');
    const doK = (regra: string) => (e: { regra: string }) => e.regra === regra;

    const gerar = (over: Record<string, unknown> = {}) => buildBlocoK({
        empresa: { dadosFiscais: { entregaBlocoK: true, leiauteBlocoK: '1' } },
        regime: 'lucro',
        competenciaInicio: '2026-07',
        competenciaFim: '2026-07',
        itens: [{ codItem: 'IT1', tipo: '00' }, { codItem: 'PA1', tipo: '03' }, { codItem: 'MP1', tipo: '01' }],
        blocoK: {
            estoques: [{ codItem: 'IT1', qtd: 10, indEst: '0' }],
            producao: [{
                dtIniOp: '01072026', dtFinOp: '05072026', codDocOp: 'OP-1',
                codItem: 'PA1', qtdEnc: 100,
                insumos: [{ dtSaida: '03072026', codItem: 'MP1', qtd: 250 }],
            }],
        },
        warnings: [],
        ...over,
    });

    it('o arquivo que o gerador produz não acusa nada', () => {
        const linhas: string[] = gerar();
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'PARAFUSO', '', '', '', '00', 'UN', ''),
            L('0200', 'PA1', 'PRODUTO ACABADO', '', '', '', '03', 'UN', ''),
            L('0200', 'MP1', 'MATERIA PRIMA', '', '', '', '01', 'UN', ''),
            ...linhas.map((l) => l.trim()),
        ]);
        expect(r.erros.filter((e: { regra: string }) => String(e.regra).startsWith('k'))).toEqual([]);
    });

    // 📖 K200 campo 02: *"a data do estoque deve ser igual à data final do
    // período de apuração – campo DT_FIN do Registro K100"*.
    it('R27 acusa DT_EST diferente da DT_FIN do K100', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('K100', '01072026', '31072026'),
            L('K200', '30062026', 'IT1', '10,000', '0', ''),
        ]);
        expect(r.erros.filter(doK('k200-dt-est'))).toHaveLength(1);
    });

    // 📖 K200 campo 03: o COD_ITEM deve existir no 0200.
    it('R28 acusa item do bloco K que o 0200 não declara', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'PARAFUSO', '', '', '', '00', 'UN', ''),
            L('K100', '01072026', '31072026'),
            L('K200', '31072026', 'FANTASMA', '10,000', '0', ''),
        ]);
        const e = r.erros.filter(doK('k-item-orfao'));
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('FANTASMA');
    });

    // ⚠️ O COD_ITEM está em posições DIFERENTES: campo 05 no K230, 03 nos
    // outros. Ler a posição do vizinho acusaria linha correta.
    it('R28 lê o COD_ITEM na posição certa do K230', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'PA1', 'PRODUTO', '', '', '', '03', 'UN', ''),
            L('K100', '01072026', '31072026'),
            L('K230', '01072026', '05072026', 'OP-1', 'PA1', '100,000'),
        ]);
        expect(r.erros.filter(doK('k-item-orfao'))).toEqual([]);
    });

    // 📖 K200 campo 06: obrigatório quando IND_EST é 1 ou 2.
    it('R29 acusa estoque de terceiro sem participante', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'PARAFUSO', '', '', '', '00', 'UN', ''),
            L('K100', '01072026', '31072026'),
            L('K200', '31072026', 'IT1', '10,000', '1', ''),
        ]);
        expect(r.erros.filter(doK('k200-cod-part'))).toHaveLength(1);
    });

    it('R29 acusa participante que o 0150 não declara', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'PARAFUSO', '', '', '', '00', 'UN', ''),
            L('0150', 'F1', 'FORNECEDOR', '1058', '11111111000191', '', '', '3550308', '', '', ''),
            L('K100', '01072026', '31072026'),
            L('K200', '31072026', 'IT1', '10,000', '2', 'F9'),
        ]);
        const e = r.erros.filter(doK('k200-cod-part'));
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('F9');
    });

    it('estoque próprio (IND_EST 0) sem participante não acusa nada', () => {
        const r = prevalidarSpedFiscal([
            REG0000,
            L('0200', 'IT1', 'PARAFUSO', '', '', '', '00', 'UN', ''),
            L('K100', '01072026', '31072026'),
            L('K200', '31072026', 'IT1', '10,000', '0', ''),
        ]);
        expect(r.erros.filter(doK('k200-cod-part'))).toEqual([]);
    });

    // ⚠️ Arquivo SEM bloco K (o caso da maioria da carteira) não pode acender
    // nada — alarme sobre arquivo normal é o que desliga a prevalidação.
    it('arquivo sem bloco K fica MUDO', () => {
        const r = prevalidarSpedFiscal([REG0000, L('K001', '1'), L('K990', '2')]);
        expect(r.erros.filter((e: { regra: string }) => String(e.regra).startsWith('k'))).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A CASCA NÃO REIMPLEMENTA A RÉGUA, e o orquestrador não volta ao vazio.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 o gerador chama o dono', () => {
    const ler = (p: string) => require('fs').readFileSync(require('path').join(__dirname, '..', p), 'utf8');
    const semComentario = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    it('a casca do bloco K importa a régua pura', () => {
        const src = semComentario(ler('sefaz-backend/sped-fiscal-blocoK.js'));
        expect(src).toMatch(/from '\.\/sped-bloco-k\.js'/);
        expect(src).toMatch(/montarBlocoK\(/);
    });

    // 🚨 O bloco K era `buildBlocoVazio('K')`. Voltar a isso apagaria o módulo
    // inteiro sem quebrar nada — exatamente o defeito que este teste barra.
    it('o orquestrador não gera mais bloco K vazio', () => {
        const src = semComentario(ler('sefaz-backend/sped-fiscal-orchestrator.js'));
        expect(src).toMatch(/buildBlocoK\(dados\)/);
        expect(src).not.toMatch(/buildBlocoK\(\)/);
    });

    it('os avisos do bloco chegam a quem gera (warnings), não só ao log', () => {
        const src = semComentario(ler('sefaz-backend/sped-fiscal-blocoK.js'));
        expect(src).toMatch(/warnings.*push/s);
    });
});

// ============================================================================
// 🚨 O SIMPLIFICADO NÃO DESOBRIGA TUDO — e o comentário do módulo dizia que sim.
//
// Ele afirmava que *"o simplificado desobriga justamente os registros de
// consumo por item (K210/K215/K235/K255/K260/K265)"*. A **tabela oficial** do
// Guia 3.2.3 (seção do K010, *"a obrigatoriedade de informação dos registros
// de acordo com o leiaute adotado"*) diz outra coisa: no simplificado seguem
// OBRIGATÓRIOS o K220, o K250, o K270/K280 e o K290/K291/K300/K301.
//
// 📌 É a lição de 28/08 — o comentário do M210 que citava uma regra da casa e
// afirmava o OPOSTO dela. **Comentário que afirma uma regra tem de estar
// certo**, porque a próxima pessoa cita ele de volta: quem lesse aquele
// concluiria que escolher o simplificado fecha o buraco. Não fecha.
// ============================================================================
describe('🚨 a obrigatoriedade por leiaute vem da tabela do Guia', () => {
    it('o simplificado MANTÉM K220, K250, K270, K280 e a produção conjunta', () => {
        for (const reg of ['K220', 'K250', 'K270', 'K280', 'K290', 'K291', 'K300', 'K301']) {
            expect(OBRIGATORIEDADE_POR_LEIAUTE[reg].simplificado).toBe(true);
        }
    });

    it('e desobriga os de consumo por item', () => {
        for (const reg of ['K210', 'K215', 'K235', 'K255', 'K260', 'K265', 'K275', 'K292', 'K302']) {
            expect(OBRIGATORIEDADE_POR_LEIAUTE[reg].simplificado).toBe(false);
        }
    });

    it('no COMPLETO tudo é obrigatório', () => {
        for (const o of Object.values(OBRIGATORIEDADE_POR_LEIAUTE)) {
            expect((o as { completo: boolean }).completo).toBe(true);
        }
    });

    it('a espinha que o módulo monta é K100 · K200 · K230 · K235', () => {
        expect(REGISTROS_GERADOS).toEqual(['K100', 'K200', 'K230', 'K235']);
    });

    it('o buraco do simplificado tem OITO registros — escolhê-lo não o fecha', () => {
        expect(registrosExigidosQueFaltam('0'))
            .toEqual(['K220', 'K250', 'K270', 'K280', 'K290', 'K291', 'K300', 'K301']);
    });

    it('e o do completo tem dezesseis', () => {
        expect(registrosExigidosQueFaltam('1')).toHaveLength(16);
        expect(registrosExigidosQueFaltam('1')).toContain('K210');
    });

    // ⚠️ NO LEIAUTE 2 A ESPINHA JÁ É O BLOCO INTEIRO — avisar ali seria alarme
    // sobre arquivo completo, que é como se ensina a equipe a ignorar o aviso.
    it('leiaute 2 (restrito aos saldos) não tem buraco', () => {
        expect(registrosExigidosQueFaltam('2')).toEqual([]);
        expect(registrosExigidosQueFaltam('')).toEqual([]);
    });
});

describe('🚩 a COBERTURA sai dita no arquivo com dados', () => {
    const comDados = (leiaute: string) => montarBlocoK({
        exigencia: exigOk(leiaute),
        estoques: [estoque()],
        dtIni: DT_INI, dtFin: DT_FIN,
        itensDo0200: ['P1'], tipoPorItem: { P1: '00' },
    });

    it('o aviso nomeia os registros que faltam e diz que o PVA aceita sem eles', () => {
        const a = comDados('0').avisos.find((x: string) => x.includes('ESPINHA'));
        expect(a).toBeTruthy();
        expect(a).toMatch(/K220/);
        expect(a).toMatch(/K250/);
        expect(a).toMatch(/lançados no PVA/);
        expect(a).toMatch(/menos movimento do que houve/);
    });

    it('e ele NÃO nasce no leiaute 2 — ali não falta nada', () => {
        expect(comDados('2').avisos.find((x: string) => x.includes('ESPINHA'))).toBeUndefined();
    });

    // ⚠️ Bloco SEM dados já tem o aviso dele (o do bloco H); dois alarmes para
    // a mesma geração é o caminho conhecido para a equipe ignorar os dois.
    it('bloco SEM dados não ganha o aviso de cobertura', () => {
        const r = montarBlocoK({ exigencia: exigOk('1'), dtIni: DT_INI, dtFin: DT_FIN });
        expect(r.avisos.find((x: string) => x.includes('ESPINHA'))).toBeUndefined();
    });
});
