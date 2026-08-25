// ============================================================================
// sefaz-backend/sped-fiscal-routes.js  (ESM)
// Endpoints: /sped-fiscal/preview, /sped-fiscal/gerar, /sped-fiscal/historico
//
// Layout alvo: EFD ICMS/IPI Guia Pratico 3.2.2, Leiaute 020.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { coletarDadosEmpresa, montarBlocos } from './sped-fiscal-orchestrator.js';
import { requireAdmin, requireAuth } from './require-admin.js';
import { podeAcessarEmpresaId } from './carteira-auth.js';
import { validarSpedFiscal } from './sped-fiscal-validador.js';
import { auditarSaidaSped, resumoAuditoria } from './sped-auditoria-saida.js';
// 🚦 O "PVA DE BOLSO" — as recusas que o validador já nos deu, conferidas AQUI,
// sobre o arquivo, antes de alguém abrir o PVA (Paulo, 20/08: o gargalo é o
// vai-e-vem). Cada regra carrega a recusa LITERAL como fonte.
import { prevalidarSpedFiscal, resumoPrevalidacao } from './sped-prevalidacao.js';
// 🧮 A abertura do saldo credor vem do SPED ENTREGUE colado — nunca digitada.
import { extrairAberturaDoSped } from './saldo-abertura.js';
import { competenciaParaGerarArquivo } from './competencia.js';
import { MOTIVOS_INVENTARIO, inventarioInformado } from './sped-bloco-h.js';
import { fetchAllDocs } from './firestore-paginate.js';

// Valor do documento em TODAS as formas (o import pelo navegador grava só
// `totais.vNF`) — régua única.
import { valorDoDocumento } from './xml-metadata-helper.js';
// O nome carrega a HORA da geração — dono ÚNICO nas duas famílias, senão o
// EFD ICMS/IPI continuaria produzindo arquivos indistinguíveis (PWR, 25/08).
import { nomeDoArquivoSped, avisoDeIdentidadeDoArquivo } from './sped-nome-arquivo.js';
function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const router = express.Router();

/**
 * As TRÊS formas de pedir período aqui — mês único, ou início+fim do trimestre.
 * Cada uma que vier é normalizada; ILEGÍVEL recusa com o motivo.
 *
 * ⚠️ O range compara STRING (`n.competencia >= periodoInicio`), então uma forma
 * diferente não filtra "quase certo": ela não casa com nada. Vazio, de novo.
 */
function periodoDaRequisicao(q) {
    const out = { ok: true, competencia: undefined, competenciaInicio: undefined, competenciaFim: undefined };
    for (const campo of ['competencia', 'competenciaInicio', 'competenciaFim']) {
        const bruta = (q || {})[campo];
        if (bruta === undefined || bruta === null || bruta === '') continue;
        const r = competenciaParaGerarArquivo(bruta);
        if (!r.ok) return { ok: false, erro: `${campo}: ${r.erro}` };
        out[campo] = r.competencia;
    }
    return out;
}

/**
 * GET /preview?empresaId=X&competencia=YYYY-MM
 * Retorna estatisticas: notas, itens, participantes elegiveis pro periodo.
 */
router.get('/preview', requireAdmin, async (req, res) => {
    try {
        const { empresaId } = req.query;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        // 🚨 A MESMA porta do EFD-Contribuições, e pela MESMA razão: competência
        // fora de `AAAA-MM` fazia o `where` devolver ZERO documentos e o
        // arquivo sair VAZIO, com o aviso lido como "empresa sem movimento".
        // Meia trava protege o cliente que já quebrou e deixa o próximo
        // descoberto — aqui o trimestral tem TRÊS campos, e os três passam.
        const periodo = periodoDaRequisicao(req.query);
        if (!periodo.ok) return res.status(400).json({ error: periodo.erro });

        const dados = await coletarDadosEmpresa({
            empresaId,
            competencia: periodo.competencia,
            competenciaInicio: periodo.competenciaInicio,
            competenciaFim: periodo.competenciaFim,
        });

        return res.json({
            empresaId,
            empresaNome: dados.empresa.nome,
            periodo: `${dados.competenciaInicio} ate ${dados.competenciaFim}`,
            totais: {
                notas: dados.notas.length,
                itens: dados.itens.length,
                participantes: dados.participantes.length,
                unidades: dados.unidades.length,
            },
            warnings: dados.warnings,
        });
    } catch (e) {
        return tratarErro(e, res);
    }
});

