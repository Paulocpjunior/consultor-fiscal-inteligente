/** @jest-environment node */
export {};
const mockRoutes: Record<string, any[]> = {};
const mockAuth = jest.fn();
const mockImport = jest.fn();
const mockAccess = jest.fn();
jest.mock('express', () => ({ __esModule: true, default: { Router: () => ({ post: (p:string,...h:any[]) => { mockRoutes[p]=h; }, get: jest.fn() }) } }));
jest.mock('../sefaz-backend/require-admin.js', () => ({requireAuth: mockAuth, requireAdmin: jest.fn()}));
jest.mock('../sefaz-backend/carteira-auth.js', () => ({podeAcessarEmpresaId: mockAccess}));
jest.mock('firebase-admin', () => ({__esModule:true,default:{apps:[{}],firestore:()=>({})}}));
jest.mock('../sefaz-backend/xml-importer.js', () => ({importarXmlSefaz:mockImport}));
jest.mock('../sefaz-backend/xml-empresa-matcher.js', () => ({carregarEmpresas:jest.fn(async()=>({porCnpj:new Map(),porRaiz:new Map()})),acharDono:()=>({emp:{empresaId:'empresa-permitida',nome:'Empresa'}})}));
jest.mock('../sefaz-backend/sefaz-sp-nfce-orchestrator.js',()=>({capturarNFCeSaida:jest.fn()}));
jest.mock('../sefaz-backend/sefaz-sp-nfce-client.js',()=>({baixarXmlNFCe:jest.fn()}));
jest.mock('../sefaz-backend/cert-storage.js',()=>({loadCertEmpresaPorCnpjBase:jest.fn()}));
jest.mock('../sefaz-backend/cancelamento-gravacao.js',()=>({gravarCancelamentoConfirmado:jest.fn(),carimbarPerguntaSefaz:jest.fn()}));
jest.mock('../sefaz-backend/docs-sem-dono.js',()=>({repararDocsSemDono:jest.fn()}));
require('../sefaz-backend/sefaz-sp-nfce-routes.js');
const req=()=>({body:{cnpj:'12345678000190',xmls:['<nfeProc><CNPJ>12345678000190</CNPJ></nfeProc>']},user:{uid:'operador',role:'colaborador',email:'operador@example.test'}});
const response=()=>{const r:any={status:jest.fn(),json:jest.fn()};r.status.mockReturnValue(r);r.json.mockReturnValue(r);return r;};
beforeEach(()=>{mockAccess.mockReset();mockImport.mockReset().mockResolvedValue({status:'importado'});});
test('colaborador autenticado importa a empresa resolvida somente após autorização de carteira',async()=>{
 expect(mockRoutes['/importar-xmls'][0]).toBe(mockAuth);
 mockAccess.mockResolvedValue({ok:true});const r=response();await mockRoutes['/importar-xmls'][1](req(),r);
 expect(mockAccess).toHaveBeenCalledWith(req().user,'empresa-permitida');expect(mockImport).toHaveBeenCalledWith(expect.objectContaining({empresaId:'empresa-permitida'}));expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ok:true,importadas:1}));
});
test('empresa fora da carteira não importa nem grava XML',async()=>{
 mockAccess.mockResolvedValue({ok:false,status:403,error:'Empresa fora da carteira'});const r=response();await mockRoutes['/importar-xmls'][1](req(),r);
 expect(r.status).toHaveBeenCalledWith(403);expect(mockImport).not.toHaveBeenCalled();
});
test('falha na autorização não importa',async()=>{
 mockAccess.mockRejectedValue(Error('banco indisponível'));const r=response();await mockRoutes['/importar-xmls'][1](req(),r);expect(r.status).toHaveBeenCalledWith(500);expect(mockImport).not.toHaveBeenCalled();
});
