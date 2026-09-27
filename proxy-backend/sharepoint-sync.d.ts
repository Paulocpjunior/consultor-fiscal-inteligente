/** Tipos mínimos do proxy do SharePoint para os testes do app (o proxy é JS puro). */
export function listarPastas(accessToken: string, caminho?: string, sitePath?: string): Promise<{
    site: string;
    caminho: string;
    pastas: Array<{ nome: string; filhos: number | null }>;
    arquivos: number;
    paginas: number;
}>;
