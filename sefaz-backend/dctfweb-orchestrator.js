// ============================================================================
// sefaz-backend/dctfweb-orchestrator.js
// Sincroniza declaracoes DCTFWeb entre provider e Firestore.
// ============================================================================

import admin from 'firebase-admin';
import {
    getDctfwebProvider, getDctfwebMode,
    pickDadosApuracaoMit, contarDebitosMit, pickIdApuracao, mitPeriodoLabel,
} from './dctfweb-provider.js';
import { normalizarRetencaoDctfweb, extrairDebitosDctfweb } from './dctfweb-retencao-normalizer.js';
import { getDarfProvider } from './darf-provider.js';
import { calcularUltimoDiaUtil } from './calendario-obrigacoes.js';
import { trimestreVencendoEsteMes, calcularVencimentoDarf } from './darf-payload-builder.js';
import { normalizarApuracaoMit } from './dctfweb-mit-normalizer.js';
import {
    extrairModeloDebitosMit, montarDebitosMit, mesclarDebitosMit, maiorIdDebitoMit, FAMILIAS,
    montarDebitosRetificacaoMit,
} from './mit-debitos-builder.js';
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
            // Estado informativo (não-erro): ex. "aguardando transmissão" pós-MIT
            _info: decl._info || null,
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
    const ativos = snap.docs.filter(d => !d.data()._merged_into && !d.data()._deleted);
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

// ── Guias separadas por vencimento (DARF avulso via Integra SICALC) ────────
//
// O GERARGUIA31 da DCTFWeb emite UMA guia unificada com "pagar até" = menor
// vencimento entre os débitos (caso real 08/07/2026: PIS/COFINS 24/07 +
// IRPJ/CSLL trimestrais 31/07 na mesma guia). A API da DCTFWeb NÃO permite
// escolher débitos (só filtra por sistema de origem — e aqui todos vêm do
// MIT). Para pagar cada tributo no SEU vencimento, emitimos 1 DARF avulso
// por débito via SICALC (CONSOLIDARGERARDARF51), com código/extensão lidos
// da PRÓPRIA declaração transmitida.
//
// Receitas que sabemos emitir avulso com o vencimento correto. Débitos fora
// da lista (ex.: INSS/eSocial — só sai em DARF numerado) NÃO são emitidos e
// voltam em `naoEmitidos` com orientação de usar o DARF unificado.
const RECEITAS_GUIA_SEPARADA = new Set([
    '2089', '0220', '2372', '6012',           // IRPJ/CSLL trimestrais
    '2362', '2484',                           // IRPJ/CSLL estimativa mensal
    '8109', '2172', '6912', '5856',           // PIS/COFINS
    // IPI mensal — vence dia 25 do mês seguinte (Lei 11.933/2009), igual
    // PIS/COFINS (caso Experte 06/2026: 5123 sumia das guias). FICAM FORA:
    // 5110 (cigarros, vence dia 10 — regra própria) e 0676 (IPI-importação,
    // pago no desembaraço) — esses seguem no DARF unificado.
    '5123', '0668', '1097',                   // IPI demais produtos/bebidas/automóveis
]);
const RECEITAS_TRIMESTRAIS_QUOTA = new Set(['2089', '0220', '2372', '6012']);
const DARF_VALOR_MINIMO = 10;       // R$ — DARF inferior a R$10 não pode ser emitido (RFB)
// Quotas do IRPJ/CSLL trimestral (Lei 9.430 art. 5º): até 3 quotas mensais,
// nenhuma inferior a R$ 1.000 — logo só para débito acima de R$ 2.000.
const QUOTA_VALOR_MINIMO = 1000;

// Divide o débito em N quotas "iguais" em centavos — a 1ª quota absorve a
// diferença de arredondamento (prática RFB).
function dividirEmQuotas(valor, n) {
    const totalCent = Math.round(valor * 100);
    const base = Math.floor(totalCent / n);
    const primeira = totalCent - base * (n - 1);
    return Array.from({ length: n }, (_, i) => (i === 0 ? primeira : base) / 100);
}

// Vencimento da quota i (1..3) de um trimestre: último dia útil do i-ésimo
// mês após o fim do trimestre (quota 1 = vencimento normal do tributo).
function vencimentoQuotaTrimestral(anoPA, mesPA, cota) {
    const trimestre = Math.floor((Number(mesPA) - 1) / 3) + 1;
    let mes = trimestre * 3 + Number(cota);
    let ano = Number(anoPA);
    while (mes > 12) { mes -= 12; ano += 1; }
    return calcularUltimoDiaUtil(ano, mes);
}

