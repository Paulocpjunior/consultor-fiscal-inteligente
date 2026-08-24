// Tipos do aviso nativo do Teams — o dono é o .js.
export const TEAMS_APP_EXTERNAL_ID: string;
export const ACTIVITY_TYPE_MENSAGEM: string;

export function enviarAvisoTeams(
    p: { email: string; titulo?: string | null; corpo?: string | null },
    deps?: {
        fetch?: typeof fetch; token?: string; tokenNovo?: string;
        configurado?: boolean; invalidarToken?: () => void;
    },
): Promise<{ ok: true } | {
    ok: false;
    etapa: 'graph-nao-configurado' | 'token' | 'usuario-nao-encontrado' | 'consulta-usuario'
        | 'consulta-instalacao' | 'app-nao-instalado' | 'envio';
    erro: string;
    bruto?: unknown;
    renovouToken?: boolean;
}>;

export function statusAvisoTeams(env?: Record<string, string | undefined>): {
    graphConfigurado: boolean;
    clientId: string | null;
    teamsAppId: string;
};

export const _internals: {
    cache: Map<string, { userId: string; installId: string; em: number }>;
    resolverDestino: (email: string, token: string, fetcher: typeof fetch) => Promise<unknown>;
};
