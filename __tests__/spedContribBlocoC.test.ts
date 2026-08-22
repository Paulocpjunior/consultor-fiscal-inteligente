// ============================================================================
// 🚨 O BLOCO C DO EFD-CONTRIBUIÇÕES NUNCA TINHA PASSADO PELO PVA — 157 recusas
// de IMPORTAÇÃO, todas em C100 e C170 (PWR 1364 · 07/2026, 20/08).
//
// Paulo: *"São erros diferentes dos outros, agora estamos falando do PIS e
// COFINS de Indústria"*. E é literalmente isso: MANTOAN e HS PROJETOS são de
// SERVIÇO e fecham pelo bloco A (A100/A170). A PWR é a primeira INDÚSTRIA — a
// primeira a passar pelo bloco C deste arquivo.
//
// A recusa começa em *"O número de campos informado no registro difere do
// número de campos especificado no leiaute"*: C100 esperado 29, veio 24; C170
// esperado 37, veio 23. A causa não era campo faltando no fim — o gerador
// PULOU a seção de ICMS/IPI, e o PIS foi parar nas casas do ICMS. Os outros
// 125 erros (CST_ICMS, CFOP, VL_ICMS_ST, COD_ENQ) são consequência.
//
// GABARITO: o EFD-Contribuições ACEITO da MESMA empresa (03/2026, e-Fiscal,
// assinado) — "arquivo aceito > leiaute deduzido".
// ============================================================================
import { buildBlocoC_Contrib, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { conferirContagemDeCampos } from '../sefaz-backend/sped-contrib-campos.js';

/** A linha REAL do arquivo aceito da PWR (03/2026), campo a campo. */
const C100_ACEITO = '|C100|1|0|7FX0YC9FP|55|00|001|1|35260331947349000169550010000000011607639794'
    + '|28032026|28032026|19580|0|0|0|19580|1|0|0|0|19580|3524,4|0|0|0|127,27|587,4|0|0|';
const C170_ACEITO = '|C170|1|2||178|MT|19580|0|1|000|5101||19580|18|3524,4|0|0|0|0|||0|0|0'
    + '|01|16055,6|0,65|||104,36|01|16055,6|3|||481,67||';

const nCampos = (l: string) => l.replace(/\r?\n$/, '').split('|').slice(1, -1).length;

const CHAVE_SAIDA = '35260731947349000169550010000000031705547508';
const CHAVE_ENTRADA = '31260702235305000108550010000348531000385216';

const dados = (notas: any[], regimeApuracao = '2') => ({
    empresa: {
        cnpj: '31947349000169', _regime: 'lucro',
        dadosFiscais: { uf: 'SP', codMunIBGE: '3507605' },
    },
    regimeApuracao,
    competenciaInicio: '2026-07', competenciaFim: '2026-07',
    notas, warnings: [] as string[],
});

/** Saída real da PWR 07/2026 (nota 3, AC LASER). */
const saida = (over: any = {}) => ({
    id: 's1', chave: CHAVE_SAIDA, tipo: 'NFe', tipoDoc: 'NFe',
    status: 'autorizado', direcao: 'saida', competencia: '2026-07',
    numero: '3', serie: '1', dhEmi: '2026-07-13T10:00:00-03:00',
    destinatario: { cnpjCpf: '15438711000110', nome: 'AC LASER' },
    totais: { vNF: 8562.54 },
    itens: [{
        nItem: 1, cProd: '4', xProd: 'TELHA GALV/PINTADA', qCom: 169, uCom: 'MT',
        vProd: 6743.10, vBC: 6743.10, aliqIcms: 18, vICMS: 1213.76, cst: '00',
        cfop: '5101', vPIS: 43.83, aliqPIS: 0.65, vCOFINS: 202.29, aliqCOFINS: 3,
    }],
    ...over,
});

/** Entrada real da PWR 07/2026 (GLOBAL COMPANY) — fornecedor NÃO-cumulativo. */
const entrada = (over: any = {}) => ({
    id: 'e1', chave: CHAVE_ENTRADA, tipo: 'NFe', tipoDoc: 'NFe',
    status: 'autorizado', direcao: 'entrada', competencia: '2026-07',
    numero: '34853', serie: '1', dhEmi: '2026-07-29T10:00:00-03:00',
    emitente: { cnpjCpf: '02235305000108', nome: 'GLOBAL COMPANY' },
    totais: { vNF: 4765.00 },
    itens: [{
        nItem: 1, cProd: '84814', xProd: 'TELHA EM EPS', qCom: 500, uCom: 'UN',
        vProd: 4765.00, vBC: 4765.00, aliqIcms: 18, vICMS: 857.70, cst: '00',
        cfop: '6101',
        // O CST do FORNECEDOR, capturado do XML dele — não-cumulativo.
        cstPis: '01', aliqPIS: 1.65, vPIS: 78.62,
        cstCofins: '01', aliqCOFINS: 7.6, vCOFINS: 362.14,
    }],
    ...over,
});

const linhasDe = (notas: any[], regime = '2') =>
    buildBlocoC_Contrib(dados(notas, regime)) as string[];
const acha = (ls: string[], reg: string) => ls.filter((l) => l.startsWith(`|${reg}|`));

describe('🚨 contagem de campos — a recusa que barrou o arquivo inteiro', () => {
    it('o arquivo ACEITO tem 29 campos no C100 e 37 no C170 (é o gabarito)', () => {
        expect(nCampos(C100_ACEITO)).toBe(29);
        expect(nCampos(C170_ACEITO)).toBe(37);
    });

    it('o C100 gerado passou a ter 29 campos — vinha com 24', () => {
        expect(nCampos(acha(linhasDe([saida()]), 'C100')[0])).toBe(29);
    });

    it('o C170 gerado passou a ter 37 campos — vinha com 23', () => {
        expect(nCampos(acha(linhasDe([saida()]), 'C170')[0])).toBe(37);
    });

    it('e a conferência de campos do próprio app aprova as duas linhas', () => {
        const r = conferirContagemDeCampos(linhasDe([saida(), entrada()]));
        expect(r.erros.filter((e: any) => ['C100', 'C170'].includes(e.registro))).toHaveLength(0);
    });

    it('⚠️ a conferência PROVA que enxerga o defeito antigo (24/23 campos)', () => {
        const antigo = [
            '|C100|0|1|02235305000108|55|00|1|34853|31260702235305000108550010000348531000385216'
            + '|29072026|29072026|4765,00||0,00|||||||4765,00|69,19|4765,00|318,68|',
        ];
        const r = conferirContagemDeCampos(antigo);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].esperado).toBe(29);
        expect(r.erros[0].recebido).toBe(24);
    });
});

