// ============================================================================
// sefaz-backend/dipam-routes.js  (ESM)
// ----------------------------------------------------------------------------
// DIPAM 1.1 + FUNRURAL por sub-rogação — compra de produtor rural.
//
//   GET  /api/admin/dipam/painel?empresaId=&competencia=   um cliente, completo
//   GET  /api/admin/dipam/varredura?competencia=           quem TEM DIPAM no mês
//   GET  /api/admin/dipam/produtores                       cadastros já confirmados
//   POST /api/admin/dipam/produtor                         confirma/edita um produtor
//
// A regra vive em `dipam-produtor-rural.js` (puro, testado). Aqui é I/O.
//
// Custo de leitura: a varredura da carteira é DUAS FASES de propósito — a
// primeira lê campos leves (emitente + valor) só pra descobrir QUAIS clientes
// têm nota de produtor rural no mês; a segunda carrega os documentos inteiros
// (itens/CFOP/infAdic) apenas desses. Ler tudo de todo mundo por causa de um
// punhado de clientes rurais seria caro e lento.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth, requireAdmin } from './require-admin.js';
import { podeAcessarEmpresaId, getEmpresaIdsDaCarteira } from './carteira-auth.js';
import { fetchAllDocs } from './firestore-paginate.js';
import {
    montarDipamCompetencia,
    identificarNaturezaFornecedor,
} from './dipam-produtor-rural.js';
import {
    carregarProdutoresRurais, salvarProdutorRural, lerCondicaoRural,
    documentosDaContraparte, COLECAO_PRODUTORES, NATUREZAS, REGIMES_FUNRURAL,
} from './dipam-store.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const ehCompetencia = (c) => /^\d{4}-\d{2}$/.test(String(c || ''));

/** Empresa por id (Simples ou Lucro), pulando lápide e fundida. */
async function carregarEmpresa(db, empresaId) {
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).doc(empresaId).get();
        if (!snap.exists) continue;
        const d = snap.data() || {};
        if (d._deleted || d._merged_into) continue;
        return { id: empresaId, ...d };
    }
    return null;
}

/** Documentos completos de uma empresa na competência. */
async function carregarDocumentos(db, empresaId, competencia) {
    const snaps = await fetchAllDocs(
        db.collection('documentos_fiscais')
            .where('empresaId', '==', empresaId)
            .where('competencia', '==', competencia),
        { label: `dipam ${empresaId} ${competencia}`, maxDocs: 20000 },
    );
    return snaps.map((s) => ({ id: s.id, ...(s.data() || {}) }))
        .filter((d) => !d._merged_into && !d._deleted);
}

// ─── Painel de um cliente ───────────────────────────────────────────────────

