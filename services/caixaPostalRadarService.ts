/**
 * Serviço RADAR de mensagens críticas não lidas no e-CAC / DET / DEC / DJE.
 * Não cria endpoint novo — consome o /caixa-postal/mensagens?naoLidas=true
 * existente e classifica por urgência fiscal real.
 */
import { getAuth } from 'firebase/auth';
import {
    classificarUrgencia, calcularRisco, diasEntre, parseDate,
    type Urgencia,
} from './caixaPostalRadarLogic';

export type { Urgencia };

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
        base.riscoCalculado = calcularRisco({ urgencia, diasParado, diasParaPrazo });
        return base;
    }).sort((a, b) => b.riscoCalculado - a.riscoCalculado);
    return {
        mensagens: classificadas.slice(0, LIMITE_CLIENTE),
        totalBruto,
        truncado: totalBruto > LIMITE_CLIENTE,
    };
}

export { categoriaLabel };
