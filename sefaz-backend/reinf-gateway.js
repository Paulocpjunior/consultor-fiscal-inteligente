// ============================================================================
// sefaz-backend/reinf-gateway.js  (núcleo — assinatura e lote testáveis)
// ----------------------------------------------------------------------------
// FASE 4 DO TÚNEL: A ASSINATURA É OPERAÇÃO DO CFI — a chave não viaja nunca.
//
// Aprovado pelo Paulo (08/08) como GATEWAY COMPLETO, e o "completo" tem
// motivo técnico: só "assinatura remota" NÃO elimina a segunda cópia do A1,
// porque o mTLS com a Receita exige a chave privada NA MÁQUINA que abre a
// conexão. Então o CFI assina E transmite — o módulo irmão manda o evento
// sem assinatura e recebe o protocolo. Quando isso estiver provado em
// produção restrita, o `reinf-cert-a1` do outro projeto pode ser apagado e a
// chave volta a existir num cofre só.
//
// ═══ DE ONDE VEIO ESTE CÓDIGO ═══════════════════════════════════════════════
//
// Assinador e transmissor são PORTES do plano-contas-iob (reinf/assinador.js
// e reinf/transmissor.js) — código que JÁ transmitiu de verdade (R-1000/
// R-4010 homologados). As lições embutidas neles não se rediscutem:
//   - MS0017: a Receita rejeita evento assinado com indentação — minifica
//     ANTES de assinar, e o lote leva o XML exatamente como assinado.
//   - O wrapper <evento Id> não pode repetir o id assinado do <evt* id>,
//     senão a Reference "#ID..." fica ambígua e cai com MS0017.
//   - id duplicado no lote é RECUSA, não conserto: reescrever id aqui
//     alteraria o conteúdo assinado.
//
// GENERALIZAÇÃO ÚNICA: o assinador de lá conhecia só evtInfoContri/evtRetPF/
// evtFech. O gateway serve a série toda (evtRetPJ do R-4020, evtAqProd do
// R-2055…), então o elemento do evento é DESCOBERTO pelo id — qualquer filho
// de <Reinf> com id="ID + 34 dígitos". A autovalidação da assinatura continua
// obrigatória: gateway que assina errado é pior que módulo sem gateway.
// ============================================================================

import { SignedXml } from 'xml-crypto';
import { pfxToPem } from './pfx-to-pem.js';

const SIG_ALG = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const DIGEST_ALG = 'http://www.w3.org/2001/04/xmlenc#sha256';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

export const NS_LOTE = 'http://www.reinf.esocial.gov.br/schemas/envioLoteEventosAssincrono/v1_00_00';
const MAX_EVENTOS = 50;
const MAX_BYTES = 54 * 1024 * 1024;

// Endpoints por ambiente (tpAmb: 1=Produção, 2=Produção Restrita).
export const ENDPOINTS = {
    1: {
        envio: 'https://reinf.receita.economia.gov.br/recepcao/lotes',
        consulta: 'https://reinf.receita.economia.gov.br/consulta/lotes',
    },
    2: {
        envio: 'https://pre-reinf.receita.economia.gov.br/recepcao/lotes',
        consulta: 'https://pre-reinf.receita.economia.gov.br/consulta/lotes',
    },
};

