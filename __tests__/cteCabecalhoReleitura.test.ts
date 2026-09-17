// ============================================================================
// 🚚 "IMPORTOU, MAS O FRETE NÃO ESTÁ APARECENDO NA APURAÇÃO"
//
// 17/09, Paulo — EDUARDO GUERRA · EFD ICMS/IPI 08/2026, logo depois de o
// `|D001|0|` ser corrigido e o PVA passar a IMPORTAR o arquivo: o registro
// **D100 apareceu VAZIO** na tela do validador e nenhum CFOP de transporte
// saiu no Resumo por CFOP.
//
// ═══ A CAUSA É DE CAPTURA, E O CAMINHO DE VOLTA NÃO EXISTIA ═════════════════
//
// O CFOP do conhecimento mora no **CABEÇALHO** do XML (`<ide><CFOP>`), e até
// 21/08 a captura só lia o de dentro de `<prod>` — que o CT-e não tem. CT-e
// capturado antes daquela data está gravado SEM `cfop`, e `cfopDoCte` o
// descarta com razão: cravar um valor declararia a NATUREZA da operação de
// transporte no escuro.
//
// 🚨 E OS DOIS ♻️ QUE EXISTIAM NÃO ALCANÇAM O CT-e — medido:
//   · `backfill-itens-fiscais` só mexe em campos de ITEM (o CT-e não tem);
//   · `releitura-notas-vazias` devolve 'fora-do-escopo' para CT-e.
// Ou seja: o dado estava no Storage, a régua existia, e o aviso da geração
// mandava rodar um botão que não resolve — achado 18 (21/08), escrito por mim.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório.
// ============================================================================
import {
    lerCabecalhoCte, patchDoCabecalhoCte, classificarCteParaCabecalho,
    VERSAO_RELEITURA_CTE, xmlEhCte,
// @ts-expect-error — módulo .js do backend (sem tipos)
} from '../sefaz-backend/cte-cabecalho.js';
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';

const CNPJ = '11222333000181';
const EMPRESA = {
    cnpj: CNPJ, razaoSocial: 'EMPRESA TESTE LTDA',
    dadosFiscais: { uf: 'SP', codMunIBGE: '3550308' },
};

/** CT-e com ICMS destacado (CST 00). */
const XML_CTE_00 = `<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe35260844555666000177570010000000011234567890">
  <ide><cUF>35</cUF><CFOP>6353</CFOP><natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp></ide>
  <emit><CNPJ>44555666000177</CNPJ></emit>
  <vPrest><vTPrest>500.00</vTPrest></vPrest>
  <imp><ICMS><ICMS00><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS><vICMS>60.00</vICMS></ICMS00></ICMS></imp>
</infCte></CTe></cteProc>`;

/**
 * CT-e como os 34 da EDUARDO GUERRA no EFD de 05/2026 — o arquivo que o
 * e-Fiscal gerou e a Receita ACEITOU: CST 90, alíquota 0 e ICMS ZERO.
 */
const XML_CTE_90_ZERO = `<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe35260844555666000177570010000000021234567890">
  <ide><cUF>35</cUF><CFOP>6353</CFOP></ide>
  <vPrest><vTPrest>11293.64</vTPrest></vPrest>
  <imp><ICMS><ICMS90><CST>90</CST><vBC>0.00</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS90></ICMS></imp>
</infCte></CTe></cteProc>`;

/** Isento: o grupo ICMS45 traz SÓ o CST — não há base nem alíquota no XML. */
const XML_CTE_45 = `<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe3526084455566600017757001000000003123456789">
  <ide><CFOP>5353</CFOP></ide>
  <imp><ICMS><ICMS45><CST>40</CST></ICMS45></ICMS></imp>
</infCte></CTe></cteProc>`;

const XML_CTE_OUTRA_UF = `<?xml version="1.0"?><CTe><infCte>
  <ide><CFOP>6353</CFOP></ide>
  <imp><ICMS><ICMSOutraUF><CST>90</CST><vBCOutraUF>200.00</vBCOutraUF><pICMSOutraUF>7.00</pICMSOutraUF><vICMSOutraUF>14.00</vICMSOutraUF></ICMSOutraUF></ICMS></imp>
</infCte></CTe>`;

/** NF-e: o CFOP e a base moram no ITEM, e não representam o documento. */
const XML_NFE = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe35260811222333000181550010000000011234567890">
  <ide><nNF>16</nNF></ide>
  <det nItem="1"><prod><CFOP>5102</CFOP></prod>
    <imposto><ICMS><ICMS00><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS></imposto></det>
  <total><ICMSTot><vNF>100.00</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

