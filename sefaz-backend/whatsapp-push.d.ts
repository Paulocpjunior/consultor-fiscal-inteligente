// Tipos do núcleo de push do SP Connect — o dono é o .js.
export interface UsuarioParaPush {
    uid: string;
    email?: string | null;
    role?: string;
    papelAtendimento?: string | null;
    departamentos?: string[];
    filasAtendimento?: string[];
    prefs?: { som?: boolean; popup?: boolean; push?: boolean; pushForaDoExpediente?: boolean };
    tokens?: string[];
}

export function tokenMorreu(codigoErro: unknown): boolean;
export function destinatariosDoPush(p: {
    usuarios?: UsuarioParaPush[];
    conversa?: { fila?: string | null };
    autorDaMensagem?: string | null;
    config?: { horario?: { dias: number[]; turnos: { inicio: string; fim: string }[] } } | null;
    agora?: Date;
}): {
    alvos: { uid: string; email: string | null; tokens: string[] }[];
    fora: { uid: string; email: string | null; motivo: string }[];
    noExpediente: boolean;
};
export function montarPushMensagem(p: {
    nomeContato?: string | null; numero: string; resumo?: string | null; canalRotulo?: string | null;
}): { titulo: string; corpo: string; tag: string; link: string };
export function registrarToken(tokensAtuais: string[] | undefined, token: unknown, limite?: number):
    { ok: true; tokens: string[] } | { ok: false; erro: string };
