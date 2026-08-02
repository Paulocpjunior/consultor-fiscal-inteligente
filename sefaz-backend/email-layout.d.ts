export function escaparHtml(s: unknown): string;
export function textoParaHtml(texto: unknown): string;
export const MARCA: {
    nome: string; departamento: string; azul: string; marinho: string; logoCid: string;
};
export const CORES_FAROL: Record<string, { de: string; ate: string; tinta: string; borda: string; cta: string }>;
export function montarLayoutEmail(p: {
    titulo: string;
    conteudoHtml: string;
    ctas?: Array<{ href: string; texto: string; cor?: string }>;
    marca?: { siteUrl?: string | null; instagramUrl?: string | null; whatsappUrl?: string | null };
    assinatura?: string;
    cores?: { de: string; ate: string; tinta: string; borda: string; cta: string };
    selo?: string;
    departamento?: string;
    motivoRodape?: string;
}): string;
export function montarEmailGuia(p: {
    tipo: string;
    empresaNome: string;
    competencia?: string | null;
    mensagem: string;
    temPdf?: boolean;
    vencimento?: string | null;
    geradoEm?: string;
}): string;
export function anexoLogo(): Array<{ name: string; contentType: string; contentBytes: string; contentId: string }>;
