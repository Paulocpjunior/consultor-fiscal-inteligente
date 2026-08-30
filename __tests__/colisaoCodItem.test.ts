// ============================================================================
// 🚨 O 0200 É A TABELA DO ARQUIVO E O `ITEM-n` É NUMERADO POR DOCUMENTO.
//
// A pendência estava escrita como *"item sem `nItem` cai em `ITEM-?`, e dois
// produtos distintos colapsam num cadastro só"*. **RE-MEDIDA em 29/08, ela
// estava mal nomeada**: os QUATRO trilhos que criam item preenchem o `nItem`,
// com o índice do laço como reserva — o `?` é INALCANÇÁVEL.
//
// 🚨 **O QUE É REAL É PIOR, porque acontece calado**: dois produtos SEM `cProd`,
// cada um o item 1 do SEU documento, viram os dois `ITEM-1`; o coletor do 0200
// faz `if (!map.has(cod))` e **o segundo desaparece dentro do primeiro**. O
// arquivo declara um item onde havia dois, os C170 dos dois apontam para a
// descrição de um só, e o **PVA ACEITA** — há uma linha só no 0200. Quem vê o
// erro é quem lê o livro.
//
// ⚠️ **A CHAVE NÃO MUDA**, de propósito: ela é o que o C170/A170 REFERENCIA, e
// mexer nela sem caso real medido troca a colisão silenciosa por item ÓRFÃO em
// todo cliente cujo XML não traz `cProd` — a recusa que a PWR já pagou (19/08).
// O que a casa faz com o que não sabe decidir é DENUNCIAR.
// ============================================================================
import * as fs from 'fs';
import * as path from 'path';
import {
    codItemDoItem, conferirColisaoDeItem, avisoDeColisaoDeItem,
} from '../sefaz-backend/sped-selecao-documentos.js';

describe('🚨 colisão de COD_ITEM: dois produtos, um cadastro', () => {
    it('dois itens sem cProd, cada um o nº 1 do seu documento, dão o MESMO código', () => {
        // É a raiz da colisão — e ela não é defeito da régua: o `ITEM-n` é a
        // única identidade que sobra quando o XML não traz o código.
        expect(codItemDoItem({ nItem: '1', xProd: 'PARAFUSO' })).toBe('ITEM-1');
        expect(codItemDoItem({ nItem: '1', xProd: 'PORCA' })).toBe('ITEM-1');
    });

    it('acusa quando a DESCRIÇÃO diverge', () => {
        expect(conferirColisaoDeItem(
            { descricao: 'PARAFUSO', ncm: '73181500' },
            { descricao: 'PORCA', ncm: '73181500' },
        )).toBe('descricao');
    });

    it('acusa quando o NCM diverge', () => {
        expect(conferirColisaoDeItem(
            { descricao: 'PARAFUSO', ncm: '73181500' },
            { descricao: 'PARAFUSO', ncm: '73182900' },
        )).toBe('ncm');
    });

    // ⚠️ O CASO NORMAL É O MESMO PRODUTO EM VINTE DOCUMENTOS. Alarme sobre
    // arquivo correto é o jeito conhecido de a equipe desligar a trava.
    it('fica MUDA sobre o mesmo produto repetido', () => {
        expect(conferirColisaoDeItem(
            { descricao: 'PARAFUSO', ncm: '73181500' },
            { descricao: 'parafuso ', ncm: '73181500' },
        )).toBeNull();
    });

    // ⚠️ Ausência não é divergência — campo vazio é captura incompleta, e isso
    // tem trilho próprio (o ♻️). Acusar aqui mandaria procurar no lugar errado.
    it('campo VAZIO de um lado não acusa', () => {
        expect(conferirColisaoDeItem({ descricao: 'PARAFUSO', ncm: '' }, { descricao: '', ncm: '73181500' })).toBeNull();
        expect(conferirColisaoDeItem({}, {})).toBeNull();
        expect(conferirColisaoDeItem(null, null)).toBeNull();
    });

    it('o aviso nomeia os dois lados e diz que o PVA aceita', () => {
        const a = avisoDeColisaoDeItem([{ codItem: 'ITEM-1', de: 'PARAFUSO', para: 'PORCA' }]);
        expect(a).toMatch(/ITEM-1/);
        expect(a).toMatch(/PARAFUSO/);
        expect(a).toMatch(/PORCA/);
        expect(a).toMatch(/PVA ACEITA/);
        expect(a).toMatch(/cProd/);          // a causa, não só o sintoma
    });

    it('sem colisão não há aviso — nasce MUDO', () => {
        expect(avisoDeColisaoDeItem([])).toBe('');
        expect(avisoDeColisaoDeItem(null as any)).toBe('');
    });

    it('e o aviso RECORTA dizendo quantas ficaram de fora', () => {
        const muitas = Array.from({ length: 9 }, (_, i) => ({ codItem: `ITEM-${i}`, de: 'A', para: 'B' }));
        expect(avisoDeColisaoDeItem(muitas)).toMatch(/e mais 4/);
    });
});

