export interface MitEncerramentoEstado {
    situacao: number | null;
    dataEncerramento: string | null;
    dataEncerramentoLabel: string | null;
    encerrada: boolean;
    emProcessamento: boolean;
    bloqueiaEncerramento: boolean;
}

function firstPresent(...values: any[]): any {
    return values.find(value => value !== undefined && value !== null && value !== '');
}

function pickSituacao(apuracao: any, resumo: any): number | null {
    const value = firstPresent(
        resumo?.situacao,
        resumo?.situacaoApuracao,
        resumo?.SituacaoApuracao,
        apuracao?.situacao,
        apuracao?.situacaoApuracao,
        apuracao?.SituacaoApuracao
    );
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function pickDataEncerramento(apuracao: any, resumo: any): string | null {
    const value = firstPresent(
        resumo?.dataEncerramento,
        resumo?.DataEncerramento,
        apuracao?.dataEncerramento,
        apuracao?.DataEncerramento
    );
    return value ? String(value) : null;
}

export function formatMitDataEncerramento(value: string | null): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, '');
    if (digits.length === 8) {
        return `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}`;
    }
    return value;
}

export function getMitEncerramentoEstado(apuracao: any, resumo: any): MitEncerramentoEstado {
    const situacao = pickSituacao(apuracao, resumo);
    const dataEncerramento = pickDataEncerramento(apuracao, resumo);
    const encerrada = situacao === 3;
    const emProcessamento = situacao === 4;

    return {
        situacao,
        dataEncerramento,
        dataEncerramentoLabel: formatMitDataEncerramento(dataEncerramento),
        encerrada,
        emProcessamento,
        bloqueiaEncerramento: encerrada || emProcessamento,
    };
}
