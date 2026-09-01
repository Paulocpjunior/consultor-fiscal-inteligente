// ============================================================================
// 🚨 ROTA SEM BOTÃO NÃO É FUNCIONALIDADE — é código morto com cara de entrega
//
// A regra é de 13/08: o rito de fechamento da EFD-Reinf subiu com 23 testes e
// ZERO caminho na interface; ninguém no escritório conseguiria usá-lo, e a
// fila achou que tinha fechado. É a mesma família do E510 "pronto" que ninguém
// gerava e do botão da guia separada, que existia no lugar errado (17/08).
//
// A regra existia escrita e nunca teve trava. Esta varredura fecha a CLASSE:
// rota nova sem chamada no frontend quebra a build, a menos que seja declarada
// aqui COM o motivo — cron do Cloud Scheduler, túnel de app irmão, agente
// externo. Declarar é barato; descobrir três meses depois que a "entrega" nunca
// teve caminho é que é caro.
//
// ⚠️ A HEURÍSTICA É PROPOSITALMENTE SIMPLES (o último segmento do caminho
// aparece em algum .ts/.tsx?) e por isso pode acusar rota chamada por URL
// montada em pedaços. O remédio é declarar a exceção com o motivo, nunca
// afrouxar a varredura: teste que grita sem motivo é teste desligado.
//
// 📌 As declaradas abaixo são o retrato de 21/08 — sete grupos eram órfãos de
// VERDADE (nomeados em "sem caminho na interface"). Elas não foram apagadas:
// apagar rota que talvez alguém chame por fora é decisão do dono, e nomear já
// impede que a próxima sessão as leia como entrega pronta.
// ✂️ Em 22/08 o Paulo mandou dar botão a TODAS ("sim, todas com botão, e NFP
// tbm deve ser corrigido") — a lista encolhe a cada grupo que ganha tela.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');

/** Rota sem chamada no frontend — declarada COM o motivo. */
const SEM_CHAMADA_NA_TELA: Record<string, string> = {
    // ── Crons: quem chama é o Cloud Scheduler, com o segredo no header ──────
    '/autxml-harvest-cron': 'cron',
    '/captura-resumo-cron': 'cron',
    '/cert-alerta-cron': 'cron',
    '/cron-resumo': 'cron',
    '/health-alerta': 'cron',
    '/health-alerta-cron': 'cron',
    '/manifest-cron': 'cron',
    '/nfsesp-cron': 'cron',
    '/nfsesp-cron-now': 'cron (disparo manual pelo Scheduler)',
    '/sae-nfce-cron': 'cron',
    '/sync-cron-health': 'cron (saúde, lida pelo painel via outra rota)',
    '/sync-drenagem-cron': 'cron',
    '/xml-email-arquivo-sp-cron': 'cron',
    '/xml-email-ingest-cron': 'cron',
    '/xml-email-ingest/alerta-cron': 'cron',

    // ── Túnel: quem chama é um APP IRMÃO (DP/Folha, Contábil, Financeiro) ───
    '/empresa-completo': 'túnel do DP/Folha',
    '/fgts/crf': 'túnel do DP/Folha',
    '/movimento-fiscal': 'túnel somente leitura do Consultor Contábil (CCI)',

    // ── Agente local cfi-a3 (captura por A3, fora deste repo) ───────────────
    '/empresas-a3': 'agente local cfi-a3',
    '/upload-batch': 'agente local cfi-a3',

    // ── Portas de cron cuja operação TEM botão por uma porta de admin ──────
    //
    // ✅ 22/08: as SETE órfãs de 21/08 foram todas fechadas (Paulo: "sim, todas
    // com botão, e NFP tbm deve ser corrigido"). O que sobra aqui embaixo não é
    // órfã: é a porta do CRON de uma operação que a tela alcança por outra
    // porta, autenticada por admin — o segredo do cron não vai ao navegador.
    // ✂️ 22/08: as TRÊS da manifestação saíram daqui — ganharam o card
    // "🔎 Fila da manifestação" no Diagnóstico da captura (autorização do Paulo:
    // "sim, todas com botão"). Se a chamada sumir da tela, a varredura acusa.
    // ✂️ 22/08: as duas eram autenticadas pelo SEGREDO DO CRON, e o segredo
    // nunca vai ao navegador (já vazou 2× em cola de terminal). Ganharam
    // botão por uma porta de ADMIN, cada uma do jeito que ela pede:
    //  · `/sincronizar-uma` é a MESMA operação de `/sincronizar` (admin), que
    //    já existia — o que faltava era o botão "🔄 Só esta empresa" na Caixa
    //    Postal; a rota do cron fica como smoke test do Scheduler.
    //  · `/sync-targeted` ganhou a irmã `/sync-targeted-now` (admin, em
    //    background), porque o laço dorme 90s por empresa e uma resposta
    //    síncrona estouraria o navegador. O LAÇO é um só.
    '/sincronizar-uma': 'smoke test do Cloud Scheduler — o botão usa /sincronizar (admin)',
    '/sync-targeted': 'disparo pelo Scheduler — o botão usa /sync-targeted-now (admin)',
    // ✂️ 22/08: `/previa-resumo` ganhou o "👁 Prévia (não envia)" na Carteira e
    // `/guard-status` virou o banner do freio na Central de Emissões.
    // ✂️ 22/08: as TRÊS do NFP saíram daqui — ganharam o card "🔎 Consultas
    // avulsas" na aba Análise, que é onde a pessoa está quando a varredura
    // completa falha em UMA das cinco consultas.
};

