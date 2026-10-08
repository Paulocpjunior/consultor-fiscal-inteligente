import { createHash } from 'node:crypto';
import { LOTES, CONTATOS, normalizarContatos, montarLote, salvarLote, alterarLote } from './comunicacao-lotes.js';
import { secretsMatch } from './cron-secret.js';
import { tickComunicacao } from './comunicacao-agenda.js';
import { prepararComunicacao } from './comunicacao-envio.js';
import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { MODELOS, AGENDAS, EXECUCOES, DEPARTAMENTOS, exigir, validarModelo, validarAgenda, previaEmail } from './comunicacao-modelos.js';
import { montarVariaveisPorSchema } from './whatsapp-templates.js';
import { listarTemplatesAprovados } from './whatsapp-cloud.js';

const router = Router();
router.post('/tick', (req, res, next) => {
    if (secretsMatch(req.headers['x-cron-secret'], process.env.SEFAZ_CRON_SECRET)) return next();
    return requireAdmin(req, res, next);
}, async (req, res) => {
    try {
        const store = db();
        const agora = new Date();
        const resultado = await tickComunicacao(store, agora, ag => prepararComunicacao(store, ag));
        await store.collection('whatsapp_config').doc('comunicacao_tick').set({ ultimoEm: agora.toISOString(), ...resultado });
        res.json({ ok: true, ...resultado });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.use(requireAdmin);
function db() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}
const rota = fn => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); } };
const idValido = id => exigir(typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id), 'Identificador inválido.');
async function completarModelo(entrada) {
    const m = validarModelo(entrada);
    if (m.canal === 'whatsapp') {
        const t = (await db().collection('whatsapp_templates').doc(m.templateId).get()).data();
        exigir(t && t.ativo !== false && t.departamento === m.departamento && !t.temDocumento, 'Escolha um template ativo, sem anexo, do mesmo departamento.');
        const r = await listarTemplatesAprovados();
        exigir(r.ok, 'Não foi possível conferir a aprovação na Meta.');
        const aprovado = r.templates.find(x => x.nome === t.nome && x.idioma === t.idioma && x.status === 'APPROVED');
        exigir(aprovado && !aprovado.temDocumento && ['UTILITY'].includes(aprovado.categoria) && aprovado.variaveis === t.variaveis.length, 'Use um template UTILITY aprovado, sem anexo e com variáveis correspondentes. Campanhas de marketing continuam no fluxo próprio.');
        m.whatsapp = { ...t, corpo: aprovado.corpo };
        m.variaveis = t.variaveis.map(v => v.chave);
    }
    return m;
}
router.get('/', rota(async (req, res) => {
    const departamento = String(req.query.departamento || 'fiscal');
    exigir(DEPARTAMENTOS.includes(departamento), 'Departamento inválido.');
    const store = db();
    const [modelos, agendas, execucoes, tick] = await Promise.all([
        store.collection(MODELOS).where('departamento', '==', departamento).limit(300).get(),
        store.collection(AGENDAS).where('modelo.departamento', '==', departamento).limit(500).get(),
        store.collection(EXECUCOES).orderBy('iniciadoEm', 'desc').limit(200).get(),
        store.collection('whatsapp_config').doc('comunicacao_tick').get(),
    ]);
    const lista = s => s.docs.map(d => ({ ...d.data(), id: d.id }));
    res.json({ ok: true, modelos: lista(modelos), agendas: lista(agendas), execucoes: lista(execucoes).filter(x => x.departamento === departamento), ultimoTickEm: tick.data()?.ultimoEm || null, truncado: modelos.size >= 300 || agendas.size >= 500 || execucoes.size >= 200 });
}));
router.post('/modelos', rota(async (req, res) => {
    const m = await completarModelo(req.body);
    const store = db();
    if (req.body.id) idValido(req.body.id);
    const ref = req.body.id ? store.collection(MODELOS).doc(req.body.id) : store.collection(MODELOS).doc();
    const em = new Date().toISOString();
    await store.runTransaction(async tx => {
        const antigo = (await tx.get(ref)).data();
        exigir(!req.body.id || antigo, 'Modelo não encontrado.');
        exigir(!antigo || antigo.revisao === req.body.revisao, 'O modelo mudou. Atualize a lista antes de salvar.');
        exigir(!antigo || (antigo.departamento === m.departamento && antigo.canal === m.canal), 'Para trocar canal ou departamento, duplique o modelo.');
        const novo = { ...m, revisao: (antigo?.revisao || 0) + 1, atualizadoEm: em, atualizadoPor: req.user.email };
        tx.set(ref, novo);
        tx.set(store.collection('comunicacao_modelos_revisoes').doc(`${ref.id}_${novo.revisao}`), { ...novo, modeloId: ref.id });
    });
    res.json({ ok: true, id: ref.id });
}));
router.post('/previa', rota(async (req, res) => {
    const modelo = await completarModelo(req.body.modelo);
    if (modelo.canal === 'email') return res.json({ ok: true, ...previaEmail(modelo, req.body.valores) });
    const vars = montarVariaveisPorSchema(modelo.whatsapp, req.body.valores);
    exigir(vars.ok, `Preencha: ${vars.faltando.join(', ')}.`);
    const corpo = modelo.whatsapp.corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => vars.variaveis[Number(n) - 1]);
    res.json({ ok: true, corpo });
}));
router.post('/agendas', rota(async (req, res) => {
    idValido(req.body.modeloId);
    idValido(req.body.pedidoId);
    const store = db();
    const modelRef = store.collection(MODELOS).doc(req.body.modeloId);
    const modelo = (await modelRef.get()).data();
    const agenda = validarAgenda(req.body, modelo);
    const ref = store.collection(AGENDAS).doc(req.body.pedidoId);
    await store.runTransaction(async tx => {
        const [atual, existente] = await Promise.all([tx.get(modelRef), tx.get(ref)]);
        exigir(atual.data()?.ativo && atual.data()?.revisao === modelo.revisao, 'Modelo mudou. Atualize antes de agendar.');
        exigir(!existente.exists, 'Este pedido já foi salvo. Atualize a lista.');
        tx.set(ref, { ...agenda, criadoPor: req.user.email, criadoUid: req.user.uid, criadoEm: new Date().toISOString() });
    });
    res.json({ ok: true, id: ref.id });
}));
router.post('/agendas/:id/estado', rota(async (req, res) => {
    idValido(req.params.id);
    exigir(['ativo', 'pausado', 'cancelado'].includes(req.body.status), 'Estado inválido.');
    const store = db();
    const ref = store.collection(AGENDAS).doc(req.params.id);
    await store.runTransaction(async tx => {
        const ag = (await tx.get(ref)).data();
        exigir(ag, 'Agendamento não encontrado.');
        exigir(['ativo', 'pausado'].includes(ag.status), 'Ocorrência em execução ou encerrada. Não pode ser reativada.');
        if (req.body.status === 'ativo') {
            const m = (await tx.get(store.collection(MODELOS).doc(ag.modeloId))).data();
            exigir(m?.ativo && m.revisao === ag.modelo.revisao, 'Modelo alterado ou inativo. Crie outro agendamento.');
            exigir(ag.proximoEm > new Date().toISOString(), 'Horário passou. Crie outro agendamento com nova data.');
        }
        const evento = { status: req.body.status, por: req.user.email, em: new Date().toISOString() };
        tx.update(ref, { status: evento.status, atualizadoEm: evento.em, atualizadoPor: evento.por });
        tx.set(store.collection('comunicacao_agendas_historico').doc(), { ...evento, agendaId: ref.id });
    });
    res.json({ ok: true });
}));
router.get('/contatos', rota(async (req, res) => {
    const departamento = String(req.query.departamento || 'fiscal');
    exigir(DEPARTAMENTOS.includes(departamento), 'Departamento inválido.');
    const snap = await db().collection(CONTATOS).where('departamento','==',departamento).limit(2001).get();
    res.json({ ok:true, contatos:snap.docs.slice(0,2000).map(d=>({...d.data(),id:d.id})), truncado:snap.size>2000 });
}));
router.post('/contatos', rota(async (req,res) => {
    exigir(DEPARTAMENTOS.includes(req.body.departamento), 'Departamento inválido.');
    const {contatos,duplicados}=normalizarContatos(req.body.contatos);
    const store=db(), batch=store.batch();
    for(const c of contatos){const id=createHash('sha256').update(req.body.departamento+'|'+c.cnpj+'|'+c.empresa+'|'+c.para).digest('hex');batch.set(store.collection(CONTATOS).doc(id),{...c,departamento:req.body.departamento,atualizadoPor:req.user.email,atualizadoEm:new Date().toISOString()},{merge:true});}
    await batch.commit();res.json({ok:true,quantidade:contatos.length,duplicados});
}));
router.get('/lotes', rota(async(req,res)=>{
    const departamento=String(req.query.departamento||'fiscal');exigir(DEPARTAMENTOS.includes(departamento),'Departamento inválido.');
    const snap=await db().collection(LOTES).where('departamento','==',departamento).limit(201).get();
    res.json({ok:true,lotes:snap.docs.slice(0,200).map(d=>({...d.data(),id:d.id})),truncado:snap.size>200});
}));
router.post('/lotes/previa',rota(async(req,res)=>{
    idValido(req.body.modeloId);const modelo=(await db().collection(MODELOS).doc(req.body.modeloId).get()).data();
    const r=montarLote(req.body,modelo);
    res.json({ok:true,revisao:modelo.revisao,duplicados:r.duplicados,previas:r.agendas.map(a=>({para:a.para,destinatario:a.destinatario,valores:a.valores,...(modelo.canal==='email'?previaEmail(modelo,a.valores):{corpo:modelo.whatsapp.corpo.replace(/\{\{\s*(\d+)\s*\}\}/g,(_,n)=>a.valores[modelo.variaveis[Number(n)-1]])})}))});
}));
router.post('/lotes',rota(async(req,res)=>{idValido(req.body.modeloId);idValido(req.body.pedidoId);res.json({ok:true,...await salvarLote(db(),req.body,req.user)});}));
router.post('/lotes/:id/estado',rota(async(req,res)=>{idValido(req.params.id);await alterarLote(db(),req.params.id,req.body.status,req.user);res.json({ok:true});}));
export default router;
