// ============================================================================
// 🚨 A DATA ATRAVESSAVA O TÚNEL CRUA — e o R-4020 recusava do outro lado
//
// 02/09, print do Paulo no Consultor Contábil:
//   "Nenhum beneficiário pôde ser convertido em evento"
//   "ELEVADORES ATLAS SCHINDLER LTDA. — R-4020 inválido:
//    - pagamentos[0].dtFG deve ser AAAA-MM-DD"
//
// 📌 O `dhEmi` chega em TRÊS formas neste app — `2026-08-14T08:35:36-03:00`
// (XML ABRASF), `11/05/2026 14:31:31` (portal de SP) e Timestamp do Firestore
// — e os túneis mandavam `texto(...)`, ou seja o que estivesse lá.
//
// 🔎 E A VARREDURA MOSTROU QUE NÃO ERA UM: eram **quatro**. Corrigido o R-4020,
// esta trava achou o R-2010, o **R-2055** e a **NFTS** — que faz `.slice(0,10)`
// e devolve `11/05/2026` sobre a forma do portal, numa DECLARAÇÃO da
// prefeitura. Trava por LISTA cobriria o que eu lembrei; a varredura cobriu o
// que eu não lembrava (a lição de 13/08).
//
// ✂️ QUEM RESPONDE É O DONO (`dataDeclaradaDoDocumento`): ele lê o dia do
// TEXTO, sem conversão de fuso — `new Date('11/05/2026')` é 5 de NOVEMBRO — e
// devolve `''` para o ilegível.
//
// 🔒 OS DOIS ERROS TÊM CUSTOS DIFERENTES: data ilegível vira **null** e o
// evento é RECUSADO (ruidoso, mas seguro); data CHUTADA vira evento **ACEITO**
// declarando o fato gerador em outra competência — e a Receita não devolve.
//
// ⚠️ A ASSINATURA É ESTREITA DE PROPÓSITO. Ela casa só a ATRIBUIÇÃO de um
// campo de DATA a partir de `dhEmi`. Não casa cálculo de IDADE (`getTime()`),
// ordenação por texto, nem a GRAVAÇÃO do documento como ele chegou — são
// outras perguntas, e alarme sobre código certo é o jeito conhecido de a
// equipe desligar a trava.
// ============================================================================
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const RAIZ = join(__dirname, '..');

// Campo de DATA sendo montado a partir do `dhEmi`.
const SIG = /^\s*(dtFG|dtEmissao|dataFatoGerador|dataEmissao|data)\s*:\s*([^,;]*dhEmi[^,;]*)/;
// O dono, ou o formatador do SPED — que já delega ao dono e só TRADUZ para
// `DDMMAAAA` (a régua de 22/08).
const PELO_DONO = /dataDeclaradaDoDocumento|formatDate/;

// ⚠️ Exceção se declara COM o motivo, nunca apagando a assinatura.
const DECLARADOS: Record<string, string> = {
    // GRAVAÇÃO do documento como a FONTE o entregou: aqui a forma crua é o que
    // o documento diz, e normalizar na entrada apagaria a forma original. Quem
    // normaliza é a LEITURA — a régua desta casa desde sempre.
    'sefaz-backend/nfse-nacional-dfe-importer.js': 'grava o documento como ele chegou',
    'sefaz-backend/sync-routes.js': 'grava o documento como ele chegou',
    // EMISSÃO de DPS: `new Date()` ali é o instante da emissão que o app está
    // fazendo agora, não a data de um documento de terceiro.
    'sefaz-backend/nfse-nacional-provider.js': 'emite documento próprio — a data é a de agora',
    // Listagem de DIAGNÓSTICO (conferência de chaves): não vira arquivo nem
    // atravessa fronteira; mostra o campo como está gravado.
    'sefaz-backend/sped-fiscal-routes.js': 'listagem de diagnóstico, não vira arquivo',
};

function arquivos(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules' || nome.startsWith('.')) continue;
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) { arquivos(caminho, out); continue; }
        if (/\.js$/.test(nome) && !nome.endsWith('.d.ts')) out.push(caminho);
    }
    return out;
}

// Lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS, 22/08) — o
// comentário desta correção cita `dhEmi` e reprovaria a própria correção.
function semComentario(src: string): string[] {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => (/^\s*\/\//.test(l) ? '' : l));
}

describe('🚨 data de documento que atravessa fronteira passa pelo DONO', () => {
    // Guarda contra o silêncio falso: se o glob quebrar, isto passaria verde
    // sem ler nada — o defeito que esta casa persegue desde 22/08.
    it('a varredura tem o que ler', () => {
        expect(arquivos(join(RAIZ, 'sefaz-backend')).length).toBeGreaterThan(100);
    });

    it('nenhum campo de data é montado do `dhEmi` cru', () => {
        const infratores: string[] = [];
        for (const arquivo of arquivos(join(RAIZ, 'sefaz-backend'))) {
            const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
            if (DECLARADOS[rel]) continue;
            semComentario(readFileSync(arquivo, 'utf8')).forEach((linha, i) => {
                const m = linha.match(SIG);
                if (m && !PELO_DONO.test(m[2])) infratores.push(`${rel}:${i + 1}  ${linha.trim()}`);
            });
        }
        if (infratores.length) {
            throw new Error(
                '\n\n🚧 DATA DE DOCUMENTO MONTADA DO `dhEmi` CRU\n\n'
                + infratores.map((x) => `  · ${x}`).join('\n')
                + '\n\nO `dhEmi` chega em TRÊS formas: `2026-08-14T08:35:36-03:00` (XML ABRASF),\n'
                + '`11/05/2026 14:31:31` (portal de SP) e Timestamp do Firestore. Texto cru vira\n'
                + 'data que o outro lado não aceita — foi assim que o R-4020 voltou com\n'
                + '"pagamentos[0].dtFG deve ser AAAA-MM-DD" (02/09).\n\n'
                + 'Use `dataDeclaradaDoDocumento` (sefaz-backend/xml-metadata-helper.js).\n'
                + 'Ilegível vira null — NUNCA a data de hoje: fato gerador chutado é evento\n'
                + 'ACEITO declarando outra competência, e a Receita não devolve.\n\n'
                + 'Se a sua linha GRAVA o documento como ele chegou (e não atravessa\n'
                + 'fronteira), declare a exceção COM o motivo em DECLARADOS.\n',
            );
        }
    });
});

// 🔒 As exceções são conferidas contra o CÓDIGO: arquivo que sumir ou parar de
// casar a assinatura vira exceção órfã, e exceção órfã envelhece em silêncio
// dizendo que cobre algo que já não existe.
describe('🔎 as exceções declaradas ainda existem e ainda casam', () => {
    for (const [rel, motivo] of Object.entries(DECLARADOS)) {
        it(`${rel} — ${motivo}`, () => {
            const src = readFileSync(join(RAIZ, rel), 'utf8');
            const casa = semComentario(src).some((l) => {
                const m = l.match(SIG);
                return !!m && !PELO_DONO.test(m[2]);
            });
            expect(casa).toBe(true);
        });
    }
});
