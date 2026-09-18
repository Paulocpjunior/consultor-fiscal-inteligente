// ============================================================================
// DIFAL DE SAÍDA — EC 87/2015 (C101 + E300/E310/E316)
// ----------------------------------------------------------------------------
// 18/09, Paulo, J.N. VINATEX · 08/2026: *"como podemos fazer este ajuste
// baseado no que tínhamos na sage, a VINATEX tem DIFERENCIAL DE ALÍQUOTA NAS
// SAÍDAS, precisa ajustar isso também, que vai no SPED"*.
//
// O relatório do e-Fiscal que ele mandou ("Saídas/Prestações com Débito de
// DIFAL/FCP — Detalhamento das Notas") lista venda a venda por UF de destino,
// e a tela de apuração dele traz, para a BAHIA, `01 Saídas/Prestações com
// Débito Diferencial Aliq. = 323,29` e `12 Valor recolhido/recolher = 323,29`.
//
// 🚨 O CFI DECLARAVA **NADA**: nem C101, nem E300/E310/E316 — e o pior é que
// **o PVA não acusa registro ausente**. O arquivo era ACEITO afirmando que a
// empresa não deve diferencial nenhum. É a ausência PLAUSÍVEL, na forma mais
// cara: livro a MENOS que nenhum validador denuncia.
//
// ⚠️ OS NÚMEROS SÃO OS DO RELATÓRIO REAL; os CNPJs são FICTÍCIOS (dado de
// cliente não entra no repositório).
// ============================================================================
import {
    difalDoDocumento,
    documentoLevaC101,
    camposDoC101,
    agruparDifalPorUf,
    apurarDifalDaUf,
    montarLinhasDifalBlocoE,
    avisoDifalNaoCapturado,
} from '../sefaz-backend/difal-ec87-saida.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoC } from '../sefaz-backend/sped-fiscal-blocoC.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoE } from '../sefaz-backend/sped-fiscal-blocoE.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

const CNPJ_EMPRESA = '11222333000181';   // FICTÍCIO

/** Uma venda interestadual a consumidor final não contribuinte. */
const venda = (p: {
    numero: string; uf: string; icmsUfDest: number; fcp?: number;
    icmsUfRemet?: number; status?: string; cfop?: string; noTotal?: boolean;
}) => {
    const grupo = {
        vBCUFDest: 1000,
        pICMSUFDest: 18,
        pICMSInter: 7,
        pICMSInterPart: 100,
        vFCPUFDest: p.fcp ?? 0,
        vICMSUFDest: p.icmsUfDest,
        vICMSUFRemet: p.icmsUfRemet ?? 0,
    };
    return {
        id: `doc-${p.numero}`,
        chave: `3526${p.numero.padStart(40, '0')}`,
        numero: p.numero,
        serie: '010',
        modelo: '55',
        direcao: 'saida',
        tpNF: '1',
        status: p.status || 'autorizado',
        empresaCnpj: CNPJ_EMPRESA,
        cnpjEmit: CNPJ_EMPRESA,
        xNomeEmit: 'EMPRESA TESTE LTDA',
        cnpjDest: '99888777000166',
        xNomeDest: 'CONSUMIDOR FINAL',
        ufDest: p.uf,
        codMunDest: '2927408',
        dhEmi: '2026-08-14T10:00:00-03:00',
        itens: [{
            nItem: '1', cProd: 'TEC-1', xProd: 'TECIDO', ncm: '52081100',
            cfop: p.cfop || '6108', uCom: 'MT', qCom: 10, vUnCom: 100, vProd: 1000,
            vBC: 1000, aliqIcms: 7, vICMS: 70, cst: '000', orig: '0',
            vIPI: 0, vPIS: 0, vCOFINS: 0,
            ...(p.noTotal ? {} : grupo),
        }],
        totais: {
            vProd: 1000, vNF: 1000, vBC: 1000, vICMS: 70, vDesc: 0,
            vST: 0, vFCPST: 0, vIPI: 0, vFrete: 0, vSeg: 0, vOutro: 0,
            ...(p.noTotal
                ? { vICMSUFDest: p.icmsUfDest, vFCPUFDest: p.fcp ?? 0, vICMSUFRemet: p.icmsUfRemet ?? 0 }
                : {}),
        },
    };
};

