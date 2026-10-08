/**
 * 🚨 CANCELAMENTO SE DECIDE PELA RÉGUA (`docCancelado`), NUNCA SÓ PELO `status`.
 *
 * 08/10, WALDESA 0005-02 · 09/2026: a apuração de ISS conferia o cancelamento
 * só pelo campo `status`. As notas canceladas por EVENTO (110111) seguem com
 * status "autorizado" — cinco delas somaram R$ 191,32 a mais no ISS, e quem
 * pegou foi a conferência do PDF da guia. A Central de XMLs, ao lado, já
 * mostrava "Cancelada": duas réguas para o mesmo fato.
 *
 * Fato cobrado, por VARREDURA: todo arquivo que testa "status cancelado" com
 * um conjunto (`CANCELADOS.has(String(x.status…`) também pergunta à régua
 * (`docCancelado(`) — ou está declarado abaixo, COM o motivo.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const RAIZ = join(__dirname, '..');
const PASTAS = ['services', 'sefaz-backend'];
const STATUS_SO = /\b[A-Z_]*CANCELAD[A-Z_]*\.has\(\s*String\(\s*\w+\.(?:situacao\s*\|\|\s*\w+\.)?status\b/;

const PERMITIDO: Record<string, string> = {
    'sefaz-backend/fila-migracao-routes.js': 'diagnóstico de captura (resumo sem completa): a pergunta é sobre o que a SEFAZ entregou, não sobre imposto',
};

function fontes(dir: string, out: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
        if (nome === 'node_modules') continue;
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) fontes(p, out);
        else if (/\.(js|ts|tsx)$/.test(nome) && !nome.endsWith('.d.ts')) out.push(p);
    }
    return out;
}

const arquivos = PASTAS.flatMap((d) => fontes(join(RAIZ, d)))
    .map((p) => ({ p: p.slice(RAIZ.length + 1).replace(/\\/g, '/'), src: readFileSync(p, 'utf8') }));

describe('cancelamento pela régua, não pelo campo cru', () => {
    it('a varredura acha quem testa status cancelado (senão não mede nada)', () => {
        const comPadrao = arquivos.filter(({ src }) => STATUS_SO.test(src)).map(({ p }) => p);
        expect(comPadrao).toEqual(expect.arrayContaining(['services/issSpApuracao.ts', 'sefaz-backend/iss-carteira.js']));
    });

    it('quem testa o status também pergunta ao docCancelado — ou declara por quê', () => {
        const infratores = arquivos
            .filter(({ p, src }) => STATUS_SO.test(src) && !/docCancelado\(/.test(src) && !PERMITIDO[p])
            .map(({ p }) => p);
        expect(infratores).toEqual([]);
    });

    it('toda exceção declarada ainda usa o padrão (exceção órfã mente)', () => {
        for (const p of Object.keys(PERMITIDO)) {
            const a = arquivos.find((x) => x.p === p);
            expect({ p, usa: !!a && STATUS_SO.test(a.src) }).toEqual({ p, usa: true });
        }
    });
});