describe('as posições do C170 casam com o arquivo aceito', () => {
    const f = (l: string) => l.replace(/\r?\n$/, '').split('|').slice(1, -1);

    it('CST_ICMS (10) tem 3 dígitos e CFOP (11) é o escriturado — não o PIS', () => {
        const c = f(acha(linhasDe([saida()]), 'C170')[0]);
        expect(c[9]).toMatch(/^\d{3}$/);      // 10 CST_ICMS
        expect(c[10]).toBe('5101');           // 11 CFOP
    });

    it('a seção de ICMS existe: base, alíquota e valor nas casas 13-15', () => {
        const c = f(acha(linhasDe([saida()]), 'C170')[0]);
        expect(c[12]).toBe('6743,10');        // 13 VL_BC_ICMS
        expect(c[13]).toBe('18,00');          // 14 ALIQ_ICMS
        expect(c[14]).toBe('1213,76');        // 15 VL_ICMS
    });

    // ⚠️ ESTE TESTE MUDOU DE NÚMERO EM 20/08, e a premissa antiga é que caiu:
    // ele exigia VL_BC_PIS = 6.743,10 (o vProd cheio) e VL_PIS = 43,83 (o
    // DESTACADO no documento). Paulo: *"não deduziu o ICMS da base do
    // PIS/COFINS"* — e o EFD-Contribuições ACEITO da mesma empresa (03/2026)
    // traz VL_BC_PIS 16.055,60 para um item de 19.580 com ICMS 3.524,40.
    // A base é a receita MENOS o ICMS (Tema 69): 6.743,10 − 1.213,76 = 5.529,34.
    // E o VALOR segue a base, senão o registro se desmente sozinho.
    // As POSIÇÕES, que é o que este bloco vigia, seguem as mesmas.
    it('e o PIS/COFINS ficam nas casas 25-36, onde o leiaute os põe', () => {
        const c = f(acha(linhasDe([saida()]), 'C170')[0]);
        expect(c[24]).toBe('01');             // 25 CST_PIS
        expect(c[25]).toBe('5529,34');        // 26 VL_BC_PIS — receita − ICMS
        expect(c[26]).toBe('0,6500');         // 27 ALIQ_PIS
        expect(c[29]).toBe('35,94');          // 30 VL_PIS = base × alíquota
        expect(c[30]).toBe('01');             // 31 CST_COFINS
        expect(c[35]).toBe('165,88');         // 36 VL_COFINS
    });

    it('o C100 leva o modelo da RÉGUA e a SÉRIE com três posições', () => {
        const c = f(acha(linhasDe([saida()]), 'C100')[0]);
        expect(c[4]).toBe('55');              //  5 COD_MOD
        expect(c[6]).toBe('001');             //  7 SER
        expect(c[20]).toBe('6743,10');        // 21 VL_BC_ICMS
        expect(c[21]).toBe('1213,76');        // 22 VL_ICMS
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 NA ENTRADA, O CST DE PIS/COFINS DO XML É O DO FORNECEDOR.
//
// A Tabela 4.3.7 é a das AQUISIÇÕES e **não tem o código 01** — ele é de
// SAÍDA ("Operação Tributável com Alíquota Básica"). O gerador copiava o CST
// do XML do fornecedor, então a compra saía com 01 e alíquota de 1,65%.
// Mesma lição do CST do ICMS 00 → 90 (18/08) e do IPI da IN RFB 932/2009.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 CST de PIS/COFINS na ENTRADA sai do REGIME, não do fornecedor', () => {
    const f = (l: string) => l.replace(/\r?\n$/, '').split('|').slice(1, -1);

    it('cumulativo: 70 (aquisição SEM direito a crédito), base e valor zero', () => {
        const c = f(acha(linhasDe([entrada()], '2'), 'C170')[0]);
        expect(c[24]).toBe('70');             // 25 CST_PIS
        expect(c[25]).toBe('0,00');           // 26 VL_BC_PIS
        expect(c[29]).toBe('0,00');           // 30 VL_PIS
        expect(c[30]).toBe('70');             // 31 CST_COFINS
    });

    it('não-cumulativo: 50 (COM direito a crédito), na alíquota de QUEM COMPRA', () => {
        const c = f(acha(linhasDe([entrada()], '1'), 'C170')[0]);
        expect(c[24]).toBe('50');
        expect(c[25]).toBe('4765,00');
        expect(c[26]).toBe('1,6500');
        expect(c[30]).toBe('50');
        expect(c[32]).toBe('7,6000');
    });

    it('o `01` do fornecedor NÃO sobrevive à entrada em nenhum dos regimes', () => {
        for (const regime of ['1', '2']) {
            const c = f(acha(linhasDe([entrada()], regime), 'C170')[0]);
            expect(c[24]).not.toBe('01');
            expect(c[30]).not.toBe('01');
        }
    });

    it('mas na SAÍDA o CST do item continua valendo — a nota é nossa', () => {
        const c = f(acha(linhasDe([saida({ itens: [{ ...saida().itens[0], cstPis: '01' }] })]), 'C170')[0]);
        expect(c[24]).toBe('01');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 COD_CONT — 01 é NÃO-cumulativo, 51 é CUMULATIVO (Tabela 4.3.5).
// O gerador cravava '01' para todo mundo: a PWR declarava 0110 COD_INC_TRIB=2,
// M200 preenchido nos campos do cumulativo, e M210 com o código do outro
// regime. O arquivo se desmentia dentro de si mesmo.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 COD_CONT do M210/M610 segue o REGIME', () => {
    const mDe = (regime: string) => buildBlocoM({
        ...dados([saida()], regime), regimeApuracao: regime,
    }) as string[];
    const cod = (ls: string[], reg: string) =>
        ls.find((l) => l.startsWith(`|${reg}|`))!.split('|')[2];

    it('cumulativo → 51, como no arquivo aceito da própria PWR', () => {
        expect(cod(mDe('2'), 'M210')).toBe('51');
        expect(cod(mDe('2'), 'M610')).toBe('51');
    });

    it('não-cumulativo → 01', () => {
        expect(cod(mDe('1'), 'M210')).toBe('01');
        expect(cod(mDe('1'), 'M610')).toBe('01');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O C100 DESTE ARQUIVO LIA O PARTICIPANTE SÓ NA FORMA ANINHADA
//
// Varredura dos leitores de documento, 21/08. A régua monta `.cnpjCpf` e o
// importer principal grava ACHATADO (`cnpjEmit`/`cnpjDest`) — nenhuma das duas
// era lida em toda nota capturada automaticamente, e o COD_PART saía VAZIO. É
// o defeito de 17/08 (37 A100 da MANTOAN sem participante) vivo um bloco
// adiante, no arquivo que a PWR ainda tem de regerar.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 C100 — participante e emissão pelas réguas da casa', () => {
    /** Como o importer principal grava: sem `emitente`, tudo achatado. */
    const entradaCapturada = (over: any = {}) => {
        const { emitente, ...resto } = entrada();
        return {
            ...resto,
            cnpjEmit: '02235305000108', xNomeEmit: 'GLOBAL COMPANY', ufEmit: 'MG',
            ...over,
        };
    };

    const c100 = (nota: any) => acha(linhasDe([nota]), 'C100')[0].split('|');

    it('nota capturada (forma ACHATADA) sai com COD_PART preenchido', () => {
        expect(c100(entradaCapturada())[4]).toBe('02235305000108');
    });

    it('a forma aninhada continua funcionando', () => {
        expect(c100(entrada())[4]).toBe('02235305000108');
    });

    it('nota PRÓPRIA de entrada é emissão própria (IND_EMIT 0) e leva a CONTRAPARTE', () => {
        // Compra de produtor rural PF (art. 136): a empresa emite a nota da
        // própria entrada, então ela é a emitente e o produtor é o destinatário.
        const propria = {
            ...entrada(), tpNF: '0',
            emitente: { cnpjCpf: '31947349000169', nome: 'PWR' },
            destinatario: { cnpjCpf: '12345678901', nome: 'PRODUTOR RURAL' },
        };
        const campos = c100(propria);
        expect(campos[2]).toBe('0');              // IND_OPER: entrada
        expect(campos[3]).toBe('0');              // IND_EMIT: emissão PRÓPRIA
        expect(campos[4]).toBe('12345678901');    // COD_PART: a contraparte
    });

    it('⚠️ e o C170 CONTINUA saindo na emissão própria — a Exceção 2 é do ICMS/IPI', () => {
        // No EFD-Contribuições o C170 é quem carrega o detalhe de PIS/COFINS do
        // item, e o arquivo ACEITO da PWR tem C170 nas notas próprias. Portar a
        // regra do outro arquivo apagaria a apuração.
        const propria = {
            ...entrada(), tpNF: '0',
            emitente: { cnpjCpf: '31947349000169', nome: 'PWR' },
            destinatario: { cnpjCpf: '12345678901', nome: 'PRODUTOR' },
        };
        expect(acha(linhasDe([propria]), 'C170').length).toBe(1);
    });
});
