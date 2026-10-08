import test from 'node:test';
import assert from 'node:assert/strict';
import { validarModelo, previaEmail, dataSP, validarAgenda, proximaOcorrencia, MODELOS, AGENDAS } from '../sefaz-backend/comunicacao-modelos.js';
import { executarOcorrencia } from '../sefaz-backend/comunicacao-agenda.js';
const modelo = { ...validarModelo({ nome: 'Documentos', departamento: 'contabil', canal: 'email', assunto: 'Documentos de {{cliente}}', corpo: 'Olá {{cliente}}. Envie {{documentos}}.' }), revisao: 1 };
const entrada = { modeloId: 'modelo1', para: 'cliente@example.com', inicio: '2027-01-31T09:00', fim: '2027-12-31T09:00', recorrencia: 'mensal', valores: { cliente: '<img src=x onerror=alert(1)>', documentos: 'Extratos' } };
const agora = new Date('2027-01-01T12:00:00Z');
test('preserva layout e escapa valores do cliente, sem aceitar variáveis faltantes', () => {
    const p = previaEmail(modelo, entrada.valores);
    assert.ok(p.html.includes('SP Assessoria Contábil'));
    assert.ok(p.html.includes('&lt;img'));
    assert.ok(!p.html.includes('<img src=x'));
    assert.throws(() => previaEmail(modelo, {}), /cliente/);
    assert.throws(() => previaEmail(modelo, { cliente: 'X\nBcc: atacante', documentos: 'ok' }), /Assunto/);
    assert.throws(() => validarModelo({ ...modelo, corpo: '{{ cliente }' }), /Variável/);
});
test('canal e departamento são restritos, corpo e destinatário validados', () => {
    assert.throws(() => validarModelo({ ...modelo, departamento: 'intruso' }));
    assert.throws(() => validarModelo({ ...modelo, canal: 'sms' }));
    assert.throws(() => validarAgenda({ ...entrada, para: 'a@b.com,c@d.com' }, modelo, agora));
    assert.throws(() => validarAgenda({ ...entrada, inicio: '2026-01-01T08:00' }, modelo, agora));
    assert.throws(() => validarAgenda({ ...entrada, fim: '' }, modelo, agora));
    assert.throws(() => validarAgenda(entrada, { ...modelo, ativo: false }, agora));
});
test('hora de Brasília independente do fuso do processo e datas impossíveis recusadas', () => {
    assert.equal(dataSP('2027-01-31T09:00'), '2027-01-31T12:00:00.000Z');
    assert.throws(() => dataSP('2027-02-30T09:00'));
    assert.throws(() => dataSP('2027-01-01T25:00'));
});
test('mensal preserva dia original, limita fevereiro, não dispara meses atrasados em rajada', () => {
    const a = validarAgenda(entrada, modelo, agora);
    assert.equal(a.status, 'pausado');
    assert.equal(proximaOcorrencia(a, new Date('2027-01-31T12:01Z')), '2027-02-28T12:00:00.000Z');
    assert.equal(proximaOcorrencia({ ...a, proximoEm: '2027-02-28T12:00:00.000Z' }, new Date('2027-02-28T12:01Z')), '2027-03-31T12:00:00.000Z');
    assert.equal(proximaOcorrencia(a, new Date('2027-06-15T12:00Z')), '2027-06-30T12:00:00.000Z');
    assert.equal(proximaOcorrencia(a, new Date('2028-01-01T12:00Z')), null);
});
test('diária, semanal, única e ano bissexto', () => {
    const a = validarAgenda(entrada, modelo, agora);
    assert.equal(proximaOcorrencia({ ...a, recorrencia: 'diaria' }, new Date('2027-01-31T12:01Z')), '2027-02-01T12:00:00.000Z');
    assert.equal(proximaOcorrencia({ ...a, recorrencia: 'semanal' }, new Date('2027-01-31T12:01Z')), '2027-02-07T12:00:00.000Z');
    assert.equal(proximaOcorrencia({ ...a, recorrencia: 'unica' }, agora), null);
    assert.equal(proximaOcorrencia({ ...a, inicioLocal: '2028-01-31T09:00', fim: '2028-12-31T12:00:00.000Z' }, new Date('2028-01-31T12:01Z')), '2028-02-29T12:00:00.000Z');
});
function banco() {
    const data = new Map();
    let lock = Promise.resolve();
    const doc = key => ({ id: key.split('/').at(-1), key, get: async () => ({ exists: data.has(key), data: () => structuredClone(data.get(key)), ref: doc(key) }) });
    const db = { collection: col => ({ doc: id => doc(`${col}/${id}`) }), runTransaction: async fn => {
        const anterior = lock; let liberar; lock = new Promise(r => { liberar = r; }); await anterior;
        const writes = [];
        try { const r = await fn({ get: ref => ref.get(), set: (ref, value) => writes.push(() => data.set(ref.key, structuredClone(value))), update: (ref, value) => writes.push(() => data.set(ref.key, { ...data.get(ref.key), ...structuredClone(value) })) }); writes.forEach(f => f()); return r; } finally { liberar(); }
    } };
    const ag = { ...validarAgenda(entrada, modelo, agora), status: 'ativo', criadoPor: 'admin@example.com', criadoUid: 'admin' };
    data.set(`${AGENDAS}/a1`, ag); data.set(`${MODELOS}/modelo1`, modelo);
    return { db, data, ref: db.collection(AGENDAS).doc('a1') };
}
const tick = new Date('2027-01-31T12:01Z');
test('dois workers simultâneos reservam uma só ocorrência e aceitação agenda a próxima', async () => {
    const { db, data, ref } = banco(); let enviados = 0;
    const preparar = async () => async () => { enviados++; return { ok: true, messageId: 'wamid.1' }; };
    await Promise.all([executarOcorrencia(db, ref, tick, preparar), executarOcorrencia(db, ref, tick, preparar)]);
    assert.equal(enviados, 1);
    assert.equal(data.get(ref.key).proximoEm, '2027-02-28T12:00:00.000Z');
    assert.equal(data.get(ref.key).ultimoResultado.status, 'aceito');
});
test('timeout é indeterminado e nunca é reenviado automaticamente', async () => {
    const { db, data, ref } = banco(); let enviados = 0;
    const preparar = async () => async () => { enviados++; throw new Error('timeout'); };
    await executarOcorrencia(db, ref, tick, preparar); await executarOcorrencia(db, ref, tick, preparar);
    assert.equal(enviados, 1); assert.equal(data.get(ref.key).status, 'indeterminado');
});
test('modelo alterado, cancelamento e falha na preparação não chamam o provedor', async () => {
    for (const tipo of ['alterado', 'cancelado', 'bloqueado']) {
        const { db, data, ref } = banco(); let enviados = 0;
        if (tipo === 'alterado') data.set(`${MODELOS}/modelo1`, { ...modelo, revisao: 2 });
        if (tipo === 'cancelado') data.set(ref.key, { ...data.get(ref.key), status: 'cancelado' });
        await executarOcorrencia(db, ref, tick, async () => { if (tipo === 'bloqueado') throw new Error('Bloqueado'); return async () => { enviados++; return { ok: true }; }; });
        assert.equal(enviados, 0);
        assert.equal(data.get(ref.key).status, tipo === 'cancelado' ? 'cancelado' : 'falhou');
    }
});
test('data final vencida encerra a agenda sem enviar', async () => {
    const { db, data, ref } = banco(); let enviados = 0;
    await executarOcorrencia(db, ref, new Date('2028-01-01T12:00Z'), async () => async () => { enviados++; return { ok: true }; });
    assert.equal(enviados, 0); assert.equal(data.get(ref.key).status, 'concluido');
});

