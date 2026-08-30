// ============================================================================
// 🚨 O TAMANHO DE CADA CAMPO, EM TODO BLOCO — não só no 0.
//
// Em 29/08 a trava de tamanho nasceu cobrindo **um bloco só**, e foi ela que
// pegou o FANTASIA do 0005 saindo com 91 caracteres num campo de 060. Os
// blocos C, D, E, G, H e K continuavam sem conferência de tamanho nenhuma —
// a "meia trava" do COD_MUN do 0150 (22/08) mais uma vez.
//
// ═══ E MEDIR OS OUTROS BLOCOS ACHOU DOIS DEFEITOS VIVOS ═════════════════════
//
//   · **H010 campo 08 (COD_PART)** — saía **CRU** com os três vizinhos
//     (`COD_ITEM`, `TXT_COMPL`, `COD_CTA`) já cortando. Ficou sozinho na lista.
//   · **K200 campos 03 e 06 (COD_ITEM, COD_PART)** — o bloco K devolve ARRAYS
//     DE CAMPOS e a casca formata, mas o `buildLine` formata **NÚMERO**, não
//     corta TEXTO: ninguém cortava.
//
// Os dois são a recusa *"Tamanho do campo inválido"*, a família do COD_ENQ da
// PWR (20/08).
//
// 📌 **E OS DOIS SÓ APARECERAM MEDINDO A SAÍDA.** Ler o código diria que o
// gerador está certo — o H010 tem `sanitizeString` em três campos e o K tem
// uma casca que "formata". Quem respondeu foi gerar com valores LONGOS e
// contar o caractere, que é a mesma disciplina do dia inteiro.
//
// ⚠️ **A trava é CEGA para a CONTAGEM** — ela olha o tamanho de cada campo. O
// registro que perdeu campos tem tamanhos certos em todos eles; quem pega
// aquilo é a R42. As duas são necessárias e nenhuma substitui a outra.
// ============================================================================
import { conferirTamanhoDeCamposFiscal } from '../sefaz-backend/sped-fiscal-campos.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBlocoH } from '../sefaz-backend/sped-fiscal-blocoH.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { buildBlocoK } from '../sefaz-backend/sped-fiscal-blocoK.js';
import { prevalidarSpedFiscal } from '../sefaz-backend/sped-prevalidacao.js';

/** Longo o bastante para estourar qualquer campo de texto do leiaute. */
const L = 'A'.repeat(160);

const blocoH = () => buildBlocoH({
    empresa: { cnpj: '11111111000191', dadosFiscais: { uf: 'SP', gerarInventario: 'sim' } },
    competenciaInicio: '2026-12',
    competenciaFim: '2026-12',
    inventarioMotInv: '01',
    itens: [{
        codItem: L, unidade: L, qtdInventario: 5, vlUnitInventario: 10,
        indPropInventario: '1', codPartInventario: L, tipo: '00',
    }],
    warnings: [] as string[],
});

const blocoK = () => buildBlocoK({
    empresa: {
        cnpj: '11111111000191',
        dadosFiscais: { uf: 'SP', entregaBlocoK: 'sim', leiauteBlocoK: '2' },
    },
    competenciaInicio: '2026-07',
    competenciaFim: '2026-07',
    blocoK: { estoques: [{ codItem: L, qtd: 12.5, indEst: '1', codPart: L }], producao: [] },
    itens: [{ codItem: L, tipo: '00' }],
    warnings: [] as string[],
});

