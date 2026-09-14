// ============================================================================
// 🚨 A NFC-e NO EFD-CONTRIBUIÇÕES É C100 + C175 — e o C175 nunca tinha saído
//
// Paulo, 14/09 (HYPE CAFÉ 1385 · 08/2026, PVA 6.2.0): *"deu esses erros, 295
// são de registro C175, e não puxou o M200 nem M210 e assim no COFINS tbm"*.
//
// Relatório de Erros do PVA — Total de Erros 298:
//   · 295× "A escrituração das receitas auferidas por Notas Fiscais Eletrônicas
//     de Consumidor Final - NFC-e (COD_MOD = 65) deve ser efetuada de forma
//     individualizada no registro C100, sendo o campo COD_PART facultativo e
//     com a informação referente à base de cálculo, alíquota e valor das
//     contribuições apuradas sendo escrituradas de forma consolidada e
//     analítica (por CST e alíquotas), no registro C175." (uma por NFC-e,
//     campo esperado C175, "Registro/Campo não informado ou inválido")
//   ·   2× "Não deverá existir um registro M210/M610 - Detalhamento da
//     Contribuição para Código de Contribuição Social e Alíquota não informados
//     nos documentos com CST de 01 a 05." (consequência: sem C175 a Receita não
//     vê receita nenhuma no cupom)
//   ·   1× COD_MUN do 0150 (pendência do Paulo, como sempre)
//
// Em 24/08 o C170 saiu do cupom (572 recusas) e ficou escrito "a receita da
// NFC-e é declarada no C100 e no bloco M". Metade: o Guia 1.35 diz *"deve a
// pessoa jurídica apresentar somente os registros C100 e C175"*, e o PVA lê a
// receita do cupom no VL_OPR do C175 — sem ele regera o M200/M210 ZERADO.
// ============================================================================
import {
    consolidarC175, camposDoC175, cstComIncidenciaNaSaida, CST_PISCOFINS_COM_INCIDENCIA,
} from '../sefaz-backend/sped-contrib-c175.js';
import { buildBlocoC_Contrib, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';
import {
    conferirC175DaNfce, conferirC170DeNfce, conferirContagemDeCampos, conferirAritmeticaPisCofins,
    conferirReceitaBrutaDoM210, conferirSomaDosItensContrib, conferirCadastrosOrfaosContrib,
    conferirCstPisCofins, avisosDaPrevalidacaoContrib,
// @ts-ignore — módulo JS do backend, sem tipos
} from '../sefaz-backend/sped-contrib-campos.js';
import { DETALHES_VIGIADOS } from '../sefaz-backend/sped-auditoria-saida.js';
// @ts-ignore — módulo JS do backend, sem tipos
import * as fmt from '../sefaz-backend/sped-fiscal-format.js';

const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');
const brl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

/** A linha REAL do C100 recusado (HYPE 08/2026, NFC-e nº 180 · 139,80 · ICMS 5,60). */
const C100_NFCE_180 = '|C100|1|0||65|00|005|180|35260866641236000115650050000000180139335935'
    + '|01082026|01082026|139,80|0|0,00||139,80|9|0,00|0,00|0,00|139,80|5,60|0,00|0,00|0,00|0,90|4,20|||';
const C100_NFE = '|C100|0|1|37626446000136|55|00|002|1572866|35260737626446000136550020015728661082963404'
    + '|29072026|29072026|95,00|0|0,00||95,00|9|0,00|0,00|0,00|95,00|17,10|0,00|0,00|0,00|1,29|5,92|||';
const C170_DA_NFE = '|C170|1|UD-10-640|Frasco pote de Vidro 640ml com tampa|1,00000|KIT|95,00|0,00|0|000'
    + '|1102||95,00|18,00|17,10|0,00|0,00|0,00|0|||0,00|0,00|0,00|70|0,00|0,0000|||0,00|70|0,00|0,0000|||0,00||';

const CHAVE_180 = '35260866641236000115650050000000180139335935';
const CHAVE_181 = '35260866641236000115650050000000181149651378';
const CHAVE_55 = '35260737626446000136550020015728661082963404';

const item = (n: number, cod: string, vProd: number, vICMS: number, extra: any = {}) => ({
    nItem: n, cProd: cod, xProd: `ITEM ${cod}`, qCom: 1, uCom: 'UN', vProd, vICMS, vBC: vProd,
    cfop: '5102', NCM: '21069090', ...extra,
});
const nota = (chave: string, numero: string, itens: any[], vNF: number) => ({
    chave, numero, serie: '5', direcao: 'saida', status: 'autorizado',
    dhEmi: '2026-08-01T12:00:00-03:00', cnpjEmit: '66641236000115', xNomeEmit: 'HYPE CAFE',
    totais: { vNF }, itens,
});
const dados = (notas: any[]) => ({
    empresa: { cnpj: '66641236000115', nome: 'HYPE CAFE', uf: 'SP' },
    competencia: '2026-08', competenciaFim: '2026-08', regimeApuracao: '2',
    notas, warnings: [] as string[],
});
const gerarC = (notas: any[]) => buildBlocoC_Contrib(dados(notas)).map(semQuebra);

describe('🚨 o dono consolida por CFOP + CST + alíquotas (Guia 1.35, C175)', () => {
    it('itens com a mesma combinação viram UM registro; combinação diferente, outro', () => {
        const r = consolidarC175([
            { cfop: '5102', vlItem: 40, desconto: 0, icms: 1.6, cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3 },
            { cfop: '5102', vlItem: 60, desconto: 0, icms: 2.4, cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3 },
            { cfop: '5405', vlItem: 10, desconto: 0, icms: 0, cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3 },
        ]).registros;
        expect(r).toHaveLength(2);
        const g = r.find(x => x.cfop === '5102')!;
        expect(g.vlOpr).toBe(100);
        expect(g.vlDesc).toBe(4);            // exclusão do ICMS vai no campo 04 (Seção 12)
        expect(g.vlBcPis).toBe(96);
        expect(g.vlPis).toBe(0.62);          // 96 × 0,65% = 0,624 → 0,62 (validação do campo 10)
        expect(g.vlCofins).toBe(2.88);
    });

    it('CST sem incidência (04 monofásico) sai com base, alíquota e valor ZERO — e o VL_OPR fica', () => {
        const r = consolidarC175([
            { cfop: '5102', vlItem: 29.9, desconto: 0, icms: 1.2, cstPis: '04', cstCofins: '04', aliqPis: 0.65, aliqCofins: 3 },
        ]).registros;
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ cstPis: '04', vlOpr: 29.9, vlBcPis: 0, aliqPis: 0, vlPis: 0, vlBcCofins: 0, vlCofins: 0 });
        expect(CST_PISCOFINS_COM_INCIDENCIA).toEqual(['01', '02', '03', '05']);
        expect(cstComIncidenciaNaSaida('1')).toBe(true);
        expect(cstComIncidenciaNaSaida('06')).toBe(false);
    });

    it('o valor sai da BASE consolidada, não da soma item a item — a linha fecha consigo mesma', () => {
        // 3 itens de 0,33 com 0,65%: item a item daria 3 × 0,00 = 0,00; a base
        // consolidada 0,99 × 0,65% = 0,0064 → 0,01.
        const r = consolidarC175([1, 2, 3].map(() => ({
            cfop: '5102', vlItem: 0.33, desconto: 0, icms: 0, cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3,
        }))).registros;
        expect(r[0].vlBcPis).toBe(0.99);
        expect(r[0].vlPis).toBe(0.01);
        expect(r[0].vlCofins).toBe(0.03);
    });

    it('CFOP fora de 5xxx NÃO é trocado — é DITO', () => {
        const { registros, avisos } = consolidarC175([
            { cfop: '6102', vlItem: 10, desconto: 0, icms: 0, cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3 },
        ]);
        expect(registros[0].cfop).toBe('6102');
        expect(avisos.join(' ')).toContain('CFOP iniciado com 5');
    });

    it('os 18 campos saem na ordem do Guia', () => {
        const campos = camposDoC175(consolidarC175([
            { cfop: '5102', vlItem: 139.8, desconto: 0, icms: 5.6, cstPis: '01', cstCofins: '01', aliqPis: 0.65, aliqCofins: 3 },
        ]).registros[0], fmt.formatValue);
        expect(campos).toHaveLength(18);
        expect(campos).toEqual(['C175', '5102', '139,80', '5,60', '01', '134,20', '0,6500', '', '', '0,87',
            '01', '134,20', '3,0000', '', '', '4,03', '', '']);
    });
});

