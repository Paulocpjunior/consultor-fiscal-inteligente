// ============================================================================
// 🚨 O LADO DA CONTRAPARTE TINHA CINCO CÓPIAS — e o próprio dono já carregava
//    o aviso do defeito que elas têm.
//
// Triagem das 82 leituras cruas de `direcao` (26/08 — a pendência nomeada em
// 22/08: *"a classe não está fechada, e elas não foram triadas uma a uma"*).
// A maioria é legítima: filtro que a PESSOA escolhe, linha já agregada, o
// próprio dono, e direção de MENSAGEM (outro domínio). Mas cinco lugares
// reimplementavam a MESMA pergunta — *de que lado está a contraparte?* —, que
// tem dono desde 22/08 (`ladoDaContraparte`).
//
// E o comentário do dono já diz por que ele existe, palavra por palavra:
//
//   "A nota própria de entrada é emitida PELA EMPRESA. Sem esse laço, o
//    tpNF=0 de um TERCEIRO (que emitiu a nota de entrada DELE) viraria
//    'nossa' nota própria — e a contraparte sairia do lado errado."
//
// TRÊS das cinco cópias faziam exatamente isso: `tpNF === '0'` e mais nada.
//   · services/relatoriosAgregacoes.ts  → a contraparte de TODOS os relatórios
//   · services/livroNotaProdutor.ts     → o Livro do produtor rural
//   · sefaz-backend/rotina-fiscal-routes.js → a contagem da Rotina do Mês
// Uma tinha o laço mas lia o emitente só na forma ANINHADA
// (`sefaz-backend/dipam-routes.js`), e a captura principal grava `cnpjEmit`
// ACHATADO — ali ela respondia "não é própria" na maioria das notas.
// A quinta (`services/iobSageExportService.ts`) estava correta; o que muda é
// deixar de ser a quinta cópia.
//
// ⚠️ E A CORREÇÃO SÓ É SEGURA PORQUE FOI MEDIDA: o backfill de direção
// (`corrigirDirecaoEntradaPropria`) só vira a nota para 'entrada' quando
// `cnpjEmit === empresaCnpj`, e ANTES dele ela fica gravada como 'saida' — que
// o dono já reconhece sem precisar do CNPJ. Nos dois estados ele responde
// certo. Trocar sem medir isso teria produzido o defeito na hora, que é a
// lição de 22/08.
// ============================================================================
import { contraparteDoc } from '../services/relatoriosAgregacoes';
import { contraparteNormalizada } from '../services/livroNotaProdutor';
// O módulo tem `.d.ts` — o tsc confere o que se importa dele.
import { ladoDaContraparte } from '../sefaz-backend/participante-doc-helper.js';

const EMPRESA = '31947349000169';
const TERCEIRO = '26767102000120';

/** Nota própria de entrada da EMPRESA: ela emite, o produtor é o destinatário. */
const propriaDaEmpresa = (over: Record<string, unknown> = {}) => ({
    tpNF: '0', empresaCnpj: EMPRESA,
    cnpjEmit: EMPRESA, xNomeEmit: 'A EMPRESA',
    cnpjDest: '12345678901', xNomeDest: 'PRODUTOR RURAL',
    direcao: 'saida',                       // como o importer grava ANTES do backfill
    ...over,
});

/** Nota própria de entrada de UM TERCEIRO, que chegou na base. */
const propriaDeTerceiro = () => ({
    tpNF: '0', empresaCnpj: EMPRESA,
    cnpjEmit: TERCEIRO, xNomeEmit: 'OUTRA EMPRESA',
    cnpjDest: '99999999000199', xNomeDest: 'CLIENTE DELE',
    direcao: 'entrada',
});

