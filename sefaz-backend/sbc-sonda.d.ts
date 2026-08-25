// Tipos escritos À MÃO — regra de 20/08: campo novo aqui e no `.js` no MESMO
// PR. O sentido perigoso é declarar o que o `.js` não exporta (compila e
// estoura no primeiro clique); `dtsNaoPrometeFantasma` cobre isso.
export const PORTA_SIP_TLS: number;

export function montarSipOptions(p: {
    host: string; porta?: number; origem?: string; id: string; ramo: string;
}): string;

export function lerRespostaSip(texto: unknown):
    | { respondeu: false; motivo: string }
    | { respondeu: true; codigo: number; frase: string | null; servidor: string | null };

export function nomeCasaComCertificado(
    hostname: unknown,
    cert?: { sujeitoCN?: string | null; alternativos?: string[] },
): boolean;

export interface CertificadoLido {
    situacao: 'cadeia-nao-confiavel' | 'nome-nao-bate' | 'vencido' | 'vencendo' | 'ok';
    grave: boolean;
    motivo: string;
    acao: string | null;
}

export function interpretarCertificado(p: {
    autorizado?: boolean; erroAutorizacao?: string | null;
    sujeitoCN?: string | null; alternativos?: string[];
    validoAte?: string | Date | null; hostname: string; agora?: Date;
}): CertificadoLido;

export function concluirSondaSbc(p: {
    hostname?: string | null; porta?: number;
    dns?: { ok: boolean; erro?: string | null; enderecos?: string[] } | null;
    tcp?: { ok: boolean; erro?: string | null } | null;
    tls?: { ok: boolean; erro?: string | null; protocolo?: string | null } | null;
    certificado?: CertificadoLido | null;
    sip?: { respondeu: boolean; motivo?: string; codigo?: number; frase?: string | null } | null;
}): {
    veredito: 'aprovado' | 'reprovado' | 'indeterminado';
    motivo: string;
    acao: string;
    ressalvas?: string[];
};
