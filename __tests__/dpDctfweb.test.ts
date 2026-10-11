/**
 * Túnel da DCTFWeb do Consultor DP (Paulo, 11/10/2026): período da
 * competência, perfil do CFI pelo e-mail do token e o DARF que volta ao DP.
 */
// @ts-nocheck — módulo .js do backend
import { periodoDaCompetencia, perfilCfiPorEmail, respostaDarfDp } from '../sefaz-backend/dp-dctfweb.js';

const dbCom = (docs) => ({
    collection: () => ({
        where: (_c, _op, valor) => ({
            limit: () => ({ get: async () => ({ docs: docs.filter((d) => d.email === valor).map((d) => ({ id: d.uid, data: () => d })) }) }),
        }),
    }),
});

describe('túnel da DCTFWeb do DP', () => {
    it('competência AAAA-MM vira o período de apuração', () => {
        expect(periodoDaCompetencia('2026-09')).toEqual({ anoPA: 2026, mesPA: 9 });
        expect(periodoDaCompetencia('2026-13')).toBeNull();
        expect(periodoDaCompetencia('09/2026')).toBeNull();
    });

    it('perfil do CFI pelo e-mail: papel e departamentos do cadastro central', async () => {
        const db = dbCom([{ uid: 'u1', email: 'ana@x.com.br', role: 'colaborador', departamentos: ['dp-folha', 'xpto'] }]);
        expect((await perfilCfiPorEmail(db, 'Ana@x.com.br')).perfil).toEqual({ uid: 'u1', email: 'ana@x.com.br', role: 'colaborador', departamentos: ['dp-folha'] });
        expect((await perfilCfiPorEmail(db, 'bia@x.com.br')).motivo).toMatch(/Sem cadastro no Consultor Fiscal/);
    });

    it('dois perfis com o mesmo e-mail: não escolhe por sorte', async () => {
        const db = dbCom([{ uid: 'u1', email: 'ana@x.com.br' }, { uid: 'u2', email: 'ana@x.com.br' }]);
        const r = await perfilCfiPorEmail(db, 'ana@x.com.br');
        expect(r.perfil).toBeNull();
        expect(r.motivo).toMatch(/2 cadastros/);
    });

    it('DARF: só do SERPRO e com o PDF; o bruto não vai ao DP', () => {
        const r = respostaDarfDp({ fonte: 'serpro', pdfBase64: 'JVBER', valor: 1234.5, numeroDocumento: '07', vencimento: '2026-10-20', _raw: { x: 1 } }, { emAndamento: true });
        expect(r).toMatchObject({ ok: true, emAndamento: true, valor: 1234.5, pdfBase64: 'JVBER' });
        expect(r._raw).toBeUndefined();
        expect(respostaDarfDp({ fonte: 'mock', pdfBase64: 'x' }, { emAndamento: false }).ok).toBe(false);
        expect(respostaDarfDp({ fonte: 'serpro', mensagens: [{ texto: 'Não há débitos.' }] }, { emAndamento: false }).error).toMatch(/Não há débitos/);
    });
});