describe('🚨 o dono responde nos três estados que o documento tem', () => {
    // Antes do backfill a nota própria de entrada fica gravada como 'saida' —
    // e aí o dono responde sem sequer precisar do CNPJ.
    it('pré-backfill (direcao "saida") → contraparte no destinatário', () => {
        expect(ladoDaContraparte(propriaDaEmpresa(), EMPRESA)).toBe('destinatario');
        expect(ladoDaContraparte(propriaDaEmpresa())).toBe('destinatario');
    });

    // Depois do backfill ela é 'entrada' — e o backfill SÓ vira quando
    // `cnpjEmit === empresaCnpj`, então o laço sempre tem com o que fechar.
    it('pós-backfill (direcao "entrada") → contraparte no destinatário', () => {
        const d = propriaDaEmpresa({ direcao: 'entrada' });
        expect(ladoDaContraparte(d, EMPRESA)).toBe('destinatario');
        // Sem o parâmetro, o dono cai no `empresaCnpj` do próprio documento.
        expect(ladoDaContraparte(d)).toBe('destinatario');
    });

    it('compra normal de terceiro → contraparte no emitente', () => {
        expect(ladoDaContraparte({ direcao: 'entrada', cnpjEmit: TERCEIRO }, EMPRESA)).toBe('emitente');
    });
});

describe('🚨 o caso que as cópias erravam: tpNF=0 de TERCEIRO', () => {
    // 🚨 É o cenário KROYA × GOLDLOG (17/08): dois clientes negociando entre
    // si, e a nota própria de entrada de UM aparece na base. Sem o laço, a
    // coluna mostraria o PRÓPRIO cliente como fornecedor.
    it('o dono NÃO a trata como própria', () => {
        expect(ladoDaContraparte(propriaDeTerceiro(), EMPRESA)).toBe('emitente');
    });

    it('a contraparte dos relatórios sai do lado certo', () => {
        const p = contraparteDoc(propriaDeTerceiro() as never) as any;
        expect(p.cnpjCpf).toBe(TERCEIRO);
        expect(p.nome).toBe('OUTRA EMPRESA');
    });

    it('o Livro do produtor rural idem', () => {
        expect(contraparteNormalizada(propriaDeTerceiro()).doc).toBe(TERCEIRO);
    });

    // A cópia antiga (`tpNF === '0'` e mais nada) devolveria o DESTINATÁRIO —
    // este é o resultado que a correção derruba, guardado para não voltar.
    it('a cópia antiga responderia o contrário — e é isso que muda', () => {
        const d = propriaDeTerceiro();
        const copiaAntiga = (String(d.tpNF ?? '') === '0' || d.direcao === 'saida')
            ? 'destinatario' : 'emitente';
        expect(copiaAntiga).toBe('destinatario');
        expect(ladoDaContraparte(d, EMPRESA)).toBe('emitente');
    });
});

describe('🚨 e a nota própria LEGÍTIMA continua saindo certa', () => {
    it.each([
        ['pré-backfill', propriaDaEmpresa()],
        ['pós-backfill', propriaDaEmpresa({ direcao: 'entrada' })],
    ])('%s: o produtor é a contraparte, não a própria empresa', (_n, d) => {
        expect((contraparteDoc(d as never) as any).cnpjCpf).toBe('12345678901');
        expect(contraparteNormalizada(d).doc).toBe('12345678901');
    });

    // ⚠️ A MELHORIA QUE A DELEGAÇÃO TRAZ DE BRINDE: a cópia do `dipam-routes`
    // lia o emitente só na forma ANINHADA, e a captura principal grava
    // `cnpjEmit` ACHATADO — ali ela respondia "não é própria" na maioria das
    // notas. O dono lê as duas formas.
    it('a forma ANINHADA e a ACHATADA dão a mesma resposta', () => {
        const achatada = propriaDaEmpresa({ direcao: 'entrada' });
        const aninhada = {
            tpNF: '0', empresaCnpj: EMPRESA, direcao: 'entrada',
            emitente: { cnpjCpf: EMPRESA, nome: 'A EMPRESA' },
            destinatario: { cnpjCpf: '12345678901', nome: 'PRODUTOR RURAL' },
        };
        expect(ladoDaContraparte(achatada, EMPRESA)).toBe('destinatario');
        expect(ladoDaContraparte(aninhada, EMPRESA)).toBe('destinatario');
    });
});
