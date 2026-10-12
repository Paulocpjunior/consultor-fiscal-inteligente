// ============================================================================
// sefaz-backend/dp-darf-nao-pago-cron.js  (ESM — cron do alerta de DARF do DP)
// ----------------------------------------------------------------------------
// POST /api/admin/sefaz/dp-darf-nao-pago-cron  (Cloud Scheduler, x-cron-secret)
//
// Lê os DARF que o Consultor DP emitiu pelo túnel (dp_dctfweb_log), consulta na
// Receita (PAGTOWEB/PAGAMENTOS71) os que já venceram e grava a situação em
// dp_darf_situacao/{cnpj}_{competência}: 'pago', 'aguardando' (dentro da
// carência) ou 'nao_localizado' (o alerta). As regras estão em
// dp-darf-nao-pago.js. Falha do SERPRO (ou modo simulado) não muda a situação:
// grava só o erro. Log e heartbeat em dp_darf_cron_logs.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { withCronHeartbeat } from './cron-heartbeat.js';
import { secretsMatch } from './cron-secret.js';
import { hojeBrt } from './data-brt.js';
import { invokeIntegraContador, getSerproConfig } from './serpro-client.js';
import { SERVICO_PAGAMENTOS, montarFiltroPagamentos, lerRetornoPagamentos } from './dp-pagamentos.js';
import {
    alvosDosLogs, precisaConsultar, passouCarencia, filtroPorPeriodo, classificar, documentoSituacao,
    JANELA_DO_LOG_DIAS, MAX_CONSULTAS_POR_EXECUCAO,
} from './dp-darf-nao-pago.js';

const router = express.Router();

function db() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

function requireCronAuth(req, res, next) {
    const secret = process.env.SEFAZ_CRON_SECRET;
    if (!secret) {
        console.error('[dp-darf-nao-pago-cron] SEFAZ_CRON_SECRET não configurado');
        return res.status(500).json({ error: 'Cron secret not configured' });
    }
    const headerSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'];
    if (secretsMatch(headerSecret, secret)) return next();
    console.warn(`[dp-darf-nao-pago-cron] 403 — job=${req.headers['x-cloudscheduler-jobname'] || '(sem header)'} ip=${req.ip}`);
    return res.status(403).json({ error: 'Cron auth failed' });
}

async function consultar(cnpj, filtroPedido, dryRun) {
    const filtro = montarFiltroPagamentos(filtroPedido);
    if (filtro.erro) return { ok: false, error: filtro.erro };
    const r = await invokeIntegraContador({ ...SERVICO_PAGAMENTOS, contribuinteCnpj: cnpj, dados: filtro.dados });
    return lerRetornoPagamentos(r, { numerosDocumento: filtro.numerosDocumento, tamanhoDaPagina: filtro.dados.tamanhoDaPagina, dryRun });
}

/** Uma rodada: devolve o resumo gravado no log. */
export async function rodarDarfNaoPago({ hoje = hojeBrt(), firestore = db() } = {}) {
    const desde = new Date(Date.now() - JANELA_DO_LOG_DIAS * 86_400_000);
    const snap = await firestore.collection('dp_dctfweb_log').where('em', '>=', desde).get();
    const alvos = alvosDosLogs(snap.docs.map((d) => d.data()));
    const dryRun = !!getSerproConfig().dryRun;
    const resumo = { hoje, alvos: alvos.length, consultados: 0, pagos: 0, aguardando: 0, naoLocalizados: 0, erros: 0, adiados: 0, dryRun };

    for (const alvo of alvos) {
        const ref = firestore.collection('dp_darf_situacao').doc(alvo.id);
        const atualSnap = await ref.get();
        const atual = atualSnap.exists ? atualSnap.data() : null;
        if (!precisaConsultar(alvo, atual, hoje).consultar) continue;
        if (resumo.consultados >= MAX_CONSULTAS_POR_EXECUCAO) { resumo.adiados += 1; continue; }
        resumo.consultados += 1;
        try {
            const porNumero = await consultar(alvo.cnpj, { numerosDocumento: alvo.numerosDocumento }, dryRun);
            if (!porNumero.ok) throw new Error(porNumero.error);
            let porPeriodo = null;
            const localizado = porNumero.situacoes.some((s) => s.localizado);
            if (!localizado && passouCarencia(alvo, hoje)) {
                porPeriodo = await consultar(alvo.cnpj, filtroPorPeriodo(alvo, hoje), dryRun);
                if (!porPeriodo.ok) throw new Error(porPeriodo.error);
            }
            const resultado = classificar(alvo, porNumero, porPeriodo, hoje);
            await ref.set({ ...documentoSituacao(alvo, resultado, hoje, atual), atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
            if (resultado.situacao === 'pago') resumo.pagos += 1;
            else if (resultado.situacao === 'nao_localizado') resumo.naoLocalizados += 1;
            else resumo.aguardando += 1;
        } catch (err) {
            resumo.erros += 1;
            console.warn(`[dp-darf-nao-pago-cron] ${alvo.id}: ${err.message}`);
            // Sem a resposta da Receita, a situação anterior fica; só o erro é registrado.
            await ref.set({
                cnpj: alvo.cnpj, competencia: alvo.competencia, empresaIdDp: alvo.empresaIdDp ?? null, numerosDocumento: alvo.numerosDocumento,
                vencimento: alvo.vencimento, valor: alvo.valor ?? null, situacao: atual?.situacao ?? 'aguardando',
                erro: String(err.message || err).slice(0, 300), erroEm: hoje, atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true }).catch(() => {});
        }
    }
    return resumo;
}

// 💓 heartbeat antes do trabalho; o resumo vai para o log com status 'sucesso'.
router.post('/dp-darf-nao-pago-cron', requireCronAuth, async (req, res) => {
    const fonte = req.headers?.['x-cloudscheduler-jobname'] || 'dp-darf-nao-pago-cron';
    await withCronHeartbeat({ collection: 'dp_darf_cron_logs', fonte, res }, () => rodarDarfNaoPago());
});

export default router;
