// ============================================================================
// 🐛 O PDF DO E-FISCAL PODE VIR GIRADO — e girado ele lia o EIXO ERRADO.
//
// Paulo, 17/08, urgente (CLUDE, análise de créditos de 07/2026): *"a colaboradora
// reporta este erro do CFI, porém ela analisa está correto"*. A tela mostrava
// **0 lançamentos**, R$ 0,00 em tudo, e uma "divergência" citando
// *"Valor da NF: PDF=R$ 5017.50"* — número que NÃO EXISTE no documento. O rodapé
// real do relatório é `Total 580.395,26 · 66.652,60 · 0,00 · 0,00`, com 148 notas.
//
// ═══ A CAUSA ════════════════════════════════════════════════════════════════
//
// O relatório sai em **A4 RETRATO (595×842) com `/Rotate 90`** — paisagem
// GIRADA. O parser extrai por COORDENADA X, e usava `item.transform[4]`, que é
// a coordenada do espaço do PDF, ANTES da rotação. Com /Rotate 90 aquilo é o
// eixo VERTICAL do que a pessoa vê: as janelas de coluna nunca casavam.
//
// Medido no PDF real, com a matriz do viewport aplicada, as janelas ficam
// EXATAS — e são os números deste teste:
//
//   Emissão   11,2   | Número   57,0  | Série 143,3 | CNPJ/CPF 216,1
//   Valor da NF  475,0..506,1 | Base 568,8..599,9 | Alíq. 616,6..632,1
//   Valor do ISS 691,6..707,1 | Iss Retido 780,9..796,4
//   Total (rodapé, pág. 4): "Total" em 387,2 · 580.395,26 x1=506,1
//
// ═══ POR QUE O TESTE NÃO CARREGA O PDF ══════════════════════════════════════
//
// É documento fiscal de cliente: não entra no repositório. O que entra é a
// MEDIDA — tokens sintéticos nas coordenadas reais, exercitando a função pura
// nas duas rotações. Assim a trava vale para o layout, não para um arquivo.
// ============================================================================
import { mapearTokens, ehLinhaDeTotal, type TokenPdf } from '../services/efiscalPdfGeometria';

/** Matriz que o pdf.js devolve em `getViewport({scale:1})` para cada rotação. */
const VIEWPORT_RETRATO_GIRADO_90 = [0, 1, 1, 0, 0, 0];        // medida no PDF da CLUDE
const VIEWPORT_SEM_ROTACAO = [1, 0, 0, -1, 0, 595.22];        // /Rotate 0, altura 595,22

const item = (x: number, y: number, str: string, width = 0) =>
    ({ str, width, transform: [1, 0, 0, 1, x, y] });

