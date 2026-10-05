// ============================================================================
// sefaz-backend/dp-acesso-empresa.js  (I/O — trava da carteira do Consultor DP)
// ----------------------------------------------------------------------------
// No Consultor DP cada colaborador só trabalha nas empresas da sua carteira
// (carteira_acessos), e quem decide isso são as regras do Firestore do DP.
// Para o CFI fazer algo EM NOME de uma empresa (transmitir ao eSocial), ele
// lê o documento da empresa no Firestore do DP com o PRÓPRIO token do
// usuário: se as regras do DP liberam a leitura, a empresa está na carteira
// (ou o usuário é gestor, ou foi ele quem a cadastrou). Assim a regra fica
// num lugar só — o CFI não copia a carteira nem tem acesso de servidor ao
// banco do DP.
// ============================================================================

import { PROJETO } from './require-cross-project-auth.js';

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJETO.dpFolha}/databases/(default)/documents`;

export class AcessoNegado extends Error {}

/**
 * Confirma que o usuário do token enxerga a empresa `empresaId` no DP e que
 * o CNPJ dela é `cnpj`. Lança AcessoNegado (403) ou Error (falha de consulta).
 * `fetchImpl` é injetável para teste.
 */
export async function confirmarEmpresaDaCarteiraDp({ token, empresaId, cnpj, fetchImpl = fetch }) {
    if (!token) throw new AcessoNegado('Token ausente.');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(empresaId || ''))) throw new AcessoNegado('Empresa do DP não informada (empresaId).');
    const url = `${BASE}/empresas/${encodeURIComponent(empresaId)}?mask.fieldPaths=cnpj`;
    const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 403 || r.status === 404) {
        throw new AcessoNegado('Esta empresa não está na sua carteira no Consultor DP: peça ao gestor para incluí-la.');
    }
    if (!r.ok) throw new Error(`Não foi possível conferir a carteira no Consultor DP (HTTP ${r.status}).`);
    const doc = await r.json();
    const doDp = String(doc?.fields?.cnpj?.stringValue || '').replace(/\D/g, '');
    if (doDp !== String(cnpj)) throw new AcessoNegado('O CNPJ informado não é o da empresa no Consultor DP.');
    return true;
}