describe('🚨 os blocos H e K cortam o campo no tamanho do leiaute', () => {
    it('o bloco H produziu o H010 (senão o teste não mede nada)', () => {
        // Guarda contra o silêncio falso: sem a linha, tudo passaria verde.
        expect(blocoH().some((l: string) => l.startsWith('|H010|'))).toBe(true);
    });

    it('o bloco K produziu o K200', () => {
        expect(blocoK().some((l: string) => l.startsWith('|K200|'))).toBe(true);
    });

    // 🚨 O DEFEITO QUE ELA ACHOU, travado pelo número.
    it('H010: o COD_PART cabe em 60 — ele saía CRU, com os vizinhos cortando', () => {
        const h010 = blocoH().find((l: string) => l.startsWith('|H010|'))!
            .replace(/\r?\n$/, '').split('|');
        expect(h010[8].length).toBe(60);          // COD_PART (campo 08)
        expect(h010[2].length).toBe(60);          // COD_ITEM, que já cortava
    });

    it('K200: COD_ITEM e COD_PART cabem em 60 — ninguém cortava', () => {
        const k200 = blocoK().find((l: string) => l.startsWith('|K200|'))!
            .replace(/\r?\n$/, '').split('|');
        expect(k200[3].length).toBe(60);          // COD_ITEM (campo 03)
        expect(k200[6].length).toBe(60);          // COD_PART (campo 06)
    });

    it('e nenhum campo dos dois blocos passa do leiaute', () => {
        for (const [rot, linhas] of [['H', blocoH()], ['K', blocoK()]] as const) {
            const r = conferirTamanhoDeCamposFiscal(linhas as string[]);
            if (!r.ok) {
                throw new Error(
                    `\n\n🚧 BLOCO ${rot}: CAMPO MAIOR QUE O LEIAUTE\n\n`
                    + r.erros.map((e: { mensagem: string }) => `  · ${e.mensagem}`).join('\n')
                    + '\n\nO PVA recusa com "Tamanho do campo inválido". A trava de CONTAGEM não vê\n'
                    + 'isto: a contagem está certa, o que estoura é o TAMANHO.\n',
                );
            }
        }
    });

    // ⚠️ O K200 aponta para um item do 0200, e o 0200 corta em 60. Cortar um
    // lado só trocaria a recusa de TAMANHO pela de item ÓRFÃO — por isso o
    // corte passa pelos DOIS lados, com o mesmo limite.
    it('e o item do K200 continua batendo com o do 0200 (nada virou órfão)', () => {
        const linhas = blocoK();
        expect(linhas.some((l: string) => l.startsWith('|K200|'))).toBe(true);
        const k200 = linhas.find((l: string) => l.startsWith('|K200|'))!
            .replace(/\r?\n$/, '').split('|');
        expect(k200[3]).toBe(L.slice(0, 60));
    });
});

describe('🚦 a R43 acusa o campo estourado', () => {
    // O caso REAL que abriu a classe: razão social de 91 caracteres num campo
    // de 60 (29/08). O PVA recusa; a contagem de campos fica muda.
    it('FANTASIA de 91 caracteres num campo de 60 vira recusa prevista', () => {
        const r = prevalidarSpedFiscal([`|0005|${'A'.repeat(91)}|01001000|R|1||C||||`]);
        const e = r.erros.find((x: { regra: string }) => x.regra === 'tamanho-de-campo');
        expect(e).toBeTruthy();
        expect(String(e!.mensagem)).toMatch(/saiu com 91 caracteres e o leiaute dá 60/);
        expect(String(e!.acao)).toMatch(/defeito de GERAÇÃO/);
    });

    it('e fica MUDA sobre a linha que cabe', () => {
        const r = prevalidarSpedFiscal(['|0005|FANTASIA|01001000|R|1||C||||']);
        expect(r.erros.filter((x: { regra: string }) => x.regra === 'tamanho-de-campo')).toEqual([]);
    });
});

describe('⚠️ o que a trava NÃO faz', () => {
    // Todo campo de VALOR é livre no Guia (`-` na coluna Tam). Cravar limite
    // ali seria inventar regra que a fonte não tem.
    it('campo de tamanho LIVRE não é conferido', () => {
        // VL_DOC do C100 (campo 12) é livre — 40 dígitos não acusam.
        const c100 = `|C100|0|1|P1|55|00|1|123|${'1'.repeat(44)}|24072026|24072026|${'9'.repeat(40)}|`;
        expect(conferirTamanhoDeCamposFiscal([c100]).ok).toBe(true);
    });

    it('registro fora da tabela fica MUDO', () => {
        expect(conferirTamanhoDeCamposFiscal([`|ZZ99|${L}|`]).ok).toBe(true);
    });

    it('linha malformada e entrada torta não explodem', () => {
        expect(conferirTamanhoDeCamposFiscal(['0005|X|']).ok).toBe(true);
        expect(conferirTamanhoDeCamposFiscal(null as unknown as string[]).ok).toBe(true);
        expect(conferirTamanhoDeCamposFiscal([]).ok).toBe(true);
    });

    // 🚨 Ela é CEGA para a CONTAGEM — quem pega o registro que perdeu campos é
    // a R42. As duas são necessárias e nenhuma substitui a outra.
    it('é cega para a contagem de campos — e isso é declarado', () => {
        expect(conferirTamanhoDeCamposFiscal(['|0005|OK|']).ok).toBe(true);
    });
});
