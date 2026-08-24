// ============================================================================
// 🚨 CF BANK 1109 — A TERCEIRA FONTE DE RECEITA SEM DOCUMENTO
//
// Paulo, 24/08: *"MAIS UMA EMPRESA COM PARTICULARIDADES QUE DEVEM SER GRAVADAS,
// 1109 - CF BANK, o EFD dela é pela APLICAÇÃO FINANCEIRA … e o código da
// receita dela de PIS/COFINS é diferente também"*.
//
// O arquivo de 07/2026 saiu com **M200 e M600 ZERADOS** numa instituição de
// pagamento cuja receita inteira é rendimento financeiro — a mesma classe do
// M200 zerado da MANTOAN e da AFFITTARE: o app monta o arquivo a partir dos
// DOCUMENTOS, e aqui não há nenhum.
//
// GABARITO: o EFD ASSINADO da própria empresa (06/2026), que fixa as quatro
// particularidades — alíquotas 0,65%/4%, CST 02, COD_CONT 02 e os códigos de
// receita 457401/798701 com NUM_CAMPO 08.
//
// 📌 E as alíquotas NÃO eram novidade: o `lucroService` (que calcula a GUIA) já
// as tinha. O SPED é que não as lia — guia e arquivo declarando números
// diferentes sobre o mesmo rendimento é o defeito que esta casa mais paga.
// ============================================================================
import {
    ALIQUOTAS_APLICACAO_FINANCEIRA, CST_APLICACAO_FINANCEIRA,
    COD_CONT_APLICACAO_FINANCEIRA, CODIGOS_RECEITA_APLICACAO_FINANCEIRA,
    receitaFinanceiraDaFicha, montarReceitaFinanceira,
} from '../sefaz-backend/receita-aplicacao-financeira.js';
import { buildBlocoF, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

const CNPJ = '38406148000101';
const RECEITA = 21647.53;
const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');

describe('🚨 as alíquotas da aplicação financeira têm UM dono', () => {
    it('são as do arquivo assinado — 0,65% e 4%', () => {
        expect(ALIQUOTAS_APLICACAO_FINANCEIRA).toEqual({ pis: 0.0065, cofins: 0.04 });
    });

    // Centavo a centavo contra o assinado: 21.647,53 × 0,65% = 140,71 e × 4% = 865,90.
    it('reproduzem a contribuição do assinado', () => {
        const r = montarReceitaFinanceira({ receita: RECEITA })!;
        expect(r.pis).toBeCloseTo(140.71, 2);
        expect(r.cofins).toBeCloseTo(865.90, 2);
        expect(r.cst).toBe('02');
    });

    // 🚨 RÉGUA ÚNICA: a ficha do Lucro (que calcula a GUIA) importa daqui.
    // Duas cópias fariam a guia e o SPED discordarem sobre o mesmo rendimento.
    it('a ficha do Lucro LÊ o dono, não tem cópia', () => {
        const svc = require('fs').readFileSync('services/lucroService.ts', 'utf8');
        expect(svc).toMatch(/ALIQUOTAS_APLICACAO_FINANCEIRA/);
        // A cópia antiga era um literal — ela não pode voltar.
        expect(svc).not.toMatch(/ALIQ_PIS_APLICACAO\s*=\s*0\.0065/);
        expect(svc).not.toMatch(/ALIQ_COFINS_APLICACAO\s*=\s*0\.04/);
    });

    it('sem receita não monta nada — bloco sem dados não se inventa', () => {
        expect(montarReceitaFinanceira({ receita: 0 })).toBeNull();
    });

    // ⚠️ A armadilha das duas formas já mordeu nesta classe (AFFITTARE, 21/08).
    it('lê a receita da ficha nas duas formas', () => {
        expect(receitaFinanceiraDaFicha({ receitaFinanceira: RECEITA })).toBe(RECEITA);
        expect(receitaFinanceiraDaFicha({ receitaAplicacaoFinanceira: RECEITA })).toBe(RECEITA);
        expect(receitaFinanceiraDaFicha(null)).toBe(0);
        expect(receitaFinanceiraDaFicha({ receitaFinanceira: -5 })).toBe(0);
    });
});

describe('🚨 o F100 da receita financeira reproduz o assinado', () => {
    const dados = (extra: Record<string, unknown> = {}) => ({
        empresa: { cnpj: CNPJ }, regimeApuracao: '1',
        competencia: '2026-06', competenciaFim: '2026-06',
        notas: [], receitaAplicacaoFinanceira: RECEITA,
        // ⚠️ A conta vai INTEIRA: sem nome e nível o 0500 não sai, e aí o
        // COD_CTA também não pode sair (recusa do PVA de 24/08).
        contaContabilReceitaFinanceira: '30106030012',
        contaContabilReceitaFinanceiraNome: 'RENDIMENTOS FINANCEIROS',
        contaContabilReceitaFinanceiraNivel: '5',
        warnings: [] as string[], ...extra,
    });

    it('a linha bate campo a campo com o EFD assinado do CF BANK', () => {
        const l = buildBlocoF(dados()).map(semQuebra).find((x: string) => x.startsWith('|F100|'))!;
        const c = l.split('|');
        expect(c[2]).toBe('1');            // IND_OPER
        expect(c[3]).toBe('');             // COD_PART
        expect(c[4]).toBe('');             // COD_ITEM
        expect(c[5]).toBe('30062026');     // DT_OPER — último dia, como o assinado
        expect(c[6]).toBe('21647,53');     // VL_OPER
        expect(c[7]).toBe('02');           // CST_PIS — alíquota DIFERENCIADA
        expect(c[9]).toBe('0,65');         // ALIQ_PIS
        expect(c[10]).toBe('140,71');      // VL_PIS
        expect(c[11]).toBe('02');          // CST_COFINS
        expect(c[13]).toBe('4,00');        // ALIQ_COFINS
        expect(c[14]).toBe('865,90');      // VL_COFINS
        expect(c[17]).toBe('30106030012'); // COD_CTA
    });

    // ⚠️ A conta contábil é da EMPRESA e não se inventa. O arquivo da PEC foi
    // ACEITO com F100 sem ela, então a ausência não impede a entrega.
    it('sem conta contábil cadastrada o F100 sai com COD_CTA vazio', () => {
        const l = buildBlocoF(dados({
            contaContabilReceitaFinanceira: '',
            contaContabilReceitaFinanceiraNome: '',
            contaContabilReceitaFinanceiraNivel: '',
        }))
            .map(semQuebra).find((x: string) => x.startsWith('|F100|'))!;
        expect(l.split('|')[17]).toBe('');
    });

    it('o F010 abre uma vez só, e o F001 acompanha o que foi produzido', () => {
        const l = buildBlocoF(dados()).map(semQuebra);
        expect(l.filter((x: string) => x.startsWith('|F010|'))).toHaveLength(1);
        expect(l[0]).toBe('|F001|0|');
    });
});

describe('🚨 o bloco M declara a receita financeira sob o código dela', () => {
    const dados = (extra: Record<string, unknown> = {}) => ({
        empresa: { cnpj: CNPJ }, regimeApuracao: '1',
        competencia: '2026-06', competenciaFim: '2026-06',
        notas: [], receitaAplicacaoFinanceira: RECEITA,
        warnings: [] as string[], ...extra,
    });
    const linha = (reg: string, d = dados()) =>
        buildBlocoM(d).map(semQuebra).find((x: string) => x.startsWith(`|${reg}|`));

    it('M200/M600 deixam de sair ZERADOS', () => {
        expect(linha('M200')).toBe('|M200|140,71|0,00|0,00|140,71|0,00|0,00|140,71|0,00|0,00|0,00|0,00|140,71|');
        expect(linha('M600')).toBe('|M600|865,90|0,00|0,00|865,90|0,00|0,00|865,90|0,00|0,00|0,00|0,00|865,90|');
    });

    // 🚨 O campo 4 saía 0 CRAVADO — o registro se desmentia, dizendo que nada
    // era devido no não-cumulativo com o campo 7 (a recolher) cheio.
    it('VL_TOT_CONT_NC_DEV (campo 4) deixa de sair zerado', () => {
        expect(linha('M200')!.split('|')[5]).toBe('140,71');
        expect(linha('M600')!.split('|')[5]).toBe('865,90');
    });

    it('M210/M610 saem com COD_CONT 02 e as alíquotas diferenciadas', () => {
        expect(linha('M210')).toContain('|M210|02|21647,53|21647,53|');
        expect(linha('M210')).toContain('0,6500');
        expect(linha('M610')).toContain('|M610|02|21647,53|21647,53|');
        expect(linha('M610')).toContain('4,0000');
    });

    it('M205/M605 saem com os códigos PROVADOS no assinado', () => {
        expect(linha('M205')).toBe('|M205|08|457401|140,71|');
        expect(linha('M605')).toBe('|M605|08|798701|865,90|');
        expect(COD_CONT_APLICACAO_FINANCEIRA).toBe('02');
        expect(CST_APLICACAO_FINANCEIRA).toBe('02');
        expect(CODIGOS_RECEITA_APLICACAO_FINANCEIRA)
            .toEqual({ numCampo: '08', pis: '457401', cofins: '798701' });
    });

    // ⚠️ Empresa sem receita financeira não ganha nenhuma linha nova — os
    // quatro clientes já fechados não podem mudar de arquivo.
    it('sem receita financeira nada muda', () => {
        const d = dados({ receitaAplicacaoFinanceira: 0 });
        const l = buildBlocoM(d).map(semQuebra);
        expect(l.some((x: string) => x.startsWith('|M210|02|'))).toBe(false);
        expect(l.some((x: string) => x.startsWith('|M205|08|457401|'))).toBe(false);
        expect(buildBlocoF(d).map(semQuebra)[0]).toBe('|F001|1|');
    });
});

// ============================================================================
// 🚨 O F100 APONTAVA PARA UMA CONTA QUE O ARQUIVO NÃO DECLARAVA
//
// 2ª rodada do PVA no CF BANK (24/08), 1 erro:
//   "Código da conta analítica/grupo de contas inválido. Informar código no
//    'Registro 0500' antes de utilizá-lo."  (COD_CTA 30106030012, no F100)
//
// Mesma família do participante do 0150 e do item do 0200 órfãos. O assinado
// traz a linha que faltava: |0500|01012026|04|A|5|30106030012|RENDIMENTOS
// FINANCEIROS|||
// ============================================================================
import { montar0500ContaReceita } from '../sefaz-backend/receita-aplicacao-financeira.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBloco0Contrib } from '../sefaz-backend/sped-contrib-bloco0.js';

describe('🚨 o 0500 declara a conta que o F100 referencia', () => {
    const conta = {
        codConta: '30106030012', nomeConta: 'RENDIMENTOS FINANCEIROS',
        nivel: '5', ano: '2026',
    };

    it('reproduz a linha do assinado', () => {
        const { campos } = montar0500ContaReceita(conta) as any;
        expect(campos.dtAlt).toBe('01012026');
        expect(campos.codNatCc).toBe('04');   // contas de RESULTADO
        expect(campos.indCta).toBe('A');      // ANALÍTICA — é o que a recusa cobra
        expect(campos.nivel).toBe('5');
        expect(campos.codCta).toBe('30106030012');
        expect(campos.nomeCta).toBe('RENDIMENTOS FINANCEIROS');
    });

    // ⚠️ Nome e nível são do PLANO DE CONTAS da empresa — o app não os deduz.
    it('sem nome ou nível NÃO monta, e diz o que falta', () => {
        const r = montar0500ContaReceita({ ...conta, nomeConta: '' }) as any;
        expect(r.campos).toBeUndefined();
        expect(r.falta.join(' ')).toMatch(/NOME_CTA/);
        const r2 = montar0500ContaReceita({ ...conta, nivel: '' }) as any;
        expect(r2.falta.join(' ')).toMatch(/NIVEL/);
    });

    it('sem conta nenhuma não é assunto do 0500', () => {
        expect(montar0500ContaReceita({ codConta: '' })).toBeNull();
    });
});

describe('🚨 a coerência do COD_CTA é TUDO OU NADA', () => {
    const base = (extra: Record<string, unknown> = {}) => ({
        empresa: { cnpj: CNPJ, nome: 'CF BANK', uf: 'SP', codMunIBGE: '3550308' },
        contador: { nome: 'X', cpf: '1', crc: 'Y', email: 'a@b.c', codMunIBGE: '3550308' },
        competencia: '2026-06', competenciaInicio: '2026-06', competenciaFim: '2026-06',
        regimeApuracao: '1', notas: [], itens: [], participantes: [], unidades: [],
        receitaAplicacaoFinanceira: RECEITA,
        contaContabilReceitaFinanceira: '30106030012',
        contaContabilReceitaFinanceiraNome: 'RENDIMENTOS FINANCEIROS',
        contaContabilReceitaFinanceiraNivel: '5',
        warnings: [] as string[], ...extra,
    });

    it('cadastro completo: o 0500 sai E o F100 referencia a conta', () => {
        const d = base();
        const b0 = buildBloco0Contrib(d).map(semQuebra);
        // ⚠️ TRÊS barras no fim, não quatro — a linha é BYTE A BYTE a do
        // assinado. Foi assim que o Paulo pegou o defeito, a olho, comparando
        // os dois arquivos: *"uma está com 4 barrinhas e a outra com 3"*.
        expect(b0.find((l: string) => l.startsWith('|0500|')))
            .toBe('|0500|01012026|04|A|5|30106030012|RENDIMENTOS FINANCEIROS|||');
        const f100 = buildBlocoF(d).map(semQuebra).find((l: string) => l.startsWith('|F100|'))!;
        expect(f100.split('|')[17]).toBe('30106030012');
    });

    // 🚨 A trava que importa: sem o 0500, o F100 NÃO pode referenciar a conta —
    // órfã é exatamente a recusa que este bloco existe para evitar.
    it('cadastro incompleto: nem 0500 nem COD_CTA — e a falta é DITA', () => {
        const d = base({ contaContabilReceitaFinanceiraNivel: '' });
        const b0 = buildBloco0Contrib(d).map(semQuebra);
        expect(b0.some((l: string) => l.startsWith('|0500|'))).toBe(false);
        const f100 = buildBlocoF(d).map(semQuebra).find((l: string) => l.startsWith('|F100|'))!;
        expect(f100.split('|')[17]).toBe('');
        const aviso = (d.warnings as string[]).join(' ');
        expect(aviso).toMatch(/0500/);
        expect(aviso).toMatch(/Dados Fiscais/);
    });

    it('empresa sem conta cadastrada não ganha 0500 nem aviso', () => {
        const d = base({
            contaContabilReceitaFinanceira: '',
            contaContabilReceitaFinanceiraNome: '',
            contaContabilReceitaFinanceiraNivel: '',
        });
        expect(buildBloco0Contrib(d).some((l: string) => l.startsWith('|0500|'))).toBe(false);
        expect((d.warnings as string[]).some(w => /0500/.test(w))).toBe(false);
    });
});
