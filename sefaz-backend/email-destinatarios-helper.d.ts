export function parseDestinatarios(raw?: string, fallback?: string): string[];

export interface DestinatariosLidos {
    validos: string[];
    invalidos: Array<{ valor: string; motivo: string }>;
    vazio: boolean;
}

export function lerDestinatarios(raw?: string): DestinatariosLidos;
export function recusaDeDestinatario(lidos: DestinatariosLidos): string | null;
export function listaDeEnvio(campo?: string | string[] | null): {
    lista: string[];
    invalidos: Array<{ valor: string; motivo: string }>;
};
