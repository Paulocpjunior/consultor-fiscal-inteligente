// ============================================================================
// 🚨 O COD_ITEM TINHA QUATRO RÉGUAS — e o 0200 é o CADASTRO que as outras
// apontam
//
// O 0200 é a Tabela de Identificação do Item; C170 e A170 REFERENCIAM ela. Nas
// duas famílias de arquivo os dois lados respondiam coisas diferentes, e o PVA
// já cobrou as DUAS consequências desta casa:
//
//   · *"Campo obrigatório · COD_ITEM"* — MANTOAN 0040, 18/08, 36 recusas;
//   · item ÓRFÃO, declarado no 0200 e referenciado por ninguém — PWR, 19/08.
//
// O retrato de antes:
//
//   0200 (os DOIS orquestradores) : cProd || codigo || cFiscal || ITEM-n
//   C170 do EFD ICMS/IPI          : cProd || codigo || ITEM-n     (sem cFiscal)
//   C170 do EFD-Contribuições     : cProd || codigo || ''         (pode VAZIO)
//   A170 do EFD-Contribuições     : cProd || codigo || ''         (idem)
//
// E uma quinta divergência escondida no `ITEM-n`: o 0200 usa o `nItem` que veio
// no XML, e o C170 do ICMS/IPI usava o **contador do laço**.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    codItemDoItem, unidadeDoItem, normalizarUnidade,
} from '../sefaz-backend/sped-selecao-documentos.js';

const RAIZ = join(__dirname, '..');

