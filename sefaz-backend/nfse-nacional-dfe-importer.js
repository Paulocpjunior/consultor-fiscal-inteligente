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
import {
    documentoDaNfseNacional, lacunasDaNfseNacional,
    eventoDaNfseNacional, eventoJaRegistrado,
} from './nfse-nacional-gravacao.js';

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
    const docId = meta.chave;
    const ref = db.collection(COLLECTION).doc(docId);

    // Idempotência: se já existe com mesmo hash, é duplicado
    const existing = await ref.get();
    if (existing.exists) {
        const data = existing.data();
        if (data.xmlHash === xmlHash) {
            return { status: 'duplicado', chave: meta.chave };
        }
    }

    // Storage do XML bruto
    const storagePath = buildStoragePath(empresaId, meta.chave, item.nsu);
    try {
        const bucket = admin.storage().bucket();
        await bucket.file(storagePath).save(xml, {
            contentType: 'application/xml',
            metadata: { metadata: { empresaId, chave: meta.chave, tipo, nsu: item.nsu } },
        });
    } catch (e) {
        console.warn(`[nfse-nac-dfe importer] falha gravando XML em storage: ${e.message}`);
    }

    const comum = {
        empresaId,
        empresaCnpj: String(empresaCnpj).replace(/\D/g, ''),
        nsu: item.nsu || null,
        schema: item.schema || null,
        storagePath,
        xmlHash,
        fonte: 'nfse-nacional-dfe-adn',
        capturadoPor: capturadoPor || null,
        capturadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };

    // ═══════════════════════════════════════════════════════════════════════
    // 🚨 O EVENTO NÃO PODE APAGAR A NOTA
    //
    // O `docId` é a CHAVE nos DOIS casos — e a chave do evento é a **da NFS-e
    // a que ele se refere**. Com `merge: true` e `tipo: meta.tipoDoc`, o
    // evento de cancelamento reescrevia o `tipo` do documento para
    // `'eventoNfseNacional'`: a nota deixava de ser nota, sumindo de todo
    // leitor que pergunta pelo tipo. É a família do stub que o merge
    // ressuscitava (11/08, MV LIDER 639), na direção contrária.
    //
    // Agora o evento entra em `eventos[]` — o array que `docCancelado` já lê —
    // sem tocar na identidade do documento.
    // ═══════════════════════════════════════════════════════════════════════
    if (tipo === 'evento') {
        const evento = eventoDaNfseNacional(meta);
        const eventosAtuais = existing.exists ? (existing.data()?.eventos || []) : [];
        const payloadEvento = { ...comum };
        if (evento && !eventoJaRegistrado(eventosAtuais, evento)) {
            payloadEvento.eventos = [...eventosAtuais, evento];
        }
        await ref.set(payloadEvento, { merge: true });
        return { status: 'novo', chave: meta.chave, tipo: meta.tipoDoc, evento: true };
    }

    // ⚠️ O `...meta` continua entrando (ele é o que o parser leu do XML), mas
    // DEPOIS vem o que os leitores do app precisam — direção, competência,
    // rótulo, valor e blocos de participante —, derivado do próprio documento.
    const derivado = documentoDaNfseNacional(meta, empresaCnpj);
    const payload = { ...comum, ...meta, ...derivado };

    await ref.set(payload, { merge: true });

    // O que NÃO deu para derivar volta NOMEADO: nota que entra torta e calada
    // é a que ninguém acha depois.
    const lacunas = lacunasDaNfseNacional(meta, empresaCnpj);
    return {
        status: 'novo', chave: meta.chave, tipo: meta.tipoDoc,
        ...(lacunas.length ? { lacunas } : {}),
    };
}

/**
 * Registra erro no log de captura (similar ao xml-importer SEFAZ).
 */
export async function registrarErroNfseNacionalDfe({ empresaId, empresaCnpj, motivo, contexto }) {
    try {
        const db = fa().firestore();
        await db.collection('nfse_nacional_dfe_erros').add({
            empresaId,
            empresaCnpj: String(empresaCnpj || '').replace(/\D/g, ''),
            motivo,
            contexto: contexto || null,
            registradoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (e) {
        console.warn('[nfse-nac-dfe] falha registrando erro:', e.message);
    }
}