export async function gerarDarfsSeparados({
    empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL',
    // 1 (quota única, default), 2 ou 3 — aplica-se só aos débitos TRIMESTRAIS
    // (IRPJ/CSLL); mensais (PIS/COFINS) não têm quota.
    quotasTrimestrais = 1,
    // Escopo opcional: só emite os débitos cujo código esteja nesta lista
    // (ex.: painel "Trimestrais do mês" passa ['2089','0220','2372','6012']
    // para NÃO emitir PIS/COFINS junto). Vazio/ausente = emite todos.
    apenasCodigos = null,
} = {}) {
    assertEmissaoLiberada('DCTFWEB');
    const provider = getDctfwebProvider();
    const consulta = await provider.consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });
    const ext = extrairDebitosDctfweb(consulta?.xml || consulta?._raw || '');
    if (!ext.lido) {
        throw new Error(`Guias separadas: não consegui ler a declaração ${anoPA}-${String(mesPA).padStart(2, '0')}. ${ext.motivo}`);
    }
    if (ext.debitos.length === 0) {
        throw new Error('Guias separadas: a declaração transmitida não tem débitos com saldo a pagar.');
    }

    const escopo = Array.isArray(apenasCodigos) && apenasCodigos.length
        ? new Set(apenasCodigos.map(String))
        : null;
    // Escopo é filtro de EMISSÃO (não cobra fora do escopo); débitos fora dele
    // nem entram em naoEmitidos para não poluir — foram deliberadamente omitidos.
    const debitosAlvo = escopo ? ext.debitos.filter((d) => escopo.has(d.codigo)) : ext.debitos;
    if (debitosAlvo.length === 0) {
        throw new Error('Guias separadas: nenhum débito no escopo solicitado (ex.: sem IRPJ/CSLL trimestral nesta declaração).');
    }

    const competencia = `${anoPA}-${String(mesPA).padStart(2, '0')}`;
    const darfProvider = getDarfProvider();
    const guias = [];
    const naoEmitidos = [];
    const nQuotas = Math.min(3, Math.max(1, Number(quotasTrimestrais) || 1));

    for (const deb of debitosAlvo) {
        if (!RECEITAS_GUIA_SEPARADA.has(deb.codigo)) {
            naoEmitidos.push({ ...deb, motivo: 'Receita fora da emissão avulsa (ex.: previdenciária) — pague pelo DARF unificado do Painel DCTFWeb.' });
            continue;
        }
        if (deb.valor < DARF_VALOR_MINIMO) {
            naoEmitidos.push({ ...deb, motivo: `DARF inferior a R$ ${DARF_VALOR_MINIMO},00 não pode ser emitido (RFB) — acumule com o período seguinte ou use o DARF unificado.` });
            continue;
        }

        // Quotas só para trimestrais e quando o valor comporta (Lei 9.430:
        // nenhuma quota < R$ 1.000). Se não comportar, cai pra quota única
        // com aviso — nunca falha silenciosamente.
        let quotasDoDebito = 1;
        let avisoQuota = null;
        if (nQuotas > 1 && RECEITAS_TRIMESTRAIS_QUOTA.has(deb.codigo)) {
            if (deb.valor / nQuotas >= QUOTA_VALOR_MINIMO) {
                quotasDoDebito = nQuotas;
            } else {
                avisoQuota = `Valor não comporta ${nQuotas} quotas (mínimo R$ 1.000,00 por quota) — emitido em quota única.`;
            }
        }

        const valores = dividirEmQuotas(deb.valor, quotasDoDebito);
        for (let cota = 1; cota <= quotasDoDebito; cota++) {
            const emQuotas = quotasDoDebito > 1;
            // observacao: o SICALC limita a 50 caracteres (EntradaIncorreta-
            // SICALC "tamanho deve ser entre 0 e 50" — caso real 08/07/2026).
            const r = await darfProvider.gerarDarf({
                empresaCnpj,
                competencia,
                valor: valores[cota - 1],
                codigoReceita: deb.codigo,
                codigoReceitaExtensao: deb.extensao,
                ...(emQuotas ? {
                    cota,
                    // quota i vence no último dia útil do i-ésimo mês após o
                    // trimestre; o SICALC calcula SELIC+1% das quotas 2/3.
                    vencimento: vencimentoQuotaTrimestral(anoPA, mesPA, cota),
                } : {}),
                observacao: `DCTFWeb ${String(mesPA).padStart(2, '0')}/${anoPA} ${deb.descricao}`.slice(0, 50),
            });
            guias.push({
                codigo: deb.codigo,
                extensao: deb.extensao,
                descricao: deb.descricao,
                cota: emQuotas ? cota : null,
                totalCotas: emQuotas ? quotasDoDebito : null,
                aviso: avisoQuota,
                valorPrincipal: valores[cota - 1],
                valor: r.valor,
                multa: r.multa || 0,
                juros: r.juros || 0,
                vencimento: r.vencimento,
                numeroDocumento: r.numeroDocumento || '',
                codigoBarras: r.codigoBarras || '',
                pdfBase64: r.pdfBase64 || '',
                mensagens: r.mensagens || [],
            });
        }
    }

    // Agrupa por vencimento — é assim que a UI apresenta (uma seção por data).
    const grupos = {};
    for (const g of guias) {
        (grupos[g.vencimento] = grupos[g.vencimento] || []).push(g);
    }

    // Resumo por vencimento = o "Valor Total do Documento" que a RFB mostra
    // por data de arrecadação. Como a API não funde os códigos num só DARF,
    // é o total consolidado das guias daquela data (soma com/sem juros).
    const resumoPorVencimento = Object.keys(grupos).sort().map((vencimento) => {
        const doDia = grupos[vencimento];
        const r2 = (n) => Math.round(n * 100) / 100;
        return {
            vencimento,
            quantidade: doDia.length,
            totalPrincipal: r2(doDia.reduce((s, g) => s + (g.valorPrincipal || 0), 0)),
            total: r2(doDia.reduce((s, g) => s + (g.valor || 0), 0)),
            codigos: doDia.map((g) => `${g.codigo}-${g.extensao}`),
        };
    });

    return { competencia, categoria, guias, grupos, resumoPorVencimento, naoEmitidos };
}

