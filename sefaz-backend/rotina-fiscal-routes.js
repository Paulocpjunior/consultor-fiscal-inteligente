// ============================================================================
// sefaz-backend/rotina-fiscal-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/rotina-fiscal/painel?competencia=AAAA-MM
//
// O TRILHO do mês, por cliente: captura → validação → apuração → obrigações →
// guias. Junta as quatro fontes reais numa leitura só (nada por empresa, senão
// seriam ~400 idas ao Firestore) e devolve, pra cada empresa, em que etapa ela
// está parada e QUAL é o próximo passo.
//
// Colaborador vê a própria carteira; admin vê tudo. A regra de quem está em
// cada etapa vive em rotina-fiscal.js (puro, testado) — aqui é só I/O.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarRotinaFiscal, resumirFunil, acharApuracaoDaCompetencia } from './rotina-fiscal.js';
import { mesDoCliente, pendenciasDeConfirmacao } from './catalogo-obrigacoes.js';
import { carregarPrazosMunicipais } from './prazos-municipais-routes.js';
// 🔒 Os carimbos do fim de mês da competência, em UMA query. Ver o comentário
// de `lerFechamentosDaCompetencia`: cada card buscando o seu era ~400 idas ao
// Firestore e o HTTP 429 do print de 27/08.
import { lerFechamentosDaCompetencia } from './fechamento-store.js';

/**
 * Cobertura do catálogo para UM cliente.
 *
 * ⚠️ DOIS FORMATOS DE COMPETÊNCIA NO MESMO APP: a Rotina fala 'AAAA-MM' e o
 * catálogo fala 'MM/AAAA'. Passar direto explodia — foi um defeito meu, pego
 * pelo teste antes de subir. A conversão fica AQUI, na fronteira, e não dentro
 * do catálogo: mudar o formato dele quebraria o cron das tarefas, que é quem
 * cria o mês inteiro.
 *
 * E a falha NÃO derruba o painel: a Rotina responde pela carteira toda, então
 * um throw apagaria a tela de todo mundo por causa de um cadastro torto. Sem
 * cobertura, a etapa 4 só perde a trava — que é o comportamento de antes.
 */
function coberturaDoCliente(e, competencia, prazosMunicipais = []) {
    const [ano, mes] = String(competencia || '').split('-');
    if (!ano || !mes) return null;
    try {
        // A UF vai junto: é ela que decide se o prazo ESTADUAL cadastrado
        // (hoje só o de SP) vale para este cliente.
        return mesDoCliente({
            colecao: e.colecao, regimePadrao: e.regimePadrao, uf: e.uf,
            // Município + calendários: é o que transforma o ISS de pendência
            // nomeada em obrigação com data — para quem tem o calendário.
            codMunIBGE: e.codMunIBGE, prazosMunicipais,
        }, `${mes}/${ano}`);
    } catch (err) {
        console.warn(`[rotina] cobertura do catálogo falhou (${e.nome}):`, err.message);
        return null;
    }
}
import { identificarNaturezaFornecedor } from './dipam-produtor-rural.js';
// Duas perguntas, dois donos: "é nota própria de entrada?" e "de que LADO está
// a contraparte?". Juntá-las numa expressão só foi o que produziu a cópia.
import { ehNotaPropriaDeEntrada } from './xml-metadata-helper.js';
import { ladoDaContraparte } from './participante-doc-helper.js';
import { montarPainelIssCarteira, acumularIssPorEmpresa } from './iss-carteira.js';
import { saudeNfseSp, empresaComFalhaNaCaptura } from './nfse-sp-saude.js';

/** SP capital. Fora da praça o ISS é de outra prefeitura, com outro portal. */
const COD_MUN_SP_CAPITAL = '3550308';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/** 'AAAA-MM' → 'MM/AAAA' (formato que as tarefas usam desde o cron mensal). */
const competenciaTarefa = (c) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(c || ''));
    return m ? `${m[2]}/${m[1]}` : null;
};

