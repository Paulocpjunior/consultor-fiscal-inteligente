export const NFSE_PROPRIA: Readonly<{ ESPERADA: 'esperada'; NAO_EMITE: 'nao-emite' }>;
export const MOTIVO_MINIMO_NFSE: number;
export interface MarcaSemNfse { por: string | null; em: string | null; motivo: string | null }
export function marcaSemEmissaoDeNfse(rotinaParametros: any): MarcaSemNfse | null;
export function conferirMarcaSemNfse(p?: { naoEmite?: boolean; motivo?: string; quem?: string | null; agoraIso?: string }):
    { ok: true; valor: { nfsePropria: string; nfsePropriaMarca: MarcaSemNfse } } | { ok: false; erro: string };
export function textoDaMarcaNfse(marca: MarcaSemNfse | null): string;
export function efeitoDaMarcaNfse(iss: { situacao?: string; notas?: number } | null, marca: MarcaSemNfse | null):
    { zeroDeclarado: boolean; conflito: boolean; podeMarcar: boolean };
