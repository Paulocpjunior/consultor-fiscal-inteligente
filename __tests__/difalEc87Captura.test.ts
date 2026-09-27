// ============================================================================
// PARIDADE DOS DOIS PARSERS NO GRUPO <ICMSUFDest> (DIFAL de saída, EC 87/15)
// ----------------------------------------------------------------------------
// 📌 "PARIDADE OBRIGATÓRIA ENTRE OS DOIS PARSERS SE PROVA CAMPO A CAMPO, NO
// TESTE, COM O MESMO XML NOS DOIS" — a regra de 12/09 (caso ELS: o importer do
// backend gravava frete/seguro/outras por item desde 04/08 e o do navegador
// não, e o VL_OPR do C190 saía a MENOR em toda nota importada à mão).
//
// Aqui os dois estavam igualmente CEGOS: nenhum lia o grupo, e o DIFAL de saída
// — que já vem calculado na nota que a própria empresa emitiu — era descartado.
// Um arquivo sem E300/E310 é ACEITO pelo PVA (ele não acusa registro ausente),
// declarando que a empresa não deve diferencial nenhum.
//
// ⚠️ Este teste lê o CÓDIGO, não roda o parser do navegador: ele importa
// `pdfjs`/DOM e não carrega no jest. A varredura é estreita — ela casa a
// ATRIBUIÇÃO de cada campo, que é o que diverge quando um lado aprende e o
// outro não.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const backend = ler('sefaz-backend/xml-importer.js');
const navegador = ler('services/xmlParserService.ts');

/** Os nove campos do grupo `ICMSUFDest` da NF-e (leiaute 4.00). */
const CAMPOS_DO_GRUPO = [
    'vBCUFDest', 'vBCFCPUFDest', 'pFCPUFDest', 'pICMSUFDest',
    'pICMSInter', 'pICMSInterPart', 'vFCPUFDest', 'vICMSUFDest', 'vICMSUFRemet',
];

describe('os DOIS parsers leem o grupo ICMSUFDest — campo a campo', () => {
    it.each(CAMPOS_DO_GRUPO)('o backend grava %s no item', (campo) => {
        expect(backend).toMatch(new RegExp(`${campo}:\\s*difalOuNull\\('${campo}'\\)`));
    });

    it.each(CAMPOS_DO_GRUPO)('o navegador grava %s no item', (campo) => {
        expect(navegador).toMatch(new RegExp(`${campo}:\\s*difal\\('${campo}'\\)`));
    });

    it('os dois recortam o grupo do <det>, não de dentro do <ICMS>', () => {
        // O `ICMSUFDest` é IRMÃO do `ICMS` dentro de `<imposto>`. Procurá-lo
        // dentro do bloco do ICMS devolveria vazio em toda nota.
        expect(backend).toMatch(/pickFirstBlock\(det\.inner, 'ICMSUFDest'\)/);
        expect(navegador).toMatch(/det\.getElementsByTagName\('ICMSUFDest'\)/);
    });
});

describe('AUSENTE ≠ ZERO — o campo não existe quando a operação não tem DIFAL', () => {
    it('o backend devolve null, nunca 0', () => {
        const trecho = backend.slice(backend.indexOf('const difalOuNull'));
        expect(trecho.slice(0, 200)).toMatch(/\?\s*null\s*:\s*num\(v\)/);
    });

    it('o navegador devolve undefined, nunca 0', () => {
        const trecho = navegador.slice(navegador.indexOf('const difal = (tag: string)'));
        expect(trecho.slice(0, 260)).toMatch(/\?\s*undefined\s*:\s*num\(v\)/);
    });
});

describe('os TOTAIS levam a reserva — a nota capturada antes de 18/09', () => {
    it.each(['vFCPUFDest', 'vICMSUFDest', 'vICMSUFRemet'])('backend: %s no <ICMSTot>', (campo) => {
        expect(backend).toMatch(new RegExp(`${campo}: pickTag\\(icmsTot, '${campo}'\\) \\? num`));
    });

    it.each(['vFCPUFDest', 'vICMSUFDest', 'vICMSUFRemet'])('navegador: %s no <ICMSTot>', (campo) => {
        expect(navegador).toMatch(new RegExp(`${campo}: getTextContent\\(icmsTot, '${campo}'\\) \\? num`));
    });
});

describe('o ACERVO se recupera do XML guardado — não se pede arquivo ao cliente', () => {
    const backfill = ler('sefaz-backend/backfill-itens-fiscais.js');

    it.each(CAMPOS_DO_GRUPO)('%s está em CAMPOS_RECUPERAVEIS', (campo) => {
        const lista = backfill.slice(
            backfill.indexOf('export const CAMPOS_RECUPERAVEIS'),
            backfill.indexOf('];', backfill.indexOf('export const CAMPOS_RECUPERAVEIS')),
        );
        expect(lista).toContain(`'${campo}'`);
    });

    it('a VERSÃO da releitura subiu — senão a nota já carimbada nunca é relida', () => {
        // Sentinela é CARIMBO DE VERSÃO (13/08): campo novo em
        // CAMPOS_RECUPERAVEIS sem subir a versão é campo que nunca chega ao
        // acervo, e o ♻️ responde "já relidas" sobre a fila inteira.
        const m = backend.match(/export const VERSAO_RELEITURA_ITENS = (\d+)/);
        expect(m).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(3);
    });
});
