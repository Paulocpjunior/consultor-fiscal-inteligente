// ============================================================================
// sefaz-backend/nfse-nacional-dfe-importer.js
// ----------------------------------------------------------------------------
// Importa um DF-e da NFSe Nacional pra o Firestore.
//
// Tipos de DF-e:
//   - NFSe   (documento de prestação)
//   - Evento (cancelamento, substituição, etc — vinculado a uma chave NFSe)
//
// Estratégia v1: parse defensivo dos campos principais via regex (idêntico
// ao xml-importer.js do SEFAZ); o XML completo fica gravado pra eventual
// reprocessamento quando o parser fino estiver pronto.
//
// Persistência:
//   documentos_fiscais/{chaveAcesso}
//     - tipo: 'nfseNacional'   (≠ de 'NFe', 'CTe', 'eventoNFe')
//     - empresaId, empresaCnpj
//     - chave (50 chars), nsu, schema, dataEmissao
//     - prestador, tomador, valorServico, valorIss, codigoMunicipio
//     - storagePath (XML bruto)
//     - capturadoPor, capturadoEm
// ============================================================================

import admin from 'firebase-admin';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const COLLECTION = 'documentos_fiscais';
const STORAGE_PREFIX = 'nfse-nacional';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function sha256(text) {
    return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function pickTag(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? m[1].trim() : null;
}

function pickAttr(xml, tag, attr) {
    const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}="([^"]+)"`, 'i'));
    return m ? m[1] : null;
}

function decompressIfNeeded(content, isGzipBase64) {
    if (!isGzipBase64) return content;
    try {
        const buf = Buffer.from(content, 'base64');
        return zlib.gunzipSync(buf).toString('utf-8');
    } catch (e) {
        throw new Error(`falha descomprimindo gzip+base64: ${e.message}`);
    }
}

/**
 * Identifica se o XML é NFSe ou Evento.
 * NFSe Nacional v1 tem <NFSe> ou <DFe><infNFSe>...
 * Eventos têm <evento> ou <eventoNFSe>
 */
function classificarDfe(xml) {
    if (/<eventoNFSe|<evento[^>]/i.test(xml)) return 'evento';
    if (/<NFSe|<infNFSe/i.test(xml)) return 'nfseNacional';
    return 'desconhecido';
}

/**
 * Extrai metadados principais — defensivo.
 * Os nomes de tag aqui são os do padrão nacional NFS-e (leiaute oficial).
 */
function extrairMetadadosNfse(xml) {
    const chave = pickAttr(xml, 'infNFSe', 'Id')?.replace(/^NFSe/i, '') || pickTag(xml, 'chaveAcesso');
    const numero = pickTag(xml, 'nNFSe') || pickTag(xml, 'numero');
    const dataEmissao = pickTag(xml, 'dhEmi') || pickTag(xml, 'dataEmissao');
    const codMunicipio = pickTag(xml, 'cMunIncidencia') || pickTag(xml, 'cMun') || pickTag(xml, 'codigoMunicipio');

    // Prestador
    const prestadorCnpj = (xml.match(/<CNPJEmit>([\d]+)<\/CNPJEmit>/i) || [])[1]
        || (xml.match(/<prest[\s\S]*?<CNPJ>([\d]+)<\/CNPJ>/i) || [])[1];
    const prestadorIM = pickTag(xml, 'IM');

    // Tomador
    const tomadorCnpj = (xml.match(/<tomad[\s\S]*?<CNPJ>([\d]+)<\/CNPJ>/i) || [])[1];
    const tomadorCpf = (xml.match(/<tomad[\s\S]*?<CPF>([\d]+)<\/CPF>/i) || [])[1];

    // Valores
    const valorServico = parseFloat(pickTag(xml, 'vServPrest') || pickTag(xml, 'vServ') || pickTag(xml, 'valorServico') || '0');
    const valorIss = parseFloat(pickTag(xml, 'vISSQN') || pickTag(xml, 'vISS') || pickTag(xml, 'valorIss') || '0');
    const aliquotaIss = parseFloat(pickTag(xml, 'pAliqAplicada') || pickTag(xml, 'pAliq') || pickTag(xml, 'aliquotaIss') || '0');

    return {
        tipoDoc: 'nfseNacional',
        chave,
        numero,
        dataEmissao,
        codMunicipio,
        prestadorCnpj,
        prestadorIM,
        tomadorCnpj,
        tomadorCpf,
        valorServico,
        valorIss,
        aliquotaIss,
    };
}

