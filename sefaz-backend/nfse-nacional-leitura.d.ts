/**
 * Tipos de `nfse-nacional-leitura.js` — o dono da leitura da NFS-e do padrão
 * NACIONAL (ADN), lido pelo backend (captura) e pelo front (importação manual).
 *
 * ⚠️ Este `.d.ts` nasce no MESMO PR do `.js` (regra de 20/08): tipo declarando
 * o que a implementação não exporta compila feliz e estoura no primeiro clique.
 */

export interface ParticipanteNfseNacional {
    cnpjCpf: string;
    nome: string;
    im: string;
    uf: string;
    codMunIBGE: string;
    logradouro: string;
    numero: string;
    bairro: string;
    cep: string;
}

export interface ValoresNfseNacional {
    /** null = não encontrado no arquivo. NUNCA zero por ausência. */
    servico: number | null;
    baseCalculo: number | null;
    aliquotaIss: number | null;
    iss: number | null;
    /** null = a nota não diz; true/false = ela diz. */
    issRetido: boolean | null;
    liquido: number | null;
    /** Sempre false hoje: o leiaute do <tribFed> não está provado neste repo. */
    retencoesFederaisGravadas: boolean;
}

export interface NfseNacionalLida {
    chave: string;
    numero: string;
    dhEmi: string;
    competencia: string;
    codMunicipio: string;
    prestador: ParticipanteNfseNacional | null;
    tomador: ParticipanteNfseNacional | null;
    valores: ValoresNfseNacional;
    /** O que o arquivo não respondeu — dito, nunca preenchido no escuro. */
    lacunas: string[];
}

export function ehNfseNacional(xml: string): boolean;
export function lerNfseNacional(xml: string): NfseNacionalLida;