describe('🚨 /Rotate 90: a coluna se mede no espaço do VIEWPORT, não no do PDF', () => {
    it('o eixo TROCA — e era isso que zerava a extração inteira', () => {
        // No espaço do PDF este token está em x=104, y=475. Visualmente ele está
        // na coluna "Valor da NF" (x≈475) — o parser lia 104 e não achava nada.
        const [t] = mapearTokens([item(104, 475, '1.890,00', 31.1)], VIEWPORT_RETRATO_GIRADO_90);
        expect(Math.round(t!.x0)).toBe(475);
        expect(Math.round(t!.x1)).toBe(506);   // a janela de Valor da NF é 490..515
        expect(t!.y).toBe(104);
    });

    it('as CINCO colunas de valor caem nas janelas calibradas', () => {
        // Coordenadas do PDF real da CLUDE (espaço do PDF: x = linha, y = coluna).
        const linha = mapearTokens([
            item(104, 475.0, '1.890,00', 31.1),   // Valor da NF   → x1 506,1
            item(104, 568.8, '1.890,00', 31.1),   // Base          → x1 599,9
            item(104, 616.6, '2,90', 15.5),       // Alíquota      → x1 632,1
            item(104, 691.6, '0,00', 15.5),       // Valor do ISS  → x1 707,1
            item(104, 780.9, '0,00', 15.5),       // Iss Retido    → x1 796,4
        ], VIEWPORT_RETRATO_GIRADO_90);
        const x1 = linha.map((t: TokenPdf) => +t.x1.toFixed(1));
        expect(x1).toEqual([506.1, 599.9, 632.1, 707.1, 796.4]);
        // As janelas do parser, repetidas aqui de propósito: se alguém mexer
        // nelas, este teste diz qual coluna saiu de casa.
        expect(x1[0]).toBeGreaterThanOrEqual(490); expect(x1[0]).toBeLessThanOrEqual(515);
        expect(x1[1]).toBeGreaterThanOrEqual(590); expect(x1[1]).toBeLessThanOrEqual(610);
        expect(x1[2]).toBeGreaterThanOrEqual(625); expect(x1[2]).toBeLessThanOrEqual(645);
        expect(x1[3]).toBeGreaterThanOrEqual(698); expect(x1[3]).toBeLessThanOrEqual(715);
        expect(x1[4]).toBeGreaterThanOrEqual(788); expect(x1[4]).toBeLessThanOrEqual(802);
    });

    it('os campos de identificação também: emissão, número, série e CNPJ', () => {
        const toks = mapearTokens([
            item(104, 11.2, '01/07/2026'),
            item(104, 57.0, '0000000001'),
            item(104, 143.3, 'E'),
            item(104, 216.1, '61.292.773/0001-83'),
            item(104, 294.1, 'DW SERVICOS MEDICOS LTD'),
        ], VIEWPORT_RETRATO_GIRADO_90);
        const x0 = toks.map((t: TokenPdf) => +t.x0.toFixed(1));
        expect(x0).toEqual([11.2, 57, 143.3, 216.1, 294.1]);
        expect(x0[1]).toBeGreaterThanOrEqual(50);  expect(x0[1]).toBeLessThanOrEqual(110);   // número
        expect(x0[2]).toBeGreaterThanOrEqual(135); expect(x0[2]).toBeLessThanOrEqual(212);   // série
        expect(x0[3]).toBeGreaterThanOrEqual(205); expect(x0[3]).toBeLessThanOrEqual(295);   // CNPJ
        expect(x0[4]).toBeGreaterThanOrEqual(290); expect(x0[4]).toBeLessThanOrEqual(460);   // razão
    });
});

describe('PDF sem rotação continua lendo igual — a correção não troca um erro por outro', () => {
    it('/Rotate 0 devolve o MESMO x de antes (o eixo não muda)', () => {
        const [t] = mapearTokens([item(475, 104, '1.890,00', 31.1)], VIEWPORT_SEM_ROTACAO);
        expect(Math.round(t!.x0)).toBe(475);
        expect(Math.round(t!.x1)).toBe(506);
    });

    it('🚨 mas o Y passa a crescer PARA BAIXO — e a ordem das linhas depende disso', () => {
        // Se as linhas continuassem ordenadas por y decrescente, a linha "Total"
        // (a última do relatório) viraria a PRIMEIRA e a razão social de duas
        // linhas colaria na nota errada.
        const [topo, base] = mapearTokens(
            [item(10, 500, 'primeira linha'), item(10, 100, 'última linha')],
            VIEWPORT_SEM_ROTACAO,
        );
        expect(topo!.y).toBeLessThan(base!.y);
    });
});

describe('token vazio não entra e transform ausente não explode', () => {
    it('espaço em branco é descartado', () => {
        expect(mapearTokens([item(10, 10, '   ')], VIEWPORT_SEM_ROTACAO)).toHaveLength(0);
    });
    it('item sem transform não derruba a leitura do PDF inteiro', () => {
        const r = mapearTokens([{ str: 'x', transform: [] as any }], VIEWPORT_SEM_ROTACAO);
        expect(r).toHaveLength(1);
        expect(Number.isFinite(r[0]!.x0)).toBe(true);
    });
});

describe('🚨 o parser aplica o viewport e ordena de cima para baixo', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const fonte = readFileSync(join(__dirname, '..', 'services/efiscalPdfParserService.ts'), 'utf8');

    it('a extração passa pelo mapearTokens com a matriz do viewport', () => {
        expect(fonte).toMatch(/page\.getViewport\(\{\s*scale:\s*1\s*\}\)/);
        expect(fonte).toMatch(/mapearTokens\(content\.items[^,]*,\s*viewport\.transform/);
        // O que NÃO pode voltar: ler transform[4] cru como se fosse o x visual.
        const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(semComentarios).not.toMatch(/item\.transform\[4\]/);
    });

    it('linhas ordenadas por y CRESCENTE (viewport cresce para baixo)', () => {
        expect(fonte).toMatch(/\(a\.pagina - b\.pagina\) \|\| \(a\.y - b\.y\)/);
    });
});