function varrer(dir: string, exts: string[], out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (['node_modules', 'dist', '.git', '__tests__'].includes(nome) || nome.startsWith('.')) continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) varrer(p, exts, out);
        else if (exts.some((e) => nome.endsWith(e))) out.push(p);
    }
    return out;
}

describe('🚨 rota nova nasce com o caminho que a chama', () => {
    it('nenhuma rota fica sem chamada e sem motivo declarado', () => {
        const front = varrer(RAIZ, ['.ts', '.tsx'])
            .map((p) => readFileSync(p, 'utf8'))
            .join('\n');

        const orfas: string[] = [];
        for (const arquivo of varrer(join(RAIZ, 'sefaz-backend'), ['.js'])) {
            const rel = arquivo.replace(`${RAIZ}/`, '');
            const src = readFileSync(arquivo, 'utf8');
            for (const m of src.matchAll(/router\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]/g)) {
                const caminho = m[2];
                const segmento = caminho.replace(/\/$/, '').split('/').pop() || '';
                if (!segmento || segmento.startsWith(':')) continue;
                if (SEM_CHAMADA_NA_TELA[caminho]) continue;
                if (front.includes(segmento)) continue;
                orfas.push(`${rel}  ${m[1].toUpperCase()} ${caminho}`);
            }
        }

        if (orfas.length) {
            throw new Error(
                '\n\n🚧 ROTA SEM CAMINHO NA INTERFACE\n\n'
                + orfas.map((x) => `  · ${x}`).join('\n')
                + '\n\nRota que nenhuma tela chama não é funcionalidade — é código morto com cara de\n'
                + 'entrega (13/08: o rito da EFD-Reinf subiu com 23 testes e zero botão).\n\n'
                + 'Ou nasce com o botão que a chama NO MESMO PR, ou se declara em\n'
                + 'SEM_CHAMADA_NA_TELA COM o motivo (cron, túnel de app irmão, agente externo).\n',
            );
        }
    });

    it('toda exceção declarada tem motivo escrito — lista sem motivo é lista que envelhece', () => {
        for (const [rota, motivo] of Object.entries(SEM_CHAMADA_NA_TELA)) {
            expect({ rota, temMotivo: motivo.trim().length >= 4 }).toEqual({ rota, temMotivo: true });
        }
    });
});