export function normalizarXmlEvento(xmlEvento) {
    return String(xmlEvento || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .trim();
}

/**
 * Extrai { elemento, id } do evento — QUALQUER evento da série (evtRetPJ,
 * evtAqProd, evtInfoContri…): o contrato do leiaute é id="ID"+34 dígitos no
 * elemento do evento, e é por ele que se acha, não por lista de nomes.
 */
export function extrairEvento(xml) {
    const m = String(xml || '').match(/<((?:\w+:)?evt\w+)\s+[^>]*id="(ID\d{34})"/);
    if (!m) {
        throw new Error('gateway: não achei o elemento de evento (esperado <evt* id="ID+34 dígitos">). '
            + 'Confira se o XML é um evento EFD-Reinf sem assinatura.');
    }
    return { elemento: m[1].replace(/^\w+:/, ''), id: m[2] };
}

function certificadoBase64(pemCert) {
    return String(pemCert || '')
        .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
        .replace(/\s+/g, '');
}

/**
 * pfx (PKCS#12) → { pemKey, pemCert }. O xml-crypto só fala PEM. A extração
 * mora em `pfx-to-pem.js` desde sempre — copiar aqui seria a terceira cópia
 * do mesmo extrator.
 */
export function extrairPemDoPfx(pfxBuffer, password) {
    return pfxToPem(pfxBuffer, password);
}

function criarAssinador(cert) {
    const sig = new SignedXml({
        privateKey: cert.pemKey,
        publicCert: cert.pemCert,
        signatureAlgorithm: SIG_ALG,
        canonicalizationAlgorithm: C14N,
        idAttribute: 'id',
    });
    sig.idAttributes = ['id', 'Id', 'ID'];
    sig.getKeyInfoContent = function () {
        return `<X509Data><X509Certificate>${certificadoBase64(cert.pemCert)}</X509Certificate></X509Data>`;
    };
    return sig;
}

export function verificarAssinaturaReinf(xmlAssinado, cert) {
    const m = String(xmlAssinado || '').match(/<Signature[\s\S]*?<\/Signature>/);
    if (!m) return { ok: false, erro: 'Signature ausente' };
    const sig = new SignedXml({ publicCert: cert.pemCert, idAttribute: 'id' });
    sig.idAttributes = ['id', 'Id', 'ID'];
    sig.loadSignature(m[0]);
    try {
        return sig.checkSignature(xmlAssinado)
            ? { ok: true }
            : { ok: false, erro: (sig.validationErrors || []).join('; ') || 'assinatura inválida' };
    } catch (err) {
        return { ok: false, erro: err?.message || String(err) };
    }
}

/**
 * Assina um evento EFD-Reinf. Minifica ANTES (MS0017) e autovalida DEPOIS —
 * gateway que assina errado é pior que módulo sem gateway.
 */
export function assinarEventoReinf(xmlEvento, cert) {
    if (!xmlEvento || typeof xmlEvento !== 'string') {
        throw new Error('gateway: xmlEvento ausente ou inválido');
    }
    if (!cert?.pemKey || !cert?.pemCert) {
        throw new Error('gateway: certificado sem pemKey/pemCert');
    }
    const xml = normalizarXmlEvento(xmlEvento);
    if (/<Signature[\s>]/.test(xml)) {
        throw new Error('gateway: o evento já veio assinado — o gateway assina; mande o XML sem <Signature>.');
    }
    const { elemento, id } = extrairEvento(xml);
    const sig = criarAssinador(cert);
    const eventoXpath = `//*[local-name(.)='${elemento}']`;

    sig.addReference({
        xpath: eventoXpath,
        transforms: [ENVELOPED, C14N],
        digestAlgorithm: DIGEST_ALG,
        uri: id,
        isEmptyUri: false,
    });
    sig.computeSignature(xml, { location: { reference: eventoXpath, action: 'after' } });

    const assinado = normalizarXmlEvento(sig.getSignedXml());
    const validacao = verificarAssinaturaReinf(assinado, cert);
    if (!validacao.ok) {
        throw new Error(`gateway: falha de autovalidação XMLDSig (${validacao.erro})`);
    }
    return assinado;
}

/**
 * Monta o lote assíncrono com eventos JÁ assinados. Porte fiel do
 * transmissor provado — inclusive o wrapper <evento Id> que NÃO pode
 * repetir o id assinado (Reference ambígua ⇒ MS0017).
 */
export function montarLote(eventosAssinadosXml, contribuinte) {
    if (!Array.isArray(eventosAssinadosXml) || eventosAssinadosXml.length === 0) {
        throw new Error('gateway: lista de eventos vazia');
    }
    if (eventosAssinadosXml.length > MAX_EVENTOS) {
        throw new Error(`gateway: lote excede ${MAX_EVENTOS} eventos (recebidos ${eventosAssinadosXml.length})`);
    }
    if (!contribuinte || ![1, 2].includes(contribuinte.tpInsc)) {
        throw new Error('gateway: contribuinte.tpInsc do lote deve ser 1 ou 2');
    }
    const nrInsc = String(contribuinte.nrInsc || '').replace(/\D/g, '');
    if (!/^([0-9]{8}|[0-9]{11}|[0-9]{14})$/.test(nrInsc)) {
        throw new Error('gateway: contribuinte.nrInsc do lote inválido');
    }

    const vistos = new Set();
    const idWrapperLote = (idEvento, idx) => {
        const base = String(idEvento || '');
        if (/^ID\d{34}$/.test(base)) {
            return base.slice(0, -5) + String(90001 + idx).padStart(5, '0');
        }
        return `Lote${idx + 1}_${base}`.replace(/[^A-Za-z0-9_.:-]/g, '_');
    };

    const eventos = eventosAssinadosXml.map((xml, idx) => {
        const limpo = String(xml).replace(/^\s*<\?xml[^?]*\?>\s*/i, '').trim();
        const { id } = extrairEvento(limpo);
        if (vistos.has(id)) {
            throw new Error(`gateway: id de evento duplicado no lote (${id}). `
                + 'Gere cada evento com um seq distinto antes de mandar.');
        }
        vistos.add(id);
        return `   <evento Id="${idWrapperLote(id, idx)}">\n${limpo}\n   </evento>`;
    }).join('\n');

    const lote = `<?xml version="1.0" encoding="UTF-8"?>
<Reinf xmlns="${NS_LOTE}">
 <envioLoteEventos>
  <ideContribuinte>
   <tpInsc>${contribuinte.tpInsc}</tpInsc>
   <nrInsc>${nrInsc}</nrInsc>
  </ideContribuinte>
  <eventos>
${eventos}
  </eventos>
 </envioLoteEventos>
</Reinf>`;

    const bytes = Buffer.byteLength(lote, 'utf-8');
    if (bytes > MAX_BYTES) throw new Error(`gateway: lote excede 54 MB (${bytes} bytes)`);
    return lote;
}

/** Protocolo e cdResposta saem do XML da Receita — parsers pequenos e puros. */
export function extrairProtocolo(xmlResposta) {
    const m = String(xmlResposta || '').match(
        /<(?:\w+:)?(?:protocoloEnvio|protocolo)[^>]*>([^<]+)<\/(?:\w+:)?(?:protocoloEnvio|protocolo)>/i,
    );
    return m ? m[1].trim() : null;
}

export function extrairCdResposta(xmlResposta) {
    const m = String(xmlResposta || '').match(/<cdResposta[^>]*>([^<]+)<\/cdResposta>/i);
    return m ? Number(m[1].trim()) : null;
}

/**
 * A trava de ambiente: produção restrita (2) é o padrão, e produção (1) SÓ
 * com confirmação explícita — mesmo desenho da API DARE. Entrega ao
 * EFD-Reinf não se desfaz.
 */
export function resolverAmbiente({ tpAmb, confirmoProducao } = {}) {
    const amb = Number(tpAmb ?? 2);
    if (![1, 2].includes(amb)) {
        return { ok: false, erro: 'tpAmb deve ser 1 (produção) ou 2 (produção restrita).' };
    }
    if (amb === 1 && confirmoProducao !== true) {
        return {
            ok: false,
            erro: 'Transmissão em PRODUÇÃO exige confirmação explícita (confirmoProducao: true). '
                + 'Sem ela o gateway só aceita produção restrita (tpAmb=2) — entrega ao EFD-Reinf não se desfaz.',
        };
    }
    return { ok: true, tpAmb: amb };
}
