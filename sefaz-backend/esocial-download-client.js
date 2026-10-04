// ============================================================================
// sefaz-backend/esocial-download-client.js  (I/O — certificado, mTLS, auditoria)
// ----------------------------------------------------------------------------
// Executa os pedidos montados em esocial-download.js. A chave privada não sai
// do CFI: assinatura e mTLS acontecem aqui, com o A1 do cofre — por padrão o
// do escritório, que atua como procurador do empregador no eSocial (mesmo
// papel do gateway da EFD-Reinf). O conteúdo dos eventos passa pelo túnel e
// NÃO é gravado: a auditoria guarda quem pediu, o quê e o código de resposta.
// ============================================================================

import https from 'https';
import admin from 'firebase-admin';
import { loadCertEmpresaPorCnpjBase } from './cert-storage.js';
import { pfxToPem } from './pfx-to-pem.js';
import { ENDPOINTS, assinarPedidoEsocial, montarEnvelope } from './esocial-download.js';

export const CNPJ_ESCRITORIO = '44388152000189';

/** Certificado que assina: o do escritório (procurador) ou o da própria empresa. */
export async function carregarCertificado({ origem = 'escritorio', cnpjEmpresa } = {}) {
    const alvo = origem === 'empresa' ? String(cnpjEmpresa || '').replace(/\D/g, '') : CNPJ_ESCRITORIO;
    const cert = await loadCertEmpresaPorCnpjBase(alvo);
    if (!cert) {
        throw new Error(origem === 'empresa'
            ? `A empresa ${alvo} não tem certificado A1 válido no cofre do CFI.`
            : 'O certificado A1 do escritório não está no cofre do CFI.');
    }
    const { pemKey, pemCert } = pfxToPem(cert.pfxBuffer, cert.password);
    return { ...cert, pemKey, pemCert };
}

/** POST SOAP 1.1 com mTLS. */
export function postSoap({ url, action, envelope, pfxBuffer, password }) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
            pfx: pfxBuffer, passphrase: password, minVersion: 'TLSv1.2',
            headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${action}"`, 'Content-Length': Buffer.byteLength(envelope) },
        }, (res) => {
            let data = '';
            res.setEncoding('utf-8');
            res.on('data', (c) => { data += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(90000, () => req.destroy(new Error('timeout (90s) falando com o eSocial')));
        req.write(envelope);
        req.end();
    });
}

/** Assina, envelopa e envia um pedido; `transporte` é injetável para teste. */
export async function executarPedido({ pedido, cert, tpAmb = 1, transporte = postSoap }) {
    const ep = ENDPOINTS[tpAmb];
    if (!ep) throw new Error('tpAmb deve ser 1 (produção) ou 2 (produção restrita).');
    const envelope = montarEnvelope(pedido, assinarPedidoEsocial(pedido.xml, cert));
    return transporte({ url: ep[pedido.servico], action: pedido.action, envelope, pfxBuffer: cert.pfxBuffer, password: cert.password });
}

function getDb() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin.firestore();
}

/**
 * Registra o pedido e devolve quantos já foram feitos hoje para o empregador.
 * O eSocial limita os pedidos por dia; o DP mostra a contagem para a equipe
 * não gastar a cota à toa. CPF não é gravado.
 */
export async function auditarPedido({ por, cnpj, operacao, filtro, qtd, cdResposta, httpStatus, certFingerprint, tpAmb }) {
    const dia = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const col = getDb().collection('dp_esocial_download_log');
    await col.add({ em: admin.firestore.FieldValue.serverTimestamp(), dia, por: por || null, empregador: cnpj, operacao, filtro, qtd, cdResposta: cdResposta ?? null, httpStatus: httpStatus ?? null, certFingerprint: certFingerprint || null, tpAmb });
    // Campo `empregador` (não `cnpj`): log do download, não consulta ao cadastro de empresas.
    const snap = await col.where('empregador', '==', cnpj).where('dia', '==', dia).get();
    return snap.size;
}
