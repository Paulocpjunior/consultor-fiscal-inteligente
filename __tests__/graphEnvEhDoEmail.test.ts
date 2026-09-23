// ============================================================================
// 🔒 NESTE SERVIÇO, `GRAPH_*` É O E-MAIL — NÃO O SHAREPOINT
//
// 02/09. O painel Diagnóstico → Config classificava `GRAPH_TENANT_ID`,
// `GRAPH_CLIENT_ID` e `GRAPH_CLIENT_SECRET` na categoria **SHAREPOINT**, com o
// impacto *"SharePoint sync de XMLs não roda"* — e isso mandava consertar o
// APLICATIVO ERRADO, no mesmo dia em que o Paulo perguntou DUAS vezes *"o
// e-mail não tínhamos matado ontem?"*.
//
// 📌 MEDIDO no código: neste serviço (`consultor-fiscal-inteligente`) quem lê
// `GRAPH_*` é o envio de e-mail (`graph-provider.js`), a leitura do cofre
// (`graph-mail-reader.js`) e o aviso do Teams (`teams-aviso.js`). **Nenhum é
// SharePoint** — quem fala com o SharePoint é o PROXY, com credenciais DELE.
//
// ⚠️ O nome da variável é o MESMO nos dois serviços, e é isso que faz "matei
// ontem" parecer valer para os dois. Rótulo errado aqui é o achado 18 (21/08)
// na forma mais cara: a pessoa vai, conserta o que já estava certo, e o e-mail
// continua morto.
// ============================================================================
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro
import { CONFIGS_MONITORADAS } from '../sefaz-backend/diagnostico-config-helper.js';

const RAIZ = join(__dirname, '..');
const GRAPH = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'];

describe('🔒 o rótulo do GRAPH_* aponta o aplicativo certo', () => {
    const achar = (chave: string) => (CONFIGS_MONITORADAS as any[]).find((c) => c.chave === chave);

    for (const chave of GRAPH) {
        it(`${chave} é do E-MAIL, não do SharePoint`, () => {
            const c = achar(chave);
            expect(c).toBeTruthy();
            expect(c.categoria).toBe('email');
            // 🚨 O impacto é a frase que decide para ONDE a pessoa vai.
            expect(c.impacto).toMatch(/e-mail/i);
            expect(c.impacto).not.toMatch(/SharePoint sync/i);
        });
    }

    // ⚠️ A do SECRET carrega a diferença por extenso: sem isso, quem já
    // corrigiu o do proxy corrige de novo o mesmo.
    it('o secret diz que o do SharePoint é OUTRO e mora no proxy', () => {
        const c = achar('GRAPH_CLIENT_SECRET');
        expect(c.descricao).toMatch(/proxy/i);
        expect(c.impacto).toMatch(/consultor-fiscal-inteligente/);
    });
});

// 🚨 A CLASSIFICAÇÃO SE PROVA CONTRA O CÓDIGO, não contra a minha memória:
// se um dia alguém fizer este serviço falar com o SharePoint pelo `GRAPH_*`, a
// trava cai e o rótulo é revisto — em vez de envelhecer errado em silêncio.
describe('🔎 quem lê GRAPH_* neste serviço', () => {
    function arquivosJs(dir: string, achados: string[] = []): string[] {
        for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const rel = `${dir}/${e.name}`;
            if (e.isDirectory()) arquivosJs(rel, achados);
            else if (e.name.endsWith('.js')) achados.push(rel);
        }
        return achados;
    }

    // Lê CÓDIGO, nunca a prosa que o explica (a mordida do ISS, 22/08).
    const semComentario = (s: string) => s.split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    it('nenhum leitor de GRAPH_* deste serviço fala com o SharePoint', () => {
        const leitores = arquivosJs('sefaz-backend')
            .filter((f) => /process\.env\.GRAPH_(TENANT_ID|CLIENT_ID|CLIENT_SECRET)/
                .test(semComentario(readFileSync(join(RAIZ, f), 'utf8'))));
        // Guarda contra o silêncio falso: se o glob quebrar, isto passaria
        // verde sem ler nada.
        expect(leitores.length).toBeGreaterThan(0);
        // `graph.microsoft.com/sites` / `/drives` seria SharePoint de verdade.
        for (const f of leitores) {
            const fonte = semComentario(readFileSync(join(RAIZ, f), 'utf8'));
            expect(fonte).not.toMatch(/graph\.microsoft\.com\/v1\.0\/(sites|drives)/);
        }
    });
});