/**
 * POST /gerar
 * Body: { empresaId, competencia | (competenciaInicio + competenciaFim) }
 * Retorna o .txt do SPED Fiscal montado, com Content-Disposition pra download.
 */
// ────────────────────────────────────────────────────────────────────────────
// Inventário do Bloco H — a CONTAGEM FÍSICA do cliente.
//
// Este dado NÃO existe em lugar nenhum do sistema: não sai das notas, não se
// estima do histórico de compras, não se deduz. É a contagem que a empresa fez.
// Sem ela o bloco H sai VAZIO de propósito (nunca zerado — zerado declararia
// ao Fisco que não havia estoque).
//
// 1 doc por EMPRESA × DATA: o inventário é a foto de uma data.
// ────────────────────────────────────────────────────────────────────────────
const idInventario = (empresaId, data) => `${empresaId}_${String(data || '').replace(/\D/g, '')}`;

router.get('/inventario', requireAuth, async (req, res) => {
    try {
        const { empresaId, data } = req.query || {};
        if (!empresaId || !/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
            return res.status(400).json({ ok: false, error: 'Informe a empresa e a data do inventário (AAAA-MM-DD).' });
        }
        const db = fa().firestore();
        const snap = await db.collection('sped_inventario').doc(idInventario(empresaId, data)).get();
        return res.json({ ok: true, existe: snap.exists, ...(snap.exists ? snap.data() : { itens: [], motInv: '01' }) });
    } catch (e) {
        console.error('[sped/inventario GET]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/inventario', requireAuth, express.json({ limit: '4mb' }), async (req, res) => {
    try {
        const { empresaId, data, motInv = '01', itens } = req.body || {};
        if (!empresaId || !/^\d{4}-\d{2}-\d{2}$/.test(String(data || ''))) {
            return res.status(400).json({ ok: false, error: 'Informe a empresa e a data do inventário (AAAA-MM-DD).' });
        }
        if (!MOTIVOS_INVENTARIO.includes(String(motInv))) {
            return res.status(400).json({ ok: false, error: `Motivo do inventário inválido (use ${MOTIVOS_INVENTARIO.join(', ')}).` });
        }
        // Só grava o que foi CONTADO. Item sem contagem não vira zero aqui —
        // ele simplesmente não entra, e o bloco H dirá quantos ficaram de fora.
        const limpos = (Array.isArray(itens) ? itens : [])
            .filter((i) => i && i.codItem && inventarioInformado(i))
            .map((i) => ({
                codItem: String(i.codItem).slice(0, 60),
                unidade: String(i.unidade || 'UN').slice(0, 6),
                qtdInventario: Number(i.qtdInventario),
                vlUnitInventario: Number(i.vlUnitInventario),
                indPropInventario: ['0', '1', '2'].includes(String(i.indPropInventario)) ? String(i.indPropInventario) : '0',
                codPartInventario: String(i.codPartInventario || '').slice(0, 60),
            }));
        const db = fa().firestore();
        await db.collection('sped_inventario').doc(idInventario(empresaId, data)).set({
            empresaId, data, motInv: String(motInv), itens: limpos,
            atualizadoEm: new Date().toISOString(),
            atualizadoPor: req.user?.email || null,
        }, { merge: true });
        return res.json({ ok: true, gravados: limpos.length, recebidos: (itens || []).length });
    } catch (e) {
        console.error('[sped/inventario POST]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── 🧮 SALDO DE ABERTURA — a cronologia do saldo credor ───────────────────
//
// A fonte é o SPED ENTREGUE colado (E110 c.14 / E520 c.7), nunca digitação —
// saldo digitado é a ficha de novo, com outro nome. O POST extrai, confere o
// CNPJ contra a empresa e grava com carimbo; quem decide o saldo anterior de
// cada geração é `resolverSaldoAnterior` no orquestrador.
router.get('/saldo-abertura', requireAdmin, async (req, res) => {
    try {
        const { empresaId } = req.query || {};
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Informe a empresa.' });
        const snap = await fa().firestore().collection('sped_saldos_abertura').doc(String(empresaId)).get();
        return res.json({ ok: true, existe: snap.exists, abertura: snap.exists ? snap.data() : null });
    } catch (e) {
        console.error('[sped/saldo-abertura GET]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/saldo-abertura', requireAdmin, express.json({ limit: '20mb' }), async (req, res) => {
    try {
        const { empresaId, texto } = req.body || {};
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Informe a empresa.' });

        const r = extrairAberturaDoSped(texto);
        if (!r.ok) return res.status(400).json({ ok: false, error: r.motivo });

        // O SPED colado tem que ser DESTA empresa — abertura da empresa errada
        // é o saldo de um contribuinte transportado para outro, e ninguém acha
        // depois. A conferência é pela RAIZ (matriz/filial compartilham cert,
        // não saldo — aqui é o CNPJ INTEIRO).
        const db = fa().firestore();
        let emp = await db.collection('lucro_empresas').doc(String(empresaId)).get();
        if (!emp.exists) emp = await db.collection('simples_empresas').doc(String(empresaId)).get();
        if (!emp.exists) return res.status(404).json({ ok: false, error: 'Empresa não encontrada.' });
        const cnpjEmpresa = String(emp.data().cnpj || '').replace(/\D/g, '');
        if (cnpjEmpresa && cnpjEmpresa !== r.cnpj) {
            return res.status(400).json({
                ok: false,
                error: `O SPED colado é do CNPJ ${r.cnpj} e a empresa selecionada é ${cnpjEmpresa} — `
                    + 'confira se colou o arquivo do cliente certo. Nada foi gravado.',
            });
        }

        // Substituir a abertura é legítimo (SPED entregue mais novo) — mas o
        // que havia antes fica no histórico do documento, com quem e quando.
        const ref = db.collection('sped_saldos_abertura').doc(String(empresaId));
        const antes = await ref.get();
        await ref.set({
            empresaId: String(empresaId),
            cnpj: r.cnpj,
            competencia: r.competencia,
            icms: r.icms,
            ipi: r.ipi,
            temE520: !!r.temE520,
            origem: 'sped-entregue-colado',
            criadoPor: req.user?.email || null,
            criadoEm: new Date().toISOString(),
            ...(antes.exists ? { anterior: { ...antes.data(), anterior: null } } : {}),
        });
        return res.json({ ok: true, abertura: { competencia: r.competencia, icms: r.icms, ipi: r.ipi, temE520: r.temE520 } });
    } catch (e) {
        console.error('[sped/saldo-abertura POST]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.post('/gerar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        // 🚨 A MESMA porta do EFD-Contribuições, e pela MESMA razão: competência
        // fora de `AAAA-MM` fazia o `where` devolver ZERO documentos e o
        // arquivo sair VAZIO, com o aviso lido como "empresa sem movimento".
        // Meia trava protege o cliente que já quebrou e deixa o próximo
        // descoberto — aqui o trimestral tem TRÊS campos, e os três passam.
        const periodo = periodoDaRequisicao(req.body || {});
        if (!periodo.ok) return res.status(400).json({ error: periodo.erro });

        const dados = await coletarDadosEmpresa({
            empresaId,
            competencia: periodo.competencia,
            competenciaInicio: periodo.competenciaInicio,
            competenciaFim: periodo.competenciaFim,
        });

        const txt = await montarBlocos({ dados });

        // Validacao PVA server-side
        const validacao = validarSpedFiscal(txt);

        // AUDITORIA DO ARQUIVO QUE SAIU (Paulo, 06/08: "esses erros nao podem
        // acontecer"). O validador confere o LEIAUTE; esta confere o
        // RESULTADO: coluna de valor zerada em 100% das linhas, total que nao
        // bate com os detalhes, bloco que promete conteudo e entrega vazio.
        // E a familia de defeito que passou pelos testes unitarios 3x.
        const linhasDoArquivo = txt.split('\r\n').filter(Boolean);
        const auditoria = auditarSaidaSped(linhasDoArquivo);
        for (const s of auditoria.suspeitas) dados.warnings.push(`[auditoria] ${s.detalhe}`);

        // Pré-validação: confere o ARQUIVO (o mesmo texto que o PVA lê), não a
        // intenção do gerador — foi por auditar a intenção que o C100 saiu com
        // modelo 55 e chave 65 sem nenhum teste acusar.
        const prevalidacao = prevalidarSpedFiscal(linhasDoArquivo, {
            contribuinteIpi: dados.empresa?.dadosFiscais?.contribuinteIpi || '',
        });
        for (const linha of resumoPrevalidacao(prevalidacao)) dados.warnings.push(linha);

        // Encoding Windows-1252 (legado SPED)
        const buffer = Buffer.from(txt, 'latin1');

        // Nome do arquivo: SPED_<cnpj>_<periodo>.txt
        const cnpj = (dados.empresa.cnpj || '').replace(/\D/g, '');
        // Vem do período JÁ NORMALIZADO — o nome do arquivo carregava a forma
        // crua que a requisição mandou, então um `07/2026` viraria nome de
        // arquivo com barra.
        const sufixo = periodo.competencia
            ? periodo.competencia.replace('-', '')
            : `${periodo.competenciaInicio.replace('-', '')}_${periodo.competenciaFim.replace('-', '')}`;
        // 🚨 O NOME DIZ QUAL GERAÇÃO É — SPED_<cnpj>_<periodo>_<AAAAMMDD-HHMM>.txt
        const filename = nomeDoArquivoSped({ familia: 'SPED', cnpj, periodo: sufixo });

        // 🚨 E A TELA DIZ QUAL ARQUIVO ELA DESCREVE — o PVA guarda a
        // escrituração IMPORTADA na base dele, então número na tela sem o nome
        // do arquivo do lado não fecha a conferência (PWR, 25/08).
        for (const a of avisoDeIdentidadeDoArquivo({
            filename, linhas: linhasDoArquivo, registros: ['E110'],
        })) dados.warnings.push(a);

        res.setHeader('Content-Type', 'text/plain; charset=windows-1252');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        // Headers customizados pra UI mostrar warnings/totais
        if (dados.warnings.length) {
            res.setHeader('X-SPED-Warnings', encodeURIComponent(JSON.stringify(dados.warnings)));
        }
        res.setHeader('X-SPED-Stats', encodeURIComponent(JSON.stringify({
            notas: dados.notas.length,
            itens: dados.itens.length,
            participantes: dados.participantes.length,
            linhas: txt.split('\r\n').length - 1,
        })));
        // Resultado da validacao PVA no header (arquivo ainda eh gerado mesmo com erros)
        res.setHeader('X-SPED-Validation', encodeURIComponent(JSON.stringify(validacao)));
        res.setHeader('X-SPED-Auditoria', encodeURIComponent(JSON.stringify({
            ok: auditoria.ok, resumo: resumoAuditoria(auditoria), suspeitas: auditoria.suspeitas,
        })));
        res.setHeader('X-SPED-Prevalidacao', encodeURIComponent(JSON.stringify({
            ok: prevalidacao.erros.length === 0,
            resumo: prevalidacao.resumo,
            erros: prevalidacao.erros,
        })));
        return res.send(buffer);
    } catch (e) {
        return tratarErro(e, res);
    }
});

/**
 * GET /validar
 * Body: { txt: string }
 * Valida um arquivo SPED Fiscal TXT e retorna erros/avisos sem gerar download.
 */
router.get('/validar', requireAdmin, express.json({ limit: '10mb' }), (req, res) => {
    try {
        const { txt } = req.body || {};
        if (!txt || typeof txt !== 'string') {
            return res.status(400).json({ error: 'Campo "txt" (string) eh obrigatorio no body.' });
        }
        const resultado = validarSpedFiscal(txt);
        return res.json(resultado);
    } catch (e) {
        return tratarErro(e, res);
    }
});

// GET /nfes-capturadas?empresaId=X&competencia=YYYY-MM
// Lista NF-e capturadas da empresa na competencia — base do cruzamento
// SPED Fiscal × XML capturados. Devolve so o essencial pro front (chave,
// numero, status, valor, direcao), nunca o XML inteiro.
router.get('/nfes-capturadas', requireAuth, async (req, res) => {
    try {
        const { empresaId, competencia } = req.query;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!competencia) return res.status(400).json({ error: 'competencia obrigatoria (YYYY-MM)' });
        const carteira = await podeAcessarEmpresaId(req.user, empresaId);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });

        const db = fa().firestore();
        const q = db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('competencia', '==', competencia);
        const snap = await fetchAllDocs(q, { label: 'sped-fiscal/nfes-capturadas' });

        const nfes = [];
        let descartadas = 0;
        let perdedoresMerge = 0;
        for (const d of snap) {
            const doc = d.data();
            if (doc._merged_into) { perdedoresMerge++; continue; }
            const chave = String(doc.chave || doc.chaveAcesso || '').replace(/\D/g, '');
            if (chave.length !== 44) { descartadas++; continue; }
            nfes.push({
                chave,
                numero: doc.numero || doc.nNF || '',
                status: doc.status || null,
                valorTotal: Number(valorDoDocumento(doc)) || 0,
                direcao: doc.direcao || null,
                modelo: doc.modelo || doc.mod || null,
                dataEmissao: doc.dataEmissao || doc.dhEmi || null,
            });
        }
        return res.json({ empresaId, competencia, total: nfes.length, descartadas, perdedoresMerge, nfes });
    } catch (e) {
        return tratarErro(e, res);
    }
});

// GET /faturamento-declarado?empresaId=X&competencia=YYYY-MM
// Devolve o faturamento que o contador declarou pra empresa naquela
// competencia (faturamentoManual[mes] do Simples, ou receita do Lucro).
// Base do cruzamento "SPED Fiscal × faturamento declarado".
router.get('/faturamento-declarado', requireAuth, async (req, res) => {
    try {
        const { empresaId, competencia } = req.query;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });
        if (!competencia) return res.status(400).json({ error: 'competencia obrigatoria (YYYY-MM)' });
        const carteira = await podeAcessarEmpresaId(req.user, empresaId);
        if (!carteira.ok) return res.status(carteira.status).json({ error: carteira.error });

        const db = fa().firestore();
        let doc = null, fonte = null;
        // Procura primeiro em simples_empresas, depois lucro_empresas.
        for (const [col, tipo] of [['simples_empresas', 'simples'], ['lucro_empresas', 'lucro']]) {
            try {
                const snap = await db.collection(col).doc(empresaId).get();
                if (snap.exists) { doc = snap.data(); fonte = tipo; break; }
            } catch (e) {
                console.warn(`[faturamento-declarado] ${col} indisponivel:`, e.message);
            }
        }
        if (!doc) return res.status(404).json({ error: 'Empresa nao encontrada' });

        let faturamentoDeclarado = 0;
        let origem = null;
        if (fonte === 'simples') {
            // Simples: faturamentoManual[YYYY-MM] (chave usa hifen)
            const fm = doc.faturamentoManual || {};
            faturamentoDeclarado = Number(fm[competencia]) || 0;
            origem = 'faturamentoManual (Simples)';
        } else if (fonte === 'lucro') {
            // Lucro: receita por competencia (campo varia conforme cadastro).
            const fm = doc.faturamentoManual || doc.receitas || {};
            faturamentoDeclarado = Number(fm[competencia]) || 0;
            origem = doc.faturamentoManual ? 'faturamentoManual (Lucro)' : 'receitas (Lucro)';
        }

        return res.json({
            empresaId, competencia, fonte,
            faturamentoDeclarado, origem,
            disponivel: faturamentoDeclarado > 0,
        });
    } catch (e) {
        console.error('[sped-fiscal/faturamento-declarado]', e);
        return res.status(500).json({ error: 'Falha interna' });
    }
});

router.get('/historico', requireAdmin, async (_req, res) => {
    // Endpoint reservado pra historico de geracoes SPED Fiscal.
    // Hoje retorna vazio — geracoes ainda nao sao persistidas (sao on-demand).
    return res.json({ entries: [] });
});

function tratarErro(e, res) {
    if (e.code === 'DADOS_FISCAIS_INCOMPLETOS') {
        return res.status(400).json({
            error: 'DADOS_FISCAIS_INCOMPLETOS',
            message: e.message,
        });
    }
    if (e.code === 'EMPRESA_NAO_ENCONTRADA') {
        return res.status(404).json({
            error: 'EMPRESA_NAO_ENCONTRADA',
            message: e.message,
        });
    }
    console.error('[sped-fiscal]', e);
    return res.status(500).json({ error: "Falha interna" });
}

export default router;
