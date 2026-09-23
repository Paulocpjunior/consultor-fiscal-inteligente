/** Serviço de diagnóstico de configurações operacionais. */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

// 'informativo' = env vazia mas codigo tem default funcionando.
// 'opcional'    = gate de feature opcional (SharePoint/gateway) — so importa
//                 se a empresa usa aquela integracao. Nao bloqueia.
export type CriticidadeConfig = 'critico' | 'alto' | 'medio' | 'informativo' | 'opcional';
// 'segredo_forma_errada' = a env ESTÁ preenchida e o que está nela tem forma
// que a Microsoft recusa (o Secret ID no lugar do Valor, espaço colado).
// Preenchido é STATUS; a forma é RESULTADO.
export type TipoAchado = 'env_vazia' | 'env_via_default' | 'env_opcional' | 'modo_inadequado'
    | 'flag_indefinida' | 'segredo_forma_errada';

export interface AchadoConfig {
    tipo: TipoAchado;
    chave: string;
    categoria: string;
    criticidade: CriticidadeConfig;
    descricao: string;
    impacto: string;
    valorAtual?: string;
}

export interface DiagnosticoConfigResposta {
    ambiente: string;
    resumo: {
        total: number;
        criticos: number;
        altos: number;
        medios: number;
        informativos?: number;
        opcionais?: number;
        ambiente: string;
    };
    achados: AchadoConfig[];
    geradoEm: string;
}

export async function getDiagnosticoConfig(): Promise<DiagnosticoConfigResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/diagnostico-config', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}

// ============================================================================
// 🚨 A SONDA DA CREDENCIAL DO E-MAIL
//
// 02/09, Paulo: *"já tínhamos matado ontem a questão do e-mail"* — e não dava
// para conferir. A credencial do SharePoint foi corrigida ontem e funciona; o
// e-mail é OUTRO aplicativo do Azure, numa variável de MESMO NOME em OUTRO
// serviço. O único jeito de descobrir era mandar uma guia a um cliente e ver
// falhar, que foi como a Sandra descobriu.
//
// ⚠️ Ela PERGUNTA à Microsoft e devolve a resposta — **não envia mensagem a
// ninguém**.
// ============================================================================
export interface CredencialEmailVeredito {
    situacao: 'ok' | 'recusada' | 'nao-configurado';
    cor: 'verde' | 'vermelho';
    titulo: string;
    detalhe: string;
    /** Qual aplicativo do Azure a Microsoft nomeou — é ele que separa e-mail de SharePoint. */
    app: { id: string; nome: string | null } | null;
    /** Onde aquele segredo mora (serviço + variável). */
    onde: string | null;
    respostaMicrosoft?: string;
    testadoEm: string;
}

export async function testarCredencialEmail(): Promise<CredencialEmailVeredito> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/diagnostico-config/testar-credencial-email', {
        method: 'POST', headers,
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
}
