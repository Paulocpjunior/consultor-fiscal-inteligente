// ============================================================================
// sefaz-backend/das-orchestrator.js
// Orquestra emissao + persistencia de DAS no Firestore.
// ============================================================================

import admin from 'firebase-admin';
import { getDasProvider, getDasMode } from './das-provider.js';
import { assertEmissaoLiberada } from './emissao-guard.js';
import { fetchAllDocs, commitUpdatesInChunks } from './firestore-paginate.js';
import { calcularMultaDarf } from './multa-calculator.js';
import { assertValorMinimoDas } from './das-valor-utils.js';
import { criarErroDuplicidadeDas, encontrarConflitoDasAvulso } from './das-duplicidade-utils.js';
import { lerCodigoAtividadeSup } from './pgdas-atividade-config.js';
import { avaliarSemMovimento, montarDeclaracaoSemMovimento, interpretarRecusaSemMovimento, avaliarDeclaracaoJaEntregue } from './pgdas-sem-movimento.js';
import { candidatosSemMovimento, assertSondaNaoTransmite, lerResultadoCandidato, vereditoDaSonda } from './pgdas-sonda-sem-movimento.js';

const COLLECTION = 'das_emitidos';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

/**
 * Emite DAS regular (com PGDAS-D transmitido antes).
 *
 * @param {object} req { empresaId, empresaCnpj, empresaNome, competencia, valor, opts? }
 * @returns {object} doc DAS persistido
 */
