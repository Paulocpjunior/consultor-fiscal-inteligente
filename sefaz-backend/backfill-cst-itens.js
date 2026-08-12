// ============================================================================
// sefaz-backend/backfill-cst-itens.js
//
// REPROCESSA o XML já capturado (do Cloud Storage) para gravar campos de ITEM
// que o importer não lia na época da captura.
//
// POR QUE EXISTE. Duas vezes o mesmo defeito: o CST do IPI (#563) e o CST de
// PIS/COFINS (#586) SEMPRE estiveram no XML — o importer é que só lia valor e
// alíquota. Quem já estava capturado ficou sem o campo, e sem ele:
//   · o E510 não fecha (consolidação por CFOP+CST_IPI);
//   · a base de crédito de PIS/COFINS não pode ser derivada, e a apuração vira
//     planilha (caso WALDESA — docs/achados-apuracao-piscofins-planilha.md).
//
// ⚠️ PREMISSA CORRIGIDA EM 12/08: o CLAUDE.md dizia que o doc guarda só o
// `xmlHash` e que backfill exigiria RECAPTURAR da SEFAZ. Errado — a captura faz
// `bucket.file(storagePath).save(xml)` e grava `storagePath` no documento. O XML
// CRU ESTÁ LÁ. Este módulo lê de lá: não toca na SEFAZ, não pede nada ao
// cliente, não consome NSU.
//
// ─── AS TRÊS REGRAS QUE ELE NÃO QUEBRA ──────────────────────────────────────
//
// 1. **SÓ PREENCHE O QUE FALTA.** Nunca sobrescreve valor já gravado. Se o item
//    já tem `cstPis`, ele fica como está — reprocessar não pode reescrever
//    histórico fiscal, só completá-lo.
// 2. **AUSÊNCIA CONTINUA AUSÊNCIA.** Item cujo XML não traz o bloco de PIS não
//    recebe `''` nem `'0'`: continua sem o campo. Campo fiscal não recebe
//    default (a regra que o Bloco H zerado ensinou).
// 3. **XML QUE NÃO ABRE NÃO VIRA DOC ZERADO.** Sem `storagePath`, arquivo
//    ausente ou XML ilegível ⇒ o documento fica INTACTO e entra num contador
//    nomeado. Silêncio aqui produziria livro a menor.
// ============================================================================

import admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
import { extrairItens } from './xml-importer.js';

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'consultorfiscalapp';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${PROJECT_ID}.firebasestorage.app`;
const storage = new Storage();

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

/** Campos de item que este backfill sabe completar. */
export const CAMPOS_BACKFILL = ['cstPis', 'vBcPis', 'cstCofins', 'vBcCofins', 'cstIpi', 'cEnqIpi', 'vBcIpi'];

const vazio = (v) => v === undefined || v === null || v === '';

/**
 * Decide o que gravar — PURA, e é aqui que mora a regra.
 *
 * Casa os itens pelo `nItem` (a posição do array pode ter mudado se o importer
 * de então filtrava algum item). Item do XML sem correspondente no doc é
 * IGNORADO: acrescentar item mudaria o documento, não completaria.
 *
 * @returns {{itens:Array|null, camposPreenchidos:number}} itens=null ⇒ nada a fazer
 */
export function mesclarItensReprocessados(itensAtuais, itensDoXml) {
    if (!Array.isArray(itensAtuais) || !itensAtuais.length) return { itens: null, camposPreenchidos: 0 };
    if (!Array.isArray(itensDoXml) || !itensDoXml.length) return { itens: null, camposPreenchidos: 0 };

    const porNItem = new Map();
    for (const it of itensDoXml) {
        const k = String(it?.nItem ?? '').trim();
        if (k) porNItem.set(k, it);
    }

    let camposPreenchidos = 0;
    const saida = itensAtuais.map((item, idx) => {
        const novo = porNItem.get(String(item?.nItem ?? '').trim())
            // Sem nItem gravado (doc antigo), cai na posição — é o melhor que
            // dá, e só completa campo vazio, então o risco é preencher nada.
            || itensDoXml[idx];
        if (!novo) return item;

        const patch = {};
        for (const campo of CAMPOS_BACKFILL) {
            // REGRA 1: só preenche o que falta. REGRA 2: ausência continua ausência.
            if (vazio(item[campo]) && !vazio(novo[campo])) {
                patch[campo] = novo[campo];
                camposPreenchidos++;
            }
        }
        return Object.keys(patch).length ? { ...item, ...patch } : item;
    });

    return camposPreenchidos ? { itens: saida, camposPreenchidos } : { itens: null, camposPreenchidos: 0 };
}

async function lerXmlDoStorage(storagePath) {
    if (!storagePath) return null;
    try {
        const [buf] = await storage.bucket(STORAGE_BUCKET).file(storagePath).download();
        return buf.toString('utf8');
    } catch {
        return null;
    }
}

/**
 * Reprocessa os documentos de uma empresa × competências.
 *
 * Idempotente: rodar de novo não muda nada depois da primeira passada, porque
 * a mesclagem só toca campo vazio.
 *
 * @param {{empresaId?:string, competencias?:string[], maxDocs?:number}} p
 */
export async function reprocessarCstDosItens({ empresaId = null, competencias = [], maxDocs = 5000 } = {}) {
    const db = fa().firestore();
    const alvos = competencias.length ? competencias : [new Date().toISOString().slice(0, 7)];

    const log = {
        empresaId, competencias: alvos,
        examinados: 0,
        atualizados: 0,
        camposPreenchidos: 0,
        semStoragePath: 0,   // documento sem caminho gravado (captura antiga)
        xmlNaoLido: 0,       // caminho existe e o arquivo não abriu
        semItens: 0,         // NFS-e/CT-e e afins — não têm itens de mercadoria
        jaCompletos: 0,
        erros: [],
    };

    for (const competencia of alvos) {
        let q = db.collection('documentos_fiscais').where('competencia', '==', competencia);
        if (empresaId) q = q.where('empresaId', '==', empresaId);
        let snap;
        try {
            snap = await q.limit(maxDocs).get();
        } catch (e) {
            log.erros.push(`leitura ${competencia}: ${e.message}`);
            continue;
        }

        for (const docSnap of snap.docs) {
            log.examinados++;
            const d = docSnap.data() || {};
            if (!Array.isArray(d.itens) || !d.itens.length) { log.semItens++; continue; }

            // Já completo? Não baixa o XML à toa — o Storage cobra por leitura.
            const faltaAlgo = d.itens.some((it) => CAMPOS_BACKFILL.some((c) => vazio(it?.[c])));
            if (!faltaAlgo) { log.jaCompletos++; continue; }

            if (!d.storagePath) { log.semStoragePath++; continue; }
            const xml = await lerXmlDoStorage(d.storagePath);
            if (!xml) { log.xmlNaoLido++; continue; }

            let itensDoXml;
            try {
                itensDoXml = extrairItens(xml);
            } catch (e) {
                log.xmlNaoLido++;
                log.erros.push(`parse ${docSnap.id}: ${e.message}`);
                continue;
            }

            const { itens, camposPreenchidos } = mesclarItensReprocessados(d.itens, itensDoXml);
            if (!itens) continue;

            try {
                await docSnap.ref.update({
                    itens,
                    cstBackfillEm: fa().firestore.FieldValue.serverTimestamp(),
                    cstBackfillCampos: camposPreenchidos,
                });
                log.atualizados++;
                log.camposPreenchidos += camposPreenchidos;
            } catch (e) {
                log.erros.push(`update ${docSnap.id}: ${e.message}`);
            }
        }
    }

    // Farol honesto: documento que não deu pra reprocessar NÃO some do relatório.
    // É ele que explica por que a base derivada pode continuar com "indefinido".
    log.naoReprocessados = log.semStoragePath + log.xmlNaoLido;
    return log;
}