describe('🚨 total que o app INVENTA é pior que total que ele não acha', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const fonte = readFileSync(join(__dirname, '..', 'services/efiscalPdfParserService.ts'), 'utf8');

    it('o rodapé se identifica pela palavra "Total", não por ser a última linha', () => {
        // A régua antiga pegava qualquer linha sem data com número numa janela,
        // e a última vencia — foi o que exibiu "PDF=R$ 5017.50" no caso CLUDE.
        expect(ehLinhaDeTotal([{ str: 'Total' }, { str: '580.395,26' }])).toBe(true);
        expect(ehLinhaDeTotal([{ str: 'Totais:' }])).toBe(true);
        // Linha de nota comum NÃO é rodapé, mesmo tendo valores nas colunas.
        expect(ehLinhaDeTotal([{ str: '01/07/2026' }, { str: '1.890,00' }])).toBe(false);
        expect(ehLinhaDeTotal([{ str: 'TOTAL PASS PARTICIPACOES' }])).toBe(false);
        expect(fonte).toMatch(/ehLinhaDeTotal\(toks\)/);
        expect(fonte).toMatch(/rodapeEncontrado = true/);
    });

    it('sem rodapé NÃO se afirma divergência, e NÃO se dá verde', () => {
        // Comparar contra zero acusaria o relatório inteiro justamente quando a
        // extração pode estar perfeita — alarme falso que aparece quando está
        // tudo certo é o que ensina a ignorar a conferência.
        expect(fonte).toMatch(/if \(rodapeEncontrado\) \{/);
        expect(fonte).toMatch(/ok: rodapeEncontrado && divergencias\.length === 0/);
        expect(fonte).toMatch(/'nao-conferido'/);
    });

    it('a tela separa os TRÊS estados — cada um tem ação diferente', () => {
        const tela = readFileSync(join(__dirname, '..', 'components/AnaliseCreditoExtrato.tsx'), 'utf8');
        expect(tela).toMatch(/situacao === 'confere'/);
        expect(tela).toMatch(/situacao === 'nao-conferido'/);
        expect(tela).toMatch(/situacao === 'divergente'/);
    });

    it('zero notas é dito como BURACO DE LEITURA, não como relatório vazio', () => {
        const tela = readFileSync(join(__dirname, '..', 'components/AnaliseCreditoExtrato.tsx'), 'utf8');
        expect(tela).toMatch(/parsed\.notas\.length === 0/);
        expect(tela).toMatch(/não refaça a conta à mão/i);
    });

    it('🚨 "consiga outro arquivo" só onde outro arquivo SAI diferente', () => {
        // Paulo, 17/08: *"não seria melhor informar ao colaborador que consiga
        // outro arquivo?"* — sim, e o app agora diz isso nos DOIS casos em que
        // resolve (PDF escaneado e relatório errado). No layout não reconhecido
        // ele diz o CONTRÁRIO, porque reexportar traz o mesmo arquivo: mandar
        // buscar outro pareceria acionável e faria a pessoa tentar três vezes.
        const parser = readFileSync(join(__dirname, '..', 'services/efiscalPdfParserService.ts'), 'utf8');
        expect(parser).toMatch(/exporte o relatório/);          // imagem ⇒ outro arquivo
        expect(parser).toMatch(/Tire esse e importe de novo/);   // relatório errado ⇒ outro arquivo
        const tela = readFileSync(join(__dirname, '..', 'components/AnaliseCreditoExtrato.tsx'), 'utf8');
        expect(tela).toMatch(/reexportar do E-Fiscal traria o mesmo arquivo/);
        expect(tela).toMatch(/o problema não é o seu arquivo/);
    });

    it('a mensagem leva a MEDIDA da leitura — chamado sem pedir explicação', () => {
        // Regra de 11/08: o colaborador não sabe explicar porque não sabe fazer.
        // O app não pergunta, ele mede.
        const tela = readFileSync(join(__dirname, '..', 'components/AnaliseCreditoExtrato.tsx'), 'utf8');
        expect(tela).toMatch(/parsed\.diagnostico/);
        for (const campo of ['páginas=', 'linhas com data=', 'notas lidas=', 'rodapé=']) {
            expect(tela).toContain(campo);
        }
    });
});
