/**
 * legalizacaoLogic.ts — lógica PURA do módulo Legalização no frontend:
 * farol de vencimentos, rótulos e formatação.
 *
 * ESPELHO backend: sefaz-backend/legalizacao-helper.js (mesmos limiares —
 * manter em sincronia manual, mesmo pacto do calendarioFiscal ↔
 * tarefas-orchestrator). Testado em __tests__/legalizacaoLogic.test.ts.
 */

export type NivelVencimento = 'sem_data' | 'vencido' | 'critico' | 'atencao' | 'ok';

export type CategoriaVencimento = 'certificado' | 'certidao' | 'parcelamento' | 'procuracao' | 'processo';

export type TipoProcesso =
    | 'abertura' | 'alteracao_contratual' | 'encerramento' | 'contrato'
    | 'parcelamento' | 'certificado_digital' | 'certidao' | 'procuracao'
    | 'cadastro' | 'permissao_especial' | 'regularizacao' | 'outro';

export type StatusProcesso =
    | 'solicitado' | 'em_andamento' | 'aguardando_orgao'
    | 'aguardando_cliente' | 'concluido' | 'cancelado';

export const TIPO_PROCESSO_LABEL: Record<TipoProcesso, string> = {
    abertura: 'Abertura de empresa',
    alteracao_contratual: 'Alteração contratual',
    encerramento: 'Encerramento',
    contrato: 'Contrato',
    parcelamento: 'Parcelamento',
    certificado_digital: 'Certificado digital (venda/renovação)',
    certidao: 'Certidão',
    procuracao: 'Procuração',
    cadastro: 'Cadastro',
    permissao_especial: 'Permissão especial',
    regularizacao: 'Regularização',
    outro: 'Outro',
};

export const STATUS_PROCESSO_LABEL: Record<StatusProcesso, string> = {
    solicitado: 'Solicitado',
    em_andamento: 'Em andamento',
    aguardando_orgao: 'Aguardando órgão',
    aguardando_cliente: 'Aguardando cliente',
    concluido: 'Concluído',
    cancelado: 'Cancelado',
};

export const CATEGORIA_LABEL: Record<CategoriaVencimento, string> = {
    certificado: 'Certificado Digital',
    certidao: 'Certidão',
    parcelamento: 'Parcelamento',
    procuracao: 'Procuração',
    processo: 'Processo',
};

/** Dias entre hoje (00:00 local) e a data "YYYY-MM-DD"; negativo = vencido. */
export function diasAteVencimento(dataVencimento: string | null | undefined, hoje = new Date()): number | null {
    const m = String(dataVencimento || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    // Componentes LOCAIS evitam o off-by-one de fuso (new Date('YYYY-MM-DD') é UTC).
    const v = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const h = new Date(hoje.getTime());
    v.setHours(0, 0, 0, 0);
    h.setHours(0, 0, 0, 0);
    return Math.round((v.getTime() - h.getTime()) / (24 * 60 * 60 * 1000));
}

/** Mesmos limiares do backend: <0 vencido, ≤7 crítico, ≤30 atenção. */
export function classificarVencimento(diasRestantes: number | null): NivelVencimento {
    if (diasRestantes === null || Number.isNaN(diasRestantes)) return 'sem_data';
    if (diasRestantes < 0) return 'vencido';
    if (diasRestantes <= 7) return 'critico';
    if (diasRestantes <= 30) return 'atencao';
    return 'ok';
}

export const NIVEL_META: Record<NivelVencimento, { label: string; emoji: string; cssVar: string }> = {
    vencido: { label: 'Vencido', emoji: '🔴', cssVar: 'var(--danger)' },
    critico: { label: 'Crítico (≤7d)', emoji: '🟠', cssVar: 'var(--danger)' },
    atencao: { label: 'Atenção (≤30d)', emoji: '🟡', cssVar: 'var(--warning)' },
    ok: { label: 'Em dia', emoji: '🟢', cssVar: 'var(--success)' },
    sem_data: { label: 'Sem data', emoji: '⚪', cssVar: 'var(--text-muted)' },
};

/** "12345678000199" → "12.345.678/0001-99" (como veio, se não tiver 14 dígitos). */
export function fmtCnpj(cnpj: string | null | undefined): string {
    const d = String(cnpj || '').replace(/\D/g, '');
    if (d.length !== 14) return String(cnpj || '');
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** "2026-08-05" → "05/08/2026" (string pura, sem Date). */
export function fmtDataBr(iso: string | null | undefined): string {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}
