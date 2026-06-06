/**
 * Serviço RADAR de mensagens críticas não lidas no e-CAC / DET / DEC / DJE.
 * Não cria endpoint novo — consome o /caixa-postal/mensagens?naoLidas=true
 * existente e classifica por urgência fiscal real.
 */
import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface MensagemRaw {
    mensagemId: string;
    empresaCnpj: string;
    empresaNome?: string;
    empresaId?: string;
    assunto: string;
    remetente: string;
    categoria: string;
    corpo: string;
    dataEnvio: string;
    dataLeitura: string | null;
    fonte: string;
    prazoResposta: string | null;
}

// Categorias que exigem AÇÃO/RESPOSTA (não meros informativos).
const CRITICAS = new Set(['intimacao', 'malha', 'exclusao', 'det_auto_infracao', 'dje_citacao']);
const ALTAS = new Set(['dec_intimacao', 'dje_intimacao', 'emac_notificacao', 'prefeitura_sp_iss']);
// MEDIAS: det_notificacao (notificação simples DET, requer ciência)
const MEDIAS = new Set(['det_notificacao']);
// LOWS: informativo, dec_comunicado, prefeitura_sp_nfse, prefeitura_sp_comunicado

export type Urgencia = 'critica' | 'alta' | 'media' | 'baixa';

export interface MensagemClassificada extends MensagemRaw {
    urgencia: Urgencia;
    diasParado: number;       // dias desde dataEnvio
    diasParaPrazo: number | null;  // dias até prazoResposta (negativo = vencido)
    riscoCalculado: number;   // score 0-100 para ordenação
}

const categoriaLabel: Record<string, string> = {
    intimacao: 'Intimação RFB',
    malha: 'Malha fiscal',
    exclusao: 'Exclusão Simples',
    det_auto_infracao: 'Auto de infração (DET)',
    det_notificacao: 'Notificação DET',
    dec_intimacao: 'Intimação DEC',
    dec_comunicado: 'Comunicado DEC',
    dje_citacao: 'Citação judicial (DJE)',
    dje_intimacao: 'Intimação judicial (DJE)',
    emac_notificacao: 'Notificação EMac (SP)',
    prefeitura_sp_iss: 'ISS Prefeitura SP',
    prefeitura_sp_nfse: 'NFSe Prefeitura SP',
    prefeitura_sp_comunicado: 'Comunicado Prefeitura SP',
    informativo: 'Informativo',
};

function classificarUrgencia(cat: string): Urgencia {
    if (CRITICAS.has(cat)) return 'critica';
    if (ALTAS.has(cat)) return 'alta';
    if (MEDIAS.has(cat)) return 'media';
    return 'baixa';
}

function parseDate(s: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
}

function diasEntre(a: Date, b: Date): number {
    return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function calcularRisco(m: MensagemClassificada): number {
    // Urgência base
    const baseUrg = { critica: 60, alta: 40, media: 20, baixa: 5 }[m.urgencia];
    // Idade (dias parado, cap em 30 = +30)
    const idade = Math.min(m.diasParado, 30);
    // Prazo (se está perto/vencido)
    let prazoBonus = 0;
    if (m.diasParaPrazo != null) {
        if (m.diasParaPrazo < 0) prazoBonus = 50;        // já venceu
        else if (m.diasParaPrazo <= 1) prazoBonus = 30;  // vence amanhã
        else if (m.diasParaPrazo <= 5) prazoBonus = 15;
    }
    return Math.min(100, baseUrg + idade + prazoBonus);
}

export interface RadarResposta {
    mensagens: MensagemClassificada[];
    /** Total bruto retornado pelo backend antes de cortar */
    totalBruto: number;
    /** true se a lista foi truncada — UI mostra "exibindo X de N" */
    truncado: boolean;
}

const LIMITE_CLIENTE = 500;

export async function getRadarCaixaPostal(): Promise<RadarResposta> {
    const headers = await authHeader();
    const res = await fetch('/api/admin/caixa-postal/mensagens?naoLidas=true', { headers });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
    }
    const raw: MensagemRaw[] = await res.json();
    const totalBruto = raw.length;
    const agora = new Date();
    // Classifica TODAS pra poder ordenar por risco (mas paga o custo só uma vez).
    const classificadas = raw.map((m): MensagemClassificada => {
        const dataEnvio = parseDate(m.dataEnvio);
        const prazo = parseDate(m.prazoResposta);
        const urgencia = classificarUrgencia(m.categoria);
        const diasParado = dataEnvio ? diasEntre(dataEnvio, agora) : 0;
        const diasParaPrazo = prazo ? diasEntre(agora, prazo) : null;
        const base: MensagemClassificada = {
            ...m, urgencia, diasParado, diasParaPrazo, riscoCalculado: 0,
        };
        base.riscoCalculado = calcularRisco(base);
        return base;
    }).sort((a, b) => b.riscoCalculado - a.riscoCalculado);
    return {
        mensagens: classificadas.slice(0, LIMITE_CLIENTE),
        totalBruto,
        truncado: totalBruto > LIMITE_CLIENTE,
    };
}

export { categoriaLabel };
