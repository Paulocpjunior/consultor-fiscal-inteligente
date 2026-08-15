// ============================================================================
// RECUPERAR CAMPO DE ITEM DO XML-FONTE — e não escrever no item errado.
//
// O extrator aprendeu `cstIpi` em 11/08 e `cstPis`/`cstCofins` em 12/08. O que
// foi capturado antes ficou sem eles, e são justamente os campos que travam o
// **E510** (último bloco do IPI no de-para) e a base de crédito de PIS/COFINS.
//
// O XML cru está no Cloud Storage, então isto é RECUPERAÇÃO DA FONTE — mesma
// régua do ♻️ Reler município: não se pede arquivo ao cliente nem se digita.
//
// ═══ O RISCO NÃO É LER, É PAREAR ════════════════════════════════════════════
//
// Escrever o CST do item 3 no item 2 produz arquivo fiscal ACEITO declarando
// outra coisa — o pior desfecho, porque não volta recusa avisando. Estes testes
// existem quase todos por causa disso.
// ============================================================================
import {
    mesclarItensRelidos, parearItens, CAMPOS_RECUPERAVEIS,
} from '../sefaz-backend/backfill-itens-fiscais.js';

const gravado = (n: number, over: Record<string, unknown> = {}) => ({
    nItem: String(n), cfop: '1102', xProd: `PRODUTO ${n}`, vProd: 100 * n, ...over,
});
const doXml = (n: number, over: Record<string, unknown> = {}) => ({
    nItem: String(n), cfop: '1102', xProd: `PRODUTO ${n}`,
    cstIpi: '50', cEnqIpi: '999', vBcIpi: 100, cstPis: '01', cstCofins: '01', ...over,
});

describe('recupera o que falta, sem tocar no que já existe', () => {
    it('preenche o CST do IPI que o extrator antigo não lia', () => {
        const r = mesclarItensRelidos([gravado(1)], [doXml(1)]);
        expect(r.alterados).toBe(1);
        expect(r.itens[0].cstIpi).toBe('50');
        expect(r.itens[0].cstPis).toBe('01');
        // O que já estava gravado continua intacto.
        expect(r.itens[0].vProd).toBe(100);
    });

    it('NÃO sobrescreve campo já gravado — backfill recupera ausência, não corrige divergência', () => {
        // Divergência entre fonte e cadastro é ALERTA (06/08), e alerta não se
        // resolve por escrita silenciosa.
        const r = mesclarItensRelidos([gravado(1, { cstIpi: '99' })], [doXml(1, { cstIpi: '50' })]);
        expect(r.itens[0].cstIpi).toBe('99');
        // E o contador POR CAMPO prova que este campo não foi tocado — os
        // outros do mesmo item, que estavam vazios, foram preenchidos.
        expect(r.campos.cstIpi).toBeUndefined();
        expect(r.campos.cstPis).toBe(1);
    });

    it('ZERO é resposta, não ausência', () => {
        const r = mesclarItensRelidos([gravado(1, { vBcIpi: 0 })], [doXml(1, { vBcIpi: 500 })]);
        expect(r.itens[0].vBcIpi).toBe(0);
    });

    it('se o XML também não tem o campo, nada é inventado', () => {
        const r = mesclarItensRelidos([gravado(1)], [doXml(1, { cstIpi: null, cEnqIpi: null })]);
        expect(r.itens[0].cstIpi).toBeUndefined();
        expect(r.campos.cstIpi).toBeUndefined();
    });

    it('conta POR CAMPO — "12 alteradas" não diz o que foi recuperado', () => {
        const r = mesclarItensRelidos([gravado(1), gravado(2)], [doXml(1), doXml(2)]);
        expect(r.campos.cstIpi).toBe(2);
        expect(r.campos.cstCofins).toBe(2);
    });
});

