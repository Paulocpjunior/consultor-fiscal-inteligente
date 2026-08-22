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
import { codItemDoItem } from '../sefaz-backend/sped-selecao-documentos.js';

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