const competenciaAtual = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * Empresas monitoradas (Simples + Lucro) COM os campos de apuração.
 * Pula lápide (_deleted) e fundidas (_merged_into) — regra permanente.
 */
async function carregarEmpresas(db) {
    const out = [];
    for (const [col, regime] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            const d = doc.data() || {};
            if (d._deleted || d._merged_into) return;
            const cnpj = soDigitos(d.cnpj);
            if (cnpj.length !== 14) return;
            const df = d.dadosFiscais || {};
            out.push({
                id: doc.id,
                cnpj,
                nome: d.razaoSocial || d.nome || d.fantasia || '—',
                regime,
                // Para o catálogo dizer se COBRE este cliente: ele resolve o
                // regime fiscal pela coleção + regimePadrao (Lucro sem o campo
                // vira INDEFINIDO, e adivinhar regime é adivinhar imposto).
                colecao: col,
                regimePadrao: d.regimePadrao || d.dadosFiscais?.regimePadrao || '',
                uf: d.dadosFiscais?.uf || d.uf || '',
                capturaAtiva: d.capturarSefaz !== false,
                // ISS de SP capital: município, CCM e SUP decidem se há guia do
                // município no mês (e se a captura da NFS-e sequer roda).
                codMunIBGE: String(df.codMunIBGE || d.codMunIBGE || '').trim(),
                ccmSp: String(df.ccmSp || d.ccmSp || '').replace(/\D/g, ''),
                issFixoSup: (d.issPadraoConfig?.tipo || df.issConfig?.tipo) === 'sup_fixo',
                // usados só pra achar a prova da apuração da competência
                fichaFinanceira: d.fichaFinanceira || null,
                faturamentoManual: d.faturamentoManual || null,
                faturamentoMensalDetalhado: d.faturamentoMensalDetalhado || null,
            });
        });
    }
    return out;
}

/** Agrupa uma lista por empresaId, com fallback pelo CNPJ (docs sem dono). */
function agrupar(itens, porCnpjToId) {
    const mapa = new Map();
    for (const it of itens) {
        let id = it.empresaId || null;
        if (!id) {
            const cnpj = soDigitos(it.empresaCnpj || it.cnpjDest || it.cnpjEmit);
            id = porCnpjToId.get(cnpj) || null;
        }
        if (!id) continue;
        const lista = mapa.get(id) || [];
        lista.push(it);
        mapa.set(id, lista);
    }
    return mapa;
}

/**
 * Sinal de DIPAM na rotina: quantas entradas do mês vêm de produtor rural COM
 * prova na própria nota (CPF do emitente ou IE paulista de produtor, que começa
 * com "P"). É só o sinal — a conta por município e a lista de fornecedores a
 * confirmar vivem na aba DIPAM, que lê os documentos inteiros (itens/CFOP).
 *
 * Aqui NÃO se conta "fornecedor indefinido": com CNPJ e sem IE de produtor
 * está a maioria absoluta das compras de qualquer empresa, e transformar isso
 * em pendência pintaria a carteira inteira de âmbar.
 */
function contarProdutoresRurais(documentos) {
    let produtores = 0;
    for (const d of documentos) {
        // 🚨 ESTA CÓPIA NÃO TINHA O LAÇO (26/08, triagem das leituras cruas de
        // `direcao`): ela reconhecia a nota própria de entrada só por
        // `tpNF === '0'`, e o dono existe justamente por causa disso — a nota
        // própria de entrada é emitida PELA EMPRESA, e sem conferir isso o
        // `tpNF=0` de um TERCEIRO viraria "nossa" nota própria, com o produtor
        // procurado no bloco errado. Duas perguntas, dois donos.
        const propriaEntrada = ehNotaPropriaDeEntrada(d, d.empresaCnpj).sim;
        if (d.direcao !== 'entrada' && !propriaEntrada) continue;
        if (['cancelado', 'cancelada', 'denegado', 'inutilizado'].includes(d.status)) continue;
        const contraparte = ladoDaContraparte(d, d.empresaCnpj) === 'destinatario'
            ? d.destinatario : d.emitente;
        if (identificarNaturezaFornecedor(contraparte || {}).ehProdutorRuralPF) produtores += 1;
    }
    return { produtores, indefinidos: 0 };
}

