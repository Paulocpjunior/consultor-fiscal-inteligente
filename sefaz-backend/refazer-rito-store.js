// ============================================================================
// sefaz-backend/refazer-rito-store.js  (casca de I/O)
// ----------------------------------------------------------------------------
// ♻️ Executa o refazer do rito. A RÉGUA (o que é refazível, o patch com
// histórico, a frase) mora no módulo PURO `refazer-rito-envio.js`; aqui só o
// I/O — e ele chama os DONOS do arquivamento e da baixa, nunca uma cópia
// deles.
// ============================================================================

import admin from 'firebase-admin';
import { normalizarCompetencia } from './competencia.js';
import { arquivarGuiaNoSharePoint, darBaixaDaObrigacao, resolverEmpresa } from './envio-imposto.js';
import { oQueRefazer, patchDoRefazer, textoDoRefazer } from './refazer-rito-envio.js';

export const COLECAO_ENVIOS = 'impostos_enviados';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/**
 * O PDF da guia, recuperado da coleção que o EMITIU.
 *
 * ⚠️ O registro do envio guarda só `anexouPdf` (booleano) — o arquivo nunca
 * ficou lá. Quem tem o PDF é a coleção da guia, e hoje isso vale para o **DAS**
 * (`das_emitidos.pdfBase64`).
 *
 * Para os outros tipos ele devolve `null`, e isso sai DITO: DARF e DARE são
 * emitidos no ato do envio e o app não guarda o arquivo. Fingir que dá
 * produziria um "refeito" que não arquivou nada.
 */
export async function recuperarPdfDaGuia(db, envio) {
    const tipo = String(envio?.tipo || '').trim().toUpperCase();
    if (tipo !== 'DAS') return { pdf: null, motivo: `O app não guarda o PDF de ${tipo || 'guia'} depois do envio.` };
    const comp = normalizarCompetencia(envio?.competencia);
    const cnpj = soDigitos(envio?.empresaCnpj);
    if (!comp || !cnpj) return { pdf: null, motivo: 'Envio sem CNPJ ou competência legível.' };
    try {
        const snap = await db.collection('das_emitidos').where('competencia', '==', comp).get();
        for (const d of snap.docs) {
            const dd = d.data() || {};
            if (soDigitos(dd.empresaCnpj || dd.cnpj) !== cnpj) continue;
            if (dd.pdfBase64) return { pdf: dd.pdfBase64, motivo: null };
        }
        return { pdf: null, motivo: 'O DAS desta competência não tem PDF guardado.' };
    } catch (e) {
        // Falha de leitura NÃO vira "não tem PDF": são fatos diferentes, e o
        // segundo faria alguém reemitir a guia à toa.
        return { pdf: null, motivo: `Não consegui ler o DAS desta competência: ${e.message}` };
    }
}

/**
 * Refaz o rito de UM envio.
 *
 * @param {object} p
 * @param {string} p.logId    doc de `impostos_enviados`
 * @param {string} [p.quem]   e-mail/uid de quem clicou
 * @param {string} [p.pdfBase64] PDF fornecido pela tela (vence a recuperação)
 */
export async function refazerRitoDoEnvio({ logId, quem = null, pdfBase64 = null }) {
    const db = getDb();
    const ref = db.collection(COLECAO_ENVIOS).doc(String(logId));
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, erro: 'Envio não encontrado.' };
    const envio = { id: snap.id, ...(snap.data() || {}) };

    const alvo = oQueRefazer(envio);
    if (alvo.nada) {
        return { ok: true, refeito: false, envio, texto: alvo.motivos.join(' ') || 'Nada a refazer neste envio.' };
    }

    const empresa = await resolverEmpresa(db, {
        empresaId: envio.empresaId, empresaCnpj: envio.empresaCnpj,
    });

    let sharePoint = null;
    let pdfIndisponivel = null;
    if (alvo.sharePoint) {
        let pdf = pdfBase64 || null;
        if (!pdf) {
            const r = await recuperarPdfDaGuia(db, envio);
            pdf = r.pdf;
            if (!pdf) pdfIndisponivel = r.motivo;
        }
        // ⚠️ SEM PDF NÃO SE TENTA — e não se marca nada. Gravar `erro` aqui
        // apagaria o `sem-config`, que é a causa REAL e a que tem conserto.
        if (pdf) {
            sharePoint = await arquivarGuiaNoSharePoint({
                empresa, pdf,
                competencia: envio.competencia, tipo: envio.tipo,
                empresaCnpj: envio.empresaCnpj, pdfFileName: envio.pdfFileName,
            });
        }
    }

    let baixa = null;
    if (alvo.baixa) {
        baixa = await darBaixaDaObrigacao(db, {
            empresa,
            empresaId: envio.empresaId, empresaCnpj: envio.empresaCnpj,
            tipo: envio.tipo, competencia: envio.competencia,
            canal: envio.canal || null,
            // O carimbo da baixa fica com quem REFEZ, não com quem enviou —
            // são pessoas e momentos diferentes.
            enviadoPor: quem || 'refazer-rito',
        });
    }

    const patch = patchDoRefazer({
        envio, sharePoint, baixa, quem, agoraIso: new Date().toISOString(),
    });
    if (patch) await ref.set(patch, { merge: true });

    const resultado = { sharePoint, baixa, pdfIndisponivel };
    return {
        ok: true,
        refeito: !!patch,
        ...resultado,
        envio: { ...envio, ...(patch || {}) },
        texto: textoDoRefazer(resultado),
    };
}
