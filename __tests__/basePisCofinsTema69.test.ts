// ============================================================================
// 🚨 O PIS/COFINS DA INDÚSTRIA SAÍA SOBRE A BASE CHEIA — duas deduções
// faltando no MESMO campo, e as duas na direção mais cara.
//
// Paulo, 20/08 (PWR 1364 · 07/2026): *"Ele não deduziu o ICMS da base do
// PIS/COFINS e também não considerou o desconto no valor total da nota, só
// isso."* O M210 do arquivo declarava base 38.316,84 — a soma crua dos vProd
// das saídas.
//
// AS DUAS FONTES, e nenhuma é dedução minha:
//  · o EFD-Contribuições ACEITO da própria PWR (03/2026) traz
//    VL_BC_PIS 16.055,60 para um item de 19.580,00 com ICMS 3.524,40;
//  · a DANFE da NF 7 de 07/2026 traz V. TOTAL PRODUTOS 18.741,24,
//    DESCONTO 562,24 e V. TOTAL DA NOTA 18.179,00 — e a base do ICMS é
//    justamente 18.179,00.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { receitaDoItem, baseDoItem, receitaEBaseDoDocumento, codigosReceitaM205 } from '../sefaz-backend/base-pis-cofins.js';
import { buildBlocoC_Contrib as buildBlocoC, buildBlocoM } from '../sefaz-backend/sped-contrib-blocos.js';

/** O item real da NF 7 (PWR → TERCEIRA IGREJA BATISTA, 24/07/2026). */
const ITEM_NF7 = {
    nItem: 1, cProd: '3', xProd: 'TELHA SANDUICHE', cfop: '5101', uCom: 'MT', qCom: 187.6,
    vProd: 18741.24, vDesc: 562.24, vBC: 18179.00, aliqIcms: 18, vICMS: 3272.22, cst: '00',
    aliqPIS: 0.65, aliqCOFINS: 3, vPIS: 121.82, vCOFINS: 562.24,
};