/**
 * ISS de SP capital por empresa, no formato que `montarRotinaFiscal` espera.
 *
 * Chama o MESMO `montarPainelIssCarteira` da aba 🏛️ ISS SP: se um dia a régua
 * mudar (situações, o que fica fora do total, o que é guia do município), a
 * Rotina muda junto — painel com conta própria diverge sozinho e ninguém nota
 * até um cliente pagar errado.
 *
 * Empresa fora de SP capital não entra: o ISS dela é de outra prefeitura, com
 * outro portal e outro vencimento — inventar pendência aqui seria pior que não
 * ter nada.
 */
async function montarIssDaCarteira(db, empresas, documentos, porCnpjToId, competencia) {
    const mapa = new Map();
    const spCapital = empresas.filter((e) => e.codMunIBGE === COD_MUN_SP_CAPITAL);
    if (!spCapital.length) return { mapa, resumo: null, saude: null };

    const idsSp = new Set(spCapital.map((e) => e.id));
    const resolver = (d) => {
        const id = d.empresaId || porCnpjToId.get(soDigitos(d.empresaCnpj || d.cnpjDest || d.cnpjEmit));
        return id && idsSp.has(id) ? id : null;
    };
    const apuracoes = acumularIssPorEmpresa(documentos, resolver);

    // Saúde da captura de NFS-e SP decide se um "zero nota" pode ser lido como
    // "sem movimento". Sem conseguir ler, NENHUM zero é confiável — silêncio
    // não é sucesso, e é melhor a rotina pedir conferência do que afirmar.
    let logs = [];
    let saude = null;
    try {
        const ls = await db.collection('nfsesp_portal_cron_logs').orderBy('executadoEm', 'desc').limit(10).get();
        logs = ls.docs.map((x) => ({ id: x.id, ...x.data() }));
        saude = saudeNfseSp(logs, Date.now());
    } catch (e) {
        console.warn('[rotina-fiscal] saúde da NFS-e SP indisponível:', e.message);
    }
    const zeroConfiavelPara = (cnpj) => !!saude?.zeroConfiavel && !empresaComFalhaNaCaptura(logs, cnpj);

    const painel = montarPainelIssCarteira({
        empresas: spCapital.map((e) => ({
            empresaId: e.id, nome: e.nome, cnpj: e.cnpj, regime: e.regime, ccm: e.ccmSp, issFixoSup: e.issFixoSup,
        })),
        apuracoes,
        zeroConfiavelPara,
    });
    for (const l of painel.linhas) {
        mapa.set(l.empresaId, { aplicavel: true, competencia, ...l });
    }
    return {
        mapa,
        resumo: { ...painel.resumo, farol: painel.farol, avisos: painel.avisos },
        // Farol honesto: falhar em LER a saúde deixa TODO zero não-confiável, e
        // a tela precisa DIZER isso — senão o colaborador lê "sem movimento"
        // onde o certo é "não sabemos" (buraco do #506).
        saude: saude || {
            farol: 'quebrado',
            motivo: 'Não consegui ler a saúde da captura de NFS-e SP.',
            acao: 'Sem ela, nenhum "zero nota" de NFS-e vale como "sem movimento" — confira a aba Captura.',
            zeroConfiavel: false,
        },
    };
}

