import { AGENDAS, MODELOS, EXECUCOES, proximaOcorrencia } from './comunicacao-modelos.js';

// Reserva transacional antes da rede. Uma ocorrência incerta nunca volta à fila.
export async function executarOcorrencia(db, ref, agora, preparar) {
    const reserva = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const ag = snap.data();
        if (!ag || ag.status !== 'ativo' || ag.proximoEm > agora.toISOString()) return null;
        if (ag.fim && ag.fim < agora.toISOString()) {
            tx.update(ref, { status: 'concluido', ultimoResultado: { status: 'expirado', erro: 'Data final ultrapassada antes da execução.' } });
            return null;
        }
        const execRef = db.collection(EXECUCOES).doc(`${ref.id}_${Date.parse(ag.proximoEm)}`);
        const anterior = await tx.get(execRef);
        if (anterior.exists) return null;
        tx.set(execRef, { agendaId: ref.id, departamento: ag.modelo.departamento, previstoEm: ag.proximoEm, iniciadoEm: agora.toISOString(), status: 'processando', modeloId: ag.modeloId, revisao: ag.modelo.revisao, para: ag.para, criadoPor: ag.criadoPor });
        tx.update(ref, { status: 'processando', execucaoId: execRef.id, iniciadoEm: agora.toISOString() });
        return { ag, execRef };
    });
    if (!reserva) return { ignorado: true };
    const { ag, execRef } = reserva;
    let enviar;
    let resultado;
    try {
        const atual = (await db.collection(MODELOS).doc(ag.modeloId).get()).data();
        if (!atual?.ativo) throw new Error('Modelo desativado.');
        if (atual.revisao !== ag.modelo.revisao) throw new Error('Modelo alterado. Crie um agendamento com a nova revisão.');
        enviar = await preparar(ag);
    } catch (e) { resultado = { status: 'falhou', erro: e.message }; }
    if (enviar) {
        try {
            const r = await enviar();
            resultado = r.ok ? { status: 'aceito', messageId: r.messageId || null } : { status: r.indeterminado === false ? 'falhou' : 'indeterminado', erro: r.error || r.erro || 'Envio não confirmado.' };
        } catch (e) { resultado = { status: 'indeterminado', erro: e.message }; }
    }
    const terminou = new Date();
    const proximo = resultado.status === 'aceito' ? proximaOcorrencia(ag, terminou > agora ? terminou : agora) : null;
    await db.runTransaction(async tx => {
        tx.update(execRef, { ...resultado, encerradoEm: terminou.toISOString() });
        tx.update(ref, { status: resultado.status === 'aceito' ? (proximo ? 'ativo' : 'concluido') : resultado.status, ...(proximo ? { proximoEm: proximo } : {}), ultimoResultado: resultado, atualizadoEm: terminou.toISOString() });
    });
    return { id: ref.id, ...resultado };
}

export async function tickComunicacao(db, agora, preparar) {
    const snap = await db.collection(AGENDAS).where('status', '==', 'ativo').limit(2000).get();
    const vencidos = snap.docs.filter(d => d.data().proximoEm <= agora.toISOString()).sort((a, b) => a.data().proximoEm.localeCompare(b.data().proximoEm));
    const resultados = [];
    for (const doc of vencidos.slice(0, 25)) {
        try { resultados.push(await executarOcorrencia(db, doc.ref, agora, preparar)); }
        catch (e) { resultados.push({ id: doc.id, status: 'revisao-necessaria', erro: e.message }); }
    }
    return { resultados, maisNaFila: vencidos.length > 25, leituraTruncada: snap.size >= 2000 };
}
