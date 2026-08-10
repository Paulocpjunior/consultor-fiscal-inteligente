// ============================================================================
// sefaz-backend/conferencia-chaves-routes.js  (ESM)
//
// CONFERÊNCIA POR CHAVES (CFI × SIEG):
//   POST /api/admin/sefaz/conferencia-chaves           — classifica presença
//   POST /api/admin/sefaz/conferencia-chaves-importar  — importa faltantes
//
// O colaborador cola o relatório da SIEG; o app diz QUAIS chaves faltam e
// importa só elas via consulta por chave (cert da própria empresa, pacing
// anti-656, aborta a raiz no primeiro 656 e devolve resultado parcial).
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { extrairChaves, classificarChaves } from './conferencia-chaves.js';
import { consultaNFePorChave } from './sefaz-client.js';
import { importarXmlSefaz } from './xml-importer.js';
import { loadCertEmpresa, loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { carregarFlagsEmpresa } from './empresa-flags.js';
import { podeAcessarCnpj } from './carteira-auth.js';

const router = express.Router();
const MAX_CHAVES_CONFERIR = 2000;
const MAX_CHAVES_IMPORTAR = 60;   // por chamada — consulta por chave é cara
const PACING_MS = 1500;           // anti-656 (mesmo webservice DistDFe)

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Busca em lotes de 30 ('in' do Firestore) quais chaves já existem.
async function buscarPresentes(db, chaves) {
    const presentes = new Map();
    for (let i = 0; i < chaves.length; i += 30) {
        const fatia = chaves.slice(i, i + 30);
        const snap = await db.collection('documentos_fiscais')
            .where('chave', 'in', fatia)
            .select('chave', 'schema', 'tipoDoc', 'direcao', 'empresaCnpj')
            .get();
        snap.forEach((d) => {
            const x = d.data() || {};
            if (x.chave) presentes.set(x.chave, x);
        });
    }
    return presentes;
}

// Localiza a empresa (id + uf) pelo CNPJ em simples/lucro.
async function acharEmpresaPorCnpj(db, cnpj) {
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).where('cnpj', '==', cnpj).limit(1).get();
        if (!snap.empty) return { empresaId: snap.docs[0].id, colecao: col };
        // fallback: cnpj formatado no doc
        const todos = await db.collection(col).get();
        for (const d of todos.docs) {
            if (String(d.data().cnpj || '').replace(/\D/g, '') === cnpj) {
                return { empresaId: d.id, colecao: col };
            }
        }
    }
    return null;
}

