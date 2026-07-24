// ============================================================================
// sefaz-backend/tarefas-orchestrator.js
// Cron mensal: cria tarefas automaticas (DAS, DCTFWeb, FGTS, SPED) pra
// todas as empresas, com base no regime.
//
// Mapeamento de colecao Firestore -> regime:
//   simples_empresas -> SIMPLES   -> DAS + FGTS
//   lucro_empresas   -> LUCRO_REAL -> DCTFWeb + FGTS + SPED
//     (nao distingue Presumido de Real; ambos tem as mesmas 3 obrigacoes
//     mensais. Diferenciacao fica pra v2 quando houver campo subregime.)
//
// Idempotente: se rodar 2x no mesmo mes, nao duplica (dedup por
// empresaId+obrigacao+competencia).
//
// Atribui automaticamente ao titular da Carteira (papel=principal).
// Se nao ha titular, fica sem responsavel.
//
// Log: colecao tarefas_cron_logs.
// ============================================================================

import admin from 'firebase-admin';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// Mesmo mapa do services/calendarioFiscal.ts (mantido em sync manual).
const OBRIGACOES_POR_REGIME = {
    SIMPLES: [
        { obrigacao: 'DAS',     diaVencimento: 20, mesesApos: 1, label: 'DAS' },
        { obrigacao: 'FGTS',    diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital' },
    ],
    LUCRO_REAL: [
        { obrigacao: 'DCTFWEB', diaVencimento: 15, mesesApos: 1, label: 'DCTFWeb' },
        { obrigacao: 'FGTS',    diaVencimento: 20, mesesApos: 1, label: 'FGTS Digital' },
        { obrigacao: 'SPED',    diaVencimento: 25, mesesApos: 2, label: 'SPED Fiscal' },
    ],
};

const COLECOES_REGIMES = [
    { colecao: 'simples_empresas', regime: 'SIMPLES' },
    { colecao: 'lucro_empresas',   regime: 'LUCRO_REAL' },
];

function anteciparFimDeSemana(d) {
    const dia = d.getDay();
    if (dia === 6) d.setDate(d.getDate() - 1);
    else if (dia === 0) d.setDate(d.getDate() - 2);
    return d;
}

function calcularVencimento(competencia, regra) {
    const [mesStr, anoStr] = competencia.split('/');
    const mes = parseInt(mesStr, 10);
    const ano = parseInt(anoStr, 10);
    if (isNaN(mes) || isNaN(ano)) {
        throw new Error(`competencia invalida: "${competencia}"`);
    }
    const dataBase = new Date(ano, mes - 1 + regra.mesesApos, regra.diaVencimento);
    return anteciparFimDeSemana(dataBase);
}

function competenciaAtual() {
    const d = new Date();
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return `${mes}/${ano}`;
}

/**
 * Acha o titular (papel=principal) de uma empresa na Carteira.
 */
async function getTitularDaEmpresa(db, empresaId) {
    if (!empresaId) return null;
    const snap = await db.collection('carteiras')
        .where('empresaId', '==', empresaId)
        .where('papel', '==', 'principal')
        .get();
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    return { uid: d.colaboradorUid, nome: d.colaboradorNome || '' };
}

/**
 * Cria UMA tarefa automatica. Idempotente.
 */
async function criarTarefaSeFalta(db, params) {
    const { empresaId, empresaCnpj, empresaNome, regra, competencia, titular } = params;
    // dedup
    const dup = await db.collection('tarefas')
        .where('empresaId', '==', empresaId)
        .where('obrigacao', '==', regra.obrigacao)
        .where('competencia', '==', competencia)
        .get();
    if (!dup.empty) {
        return { criada: false, jaExistia: true, id: dup.docs[0].id };
    }
    const vencimento = calcularVencimento(competencia, regra);
    const ref = await db.collection('tarefas').add({
        titulo: `${regra.label} ${competencia}`,
        descricao: '',
        empresaId,
        empresaCnpj: empresaCnpj || '',
        empresaNome: empresaNome || '',
        obrigacao: regra.obrigacao,
        competencia,
        vencimento: admin.firestore.Timestamp.fromDate(vencimento),
        status: 'a_fazer',
        responsavel: titular?.uid ?? null,
        responsavelNome: titular?.nome ?? null,
        origem: 'automatica',
        criadoPor: 'sistema',
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        concluidaEm: null,
        concluidaPor: null,
        ultimoEmailEm: null,
    });
    return { criada: true, id: ref.id };
}

/**
 * Executa o cron mensal: itera todas as empresas, cria as tarefas
 * automaticas do mes baseado no regime.
 *
 * @param {string} competencia "MM/AAAA" (default: mes corrente)
 * @param {object} opts { empresaIdEspecifica?: string }  // pra gerar 1 so
 * @returns log da execucao
 */
export async function executarCronMensal(competencia, opts = {}) {
    fa();
    const db = admin.firestore();
    const comp = competencia || competenciaAtual();

    const inicio = new Date();
    const log = {
        competencia: comp,
        iniciadoEm: inicio.toISOString(),
        empresasProcessadas: 0,
        empresasSemCarteira: 0,
        empresasPuladas: 0,
        tarefasCriadas: 0,
        tarefasJaExistiam: 0,
        erros: [],
    };

    for (const { colecao, regime } of COLECOES_REGIMES) {
        const regras = OBRIGACOES_POR_REGIME[regime];
        if (!regras || regras.length === 0) continue;

        let snap;
        try {
            if (opts.empresaIdEspecifica) {
                const docRef = await db.collection(colecao).doc(opts.empresaIdEspecifica).get();
                if (!docRef.exists) continue;
                snap = { docs: [docRef] };
            } else {
                snap = await db.collection(colecao).get();
            }
        } catch (e) {
            log.erros.push(`Falha ao ler ${colecao}: ${e.message}`);
            continue;
        }

        for (const empDoc of snap.docs) {
            const emp = empDoc.data();
            // Pula perdedores do merge (23/05): empresa consolidada em outra.
            // Sem isso o cron cria tarefas em dobro pro CNPJ duplicado.
            if (emp._merged_into || emp._deleted) { log.empresasPuladas++; continue; }
            const empresaId = empDoc.id;
            const empresaNome = emp.razaoSocial || emp.nome || emp.empresaNome || '';
            const empresaCnpj = emp.cnpj || emp.empresaCnpj || '';

            try {
                const titular = await getTitularDaEmpresa(db, empresaId);
                if (!titular) log.empresasSemCarteira++;

                for (const regra of regras) {
                    const r = await criarTarefaSeFalta(db, {
                        empresaId, empresaCnpj, empresaNome, regra,
                        competencia: comp, titular,
                    });
                    if (r.criada) log.tarefasCriadas++;
                    else if (r.jaExistia) log.tarefasJaExistiam++;
                }
                log.empresasProcessadas++;
            } catch (e) {
                log.erros.push(`Empresa ${empresaId} (${empresaCnpj}): ${e.message}`);
            }
        }
    }

    const fim = new Date();
    log.finalizadoEm = fim.toISOString();
    log.duracaoMs = fim.getTime() - inicio.getTime();

    // Persiste log (admins leem)
    try {
        await db.collection('tarefas_cron_logs').add({
            ...log,
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.warn('[tarefas-cron] falha ao gravar log:', e.message);
    }

    return log;
}

/**
 * Versao "gerar pra 1 empresa especifica" — pra cobrir o caso de empresa
 * nova que entrou depois do dia 1. Re-aproveita executarCronMensal.
 */
export async function gerarTarefasDeUmaEmpresa(empresaId, competencia) {
    return executarCronMensal(competencia, { empresaIdEspecifica: empresaId });
}

/**
 * Atribui retroativamente as tarefas sem dono ao titular da Carteira.
 *
 * Para cada tarefa com responsavel=null E status!=concluida:
 *   - busca o titular (papel=principal) da empresa na carteira
 *   - se achar, atribui (responsavel + responsavelNome)
 *   - se nao achar, deixa sem dono
 *
 * Idempotente: se tarefa ja tem responsavel, pula. Se carteira nao tem
 * titular, pula. Rodar 10x nao muda nada apos a 1a.
 *
 * @returns log da execucao
 */
export async function aplicarCarteiraRetroativo() {
    fa();
    const db = admin.firestore();

    const inicio = new Date();
    const log = {
        iniciadoEm: inicio.toISOString(),
        tarefasAvaliadas: 0,
        tarefasAtribuidas: 0,
        tarefasSemTitular: 0,
        tarefasJaAtribuidas: 0,
        erros: [],
    };

    // Cache de titulares por empresa (evita re-query)
    const cacheTitular = new Map(); // empresaId -> {uid, nome} | null

    async function getTitularCacheado(empresaId) {
        if (cacheTitular.has(empresaId)) return cacheTitular.get(empresaId);
        try {
            const snap = await db.collection('carteiras')
                .where('empresaId', '==', empresaId)
                .where('papel', '==', 'principal')
                .get();
            const titular = snap.empty
                ? null
                : { uid: snap.docs[0].data().colaboradorUid, nome: snap.docs[0].data().colaboradorNome || '' };
            cacheTitular.set(empresaId, titular);
            return titular;
        } catch (e) {
            cacheTitular.set(empresaId, null);
            return null;
        }
    }

    try {
        const snap = await db.collection('tarefas')
            .where('responsavel', '==', null)
            .get();

        for (const d of snap.docs) {
            log.tarefasAvaliadas++;
            const data = d.data();
            if (data.status === 'concluida' || data.status === 'cancelada') {
                log.tarefasJaAtribuidas++;
                continue;
            }
            try {
                const titular = await getTitularCacheado(data.empresaId);
                if (titular) {
                    await d.ref.update({
                        responsavel: titular.uid,
                        responsavelNome: titular.nome,
                    });
                    log.tarefasAtribuidas++;
                } else {
                    log.tarefasSemTitular++;
                }
            } catch (e) {
                log.erros.push(`Tarefa ${d.id}: ${e.message}`);
            }
        }
    } catch (e) {
        log.erros.push(`Falha geral: ${e.message}`);
    }

    const fim = new Date();
    log.finalizadoEm = fim.toISOString();
    log.duracaoMs = fim.getTime() - inicio.getTime();

    try {
        await db.collection('tarefas_cron_logs').add({
            ...log,
            tipo: 'aplicarCarteiraRetroativo',
            criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.warn('[tarefas-retro] falha ao gravar log:', e.message);
    }

    return log;
}