// Painel "Trimestrais vencendo este mês": lista as declarações TRANSMITIDAS
// (ATIVA) da competência que fecha o trimestre cujo IRPJ/CSLL vence neste mês.
// NÃO lê o XML de cada uma (sem custo SERPRO) — só aponta as candidatas; os
// débitos trimestrais são carregados sob demanda (listarDebitosTrimestrais).
export async function listarTrimestraisVencendoEsteMes({ cnpjsPermitidos = null, hojeIso } = {}) {
    const hoje = hojeIso || new Date().toISOString().slice(0, 10);
    const info = trimestreVencendoEsteMes(hoje);
    if (!info) {
        return { aplicavel: false, motivo: 'Nenhum trimestre de IRPJ/CSLL vence neste mês (vencem em abril, julho, outubro e janeiro).' };
    }
    const declaracoes = await listarDeclaracoes({
        anoPA: info.competenciaAno,
        mesPA: info.competenciaMes,
        situacao: 'ATIVA',
    });
    const setPermitidos = cnpjsPermitidos instanceof Set ? cnpjsPermitidos : null;
    const candidatas = declaracoes
        .filter((d) => !setPermitidos || setPermitidos.has(String(d.empresaCnpj).replace(/\D/g, '')))
        .map((d) => ({
            empresaId: d.empresaId || null,
            empresaCnpj: d.empresaCnpj,
            categoria: d.categoria || 'GERAL_MENSAL',
            anoPA: d.anoPA,
            mesPA: d.mesPA,
            situacao: d.situacao,
            valorTotalDeclaracao: d.valorTotal ?? null,
        }));
    return {
        aplicavel: true,
        trimestre: info.trimestre,
        competenciaAno: info.competenciaAno,
        competenciaMes: info.competenciaMes,
        vencimento: info.vencimento,
        candidatas,
    };
}

// Carrega (sob demanda, 1 CONSXMLDECLARACAO38) os débitos TRIMESTRAIS de
// IRPJ/CSLL de uma declaração transmitida — para o painel mostrar valor +
// vencimento antes de emitir. Só leitura; não emite nada.
export async function listarDebitosTrimestrais({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
    const provider = getDctfwebProvider();
    const consulta = await provider.consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });
    const ext = extrairDebitosDctfweb(consulta?.xml || consulta?._raw || '');
    if (!ext.lido) {
        return { lido: false, motivo: ext.motivo, trimestrais: [], totalTrimestral: 0, vencimento: null };
    }
    const trimestrais = ext.debitos.filter((d) => RECEITAS_TRIMESTRAIS_QUOTA.has(d.codigo));
    const r2 = (n) => Math.round(n * 100) / 100;
    // Vencimento trimestral = último dia útil do mês seguinte ao fim do
    // trimestre da competência (ex.: comp 06 → 2º tri → 31/07).
    const vencimento = trimestrais.length
        ? calcularVencimentoDarf(`${anoPA}-${String(mesPA).padStart(2, '0')}`, 'IRPJ', 'trimestral')
        : null;
    return {
        lido: true,
        trimestrais,
        totalTrimestral: r2(trimestrais.reduce((s, d) => s + d.valor, 0)),
        vencimento,
    };
}

/**
 * DÉBITOS APURADOS da declaração — a MESMA tabela que o e-CAC mostra.
 *
 * Paulo, 12/08/2026: *"no consultor fiscal não está atualizado igual no e-CAC"*.
 * O detalhe do CFI dizia "Valor do resumo SERPRO: não retornado no resumo" e
 * parava aí, enquanto o e-CAC listava tributo a tributo (0561-07 IRRF 606,71 ·
 * 0588-06 710,88 · 3208-06 18.859,51 · PIS 232,41 …) e o total.
 *
 * A informação NUNCA faltou: o `CONSXMLDECLARACAO38` já era consultado e o
 * `extrairDebitosDctfweb` já lia código de receita, descrição e valor — só que
 * o resultado era FILTRADO pelos trimestrais (IRPJ/CSLL) e o resto era jogado
 * fora. Aqui vai tudo, sem filtro.
 *
 * O total sai da SOMA dos débitos, e a origem é carimbada: é o XML da
 * declaração, não o resumo (que realmente vem sem valor). Somar aqui não é
 * conta nova — é o mesmo número por outro caminho.
 */
