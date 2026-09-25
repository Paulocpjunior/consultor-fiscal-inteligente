// ============================================================================
// sefaz-backend/tarefas-orchestrator.js
// Cron mensal: cria as tarefas do mes de cada cliente, por REGIME.
//
// O CATALOGO NAO MORA MAIS AQUI (11/08). Ele tinha uma copia propria, pobre e
// divergente das outras duas do projeto: so conhecia SIMPLES=DAS+FGTS e
// LUCRO_REAL=DCTFWeb+FGTS+SPED, e mapeava `lucro_empresas -> LUCRO_REAL`
// SEMPRE -- ou seja, LUCRO PRESUMIDO NAO EXISTIA para o cron que gera o mes.
// PIS/COFINS, EFD-Contribuicoes e IRPJ/CSLL trimestral nunca viravam tarefa,
// entao nao apareciam em Vencimentos, nao chegavam ao Guia do mes, e o farol
// dizia "mes fechado" com obrigacao nunca listada.
//
// Agora a fonte e `catalogo-obrigacoes.js` (puro, testado), a mesma que o front
// le. Regime sai de `resolverRegime` -- e cliente do Lucro SEM `regimePadrao`
// nao vira Real por default: vira INDEFINIDO, recebe so o que os dois regimes
// tem em comum e entra em `empresasSemRegime` no log. Adivinhar regime e
// adivinhar imposto.
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
import { resolverRegime, obrigacoesAplicaveis, calcularVencimento, assertCompetencia, mesDoCliente, OBRIGACOES_DO_DP, OBRIGACOES_DO_CONTABIL, OBRIGACOES_FORA_DO_FISCAL, departamentoDaObrigacao, tarefaDeOutroDepartamentoParaCancelar } from './catalogo-obrigacoes.js';
import { carregarPrazosMunicipais } from './prazos-municipais-routes.js';
import { decidirReaplicacao } from './reaplicar-prazos.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const COLECOES = ['simples_empresas', 'lucro_empresas'];

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
    const { empresaId, empresaCnpj, empresaNome, regra, competencia, titular, municipio } = params;
    // dedup
    const dup = await db.collection('tarefas')
        .where('empresaId', '==', empresaId)
        .where('obrigacao', '==', regra.obrigacao)
        .where('competencia', '==', competencia)
        .get();
    if (!dup.empty) {
        return { criada: false, jaExistia: true, id: dup.docs[0].id };
    }
    // Sem calendário da cidade NÃO HÁ DATA — e ela não se inventa. A tarefa
    // nasce sem vencimento e o colaborador informa no fluxo (16/08).
    const vencimento = calcularVencimento(competencia, regra);
    const ref = await db.collection('tarefas').add({
        titulo: `${regra.label} ${competencia}`,
        descricao: '',
        empresaId,
        empresaCnpj: empresaCnpj || '',
        empresaNome: empresaNome || '',
        obrigacao: regra.obrigacao,
        competencia,
        vencimento: vencimento ? admin.firestore.Timestamp.fromDate(vencimento) : null,
        /** true = a data é pedida na hora de trabalhar a obrigação. */
        vencimentoAInformar: !vencimento,
        // O MUNICÍPIO VIAJA COM A TAREFA: é ele que o modal precisa para saber
        // de qual cidade é o calendário. Sem isto o botão abriria e a gravação
        // falharia — meia ligação, o defeito que este dia inteiro combateu.
        codMunIBGE: municipio?.codMunIBGE || null,
        municipioNome: municipio?.municipioNome || null,
        uf: municipio?.uf || null,
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
    // Valida a competencia ANTES de inicializar admin/ler colecao: o catalogo
    // lanca em competencia invalida, e sem esta linha o erro estouraria DENTRO
    // do try por empresa — uma falha de entrada viraria centenas de erros de
    // empresa, com zero tarefa criada e nenhuma causa obvia no log.
    const comp = assertCompetencia(competencia || competenciaAtual());
    fa();
    const db = admin.firestore();

    const inicio = new Date();
    const log = {
        competencia: comp,
        iniciadoEm: inicio.toISOString(),
        empresasProcessadas: 0,
        empresasSemCarteira: 0,
        empresasPuladas: 0,
        tarefasCriadas: 0,
        tarefasJaExistiam: 0,
        // Farol honesto: cliente sem regime NAO some do log — ele aparece
        // nomeado, porque o mes dele saiu incompleto de proposito.
        empresasSemRegime: [],
        porRegime: {},
        // Obrigação MUNICIPAL que virou tarefa porque o calendário da cidade
        // está cadastrado. Contada à parte porque é a novidade: antes o ISS
        // nunca virava tarefa em município nenhum.
        tarefasMunicipais: 0,
        erros: [],
    };

    // ── CALENDÁRIOS MUNICIPAIS ──────────────────────────────────────────────
    //
    // 🚨 SEM ISTO, CADASTRAR O CALENDÁRIO NÃO ENTREGAVA NADA. Eu liguei o
    // cadastro à COBERTURA da Rotina (o âmbar) e esqueci de ligá-lo a QUEM CRIA
    // A TAREFA — então, ao cadastrar a cidade, o aviso "o ISS não vira tarefa
    // automática" SUMIA e a tarefa continuava não existindo. Trocar o alerta
    // pelo silêncio é pior que não ter cadastrado: o mês fecharia sem o ISS e
    // sem ninguém avisando.
    let prazosMunicipais = [];
    try {
        prazosMunicipais = await carregarPrazosMunicipais(db);
    } catch (e) {
        // Falha aqui NÃO derruba o mês: sem calendário o ISS volta a ser
        // pendência nomeada na Rotina, que é o estado de antes.
        log.erros.push(`Calendários municipais indisponíveis: ${e.message}`);
    }

    for (const colecao of COLECOES) {
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

                // Regime por CLIENTE, nao pela colecao: lucro_empresas pode ser
                // Presumido ou Real, e sem `regimePadrao` nao se escolhe um.
                const { regime, motivo } = resolverRegime({ colecao, regimePadrao: emp.regimePadrao });
                if (regime === 'INDEFINIDO') {
                    log.empresasSemRegime.push({ empresaId, empresaNome, empresaCnpj, motivo });
                }
                log.porRegime[regime] = (log.porRegime[regime] || 0) + 1;

                // `mesDoCliente` no lugar de `obrigacoesAplicaveis`: é ele que
                // resolve o calendário MUNICIPAL do cliente (e conhece a UF).
                // A lista de federais/estaduais sai idêntica — o que muda é o
                // municipal aparecer quando a cidade tem calendário.
                const mes = mesDoCliente({
                    colecao,
                    regimePadrao: emp.regimePadrao,
                    // 🏦 DeRE: só vira tarefa quando o cadastro afirma o regime
                    // específico; o CNAE vai como SINAL (candidata, não tarefa).
                    regimeEspecificoIbsCbs: emp.dadosFiscais?.regimeEspecificoIbsCbs || '',
                    cnae: emp.cnae || emp.dadosFiscais?.cnae || '',
                    uf: emp.dadosFiscais?.uf || emp.uf || '',
                    codMunIBGE: String(emp.dadosFiscais?.codMunIBGE || emp.codMunIBGE || '').trim(),
                    prazosMunicipais,
                }, comp);
                const regras = mes.obrigacoes;
                for (const regra of regras) {
                    const r = await criarTarefaSeFalta(db, {
                        empresaId, empresaCnpj, empresaNome, regra,
                        competencia: comp, titular,
                        municipio: {
                            codMunIBGE: String(emp.dadosFiscais?.codMunIBGE || emp.codMunIBGE || '').trim(),
                            municipioNome: emp.dadosFiscais?.municipio || emp.municipio || null,
                            uf: emp.dadosFiscais?.uf || emp.uf || null,
                        },
                    });
                    if (r.criada) {
                        log.tarefasCriadas++;
                        if (regra.esfera === 'municipal') log.tarefasMunicipais++;
                    } else if (r.jaExistia) log.tarefasJaExistiam++;
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
 * 📅 Reaplica o prazo ATUAL do catálogo (com os cadastros do admin) nas
 * tarefas ABERTAS e AUTOMÁTICAS de uma competência.
 *
 * 22/09, Paulo, AFFITTARE 08/2026: a regra da DCTFWeb mudou no catálogo e a
 * tarefa continuou com o dia velho — "3 atrasada(s)" sobre prazo que não
 * venceu. A tarefa guarda o vencimento do dia em que nasceu; esta ação a
 * traz para a regra de hoje. Concluída, cancelada e manual NÃO mudam
 * (`decidirReaplicacao`, puro). O que aconteceu com cada uma sai no log.
 *
 * @param {string} competencia "MM/AAAA"
 * @param {object} [opts] { empresaIdEspecifica?: string, quem?: string }
 */
export async function reaplicarPrazosDoCatalogo(competencia, opts = {}) {
    const comp = assertCompetencia(competencia || competenciaAtual());
    fa();
    const db = admin.firestore();
    const inicio = new Date();
    const log = {
        tipo: 'reaplicar-prazos', competencia: comp, quem: opts.quem || null,
        iniciadoEm: inicio.toISOString(),
        tarefasLidas: 0, alteradas: 0, iguais: 0, fechadas: 0, manuais: 0, semRegra: 0, semData: 0,
        empresasSemCadastro: 0,
        // Cada alteração sai NOMEADA: data de prazo não muda em silêncio.
        alteracoes: [],
        erros: [],
    };

    let prazosMunicipais = [];
    try {
        prazosMunicipais = await carregarPrazosMunicipais(db);
    } catch (e) {
        log.erros.push(`Calendários indisponíveis: ${e.message} — o catálogo do código respondeu sozinho.`);
    }

    let q = db.collection('tarefas').where('competencia', '==', comp);
    if (opts.empresaIdEspecifica) q = q.where('empresaId', '==', String(opts.empresaIdEspecifica));
    const snap = await q.get();
    log.tarefasLidas = snap.size;

    // Agrupa por empresa: o mês do cliente é UM cálculo por empresa.
    const porEmpresa = new Map();
    snap.forEach((d) => {
        const t = d.data() || {};
        const id = String(t.empresaId || '');
        if (!porEmpresa.has(id)) porEmpresa.set(id, []);
        porEmpresa.get(id).push({ ref: d.ref, id: d.id, ...t });
    });

    const lote = [];
    for (const [empresaId, tarefas] of porEmpresa) {
        let emp = null; let colecao = null;
        for (const c of COLECOES) {
            const doc = await db.collection(c).doc(empresaId).get();
            if (doc.exists) { emp = doc.data(); colecao = c; break; }
        }
        if (!emp) {
            log.empresasSemCadastro++;
            log.semRegra += tarefas.length;
            continue;
        }
        let regras = [];
        try {
            const mes = mesDoCliente({
                colecao,
                regimePadrao: emp.regimePadrao,
                regimeEspecificoIbsCbs: emp.dadosFiscais?.regimeEspecificoIbsCbs || '',
                cnae: emp.cnae || emp.dadosFiscais?.cnae || '',
                uf: emp.dadosFiscais?.uf || emp.uf || '',
                codMunIBGE: String(emp.dadosFiscais?.codMunIBGE || emp.codMunIBGE || '').trim(),
                prazosMunicipais,
            }, comp);
            regras = mes.obrigacoes || [];
        } catch (e) {
            log.erros.push(`Empresa ${empresaId}: ${e.message}`);
            continue;
        }
        for (const t of tarefas) {
            const regra = regras.find((r) => r.obrigacao === t.obrigacao) || null;
            const d = decidirReaplicacao({ tarefa: t, regra });
            if (d.acao === 'alterar') {
                lote.push({ ref: t.ref, para: regra.vencimento });
                log.alteradas++;
                log.alteracoes.push({
                    tarefaId: t.id, empresaId, empresaNome: t.empresaNome || emp.razaoSocial || emp.nome || '',
                    obrigacao: t.obrigacao, de: d.de || null, para: d.para,
                });
            } else if (d.acao === 'igual') log.iguais++;
            else if (d.acao === 'fechada') log.fechadas++;
            else if (d.acao === 'manual') log.manuais++;
            else if (d.acao === 'sem-data') log.semData++;
            else log.semRegra++;
        }
    }

    // Lotes de 400 (o batch aceita 500 operações).
    for (let i = 0; i < lote.length; i += 400) {
        const b = db.batch();
        for (const { ref, para } of lote.slice(i, i + 400)) {
            b.update(ref, {
                vencimento: admin.firestore.Timestamp.fromDate(para),
                vencimentoAInformar: false,
                vencimentoReaplicadoEm: new Date().toISOString(),
                vencimentoReaplicadoPorEmail: opts.quem || null,
                vencimentoReaplicadoDe: 'catalogo',
            });
        }
        await b.commit();
    }

    const fim = new Date();
    log.finalizadoEm = fim.toISOString();
    log.duracaoMs = fim.getTime() - inicio.getTime();
    try {
        await db.collection('tarefas_cron_logs').add({ ...log, criadoEm: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
        console.warn('[tarefas/reaplicar-prazos] falha ao gravar log:', e.message);
    }
    return log;
}

/**
 * 👥 CANCELA em lote as tarefas ABERTAS e AUTOMÁTICAS de FGTS/INSS patronal
 * (Paulo, 22/09: "pode tirar, INSS, FGTS, CPP é do DP"). O cron parou de
 * gerar; as já geradas ficavam cobrando o Fiscal por trabalho do DP. Manual,
 * concluída e cancelada não se tocam. Sem competência = todas.
 *
 * @param {object} opts  { competencia?: 'MM/AAAA', empresaIdEspecifica?, quem? }
 */
export async function cancelarTarefasDeOutroDepartamento(opts = {}) {
    fa();
    // 🏢 25/09: DP (FGTS/INSS) e Contábil (ECD/ECF). Sem `departamento` = os dois.
    const dep = String(opts.departamento || '').toUpperCase();
    const obrigacoesAlvo = dep === 'DP' ? [...OBRIGACOES_DO_DP]
        : (dep === 'CONTABIL' || dep === 'CONTÁBIL') ? [...OBRIGACOES_DO_CONTABIL]
            : [...OBRIGACOES_FORA_DO_FISCAL];
    const db = admin.firestore();
    const inicio = new Date();
    const comp = opts.competencia ? assertCompetencia(opts.competencia) : null;
    const log = {
        tipo: 'cancelar-tarefas-outro-departamento', competencia: comp, quem: opts.quem || null,
        departamento: dep || 'DP+CONTABIL',
        obrigacoes: obrigacoesAlvo,
        iniciadoEm: inicio.toISOString(),
        tarefasLidas: 0, canceladas: 0, jaFechadas: 0, manuais: 0,
        canceladasPorCompetencia: {},
        exemplos: [],
        erros: [],
    };
    const lote = [];
    for (const obrigacao of obrigacoesAlvo) {
        let q = db.collection('tarefas').where('obrigacao', '==', obrigacao);
        if (comp) q = q.where('competencia', '==', comp);
        if (opts.empresaIdEspecifica) q = q.where('empresaId', '==', String(opts.empresaIdEspecifica));
        const snap = await q.get();
        log.tarefasLidas += snap.size;
        snap.forEach((d) => {
            const t = { id: d.id, ...(d.data() || {}) };
            if (t.status === 'concluida' || t.status === 'cancelada') { log.jaFechadas++; return; }
            if (!tarefaDeOutroDepartamentoParaCancelar(t)) { log.manuais++; return; }
            lote.push({ ref: d.ref, obrigacao });
            log.canceladas++;
            const c = String(t.competencia || '?');
            log.canceladasPorCompetencia[c] = (log.canceladasPorCompetencia[c] || 0) + 1;
            if (log.exemplos.length < 8) log.exemplos.push(`${obrigacao} ${c} · ${t.empresaNome || t.empresaId || ''}`);
        });
    }
    const motivoDe = (obrigacao) => (departamentoDaObrigacao(obrigacao) === 'Contábil'
        ? 'Obrigação do Contábil (ECD/ECF) — saiu do catálogo do CFI em 25/09; cancelada em lote pelo admin.'
        : 'Obrigação do DP (FGTS/INSS patronal) — saiu do catálogo do CFI em 22/09; cancelada em lote pelo admin.');
    for (let i = 0; i < lote.length; i += 400) {
        const b = db.batch();
        for (const { ref, obrigacao } of lote.slice(i, i + 400)) {
            b.update(ref, {
                status: 'cancelada',
                canceladaEm: admin.firestore.FieldValue.serverTimestamp(),
                canceladaPorEmail: opts.quem || null,
                cancelamentoMotivo: motivoDe(obrigacao),
            });
        }
        await b.commit();
    }
    const fim = new Date();
    log.finalizadoEm = fim.toISOString();
    log.duracaoMs = fim.getTime() - inicio.getTime();
    try {
        await db.collection('tarefas_cron_logs').add({ ...log, criadoEm: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
        console.warn('[tarefas/cancelar-dp] falha ao gravar log:', e.message);
    }
    return log;
}

/** Nome de 22/09, mantido: cancela SÓ as do DP. */
export function cancelarTarefasDoDp(opts = {}) {
    return cancelarTarefasDeOutroDepartamento({ ...opts, departamento: 'DP' });
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
