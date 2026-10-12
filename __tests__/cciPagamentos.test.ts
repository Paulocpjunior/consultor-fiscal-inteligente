/** @jest-environment node */
// @ts-nocheck — backend ESM
import router, { confirmarEmpresaContabil, criarHandlerConsulta } from '../sefaz-backend/cci-pagamentos-routes.js';
const cnpj = '00000000000000';
const resposta = () => ({ statusCode: 200, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; } });
const req = () => ({ body: { cnpj, numerosDocumento: ['123'] }, headers: { authorization: 'Bearer teste' }, user: { uid: 'u' } });
const doc = { numeroDocumento: '123', valorPrincipal: 100, valorTotal: 100, valorMulta: null, valorJuros: null, dataArrecadacao: '2026-10-12' };
describe('PAGTOWEB da Contabilidade', () => {
    it('confere a carteira na API do CCI com token e sem redirecionar', async () => {
        const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, cnpj }) });
        await confirmarEmpresaContabil({ token: 'teste', cnpj, base: 'https://cci.example', fetchImpl });
        expect(fetchImpl.mock.calls[0][0]).toBe(`https://cci.example/api/empresas/${cnpj}/pagamentos-receita/acesso`);
        expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer teste' }, redirect: 'error' });
    });
    it.each([401,403,404,500])('falha fechada com HTTP %s', async status => {
        await expect(confirmarEmpresaContabil({ token: 'teste', cnpj, base: 'https://cci.example', fetchImpl: async () => ({ ok: false, status }) })).rejects.toThrow();
    });
    it.each(['http://cci.example', 'https://usuario:senha@cci.example', 'https://cci.example/outro', ''])('recusa configuração insegura %s', async base => {
        const fetchImpl = jest.fn();
        await expect(confirmarEmpresaContabil({ token: 'teste', cnpj, base, fetchImpl })).rejects.toThrow();
        expect(fetchImpl).not.toHaveBeenCalled();
    });
    it('recusa CNPJ diferente ou resposta sem comprovação', async () => {
        for (const d of [{ ok: true, cnpj: '11111111111111' }, { cnpj }]) {
            await expect(confirmarEmpresaContabil({ token: 'teste', cnpj, base: 'https://cci.example', fetchImpl: async () => ({ ok: true, json: async () => d }) })).rejects.toThrow();
        }
    });
    it('não chama SERPRO quando não há acesso à empresa', async () => {
        const consultar = jest.fn(), auditar = jest.fn(), res = resposta();
        await criarHandlerConsulta({ confirmar: async () => { throw Object.assign(Error('Sem acesso'), { status: 403 }); }, consultar, auditar })(req(), res);
        expect(res.statusCode).toBe(403); expect(consultar).not.toHaveBeenCalled();
    });
    it('mantém ausência, usa PAGAMENTOS71 e audita somente metadados', async () => {
        const consultar = jest.fn().mockResolvedValue({ dados: [doc] }), auditar = jest.fn(), res = resposta();
        await criarHandlerConsulta({ confirmar: async () => {}, consultar, auditar, config: () => ({ dryRun: false }) })(req(), res);
        expect(res.body.documentos[0].valorMulta).toBeNull();
        expect(consultar.mock.calls[0][0]).toMatchObject({ idSistema: 'PAGTOWEB', idServico: 'PAGAMENTOS71', contribuinteCnpj: cnpj });
        expect(Object.keys(auditar.mock.calls[0][0]).sort()).toEqual(['cnpj','porUid','primeiroDaPagina','projetoOrigem','quantidade','status','tamanhoDaPagina'].sort());
    });
    it('recusa dry run e não converte falha em lista vazia', async () => {
        for (const [dados, dryRun] of [[[doc], true], [{ _dryRun: true }, false], [null, false]]) {
            const res = resposta();
            await criarHandlerConsulta({ confirmar: async () => {}, consultar: async () => ({ dados }), auditar: async () => {}, config: () => ({ dryRun }) })(req(), res);
            expect(res.statusCode).toBe(502); expect(res.body.ok).toBe(false);
        }
    });
    it('erro do provedor não grava mensagens potencialmente financeiras', async () => {
        const res = resposta(), auditar = jest.fn();
        await criarHandlerConsulta({ confirmar: async () => {}, consultar: async () => { throw Error('valor 12345'); }, auditar })(req(), res);
        expect(res.statusCode).toBe(502); expect(JSON.stringify(auditar.mock.calls)).not.toContain('12345');
    });
});

// O middleware real recusa projetos irmãos antes de qualquer consulta à carteira/SERPRO.
it.each(['consultor-dp-folha', 'consultorfiscalapp'])('rota exclusiva recusa token de %s', async project => {
    const middleware = router.stack[0].route.stack[0].handle;
    const encode = d => Buffer.from(JSON.stringify(d)).toString('base64url');
    const token = encode({alg:'RS256',kid:'fixture'})+'.'+encode({iss:`https://securetoken.google.com/${project}`,aud:project})+'.fixture';
    const res = resposta(), next = jest.fn();
    await middleware({headers:{authorization:'Bearer '+token}}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
});
