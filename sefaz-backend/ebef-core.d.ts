import type {
  EbefDraft,
  EbefAnalise,
  EbefDocumento,
  EbefRecord,
  EbefStatus,
} from "../services/ebefTypes";
export const EBEF_REGRA: string;
export const EBEF_FONTE: string;
export function novoEbef(ano?: number): EbefDraft;
export function analisarEbef(
  draft: EbefDraft,
  documentos?: EbefDocumento[],
): EbefAnalise;
export function documentoValido(
  tipo: string,
  value: string,
  pais: string,
): boolean;
export function validarAcaoEbef(
  record: EbefRecord,
  action: string,
  role: string,
): EbefStatus;
