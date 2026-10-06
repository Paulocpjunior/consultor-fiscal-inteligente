export function protegerOperacaoFiscal(
    req: { method: string; originalUrl: string; headers: { authorization?: string } },
    res: { status(code: number): { json(body: unknown): unknown } },
    next: () => void,
): Promise<unknown>;
