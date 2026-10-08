import { createHash } from 'node:crypto';
import { exigir, validarAgenda, AGENDAS, MODELOS } from './comunicacao-modelos.js';
export const LOTES = 'comunicacao_lotes';
export const CONTATOS = 'comunicacao_contatos';
export const MAX_LOTE = 400;
export function normalizarContatos(entradas, canal = 'email') {
    exigir(Array.isArray(entradas) && entradas.length > 0 && entradas.length <= MAX_LOTE, `Selecione de 1 a ${MAX_LOTE} contatos por lote.`);
    const vistos = new Set(), contatos = [];
    for (const [i, e] of entradas.entries()) {
        const para = String(e?.para || '').trim();
        const email = para.toLowerCase();
        exigir(canal === 'email' ? /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email) : /^\+?\d{10,15}$/.test(para), `Linha ${i + 1}: destinatário inválido (${para.slice(0, 80)}).`);
        const cnpj = String(e.cnpj || '').replace(/\D/g, '');
        exigir(!cnpj || cnpj.length === 14, `Linha ${i + 1}: CNPJ deve ter 14 dígitos.`);
        const empresa = String(e.empresa || '').trim(), contato = String(e.contato || '').trim();
        exigir(empresa.length <= 200 && contato.length <= 120, `Linha ${i + 1}: nome muito longo.`);
        const destino = canal === 'email' ? email : para.replace(/^\+/, '');
        const chave = `${cnpj || empresa.toLowerCase()}|${destino}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        contatos.push({ para: destino, cnpj, empresa, contato });
    }
    return { contatos, duplicados: entradas.length - contatos.length };
}
export function montarLote(entrada, modelo, agora = new Date()) {
    const normalizados = normalizarContatos(entrada.contatos, modelo?.canal);
    const agendas = normalizados.contatos.map(c => ({ ...validarAgenda({ ...entrada, para: c.para, valores: { ...entrada.valores, cliente: c.empresa || c.contato || c.para, empresa: c.empresa || c.contato || c.para, cnpj: c.cnpj, contato: c.contato || c.empresa || c.para } }, modelo, agora), destinatario: c }));
    exigir(Buffer.byteLength(JSON.stringify(agendas)) <= 7_000_000, 'O conteúdo deste lote é muito grande. Reduza os contatos ou o tamanho das variáveis.');
    return { agendas, duplicados: normalizados.duplicados };
}
export async function salvarLote(store, entrada, autor, agora = new Date()) {
    const modelRef = store.collection(MODELOS).doc(entrada.modeloId);
    const modelo = (await modelRef.get()).data();
    exigir(modelo && entrada.modeloRevisao === modelo.revisao, 'Modelo mudou. Confira novamente as mensagens do lote.');
    const { agendas, duplicados } = montarLote(entrada, modelo, agora);
    const hash = createHash('sha256').update(JSON.stringify(agendas)).digest('hex');
    const ref = store.collection(LOTES).doc(entrada.pedidoId);
    const ids = agendas.map((_,i) => `${ref.id}_${i}`);
    await store.runTransaction(async tx => {
        const [atual, existe] = await Promise.all([tx.get(modelRef), tx.get(ref)]);
        exigir(atual.data()?.ativo && atual.data()?.revisao === modelo.revisao, 'Modelo mudou. Atualize antes de salvar.');
        if (existe.exists) { exigir(existe.data().hash === hash && existe.data().criadoUid === autor.uid, 'Pedido já utilizado com outros dados.'); return; }
        const em = agora.toISOString();
        agendas.forEach((a,i) => tx.set(store.collection(AGENDAS).doc(ids[i]), { ...a, loteId: ref.id, criadoPor: autor.email, criadoUid: autor.uid, criadoEm: em }));
        tx.set(ref, { ids, hash, quantidade: ids.length, duplicados, departamento: modelo.departamento, modeloId: entrada.modeloId, nome: modelo.nome, status: 'pausado', criadoPor: autor.email, criadoUid: autor.uid, criadoEm: em });
    });
    return { id: ref.id, quantidade: ids.length, duplicados };
}
export async function alterarLote(store, id, status, autor, agora = new Date()) {
    exigir(['ativo','pausado','cancelado'].includes(status), 'Estado inválido.');
    const ref = store.collection(LOTES).doc(id);
    await store.runTransaction(async tx => {
        const lote = (await tx.get(ref)).data(); exigir(lote, 'Lote não encontrado.');
        const docs = await Promise.all(lote.ids.map(i=>tx.get(store.collection(AGENDAS).doc(i))));
        exigir(docs.every(d=>d.exists && ['ativo','pausado'].includes(d.data().status)), 'Há ocorrências em execução ou encerradas. Confira e altere os agendamentos individualmente.');
        if (status === 'ativo') {
            const modelo = (await tx.get(store.collection(MODELOS).doc(lote.modeloId))).data();
            exigir(modelo?.ativo && docs.every(d=>d.data().modelo.revisao===modelo.revisao), 'Modelo mudou. Revise o lote.');
            exigir(docs.every(d=>d.data().proximoEm>agora.toISOString()), 'Horário passou. Crie um lote com nova data.');
        }
        const evento = { status, atualizadoEm: agora.toISOString(), atualizadoPor: autor.email };
        docs.forEach(d=>tx.update(d.ref,evento));tx.update(ref,evento);
        tx.set(store.collection('comunicacao_agendas_historico').doc(), { loteId:id, quantidade:docs.length, status, por:autor.email, em:agora.toISOString() });
    });
}