/**
 * MONTA A ROTINA de um conjunto de empresas numa competência.
 *
 * 🚨 EXTRAÍDA EM 26/08, quando o **DAR FIM DE MÊS** passou a precisar da MESMA
 * resposta: as 5 etapas da Rotina são a PRÉ-CONDIÇÃO do ato (etapa aberta
 * BLOQUEIA o fechamento, decisão do Paulo). Uma segunda montagem no outro
 * arquivo divergiria — e divergiria no pior lugar possível, porque o painel
 * diria "pronto para fechar" e o botão recusaria, ou pior, o contrário.
 *
 * O handler do painel e o do fim de mês passam a chamar esta função; o que
 * muda entre eles é só QUANTAS empresas entram.
 */
export async function montarRotinasDaCompetencia(db, empresas, competencia) {
    const porCnpjToId = new Map(empresas.map((e) => [e.cnpj, e.id]));

    // ── documentos da competência (uma leitura, campos mínimos) ──────────
    const docsSnaps = await fetchAllDocs(
        db.collection('documentos_fiscais')
            .where('competencia', '==', competencia)
            // 🚨 `cStat`/`eventos`: a etapa de VALIDAÇÃO conta as canceladas
            // por `docCancelado`, e o cancelamento chega por EVENTO com o
            // `status` ainda 'autorizado'. Sem eles a Rotina dizia
            // "0 cancelada(s)" e a etapa fechava VERDE — o farol honesto
            // mentindo justamente no guia do mês do colaborador.
            .select('empresaId', 'empresaCnpj', 'cnpjDest', 'cnpjEmit', 'direcao', 'status', 'cStat', 'eventos',
                // `emitente`/`destinatario`/`tpNF` entram pra detectar compra
                // de produtor rural (DIPAM) sem NENHUMA leitura extra — o
                // detalhe fica na aba própria, aqui só sinaliza a obrigação.
                // tpNF=0 = nota própria de entrada (produtor no destinatário).
                'valorTotal', 'temItens', 'schema', 'tipoDoc', 'chave', 'emitente', 'destinatario', 'tpNF',
                // ISS de SP capital — MESMA leitura, sem consulta extra. As
                // duas formas são obrigatórias: a NFS-e do portal vem
                // ACHATADA (valorIss/issDevido) e a do XML vem em OBJETO
                // (valores.iss). Ler só uma zera metade da base.
                'tipo', 'valorIss', 'issDevido', 'issRetido', 'valorIssRetido',
                'valores.iss', 'valores.issRetido', 'valores.valorIssRetido', 'valores.valorIss',
                // `totais.vISSRetido` é a forma do ABRASF — faltava, e sem
                // ela o ISS RETIDO daquele trilho some (a régua responde
                // "não achei" e o painel soma zero). CAMPOS_PARA_ISS_DO_DOCUMENTO.
                'totais.vISS', 'totais.vISSRetido',
                // POR QUE o ISS está zerado (iss-zerado-causa.js). Tudo já
                // é gravado pelo importer — nenhuma captura nova.
                'aliquotaServicos', 'valorServicos', 'valorDeducoes', 'valorTotal',
                'municipioPrestacaoIbge', 'prestadorOptanteSimples', 'codigoServico',
                // CARTA DE CORREÇÃO: ela pode ter mudado o CFOP/natureza, e
                // o livro sai do XML ORIGINAL. Era capturada e nenhum ponto
                // da escrituração olhava — a validação passou a olhar.
                'eventos', 'numero'),
        { label: `rotina-fiscal ${competencia}`, maxDocs: 60000 },
    );
    const documentos = docsSnaps.map((s) => s.data() || {});

    // ── tarefas da competência (formato MM/AAAA) ────────────────────────
    const compTarefa = competenciaTarefa(competencia);
    const tarefasSnaps = await fetchAllDocs(
        db.collection('tarefas').where('competencia', '==', compTarefa),
        { label: `rotina-tarefas ${compTarefa}`, maxDocs: 20000 },
    );
    const tarefas = tarefasSnaps.map((s) => s.data() || {});

    // ── envios do rito (#293) — sem índice por competência, filtra aqui ──
    const enviosSnap = await db.collection('impostos_enviados').limit(3000).get();
    const envios = enviosSnap.docs
        .map((d) => d.data() || {})
        .filter((e) => e.competencia === competencia);

    const docsPorEmpresa = agrupar(documentos, porCnpjToId);
    const tarefasPorEmpresa = agrupar(tarefas, porCnpjToId);
    const enviosPorEmpresa = agrupar(envios, porCnpjToId);

    // ── ISS de SP capital, pelo MESMO núcleo do painel 🏛️ ISS SP ─────────
    // A rotina nascera cega pro ISS e a onda 1 são 157 empresas de serviço
    // puro — as que NÃO fecham o mês no DAS. Reimplementar a conta aqui
    // faria os dois painéis divergirem, então os dois leem o mesmo núcleo.
    const issCarteira = await montarIssDaCarteira(db, empresas, documentos, porCnpjToId, competencia);
    // Calendários municipais (coleção pequena: 1 doc por cidade × vigência).
    // Falha aqui NÃO derruba o painel — sem eles o ISS volta a ser
    // pendência nomeada, que é o estado de antes.
    let prazosMunicipais = [];
    try { prazosMunicipais = await carregarPrazosMunicipais(db); }
    catch (e) { console.warn('[rotina] calendários municipais indisponíveis:', e.message); }

    // 🚨 QUEM CAPTURA POR A3 (agente local `cfi-a3`) — 202 das 404 da
    // carteira. UMA leitura da coleção (1 doc por empresa), a mesma que o
    // 📊 Status já faz. Sem isso a Rotina manda metade da carteira
    // "destravar a captura" quando o trilho está certo e o que falta é o
    // agente ter rodado.
    //
    // ⚠️ Falha aqui NÃO derruba o painel e NÃO apaga o alarme: sem a
    // leitura, a etapa volta a acender com a frase genérica — que é o
    // estado de antes, e é o lado seguro do erro.
    const empresasA3 = new Set();
    try {
        const certSnap = await db.collection('empresas_certificados').select('tipoCert').get();
        certSnap.forEach((d) => { if (d.data()?.tipoCert === 'A3') empresasA3.add(d.id); });
    } catch (e) {
        console.warn('[rotina] tipo de certificado indisponível:', e.message);
    }

    // UMA query para os carimbos da competência inteira — nunca uma por empresa.
    const carimbos = await lerFechamentosDaCompetencia(db, competencia);

    const rotinas = empresas.map((e) => montarRotinaFiscal({
        // TRAVA T1 DO ESCOPO: o catálogo diz se cobre este cliente. A flag
        // existia desde 11/08 e nenhuma tela lia — obrigação que não vira
        // tarefa não aparecia em lugar nenhum, e o mês fechava assim mesmo.
        cobertura: coberturaDoCliente(e, competencia, prazosMunicipais),
        iss: issCarteira.mapa.get(e.id) || null,
        dipam: contarProdutoresRurais(docsPorEmpresa.get(e.id) || []),
        empresa: { id: e.id, nome: e.nome, cnpj: e.cnpj, regime: e.regime },
        competencia,
        documentos: docsPorEmpresa.get(e.id) || [],
        apuracao: acharApuracaoDaCompetencia(e, competencia),
        tarefas: tarefasPorEmpresa.get(e.id) || [],
        envios: enviosPorEmpresa.get(e.id) || [],
        capturaAtiva: e.capturaAtiva,
        capturaPorAgenteLocal: empresasA3.has(e.id),
        // 🔒 O carimbo ENTRA no núcleo, não é grudado depois: é ele que decide
        // se ainda há próximo passo. Empresa com o mês fechado não volta ao
        // vermelho porque uma tarefa foi reaberta depois (Paulo, 27/08:
        // *"empresa fechada, imposto enviado, página virada"*). O núcleo
        // devolve o carimbo na rotina — é dele que o bloco "Dar fim de mês"
        // se alimenta, e buscá-lo por card foi o que produziu o 429.
        fechamento: carimbos.get(String(e.id || '')) || null,
    }));

    // 🔒 O carimbo viaja JUNTO da rotina: é ele que o bloco "Dar fim de mês"
    // precisa, e buscá-lo por card foi o que produziu o 429.
    for (const r of rotinas) {
        r.fechamento = carimbos.get(String(r.empresa?.id || '')) || null;
    }

    // O ISS e as CONTAGENS voltam juntos: os três são montados AQUI, numa
    // leitura só, e o painel os publica. Recalculá-los fora faria os dois
    // divergirem — que é justamente o motivo desta função existir.
    //
    // 🐛 E `lidos` esteve prestes a virar "Falha interna": ao extrair esta
    // função eu deixei `documentos`/`tarefas`/`envios` aqui dentro e o handler
    // continuou lendo os nomes. Quem pegou foi a trava de nomes do backend
    // (20/08) — a MESMA classe que derrubou a geração do SPED naquele dia.
    return {
        rotinas,
        issCarteira,
        lidos: { documentos: documentos.length, tarefas: tarefas.length, envios: envios.length },
    };
}

