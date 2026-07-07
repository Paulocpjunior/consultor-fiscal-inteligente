// ============================================================================
// sefaz-backend/dctfweb-orchestrator.js
// Sincroniza declaracoes DCTFWeb entre provider e Firestore.
// ============================================================================

import admin from 'firebase-admin';
import {
    getDctfwebProvider, getDctfwebMode,
    pickDadosApuracaoMit, contarDebitosMit, pickIdApuracao, mitPeriodoLabel,
} from './dctfweb-provider.js';
import { normalizarRetencaoDctfweb } from './dctfweb-retencao-normalizer.js';
import { extrairModeloDebitosMit, montarDebitosMit } from './mit-debitos-builder.js';
import { assertEmissaoLiberada } from './emissao-guard.js';
import { fetchAllDocs } from './firestore-paginate.js';

const COLLECTION = 'dctfweb_declaracoes';
const COLLECTION_MIT = 'dctfweb_mit_apuracoes';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function sanitize(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (v !== undefined) out[k] = v;
    }
    return out;
}

function paPenultima() {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return { anoPA: d.getFullYear(), mesPA: d.getMonth() + 1 };
}

export async function sincronizarEmpresa(empresaId, empresaCnpj, opts = {}) {
    const db = fa().firestore();
    const provider = getDctfwebProvider();
    const mode = getDctfwebMode();
    const { anoPA, mesPA } = (opts.anoPA && opts.mesPA) ? opts : paPenultima();

    const declaracoes = await provider.listarDeclaracoes(empresaCnpj, { anoPA, mesPA, categoria: opts.categoria });

    const batch = db.batch();
    let novas = 0, atualizadas = 0;

    for (const decl of declaracoes) {
        const docId = decl.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ref = db.collection(COLLECTION).doc(docId);
        const payload = sanitize({
            empresaId,
            empresaCnpj,
            categoria: decl.categoria,
            categoriaCodigo: decl.categoriaCodigo,
            anoPA: decl.anoPA,
            mesPA: decl.mesPA,
            situacao: decl.situacao,
            valorTotal: decl.valorTotal,
            inssRetido: decl.inssRetido,
            cprbDevido: decl.cprbDevido,
            dataVencimento: decl.dataVencimento,
            numeroRecibo: decl.numeroRecibo,
            transmitidoEm: decl.transmitidoEm,
            fonte: decl.fonte || mode,
            ultimaSincronizacao: new Date().toISOString(),
            _erro: decl._erro || null,
        });

        const existing = await ref.get();
        if (existing.exists) atualizadas++; else novas++;
        batch.set(ref, payload, { merge: true });
    }
    await batch.commit();

    return { mode, total: declaracoes.length, novas, atualizadas, anoPA, mesPA };
}

export async function sincronizarTodasLucro() {
    const db = fa().firestore();
    const snap = await db.collection('lucro_empresas').get();
    // 23/05: filtra perdedores do merge de duplicatas
    const ativos = snap.docs.filter(d => !d.data()._merged_into);
    const stats = { totalEmpresas: ativos.length, sucesso: 0, falha: 0, detalhes: [] };
    for (const d of ativos) {
        const emp = d.data();
        if (!emp.cnpj) continue;
        try {
            const r = await sincronizarEmpresa(d.id, emp.cnpj);
            stats.sucesso++;
            stats.detalhes.push({ empresa: emp.nome, ...r });
        } catch (err) {
            stats.falha++;
            console.warn(`[dctfweb] ${emp.nome}: ${err.message}`);
        }
    }
    return stats;
}

export async function listarDeclaracoes({ empresaCnpj, situacao, anoPA, mesPA } = {}) {
    const db = fa().firestore();
    let q = db.collection(COLLECTION);
    if (empresaCnpj) q = q.where('empresaCnpj', '==', empresaCnpj);
    if (situacao) q = q.where('situacao', '==', situacao);
    if (anoPA) q = q.where('anoPA', '==', anoPA);
    if (mesPA) q = q.where('mesPA', '==', mesPA);
    const docs = await fetchAllDocs(q, { label: 'dctfweb_declaracoes/listar' });
    return docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.anoPA - a.anoPA) || (b.mesPA - a.mesPA));
}

