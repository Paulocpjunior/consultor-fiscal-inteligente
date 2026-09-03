/**
 * spedContribMantoanRodada3 — MANTOAN, 3ª rodada do PVA (18/08).
 *
 * Paulo: *"Terceira vez sobre os erros da empresa Mantoan"*. O recibo trouxe
 * 71 recusas, das quais 39 são cobertas aqui (30 COD_MUN já são decisão dele —
 * "arrumo manual" — e ficam de fora):
 *
 *   36 · Campo obrigatório não informado ..................... A170 · COD_ITEM
 *    3 · Campo obrigatório PARA NOTAS FISCAIS DE ENTRADA ...... A170 · IND_ORIG_CRED
 *
 * DUAS CAUSAS:
 *
 * (1) COD_ITEM vazio no item sintético do A170 (documento de serviço sem
 *     itens capturados — a NFS-e do portal não tem `itens[]`). O item passa a
 *     usar `COD_ITEM_SERVICO_GENERICO`, e esse código PRECISA aparecer no 0200
 *     (Bloco 0) — senão o A170 aponta pra um item que a Tabela de
 *     Identificação não cadastrou.
 *
 * (2) IND_ORIG_CRED vazio em 3 itens de ENTRADA com CST 70 (sem crédito). O
 *     código anterior só preenchia esse campo quando o CST TINHA crédito
 *     (50-56) — premissa MINHA, sem prova. A mensagem do PVA desmente:
 *     "obrigatório PARA NOTAS FISCAIS DE ENTRADA", ou seja quem manda é a
 *     DIREÇÃO do documento, não o CST. NAT_BC_CRED continua só com crédito —
 *     o PVA não acusou ele nestas linhas.
 */
import { buildBlocoA, COD_ITEM_SERVICO_GENERICO } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-ignore
import { camposDaLinha } from '../sefaz-backend/sped-contrib-campos.js';
import * as fs from 'fs';
import * as path from 'path';

const dadosBase = (notas: any[]) => ({
    empresa: { cnpj: '13344638000191', nome: 'CLINICA MEDICA MANTOAN LTDA' },
    competencia: '2026-07',
    regimeApuracao: '2',
    notas,
    itens: [],
    participantes: [],
    warnings: [] as string[],
});

describe('🚨 A170 — COD_ITEM do item sintético não pode sair vazio', () => {
    it('documento de serviço sem itens usa o código genérico, nunca vazio', () => {
        const dados = dadosBase([{
            numero: '7870', tipo: 'NFSe', direcao: 'saida', valorTotal: 1450,
            dataEmissao: '2026-07-16', cpfDest: '01056860855',
        }]);
        const linhas: string[] = buildBlocoA(dados);
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[2]).toBe(COD_ITEM_SERVICO_GENERICO);
        expect(a170[2]).not.toBe('');
    });

    it('nota com itens continua usando o código REAL do produto/serviço', () => {
        const dados = dadosBase([{
            numero: '900', tipo: 'NFSe', direcao: 'saida', valorTotal: 300,
            dataEmissao: '2026-07-10', cpfDest: '01056860855',
            itens: [{ nItem: '1', cProd: 'CONSULTA-01', xProd: 'Consulta', vProd: 300 }],
        }]);
        const linhas: string[] = buildBlocoA(dados);
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[2]).toBe('CONSULTA-01');
    });
});

