// ============================================================================
// sefaz-backend/credito-acumulado-routes.js  (ESM)
// ----------------------------------------------------------------------------
// GET /api/admin/sped/credito-acumulado?de=AAAA-MM&ate=AAAA-MM
//
// F0 do e-CredAc: quantos clientes REALMENTE acumulam crédito de ICMS, e quem
// só parece acumular porque a saída não está chegando.
//
// Uma leitura por competência (campos mínimos + itens), agrupada em memória.
// A régua vive em credito-acumulado.js, puro e testado; aqui é só I/O.
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { fetchAllDocs } from './firestore-paginate.js';
import { montarPainelCreditoAcumulado } from './credito-acumulado.js';
import { modeloDoDoc } from './participante-doc-helper.js';

const router = Router();

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const COMPETENCIA = /^\d{4}-\d{2}$/;

/** Lista de competências entre `de` e `ate`, inclusive. Máx. 12 (teto de leitura). */
function competenciasEntre(de, ate) {
    const [a1, m1] = de.split('-').map(Number);
    const [a2, m2] = ate.split('-').map(Number);
    const out = [];
    let ano = a1; let mes = m1;
    while ((ano < a2 || (ano === a2 && mes <= m2)) && out.length < 12) {
        out.push(`${ano}-${String(mes).padStart(2, '0')}`);
        mes += 1;
        if (mes > 12) { mes = 1; ano += 1; }
    }
    return out;
}

router.get('/credito-acumulado', requireAdmin, async (req, res) => {
    try {
        const ate = String(req.query.ate || '').trim();
        const de = String(req.query.de || '').trim();
        if (!COMPETENCIA.test(de) || !COMPETENCIA.test(ate) || de > ate) {
            return res.status(400).json({ ok: false, error: 'Informe o período (de/ate no formato AAAA-MM), com `de` menor ou igual a `ate`.' });
        }
        const competencias = competenciasEntre(de, ate);
        const db = getDb();

        // Só LUCRO: optante do Simples não apura ICMS por conta gráfica.
        const empresas = [];
        const porCnpj = new Map();
        const snapEmp = await db.collection('lucro_empresas').get();
        snapEmp.forEach((doc) => {
            const d = doc.data() || {};
            if (d._deleted || d._merged_into) return;
            const cnpj = soDigitos(d.cnpj);
            if (cnpj.length !== 14) return;
            const linha = {
                empresaId: doc.id,
                nome: d.razaoSocial || d.nome || d.fantasia || '—',
                cnpj,
                regime: 'lucro',
                uf: d.dadosFiscais?.uf || d.uf || '',
            };
            empresas.push(linha);
            porCnpj.set(cnpj, linha);
        });

        const idsLucro = new Set(empresas.map((e) => e.empresaId));
        const porEmpresa = {};
        let lidos = 0;
        for (const competencia of competencias) {
            const snaps = await fetchAllDocs(
                db.collection('documentos_fiscais')
                    .where('competencia', '==', competencia)
                    .select('empresaId', 'empresaCnpj', 'direcao', 'status', 'chave', 'modelo', 'itens', 'totais.vICMS'),
                { label: `credito-acumulado ${competencia}`, maxDocs: 80000 },
            );
            lidos += snaps.length;
            for (const s of snaps) {
                const d = s.data() || {};
                // Só documentos de empresa do LUCRO: `empresaId` quando ela é
                // uma delas, senão o dono pelo CNPJ. Documento de optante do
                // Simples nem entra — ele não apura ICMS por conta gráfica.
                const alvo = (d.empresaId && idsLucro.has(d.empresaId))
                    ? d.empresaId
                    : porCnpj.get(soDigitos(d.empresaCnpj))?.empresaId;
                if (!alvo) continue;
                // `modelo` NÃO é campo gravado — a captura deriva da chave.
                // Ler d.modelo direto daria undefined pra TODA nota capturada
                // (foi o que manteve "emissão própria 0" em 198 clientes).
                const nota = { ...d, modelo: String(d.modelo || modeloDoDoc(d) || '') };
                porEmpresa[alvo] = porEmpresa[alvo] || {};
                porEmpresa[alvo][competencia] = porEmpresa[alvo][competencia] || [];
                porEmpresa[alvo][competencia].push(nota);
            }
        }

        const painel = montarPainelCreditoAcumulado(empresas, porEmpresa);
        return res.json({
            ok: true,
            periodo: { de, ate, competencias },
            lidos,
            ...painel,
            geradoEm: new Date().toISOString(),
        });
    } catch (e) {
        console.error('[sped/credito-acumulado]', e);
        return res.status(500).json({ ok: false, error: `Falha ao montar o painel: ${e.message}` });
    }
});

export default router;
