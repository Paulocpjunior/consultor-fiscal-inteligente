export function precisaReleituraIssRetido(doc: any): boolean;
export function patchDaReleituraIssRetido(xml: string, agoraIso: string): {
    nacional: boolean;
    issRetido?: boolean | null;
    patch: Record<string, unknown>;
};