describe('🚨 A170 — IND_ORIG_CRED é da DIREÇÃO, não do CST', () => {
    it('entrada com CST 70 (sem crédito) leva IND_ORIG_CRED = "0", nunca vazio', () => {
        const dados = dadosBase([{
            numero: '8450858', tipo: 'NFSe', direcao: 'entrada', valorTotal: 500,
            dataEmissao: '2026-07-28', cnpjEmit: '05059447000150',
        }]);
        (dados as any).regimeApuracao = '2'; // cumulativo → getCstPis/Cofins devolve '70' na entrada
        const linhas: string[] = buildBlocoA(dados);
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[8]).toBe('70');   // CST_PIS confirmando o cenário do PVA
        expect(a170[6]).toBe('');    // NAT_BC_CRED continua vazio — sem crédito
        expect(a170[7]).toBe('0');   // IND_ORIG_CRED — agora preenchido
    });

    it('saída continua SEM o campo — ele descreve a origem da AQUISIÇÃO', () => {
        const dados = dadosBase([{
            numero: '7870', tipo: 'NFSe', direcao: 'saida', valorTotal: 1450,
            dataEmissao: '2026-07-16', cpfDest: '01056860855',
        }]);
        const linhas: string[] = buildBlocoA(dados);
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[7]).toBe('');
    });

    // 📌 FIXTURE TROCADA EM 29/08, e o motivo é a régua, não o teste.
    //
    // Ela chegava ao CST 50 plantando `cstPis: '50'` no ITEM — ou seja pelo CST
    // do XML, que é o do **FORNECEDOR** — numa empresa CUMULATIVA (a MANTOAN,
    // `regimeApuracao: '2'`), onde crédito de PIS/COFINS não existe. O arquivo
    // saía declarando NAT_BC_CRED numa aquisição sem crédito nenhum.
    //
    // É a lição de 20/08, que o C170 já honrava e o A170 não: **na entrada quem
    // decide é o REGIME de quem escritura**. A intenção do teste continua de pé
    // — havendo crédito, o NAT_BC_CRED sai —, só que o caminho até ele é o
    // não-cumulativo, que é o único em que o crédito existe.
    it('entrada COM crédito (não-cumulativo, CST 50) leva NAT_BC_CRED preenchido', () => {
        const dados = dadosBase([{
            numero: '111', tipo: 'NFSe', direcao: 'entrada', valorTotal: 500,
            dataEmissao: '2026-07-28', cnpjEmit: '05059447000150',
            itens: [{ nItem: '1', cProd: 'X', xProd: 'X', vProd: 500 }],
        }]);
        (dados as any).regimeApuracao = '1';  // não-cumulativo → aquisição COM crédito
        const linhas: string[] = buildBlocoA(dados);
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[8]).toBe('50');  // CST_PIS — vem do regime, não do XML
        expect(a170[6]).toBe('01');  // NAT_BC_CRED
        expect(a170[7]).toBe('0');   // IND_ORIG_CRED
    });

    // 🚨 E O CONTRÁRIO, que é o defeito que a troca acima expôs: o CST do XML
    // NÃO pode atravessar para o arquivo numa empresa cumulativa.
    it('cumulativo ignora o CST 50 do FORNECEDOR — sai 70, sem crédito', () => {
        const dados = dadosBase([{
            numero: '112', tipo: 'NFSe', direcao: 'entrada', valorTotal: 500,
            dataEmissao: '2026-07-28', cnpjEmit: '05059447000150',
            itens: [{ nItem: '1', cProd: 'X', xProd: 'X', vProd: 500, cstPis: '50', cstCofins: '50' }],
        }]);
        const linhas: string[] = buildBlocoA(dados);
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[8]).toBe('70');
        expect(a170[6]).toBe('');    // NAT_BC_CRED — não há crédito a apropriar
        expect(a170[7]).toBe('0');   // IND_ORIG_CRED continua, é da DIREÇÃO
    });
});

describe('🚨 0200 — o item sintético do A170 precisa constar da Tabela de Identificação', () => {
    const srcOrchestrator = fs.readFileSync(
        path.resolve(__dirname, '../sefaz-backend/sped-contrib-orchestrator.js'), 'utf8',
    );

    it('o coletor importa a MESMA constante de sped-contrib-blocos.js — nunca uma segunda cópia', () => {
        expect(srcOrchestrator).toMatch(
            /import\s*\{[^}]*COD_ITEM_SERVICO_GENERICO[^}]*\}\s*from\s*'\.\/sped-contrib-blocos\.js'/,
        );
    });

    it('o catálogo 0200 registra o código genérico quando há documento sem itens', () => {
        expect(srcOrchestrator).toMatch(
            /filtrarNotasBlocoA\(notas\)\.some\(n => !\(n\.itens \|\| \[\]\)\.length\)/,
        );
        expect(srcOrchestrator).toContain('itensMap.set(COD_ITEM_SERVICO_GENERICO,');
    });
});