export async function listarDebitosDeclaracao({ empresaCnpj, anoPA, mesPA, categoria = 'GERAL_MENSAL' }) {
    const provider = getDctfwebProvider();
    const consulta = await provider.consultarXmlDeclaracao({ empresaCnpj, anoPA, mesPA, categoria });
    const ext = extrairDebitosDctfweb(consulta?.xml || consulta?._raw || '');
    if (!ext.lido) {
        // Farol honesto: XML ilegível ou ausente NÃO vira "declaração sem
        // débito" — zero aqui faria alguém concluir que não há o que pagar.
        return { lido: false, motivo: ext.motivo, debitos: [], total: 0, origem: 'xml-declaracao' };
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
        lido: true,
        motivo: null,
        debitos: ext.debitos,
        total: r2(ext.debitos.reduce((s, d) => s + d.valor, 0)),
        origem: 'xml-declaracao',
    };
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
    // Seleção explícita de quais famílias vão nesta transmissão (pedido do
    // colaborador, 03/08/2026: "ter uma opção para selecionar quais débitos com
    // valores do app eu vou transmitir esse mês"). Caso clássico: Presumido em
    // mês que não fecha trimestre — só PIS/COFINS vão. A lista só RESTRINGE o
    // que já seria enviado (nunca inclui família a mais), então é segura mesmo
    // vindo do cliente; o servidor remonta tudo na transmissão.
    familiasSelecionadas = null,
}) {
    const provider = getDctfwebProvider();
    if (typeof provider.consultarApuracaoMitPorId !== 'function') {
        return { ok: false, motivo: 'Preenchimento automático do MIT disponível apenas no modo serpro.' };
    }

    // Sanitiza tributos (só números >= 0 das familias suportadas). IPI incluido
    // (#198 habilitou IPI no builder/normalizer/cruzamento; faltava aqui — sem
    // isto o auto-fill do MIT omitia silenciosamente o IPI de industria).
    const tributos = {};
    for (const fam of FAMILIAS) {
        const v = Number(tributosApp?.[fam]);
        tributos[fam] = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
    }
    const paAlvo = `${anoPA}${String(mesPA).padStart(2, '0')}`;

    // 1. Apuração-ALVO. Se NÃO existir no MIT, entra o modo CRIAÇÃO: o
    //    ENCAPURACAO314 recebe a apuração completa (DadosIniciais + Debitos),
    //    então criamos e encerramos numa tacada só — os DadosIniciais
    //    (qualificação, tributação, responsável) vêm do mês-modelo da própria
    //    empresa, que é o que o e-CAC reaproveitaria. Elimina a etapa manual
    //    de "criar a apuração no e-CAC" (pedido do usuário, 07/07/2026 —
    //    caso RADIO E TV IBIRAPUERA 06/2026).
    const alvo = await provider.consultarApuracaoMit({ empresaCnpj, anoPA, mesPA });
    const modoCriacao = !alvo?.apuracaoMit;
    let alvoPayload = null;

    if (!modoCriacao) {
        alvoPayload = pickDadosApuracaoMit(alvo.apuracaoMit);
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
        // Apuração já ENCERRADA (situação 3) exige retificação — fluxo diferente,
        // fora do escopo do preenchimento automático. Em processamento (4): aguardar.
        const situacaoAlvo = Number(
            alvo.apuracaoResumo?.situacao ?? alvo.apuracaoResumo?.situacaoApuracao
            ?? alvo.apuracaoMit?.situacaoApuracao ?? alvo.apuracaoMit?.situacao ?? NaN
        );
        if (situacaoAlvo === 3) {
            return {
                ok: false, etapa: 'alvo',
                motivo: `A apuração MIT de ${paAlvo} já está ENCERRADA. Para alterar débitos, retifique a apuração no e-CAC (MIT) e depois use este fluxo.`,
            };
        }
        if (situacaoAlvo === 4) {
            return {
                ok: false, etapa: 'alvo',
                motivo: `A apuração MIT de ${paAlvo} está com encerramento em processamento no SERPRO — aguarde e atualize.`,
            };
        }
    }

    // Débitos já lançados NÃO bloqueiam: viram modo COMPLEMENTO — as famílias
    // já declaradas são preservadas intactas e só as FALTANTES (com valor no
    // app) são adicionadas. Caso real PEC PRONTA 06/2026: MIT com PIS/COFINS
    // lançados e IRPJ/CSLL "Apurado, não declarado".
    const debitosExistentes = modoCriacao ? null : (alvoPayload.Debitos || alvoPayload.debitos || null);
    const debitosJaLancados = contarDebitosMit(debitosExistentes);
    const normAlvo = modoCriacao ? null : normalizarApuracaoMit(alvo.apuracaoMit);
    const familiasDeclaradas = FAMILIAS
        .filter((f) => (normAlvo?.lido && normAlvo.tributos[f] > 0));
    if (debitosJaLancados > 0 && !normAlvo?.lido) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} tem ${debitosJaLancados} débito(s) num formato que não consegui classificar por tributo — `
                + 'complemente manualmente no e-CAC para não arriscar duplicar débito.',
        };
    }
    let familiasFaltantes = FAMILIAS
        .filter((f) => tributos[f] > 0 && !familiasDeclaradas.includes(f));

    // Filtro da seleção do usuário — só restringe (intersecção). Se o que sobrou
    // for vazio, para com o motivo em vez de transmitir uma apuração vazia.
    const selecao = Array.isArray(familiasSelecionadas)
        ? FAMILIAS.filter((f) => familiasSelecionadas.includes(f))
        : null;
    const familiasDesmarcadas = selecao
        ? familiasFaltantes.filter((f) => !selecao.includes(f))
        : [];
    if (selecao) {
        if (familiasFaltantes.length > 0 && selecao.length === 0) {
            return {
                ok: false, etapa: 'selecao',
                motivo: 'Nenhum tributo selecionado para transmitir. Marque ao menos um débito na proposta.',
            };
        }
        familiasFaltantes = familiasFaltantes.filter((f) => selecao.includes(f));
        if (familiasFaltantes.length === 0) {
            return {
                ok: false, etapa: 'selecao',
                motivo: 'Os tributos selecionados já estão lançados no MIT desta competência — nada a adicionar.',
            };
        }
    }

    if (familiasFaltantes.length === 0) {
        return {
            ok: false, etapa: 'alvo',
            motivo: debitosJaLancados > 0
                ? `Todas as famílias com valor apurado no app já têm débito lançado no MIT de ${paAlvo}. `
                + 'Se os VALORES divergirem, ajuste no e-CAC — este fluxo não altera débito existente. Senão, encerre normalmente.'
                : 'Nenhum tributo com valor > 0 na apuração do app — nada a declarar.',
        };
    }
    const modoComplemento = !modoCriacao && debitosJaLancados > 0;

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
    let modeloDadosIniciais = null;
    // Bloco Ipi cru do mês-modelo — diagnóstico do IPI (Experte 06/2026): o SERPRO
    // recusa o CnpjEstabelecimento que enviamos ("valor inválido"). Precisamos ver
    // de onde o mês-modelo tira o estabelecimento do IPI (item de débito? nível de
    // estabelecimento? DadosIniciais?) pra mandar o valor exato que ele aceita.
    let modeloIpiRaw = null;
    let modeloDebitosNumeracao = null;
    for (const cand of candidatos.slice(0, 4)) {
        try {
            const det = await provider.consultarApuracaoMitPorId({ empresaCnpj, idApuracao: cand.id });
            const m = extrairModeloDebitosMit(det?.apuracaoMit);
            if (m.totalDebitos === 0) continue;
            modelo = m;
            modeloPeriodo = cand.periodo;
            // No modo criação, os DadosIniciais do mês-modelo viram a base da
            // nova apuração (qualificação/tributação/responsável são estáveis
            // mês a mês; campos condicionais que o encerramento recusar são
            // removidos automaticamente pelo retry do provider).
            const payloadModelo = pickDadosApuracaoMit(det?.apuracaoMit);
            modeloDadosIniciais = payloadModelo?.DadosIniciais || payloadModelo?.dadosIniciais || null;
            const debitosModelo = payloadModelo?.Debitos || payloadModelo?.debitos || null;
            modeloIpiRaw = debitosModelo?.Ipi || debitosModelo?.ipi || debitosModelo?.IPI || null;
            // Numeração/ordem de TODOS os débitos do modelo (IdDebito por grupo) —
            // referência da sequência que o SERPRO aceita.
            modeloDebitosNumeracao = debitosModelo ? Object.fromEntries(
                Object.entries(debitosModelo).map(([g, b]) => [
                    g, (b?.ListaDebitos || b?.listaDebitos || []).map((d) => ({ IdDebito: d?.IdDebito ?? d?.idDebito, CodigoDebito: d?.CodigoDebito ?? d?.codigoDebito })),
                ]),
            ) : null;
            // Modelo ideal cobre todas as famílias FALTANTES; senão tenta o próximo.
            if (familiasFaltantes.every((f) => m.codigoPorFamilia[f])) break;
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
    if (modoCriacao) {
        if (!modeloDadosIniciais) {
            return {
                ok: false, etapa: 'modelo',
                motivo: `A apuração de ${paAlvo} não existe no MIT e o mês-modelo (${modeloPeriodo}) não trouxe DadosIniciais completos `
                    + 'para criá-la automaticamente. Crie a apuração no e-CAC (DCTFWeb → MIT) e clique em "Atualizar".',
            };
        }
        alvoPayload = {
            PeriodoApuracao: { MesApuracao: Number(mesPA), AnoApuracao: Number(anoPA) },
            DadosIniciais: JSON.parse(JSON.stringify(modeloDadosIniciais)),
        };
    }

    // 3. Monta APENAS os débitos das famílias faltantes (códigos do modelo ×
    //    valores do app). Em modo complemento, a numeração de IdDebito continua
    //    a partir dos débitos já lançados.
    const montagem = montarDebitosMit(tributos, modelo, {
        apenasFamilias: familiasFaltantes,
        idInicial: maiorIdDebitoMit(debitosExistentes) + 1,
        // IPI exige CnpjEstabelecimento por débito; fallback no CNPJ da empresa
        // quando o mês-modelo não trouxe.
        empresaCnpj,
    });
    const di = alvoPayload.DadosIniciais || {};
    const proposta = {
        pa: paAlvo,
        modo: modoCriacao ? 'criacao' : (modoComplemento ? 'complemento' : 'completo'),
        tributosApp: tributos,
        mapeamento: montagem.mapeamento,
        totalProposto: montagem.totalProposto,
        jaDeclarados: familiasDeclaradas.map((f) => ({ familia: f, valor: normAlvo.tributos[f] })),
        // Farol honesto: o que o usuário DESMARCOU fica visível na proposta e na
        // auditoria — transmissão parcial nunca passa como se fosse completa.
        familiasDesmarcadas: familiasDesmarcadas.map((f) => ({ familia: f, valor: tributos[f] })),
        modeloPeriodo,
        alvoIdApuracao: alvo?.idApuracao ?? null,
        // Resumo dos DadosIniciais que serão usados (conferência na UI —
        // essencial no modo criação, onde a apuração inteira nasce daqui).
        dadosIniciaisResumo: {
            qualificacaoPj: di.QualificacaoPj ?? di.qualificacaoPj ?? null,
            tributacaoLucro: di.TributacaoLucro ?? di.tributacaoLucro ?? null,
            cpfResponsavel: di.ResponsavelApuracao?.CpfResponsavel
                ?? di.responsavelApuracao?.cpfResponsavel ?? null,
        },
        // Diagnóstico do IPI (Experte 06/2026): mostra o que o mês-modelo carrega
        // pro estabelecimento do IPI e o que estamos enviando — pra achar a fonte
        // certa do CnpjEstabelecimento que o SERPRO aceita. Só quando há IPI.
        ipiDiag: (Number(tributos.IPI) > 0) ? {
            cnpjEstabEnviado: montagem.debitos?.Ipi?.ListaDebitos?.[0]?.CnpjEstabelecimento || null,
            fonteCnpjEstab: modelo?.codigoPorFamilia?.IPI?.cnpjEstabelecimento
                ? 'modelo' : (montagem.debitos?.Ipi?.ListaDebitos?.[0]?.CnpjEstabelecimento ? 'fallback-cnpj-empresa' : 'ausente'),
            modeloPeriodo,
            modeloIpiRaw,
            modeloDebitosNumeracao,
            // Numeração que ESTAMOS enviando (IdDebito por grupo) — comparar com o modelo.
            debitosEnviadosNumeracao: montagem.debitos ? Object.fromEntries(
                Object.entries(montagem.debitos).map(([g, b]) => [
                    g, (b?.ListaDebitos || []).map((d) => ({ IdDebito: d.IdDebito, CodigoDebito: d.CodigoDebito })),
                ]),
            ) : null,
            modeloDadosIniciais,
        } : null,
    };
    if (!montagem.ok) {
        return { ok: false, etapa: 'montagem', motivo: montagem.erros.join(' '), proposta };
    }

    if (!transmitir) {
        return { ok: true, transmitido: false, proposta };
    }

    // 4. Transmite o encerramento com o payload alvo + débitos (existentes
    //    preservados + faltantes adicionados). encerrarApuracaoMit valida o
    //    payload de novo, exige emissão liberada e persiste o protocolo.
    const payload = {
        ...alvoPayload,
        PeriodoApuracao: alvoPayload.PeriodoApuracao || { MesApuracao: Number(mesPA), AnoApuracao: Number(anoPA) },
        Debitos: modoComplemento
            ? mesclarDebitosMit(debitosExistentes, montagem.debitos)
            : montagem.debitos,
    };
    delete payload.debitos; // evita duplicar o bloco em shape minúsculo legado
    const r = await encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit: payload });

    // Auditoria: quem transmitiu, quais valores, de onde vieram os códigos.
    try {
        const db = fa().firestore();
        await db.collection('dctfweb_mit_preenchimentos').add(sanitize({
            empresaId: empresaId || null,
            empresaCnpj,
            pa: paAlvo,
            modo: proposta.modo,
            tributosApp: tributos,
            mapeamento: montagem.mapeamento,
            jaDeclarados: proposta.jaDeclarados,
            familiasDesmarcadas: proposta.familiasDesmarcadas,
            totalProposto: montagem.totalProposto,
            modeloPeriodo,
            camposRemovidos: r.camposRemovidos || null,
            protocolo: r.protocolo || null,
            statusEncerramento: r.statusEncerramento || null,
            transmitidoPor: usuario?.email || usuario?.uid || null,
            transmitidoEm: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('[preencherEncerrarMit] falha gravando auditoria:', e.message);
    }

    return {
        ok: true, transmitido: true, proposta,
        protocolo: r.protocolo, statusEncerramento: r.statusEncerramento,
        camposRemovidos: r.camposRemovidos,
    };
}

// ── Retificação da apuração MIT com os valores do app ──────────────────────
//
// Contraparte do preenchimento pra apuração JÁ ENCERRADA/transmitida cujos
// valores mudaram no app (caso CLINICA MANTOAN 06/2026: aplicações
// financeiras lançadas DEPOIS da transmissão — IRPJ/CSLL subiram). Mecânica:
// reencerramento via ENCAPURACAO314 com os débitos ajustados; a DCTFWeb
// RETIFICADORA é gerada automaticamente pela Receita.
//
// REQUISITO INEGOCIÁVEL (Paulo, 23/07/2026): SOMENTE ADMIN retifica — a rota
// usa requireAdmin e esta função revalida o role (defesa em profundidade).
// Preview obrigatório do antes → depois: transmitir=false devolve a proposta;
// transmitir=true remonta TUDO no servidor e transmite.
export async function retificarMit({
    empresaId, empresaCnpj, anoPA, mesPA, tributosApp, transmitir = false, usuario = null,
}) {
    const provider = getDctfwebProvider();
    if (typeof provider.consultarApuracaoMitPorId !== 'function') {
        return { ok: false, motivo: 'Retificação do MIT disponível apenas no modo serpro.' };
    }
    // Trava de papel TAMBÉM aqui: a rota já exige admin, mas quem chamar esta
    // função por outro caminho não pode escapar da regra.
    if (usuario && usuario.role !== 'admin') {
        return { ok: false, motivo: 'Somente administradores podem retificar uma apuração transmitida.' };
    }

    const tributos = {};
    for (const fam of FAMILIAS) {
        const v = Number(tributosApp?.[fam]);
        tributos[fam] = Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
    }
    const paAlvo = `${anoPA}${String(mesPA).padStart(2, '0')}`;

    // 1. Apuração-alvo TEM que existir e estar ENCERRADA — senão o fluxo certo
    //    é o preenchimento normal (que cria/complementa/encerra).
    const alvo = await provider.consultarApuracaoMit({ empresaCnpj, anoPA, mesPA });
    if (!alvo?.apuracaoMit) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} não existe — não há o que retificar. `
                + 'Use "Preencher MIT com os valores do app", que cria e encerra a apuração.',
        };
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
            motivo: `A apuração MIT de ${paAlvo} está marcada como Sem Movimento — retificação de sem-movimento para com-movimento deve ser feita no e-CAC.`,
        };
    }
    const situacaoAlvo = Number(
        alvo.apuracaoResumo?.situacao ?? alvo.apuracaoResumo?.situacaoApuracao
        ?? alvo.apuracaoMit?.situacaoApuracao ?? alvo.apuracaoMit?.situacao ?? NaN
    );
    if (situacaoAlvo === 4) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} está com encerramento em processamento no SERPRO — aguarde e atualize antes de retificar.`,
        };
    }
    if (situacaoAlvo !== 3) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} ainda NÃO está encerrada — retificação é só para apuração já transmitida. `
                + 'Use "Preencher MIT com os valores do app" (fluxo normal de encerramento).',
        };
    }

    // 2. Precisamos LER os débitos atuais com segurança (antes → depois honesto).
    const debitosExistentes = alvoPayload.Debitos || alvoPayload.debitos || null;
    const normAlvo = normalizarApuracaoMit(alvo.apuracaoMit);
    if (contarDebitosMit(debitosExistentes) > 0 && !normAlvo?.lido) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `A apuração MIT de ${paAlvo} tem débitos num formato que não consegui classificar por tributo — `
                + 'retifique manualmente no e-CAC para não arriscar duplicar ou perder débito.',
        };
    }

    // 3. Código pra família NOVA na retificação (sem débito atual): busca a
    //    apuração-modelo (meses anteriores), mesmo rito do preenchimento.
    let modelo = extrairModeloDebitosMit(alvo.apuracaoMit);
    const familiasSemCodigo = FAMILIAS.filter((f) => tributos[f] > 0 && !modelo.codigoPorFamilia[f]);
    if (familiasSemCodigo.length > 0) {
        const candidatos = [];
        for (const ano of [Number(anoPA), Number(anoPA) - 1]) {
            try {
                const hist = await provider.consultarApuracoesAno({ empresaCnpj, anoPA: ano });
                for (const item of hist?.apuracoes || []) {
                    const periodo = mitPeriodoLabel(item);
                    const id = pickIdApuracao(item);
                    if (!periodo || id == null || id === '') continue;
                    if (periodo >= paAlvo) continue;
                    candidatos.push({ periodo, id });
                }
            } catch (e) {
                console.warn(`[retificarMit] histórico ${ano} indisponível:`, e.message);
            }
            if (candidatos.length > 0) break;
        }
        candidatos.sort((a, b) => b.periodo.localeCompare(a.periodo));
        for (const cand of candidatos.slice(0, 4)) {
            try {
                const det = await provider.consultarApuracaoMitPorId({ empresaCnpj, idApuracao: cand.id });
                const m = extrairModeloDebitosMit(det?.apuracaoMit);
                for (const f of familiasSemCodigo) {
                    if (!modelo.codigoPorFamilia[f] && m.codigoPorFamilia[f]) {
                        modelo.codigoPorFamilia[f] = m.codigoPorFamilia[f];
                    }
                }
                if (familiasSemCodigo.every((f) => modelo.codigoPorFamilia[f])) break;
            } catch (e) {
                console.warn(`[retificarMit] detalhe modelo ${cand.periodo} falhou:`, e.message);
            }
        }
    }

    // 4. Monta os débitos retificados (puro, testado) e a proposta antes→depois.
    const montagem = montarDebitosRetificacaoMit(tributos, debitosExistentes, modelo, { empresaCnpj });
    const di = alvoPayload.DadosIniciais || {};
    const proposta = {
        pa: paAlvo,
        modo: 'retificacao',
        tributosApp: tributos,
        mapeamento: montagem.mapeamento,
        totalAntes: montagem.totalAntes,
        totalDepois: montagem.totalDepois,
        alvoIdApuracao: alvo?.idApuracao ?? null,
        dadosIniciaisResumo: {
            qualificacaoPj: di.QualificacaoPj ?? di.qualificacaoPj ?? null,
            tributacaoLucro: di.TributacaoLucro ?? di.tributacaoLucro ?? null,
            cpfResponsavel: di.ResponsavelApuracao?.CpfResponsavel
                ?? di.responsavelApuracao?.cpfResponsavel ?? null,
        },
    };
    if (!montagem.ok) {
        return { ok: false, etapa: 'montagem', motivo: montagem.erros.join(' '), proposta };
    }
    if (!montagem.temDiferenca) {
        return {
            ok: false, etapa: 'alvo',
            motivo: `Os débitos do MIT de ${paAlvo} já batem com a apuração do app — nada a retificar.`,
            proposta,
        };
    }

    if (!transmitir) {
        return { ok: true, transmitido: false, proposta };
    }

    // 5. Reencerra a apuração com os débitos ajustados. A Receita gera a
    //    DCTFWeb retificadora automaticamente a partir do novo encerramento.
    const payload = {
        ...alvoPayload,
        PeriodoApuracao: alvoPayload.PeriodoApuracao || { MesApuracao: Number(mesPA), AnoApuracao: Number(anoPA) },
        Debitos: montagem.debitos,
    };
    delete payload.debitos;
    const r = await encerrarApuracaoMit({ empresaId, empresaCnpj, anoPA, mesPA, dadosApuracaoMit: payload });

    // Auditoria: retificação é o ato mais sensível do módulo — grava antes,
    // depois, diferença por tributo e QUEM transmitiu.
    try {
        const db = fa().firestore();
        await db.collection('dctfweb_mit_retificacoes').add(sanitize({
            empresaId: empresaId || null,
            empresaCnpj,
            pa: paAlvo,
            mapeamento: montagem.mapeamento,
            totalAntes: montagem.totalAntes,
            totalDepois: montagem.totalDepois,
            camposRemovidos: r.camposRemovidos || null,
            protocolo: r.protocolo || null,
            statusEncerramento: r.statusEncerramento || null,
            transmitidoPor: usuario?.email || usuario?.uid || null,
            transmitidoEm: new Date().toISOString(),
        }));
    } catch (e) {
        console.warn('[retificarMit] falha gravando auditoria:', e.message);
    }

    return {
        ok: true, transmitido: true, proposta,
        protocolo: r.protocolo, statusEncerramento: r.statusEncerramento,
        camposRemovidos: r.camposRemovidos,
    };
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

// Resumo do dashboard DCTFWeb, ESCOPADO por carteira (cnpjsPermitidos === null
// => admin, vê tudo; Set => só esses CNPJs). Antes contava a base inteira pra
// qualquer colaborador (varredura 09/07).
export async function getResumoGlobal(cnpjsPermitidos = null) {
    const db = fa().firestore();
    let docs = (await fetchAllDocs(db.collection(COLLECTION), { label: 'dctfweb_declaracoes/resumo' })).map(d => d.data());
    if (cnpjsPermitidos instanceof Set) {
        docs = docs.filter(d => cnpjsPermitidos.has(String(d.empresaCnpj || '').replace(/\D/g, '')));
    }
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