const CTE_GRAVADO_SEM_CFOP = {
    id: 'c1', chave: '35260844555666000177570010000000011234567890',
    tipo: 'CTe', tipoDoc: 'CTe', status: 'autorizado', direcao: 'entrada',
    numero: '123', serie: '1', competencia: '2026-08',
    dataEmissao: '2026-08-10', dhEmi: '2026-08-10', valorTotal: 500,
    emitente: { cnpjCpf: '44555666000177', nome: 'TRANSPORTADORA TESTE LTDA' },
    storagePath: 'xmls/abc.xml',
};

describe('lerCabecalhoCte — o que o conhecimento DECLARA', () => {
    it('lê CFOP, CST, alíquota e ICMS do cabeçalho', () => {
        expect(lerCabecalhoCte(XML_CTE_00)).toEqual({
            cfop: '6353', cstIcms: '00', aliqIcms: 12, vBC: 500, vICMS: 60,
        });
    });

    it('lê o grupo ICMSOutraUF, cujos campos levam sufixo próprio', () => {
        expect(lerCabecalhoCte(XML_CTE_OUTRA_UF)).toEqual({
            cfop: '6353', cstIcms: '90', aliqIcms: 7, vBC: 200, vICMS: 14,
        });
    });

    // 🚨 A TRAVA QUE IMPEDE DADO DO ITEM DE OCUPAR A CASA DO DOCUMENTO: numa
    // NF-e uma busca solta por <CFOP>/<vBC> acha os do PRIMEIRO ITEM, e numa
    // nota mista isso é falso. Era assim que o importer gravava `cfop` na raiz.
    it('devolve null para NF-e — não é o cabeçalho de um CT-e', () => {
        expect(xmlEhCte(XML_NFE)).toBe(false);
        expect(lerCabecalhoCte(XML_NFE)).toBeNull();
    });

    // ⚠️ AUSENTE ≠ ZERO: o isento não tem base nem alíquota no XML, e gravar 0
    // ali seria o app afirmando o que o documento não diz.
    it('no isento (ICMS45) devolve o CST e deixa base/alíquota/ICMS em null', () => {
        expect(lerCabecalhoCte(XML_CTE_45)).toEqual({
            cfop: '5353', cstIcms: '40', aliqIcms: null, vBC: null, vICMS: null,
        });
    });

    // ✅ E o ZERO DECLARADO é fato — é o caso dos 34 CT-e do arquivo aceito.
    it('alíquota 0 DECLARADA é resposta, não ausência', () => {
        const lido = lerCabecalhoCte(XML_CTE_90_ZERO);
        expect(lido.aliqIcms).toBe(0);
        expect(lido.vICMS).toBe(0);
        expect(lido.cstIcms).toBe('90');
    });
});

describe('patchDoCabecalhoCte — backfill NÃO APAGA e NÃO SOBRESCREVE', () => {
    it('preenche o que está vazio', () => {
        const patch = patchDoCabecalhoCte(CTE_GRAVADO_SEM_CFOP, lerCabecalhoCte(XML_CTE_00));
        expect(patch).toEqual({
            cfop: '6353', cstIcms: '00', aliqIcms: 12,
            totais: { vBC: 500, vICMS: 60 },
        });
    });

    it('não toca no que já está gravado', () => {
        const jaTem = { ...CTE_GRAVADO_SEM_CFOP, cfop: '5352', cstIcms: '20', aliqIcms: 7, totais: { vBC: 9, vICMS: 1 } };
        expect(patchDoCabecalhoCte(jaTem, lerCabecalhoCte(XML_CTE_00))).toEqual({});
    });

    it('grava a alíquota ZERO declarada (zero é resposta)', () => {
        const patch = patchDoCabecalhoCte(CTE_GRAVADO_SEM_CFOP, lerCabecalhoCte(XML_CTE_90_ZERO));
        expect(patch.aliqIcms).toBe(0);
        expect(patch.totais).toEqual({ vBC: 0, vICMS: 0 });
    });

    it('no isento não inventa base nem alíquota', () => {
        const patch = patchDoCabecalhoCte(CTE_GRAVADO_SEM_CFOP, lerCabecalhoCte(XML_CTE_45));
        expect(patch).toEqual({ cfop: '5353', cstIcms: '40' });
        expect(patch).not.toHaveProperty('aliqIcms');
        expect(patch).not.toHaveProperty('totais');
    });

    it('XML que não é CT-e não produz patch nenhum', () => {
        expect(patchDoCabecalhoCte(CTE_GRAVADO_SEM_CFOP, lerCabecalhoCte(XML_NFE))).toEqual({});
    });
});

