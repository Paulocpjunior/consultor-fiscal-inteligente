import assert from 'node:assert/strict';
import { localizarCadastroContabilPorCnpj, regimeDoCadastro } from '../sefaz-backend/cadastro-contabil-routes.js';

function doc(id, data) {
    return { id, data: () => data };
}

const lotes = {
    simples_empresas: [doc('simples-1', { cnpj: '12.345.678/0001-90', nome: 'Empresa Simples' })],
    lucro_empresas: [doc('lucro-1', { cnpj: '98.765.432/0001-10', nome: 'Empresa Real', regimePadrao: 'Real' })],
};
const db = { collection: (nome) => ({ nome }) };
const fetchAllDocs = async (query) => lotes[query.nome] || [];

assert.deepEqual(regimeDoCadastro('simples_empresas', {}), { codigo: 'SIMPLES_NACIONAL', nome: 'Simples Nacional' });
assert.deepEqual(regimeDoCadastro('lucro_empresas', { regimePadrao: 'Real' }), { codigo: 'LUCRO_REAL', nome: 'Lucro Real' });
assert.deepEqual(regimeDoCadastro('lucro_empresas', { regimePadrao: 'Presumido' }), { codigo: 'LUCRO_PRESUMIDO', nome: 'Lucro Presumido' });

const simples = await localizarCadastroContabilPorCnpj('12.345.678/0001-90', { db, fetchAllDocs });
assert.equal(simples.regime.codigo, 'SIMPLES_NACIONAL');
const real = await localizarCadastroContabilPorCnpj('98765432000110', { db, fetchAllDocs });
assert.equal(real.regime.codigo, 'LUCRO_REAL');
assert.equal(await localizarCadastroContabilPorCnpj('11111111000111', { db, fetchAllDocs }), null);

await assert.rejects(
    localizarCadastroContabilPorCnpj('123', { db, fetchAllDocs }),
    /14 digitos/
);

const duplicados = async () => [doc('duplicado', { cnpj: '12.345.678/0001-90' })];
await assert.rejects(
    localizarCadastroContabilPorCnpj('12345678000190', { db, fetchAllDocs: duplicados }),
    /mais de um cadastro fiscal/
);

// Regressão COMERCIAL VEGA: registro excluído e cadastro ativo com espaço no CNPJ.
const cnpjVega = '07.570.793/0001-23';
const excluido = doc('vega-excluido', { cnpj: cnpjVega, _deleted: true, _deletedAt: '2026-07-27T16:52:01.064Z' });
const ativo = doc('vega-ativo', { cnpj: cnpjVega + ' ', nome: 'COMERCIAL VEGA - LOCACAO, VENDAS LTDA' });
const consultar = (simples, lucro = []) => localizarCadastroContabilPorCnpj(cnpjVega, {
    db, fetchAllDocs: async q => q.nome === 'simples_empresas' ? simples : lucro,
});
assert.equal((await consultar([excluido, ativo])).id, 'vega-ativo');
assert.equal((await consultar([ativo, excluido])).regime.codigo, 'SIMPLES_NACIONAL');
assert.equal(await consultar([excluido]), null);
assert.equal((await consultar([ativo], [excluido])).id, 'vega-ativo');
assert.equal((await consultar([ativo, doc('mesclado', { cnpj: cnpjVega, _merged_into: 'vega-ativo' })])).id, 'vega-ativo');
await assert.rejects(consultar([ativo, doc('outro-ativo', { cnpj: cnpjVega })]), e => e.status === 409);
await assert.rejects(consultar([ativo], [doc('ativo-lucro', { cnpj: cnpjVega })]), e => e.status === 409);
console.log('OK: cadastro fiscal compartilhado com o CCI, excluídos ignorados e duplicidades ativas bloqueadas');
