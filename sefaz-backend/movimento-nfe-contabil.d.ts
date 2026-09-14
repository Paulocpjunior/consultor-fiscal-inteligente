export interface MovimentoNfePayload {
    contrato: 'movimento_fiscal_cfi_v1'; cnpjEmpresa: string; competencia: string; movimento: 'entrada' | 'saida';
    notas: Array<{ idOrigem: string; numero: string; chave: string; modelo: string; data: string; valor: number; participanteNome: string | null; participanteDocumento: string; origemDocumento: string; gruposCfop: Array<{cfop: string; valor: number}> }>;
    resumo: { notas: number; nfe: number; nfce: number; total: number; canceladas: number; foraPorLacuna: number };
    pendencias: Array<{id: string | null; numero: string | null; chave: string | null; motivo: string}>;
    bloqueado: boolean; ressalvas: string[];
}
export function montarMovimentoNfeContabil(params: { cnpjEmpresa: string; competencia: string; movimento: string; documentos?: any[] }): MovimentoNfePayload;
