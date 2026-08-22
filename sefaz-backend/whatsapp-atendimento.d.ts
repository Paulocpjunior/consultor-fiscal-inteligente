// Tipos do núcleo de atendimento (F3 do SP Connect) — o dono é o .js.
export interface FilaAtendimento { id: string; rotulo: string }

export interface ConfigAtendimento {
    botAtivo: boolean;
    /** 'piloto' = só os números da lista · 'todos' = o dia do corte. */
    botAlcance: 'piloto' | 'todos';
    botNumerosPiloto: string[];
    /** Escala da nota da pesquisa (5 ou 10). O texto da mensagem lê dela. */
    avaliacaoEscala: number;
    avisarClienteTransferencia: boolean;
    avaliacaoAtiva: boolean;
    horario: { dias: number[]; turnos: { inicio: string; fim: string }[] };
    mensagens: Record<string, string>;
    /** `submenu` = opção-PORTA (1 nível): escolher abre as sub-opções; a fila do item é o fallback se o sub-menu esvaziar. */
    menu: { opcao: string; fila: string; rotulo: string; submenu?: { opcao: string; fila: string; rotulo: string }[] }[];
    /** Imagem enviada junto da confirmação de fila (URL pública). Fila sem entrada = só texto. */
    imagensPorFila: Record<string, string>;
    /** ⚡ Frases do composer (editáveis na ⚙️). Vazia = sem chips, escolha legítima. */
    respostasRapidas: string[];
}

export interface AcaoBot {
    tipo: 'responder' | 'definirFila' | 'gravarProtocolo' | 'marcarAusenciaEnviada' | 'resetarTriagem'
        | 'resolverConversa' | 'marcarAguardandoAvaliacao' | 'liberarConducao' | 'enviarImagem'
        | 'abrirSubmenu' | 'fecharSubmenu';
    texto?: string;
    fila?: string;
    protocolo?: string;
    dia?: string;
    por?: string;
    url?: string;
    opcao?: string;
}

export const PAPEIS_ATENDIMENTO: string[];
export function papelValido(p: unknown): boolean;
export function podeEncerrar(p: { role?: string; papelAtendimento?: string | null; email?: string | null; atribuidoA?: string | null }): boolean;
export const ESCALAS_AVALIACAO: number[];
export const ESCALA_AVALIACAO_PADRAO: number;
export function leituraDaNota(texto: unknown, escala?: number):
    { tipo: 'nota'; nota: number }
    | { tipo: 'nao-e-nota'; nota: null }
    | { tipo: 'fora-da-escala'; nota: null; informado: number; escala: number };
export function conferirEscalaNaMensagem(mensagem: unknown, escala?: number):
    { ok: true; escala: number; semFaixaNoTexto?: boolean }
    | { ok: false; escala: number; noTexto: number; erro: string };
export function interpretarNota(texto: unknown, escala?: number): number | null;

export const FILAS_ATENDIMENTO: FilaAtendimento[];
export function filaValida(id: unknown): boolean;
export function filasVisiveis(p: { role?: string; papelAtendimento?: string | null; departamentos?: string[]; filasAtendimento?: string[] }): string[] | null;
export function conversaVisivel(filasDoUsuario: string[] | null, filaDaConversa: string | null | undefined): boolean;
export function configPadraoAtendimento(): ConfigAtendimento;
export function resolverConfig(gravada: unknown): ConfigAtendimento;
export function dentroDoHorario(horario: ConfigAtendimento['horario'], agora?: Date): boolean;
export function gerarProtocolo(agora?: Date, aleatorio?: number): string;
export function renderMensagem(template: string, dados?: Record<string, string | null | undefined>): string;
export function montarTextoMenu(config: ConfigAtendimento): string;
export function interpretarEscolha(texto: string, config: ConfigAtendimento):
    { fila: string; rotulo: string; opcao: string; submenu: { opcao: string; fila: string; rotulo: string }[] | null } | null;
export function montarTextoSubmenu(
    config: ConfigAtendimento,
    item: { rotulo: string; submenu?: { opcao: string; fila: string; rotulo: string }[] },
): string;
export function interpretarEscolhaSubmenu(
    texto: string,
    item: { submenu?: { opcao: string; fila: string; rotulo: string }[] },
): { voltar: true } | { fila: string; rotulo: string } | null;
/** Cobertura de UMA fila: quem é do departamento × quem só enxerga tudo. */
export interface CoberturaFila {
    fila: string;
    rotulo: string;
    doDepartamento: number;
    tambemVeem: number;
    situacao: 'coberta' | 'so-quem-ve-tudo' | 'invisivel';
}
export interface CoberturaFilas {
    /** Sem a lista de atendentes não se afirma nada (nem órfã, nem coberta). */
    indeterminado: boolean;
    motivo: string | null;
    filas: CoberturaFila[];
    /** Opções do menu que levam o cliente a fila sem ninguém do departamento. */
    opcoesSemDono: (Partial<CoberturaFila> & { opcao: string; rotulo: string; filaRotulo?: string })[];
}
export function coberturaDasFilas(p?: {
    menu?: { opcao: string | number; fila: string; rotulo: string }[];
    atendentes?: { uid?: string; role?: string; papelAtendimento?: string | null; departamentos?: string[]; filasAtendimento?: string[] }[] | null;
}): CoberturaFilas;
/** Alguém está conduzindo esta conversa? (dono + aberta ⇒ o bot não triaga por cima) */
export function emConducaoHumana(conversa: Record<string, unknown> | null | undefined): boolean;
export function soDigitos(v: unknown): string;
/** O bot pode responder a ESTE número? (piloto = só a lista; ilegível = não) */
export function botAlcancaNumero(config: Partial<ConfigAtendimento> | null | undefined, numero: unknown): boolean;

export function decidirAutomacao(p: {
    numero?: string | null;
    conversa?: Record<string, unknown>;
    textoMensagem?: string | null;
    nomeContato?: string | null;
    config: ConfigAtendimento;
    agora?: Date;
    protocoloNovo?: string;
}): AcaoBot[];