const { normalizarContatos, montarLote, salvarLote, alterarLote, LOTES } = await import('../sefaz-backend/comunicacao-lotes.js');
const loteEntrada = { ...entrada, pedidoId: 'pedido1', modeloRevisao:1, contatos: [
    { para: 'Um@example.com', empresa: 'Empresa A', cnpj: '12345678000190' },
    { para: 'um@example.com', empresa: 'Empresa A', cnpj: '12345678000190' },
    { para: 'um@example.com', empresa: 'Empresa B', cnpj: '22345678000190' },
] };
test('lote deduplica por empresa, preserva contatos compartilhados e personaliza sem misturar clientes', () => {
    const r = montarLote(loteEntrada, modelo, agora);
    assert.equal(r.agendas.length, 2); assert.equal(r.duplicados, 1);
    assert.equal(r.agendas[0].valores.cliente, 'Empresa A');
    assert.equal(r.agendas[1].valores.cliente, 'Empresa B');
    assert.ok(r.agendas.every(a => a.status === 'pausado'));
    assert.throws(() => normalizarContatos([{para:'a@x.com;b@x.com'}]));
    assert.throws(() => normalizarContatos(Array(401).fill({para:'a@x.com'})));
    assert.throws(() => normalizarContatos([{para:'a@x.com',cnpj:'123'}]));
});
test('lote transacional salva pausado, repetição do pedido não duplica e ativação exige modelo e data vigentes', async () => {
    const {db,data} = banco(); const autor = {uid:'admin',email:'admin@example.com'};
    await Promise.all([salvarLote(db,loteEntrada,autor,agora),salvarLote(db,loteEntrada,autor,agora)]);
    assert.equal(data.get(`${LOTES}/pedido1`).quantidade, 2);
    assert.equal([...data.keys()].filter(k=>k.startsWith(`${AGENDAS}/pedido1_`)).length,2);
    await assert.rejects(salvarLote(db,{...loteEntrada,valores:{documentos:'Outro'}},autor,agora),/outros dados/);
    await alterarLote(db,'pedido1','ativo',autor,agora);
    assert.equal(data.get(`${AGENDAS}/pedido1_0`).status,'ativo');
    await alterarLote(db,'pedido1','pausado',autor,agora);
    data.set(`${MODELOS}/modelo1`,{...modelo,revisao:2});
    await assert.rejects(alterarLote(db,'pedido1','ativo',autor,agora),/Modelo mudou/);
    assert.equal(data.get(`${AGENDAS}/pedido1_0`).status,'pausado');
    data.set(`${MODELOS}/modelo1`,modelo);
    await assert.rejects(alterarLote(db,'pedido1','ativo',autor,tick),/Horário passou/);
    data.set(`${AGENDAS}/pedido1_1`,{...data.get(`${AGENDAS}/pedido1_1`),status:'processando'});
    await assert.rejects(alterarLote(db,'pedido1','cancelado',autor,agora),/em execução/);
    assert.equal(data.get(`${AGENDAS}/pedido1_0`).status,'pausado');
});

test('salvar exige a revisão conferida, antes de criar destinatários', async()=>{const {db,data}=banco();await assert.rejects(salvarLote(db,{...loteEntrada,modeloRevisao:0},{uid:'admin',email:'admin@example.com'},agora),/Confira novamente/);assert.equal(data.has(`${LOTES}/pedido1`),false);});