describe('a régua: receita ≠ base, e as duas ≠ vProd', () => {
    it('receita é a mercadoria MENOS o desconto incondicional', () => {
        expect(receitaDoItem(ITEM_NF7)).toBeCloseTo(18179.00, 2);
    });

    it('base é a receita MENOS o ICMS destacado (Tema 69)', () => {
        expect(baseDoItem(ITEM_NF7)).toBeCloseTo(14906.78, 2);
    });

    it('o item do arquivo ACEITO de 03/2026 reproduz o VL_BC_PIS dele', () => {
        // |C170|...|19580|0|...|19580|18|3524,4|...|01|16055,6|0,65|...
        expect(baseDoItem({ vProd: 19580, vDesc: 0, vICMS: 3524.40 })).toBeCloseTo(16055.60, 2);
    });

    it('sem ICMS destacado não se inventa exclusão — a base é a receita', () => {
        expect(baseDoItem({ vProd: 1000, vDesc: 100 })).toBeCloseTo(900, 2);
    });

    it('base nunca fica negativa', () => {
        expect(baseDoItem({ vProd: 100, vICMS: 500 })).toBe(0);
    });

    it('documento SEM itens (NFS-e do portal) tem receita = base — serviço não destaca ICMS', () => {
        const r = receitaEBaseDoDocumento({}, 2500);
        // `desconto`/`receitaBruta` entraram em 24/08 para o aviso da geração
        // dizer QUANTO foi tirado (PWR) — sem itens não há desconto a tirar.
        expect(r).toEqual({
            receita: 2500, base: 2500, icms: 0, temItens: false,
            descontoDoDocumento: 0, desconto: 0, receitaBruta: 2500,
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
const empresa = {
    _regime: 'lucro', cnpj: '31947349000169', razaoSocial: 'PWR INDUSTRIA METALURGICA LTDA',
    dadosFiscais: { uf: 'SP', codMunIBGE: '3507605' },
};
const dados = (notas: any[], warnings: string[] = []) => ({
    empresa, notas, warnings,
    competenciaInicio: '2026-07', competenciaFim: '2026-07',
    regimeApuracao: '2',   // CUMULATIVO — é o regime da PWR (0110 COD_INC_TRIB=2)
});
const NF7 = {
    id: 'nf7', chave: '35260731947349000169550010000000071369620739',
    tipo: 'NFe', tipoDoc: 'NFe', status: 'autorizado', direcao: 'saida',
    numero: '7', serie: '1', competencia: '2026-07',
    dataEmissao: '2026-07-24', dhEmi: '2026-07-24',
    destinatario: { cnpjCpf: '26767102000120', nome: 'TERCEIRA IGREJA BATISTA' },
    totais: { vNF: 18179.00, vProd: 18741.24, vDesc: 562.24, vBC: 18179.00, vICMS: 3272.22 },
    itens: [ITEM_NF7],
};
const campos = (linha: string) => linha.split('|');
const acha = (linhas: string[], reg: string) => linhas.filter((l) => l.startsWith(`|${reg}|`));
const brl = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

describe('🚨 C100 — o VL_DOC desconta (a DANFE diz 18.179,00)', () => {
    it('VL_DOC é o total da nota, não a soma dos vProd', () => {
        const c100 = acha(buildBlocoC(dados([NF7])), 'C100')[0];
        expect(brl(campos(c100)[12])).toBeCloseTo(18179.00, 2);
        expect(brl(campos(c100)[14])).toBeCloseTo(562.24, 2);   // VL_DESC
        // 🚨 O VL_MERC É BRUTO — Guia Prático da EFD-Contribuições 1.35, C170
        // campo 07: *"somente o valor das mercadorias (equivalente à quantidade
        // vezes preço unitário)"*, com a validação *"a soma de valores dos
        // registros C170 deve ser igual ao valor informado no campo VL_MERC"*.
        // ⚠️ Em 25/08 este teste chegou a exigir o LÍQUIDO, por dedução minha;
        // o Guia desta família, que chegou no mesmo dia, desmentiu.
        expect(brl(campos(c100)[16])).toBeCloseTo(18741.24, 2); // VL_MERC — bruto
        const itens = acha(buildBlocoC(dados([NF7])), 'C170')
            .reduce((soma, l) => soma + brl(campos(l)[7]), 0);
        expect(itens).toBeCloseTo(18741.24, 2);
    });

    it('e o VL_PIS do C100 continua sendo o DESTACADO no documento', () => {
        // No aceito de 03/2026 o C100 traz 127,27 (0,65% de 19.580, a mercadoria
        // cheia) enquanto o C170 traz 104,36 (a base reduzida). São fatos
        // diferentes: um é o que o emitente escreveu, o outro é o que se apura.
        const c100 = acha(buildBlocoC(dados([NF7])), 'C100')[0];
        expect(brl(campos(c100)[26])).toBeCloseTo(121.82, 2);
    });
});

describe('🚨 C170 — a base do PIS/COFINS exclui o ICMS', () => {
    const c170 = () => campos(acha(buildBlocoC(dados([NF7])), 'C170')[0]);

    it('VL_BC_PIS = 14.906,78 (18.179,00 − 3.272,22), não 18.741,24', () => {
        expect(brl(c170()[26])).toBeCloseTo(14906.78, 2);
    });

    it('e o VL_PIS segue a BASE — o registro não pode se desmentir', () => {
        const f = c170();
        expect(brl(f[30])).toBeCloseTo(14906.78 * 0.0065, 2);
        expect(brl(f[30])).toBeCloseTo(brl(f[26]) * brl(f[27]) / 100, 2);
    });

    it('o mesmo vale para a COFINS', () => {
        const f = c170();
        expect(brl(f[32])).toBeCloseTo(14906.78, 2);
        expect(brl(f[36])).toBeCloseTo(brl(f[32]) * brl(f[33]) / 100, 2);
    });
});

describe('🚨 M210/M610 — receita bruta e base são campos DIFERENTES', () => {
    const linhas = () => buildBlocoM(dados([NF7]));

    // ⚠️ VL_REC_BRT = Σ VL_ITEM dos C170 (Guia 1.35, M210 campo 03,
    // "Validação"). O desconto reduz a BASE, não a receita bruta.
    it('VL_REC_BRT traz a receita e VL_BC_CONT traz a base — não o mesmo número', () => {
        const f = campos(acha(linhas(), 'M210')[0]);
        expect(brl(f[3])).toBeCloseTo(18741.24, 2);   // VL_REC_BRT — Σ VL_ITEM
        expect(brl(f[4])).toBeCloseTo(14906.78, 2);   // VL_BC_CONT
        expect(brl(f[7])).toBeCloseTo(14906.78, 2);   // VL_BC_CONT_AJUS
        expect(brl(f[3])).not.toBeCloseTo(brl(f[4]), 2);
    });

    it('VL_CONT_APUR = base × alíquota, conferível dentro da própria linha', () => {
        const f = campos(acha(linhas(), 'M210')[0]);
        expect(brl(f[11])).toBeCloseTo(brl(f[7]) * brl(f[8]) / 100, 2);
    });

    it('e o M610 idem, com 3%', () => {
        const f = campos(acha(linhas(), 'M610')[0]);
        expect(brl(f[3])).toBeCloseTo(18741.24, 2);
        expect(brl(f[4])).toBeCloseTo(14906.78, 2);
        expect(brl(f[11])).toBeCloseTo(brl(f[7]) * brl(f[8]) / 100, 2);
    });

    it('a exclusão do ICMS vai DITA, com o número — valor que muda sozinho não se confere', () => {
        const w: string[] = [];
        buildBlocoM(dados([NF7], w));
        const aviso = w.find((x) => /Tema 69/.test(x));
        expect(aviso).toBeTruthy();
        expect(aviso).toMatch(/3272\.22|3\.272,22|3272,22/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// M205/M605 — Paulo: *"esse registro nós preenchemos manual, tem a
// possibilidade de já puxar preenchido?"*. Dá, com o código PROVADO.
// ═══════════════════════════════════════════════════════════════════════════
describe('M205/M605 — o detalhamento por código de receita sai preenchido', () => {
    it('cumulativo: NUM_CAMPO 12, PIS 810902 e COFINS 217201 (do arquivo aceito)', () => {
        const linhas = buildBlocoM(dados([NF7]));
        const m205 = campos(acha(linhas, 'M205')[0]);
        const m605 = campos(acha(linhas, 'M605')[0]);
        expect(m205[2]).toBe('12');
        expect(m205[3]).toBe('810902');
        expect(m605[2]).toBe('12');
        expect(m605[3]).toBe('217201');
    });

    it('o VL_DEBITO casa com o campo 12 do M200/M600 — é ele que o registro detalha', () => {
        const linhas = buildBlocoM(dados([NF7]));
        const m200 = campos(acha(linhas, 'M200')[0]);
        const m205 = campos(acha(linhas, 'M205')[0]);
        expect(brl(m205[4])).toBeCloseTo(brl(m200[12]), 2);
        const m600 = campos(acha(linhas, 'M600')[0]);
        const m605 = campos(acha(linhas, 'M605')[0]);
        expect(brl(m605[4])).toBeCloseTo(brl(m600[12]), 2);
    });

    it('e ele vem ANTES do M210 — o M205 é filho do M200', () => {
        const linhas = buildBlocoM(dados([NF7]));
        const iM200 = linhas.findIndex((l: string) => l.startsWith('|M200|'));
        const iM205 = linhas.findIndex((l: string) => l.startsWith('|M205|'));
        const iM210 = linhas.findIndex((l: string) => l.startsWith('|M210|'));
        expect(iM200).toBeLessThan(iM205);
        expect(iM205).toBeLessThan(iM210);
    });

    it('🚨 NÃO-CUMULATIVO NÃO SAI — o código não está provado, e a falta é DITA', () => {
        // Código de tabela oficial não se deduz: um COD_REC errado declara o
        // débito na receita errada da DCTF. Mesmo desenho do 0002 e do código 9
        // do ISS fixo.
        expect(codigosReceitaM205(true)).toBeNull();
        const w: string[] = [];
        const linhas = buildBlocoM({ ...dados([NF7], w), regimeApuracao: '1' });
        expect(acha(linhas, 'M205')).toHaveLength(0);
        expect(acha(linhas, 'M605')).toHaveLength(0);
        expect(w.some((x) => /M205\/M605/.test(x) && /não está provado/.test(x))).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O DESCONTO CHEGA EM DUAS FORMAS — 11ª vez da mesma armadilha.
//
// Paulo, 20/08, com o M210 do PVA na tela: *"apenas ajustar o desconto do VALOR
// DA RECEITA, ai mata essa pendência, valor correto tem que ser R$ 37.754,60"*.
//
// A NF-e traz `<prod><vDesc>` POR ITEM, mas há emissor que só preenche o
// `<ICMSTot><vDesc>` do documento — e o importer guarda as duas casas. Quem lê
// uma só vê a ausência PLAUSÍVEL ("esta nota não tem desconto"), que é
// indistinguível do caso normal; aqui o efeito é declarar receita a MAIOR.
//
// Os números são os das 5 saídas da PWR 07/2026: receita 37.754,60 e base
// 30.958,77 (o ICMS excluído soma 6.795,83).
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 desconto no ITEM × só no TOTAL — as duas formas dão o mesmo número', () => {
    /** As quatro saídas sem desconto + a NF 7, que é a que tem. */
    const OUTRAS = [
        { direcao: 'saida', itens: [{ vProd: 6743.10, vICMS: 1213.76 }, { vProd: 1819.44, vICMS: 327.50 }] },
        { direcao: 'saida', itens: [{ vProd: 2105.60, vICMS: 379.01 }] },
        { direcao: 'saida', itens: [{ vProd: 4485.51, vICMS: 807.39 }] },
        { direcao: 'saida', itens: [{ vProd: 4421.95, vICMS: 795.95 }] },
    ];
    const somar = (notas: any[]) => notas.reduce((acc, nota) => {
        const r = receitaEBaseDoDocumento(nota, 0);
        return { receita: acc.receita + r.receita, base: acc.base + r.base, icms: acc.icms + r.icms };
    }, { receita: 0, base: 0, icms: 0 });

    const nf7 = (over: any) => ({ direcao: 'saida', ...over });
    const NO_ITEM = nf7({ itens: [{ vProd: 18741.24, vDesc: 562.24, vICMS: 3272.22 }] });
    const SO_NO_TOTAL = nf7({ totais: { vDesc: 562.24 }, itens: [{ vProd: 18741.24, vICMS: 3272.22 }] });
    const NOS_DOIS = nf7({ totais: { vDesc: 562.24 }, itens: [{ vProd: 18741.24, vDesc: 562.24, vICMS: 3272.22 }] });

    it('desconto no ITEM: receita 37.754,60 e base 30.958,77', () => {
        const t = somar([...OUTRAS, NO_ITEM]);
        expect(t.receita).toBeCloseTo(37754.60, 2);
        expect(t.base).toBeCloseTo(30958.77, 2);
        expect(t.icms).toBeCloseTo(6795.83, 2);
    });

    it('desconto SÓ no total do documento: o MESMO número', () => {
        const t = somar([...OUTRAS, SO_NO_TOTAL]);
        expect(t.receita).toBeCloseTo(37754.60, 2);
        expect(t.base).toBeCloseTo(30958.77, 2);
    });

    it('🚨 nas DUAS casas NÃO desconta duas vezes — o total é a soma dos itens', () => {
        const t = somar([...OUTRAS, NOS_DOIS]);
        expect(t.receita).toBeCloseTo(37754.60, 2);
        expect(t.base).toBeCloseTo(30958.77, 2);
    });

    it('o desconto do documento é NOMEADO no resultado, não some na conta', () => {
        expect(receitaEBaseDoDocumento(SO_NO_TOTAL, 0).descontoDoDocumento).toBeCloseTo(562.24, 2);
        expect(receitaEBaseDoDocumento(NO_ITEM, 0).descontoDoDocumento).toBe(0);
    });

    it('desconto do total maior que a receita não vira receita negativa', () => {
        const r = receitaEBaseDoDocumento(
            { direcao: 'saida', totais: { vDesc: 9999 }, itens: [{ vProd: 100, vICMS: 18 }] } as never, 0,
        );
        expect(r.receita).toBe(0);
        expect(r.base).toBe(0);
    });

    // 🚨 PREMISSA TROCADA EM 25/08 PELO PRÓPRIO PVA. Este teste exigia
    // `VL_REC_BRT 37.754,60` (o líquido). Sandra apagou TODA a base do PVA,
    // reimportou o arquivo com 37.754,60 e a tela continuou mostrando
    // **38.316,84 / 30.958,77** — que são Σ VL_ITEM dos C170 e Σ VL_BC_PIS do
    // NOSSO arquivo. O PVA RECALCULA o M210 e o campo 2 é a receita BRUTA.
    // A BASE — que é onde o desconto reduz tributo — continua líquida.
    it('o M210 traz a receita BRUTA e a base com desconto e ICMS fora', () => {
        const linhas = buildBlocoM(dados([...OUTRAS, SO_NO_TOTAL] as any[]));
        const m210 = campos(acha(linhas, 'M210')[0]);
        expect(brl(m210[3])).toBeCloseTo(38316.84, 2);   // VL_REC_BRT = Σ VL_ITEM
        expect(brl(m210[4])).toBeCloseTo(30958.77, 2);   // VL_BC_CONT
        // ⚠️ A diferença entre as duas é desconto + ICMS — os dois saem por
        // campo PRÓPRIO do C170 (08 e 15), como manda a Seção 12 do Guia.
        expect(brl(m210[3]) - brl(m210[4])).toBeCloseTo(562.24 + 6795.83, 2);
    });
});

// ============================================================================
// 🚨 O DESCONTO SAI DITO, NÃO SÓ APLICADO
//
// Paulo, 24/08 (PWR): *"CONTINUA COM O VALOR DA RECEITA ERRADO, TEM QUE TIRAR
// O DESCONTO — e olha que só tem 1 nota, tem empresa que tem MUITOS
// descontos"*, com o M210 do PVA mostrando **VL_REC_BRT 38.316,84**.
//
// A régua já descontava (provado em 20/08, e este teste reproduz a linha
// aceita). O que faltava era o app **DIZER** quanto tirou: sem o número na
// tela, "a receita está errada" só se responde alguém lendo o código — e há
// empresa com desconto em quase toda nota.
//
// Números reais da PWR 07/2026: Σ vProd 38.316,84 · Σ desconto 562,24
// (a NF 7, do print do C100: 18.741,24 − 562,24 = 18.179,00) · Σ ICMS 6.795,83.
// ============================================================================
describe('🚨 PWR 07/2026 — a receita do M210 é a Σ VL_ITEM, e o desconto reduz a BASE', () => {
    const nf = (numero: number, vProd: number, vICMS: number, vDesc = 0) => ({
        numero: String(numero), direcao: 'saida', status: 'autorizado', competencia: '2026-07',
        itens: [{ vProd, vICMS }],
        totais: { vDesc, vNF: vProd - vDesc },
    });
    const dados = () => ({
        empresa: { cnpj: '00000000000191' }, regimeApuracao: '2',
        notas: [nf(7, 18741.24, 3272.22, 562.24), nf(8, 19575.60, 3523.61)],
        warnings: [] as string[],
    });

    // 🚨 A LINHA QUE O PVA MOSTRA — provada contra a tela dele (25/08).
    // Antes este teste travava `37754,60`; a base e o imposto NÃO mudaram.
    // 🚨 A LINHA QUE O PVA VALIDA — provada contra a tela dele em 25/08, e
    // agora contra o Guia 1.35 (M210 campo 03, "Validação").
    it('reproduz a linha que o PVA valida — 38.316,84 × base 30.958,77', () => {
        const l = buildBlocoM(dados()).map((x: string) => x.replace(/\r?\n$/, ''));
        expect(l.find((x: string) => x.startsWith('|M210|')))
            .toBe('|M210|51|38316,84|30958,77|||30958,77|0,6500|||201,23|||||201,23|');
    });

    // 🚨 O IMPOSTO É O MESMO — é isto que fecha o assunto. O desconto sai da
    // BASE, não da receita bruta, e é a base que paga.
    it('o desconto continua fora da BASE — o valor a recolher não muda', () => {
        const l = buildBlocoM(dados()).map((x: string) => x.replace(/\r?\n$/, ''));
        const m210 = l.find((x: string) => x.startsWith('|M210|'))!.split('|');
        expect(brl(m210[4])).toBeCloseTo(38316.84 - 562.24 - 6795.83, 2);   // = 30.958,77
        expect(brl(m210[11])).toBeCloseTo(201.23, 2);
    });

    // 🚨 O aviso deixou de repetir "tirei o desconto da receita" e passou a
    // DIZER o que a pessoa vai ver no PVA — foi a promessa de um número que a
    // tela do PVA nunca mostraria que custou cinco dias.
    it('a geração DIZ quanto tirou e ONDE o desconto reduz — a BASE', () => {
        const d = dados();
        buildBlocoM(d);
        const aviso = d.warnings.find(w => /desconto incondicional/i.test(w))!;
        expect(aviso).toBeTruthy();
        expect(aviso).toMatch(/38316\.84/);        // a bruta, de onde partiu
        expect(aviso).toMatch(/562\.24/);          // o desconto
        expect(aviso).toMatch(/30958\.77/);        // a base, que é o que paga
        expect(aviso).toMatch(/1 documento\(s\)/);
        // Aponta ONDE conferir — e o lugar é a BASE, não a receita: foi
        // procurar o número na linha errada que custou cinco dias.
        expect(aviso).toMatch(/BASE/);
        expect(aviso).toMatch(/C170/);
    });

    // ⚠️ Sem desconto nenhum o aviso NÃO aparece: alarme sobre arquivo correto
    // é o que faz a equipe parar de ler os avisos que importam.
    it('empresa sem desconto não recebe o aviso', () => {
        const d = { ...dados(), notas: [nf(8, 19575.60, 3523.61)] };
        buildBlocoM(d);
        expect(d.warnings.some(w => /DESCONTO incondicional/.test(w))).toBe(false);
    });

    // O desconto conta nas DUAS formas — a do item e a do total do documento.
    it('conta o desconto venha ele do item ou do total do documento', () => {
        const porItem = {
            ...dados(),
            notas: [{
                numero: '7', direcao: 'saida', status: 'autorizado', competencia: '2026-07',
                itens: [{ vProd: 18741.24, vICMS: 3272.22, vDesc: 562.24 }], totais: {},
            }],
            warnings: [] as string[],
        };
        buildBlocoM(porItem);
        expect(porItem.warnings.find(w => /desconto incondicional/i.test(w))).toMatch(/562\.24/);
    });
});

// ============================================================================
// 🚨 A VALIDAÇÃO OFICIAL DO VL_REC_BRT — a regra que custou cinco dias
//
// Guia Prático da EFD-Contribuições 1.35, M210 campo 03:
//
//   "Campo 03 - Preenchimento: informar o valor da receita bruta auferida no
//    período, vinculada ao respectivo COD_CONT.
//    Validação: Quando o valor do campo 02 (COD_CONT) for igual a 01, 51, 02,
//    52, 31 ou 32, o valor do campo será igual à soma dos seguintes campos …
//    VL_ITEM dos registros C170 … Em ambos os casos o valor do campo IND_OPER
//    do registro C100 deve ser igual a '1' …"
//
// Era isto o tempo todo. O arquivo da PWR declarava 37.754,60 (a receita da
// ficha, líquida do desconto) e o PVA insistia em 38.316,84 — a Σ VL_ITEM.
// Sandra apagou a base inteira do PVA e reimportou: não mudou.
// ============================================================================
// @ts-ignore — módulo JS do backend, sem tipos
import { conferirReceitaBrutaDoM210 } from '../sefaz-backend/sped-contrib-campos.js';

describe('🚨 VL_REC_BRT = Σ VL_ITEM dos C170 de saída', () => {
    const c100 = (indOper: string) => `|C100|${indOper}|0|26767102000120|55|00|001|7|3526`
        + '|24072026|24072026|18179,00|0|562,24||18741,24|9|0,00|0,00|0,00|18179,00|3272,22'
        + '|0,00|0,00|0,00|121,82|562,24|||';
    const c170 = (item: string) => `|C170|1|3|TELHA|187,60000|MT|${item}|562,24|0|000|5101|`
        + '|18179,00|18,00|3272,22|0,00|0,00|0,00|0|||0,00|0,00|0,00|01|14906,78|0,6500|||96,89'
        + '|01|14906,78|3,0000|||447,20||';
    const m210 = (rec: string) => `|M210|51|${rec}|14906,78|||14906,78|0,6500|||96,89|||||96,89|`;

    it('nasce VERDE quando o M210 traz a soma', () => {
        expect(conferirReceitaBrutaDoM210([c100('1'), c170('18741,24'), m210('18741,24')]).erros)
            .toHaveLength(0);
    });

    it('acusa o arquivo que a PWR gerou por cinco dias, com a citação do Guia', () => {
        const r = conferirReceitaBrutaDoM210([c100('1'), c170('18741,24'), m210('18179,00')]).erros;
        expect(r).toHaveLength(1);
        expect(r[0].registro).toBe('M210');
        expect(r[0].mensagem).toContain('18179.00');
        expect(r[0].mensagem).toContain('18741.24');
        expect(r[0].fonte).toContain('M210 campo 03');
        // Diz onde o desconto REALMENTE entra — senão o aviso vira o mesmo
        // vai-e-vem: a pessoa procura o desconto na linha errada.
        expect(r[0].mensagem).toMatch(/VL_DESC/);
        expect(r[0].mensagem).toMatch(/BASE/);
    });

    // ⚠️ ENTRADA NÃO ENTRA NA SOMA: a validação diz "IND_OPER do C100 igual a 1".
    it('C170 de ENTRADA fica fora da conta', () => {
        expect(conferirReceitaBrutaDoM210([
            c100('0'), c170('99999,99'), c100('1'), c170('18741,24'), m210('18741,24'),
        ]).erros).toHaveLength(0);
    });

    // ⚠️ A validação lista OUTRAS fontes na mesma soma (A170, F100, F550,
    // D300…). Havendo qualquer uma, a Σ dos C170 é um PISO — acusar ali seria
    // alarme sobre arquivo correto, que é o que faz a equipe desligar a trava.
    it('fica MUDA quando há outra fonte de receita no arquivo', () => {
        const f550 = '|F550|21811,34|01|0|21811,34|0,65|141,76|01|0|21811,34|3|654,33|||||';
        expect(conferirReceitaBrutaDoM210([c100('1'), c170('18741,24'), f550, m210('40552,58')]).erros)
            .toHaveLength(0);
    });

    // ⚠️ E só julga os COD_CONT que a validação nomeia.
    it('COD_CONT fora da lista não é julgado', () => {
        const m = '|M210|99|1,00|14906,78|||14906,78|0,6500|||96,89|||||96,89|';
        expect(conferirReceitaBrutaDoM210([c100('1'), c170('18741,24'), m]).erros).toHaveLength(0);
    });
});
