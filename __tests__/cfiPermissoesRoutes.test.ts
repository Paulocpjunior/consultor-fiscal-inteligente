export {};
const mockPut=jest.fn(), mockTransaction=jest.fn();
const mockAdminGate=jest.fn();
jest.mock('express',()=>({__esModule:true,default:{Router:()=>({put:mockPut,get:jest.fn()}),json:()=>jest.fn()}}));
jest.mock('../sefaz-backend/require-admin.js',()=>({requireAdmin:mockAdminGate}));
jest.mock('firebase-admin',()=>({__esModule:true,default:{firestore:Object.assign(()=>({collection:(name:string)=>({doc:(id?:string)=>({name,id})}),runTransaction:mockTransaction}),{FieldValue:{serverTimestamp:()=>123}})}}));
require('../sefaz-backend/cfi-permissoes-routes.js');
const {criarPermissoesCfi}=require('../sefaz-backend/cfi-acesso.js');
const handler=mockPut.mock.calls[0][3];
const response=()=>{const r:any={code:200};r.status=jest.fn((n)=>{r.code=n;return r;});r.json=jest.fn(()=>r);return r;};
const request=()=>({params:{uid:'colab'},user:{uid:'admin'},body:{permissoes:criarPermissoesCfi('edicao'),revisao:0}});
let tx:any;
beforeEach(()=>{tx={get:jest.fn().mockResolvedValue({exists:true,data:()=>({role:'colaborador',departamentos:['contabil'],permissoesCfiRevisao:0})}),update:jest.fn(),set:jest.fn()};mockTransaction.mockImplementation(fn=>fn(tx));});
test('rota exige administrador e grava ações e auditoria na mesma transação sem trocar papel/departamento',async()=>{
    expect(mockPut.mock.calls[0][1]).toBe(mockAdminGate);
    const r=response();await handler(request(),r);expect(r.code).toBe(200);
    expect(tx.update.mock.calls[0][1]).toEqual({permissoesCfi:criarPermissoesCfi('edicao'),permissoesCfiRevisao:1});
    expect(tx.set.mock.calls[0][1]).toMatchObject({aplicativo:'cfi',autorUid:'admin',alvoUid:'colab',revisao:1});
});
test('revisão concorrente não sobrescreve outra permissão',async()=>{
    tx.get.mockResolvedValue({exists:true,data:()=>({permissoesCfiRevisao:1})});const r=response();await handler(request(),r);
    expect(r.code).toBe(409);expect(tx.update).not.toHaveBeenCalled();expect(tx.set).not.toHaveBeenCalled();
});
test('não cria perfil inexistente nem aceita configuração inválida',async()=>{
    tx.get.mockResolvedValue({exists:false});let r=response();await handler(request(),r);expect(r.code).toBe(404);
    r=response();await handler({...request(),body:{permissoes:{role:'admin'},revisao:0}},r);expect(r.code).toBe(400);expect(tx.update).not.toHaveBeenCalled();
});
test('falha de persistência não confirma gravação',async()=>{
    mockTransaction.mockRejectedValue(Error('offline'));const r=response();await handler(request(),r);expect(r.code).toBe(503);
});