export async function transmitirDeclaracao({ empresaId, empresaCnpj, anoPA, mesPA, categoria }) {
    assertEmissaoLiberada('DCTFWEB');
    const db = fa().firestore();
    const provider = getDctfwebProvider();
    const r = await provider.transmitirDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });

    const docId = `${empresaCnpj}_${anoPA}${String(mesPA).padStart(2,'0')}_${categoria || 'GERAL_MENSAL'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    await db.collection(COLLECTION).doc(docId).set(sanitize({
        empresaId, empresaCnpj, categoria: categoria || 'GERAL_MENSAL',
        anoPA, mesPA,
        situacao: 'ATIVA',
        numeroRecibo: r.numeroRecibo,
        transmitidoEm: r.transmitidoEm,
        fonte: r.fonte,
        ultimaSincronizacao: new Date().toISOString(),
    }), { merge: true });

    return { ok: true, ...r };
}

export async function gerarDarf({ empresaId, empresaCnpj, anoPA, mesPA, categoria, emAndamento }) {
    assertEmissaoLiberada('DCTFWEB');
    const provider = getDctfwebProvider();
    return await provider.gerarDarf({ empresaCnpj, anoPA, mesPA, categoria, emAndamento });
}

export async function consultarDeclaracaoCompleta({ empresaCnpj, anoPA, mesPA, categoria }) {
    const provider = getDctfwebProvider();
    return await provider.consultarDeclaracaoCompleta({ empresaCnpj, anoPA, mesPA, categoria });
}

export async function consultarRecibo({ empresaCnpj, anoPA, mesPA, categoria }) {
    const provider = getDctfwebProvider();
    return await provider.consultarRecibo({ empresaCnpj, anoPA, mesPA, categoria });
}

export async function encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit }) {
    assertEmissaoLiberada('DCTFWEB');
    const db = fa().firestore();
    const provider = getDctfwebProvider();
    const r = await provider.encerrarApuracaoMit({ empresaCnpj, anoPA, mesPA, dadosApuracaoMit });

    const docId = `${empresaCnpj}_${anoPA}${String(mesPA).padStart(2,'0')}_MIT`.replace(/[^a-zA-Z0-9_-]/g, '_');
    await db.collection(COLLECTION_MIT).doc(docId).set(sanitize({
        empresaId, empresaCnpj, anoPA, mesPA,
        statusEncerramento: r.statusEncerramento,
        protocolo: r.protocolo,
        idApuracao: r.idApuracao,
        encerradoEm: new Date().toISOString(),
        fonte: r.fonte,
    }), { merge: true });

    return { ok: true, ...r };
}

export async function consultarStatusEncerramentoMit({ empresaCnpj, protocolo, anoPA, mesPA }) {
    const provider = getDctfwebProvider();
    return await provider.consultarStatusEncerramentoMit({ empresaCnpj, protocolo, anoPA, mesPA });
}

// ── Preenchimento automático de débitos do MIT com a apuração do app ───────
//
// Duas fases (mesma função):
//   transmitir=false → monta e devolve a PROPOSTA (mapeamento família/código/
//                      valor + período-modelo) sem tocar o SERPRO além das
//                      consultas. É o que a UI mostra na tela de conferência.
//   transmitir=true  → monta de novo (nada é confiado do cliente além dos
//                      tributosApp exibidos) e transmite o ENCAPURACAO314 via
//                      encerrarApuracaoMit (que valida payload, exige emissão
//                      liberada e persiste em dctfweb_mit_apuracoes). Grava
//                      log de auditoria com valores e quem transmitiu.
//
// Códigos de débito NUNCA são chutados: vêm da última apuração ENCERRADA da
// própria empresa no MIT (mesma qualificação/regime). Sem modelo pra uma
// família com valor, falha com orientação.
export async function preencherEncerrarMit({
    empresaId, empresaCnpj, anoPA, mesPA, tributosApp, transmitir = false, usuario = null,
}) {
    const provider = getDctfwebProvider();
    if (typeof provider.consultarApuracaoMitPorId !== 'function') {
        return { ok: false, motivo: 'Preenchimento automático do MIT disponível apenas no modo serpro.' };
    }

    // Sanitiza tributos (só números >= 0 das 4 famílias)
    const tributos = {};
    for (const fam of ['IRPJ', 'CSLL', 'PIS', 'COFINS']) {
        const v = Number(tributosApp?.[fam]);
        tributos[fam] = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
    }
    const paAlvo = `${anoPA}${String(mesPA).padStart(2, '0')}`;

    // 1. Apuração-ALVO: precisa existir no MIT (criada no e-CAC), com
    //    DadosIniciais, com movimento e SEM débitos já lançados.
    const alvo = await provider.consultarApuracaoMit({ empresaCnpj, anoPA, mesPA });
    if (!alvo?.apuracaoMit) {
        return { ok: false, etapa: 'alvo', motivo: alvo?.motivo || `Apuração MIT de ${paAlvo} não encontrada.` };
    }
    const alvoPayload = pickDadosApuracaoMit(alvo.apuracaoMit);
    const dadosIniciais = alvoPayload?.DadosIniciais || alvoPayload?.dadosIniciais;
    if (!alvoPayload || !dadosIniciais) {
        return { ok: false, etapa: 'alvo', motivo: `Apuração MIT de ${paAlvo} encontrada, mas sem DadosIniciais no retorno do SERPRO.` };
    }
    const semMovimento = dadosIniciais.SemMovimento ?? dadosIniciais.semMovimento;
    if (semMovimento === true || semMovimento === 'true') {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} está marcada como Sem Movimento — não cabe preencher débitos. Encerre-a normalmente.`,
        };
    }
    const debitosJaLancados = contarDebitosMit(alvoPayload.Debitos || alvoPayload.debitos);
    if (debitosJaLancados > 0) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} já tem ${debitosJaLancados} débito(s) lançado(s). `
                + 'Revise no e-CAC ou encerre normalmente — o preenchimento automático só cobre apuração vazia.',
        };
    }

    // 2. Apuração-MODELO: última apuração anterior da empresa com débitos.
    //    Tenta o ano corrente; se não houver anterior no ano, tenta o anterior.
    const candidatos = [];
    for (const ano of [Number(anoPA), Number(anoPA) - 1]) {
        try {
            const hist = await provider.consultarApuracoesAno({ empresaCnpj, anoPA: ano });
            for (const item of hist?.apuracoes || []) {
                const periodo = mitPeriodoLabel(item);
                const id = pickIdApuracao(item);
                if (!periodo || id == null || id === '') continue;
                if (periodo >= paAlvo) continue; // só meses ANTERIORES ao alvo
                candidatos.push({ periodo, id });
            }
        } catch (e) {
            console.warn(`[preencherEncerrarMit] histórico ${ano} indisponível:`, e.message);
        }
        if (candidatos.length > 0) break;
    }
    candidatos.sort((a, b) => b.periodo.localeCompare(a.periodo)); // mais recente primeiro

    let modelo = null;
    let modeloPeriodo = null;
    const famComValor = Object.entries(tributos).filter(([, v]) => v > 0).map(([f]) => f);
    for (const cand of candidatos.slice(0, 4)) {
        try {
            const det = await provider.consultarApuracaoMitPorId({ empresaCnpj, idApuracao: cand.id });
            const m = extrairModeloDebitosMit(det?.apuracaoMit);
            if (m.totalDebitos === 0) continue;
            modelo = m;
            modeloPeriodo = cand.periodo;
            // Modelo ideal cobre todas as famílias com valor; senão tenta o próximo.
            if (famComValor.every((f) => m.codigoPorFamilia[f])) break;
        } catch (e) {
            console.warn(`[preencherEncerrarMit] detalhe modelo ${cand.periodo} falhou:`, e.message);
        }
    }
    if (!modelo) {
        return {
            ok: false, etapa: 'modelo',
            motivo: 'Nenhuma apuração anterior desta empresa com débitos foi encontrada no MIT para servir '
                + 'de modelo de códigos de débito. Lance os débitos manualmente no e-CAC neste primeiro mês; '
                + 'a partir do próximo, o preenchimento automático usa esse mês como modelo.',
        };
    }

    // 3. Monta os débitos (códigos do modelo × valores do app)
    const montagem = montarDebitosMit(tributos, modelo);
    const proposta = {
        pa: paAlvo,
        tributosApp: tributos,
        mapeamento: montagem.mapeamento,
        totalProposto: montagem.totalProposto,
        modeloPeriodo,
        alvoIdApuracao: alvo.idApuracao ?? null,
    };
    if (!montagem.ok) {
        return { ok: false, etapa: 'montagem', motivo: montagem.erros.join(' '), proposta };
    }

    if (!transmitir) {
        return { ok: true, transmitido: false, proposta };
    }

    // 4. Transmite o encerramento com o payload alvo + débitos montados.
    //    encerrarApuracaoMit (acima) valida o payload de novo, exige emissão
    //    liberada e persiste o protocolo em dctfweb_mit_apuracoes.
    const payload = {
        ...alvoPayload,
        PeriodoApuracao: alvoPayload.PeriodoApuracao || { MesApuracao: Number(mesPA), AnoApuracao: Number(anoPA) },
        Debitos: montagem.debitos,
    };
    const r = await encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit: payload });

    // Auditoria: quem transmitiu, quais valores, de onde vieram os códigos.
    try {
        const db = fa().firestore();
        await db.collection('dctfweb_mit_preenchimentos').add(sanitize({
            empresaId: empresaId || null,
            empresaCnpj,
            pa: paAlvo,
            tributosApp: tributos,
            mapeamento: montagem.mapeamento,
            totalProposto: montagem.totalProposto,
            modeloPeriodo,
            protocolo: r.protocolo || null,
            statusEncerramento: r.statusEncerramento || null,
            transmitidoPor: usuario?.email || usuario?.uid || null,
            transmitidoEm: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('[preencherEncerrarMit] falha gravando auditoria:', e.message);
    }

    return { ok: true, transmitido: true, proposta, protocolo: r.protocolo, statusEncerramento: r.statusEncerramento };
}

export async function consultarApuracaoMit({ empresaCnpj, anoPA, mesPA }) {
    const provider = getDctfwebProvider();
    return await provider.consultarApuracaoMit({ empresaCnpj, anoPA, mesPA });
}

export async function consultarApuracoesAno({ empresaCnpj, anoPA }) {
    const provider = getDctfwebProvider();
    return await provider.consultarApuracoesAno({ empresaCnpj, anoPA });
}

// Consulta a declaracao DCTFWeb (XML) e NORMALIZA a retencao consolidada pra
// cruzar contra a EFD-Reinf. Devolve { lido, motivo, retencoes, ... } — honesto
// quando nao consegue ler (NUNCA zeros falsos).
export async function consultarRetencaoDctfwebNormalizada({ empresaCnpj, anoPA, mesPA, categoria }) {
    const provider = getDctfwebProvider();
    const consulta = await provider.consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });
    const norm = normalizarRetencaoDctfweb(consulta?.xml || consulta?._raw || '');
    return { competencia: `${anoPA}-${String(mesPA).padStart(2, '0')}`, fonte: consulta?.fonte, ...norm };
}

export async function getResumoGlobal() {
    const db = fa().firestore();
    const docs = (await fetchAllDocs(db.collection(COLLECTION), { label: 'dctfweb_declaracoes/resumo' })).map(d => d.data());
    const pendentes = docs.filter(d => d.situacao === 'EM_ANDAMENTO');
    const transmitidas = docs.filter(d => d.situacao === 'ATIVA');
    return {
        totalDeclaracoes: docs.length,
        pendentes: pendentes.length,
        transmitidas: transmitidas.length,
        empresasComPendente: new Set(pendentes.map(d => d.empresaCnpj)).size,
        mode: getDctfwebMode(),
    };
}