router.post('/conferencia-chaves', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
    try {
        const texto = req.body?.texto ?? '';
        const chavesInput = Array.isArray(req.body?.chaves) ? req.body.chaves.join('\n') : '';
        const chaves = extrairChaves(`${texto}\n${chavesInput}`).slice(0, MAX_CHAVES_CONFERIR);
        if (chaves.length === 0) {
            return res.status(400).json({ error: 'Nenhuma chave de 44 dígitos encontrada no texto colado.' });
        }
        const db = fa().firestore();
        const presentes = await buscarPresentes(db, chaves);
        const r = classificarChaves(chaves, presentes);
        return res.json({ ...r, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[conferencia-chaves]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

router.post('/conferencia-chaves-importar', requireAuth, express.json({ limit: '1mb' }), async (req, res) => {
    try {
        const cnpjDest = String(req.body?.cnpjDestinatario || '').replace(/\D/g, '');
        if (cnpjDest.length !== 14) {
            return res.status(400).json({ error: 'cnpjDestinatario (14 dígitos) é obrigatório — a empresa dona das notas (destinatária).' });
        }
        // TRAVA DE CARTEIRA (auditoria de segurança, 10/08): esta rota carrega o
        // A1 da empresa-alvo e dispara consulta à SEFAZ em nome dela — sem o
        // check, um colaborador fora da carteira queimava a cota anti-656 da
        // raiz de outra empresa e escrevia documentos na base dela. Admin passa.
        const acessoDest = await podeAcessarCnpj(req.user, cnpjDest);
        if (!acessoDest.ok) return res.status(acessoDest.status).json({ error: acessoDest.error });
        const chaves = extrairChaves((req.body?.chaves || []).join('\n')).slice(0, MAX_CHAVES_IMPORTAR);
        if (chaves.length === 0) return res.status(400).json({ error: 'Nenhuma chave válida para importar.' });

        const db = fa().firestore();
        const emp = await acharEmpresaPorCnpj(db, cnpjDest);
        if (!emp) {
            return res.status(404).json({ error: `Empresa ${cnpjDest} não encontrada no cadastro (Simples/Lucro).` });
        }
        const { uf } = await carregarFlagsEmpresa(emp.empresaId, cnpjDest);
        if (!uf) return res.status(400).json({ error: 'UF não cadastrada para a empresa — preencha em Completar cadastro.' });

        // Cert da própria empresa (ou da mesma raiz) — consulta por chave é
        // do DESTINATÁRIO; cert do escritório não autoriza CNPJ de outra raiz.
        let cert = null;
        try { cert = await loadCertEmpresa(emp.empresaId); } catch { /* tenta raiz */ }
        if (!cert) {
            try { cert = await loadCertEmpresaPorCnpjBase(cnpjDest, emp.empresaId); } catch { /* sem cert */ }
        }
        if (!cert) {
            return res.status(400).json({ error: 'Empresa sem certificado A1 próprio/mesma raiz — a consulta por chave exige o cert do destinatário.' });
        }

        const resultados = [];
        let importados = 0, resumos = 0, erros = 0, abortou656 = false;
        for (const chave of chaves) {
            try {
                const r = await consultaNFePorChave({ chave, cnpjInteressado: cnpjDest, uf, certOverride: cert });
                if (r.rateLimited) {
                    abortou656 = true;
                    resultados.push({ chave, status: 'abortado-656' });
                    break; // 656 na raiz — parar aqui; o resto fica pra próxima rodada
                }
                let statusChave = 'nao-retornada';
                for (const x of r.xmls || []) {
                    if (!x.xml) continue;
                    const imp = await importarXmlSefaz({
                        empresaId: emp.empresaId, empresaCnpj: cnpjDest,
                        xml: x.xml, schema: x.schema, nsu: x.nsu,
                        capturadoPor: { uid: req.user.uid, email: req.user.email, fonte: 'conferencia-chaves' },
                    });
                    if (imp.status === 'ok' || imp.status === 'atualizado') {
                        statusChave = 'importada';
                        importados++;
                        if (imp.tipoDoc === 'resNFe') {
                            resumos++;
                            statusChave = 'importada-resumo';
                            // Ciência em background: libera a completa no próximo ciclo.
                            setImmediate(async () => {
                                try {
                                    const { manifestarUma } = await import('./manifesto-orchestrator.js');
                                    await manifestarUma({
                                        chNFe: chave, cnpjDestinatario: cnpjDest, tipo: 'ciencia',
                                        empresaId: emp.empresaId, uf, skipRedownload: true,
                                        capturadoPor: { uid: req.user.uid, email: req.user.email },
                                    });
                                } catch (e) { console.warn('[conferencia-importar] ciência falhou:', e.message); }
                            });
                        }
                    } else if (imp.status === 'duplicado' && statusChave === 'nao-retornada') {
                        statusChave = 'ja-existia';
                    }
                }
                resultados.push({ chave, status: statusChave, cStat: r.cStat || null });
                if (statusChave === 'nao-retornada') erros++;
            } catch (e) {
                erros++;
                resultados.push({ chave, status: 'erro', motivo: String(e.message || '').slice(0, 200) });
            }
            await sleep(PACING_MS);
        }

        return res.json({
            ok: !abortou656,
            abortou656,
            processadas: resultados.length,
            importados, resumos, erros,
            restantes: chaves.length - resultados.length,
            resultados,
            aviso: abortou656
                ? 'SEFAZ pediu pausa (cStat 656) — o restante fica para a próxima rodada (aguarde ~1h).'
                : (resumos > 0 ? `${resumos} vieram como resumo — Ciência disparada; a completa chega no próximo ciclo.` : null),
        });
    } catch (e) {
        console.error('[conferencia-chaves-importar]', e);
        return res.status(500).json({ error: 'Falha interna: ' + (e.message || 'desconhecida') });
    }
});

export default router;
