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
// 📌 As 29 declaradas abaixo são o retrato de 21/08 — sete delas são órfãs de
// VERDADE (nomeadas no grupo "sem caminho na interface"). Elas não foram
// apagadas: apagar rota que talvez alguém chame por fora é decisão do dono, e
// nomear já impede que a próxima sessão as leia como entrega pronta.
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

    // ── Agente local cfi-a3 (captura por A3, fora deste repo) ───────────────
    '/empresas-a3': 'agente local cfi-a3',
    '/upload-batch': 'agente local cfi-a3',

    // ── SEM CAMINHO NA INTERFACE — órfãs de verdade, NOMEADAS ──────────────
    //
    // Não foram apagadas: remover rota que talvez alguém chame por fora é
    // decisão do Paulo. O que não pode é a próxima sessão lê-las como entrega.
    '/manifest-elegiveis': 'ÓRFÃ — lista de elegíveis à manifestação que nenhuma tela mostra',
    '/manifest-one': 'ÓRFÃ — manifestar UM documento; a tela só tem o lote (manifest-pending)',
    '/manifest-reset-falhas-infra': 'ÓRFÃ — manutenção, sem botão',
    '/sincronizar-uma': 'ÓRFÃ — caixa postal de UMA empresa, sem botão',
    '/sync-targeted': 'ÓRFÃ — sincronização dirigida, sem botão',
    '/previa-resumo': 'ÓRFÃ — prévia do resumo de notificações, sem tela',
    '/guard-status': 'ÓRFÃ — status do guard de emissão, sem tela',
    '/situacao-fiscal': 'ÓRFÃ — a tela do NFP só chama /analise-completa',
    '/divida-ativa': 'ÓRFÃ — idem',
    '/cnds-publicas': 'ÓRFÃ — idem',
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