describe('classificarCteParaCabecalho — cada causa tem ação própria', () => {
    it('NF-e fica fora do escopo', () => {
        expect(classificarCteParaCabecalho({ tipo: 'NFe', tipoDoc: 'NFe' })).toBe('fora-do-escopo');
    });

    it('CT-e sem CFOP e com arquivo guardado é ALVO', () => {
        expect(classificarCteParaCabecalho(CTE_GRAVADO_SEM_CFOP)).toBe('alvo');
    });

    it('sem storagePath é buraco de CAPTURA, não de leitura', () => {
        const { storagePath, ...semArquivo } = CTE_GRAVADO_SEM_CFOP;
        expect(classificarCteParaCabecalho(semArquivo)).toBe('sem-arquivo');
    });

    it('CT-e com tudo gravado é completo', () => {
        expect(classificarCteParaCabecalho({
            ...CTE_GRAVADO_SEM_CFOP, cfop: '6353', cstIcms: '90',
            aliqIcms: 0, totais: { vBC: 0, vICMS: 0 },
        })).toBe('completo');
    });

    // 🚨 O CARIMBO É DE VERSÃO, nunca "tem campo preenchido" (13/08): a
    // condição-alvo NÃO se limpa sozinha — o CT-e isento nunca terá `vICMS`, e
    // julgar pela presença faria o backfill rebaixar o mesmo documento sempre.
    it('já relido nesta versão não volta à fila', () => {
        expect(classificarCteParaCabecalho({
            ...CTE_GRAVADO_SEM_CFOP, cabecalhoCteVersao: VERSAO_RELEITURA_CTE,
        })).toBe('ja-relido');
    });

    it('carimbo de versão ANTIGA volta à fila', () => {
        expect(classificarCteParaCabecalho({
            ...CTE_GRAVADO_SEM_CFOP, cabecalhoCteVersao: VERSAO_RELEITURA_CTE - 1,
        })).toBe('alvo');
    });
});

// ═══ A PROVA QUE VALE: o BLOCO D antes e depois do backfill ═════════════════
describe('composição — é o frete voltando ao livro que prova', () => {
    const dados = (notas: any[]) => ({ empresa: EMPRESA, notas, warnings: [] as string[] });

    it('antes: o CT-e é descartado e o bloco D sai SEM DADOS', () => {
        const d = dados([CTE_GRAVADO_SEM_CFOP]);
        const linhas = buildBlocoD(d);
        expect(linhas[0]).toContain('|D001|1|');            // SEM dados, e o D001 diz isso
        expect(linhas.some((l: string) => l.includes('|D100|'))).toBe(false);
        expect(d.warnings.join(' ')).toMatch(/CT-e ficaram FORA/i);
    });

    it('depois: com o cabeçalho relido, D100 e D190 saem e o bloco tem movimento', () => {
        const patch = patchDoCabecalhoCte(CTE_GRAVADO_SEM_CFOP, lerCabecalhoCte(XML_CTE_00));
        const d = dados([{ ...CTE_GRAVADO_SEM_CFOP, ...patch }]);
        const linhas = buildBlocoD(d);

        expect(linhas[0]).toContain('|D001|0|');
        expect(linhas.some((l: string) => l.includes('|D100|'))).toBe(true);

        const d190 = linhas.find((l: string) => l.includes('|D190|'));
        expect(d190).toBeTruthy();
        // CST com as 3 posições do SPED e a alíquota que o conhecimento declara.
        expect(d190).toContain('|D190|000|');
        expect(d190).toContain('|12,00|');
        // E o ICMS destacado volta ao livro — era 0,00 com `totais` nulo.
        expect(d190).toContain('|60,00|');
        expect(d.warnings.join(' ')).not.toMatch(/ficaram FORA/i);
    });

    // O gabarito: alíquota e ICMS ZERO são o que o arquivo ACEITO declara.
    it('CT-e com ICMS zero entra no bloco — zero declarado não é ausência', () => {
        const patch = patchDoCabecalhoCte(CTE_GRAVADO_SEM_CFOP, lerCabecalhoCte(XML_CTE_90_ZERO));
        const linhas = buildBlocoD(dados([{ ...CTE_GRAVADO_SEM_CFOP, ...patch }]));
        const d190 = linhas.find((l: string) => l.includes('|D190|'));
        expect(d190).toContain('|D190|090|');
        expect(d190).toContain('|0,00|');
    });
});

// ═══ A TRAVA CONTRA A REGRESSÃO DO ACHADO 18 ═══════════════════════════════
describe('o aviso aponta o botão que ALCANÇA o CT-e', () => {
    it('não manda rodar o ♻️ de itens, que não vê conhecimento de transporte', () => {
        const d = { empresa: EMPRESA, notas: [CTE_GRAVADO_SEM_CFOP], warnings: [] as string[] };
        buildBlocoD(d);
        const aviso = d.warnings.join(' ');
        expect(aviso).toMatch(/Reler cabeçalho dos CT-e/i);
        expect(aviso).not.toMatch(/♻️ \(reler XMLs guardados\)/i);
    });
});
