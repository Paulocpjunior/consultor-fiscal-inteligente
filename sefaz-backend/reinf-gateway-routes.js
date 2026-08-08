// ============================================================================
// sefaz-backend/reinf-gateway-routes.js  (ESM — I/O)
// ----------------------------------------------------------------------------
// FASE 4 DO TÚNEL: o CFI assina E TRANSMITE o lote EFD-Reinf.
//
//   POST /api/admin/reinf/gateway/transmitir
//        { eventos: [xml sem Signature], contribuinte: {tpInsc, nrInsc},
//          tpAmb?, confirmoProducao?, cnpjAssinante? }
//   GET  /api/admin/reinf/gateway/lote/:protocolo?tpAmb=
//
// O módulo irmão manda o evento SEM assinatura e recebe o protocolo. A chave
// privada nunca sai daqui: a assinatura E o mTLS acontecem nesta máquina —
// que é o motivo de o gateway ser "completo" (só assinatura remota deixaria
// a segunda cópia do A1 viva do outro lado, por causa do handshake).
//
// TRAVAS:
//   - Produção restrita (tpAmb=2) é o PADRÃO; produção exige
//     confirmoProducao=true (entrega ao EFD-Reinf não se desfaz).
//   - O certificado sai do cofre pela RAIZ (regra da matriz) do CNPJ
//     assinante — por padrão o do escritório, que assina como procuradora.
//   - Auditoria em `reinf_gateway_lotes`: quem, declarante, ambiente, ids
//     dos eventos e protocolo. O CONTEÚDO do evento não é guardado — é
//     declaração fiscal do cliente; o dono do dado é o módulo que declara.
// ============================================================================

import { Router } from 'express';
import https from 'https';
import admin from 'firebase-admin';
import { requireAdmin } from './require-admin.js';
import { crossProjectAuth, PROJETO } from './require-cross-project-auth.js';
import { loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import {
    assinarEventoReinf, extrairEvento, extrairPemDoPfx, montarLote,
    extrairProtocolo, extrairCdResposta, resolverAmbiente, ENDPOINTS,
} from './reinf-gateway.js';

const router = Router();

// CNPJ do escritório — o procurador que assina quando o chamador não pede
// outro. É o mesmo papel do reinf-cert-a1 que o gateway aposenta.
const CNPJ_ESCRITORIO = '44388152000189';

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

// Só o Contábil (e o próprio CFI) — transmitir EFD-Reinf não é pra qualquer
// módulo; DP e Financeiro não entram de lambuja.
const doIrmao = crossProjectAuth([PROJETO.fiscal, PROJETO.contabil]);
async function autorizar(req, res, next) {
    let passou = false;
    const engolir = { status() { return engolir; }, json() { return engolir; } };
    await requireAdmin(req, engolir, () => { passou = true; });
    if (passou) return next();
    return doIrmao(req, res, next);
}

/** mTLS com a Receita — a chave abre a conexão DAQUI, e é esse o ponto. */
function requisicaoMtls({ url, method, body, pfxBuffer, password }) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method,
            pfx: pfxBuffer,
            passphrase: password,
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                Accept: 'application/xml',
                ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
            },
            minVersion: 'TLSv1.2',
        }, (res) => {
            let data = '';
            res.setEncoding('utf-8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(60000, () => req.destroy(new Error('gateway: timeout (60s) falando com a Receita')));
        if (body) req.write(body);
        req.end();
    });
}

async function carregarCertAssinante(cnpjAssinante) {
    const alvo = String(cnpjAssinante || CNPJ_ESCRITORIO).replace(/\D/g, '');
    const cert = await loadCertEmpresaPorCnpjBase(alvo);
    if (!cert) {
        throw new Error(`Nenhum certificado A1 válido no cofre para a raiz do CNPJ ${alvo}. `
            + 'Suba o A1 na ficha da empresa no CFI — sem ele o gateway não assina.');
    }
    const { pemKey, pemCert } = extrairPemDoPfx(cert.pfxBuffer, cert.password);
    return { ...cert, pemKey, pemCert };
}

router.post('/transmitir', autorizar, async (req, res) => {
    try {
        const { eventos, contribuinte, tpAmb, confirmoProducao, cnpjAssinante } = req.body || {};
        const amb = resolverAmbiente({ tpAmb, confirmoProducao });
        if (!amb.ok) return res.status(400).json({ ok: false, error: amb.erro });
        if (!Array.isArray(eventos) || !eventos.length) {
            return res.status(400).json({ ok: false, error: 'Envie `eventos` como lista de XMLs sem assinatura.' });
        }

        const cert = await carregarCertAssinante(cnpjAssinante);
        const assinados = eventos.map((xml) => assinarEventoReinf(xml, cert));
        const lote = montarLote(assinados, contribuinte);

        const ep = ENDPOINTS[amb.tpAmb];
        const r = await requisicaoMtls({
            url: ep.envio, method: 'POST', body: lote,
            pfxBuffer: cert.pfxBuffer, password: cert.password,
        });
        const protocolo = extrairProtocolo(r.body);

        // Auditoria: quem transmitiu o quê, NUNCA o conteúdo do evento.
        await getDb().collection('reinf_gateway_lotes').add({
            em: admin.firestore.FieldValue.serverTimestamp(),
            por: req.user?.email || null,
            projetoOrigem: req.user?.projeto || 'cfi',
            declarante: String(contribuinte?.nrInsc || '').replace(/\D/g, ''),
            tpAmb: amb.tpAmb,
            eventos: assinados.map((x) => extrairEvento(x).id),
            elementos: [...new Set(assinados.map((x) => extrairEvento(x).elemento))],
            certFingerprint: cert.fingerprint || null,
            httpStatus: r.status,
            protocolo: protocolo || null,
        });

        // 201 = lote recebido. Qualquer outra coisa volta com o XML da
        // Receita — recusa dela é informação, não erro do gateway.
        return res.json({
            ok: true,
            httpStatus: r.status,
            recebido: r.status === 201,
            protocolo,
            tpAmb: amb.tpAmb,
            assinadoPor: { cnpj: cert.cnpjFonte || cert.cnpj, fingerprint: cert.fingerprint || null },
            xml: r.body,
        });
    } catch (e) {
        console.error('[reinf-gateway/transmitir]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/lote/:protocolo', autorizar, async (req, res) => {
    try {
        const amb = resolverAmbiente({ tpAmb: req.query.tpAmb, confirmoProducao: req.query.tpAmb === '1' });
        // Consulta é LEITURA: produção não precisa de confirmação aqui — não
        // muda nada na Receita, e travar a consulta esconderia o resultado de
        // um lote que JÁ foi transmitido.
        const tpAmb = [1, 2].includes(Number(req.query.tpAmb)) ? Number(req.query.tpAmb) : 2;
        void amb;
        const protocolo = String(req.params.protocolo || '').trim();
        if (!protocolo) return res.status(400).json({ ok: false, error: 'Informe o protocolo.' });

        const cert = await carregarCertAssinante(req.query.cnpjAssinante);
        const ep = ENDPOINTS[tpAmb];
        const r = await requisicaoMtls({
            url: `${ep.consulta}/${encodeURIComponent(protocolo)}`, method: 'GET',
            pfxBuffer: cert.pfxBuffer, password: cert.password,
        });
        return res.json({
            ok: true,
            httpStatus: r.status,
            cdResposta: extrairCdResposta(r.body),
            xml: r.body,
        });
    } catch (e) {
        console.error('[reinf-gateway/lote]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