describe('🚨 codItemDoItem — a chave que liga o item ao 0200', () => {
    it('o código do produto manda, quando existe', () => {
        expect(codItemDoItem({ cProd: 'ABC-123', nItem: '2' })).toBe('ABC-123');
        expect(codItemDoItem({ codigo: 'X9' })).toBe('X9');
    });

    // 🔴 A divergência do C170 do ICMS/IPI: ele não conhecia o `cFiscal`, então
    // o 0200 declarava "7803" e ele declarava "ITEM-1".
    it('o cFiscal entra — era ele que o C170 do ICMS/IPI ignorava', () => {
        expect(codItemDoItem({ cFiscal: '7803', nItem: '5' })).toBe('7803');
    });

    // 🔴 A divergência do EFD-Contribuições: campo obrigatório saindo VAZIO.
    it('NUNCA devolve vazio — campo obrigatório sem valor é recusa certa', () => {
        expect(codItemDoItem({ nItem: '3' })).toBe('ITEM-3');
        expect(codItemDoItem({})).toBe('ITEM-?');
        expect(codItemDoItem(null as any)).toBe('ITEM-?');
    });

    // 🔴 A quinta: o 0200 lia o `nItem` do XML e o C170 o índice do laço. Item
    // que chega fora de ordem batia por coincidência; fora disso, órfão.
    it('o número do item é o do XML, nunca a posição no array', () => {
        // O terceiro item do array declarando nItem "7" — o 0200 sempre disse
        // ITEM-7, e o C170 dizia ITEM-3.
        expect(codItemDoItem({ nItem: '7' })).toBe('ITEM-7');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A TRAVA É POR VARREDURA: quem escreve COD_ITEM chama o DONO. Lista de
// arquivos envelhece no primeiro registro novo — e envelhece em silêncio, que
// é como esta divergência sobreviveu a duas rodadas de PVA.
// ═══════════════════════════════════════════════════════════════════════════
const ESCREVEM_COD_ITEM = [
    'sefaz-backend/sped-fiscal-orchestrator.js',   // 0200 do EFD ICMS/IPI
    'sefaz-backend/sped-contrib-orchestrator.js',  // 0200 do EFD-Contribuições
    'sefaz-backend/sped-fiscal-blocoC.js',         // C170 do EFD ICMS/IPI
    'sefaz-backend/sped-contrib-blocos.js',        // C170 e A170 do Contribuições
];

describe('🚨 os quatro leem a MESMA chave', () => {
    it.each(ESCREVEM_COD_ITEM)('%s chama o dono', (rel) => {
        const src = readFileSync(join(RAIZ, rel), 'utf8');
        expect(src).toContain('codItemDoItem');
    });

    it('e nenhum reimplementa a régua por conta própria', () => {
        const infratores: string[] = [];
        for (const rel of ESCREVEM_COD_ITEM) {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            // A assinatura das quatro cópias: `cProd ||` seguido de fallback.
            for (const m of src.matchAll(/item\.cProd\s*\|\|/g)) {
                infratores.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 SEGUNDA RÉGUA DO COD_ITEM\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO 0200 é o CADASTRO do item; C170 e A170 apontam para ele. Quando os dois\n'
                + 'lados respondem diferente, o PVA devolve "Campo obrigatório · COD_ITEM"\n'
                + '(MANTOAN, 36 recusas) ou o item ÓRFÃO declarado e não referenciado (PWR).\n'
                + "Use `codItemDoItem` de './sped-selecao-documentos.js'.\n",
            );
        }
    });

    // O item sintético da NFS-e sem discriminação continua com o código
    // próprio — ele não vem de `cProd` nenhum, e o 0200 o cadastra à parte.
    it('o item sintético de serviço mantém a constante única', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/sped-contrib-blocos.js'), 'utf8');
        expect(src).toContain('COD_ITEM_SERVICO_GENERICO');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 A UNID É A OUTRA CHAVE DO MESMO PAR — ela liga o item ao 0190
//
// Mesma doença, um campo adiante. As cinco escritas normalizavam diferente:
//
//   0190 (os dois orquestradores) : .toUpperCase().substring(0,6)  — SEM trim
//   C170 (as duas famílias)       : sanitizeString(upper, 6)       — COM trim
//   UNID_INV do 0200             : sanitizeString(unidade, 6)     — SEM upper
//   H010                          : sanitizeString(unidade, 6)     — nenhum dos dois
//   rota do editor                : String(...).slice(0,6)         — a quarta forma
//
// Com `'UN '` no XML, o 0190 cadastrava `'UN '` e o C170 referenciava `'UN'`:
// o C170 aponta para unidade que a Tabela não tem, E o 0190 declara uma que
// ninguém referencia — as DUAS recusas do PVA, de uma vez. O próprio validador
// do app já sabia disso (*"C170: UNID 'X' nao cadastrada no 0190"*), mas ele
// roda DEPOIS, sobre o arquivo já gerado.
// ═══════════════════════════════════════════════════════════════════════════
const ESCREVEM_UNID = [
    'sefaz-backend/sped-fiscal-orchestrator.js',   // 0190
    'sefaz-backend/sped-contrib-orchestrator.js',  // 0190
    'sefaz-backend/sped-fiscal-blocoC.js',         // C170
    'sefaz-backend/sped-contrib-blocos.js',        // C170
    'sefaz-backend/sped-fiscal-bloco0.js',         // UNID_INV do 0200
    'sefaz-backend/sped-fiscal-blocoH.js',         // H010
];

describe('🚨 UNID — a chave do 0190 tem UMA forma', () => {
    it('o espaço nas pontas some — era ele que criava o par órfão', () => {
        expect(unidadeDoItem({ uCom: 'UN ' })).toBe('UN');
        expect(unidadeDoItem({ uCom: ' un' })).toBe('UN');
        expect(unidadeDoItem({ unidade: 'un' })).toBe('UN');
    });

    it('e o que já estava certo não muda', () => {
        expect(unidadeDoItem({ uCom: 'PC/UN' })).toBe('PC/UN');
        expect(unidadeDoItem({ uCom: 'QUILOGRAMA' })).toBe('QUILOG');   // 6 posições
        expect(unidadeDoItem({ uCom: 'CX 12' })).toBe('CX 12');
    });

    it("item sem unidade cai em 'UN', como sempre caiu", () => {
        expect(unidadeDoItem({})).toBe('UN');
    });

    // ⚠️ A política de AUSÊNCIA não muda: o H010 segue sem default, porque
    // inventar a unidade do inventário muda a leitura da QUANTIDADE.
    it('mas a régua crua devolve VAZIO — quem põe default é cada registro', () => {
        expect(normalizarUnidade('')).toBe('');
        expect(normalizarUnidade(null)).toBe('');
    });

    it.each(ESCREVEM_UNID)('%s lê pela régua', (rel) => {
        const src = readFileSync(join(RAIZ, rel), 'utf8');
        expect(src).toMatch(/unidadeDoItem|normalizarUnidade/);
    });

    it('e nenhum normaliza a unidade por conta própria', () => {
        const infratores: string[] = [];
        for (const rel of ESCREVEM_UNID) {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            for (const m of src.matchAll(/item\.uCom\s*\|\||substring\(0,\s*6\)/g)) {
                infratores.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
            }
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 SEGUNDA FORMA DA CHAVE UNID\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO 0190 é a Tabela de Unidade de Medida; C170, H010 e o UNID_INV do 0200\n'
                + "apontam para ela. Uma forma diferente ('UN ' × 'UN') faz o registro apontar\n"
                + 'para unidade que a Tabela não tem, e a Tabela declarar uma que ninguém\n'
                + "referencia — as duas recusas do PVA de uma vez. Use `unidadeDoItem`.\n",
            );
        }
    });
});
