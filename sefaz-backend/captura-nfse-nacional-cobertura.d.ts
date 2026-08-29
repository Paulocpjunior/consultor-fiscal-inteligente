export interface CoberturaNfseNacional {
    situacao: 'nao-se-aplica' | 'adn-sem-visita' | 'adn-nao-lido' | 'adn-sem-movimento' | 'adn-entregue';
    cor: 'neutro' | 'atencao' | 'ok';
    aplicavel: boolean;
    entregou: boolean | null;
    texto: string | null;
    acao: string | null;
    entregueEm: number | null;
    diasDesdeEntrega: number | null;
    ultNSU?: number;
    maxNSU?: number;
}
export function coberturaNfseNacional(p?: {
    aplicavel?: boolean;
    state?: unknown;
    agoraMs?: number;
}): CoberturaNfseNacional;
export function resumirCoberturaNfseNacional(coberturas: unknown): {
    nfseNacTotal: number;
    nfseNacSemVisita: number;
    nfseNacNaoLido: number;
    nfseNacSemMovimento: number;
    nfseNacEntregue: number;
};
