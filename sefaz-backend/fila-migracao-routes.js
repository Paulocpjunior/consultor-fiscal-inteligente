// ============================================================================
// sefaz-backend/fila-migracao-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/sped/fila-migracao?competencia=AAAA-MM
//
// QUEM PODE MIGRAR HOJE (Paulo, 07/08: "precisamos acelerar"). A resposta já
// existia espalhada em três telas — prova de captura, aptidão da saída e 🚦
// Migração — e ninguém abre três abas vezes 388 clientes.
//
// Aqui as três fontes viram UMA fila. Nenhuma conta nova: a régua de cada
// pedaço continua no núcleo dela (vereditoDoCnpj, montarAptidaoSaida,
// montarProntidaoMigracao) e a junção vive em fila-migracao.js, puro. Painel
// com conta própria diverge sozinho — é a lição do card 4.
//
// Leituras: uma por FONTE, agrupadas em memória. Nada por empresa.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarFilaMigracao } from './fila-migracao.js';
import { vereditoDoCnpj, ehResumo } from './prova-captura.js';
import { montarAptidaoSaida } from './aptidao-saida.js';
import { montarProntidaoMigracao } from './migracao-prontidao.js';
import { selecionarCertA1PorBase } from './cert-base-helper.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const CANCELADOS = new Set(['cancelado', 'cancelada', 'denegado', 'inutilizado']);

/** Empresas monitoradas (Simples + Lucro). Pula lápide e fundidas. */
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
                uf: df.uf || d.uf || '',
                capturarSefaz: d.capturarSefaz !== false,
                inscricaoEstadual: df.inscricaoEstadual || d.inscricaoEstadual || '',
                industriaCadastro: df.indAtividade === 'industrial' || df.naturezaAtividade === 'industria',
            });
        });
    }
    return out;
}

/**
 * Motivos de bloqueio da captura NFe, pela régua canônica da RAIZ (#315):
 * filial sem certificado usa o A1 válido da matriz. Sem isso, toda filial
 * apareceria como "sem certificado" e a fila mandaria cobrar o que já existe.
 */
async function marcarBloqueiosDeCertificado(db, empresas, agoraMs) {
    const certsMeta = [];
    const porEmpresaId = new Map();
    const snap = await db.collection('empresas_certificados').get();
    snap.forEach((doc) => {
        const d = doc.data() || {};
        const meta = {
            empresaId: doc.id,
            tipoCert: d.tipoCert || 'A1',
            cnpj: soDigitos(d.cnpj),
            cnpjCert: soDigitos(d.cnpj),
            notAfter: d.notAfter || null,
        };
        certsMeta.push(meta);
        porEmpresaId.set(doc.id, meta);
    });

    for (const e of empresas) {
        const proprio = porEmpresaId.get(e.id);
        const proprioValido = !!proprio
            && (proprio.tipoCert === 'A3' || (proprio.notAfter && new Date(proprio.notAfter).getTime() > agoraMs));
        const daRaiz = proprioValido ? null : selecionarCertA1PorBase(certsMeta, e.cnpj, agoraMs, e.id);
        e.motivosBloqueio = [];
        if (!proprioValido && !daRaiz) {
            e.motivosBloqueio.push('sem certificado A1 próprio nem da mesma raiz (a SEFAZ não é consultada sem certificado)');
        }
        if (!e.uf) e.motivosBloqueio.push('UF não cadastrada nos dados fiscais');
    }
}