describe('o pareamento — é aqui que mora o estrago', () => {
    it('pareia por nItem, mesmo com o XML em outra ordem', () => {
        const r = mesclarItensRelidos(
            [gravado(1), gravado(2)],
            [doXml(2, { cstIpi: '52' }), doXml(1, { cstIpi: '51' })],
        );
        expect(r.criterio).toBe('nItem');
        expect(r.itens[0].cstIpi).toBe('51');   // item 1 recebeu o do item 1
        expect(r.itens[1].cstIpi).toBe('52');
    });

    it('sem nItem, pareia por índice SÓ com as contagens iguais', () => {
        const semN = (n: number) => { const g: any = gravado(n); delete g.nItem; return g; };
        const r = mesclarItensRelidos([semN(1), semN(2)], [doXml(1, { cstIpi: '51' }), doXml(2, { cstIpi: '52' })]);
        expect(r.criterio).toBe('indice');
        expect(r.itens[0].cstIpi).toBe('51');
    });

    it('🚨 contagem DIFERENTE e sem nItem: NÃO mescla, e diz por quê', () => {
        // Chutar aqui grava o CST de um produto em outro, e o arquivo sai
        // ACEITO declarando outra coisa — não volta recusa avisando.
        const semN = (n: number) => { const g: any = gravado(n); delete g.nItem; return g; };
        const r = mesclarItensRelidos([semN(1), semN(2)], [doXml(1)]);
        expect(r.alterados).toBe(0);
        expect(r.motivo).toMatch(/não conferem|nao conferem/);
        expect(r.itens).toHaveLength(2);
    });

    it('item gravado sem par no XML fica intacto', () => {
        const r = mesclarItensRelidos([gravado(1), gravado(9)], [doXml(1), doXml(2)]);
        // 1 e 9 têm nItem; o XML tem 1 e 2 ⇒ só o 1 pareia.
        expect(r.itens[0].cstIpi).toBe('50');
        expect(r.itens[1].cstIpi).toBeUndefined();
    });

    it('lista vazia de um dos lados não quebra nem inventa', () => {
        expect(mesclarItensRelidos([], [doXml(1)]).alterados).toBe(0);
        expect(mesclarItensRelidos([gravado(1)], []).alterados).toBe(0);
        expect(parearItens(null as any, null as any).pares).toEqual([]);
    });
});

describe('a lista de campos é curta de propósito', () => {
    it('cobre exatamente os buracos nomeados no projeto', () => {
        // Campo novo entra aqui junto com quem o consome — nunca "já que
        // estamos aqui": cada campo a mais é uma chance de sobrescrever.
        expect(CAMPOS_RECUPERAVEIS).toEqual(['cstIpi', 'cEnqIpi', 'vBcIpi', 'cstPis', 'cstCofins']);
    });

    it('e nada fora dela é tocado, nem se vier no XML', () => {
        const r = mesclarItensRelidos([gravado(1)], [doXml(1, { cfop: '9999', vProd: 777 } as any)]);
        expect(r.itens[0].cfop).toBe('1102');
        expect(r.itens[0].vProd).toBe(100);
    });
});

// ─── A TELA MOSTRA TODAS as causas que o backend conta ──────────────────────

describe('nenhuma causa do backfill fica muda na tela', () => {
    // Caso real (EXPERTE 06/2026, 15/08): o toast disse "nada a recuperar
    // (0 · 0 · 0)" escondendo a causa verdadeira — o backend contava
    // `examinadas` e `semItens` e a tela não mostrava nenhum dos dois. Zero
    // sem causa manda a pessoa clicar de novo: alarme sem ação.
    it('o painel exibe examinadas e semItens — os dois que ficaram mudos', () => {
        const { readFileSync } = require('fs');
        const { join } = require('path');
        const painel = readFileSync(join(__dirname, '..', 'components/DCTFWeb/IpiVarreduraPanel.tsx'), 'utf8');
        expect(painel).toMatch(/r\.examinadas/);
        expect(painel).toMatch(/r\.semItens/);
        // E o caso "nenhum documento encontrado" aponta a AÇÃO certa — captura
        // e atribuição, não este botão.
        expect(painel).toMatch(/Prova de captura/);
    });
});