router.get('/painel', requireAuth, async (req, res) => {
    try {
        const competencia = /^\d{4}-\d{2}$/.test(String(req.query.competencia || ''))
            ? String(req.query.competencia)
            : competenciaAtual();
        const db = getDb();

        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin
        let empresas = await carregarEmpresas(db);
        if (idsCarteira) {
            const permitidos = new Set(idsCarteira);
            empresas = empresas.filter((e) => permitidos.has(e.id));
        }
        // Recorte opcional (o painel também abre pra uma empresa só).
        const filtroIds = String(req.query.empresaIds || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (filtroIds.length) {
            const alvo = new Set(filtroIds);
            empresas = empresas.filter((e) => alvo.has(e.id));
        }

        const { rotinas, issCarteira, lidos } = await montarRotinasDaCompetencia(db, empresas, competencia);

        // Ordem de trabalho: quem está mais atrás aparece primeiro — é a fila
        // do dia, não uma lista alfabética.
        // ⚠️ A empresa FECHADA vai por ÚLTIMO, depois até das que estão prontas
        // para fechar: a pronta ainda pede um clique, a fechada não pede nada.
        // Sem isso as duas empatavam em 99 e se misturavam no fim da fila.
        rotinas.sort((a, b) => {
            const oa = a.farol === 'fechado' ? 100 : (a.proximoPasso?.ordem ?? 99);
            const ob = b.farol === 'fechado' ? 100 : (b.proximoPasso?.ordem ?? 99);
            if (oa !== ob) return oa - ob;
            return String(a.empresa?.nome || '').localeCompare(String(b.empresa?.nome || ''), 'pt-BR');
        });

        return res.json({
            ok: true,
            competencia,
            escopo: idsCarteira ? 'carteira' : 'todas',
            funil: resumirFunil(rotinas),
            // ISS de SP capital da seleção. `null` quando NENHUMA empresa é de
            // SP capital — que é diferente de "zero ISS" e a tela não deve
            // mostrar um card zerado como se fosse resposta.
            iss: issCarteira.resumo,
            issSaudeCaptura: issCarteira.saude,
            // O QUE O PRÓPRIO CATÁLOGO ADMITE NÃO SABER. Existia desde 11/08
            // (`pendenciasDeConfirmacao`), testado, e NENHUMA tela chamava —
            // função pronta sem botão é código morto com cara de entrega.
            // Mora aqui, junto do número que ela explica: sem isso o painel
            // diz "N obrigações" sem dizer que M ficaram FORA da conta.
            catalogoPendencias: pendenciasDeConfirmacao(),
            rotinas,
            lidos,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[rotina-fiscal/painel]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a rotina: ${e.message}` });
    }
});

export default router;
