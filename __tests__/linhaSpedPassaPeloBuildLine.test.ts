// ============================================================================
// 🔒 TODA LINHA DE SPED PASSA PELO `buildLine` — a trava da CLASSE
//
// 29/08. Em UM dia esta casa achou DUAS instâncias vivas do mesmo defeito, e as
// duas do jeito mais caro: lendo módulo a módulo, por acaso, enquanto eu ia
// escrever outra coisa.
//
//  · o **bloco G (CIAP)** montava `[...].join('|')` — G001, G110, G125 e G990
//    saíam COLADOS na cauda do bloco E, tudo numa linha;
//  · o **C195/C197 (DIFAL de aquisição)** fazia o mesmo, e saía colado na linha
//    anterior do bloco C.
//
// 🚨 O orquestrador junta os blocos com **`join('')`** — é o `buildLine` que põe
// o `|` inicial e o `\r\n`. Sem ele o arquivo não tem linhas: tem uma só.
// **O PVA não IMPORTA o arquivo**; não é recusa de campo que se conserta e
// reenvia, é o arquivo inteiro barrado na porta.
//
// 📌 A LIÇÃO ESTAVA ESCRITA DESDE 21/08, no caso REALITY (E200/E210/E220/E250):
// *"R15 da prevalidação fecha a CLASSE — módulo novo que bypassar o buildLine
// cai nela"*. E era verdade sobre o ARQUIVO. O que ela não faz é alcançar um
// bloco que **nenhum cliente gerou**: o CIAP vale para uma empresa (bloqueada na
// captura) e o C197 só sai com o COD_AJ estadual cadastrado (ninguém cadastrou).
// Os dois envelheceram protegidos no papel e quebrados no código.
//
// 📌 REGRA QUE FICA: **trava que roda sobre o ARQUIVO só protege o bloco que
// alguém GEROU.** Onde o gerador depende de um cadastro que ninguém preencheu,
// a trava de forma tem de rodar sobre o CÓDIGO. Esta é essa trava — e ela nasce
// VERDE, que é como trava deve nascer.
//
// ⚠️ E ela é ESTREITA de propósito: só casa array cujo PRIMEIRO elemento é um
// código de registro de 4 caracteres seguido de `.join('|')`, ou string literal
// que já começa com `REG|`. Módulo que devolve ARRAYS DE CAMPOS (o desenho
// certo — `sped-bloco-e-st.js` e `sped-bloco-k.js` fazem isso, e quem formata é
// a casca) não casa. Alarme sobre código certo é o que faz a equipe desligar a
// trava.
// ============================================================================
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', 'sefaz-backend');

/** Varredura lê CÓDIGO, nunca PROSA — o comentário que EXPLICA a correção cita
 *  a forma antiga e reprovaria a correção (a mordida do ISS, 22/08). */
const semComentario = (s: string) => s
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

/** Um código de registro do SPED: 4 caracteres, letra ou dígito, maiúsculo. */
const REG = "[0-9A-Z]{4}";

describe('🔒 nenhum módulo monta linha de SPED à mão', () => {
    const arquivos = readdirSync(DIR).filter((n) => n.endsWith('.js'));

    it('a varredura tem o que varrer', () => {
        // Guarda: se o glob quebrar, o teste passaria verde sem ler nada — que
        // é o "silêncio falso" que esta casa persegue desde 22/08.
        expect(arquivos.length).toBeGreaterThan(50);
    });

    it("array de campos com .join('|') não vira linha de arquivo", () => {
        const infratores: string[] = [];
        for (const nome of arquivos) {
            const src = semComentario(readFileSync(join(DIR, nome), 'utf8'));
            const re = new RegExp(`\\[\\s*'(${REG})'[^\\[\\]]{0,900}?\\]\\s*\\.join\\('\\|'\\)`, 'gs');
            for (const m of src.matchAll(re)) infratores.push(`${nome}  → registro ${m[1]}`);
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 LINHA DE SPED MONTADA À MÃO\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO orquestrador junta os blocos com join(\'\') — é o `buildLine` que põe o `|`\n'
                + 'inicial e o `\\r\\n`. Sem ele o bloco inteiro sai GRUDADO numa linha só, e o PVA\n'
                + 'NÃO IMPORTA o arquivo.\n\n'
                + 'Use `fmt.buildLine([...])` (sem o elemento vazio no fim — ele já fecha com `|`),\n'
                + 'ou devolva ARRAYS DE CAMPOS e deixe a casca formatar, como o sped-bloco-e-st.js.\n\n'
                + 'Casos reais: bloco G (CIAP) e C195/C197 (DIFAL), os dois em 29/08 — e os dois\n'
                + 'passaram despercebidos porque nenhum cliente gerava aqueles registros.\n',
            );
        }
    });

    it('string literal começando com o código do registro também não', () => {
        const infratores: string[] = [];
        for (const nome of arquivos) {
            const src = semComentario(readFileSync(join(DIR, nome), 'utf8'));
            const re = new RegExp(`(?:push|return)\\s*\\(\\s*[\`']?(${REG})\\|`, 'g');
            for (const m of src.matchAll(re)) infratores.push(`${nome}  → registro ${m[1]}`);
        }
        expect(infratores).toEqual([]);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 E O RESULTADO SE CONFERE NA SAÍDA: os dois módulos que quebraram entregam
// linha bem-formada. A varredura pega a FORMA do código; esta pega o que sai.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 e os dois módulos que quebraram entregam linha bem-formada', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { montarLinhasBlocoG, apurarCiap } = require('../sefaz-backend/sped-bloco-g.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { montarC197Difal } = require('../sefaz-backend/sped-difal-c197.js');
    const BEM_FORMADA = /^\|[0-9A-Z]{4}\|.*\|\r\n$/;

    it('bloco G', () => {
        const linhas = montarLinhasBlocoG({
            apuracao: apurarCiap({
                bens: [{
                    codigo: 'A', descricao: 'A', tipo: 'bem', dataMovimentacao: '2026-06-01',
                    tipoMovimentacao: 'SI', numeroParcela: 1, creditoIcmsProprio: 480,
                    creditoIcmsSt: 0, creditoIcmsFrete: 0, creditoIcmsDifal: 0,
                }],
                saldoInicial: 0, saidasTributadas: 100, saidasTotais: 100,
            }),
            dtIni: '2026-06-01', dtFin: '2026-06-30',
        });
        expect(linhas.length).toBeGreaterThan(2);
        for (const l of linhas) expect(l).toMatch(BEM_FORMADA);
    });

    it('C195/C197 do DIFAL', () => {
        const r = montarC197Difal({
            notas: [{
                chave: 'CH1', numero: '9', direcao: 'entrada', status: 'autorizado',
                ufEmit: 'MG', ufDest: 'SP', cnpjEmit: '22222222000191',
                empresaCnpj: '11111111000191',
                itens: [{ cfop: '2556', vProd: 1000, vICMS: 120, pICMS: 12, vBC: 1000 }],
                totais: { vNF: 1000 },
            }],
            ufEmpresa: 'SP', aliqInternaPadrao: 18, aliqInternaPorChave: {},
            codigoAjuste: 'SP50000001', codObservacao: '001',
        });
        expect(r.linhasPorChave.CH1).toHaveLength(2);
        for (const l of r.linhasPorChave.CH1) expect(l).toMatch(BEM_FORMADA);
    });
});