describe('🚨 o gerador: C100 da NFC-e + C175, com os números da HYPE 08/2026', () => {
    it('a NFC-e nº 180 (139,80 · ICMS 5,60) sai com C100 e UM C175 — 134,20 × 0,65% = 0,87', () => {
        const l = gerarC([nota(CHAVE_180, '180', [item(1, '10', 139.8, 5.6)], 139.8)]);
        const c100 = l.find(x => x.startsWith('|C100|'))!;
        expect(c100).toContain('|65|00|005|180|');
        const c175 = l.filter(x => x.startsWith('|C175|'));
        expect(c175).toEqual(['|C175|5102|139,80|5,60|01|134,20|0,6500|||0,87|01|134,20|3,0000|||4,03|||']);
        expect(l.filter(x => x.startsWith('|C170|'))).toHaveLength(0);
        // E a contagem dos 18 campos é a do Guia — a trava que ficou muda em 24/08.
        expect(conferirContagemDeCampos(l).erros).toEqual([]);
    });

    it('item CST 04 no MESMO cupom vira um segundo C175 zerado, e a nota 55 continua com C170', () => {
        const l = gerarC([
            nota(CHAVE_181, '181', [item(1, '11', 40, 1.6), item(2, '20', 29.9, 1.2, { cstPis: '04', cstCofins: '04' })], 69.9),
            nota(CHAVE_55, '1572866', [item(1, 'UD-10-640', 95, 17.1, { cfop: '5102' })], 95),
        ]);
        const c175 = l.filter(x => x.startsWith('|C175|'));
        expect(c175).toEqual([
            '|C175|5102|40,00|1,60|01|38,40|0,6500|||0,25|01|38,40|3,0000|||1,15|||',
            '|C175|5102|29,90|1,20|04|0,00|0,0000|||0,00|04|0,00|0,0000|||0,00|||',
        ]);
        expect(l.filter(x => x.startsWith('|C170|'))).toHaveLength(1);
    });

    it('o C170 da nota 55 lê a MESMA régua de incidência: CST 06 sai com base e alíquota zero', () => {
        const l = gerarC([nota(CHAVE_55, '7', [item(1, 'X', 100, 18, { cstPis: '06', cstCofins: '06' })], 100)]);
        const c170 = l.find(x => x.startsWith('|C170|'))!.split('|');
        expect(c170[25]).toBe('06');
        expect(c170[26]).toBe('0,00');     // VL_BC_PIS
        expect(c170[27]).toBe('0,0000');   // ALIQ_PIS — antes caía no 0,65% do regime
        expect(c170[30]).toBe('0,00');     // VL_PIS
    });

    it('o bloco M lê a mesma régua: o item sem incidência sai da receita E da base, DITO', () => {
        const d = dados([
            nota(CHAVE_180, '180', [item(1, '10', 139.8, 5.6)], 139.8),
            nota(CHAVE_181, '181', [item(1, '11', 40, 1.6), item(2, '20', 29.9, 1.2, { cstPis: '04', cstCofins: '04' })], 69.9),
        ]);
        const m210 = buildBlocoM(d).map(semQuebra).find(x => x.startsWith('|M210|'))!;
        // receita 139,80 + 40,00 = 179,80 · base 134,20 + 38,40 = 172,60
        expect(m210).toBe('|M210|51|179,80|172,60|0,00|0,00|172,60|0,6500|||1,12|0,00|0,00|||1,12|');
        expect(d.warnings.join(' ')).toContain('1 item(ns) de saída em 1 documento(s), R$ 29.90, ficaram FORA');
    });

    it('a composição fecha: gerador → prevalidação, ZERO erros no arquivo correto', () => {
        const l = gerarC([
            nota(CHAVE_180, '180', [item(1, '10', 139.8, 5.6)], 139.8),
            nota(CHAVE_181, '181', [item(1, '11', 40, 1.6), item(2, '20', 29.9, 1.2, { cstPis: '04', cstCofins: '04' })], 69.9),
        ]);
        expect(conferirC175DaNfce(l).erros).toEqual([]);
        expect(conferirC170DeNfce(l).erros).toEqual([]);
        expect(conferirAritmeticaPisCofins(l).erros).toEqual([]);
        expect(conferirSomaDosItensContrib(l).erros).toEqual([]);
        expect(conferirCstPisCofins(l).erros).toEqual([]);
        expect(conferirCadastrosOrfaosContrib(l).erros).toEqual([]);
    });

    it('e o aviso do orquestrador diz C100 + C175 (varredura)', () => {
        const orq = require('fs').readFileSync(require('path').resolve(__dirname, '../sefaz-backend/sped-contrib-orchestrator.js'), 'utf8');
        expect(orq).toMatch(/com C100 \+ C175/);
    });
});