router.get('/painel', requireAuth, async (req, res) => {
    try {
        const empresaId = String(req.query.empresaId || '').trim();
        const competencia = String(req.query.competencia || '').trim();
        if (!empresaId) return res.status(400).json({ ok: false, error: 'Escolha a empresa.' });
        if (!ehCompetencia(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const acesso = await podeAcessarEmpresaId(req.user, empresaId);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const db = getDb();
        const empresa = await carregarEmpresa(db, empresaId);
        if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa não encontrada (ou excluída).' });

        const documentos = await carregarDocumentos(db, empresaId, competencia);
        const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
        const condicao = lerCondicaoRural(empresa);
        const painel = montarDipamCompetencia({ documentos, competencia, empresa: condicao, fornecedores });

        // O cadastro do cliente NÃO é a fonte da verdade — é a expectativa.
        // Divergência entre "o que está marcado" e "o que as notas mostram"
        // aparece na tela em vez de sumir: cliente sem a marcação e com compra
        // de produtor é justamente o que hoje passa batido no lançamento manual.
        const cadastro = {
            ...condicao,
            divergencia: divergenciaCadastro(condicao, painel),
        };

        return res.json({
            ok: true,
            ...painel,
            cadastro,
            lidos: { documentos: documentos.length, produtoresCadastrados: Object.keys(fornecedores).length },
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[dipam/painel]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a DIPAM: ${e.message}` });
    }
});

function divergenciaCadastro(condicao, painel) {
    const temMovimento = painel.dipam.notas > 0 || painel.funrural.notas.length > 0;
    const temCandidato = painel.pendencias.some((p) => p.codigo === 'fornecedor-indefinido');
    if (!condicao.adquireDeProdutor && temMovimento) {
        return {
            tipo: 'nao_marcado_mas_compra',
            mensagem: 'Este cliente NÃO está marcado como "adquire de produtor rural", mas há compra de produtor na competência.',
            acao: 'Marque em Dados Fiscais → Produtor rural / DIPAM para que a obrigação apareça todo mês, mesmo em mês sem nota.',
        };
    }
    if (!condicao.adquireDeProdutor && temCandidato) {
        return {
            tipo: 'candidato',
            mensagem: 'Há fornecedor de natureza indefinida que pode ser produtor rural.',
            acao: 'Confirme a natureza no CADESP e, se for produtor, marque o cliente em Dados Fiscais → Produtor rural / DIPAM.',
        };
    }
    if (condicao.adquireDeProdutor && !temMovimento) {
        return {
            tipo: 'marcado_sem_movimento',
            mensagem: 'Cliente marcado como comprador de produtor rural, mas sem nenhuma compra de produtor nesta competência.',
            acao: 'Confira se a captura do mês está completa antes de concluir que não houve compra.',
        };
    }
    return null;
}

// ─── Varredura da carteira ──────────────────────────────────────────────────

router.get('/varredura', requireAuth, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!ehCompetencia(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const db = getDb();

        const idsCarteira = await getEmpresaIdsDaCarteira(req.user); // null = admin (tudo)
        const empresas = new Map();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach((doc) => {
                const d = doc.data() || {};
                if (d._deleted || d._merged_into) return;
                if (idsCarteira && !idsCarteira.includes(doc.id)) return;
                empresas.set(doc.id, {
                    id: doc.id,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    cnpj: soDigitos(d.cnpj),
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                    condicao: lerCondicaoRural({ id: doc.id, ...d }),
                });
            });
        }

        // ── Fase 1: quem tem candidato a produtor rural no mês? (campos leves)
        const leves = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                .select('empresaId', 'direcao', 'status', 'emitente', 'valorTotal'),
            { label: `dipam varredura ${competencia}`, maxDocs: 80000 },
        );
        const candidatos = new Map();
        for (const s of leves) {
            const d = s.data() || {};
            if (d.direcao !== 'entrada') continue;
            if (!empresas.has(d.empresaId)) continue;
            const nat = identificarNaturezaFornecedor(d.emitente || {});
            const conta = nat.ehProdutorRuralPF || nat.confianca === 'indefinida';
            if (!conta) continue;
            const at = candidatos.get(d.empresaId) || { provaveis: 0, indefinidos: 0 };
            if (nat.ehProdutorRuralPF) at.provaveis += 1; else at.indefinidos += 1;
            candidatos.set(d.empresaId, at);
        }
        // Cliente MARCADO no cadastro entra na lista mesmo sem nota: mês sem
        // compra é uma informação (e pode ser falha de captura), não silêncio.
        for (const [id, e] of empresas) {
            if (e.condicao.adquireDeProdutor && !candidatos.has(id)) {
                candidatos.set(id, { provaveis: 0, indefinidos: 0 });
            }
        }

        // ── Fase 2: painel completo só dos candidatos ───────────────────────
        const LIMITE = 60;
        const ids = Array.from(candidatos.keys());
        const analisados = ids.slice(0, LIMITE);
        const linhas = [];
        for (const id of analisados) {
            const empresa = empresas.get(id);
            const documentos = await carregarDocumentos(db, id, competencia);
            const fornecedores = await carregarProdutoresRurais(documentosDaContraparte(documentos));
            const p = montarDipamCompetencia({
                documentos, competencia,
                empresa: { ...empresa.condicao, id, nome: empresa.nome, cnpj: empresa.cnpj },
                fornecedores,
            });
            linhas.push({
                empresaId: id, nome: empresa.nome, cnpj: empresa.cnpj, regime: empresa.regime,
                marcadoNoCadastro: empresa.condicao.adquireDeProdutor,
                dipamTotal: p.dipam.total,
                municipios: p.dipam.municipios.length,
                notasDipam: p.dipam.notas,
                funruralTotal: p.funrural.total,
                notasFunrural: p.funrural.notas.length,
                pendencias: p.pendencias.length,
                farol: p.farol,
            });
        }
        linhas.sort((a, b) => (b.pendencias - a.pendencias) || (b.dipamTotal - a.dipamTotal));

        return res.json({
            ok: true,
            competencia,
            escopo: idsCarteira ? 'carteira' : 'todas',
            linhas,
            // Nunca cortar em silêncio (regra do farol honesto, 30/07).
            total: ids.length,
            truncado: ids.length > analisados.length ? ids.length - analisados.length : 0,
            lidos: { documentosLeves: leves.length, empresas: empresas.size },
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[dipam/varredura]', e);
        return res.status(500).json({ ok: false, error: `Falha na varredura da DIPAM: ${e.message}` });
    }
});

// ─── Cadastro do produtor (fornecedor) ──────────────────────────────────────

router.get('/produtores', requireAuth, async (req, res) => {
    try {
        const db = getDb();
        const snap = await db.collection(COLECAO_PRODUTORES).limit(2000).get();
        const produtores = snap.docs
            .map((d) => ({ id: d.id, ...(d.data() || {}) }))
            .filter((p) => !p._deleted)
            .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
        return res.json({ ok: true, produtores, naturezas: NATUREZAS, regimesFunrural: REGIMES_FUNRURAL });
    } catch (e) {
        console.error('[dipam/produtores]', e);
        return res.status(500).json({ ok: false, error: `Falha ao ler os produtores: ${e.message}` });
    }
});

router.post('/produtor', requireAdmin, async (req, res) => {
    try {
        const { doc, ...dados } = req.body || {};
        const registro = await salvarProdutorRural(doc, dados, req.user);
        return res.json({ ok: true, produtor: registro });
    } catch (e) {
        if (e.code) return res.status(400).json({ ok: false, error: e.message });
        console.error('[dipam/produtor]', e);
        return res.status(500).json({ ok: false, error: `Falha ao gravar o produtor: ${e.message}` });
    }
});

export default router;
