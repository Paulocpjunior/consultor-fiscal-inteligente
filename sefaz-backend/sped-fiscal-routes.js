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
import { fetchAllDocs } from './firestore-paginate.js';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

const router = express.Router();

/**
 * GET /preview?empresaId=X&competencia=YYYY-MM
 * Retorna estatisticas: notas, itens, participantes elegiveis pro periodo.
 */
router.get('/preview', requireAdmin, async (req, res) => {
    try {
        const { empresaId, competencia, competenciaInicio, competenciaFim } = req.query;
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });

        const dados = await coletarDadosEmpresa({
            empresaId,
            competencia,
            competenciaInicio,
            competenciaFim,
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
router.post('/gerar', requireAdmin, express.json(), async (req, res) => {
    try {
        const { empresaId, competencia, competenciaInicio, competenciaFim } = req.body || {};
        if (!empresaId) return res.status(400).json({ error: 'empresaId obrigatorio' });

        const dados = await coletarDadosEmpresa({
            empresaId,
            competencia,
            competenciaInicio,
            competenciaFim,
        });

        const txt = await montarBlocos({ dados });

        // Validacao PVA server-side
        const validacao = validarSpedFiscal(txt);

        // AUDITORIA DO ARQUIVO QUE SAIU (Paulo, 06/08: "esses erros nao podem
        // acontecer"). O validador confere o LEIAUTE; esta confere o
        // RESULTADO: coluna de valor zerada em 100% das linhas, total que nao
        // bate com os detalhes, bloco que promete conteudo e entrega vazio.
        // E a familia de defeito que passou pelos testes unitarios 3x.
        const auditoria = auditarSaidaSped(txt.split('\r\n').filter(Boolean));
        for (const s of auditoria.suspeitas) dados.warnings.push(`[auditoria] ${s.detalhe}`);

        // Encoding Windows-1252 (legado SPED)
        const buffer = Buffer.from(txt, 'latin1');

        // Nome do arquivo: SPED_<cnpj>_<periodo>.txt
        const cnpj = (dados.empresa.cnpj || '').replace(/\D/g, '');
        const periodo = competencia
            ? competencia.replace('-', '')
            : `${competenciaInicio.replace('-', '')}_${competenciaFim.replace('-', '')}`;
        const filename = `SPED_${cnpj}_${periodo}.txt`;

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
                valorTotal: Number(doc.valorTotal ?? doc.vNF ?? 0) || 0,
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