describe('difalDoDocumento — o número vem da NOTA, nunca de uma conta nova', () => {
    it('soma o grupo ICMSUFDest dos ITENS', () => {
        const d = difalDoDocumento(venda({ numero: '11876', uf: 'BA', icmsUfDest: 323.29, fcp: 44.54 }));
        expect(d.vIcmsUfDest).toBe(323.29);
        expect(d.vFcpUfDest).toBe(44.54);
        expect(d.temDifal).toBe(true);
        expect(d.origem).toBe('item');
    });

    it('cai no TOTAL só quando NENHUM item traz o grupo — a nota capturada antes de 18/09', () => {
        const d = difalDoDocumento(venda({ numero: '12377', uf: 'CE', icmsUfDest: 162.06, noTotal: true }));
        expect(d.vIcmsUfDest).toBe(162.06);
        expect(d.origem).toBe('total');
    });

    it('documento sem o grupo em lugar nenhum NÃO vira zero declarado', () => {
        const nota = venda({ numero: '1', uf: 'MG', icmsUfDest: 0, noTotal: true });
        delete (nota.totais as any).vICMSUFDest;
        delete (nota.totais as any).vFCPUFDest;
        delete (nota.totais as any).vICMSUFRemet;
        const d = difalDoDocumento(nota);
        expect(d.temDifal).toBe(false);
        expect(d.origem).toBeNull();
    });

    it('soma os itens que declaram e ignora os que não têm — nota mista', () => {
        const nota = venda({ numero: '2', uf: 'MG', icmsUfDest: 100 });
        nota.itens.push({ ...nota.itens[0], nItem: '2', vICMSUFDest: undefined } as any);
        nota.itens.push({ ...nota.itens[0], nItem: '3', vICMSUFDest: 107.22 } as any);
        expect(difalDoDocumento(nota).vIcmsUfDest).toBe(207.22);
    });
});

describe('documentoLevaC101 — só NF-e de SAÍDA com DIFAL declarado', () => {
    it('a venda interestadual a não contribuinte leva', () => {
        expect(documentoLevaC101(venda({ numero: '1', uf: 'BA', icmsUfDest: 323.29 }))).toBe(true);
    });

    it('venda SEM DIFAL não leva — o registro não existe para operação normal', () => {
        const nota = venda({ numero: '2', uf: 'BA', icmsUfDest: 0, noTotal: true });
        delete (nota.totais as any).vICMSUFDest;
        delete (nota.totais as any).vFCPUFDest;
        delete (nota.totais as any).vICMSUFRemet;
        expect(documentoLevaC101(nota)).toBe(false);
    });

    it('ENTRADA não leva — o C101 de entrada é devolução, e o app não a monta', () => {
        const nota = { ...venda({ numero: '3', uf: 'BA', icmsUfDest: 100 }), direcao: 'entrada', tpNF: '0' };
        expect(documentoLevaC101(nota)).toBe(false);
    });

    it('os três campos saem na ORDEM do leiaute — FCP, destino, remetente', () => {
        const c = camposDoC101(venda({ numero: '4', uf: 'BA', icmsUfDest: 323.29, fcp: 44.54 }));
        expect(c).toEqual(['C101', 44.54, 323.29, 0]);
    });
});