function extrairMetadadosEvento(xml) {
    const chave = pickTag(xml, 'chNFSe') || pickTag(xml, 'chaveAcesso');
    const tpEvento = pickTag(xml, 'tpEvento') || pickTag(xml, 'tipoEvento');
    const seq = pickTag(xml, 'nSeqEvento') || pickTag(xml, 'sequencia') || '1';
    const dh = pickTag(xml, 'dhEvento') || pickTag(xml, 'dataEvento');
    const justificativa = pickTag(xml, 'xJust') || pickTag(xml, 'motivo');
    return { tipoDoc: 'eventoNfseNacional', chave, tpEvento, seq, dh, justificativa };
}

function buildStoragePath(empresaId, chave, fallback) {
    const k = (chave || fallback || crypto.randomBytes(8).toString('hex')).slice(0, 60);
    return `${STORAGE_PREFIX}/${empresaId}/${k}.xml`;
}

/**
 * Importa um item do lote retornado pelo ADN.
 *
 * @param {object} args - {
 *   empresaId, empresaCnpj, item, capturadoPor
 * }
 *   item: { nsu, tipo?, chaveAcesso?, xmlGzipBase64?, xml? }
 */
export async function importarDfeNfseNacional({ empresaId, empresaCnpj, item, capturadoPor }) {
    if (!item) return { status: 'erro', motivo: 'item vazio' };

    // Resolve o XML: pode vir como xmlGzipBase64 ou xml direto
    let xml;
    try {
        if (item.xmlGzipBase64) xml = decompressIfNeeded(item.xmlGzipBase64, true);
        else if (item.xml) xml = item.xml;
        else if (typeof item === 'string') xml = item;
        else return { status: 'erro', motivo: 'XML não encontrado no item' };
    } catch (e) {
        return { status: 'erro', motivo: e.message };
    }

    if (!xml || xml.length < 100) return { status: 'erro', motivo: 'XML muito curto' };

    const xmlHash = sha256(xml);
    const tipo = classificarDfe(xml);
    const meta = tipo === 'evento' ? extrairMetadadosEvento(xml) : extrairMetadadosNfse(xml);

    if (!meta.chave) {
        return { status: 'erro', motivo: 'chaveAcesso não encontrada no XML' };
    }

    const db = fa().firestore();
    // Evento (cancelamento/substituição) NUNCA pode usar o docId/storagePath da
    // própria nota: meta.chave do evento é a chNFSe da nota, e um set() com o
    // mesmo id sobrescrevia tipo/xmlHash do doc e o XML original no Storage —
    // a nota "sumia" do resumo e o cancelamento nunca virava status.
    const ehEvento = tipo === 'evento';
    const docId = ehEvento
        ? `evt-${meta.chave}-${meta.tpEvento || 'evt'}-${meta.seq || '1'}`.slice(0, 140)
        : meta.chave;
    const ref = db.collection(COLLECTION).doc(docId);

    // Idempotência: se já existe com mesmo hash, é duplicado
    const existing = await ref.get();
    if (existing.exists) {
        const data = existing.data();
        if (data.xmlHash === xmlHash) {
            return { status: 'duplicado', chave: meta.chave };
        }
    }

    // Storage do XML bruto (evento em path próprio, sem colidir com a nota)
    let storagePath = ehEvento
        ? `${STORAGE_PREFIX}/${empresaId}/${String(meta.chave).slice(0, 60)}-evt-${meta.tpEvento || 'evt'}-${meta.seq || '1'}.xml`
        : buildStoragePath(empresaId, meta.chave, item.nsu);
    try {
        const bucket = admin.storage().bucket();
        await bucket.file(storagePath).save(xml, {
            contentType: 'application/xml',
            metadata: { metadata: { empresaId, chave: meta.chave, tipo, nsu: item.nsu } },
        });
    } catch (e) {
        // Sem o XML no Storage, o doc não pode apontar pra um path fantasma —
        // o "XML bruto guardado pra reprocessamento" é premissa do parser v1.
        console.warn(`[nfse-nac-dfe importer] falha gravando XML em storage: ${e.message}`);
        await registrarErroNfseNacionalDfe({
            empresaId, empresaCnpj,
            motivo: `Falha gravando XML no Storage: ${e.message}`,
            contexto: { chave: meta.chave, nsu: item.nsu, tipo },
            xmlBruto: xml,
        });
        storagePath = null;
    }

    // Persistência metadados
    const payload = {
        empresaId,
        empresaCnpj: String(empresaCnpj).replace(/\D/g, ''),
        tipo: meta.tipoDoc,
        ...meta,
        nsu: item.nsu || null,
        schema: item.schema || null,
        storagePath,
        xmlHash,
        fonte: 'nfse-nacional-dfe-adn',
        capturadoPor: capturadoPor || null,
        capturadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };

    await ref.set(payload, { merge: true });

    // Reflete o evento na nota: anexa ao array eventos e, se for cancelamento
    // (família 1011xx do padrão nacional: 101101 cancelamento, 101103
    // cancelamento por substituição), marca status='cancelado'.
    if (ehEvento) {
        try {
            const notaRef = db.collection(COLLECTION).doc(meta.chave);
            const notaSnap = await notaRef.get();
            if (notaSnap.exists) {
                const eventos = notaSnap.data().eventos || [];
                const jaTem = eventos.some(ev => ev.tpEvento === meta.tpEvento && String(ev.seq || '1') === String(meta.seq || '1'));
                const update = {};
                if (!jaTem) {
                    update.eventos = [...eventos, {
                        tpEvento: meta.tpEvento || null,
                        seq: meta.seq || '1',
                        dhEvento: meta.dh || null,
                        justificativa: meta.justificativa || null,
                        docIdEvento: docId,
                    }];
                }
                if (/^1011/.test(String(meta.tpEvento || ''))) update.status = 'cancelado';
                if (Object.keys(update).length) await notaRef.update(update);
            }
        } catch (e) {
            console.warn(`[nfse-nac-dfe importer] falha refletindo evento na nota ${meta.chave}: ${e.message}`);
        }
    }

    return { status: 'novo', chave: meta.chave, tipo: meta.tipoDoc };
}

/**
 * Registra erro no log de captura (similar ao xml-importer SEFAZ).
 */
export async function registrarErroNfseNacionalDfe({ empresaId, empresaCnpj, motivo, contexto, xmlBruto = null }) {
    try {
        const db = fa().firestore();
        await db.collection('nfse_nacional_dfe_erros').add({
            empresaId,
            empresaCnpj: String(empresaCnpj || '').replace(/\D/g, ''),
            motivo,
            contexto: contexto || null,
            // Única cópia recuperável quando Storage falhou ou o cursor NSU
            // avançou por cima do item (limite 1MB/doc do Firestore).
            xmlBruto: xmlBruto ? String(xmlBruto).slice(0, 800_000) : null,
            xmlBrutoTruncado: xmlBruto ? String(xmlBruto).length > 800_000 : null,
            registradoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.warn('[nfse-nac-dfe] falha registrando erro:', e.message);
    }
}
