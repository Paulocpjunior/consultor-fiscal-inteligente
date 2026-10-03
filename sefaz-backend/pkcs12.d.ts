import type { KeyObject } from 'node:crypto';

export class ErroPfx extends Error {
    codigo: 'PFX_INVALIDO' | 'SENHA_INCORRETA' | 'SEM_CHAVE' | 'SEM_CERTIFICADO';
    constructor(codigo: string, mensagem: string);
}

export interface AtributoDoNome { oid: string; shortName: string; name: string; value: string }

export interface CertificadoLido {
    der: Buffer;
    pem: string;
    subject: AtributoDoNome[];
    issuer: AtributoDoNome[];
    notBefore: Date;
    notAfter: Date;
    fingerprintSha1: string;
    fingerprintSha256: string;
}

export interface PfxAberto {
    pemKey: string;
    pemCert: string;
    chave: KeyObject;
    certificado: CertificadoLido;
    cadeia: CertificadoLido[];
}

export function abrirPfx(pfxBuffer: Buffer, senha: string): PfxAberto;
export function lerCertificado(entrada: Buffer | string): CertificadoLido;
export function campoDoNome(attrs: AtributoDoNome[], nomeCurto: string): string;
export function nomeComoTexto(attrs: AtributoDoNome[]): string;
export function rc2DecifrarBlocoParaTeste(chave: Buffer, bitsEfetivos: number, bloco: Buffer): Buffer;