router.get('/fila-migracao', requireAdmin, async (req, res) => {
    try {
        const competencia = String(req.query.competencia || '').trim();
        if (!/^\d{4}-\d{2}$/.test(competencia)) {
            return res.status(400).json({ ok: false, error: 'Informe a competência no formato AAAA-MM.' });
        }
        const db = getDb();
        const agoraMs = Date.now();

        const empresas = await carregarEmpresas(db);
        await marcarBloqueiosDeCertificado(db, empresas, agoraMs);

        // ── 1. cursor do DistDFe por CNPJ (a prova contra a SEFAZ) ──────────
        const states = new Map();
        const stSnap = await db.collection('sefaz_state').get();
        stSnap.forEach((doc) => {
            const d = doc.data() || {};
            states.set(soDigitos(doc.id), {
                ultNSU: d.ultNSU ?? null,
                maxNSU: d.maxNSUUltimaSync ?? d.maxNSU ?? null,
                pendenciaNSU: d.pendenciaNSU ?? null,
                nsuTravado: d.nsuTravado || null,
                ultimaSyncMs: d.ultimaSync?.toMillis?.() ?? null,
            });
        });

        // ── 2. documentos da competência (prontidão + contagem de resumos) ──
        const docSnaps = await fetchAllDocs(
            db.collection('documentos_fiscais')
                .where('competencia', '==', competencia)
                .select('empresaId', 'empresaCnpj', 'direcao', 'tpNF', 'status', 'modelo', 'tipoDoc',
                    'totais.vST', 'totais.vBCST', 'totais.vIPI',
                    'emitente.cnpjCpf', 'emitente.uf', 'cnpjEmit', 'ufEmit',
                    'chave', 'codMunEmit', 'itens', 'schema', 'temItens'),
            { label: `fila-migracao ${competencia}`, maxDocs: 80000 },
        );
        const docs = docSnaps.map((s) => ({ ...s.data() }));

        // Resumo sem completa entra na apuração A MENOR — e migrar com o livro
        // a menor leva o erro junto. Conta POR CNPJ, na competência olhada (a
        // tela diz qual é: não é a vida inteira do cliente).
        const docsPorCnpj = new Map();
        for (const d of docs) {
            const c = soDigitos(d.empresaCnpj || d.cnpjEmit);
            if (!c) continue;
            const acc = docsPorCnpj.get(c) || { total: 0, resumosSemCompleta: 0 };
            acc.total += 1;
            if (!CANCELADOS.has(String(d.status || '').toLowerCase()) && ehResumo(d)) acc.resumosSemCompleta += 1;
            docsPorCnpj.set(c, acc);
        }

        const vereditos = new Map();
        for (const e of empresas) {
            vereditos.set(e.id, vereditoDoCnpj({
                cadastro: e,
                state: states.get(e.cnpj) || null,
                docs: docsPorCnpj.get(e.cnpj) || { total: 0, resumosSemCompleta: 0 },
            }, agoraMs));
        }

        // ── 3. aptidão da saída (autXML/cofre — a prova de QUALQUER data) ───
        const saidaSnaps = await fetchAllDocs(
            db.collection('documentos_fiscais').where('direcao', '==', 'saida'),
            { label: 'fila-migracao saida' },
        );
        const docsSaida = saidaSnaps.map((s) => {
            const x = s.data() || {};
            return {
                empresaCnpj: x.empresaCnpj || x.cnpjEmit,
                chave: x.chave,
                dhEmi: x.dhEmi,
                createdAt: x.createdAt || null,
                origem: x.origem || null,
                fonte: x.capturadoPor?.fonte || null,
                autXml: Array.isArray(x.autXml) ? x.autXml : null,
                autXmlEscritorio: x.autXmlEscritorio === true,
            };
        });
        const aptidao = montarAptidaoSaida({
            empresas: empresas.map((e) => ({ empresaId: e.id, cnpj: e.cnpj, nome: e.nome })),
            docsSaida,
            agoraMs,
            cnpjEscritorio: process.env.CNPJ_ESCRITORIO || '44388152000189',
        });
        const aptidoes = new Map(aptidao.linhas.map((l) => [l.empresaId, l]));

        // ── 4. blocos do SPED que o perfil exige ────────────────────────────
        const prontidao = montarProntidaoMigracao(docs, empresas);
        const prontidoes = new Map(prontidao.linhas.map((l) => [l.empresaId, l]));

        const fila = montarFilaMigracao({ empresas, vereditos, aptidoes, prontidoes });

        return res.json({
            ok: true,
            competencia,
            ...fila,
            // Farol honesto: a conta de resumos é DA COMPETÊNCIA olhada, não da
            // vida inteira do cliente. Dizer isso evita que "pronta" seja lida
            // como "conferida desde sempre".
            ressalvas: [
                `Resumos sem a completa foram contados na competência ${competencia} — outra competência pode ter mais.`,
                'A prova da SEFAZ é o cursor do DistDFe (ultNSU × maxNSU). O DistDFe entrega ~90 dias e a partir do 1º acesso: histórico anterior só por importação.',
                'Saída não vem ao emitente pela SEFAZ (Rejeição 641) — por isso a aptidão da saída é medida pelo autXML/cofre, não pelo volume capturado.',
                ...(aptidao.ressalvas || []),
            ],
            lidos: { documentosCompetencia: docs.length, saidas: docsSaida.length, empresas: empresas.length },
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[sped/fila-migracao]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar a fila: ${e.message}` });
    }
});

export default router;
