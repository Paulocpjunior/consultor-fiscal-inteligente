/**
 * A guarda "admin/usuário do CFI OU app irmão" — a composição que quatro
 * routers escreviam à mão com uma resposta de MENTIRA (`engolir`).
 *
 * 🚨 O defeito (03/09, auditoria): a lista dos irmãos incluía o PRÓPRIO
 * projeto do CFI, então um colaborador comum recusado pelo requireAdmin (403)
 * era ACEITO pelo cross-project na segunda tentativa — que só olha issuer,
 * domínio e e-mail verificado, nunca o papel. Transmitir EFD-Reinf em
 * produção, ler o cadastro central e mandar WhatsApp ao cliente exigiam só
 * "estar logado". E a trava de horário do requireAuth era engolida igual.
 *
 * O que fica travado aqui: (1) token do projeto LOCAL vai para a guarda local
 * e o veredito dela chega ao cliente; (2) token de irmão permitido vai para o
 * cross-project; (3) o projeto do CFI NUNCA entra na lista dos irmãos; (4) por
 * varredura, nenhum router volta a montar o `engolir` nem a passar
 * `PROJETO.fiscal` ao crossProjectAuth.
 */
import * as fs from 'fs';
import * as path from 'path';
// @ts-expect-error módulo JS sem .d.ts
import { guardaLocalOuIrmao, projetoDoToken, PROJETO } from '../sefaz-backend/require-cross-project-auth.js';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const tokenDe = (projeto: string) => `x.${b64({ iss: `https://securetoken.google.com/${projeto}`, aud: projeto, email: 'a@spassessoriacontabil.com.br' })}.y`;
const reqCom = (auth?: string) => ({ headers: auth ? { authorization: auth } : {} });

function resFalso() {
    const out: { status?: number; body?: unknown } = {};
    return {
        out,
        res: {
            status(c: number) { out.status = c; return this; },
            json(b: unknown) { out.body = b; return this; },
        },
    };
}

describe('projetoDoToken', () => {
    it('lê o projeto do issuer sem verificar assinatura', () => {
        expect(projetoDoToken(reqCom(`Bearer ${tokenDe('projetos-app-sp')}`))).toBe('projetos-app-sp');
    });
    it('devolve null sem token, com token torto e com issuer que não é do Firebase', () => {
        expect(projetoDoToken(reqCom())).toBeNull();
        expect(projetoDoToken(reqCom('Bearer abc'))).toBeNull();
        expect(projetoDoToken(reqCom(`Bearer x.${b64({ iss: 'https://outro/x' })}.y`))).toBeNull();
    });
});

describe('guardaLocalOuIrmao', () => {
    it('token do PRÓPRIO projeto: o veredito da guarda local é FINAL (o 403 chega ao cliente)', async () => {
        const local = jest.fn(async (_req: unknown, res: any) => res.status(403).json({ error: 'Apenas administradores' }));
        const mw = guardaLocalOuIrmao(local, [PROJETO.contabil]);
        const { res, out } = resFalso();
        const next = jest.fn();
        await mw(reqCom(`Bearer ${tokenDe(PROJETO.fiscal)}`), res, next);
        expect(local).toHaveBeenCalledTimes(1);
        expect(next).not.toHaveBeenCalled();
        expect(out.status).toBe(403);
    });

    it('token de app IRMÃO permitido NÃO passa pela guarda local (vai ao cross-project)', async () => {
        const local = jest.fn();
        const mw = guardaLocalOuIrmao(local, [PROJETO.contabil]);
        const { res, out } = resFalso();
        const next = jest.fn();
        // Assinatura inválida ⇒ o cross-project recusa com 401 — o que se prova
        // é o ROTEAMENTO: a guarda local nem foi consultada.
        await mw(reqCom(`Bearer ${tokenDe(PROJETO.contabil)}`), res, next);
        expect(local).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(out.status).toBe(401);
    });

    it('irmão FORA da lista (ex.: DP num router só do Contábil) cai na guarda local, que recusa', async () => {
        const local = jest.fn(async (_req: unknown, res: any) => res.status(401).json({ error: 'x' }));
        const mw = guardaLocalOuIrmao(local, [PROJETO.contabil]);
        const { res, out } = resFalso();
        await mw(reqCom(`Bearer ${tokenDe(PROJETO.dpFolha)}`), res, jest.fn());
        expect(local).toHaveBeenCalledTimes(1);
        expect(out.status).toBe(401);
    });

    it('sem token: guarda local decide (401 dela)', async () => {
        const local = jest.fn(async (_req: unknown, res: any) => res.status(401).json({ error: 'Token ausente' }));
        const mw = guardaLocalOuIrmao(local, [PROJETO.contabil]);
        const { res, out } = resFalso();
        await mw(reqCom(), res, jest.fn());
        expect(local).toHaveBeenCalledTimes(1);
        expect(out.status).toBe(401);
    });

    it('o projeto do CFI NUNCA entra na lista dos irmãos', () => {
        expect(() => guardaLocalOuIrmao(jest.fn(), [PROJETO.fiscal, PROJETO.contabil])).toThrow(/CFI/);
        expect(() => guardaLocalOuIrmao(jest.fn(), [])).toThrow();
    });
});

describe('varredura: nenhum router monta a guarda à mão', () => {
    const dir = path.join(__dirname, '..', 'sefaz-backend');
    const fontes = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

    it('lê o backend de verdade', () => {
        expect(fontes.length).toBeGreaterThan(50);
    });

    it('nenhum arquivo passa PROJETO.fiscal ao crossProjectAuth nem usa a resposta de mentira', () => {
        const acusados: string[] = [];
        for (const f of fontes) {
            const src = fs.readFileSync(path.join(dir, f), 'utf8')
                .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
            if (/crossProjectAuth\(\s*\[[^\]]*PROJETO\.fiscal/.test(src)) acusados.push(`${f}: PROJETO.fiscal na lista do crossProjectAuth`);
            if (/const engolir\s*=/.test(src)) acusados.push(`${f}: resposta de mentira (engolir) — use guardaLocalOuIrmao`);
        }
        expect(acusados).toEqual([]);
    });
});