// ============================================================================
// 🔒 A TRAVA QUE MANTÉM O `ITEM-?` INALCANÇÁVEL.
//
// A medição de 29/08 vale para os trilhos de HOJE. Um trilho novo que crie
// item sem `nItem` reabre o buraco — e reabre em SILÊNCIO, que é como esta
// classe sempre volta. Por VARREDURA, nunca por lista.
// ============================================================================
// ⚠️ A LIGAÇÃO SE PROVA POR VARREDURA porque os orquestradores puxam
// firebase-admin e NÃO carregam no jest. E ela é sobre as DUAS famílias: uma
// só é a "meia trava" do COD_MUN do 0150 (22/08).
describe('🔒 os DOIS orquestradores acusam a colisão', () => {
    const raiz = path.join(__dirname, '..');
    const ORQUESTRADORES = [
        'sefaz-backend/sped-fiscal-orchestrator.js',
        'sefaz-backend/sped-contrib-orchestrator.js',
    ];

    it.each(ORQUESTRADORES)('%s confere a colisão E empurra o aviso', (arq) => {
        const src = fs.readFileSync(path.join(raiz, arq), 'utf8');
        // Conferir sem AVISAR é a flag que ninguém lê (29/08) — as duas metades
        // são cobradas juntas, senão a colisão volta a ser silenciosa.
        expect(src).toMatch(/conferirColisaoDeItem\s*\(/);
        expect(src).toMatch(/warnings\.push\(avisoDeColisaoDeItem\(/);
    });
});

describe('🔒 todo trilho que cria item preenche o nItem', () => {
    const raiz = path.join(__dirname, '..');
    const TRILHOS = [
        'sefaz-backend/xml-importer.js',
        'services/xmlParserService.ts',
        'services/notaDigitada.ts',
    ];

    it('os arquivos existem (senão a varredura passaria verde sem ler nada)', () => {
        for (const t of TRILHOS) expect(fs.existsSync(path.join(raiz, t))).toBe(true);
    });

    it('cada um preenche nItem com reserva — o "?" não é alcançável', () => {
        for (const t of TRILHOS) {
            const src = fs.readFileSync(path.join(raiz, t), 'utf8');
            // 🐛 A 1ª VERSÃO DESTA VARREDURA ACUSOU CÓDIGO CERTO — a 4ª vez do
            // mesmo vício. Ela exigia o `||` na LINHA do `nItem:`, e o
            // `xml-importer` faz em DUAS etapas: `const nItem = … || String(i+1)`
            // e depois o shorthand `nItem,`. Alarme falso sobre código correto é
            // o que faz a equipe desligar a trava — a assinatura casa as duas
            // formas de ATRIBUIR, não uma delas.
            const atribuicoes = src.match(/(?:const\s+nItem\s*=|nItem:)\s*[^,;\n]*/g) || [];
            const ok = atribuicoes.some((a) => (
                /\|\|/.test(a)                    // tem reserva
                || /'\d+'/.test(a)                // literal (o item sintético)
                || /String\(/.test(a)             // derivado do índice do laço
            ));
            if (!ok) {
                throw new Error(
                    `\n\n🚧 ${t} cria item SEM garantir o nItem.\n\n`
                    + 'Sem ele o COD_ITEM cai em "ITEM-?" e TODOS os itens sem cProd deste\n'
                    + 'trilho colapsam num cadastro só do 0200 — em silêncio, com o PVA\n'
                    + 'aceitando. Use o índice do laço como reserva, como os outros trilhos.\n',
                );
            }
        }
    });
});
