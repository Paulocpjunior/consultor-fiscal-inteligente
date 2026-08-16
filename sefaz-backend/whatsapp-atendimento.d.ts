// Tipos do núcleo de atendimento (F3 do SP Connect) — o dono é o .js.
export interface FilaAtendimento { id: string; rotulo: string }

export interface ConfigAtendimento {
    botAtivo: boolean;
    horario: { dias: number[]; turnos: { inicio: string; fim: string }[] };
    mensagens: Record<string, string>;
    menu: { opcao: string; fila: string; rotulo: string }[];
}

export interface AcaoBot {
    tipo: 'responder' | 'definirFila' | 'gravarProtocolo' | 'marcarAusenciaEnviada' | 'resetarTriagem';
    texto?: string;
    fila?: string;
    protocolo?: string;
    dia?: string;
}

export const FILAS_ATENDIMENTO: FilaAtendimento[];
export function filaValida(id: unknown): boolean;
export function filasVisiveis(p: { role?: string; departamentos?: string[]; filasAtendimento?: string[] }): string[] | null;
export function conversaVisivel(filasDoUsuario: string[] | null, filaDaConversa: string | null | undefined): boolean;
export function configPadraoAtendimento(): ConfigAtendimento;
export function resolverConfig(gravada: unknown): ConfigAtendimento;
export function dentroDoHorario(horario: ConfigAtendimento['horario'], agora?: Date): boolean;
export function gerarProtocolo(agora?: Date, aleatorio?: number): string;
export function renderMensagem(template: string, dados?: Record<string, string | null | undefined>): string;
export function montarTextoMenu(config: ConfigAtendimento): string;
export function interpretarEscolha(texto: string, config: ConfigAtendimento): { fila: string; rotulo: string } | null;
export function decidirAutomacao(p: {
    conversa?: Record<string, unknown>;
    textoMensagem?: string | null;
    nomeContato?: string | null;
    config: ConfigAtendimento;
    agora?: Date;
    protocoloNovo?: string;
}): AcaoBot[];