describe('agruparDifalPorUf — cada UF é uma guia para OUTRO estado', () => {
    // Os números são os do relatório do e-Fiscal da VINATEX · 08/2026.
    const notas = [
        venda({ numero: '11876', uf: 'BA', icmsUfDest: 323.29, fcp: 44.54 }),
        venda({ numero: '12377', uf: 'CE', icmsUfDest: 162.06 }),
        venda({ numero: '11192', uf: 'MG', icmsUfDest: 207.22 }),
        venda({ numero: '11195', uf: 'MG', icmsUfDest: 207.22 }),
        venda({ numero: '11266', uf: 'MG', icmsUfDest: 391.49 }),
        venda({ numero: '11902', uf: 'MG', icmsUfDest: 224.99 }),
        venda({ numero: '12505', uf: 'MG', icmsUfDest: 251.40 }),
        venda({ numero: '12554', uf: 'MG', icmsUfDest: 146.67 }),
        venda({ numero: '11416', uf: 'MS', icmsUfDest: 149.44 }),
        venda({ numero: '11417', uf: 'MS', icmsUfDest: 11.40 }),
    ];

    it('fecha centavo a centavo com o relatório do e-Fiscal, UF por UF', () => {
        const { grupos } = agruparDifalPorUf(notas, 'SP');
        const porUf = Object.fromEntries(grupos.map((g: any) => [g.uf, g.difal]));
        expect(porUf.BA).toBe(323.29);
        expect(porUf.CE).toBe(162.06);
        expect(porUf.MG).toBe(1428.99);   // o "Total" da seção MINAS GERAIS
        expect(porUf.MS).toBe(160.84);    // o "Total" da seção MATO GROSSO DO SUL
        expect(grupos.find((g: any) => g.uf === 'BA')?.fcp).toBe(44.54);
    });

    it('CANCELADA fica de fora — ela não gera débito nenhum', () => {
        const comCancelada = [...notas, venda({ numero: '99', uf: 'BA', icmsUfDest: 1000, status: 'cancelado' })];
        const { grupos } = agruparDifalPorUf(comCancelada, 'SP');
        expect(grupos.find((g: any) => g.uf === 'BA')?.difal).toBe(323.29);
    });

    it('SEM UF legível NÃO cai na UF da empresa — sai NOMEADA', () => {
        const semUf: any = venda({ numero: '77', uf: '', icmsUfDest: 500 });
        delete semUf.ufDest;
        const r = agruparDifalPorUf([...notas, semUf], 'SP');
        expect(r.semUf).toContain('77');
        expect(r.grupos.some((g: any) => g.uf === 'SP')).toBe(false);
    });

    it('destinatário na PRÓPRIA UF sai NOMEADO — operação interna não tem DIFAL da EC 87/15', () => {
        const interna = venda({ numero: '88', uf: 'SP', icmsUfDest: 50 });
        const r = agruparDifalPorUf([...notas, interna], 'SP');
        expect(r.mesmaUf).toContain('88');
        expect(r.grupos.some((g: any) => g.uf === 'SP')).toBe(false);
    });

    it('parte do REMETENTE > 0 sai nomeada — desde 2019 a partilha é 100% destino', () => {
        const comRemet = venda({ numero: '66', uf: 'BA', icmsUfDest: 100, icmsUfRemet: 40 });
        expect(agruparDifalPorUf([comRemet], 'SP').comParteRemetente).toContain('66');
    });
});

describe('apurarDifalDaUf — as fórmulas são LITERAIS do Guia 3.2.3', () => {
    it('só débito: o que se apura é o que se recolhe (o caso da BAHIA)', () => {
        const ap = apurarDifalDaUf({ uf: 'BA', difal: 323.29, fcp: 44.54 });
        expect(ap.totDebitosDifal).toBe(323.29);
        expect(ap.sldDevAntDifal).toBe(323.29);
        expect(ap.recolDifal).toBe(323.29);          // linha 12 do relatório dele
        expect(ap.sldCredTranspDifal).toBe(0);
        expect(ap.totDebFcp).toBe(44.54);
        expect(ap.recolFcp).toBe(44.54);
        expect(ap.aRecolher).toBe(367.83);           // é o que o E316 discrimina
    });

    it('saldo credor anterior ABATE, e o que sobra vira saldo a transportar', () => {
        const ap = apurarDifalDaUf({ uf: 'MG', difal: 100, saldoCredorAnteriorDifal: 250 });
        expect(ap.sldDevAntDifal).toBe(0);
        expect(ap.recolDifal).toBe(0);
        expect(ap.sldCredTranspDifal).toBe(150);
    });

    it('dedução só abate saldo DEVEDOR — o excedente NÃO vira crédito calado', () => {
        const ap = apurarDifalDaUf({ uf: 'BA', difal: 100, ajustes: { deducoesDifal: 300 } });
        expect(ap.recolDifal).toBe(0);
        expect(ap.deducoesExcedentes).toBe(200);
    });
});