export async function emitirDasRegular(req) {
    assertEmissaoLiberada('DAS');
    const { empresaId, empresaCnpj, empresaNome, competencia, dadosPgdas } = req;
    if (!empresaId || !empresaCnpj || !competencia || req.valor == null || req.valor === '') {
        throw new Error('Campos obrigatorios: empresaId, empresaCnpj, competencia, valor');
    }
    const valor = assertValorMinimoDas(req.valor);

    // Defesa em profundidade: a tela já recusa, mas um cliente desatualizado
    // (ou outro caminho) não pode transmitir declaração cuja natureza o app
    // ainda não sabe montar. Os motivos vêm no meta `_bloqueios` do payload.
    const bloqueios = Array.isArray(dadosPgdas?._bloqueios) ? dadosPgdas._bloqueios : [];
    if (bloqueios.length > 0) {
        const err = new Error(bloqueios.join(' '));
        err.httpStatus = 400;
        throw err;
    }

    // O cliente pode estar desatualizado (ou ter cache velho): quem decide se o
    // código do ISS fixo existe é o BANCO, não a lista que veio do navegador.
    if (dadosPgdas?._temSup) {
        const cfg = await lerCodigoAtividadeSup(fa().firestore());
        if (!cfg) {
            const err = new Error(
                'Receita marcada como ISS fixo (SUP) e o código oficial dessa atividade ainda não '
                + 'está cadastrado. Transmitir agora declararia "ISS retido pelo tomador" — valor '
                + 'certo, natureza errada. O que fazer: um administrador cadastra o código na tela '
                + 'do Simples (botão "🔎 Atividades declaradas"); enquanto isso, entregue esta '
                + 'competência direto no e-CAC.',
            );
            err.httpStatus = 400;
            throw err;
        }
    }

    const provider = getDasProvider();
    const mode = getDasMode();

    // 1. Transmite PGDAS-D (com payload detalhado se vier do frontend)
    const pgdas = await provider.transmitirPgdasD({ empresaCnpj, competencia, valor, dadosPgdas });

    // 2. Gera o DAS
    const das = await provider.gerarDas({ empresaCnpj, competencia, valor, tipo: 'regular' });

    // 3. Persiste no Firestore
    const db = fa().firestore();
    const docId = `${empresaCnpj}_${competencia}_regular`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        competencia,
        tipo: 'regular',
        valor,
        ...das,
        pgdasRecibo: pgdas.recibo,
        pgdasNumeroDeclaracao: pgdas.numeroDeclaracao || '',
        pgdasTipoDeclaracao: pgdas.tipoDeclaracao || 1,
        pgdasTransmitidoEm: pgdas.transmitidoEm,
        emitidoEm: new Date().toISOString(),
        modeUsado: mode,
        statusPagamento: 'pendente',  // pago | pendente | vencido
        dataPagamento: null,
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

/**
 * Emite DAS avulso (sem PGDAS-D — caso de complementar, atrasado, etc).
 */
export async function emitirDasAvulso(req) {
    assertEmissaoLiberada('DAS');
    const { empresaId, empresaCnpj, empresaNome, competencia, descricao } = req;
    if (!empresaId || !empresaCnpj || !competencia || req.valor == null || req.valor === '') {
        throw new Error('Campos obrigatorios: empresaId, empresaCnpj, competencia, valor');
    }
    const valor = assertValorMinimoDas(req.valor);

    const db = fa().firestore();
    const existentesSnap = await db.collection(COLLECTION)
        .where('empresaId', '==', empresaId)
        .limit(1000)
        .get();
    const existentes = existentesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.competencia === competencia);
    const conflito = encontrarConflitoDasAvulso(existentes, { competencia, valor });
    if (conflito) throw criarErroDuplicidadeDas(conflito);

    const provider = getDasProvider();
    const mode = getDasMode();
    const das = await provider.gerarDas({ empresaCnpj, competencia, valor, tipo: 'avulso' });

    const docId = `${empresaCnpj}_${competencia}_avulso_${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        competencia,
        tipo: 'avulso',
        descricao: descricao || '',
        valor,
        ...das,
        emitidoEm: new Date().toISOString(),
        modeUsado: mode,
        statusPagamento: 'pendente',
        dataPagamento: null,
    };
    await db.collection(COLLECTION).doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}

/**
 * Lista DAS emitidos com filtros opcionais.
 */
// Campos LEVES da listagem — o doc guarda o PDF inteiro em base64 (spread
// `...das` do emitir), e ler 500 docs completos derrubava a instância por
// memória (Central de DAS 500 sem JSON, 03/08 — estourou quando o cron
// mensal emitiu a leva de agosto). O PDF sai por getDasPdf, um doc por vez.
const CAMPOS_LISTAGEM = [
    'empresaId', 'empresaCnpj', 'empresaNome', 'competencia', 'tipo',
    'valor', 'vencimento', 'statusPagamento', 'dataPagamento', 'emitidoEm',
    'modeUsado', 'numeroDocumento', 'codigoBarras', 'descricao', 'pdfUrl',
    'ultimoEnvioCliente', 'pgdasRecibo',
];

export async function listarDas({ empresaId, competencia, status } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION).select(...CAMPOS_LISTAGEM);
    if (empresaId) q = q.where('empresaId', '==', empresaId);
    if (competencia) q = q.where('competencia', '==', competencia);
    if (status) q = q.where('statusPagamento', '==', status);

    const snap = await q.limit(500).get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.emitidoEm || '').localeCompare(a.emitidoEm || ''));
    return docs;
}

/** PDF/base64 de UM DAS — buscado sob demanda (baixar/imprimir/enviar). */
export async function getDasPdf(id) {
    const db = fa().firestore();
    const snap = await db.collection(COLLECTION).doc(String(id)).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return { id: snap.id, empresaId: d.empresaId || null, pdfBase64: d.pdfBase64 || null, pdfUrl: d.pdfUrl || null };
}

/**
 * Resumo agregado pra dashboard "Central de DAS".
 */
export async function getResumoDas() {
    const db = fa().firestore();
    // select: a conta só usa 3 campos — ler os docs inteiros (com pdfBase64)
    // tinha o mesmo risco de memória da listagem (03/08).
    const docs = (await fetchAllDocs(
        db.collection(COLLECTION).select('statusPagamento', 'vencimento', 'valor'),
        { label: 'das_emitidos/resumo' },
    )).map(d => d.data());

    const hoje = new Date().toISOString().slice(0, 10);
    let pendentes = 0, vencidos = 0, pagos = 0;
    let valorPendente = 0, valorVencido = 0, valorPago = 0;
    let valorMultaEstimada = 0;

    for (const d of docs) {
        const status = d.statusPagamento || 'pendente';
        const venc = d.vencimento || '';
        if (status === 'pago') {
            pagos++;
            valorPago += d.valor || 0;
        } else if (venc && venc < hoje) {
            vencidos++;
            valorVencido += d.valor || 0;
            // Soma multa+juros do snapshot persistido pelo cron (se houver).
            // Pra DAS vencidos sem snapshot, calcula on-the-fly como fallback.
            const me = d.multaEstimada;
            if (me && me.calculadoEm === hoje) {
                valorMultaEstimada += (me.multaValor || 0) + (me.jurosValor || 0);
            } else if (d.valor > 0) {
                const calc = calcularMultaDarf(d.valor, new Date(venc), new Date(hoje));
                if (calc) valorMultaEstimada += (calc.multaValor || 0) + (calc.jurosValor || 0);
            }
        } else {
            pendentes++;
            valorPendente += d.valor || 0;
        }
    }
    return {
        totalDas: docs.length,
        pendentes, vencidos, pagos,
        valorPendente, valorVencido,
        valorVencidoAtualizado: +(valorVencido + valorMultaEstimada).toFixed(2),
        valorMultaEstimada: +valorMultaEstimada.toFixed(2),
        valorPago,
        mode: getDasMode(),
    };
}

/**
 * Processamento noturno: atualiza status, identifica vencimentos proximos.
 *
 * Comportamento:
 * - DAS pendente com vencimento < hoje -> status 'vencido'
 * - DAS pendente com vencimento entre hoje e hoje+5d -> mantido 'pendente'
 *   mas listado em 'aVencerEm5Dias'
 * - DAS pago: ignorado
 *
 * Logs salvos em 'das_cron_logs' (Firestore) pra auditoria.
 */
export async function processarCronDas() {
    const db = fa().firestore();
    const hoje = new Date().toISOString().slice(0, 10);
    const cincoDiasFrente = (() => {
        const d = new Date(); d.setDate(d.getDate() + 5);
        return d.toISOString().slice(0, 10);
    })();

    const snapDocs = await fetchAllDocs(db.collection(COLLECTION), { label: 'das_emitidos/cron' });
    const stats = {
        totalDas: snapDocs.length,
        vencidos: 0,
        aVencer: 0,
        pagos: 0,
        atualizadosParaVencido: 0,
        empresasComVencido: new Set(),
        empresasComProximoVencimento: new Set(),
        valorVencidoTotal: 0,
    };
    const aVencerLista = [];
    const vencidosLista = [];

    const updates = [];

    for (const doc of snapDocs) {
        const d = doc.data();
        const status = d.statusPagamento || 'pendente';
        if (status === 'pago') {
            stats.pagos++;
            continue;
        }
        const venc = d.vencimento || '';
        if (!venc) continue;

        if (venc < hoje) {
            // Esta vencido: atualiza status se ainda nao foi + persiste estimativa
            // de atualizacao monetaria (Lei 9.430/96 art. 61 + LC 123 art. 35).
            // SELIC e estimativa conservadora; valor REAL vem do SERPRO ao re-emitir.
            stats.vencidos++;
            stats.valorVencidoTotal += d.valor || 0;
            stats.empresasComVencido.add(d.empresaCnpj);

            const multaEst = d.valor > 0
                ? calcularMultaDarf(d.valor, new Date(venc), new Date(hoje))
                : null;
            const multaEstimadaDoc = multaEst ? {
                dias: multaEst.dias,
                multaPct: multaEst.multaPct,
                multaValor: multaEst.multaValor,
                jurosPct: multaEst.jurosPct,
                jurosValor: multaEst.jurosValor,
                total: multaEst.total,
                calculadoEm: hoje,
            } : null;

            vencidosLista.push({
                empresaCnpj: d.empresaCnpj,
                empresaNome: d.empresaNome || '',
                competencia: d.competencia,
                valor: d.valor,
                vencimento: venc,
                diasAtraso: Math.floor((new Date(hoje) - new Date(venc)) / 86400000),
                multaEstimada: multaEstimadaDoc,
            });

            // Persiste status 'vencido' (se mudou) + sempre atualiza multaEstimada
            // (mesmo se ja era vencido — dias passam, valores mudam).
            const updateData = { atualizadoEm: new Date().toISOString() };
            if (status !== 'vencido') {
                updateData.statusPagamento = 'vencido';
                stats.atualizadosParaVencido++;
            }
            if (multaEstimadaDoc) {
                updateData.multaEstimada = multaEstimadaDoc;
            }
            updates.push({ ref: doc.ref, data: updateData });
        } else if (venc <= cincoDiasFrente) {
            // Proximo vencimento
            stats.aVencer++;
            stats.empresasComProximoVencimento.add(d.empresaCnpj);
            aVencerLista.push({
                empresaCnpj: d.empresaCnpj,
                empresaNome: d.empresaNome || '',
                competencia: d.competencia,
                valor: d.valor,
                vencimento: venc,
                diasRestantes: Math.floor((new Date(venc) - new Date(hoje)) / 86400000),
            });
        }
    }

    await commitUpdatesInChunks(db, updates);

    return {
        ...stats,
        empresasComVencido: stats.empresasComVencido.size,
        empresasComProximoVencimento: stats.empresasComProximoVencimento.size,
        valorVencidoTotal: +stats.valorVencidoTotal.toFixed(2),
        aVencerLista: aVencerLista.slice(0, 30),  // top 30 pra log nao explodir
        vencidosLista: vencidosLista.slice(0, 30),
    };
}

/**
 * Marca DAS como pago.
 */
export async function marcarPago(docId, dataPagamento) {
    const db = fa().firestore();
    await db.collection(COLLECTION).doc(docId).update({
        statusPagamento: 'pago',
        dataPagamento: dataPagamento || new Date().toISOString().slice(0, 10),
    });
    return { ok: true };
}


// ────────────────────────────────────────────────────────────────────────────
// PGDAS-D SEM MOVIMENTO — declaração sem guia.
//
// Declaração e guia são obrigações DIFERENTES, e no app estavam soldadas: a
// transmissão do PGDAS-D só acontecia dentro do `emitirDasRegular`, que recusa
// valor abaixo de R$ 10,00. Mês sem faturamento não passava pela porta, e a
// declaração ficava pro e-CAC à mão — sem registro, sem auditoria, e invisível
// na Rotina do Mês. Não entregar custa MAED de R$ 50,00 por competência.
//
// AQUI NÃO SE GERA DAS de propósito: não há o que pagar, e emitir guia de
// valor zero criaria cobrança que não existe.
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────
// SONDA DO "SEM MOVIMENTO" — perguntar ao SERPRO qual forma ele aceita, SEM
// entregar nada.
//
// A regra da casa continua de pé: payload de entrega não se adivinha, porque
// entrega ao PGDAS-D não se desfaz. O que esta rota usa é o modo
// `indicadorTransmissao: false` do TRANSDECLARACAO11 — ele VALIDA e não
// entrega. É dele que vem a MSG_ISN_023 que a ELS COMERCIO DE BANANAS recebe,
// e é por isso que a mensagem sempre pôde dizer "nada foi transmitido".
//
// Ou seja: existe um oráculo que responde "esta forma serve?" sem custo fiscal.
// Perguntar a ele é PROVA, não dedução — mesma técnica das sondas do R-2055 em
// produção restrita.
//
// TRAVA: cada candidato passa por `assertSondaNaoTransmite` antes de sair. Uma
// sonda que entregasse por engano seria pior que o bloqueio que ela resolve.
// ────────────────────────────────────────────────────────────────────────────
export async function sondarFormaSemMovimento(req) {
    const { empresaCnpj, competencia, filiais = [] } = req || {};
    if (!empresaCnpj || !competencia) {
        const err = new Error('Campos obrigatórios: empresaCnpj, competencia');
        err.httpStatus = 400;
        throw err;
    }

    const provider = getDasProvider();
    if (typeof provider.validarDeclaracaoPgdas !== 'function') {
        const err = new Error('A sonda precisa do provider SERPRO (modo real). No modo mock não há a quem '
            + 'perguntar — e inventar a resposta seria o oposto do que ela existe pra fazer.');
        err.httpStatus = 409;
        err.code = 'SONDA_SEM_PROVIDER';
        throw err;
    }

    const cnpjLimpo = String(empresaCnpj).replace(/\D/g, '');
    const pa = Number(String(competencia).replace(/\D/g, '').slice(0, 6));

    // 🚨 A SONDA PERGUNTA COM O PAYLOAD DO CAMINHO REAL — inclusive o
    // `tipoDeclaracao`, que é OBRIGATÓRIO e faltava (ELS 07/2026, 20/08: as 6
    // formas voltaram "Required property 'TipoDeclaracao' not found in JSON",
    // ou seja nenhuma chegou a ser avaliada). Quem preenche esse campo no
    // caminho real é `transmitirPgdasD`, consultando se a competência já foi
    // declarada: 1 = Original, 2 = Retificadora.
    //
    // ⚠️ CONSULTA CAÍDA NÃO PARA A SONDA: ela cai em Original e DIZ qual usou.
    // Bloquear aqui trocaria um beco por outro — e a sonda não transmite nada.
    let tipoDeclaracao = 1;
    let origemTipo = 'padrao-original';
    if (typeof provider.consultarDeclaracaoPa === 'function') {
        try {
            const consulta = await provider.consultarDeclaracaoPa({ empresaCnpj: cnpjLimpo, competencia: pa });
            tipoDeclaracao = consulta?.existe ? 2 : 1;
            origemTipo = consulta?.existe ? 'consulta-retificadora' : 'consulta-original';
        } catch (e) {
            console.warn('[das/sonda] consulta do tipo de declaração falhou:', e?.message);
        }
    }
    const candidatos = candidatosSemMovimento({ cnpj: cnpjLimpo, filiais, tipoDeclaracao });

    const resultados = [];
    for (const c of candidatos) {
        try {
            // A trava roda sobre o MESMO objeto que vai ao SERPRO — conferir
            // uma cópia provaria só que a cópia estava certa.
            const resposta = await provider.validarDeclaracaoPgdas({
                cnpjLimpo, pa, declaracao: c.declaracao,
                antesDeEnviar: assertSondaNaoTransmite,
            });
            resultados.push(lerResultadoCandidato({ nome: c.nome, hipotese: c.hipotese, resposta }));
        } catch (e) {
            if (e?.code === 'SONDA_NAO_TRANSMITE') throw e;   // trava violada: PARA tudo
            resultados.push(lerResultadoCandidato({ nome: c.nome, hipotese: c.hipotese, erro: e }));
        }
    }

    const veredito = vereditoDaSonda(resultados);

    // Auditoria: a sonda gasta chamada paga do SERPRO e produz CONHECIMENTO —
    // o resultado precisa sobreviver à sessão que a rodou.
    try {
        await fa().firestore().collection('pgdas_sonda_sem_movimento').add({
            empresaCnpj: cnpjLimpo, competencia, rodadoEm: Date.now(),
            rodadoPor: req?.rodadoPor || null,
            tipoDeclaracao, origemTipo,
            resultados, veredito,
        });
    } catch (e) {
        console.warn('[das/sonda] auditoria não gravada:', e?.message);
    }

    return {
        ok: true,
        competencia,
        // Sempre verdade, em qualquer desfecho: nenhum candidato transmite.
        nadaFoiTransmitido: true,
        // Qual tipo a sonda usou, e de onde ele veio — o número que vai no
        // payload precisa aparecer, senão a próxima leitura não sabe o que foi
        // perguntado de verdade.
        tipoDeclaracao,
        origemTipo,
        candidatos: resultados,
        veredito,
    };
}

export async function declararPgdasSemMovimento(req) {
    assertEmissaoLiberada('DAS');
    const {
        empresaId, empresaCnpj, empresaNome, competencia, filiais = [],
        receitaLancada = 0, notasCapturadas = 0,
        capturaConfiavel = false, motivoCapturaIncerta = '',
        confirmadoPeloColaborador = false, confirmadoPor = null,
    } = req || {};

    if (!empresaId || !empresaCnpj || !competencia) {
        throw new Error('Campos obrigatórios: empresaId, empresaCnpj, competencia');
    }

    // A régua vive no módulo puro; aqui é só I/O. Recusa vira 400 com o motivo
    // E a ação — mensagem sem ação é alarme que ninguém sabe atender.
    const veredito = avaliarSemMovimento({
        receitaLancada, notasCapturadas, capturaConfiavel, motivoCapturaIncerta,
        confirmadoPeloColaborador,
    });
    if (!veredito.pode) {
        const err = new Error(`${veredito.motivo} ${veredito.acao || ''}`.trim());
        err.httpStatus = 400;
        err.code = `SEM_MOVIMENTO_${veredito.situacao.toUpperCase().replace(/-/g, '_')}`;
        throw err;
    }

    const provider = getDasProvider();
    const mode = getDasMode();

    // JÁ FOI ENTREGUE? Perguntar antes de transmitir evita devolver mensagem de
    // ERRO para quem ACERTOU — foi o caso da MORDAM 07/2026 (12/08): entregue no
    // e-CAC, e o app ainda deixava tentar e falhava com MSG_ISN_023.
    // Consulta caída NÃO bloqueia: não saber se já foi entregue não é motivo pra
    // impedir a entrega de uma competência que continua vencendo.
    //
    // E o RESULTADO da conferência viaja até a recusa: a trava pegou a MORDAM e
    // não pegou a ELS 07/2026 (12/08), e da tela não dava pra saber se a Receita
    // tinha dito "não há declaração" ou se a consulta simplesmente não rodou.
    // São ações opostas — ver `resumirConsultaPrevia`.
    let consultaPrevia = null;
    if (typeof provider.consultarAtividadesDeclaradas === 'function') {
        try {
            const consulta = await provider.consultarAtividadesDeclaradas({
                empresaCnpj, competencia,
            });
            const ja = avaliarDeclaracaoJaEntregue(consulta?.leitura);
            if (ja.jaEntregue) {
                const err = new Error(`${ja.motivo} ${ja.acao}`);
                err.httpStatus = 409;
                err.code = 'SEM_MOVIMENTO_JA_ENTREGUE';
                err.mensagemUsuario = `${ja.motivo} ${ja.acao}`;
                err.numeroDeclaracao = ja.numeroDeclaracao;
                throw err;
            }
            consultaPrevia = { ok: true, situacao: consulta?.leitura?.situacao || null };
        } catch (e) {
            if (e?.code === 'SEM_MOVIMENTO_JA_ENTREGUE') throw e;
            console.warn('[das/sem-movimento] consulta prévia indisponível, seguindo:', e?.message);
            consultaPrevia = { ok: false, erro: e?.message || 'falha na consulta' };
        }
    }

    const declaracao = montarDeclaracaoSemMovimento({ cnpj: empresaCnpj, filiais });

    // O provider decide Original × Retificadora consultando o PA no SERPRO.
    //
    // A recusa do SN-Entregar sai TRADUZIDA: a primeira transmissão real levou
    // "MSG_ISN_023 — O valor da atividade deve ser maior que zero", que é
    // mensagem de sistema e não diz a ninguém o que fazer com a competência que
    // continua vencendo (MAED de R$ 50,00).
    let pgdas;
    try {
        pgdas = await provider.transmitirPgdasD({
            empresaCnpj, competencia, valor: 0, dadosPgdas: { declaracao },
        });
    } catch (e) {
        const r = interpretarRecusaSemMovimento(e?.message, consultaPrevia);
        const err = new Error(`${r.mensagem} ${r.acao}`);
        err.httpStatus = 400;
        err.code = r.codigo || 'SEM_MOVIMENTO_RECUSADO';
        // Redigida pra ser lida — não pode ser cortada por tamanho pelo
        // sanitizador (foi o "Erro interno (ref …)" de 12/08).
        err.mensagemUsuario = `${r.mensagem} ${r.acao}`;
        throw err;
    }

    // Auditoria em coleção PRÓPRIA: isto não é um DAS, e gravar em
    // `das_emitidos` faria a listagem de guias mostrar uma cobrança que não
    // existe — e o "a recolher" da carteira somar zero como se fosse guia.
    const db = fa().firestore();
    const docId = `${String(empresaCnpj).replace(/\D/g, '')}_${competencia}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const payload = {
        empresaId,
        empresaCnpj,
        empresaNome: empresaNome || '',
        competencia,
        tipo: 'sem-movimento',
        pgdasRecibo: pgdas.recibo,
        pgdasNumeroDeclaracao: pgdas.numeroDeclaracao || '',
        pgdasTipoDeclaracao: pgdas.tipoDeclaracao || 1,
        pgdasTransmitidoEm: pgdas.transmitidoEm,
        // A PROVA de que a afirmação foi humana e de que a captura estava sã no
        // momento da declaração. Sem isso, daqui a um ano ninguém sabe em que
        // base se afirmou à Receita que não houve faturamento.
        capturaConfiavelNoMomento: true,
        confirmadoPor: confirmadoPor || null,
        alertas: veredito.alertas,
        declaradoEm: new Date().toISOString(),
        modeUsado: mode,
    };
    await db.collection('pgdas_sem_movimento').doc(docId).set(payload, { merge: true });
    return { id: docId, ...payload };
}