describe('🚨 a recusa virou regra — e acusaria o arquivo de 14/09', () => {
    it('C100 de NFC-e SEM C175: a recusa literal do PVA, com o número da nota', () => {
        const r = conferirC175DaNfce([C100_NFCE_180, '|C990|2|']).erros;
        expect(r).toHaveLength(1);
        expect(r[0].registro).toBe('C100');
        expect(r[0].fonte).toContain('no registro C175');
        expect(r[0].fonte).toContain('HYPE CAFE');
        expect(r[0].mensagem).toContain('nº 180');
        expect(r[0].mensagem).toContain('M200/M210');
    });

    it('fica MUDA na NFC-e com C175 e na nota 55 sem ele', () => {
        const c175 = '|C175|5102|139,80|5,60|01|134,20|0,6500|||0,87|01|134,20|3,0000|||4,03|||';
        expect(conferirC175DaNfce([C100_NFCE_180, c175, C100_NFE, C170_DA_NFE]).erros).toEqual([]);
    });

    it('C175 pendurado em nota 55 é acusado', () => {
        const c175 = '|C175|5102|95,00|17,10|01|77,90|0,6500|||0,51|01|77,90|3,0000|||2,34|||';
        const r = conferirC175DaNfce([C100_NFE, c175]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toContain('modelo 55');
    });

    it('CFOP fora de 5xxx e combinação repetida são acusados com o Guia como fonte', () => {
        const a = '|C175|6102|10,00|0,00|01|10,00|0,6500|||0,07|01|10,00|3,0000|||0,30|||';
        const b = '|C175|5102|10,00|0,00|01|10,00|0,6500|||0,07|01|10,00|3,0000|||0,30|||';
        const r = conferirC175DaNfce([C100_NFCE_180, a, b, b]).erros;
        expect(r.map((e: any) => e.fonte.includes('CFOP iniciados com 5'))).toContain(true);
        expect(r.map((e: any) => e.fonte.includes('mesma combinação'))).toContain(true);
        expect(r).toHaveLength(2);
    });

    it('entrou no agregador que a rota chama', () => {
        expect(avisosDaPrevalidacaoContrib([C100_NFCE_180, '|C990|2|']).join(' ')).toContain('SEM C175');
    });
});

describe('🚨 as travas vizinhas conhecem o C175', () => {
    it('aritmética: VL_PIS = VL_BC × ALIQ ÷ 100 também no C175', () => {
        const torto = '|C175|5102|139,80|5,60|01|134,20|0,6500|||8,70|01|134,20|3,0000|||4,03|||';
        const r = conferirAritmeticaPisCofins([torto]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].registro).toBe('C175');
        expect(r[0].fonte).toContain('C175 (10 e 16)');
    });

    it('CST fora da tabela é acusado no C175 (campos 05 e 11)', () => {
        const torto = '|C175|5102|139,80|5,60|500|134,20|0,6500|||0,87|01|134,20|3,0000|||4,03|||';
        const r = conferirCstPisCofins([torto]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].campo).toBe('5 - CST_PIS');
    });

    it('Σ VL_OPR dos C175 fecha com o VL_MERC do C100 pai', () => {
        const meio = '|C175|5102|100,00|5,60|01|94,40|0,6500|||0,61|01|94,40|3,0000|||2,83|||';
        const r = conferirSomaDosItensContrib([C100_NFCE_180, meio]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toContain('139.80');
        expect(r[0].mensagem).toContain('100.00');
    });

    it('VL_REC_BRT do M210 SOMA o VL_OPR do C175 (só CST tributado) — antes o C175 deixava a regra muda', () => {
        const c175 = '|C175|5102|139,80|5,60|01|134,20|0,6500|||0,87|01|134,20|3,0000|||4,03|||';
        const c175Mono = '|C175|5102|29,90|1,20|04|0,00|0,0000|||0,00|04|0,00|0,0000|||0,00|||';
        const m210 = (v: string) => `|M210|51|${v}|134,20|0,00|0,00|134,20|0,6500|||0,87|0,00|0,00|||0,87|`;
        expect(conferirReceitaBrutaDoM210([C100_NFCE_180, c175, c175Mono, m210('139,80')]).erros).toEqual([]);
        const r = conferirReceitaBrutaDoM210([C100_NFCE_180, c175, c175Mono, m210('169,70')]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].mensagem).toContain('139.80');
    });

    it('o C175 entrou na auditoria de saída (VL_OPR zerado em 100% das linhas acusa)', () => {
        expect((DETALHES_VIGIADOS as any).C175.campos[3]).toBe('VL_OPR');
    });
});
