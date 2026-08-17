// Tipos do importador do backup da Ultra Fox — o dono é o .js.
export interface ContatoImportado { numero: string; nome: string | null; empresaNome: string | null; duplicatasNoArquivo?: number }
export interface MensagemImportada { numero: string; em: string; direcao: 'entrada' | 'saida'; texto: string; autor?: string }

export function detectarDelimitador(linhaCabecalho: string): string;
export function interpretarCsv(texto: string): { cabecalho: string[]; linhas: string[][] };
export function interpretarContatosCsv(texto: string): {
    contatos: ContatoImportado[];
    descartados: { linha: number; valor?: string; motivo: string }[];
    avisos: string[];
};
export function dataBrParaIso(dataStr: string, horaStr: string): string | null;
export function interpretarConversaTxt(texto: string): {
    mensagens: { em: string; autor: string; texto: string }[];
    autores: string[];
    descartadas: { trecho: string; motivo: string }[];
};
export function interpretarMensagensCsv(texto: string): {
    mensagens: MensagemImportada[];
    descartadas: { linha: number; motivo: string }[];
    avisos: string[];
};
export function idMensagemImportada(m: { numero: string; em: string; direcao: string; texto: string }): string;
export function prepararMensagensDoTxt(p: {
    mensagens: { em: string; autor: string; texto: string }[];
    numero: string;
    autoresEscritorio?: string[];
}): MensagemImportada[];