describe('o bloco C emite o C101 na ORDEM do leiaute', () => {
    const dados = () => ({
        empresa: { cnpj: CNPJ_EMPRESA, razaoSocial: 'EMPRESA TESTE LTDA', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
        notas: [venda({ numero: '11876', uf: 'BA', icmsUfDest: 323.29, fcp: 44.54 })],
        competenciaInicio: '2026-08',
        competenciaFim: '2026-08',
        warnings: [] as string[],
    });

    it('a linha sai com os três valores e ANTES do C170/C190', () => {
        const linhas = buildBlocoC(dados()).map((x: unknown) => String(x));
        const c101 = linhas.find((l: string) => l.startsWith('|C101|'));
        expect(c101).toBe('|C101|44,54|323,29|0,00|\r\n');
        const iC100 = linhas.findIndex((l: string) => l.startsWith('|C100|'));
        const iC101 = linhas.findIndex((l: string) => l.startsWith('|C101|'));
        const iC190 = linhas.findIndex((l: string) => l.startsWith('|C190|'));
        expect(iC100).toBeLessThan(iC101);
        expect(iC101).toBeLessThan(iC190);
    });

    it('CANCELADA sai só com o C100 — sem C101', () => {
        const d = dados();
        d.notas = [venda({ numero: '99', uf: 'BA', icmsUfDest: 323.29, status: 'cancelado' })];
        const linhas = buildBlocoC(d).map((x: unknown) => String(x));
        expect(linhas.some((l: string) => l.startsWith('|C101|'))).toBe(false);
    });

    it('venda SEM DIFAL não ganha C101 — registro não nasce em operação normal', () => {
        const d = dados();
        const nota: any = venda({ numero: '5', uf: 'BA', icmsUfDest: 0, noTotal: true });
        delete nota.totais.vICMSUFDest;
        delete nota.totais.vFCPUFDest;
        delete nota.totais.vICMSUFRemet;
        d.notas = [nota];
        expect(buildBlocoC(d).map((x: unknown) => String(x)).some((l: string) => l.startsWith('|C101|'))).toBe(false);
    });
});

describe('o bloco E emite E300/E310/E316 por UF de DESTINO', () => {
    const dados = (extra: any = {}) => ({
        empresa: { cnpj: CNPJ_EMPRESA, razaoSocial: 'EMPRESA TESTE LTDA', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
        notas: [
            venda({ numero: '11876', uf: 'BA', icmsUfDest: 323.29, fcp: 44.54 }),
            venda({ numero: '12377', uf: 'CE', icmsUfDest: 162.06 }),
        ],
        competenciaInicio: '2026-08',
        competenciaFim: '2026-08',
        warnings: [] as string[],
        ...extra,
    });

    it('um E300 por UF, em ordem, com o período da escrituração', () => {
        const linhas = buildBlocoE(dados()).map((x: unknown) => String(x));
        const e300 = linhas.filter((l: string) => l.startsWith('|E300|'));
        expect(e300).toEqual([
            '|E300|BA|01082026|31082026|\r\n',
            '|E300|CE|01082026|31082026|\r\n',
        ]);
    });

    it('o E310 declara o débito que as notas trazem e fecha a apuração', () => {
        const linhas = buildBlocoE(dados()).map((x: unknown) => String(x));
        const e310 = linhas.filter((l: string) => l.startsWith('|E310|'));
        expect(e310).toHaveLength(2);
        // 🚨 A POSIÇÃO SE LÊ CONTANDO (29/08). A primeira versão deste módulo
        // usou a tabela do E310 **REVOGADO** (válido até 31/12/2016), que
        // INTERCALA o FCP no DIFAL — e o `VL_TOT_DEB_FCP` caiu na casa do
        // `VL_TOT_CREDITOS_DIFAL`: o FCP declarado como CRÉDITO. Foi este
        // teste que pegou, porque ele confere CAMPO A CAMPO.
        // A ordem certa (2017+): DIFAL 03-12, depois FCP 13-22.
        const ba = e310[0].split('|');
        expect(ba[2]).toBe('1');            // 02 IND_MOV_FCP_DIFAL
        expect(ba[4]).toBe('323,29');       // 04 VL_TOT_DEBITOS_DIFAL
        expect(ba[6]).toBe('0,00');         // 06 VL_TOT_CREDITOS_DIFAL (não é FCP!)
        expect(ba[10]).toBe('323,29');      // 10 VL_RECOL_DIFAL
        expect(ba[14]).toBe('44,54');       // 14 VL_TOT_DEB_FCP
        expect(ba[20]).toBe('44,54');       // 20 VL_RECOL_FCP
        expect(ba).toHaveLength(24);        // '' + REG + 22 campos + ''
    });

    it('a ORDEM do bloco é a do leiaute: E300 DEPOIS do E250 e ANTES do E500', () => {
        const d = dados();
        (d.empresa.dadosFiscais as any).contribuinteIpi = 'sim';
        d.notas[0].itens[0].vIPI = 10;
        const linhas = buildBlocoE(d).map((x: unknown) => String(x));
        const iE300 = linhas.findIndex((l: string) => l.startsWith('|E300|'));
        const iE500 = linhas.findIndex((l: string) => l.startsWith('|E500|'));
        const iE110 = linhas.findIndex((l: string) => l.startsWith('|E110|'));
        expect(iE110).toBeLessThan(iE300);
        if (iE500 >= 0) expect(iE300).toBeLessThan(iE500);
    });

    it('SEM o código de receita da UF o E316 NÃO sai, e a falta vai DITA', () => {
        const d = dados();
        const linhas = buildBlocoE(d).map((x: unknown) => String(x));
        expect(linhas.some((l: string) => l.startsWith('|E316|'))).toBe(false);
        expect(d.warnings.join(' ')).toMatch(/E316 NÃO saiu para BA/);
        expect(d.warnings.join(' ')).toMatch(/Ajustes E111/);
    });

    it('COM o cadastro, o E316 sai com o valor que o E310 manda recolher', () => {
        const d = dados({
            obrigacoesDifalEc87PorUf: { BA: { dtVcto: '15092026', codRec: '12345' } },
        });
        const linhas = buildBlocoE(d).map((x: unknown) => String(x));
        const e316 = linhas.filter((l: string) => l.startsWith('|E316|'));
        expect(e316).toHaveLength(1);
        const f = e316[0].split('|');
        expect(f[2]).toBe('000');           // COD_OR
        expect(f[3]).toBe('367,83');        // VL_OR = 323,29 + 44,54
        expect(f[4]).toBe('15092026');      // DT_VCTO
        expect(f[5]).toBe('12345');         // COD_REC
        expect(f[10]).toBe('082026');       // MES_REF
    });

    it('empresa SEM venda a não contribuinte não ganha bloco nenhum — nasce MUDO', () => {
        const d = dados();
        const nota: any = venda({ numero: '1', uf: 'BA', icmsUfDest: 0, noTotal: true });
        delete nota.totais.vICMSUFDest;
        delete nota.totais.vFCPUFDest;
        delete nota.totais.vICMSUFRemet;
        nota.itens[0].cfop = '6102';
        d.notas = [nota];
        const linhas = buildBlocoE(d).map((x: unknown) => String(x));
        expect(linhas.some((l: string) => l.startsWith('|E300|'))).toBe(false);
        expect(d.warnings.join(' ')).not.toMatch(/DIFAL EC 87\/15/);
    });
});

describe('o SILÊNCIO é o defeito caro — a nota capturada antes de 18/09', () => {
    it('venda com CFOP 6108 sem o grupo ICMSUFDest sai DITA, com a ação', () => {
        const nota: any = venda({ numero: '12188', uf: 'BA', icmsUfDest: 0, noTotal: true });
        delete nota.totais.vICMSUFDest;
        delete nota.totais.vFCPUFDest;
        delete nota.totais.vICMSUFRemet;
        const aviso = avisoDifalNaoCapturado([nota], 'SP');
        expect(aviso).toMatch(/12188/);
        expect(aviso).toMatch(/♻️ Reler itens dos XMLs/);
        expect(aviso).toMatch(/o PVA aceita assim/);
    });

    it('venda que JÁ traz o grupo não vira alarme', () => {
        expect(avisoDifalNaoCapturado([venda({ numero: '1', uf: 'BA', icmsUfDest: 100 })], 'SP')).toBeNull();
    });

    it('venda interna (mesma UF) não vira alarme — não há DIFAL a declarar', () => {
        const nota: any = venda({ numero: '2', uf: 'SP', icmsUfDest: 0, noTotal: true });
        delete nota.totais.vICMSUFDest;
        delete nota.totais.vFCPUFDest;
        delete nota.totais.vICMSUFRemet;
        expect(avisoDifalNaoCapturado([nota], 'SP')).toBeNull();
    });
});

describe('a prevalidação nasce VERDE sobre o gerador e ACUSA o arquivo torto', () => {
    const arquivoReal = () => {
        const dados: any = {
            empresa: { cnpj: CNPJ_EMPRESA, razaoSocial: 'EMPRESA TESTE LTDA', _regime: 'lucro', dadosFiscais: { uf: 'SP' } },
            notas: [venda({ numero: '11876', uf: 'BA', icmsUfDest: 323.29, fcp: 44.54 })],
            competenciaInicio: '2026-08',
            competenciaFim: '2026-08',
            warnings: [],
            obrigacoesDifalEc87PorUf: { BA: { dtVcto: '15092026', codRec: '12345' } },
        };
        return [...buildBlocoC(dados), ...buildBlocoE(dados)].map((x: unknown) => String(x));
    };

    it('o arquivo que o gerador produz não acusa nada de DIFAL', () => {
        const { erros } = prevalidarSpedFiscal(arquivoReal(), {});
        expect(erros.filter((e: any) => /difal|e310|e316|e300/.test(e.regra))).toEqual([]);
    });

    it('C101 sem E300 acusa — é a ausência que o PVA NÃO pega', () => {
        const linhas = arquivoReal().filter((l: string) => !l.startsWith('|E300|') && !l.startsWith('|E310|') && !l.startsWith('|E316|'));
        const { erros } = prevalidarSpedFiscal(linhas, {});
        const e = erros.find((x: any) => x.regra === 'difal-ec87-sem-e300');
        expect(e).toBeDefined();
        expect(e!.mensagem).toMatch(/323,29/);
    });

    it('E310 que não fecha consigo mesmo acusa o CAMPO', () => {
        // Campo 10 (VL_RECOL_DIFAL) adulterado: a fórmula do Guia dá 323,29.
        const forcado = arquivoReal().map((l: string) => (l.startsWith('|E310|')
            ? l.split('|').map((c, i) => (i === 10 ? '111,11' : c)).join('|')
            : l));
        const { erros } = prevalidarSpedFiscal(forcado, {});
        expect(erros.some((x: any) => x.regra === 'e310-nao-fecha' && /VL_RECOL_DIFAL/.test(x.campo))).toBe(true);
    });

    it('E316 que não bate com o E310 acusa', () => {
        const linhas = arquivoReal().map((l: string) => (l.startsWith('|E316|')
            ? l.split('|').map((c, i) => (i === 3 ? '1,00' : c)).join('|')
            : l));
        const { erros } = prevalidarSpedFiscal(linhas, {});
        const e = erros.find((x: any) => x.regra === 'e316-nao-bate-e310');
        expect(e).toBeDefined();
        expect(e!.mensagem).toMatch(/367,83/);
    });
});
