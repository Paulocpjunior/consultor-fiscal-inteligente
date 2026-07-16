// ============================================================================
// sefaz-backend/poc-cert-diagnostico.js  (ESM) — Fase F0
//
// Resolve o A1 da empresa no cofre a partir de um CNPJ que pode vir como RAIZ
// (8 digitos) OU completo (14). Corrige o caso em que cnpjBase() do
// cert-base-helper so aceita 14 digitos — com a raiz de 8 ele retornava vazio
// e a busca falhava com 404 mesmo havendo cert.
//
// Quando nao acha um A1 valido, devolve um DIAGNOSTICO legivel (motivo + bases
// existentes no cofre) em vez de um null opaco. So le metadados/cert — nada e
// gravado.
// ============================================================================

import { listCertsEmpresas, loadCertEmpresa } from './cert-storage.js';
import { certA1MetadataValido, cnpjBase } from './cert-base-helper.js';

// Base (8 primeiros digitos) aceitando raiz de 8 OU CNPJ de 14 (ou mais).
function base8(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 8 ? d.slice(0, 8) : '';
}

/**
 * @param {string} cnpjRaw  raiz (8) ou CNPJ completo (14)
 * @returns {Promise<
 *   | { ok: true, cert: object, meta: { empresaId: string, cnpj: string } }
 *   | { ok: false, motivo: string, baseAlvo?: string, basesNoCofre?: string[], cert?: object }
 * >}
 */
export async function resolverCertEmpresa(cnpjRaw) {
  const baseAlvo = base8(cnpjRaw);
  if (!baseAlvo) return { ok: false, motivo: 'cnpj_invalido' };

  const certs = await listCertsEmpresas();
  const mesmaBase = (certs || []).filter(c => cnpjBase(c.cnpj) === baseAlvo);

  if (!mesmaBase.length) {
    const basesNoCofre = [...new Set((certs || []).map(c => cnpjBase(c.cnpj)).filter(Boolean))];
    return { ok: false, motivo: 'nenhum_cert_para_esta_base', baseAlvo, basesNoCofre };
  }

  const validos = mesmaBase.filter(c => certA1MetadataValido(c));
  if (!validos.length) {
    const c = mesmaBase[0];
    const motivo = c.tipoCert !== 'A1'
      ? 'cert_nao_e_A1'
      : (!c.hasStoragePath || !c.hasPasswordEnc)
        ? 'cert_incompleto_no_cofre'
        : 'cert_expirado_ou_invalido';
    return { ok: false, motivo, baseAlvo, cert: { empresaId: c.empresaId, cnpj: c.cnpj, tipoCert: c.tipoCert, notAfter: c.notAfter } };
  }

  validos.sort((a, b) => (Date.parse(b.notAfter) || 0) - (Date.parse(a.notAfter) || 0));
  const escolhido = validos[0];
  const cert = await loadCertEmpresa(escolhido.empresaId);
  if (!cert || !cert.pfxBuffer) {
    return { ok: false, motivo: 'falha_ao_carregar_pfx', baseAlvo, cert: { empresaId: escolhido.empresaId, cnpj: escolhido.cnpj } };
  }
  return { ok: true, cert, meta: { empresaId: escolhido.empresaId, cnpj: escolhido.cnpj } };
}
