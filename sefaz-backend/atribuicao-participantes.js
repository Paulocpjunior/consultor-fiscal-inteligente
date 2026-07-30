// ============================================================================
// sefaz-backend/atribuicao-participantes.js  (PURO — sem firebase, testável)
//
// Decide o DONO real de um documento fiscal pelos participantes (emit/dest)
// quando a empresa sob a qual ele foi capturado não é nenhum dos dois.
//
// Caso concreto (autXML, Grupo Nova Era 30/07): o DistDFe do ESCRITÓRIO
// entrega notas em que o escritório não é emitente nem destinatário — só está
// na tag <autXML>. O importer gravava empresaId=escritório e
// direcao='desconhecida', e a nota ficava INVISÍVEL: não aparecia como saída
// do cliente na Cobertura de Saída, não contava no trilho autXML do painel e
// não entrava no filtro por empresa.
//
// Regra:
//  - empresa atual já é participante (emit ou dest) → não mexe (null);
//  - EMITENTE cadastrado → o doc é SAÍDA daquela empresa (é exatamente o
//    trilho autXML: a SEFAZ nunca entrega ao emissor a própria saída —
//    Rejeição 641 — então se chegou por nós, foi pela autorização);
//  - senão, DESTINATÁRIO cadastrado → ENTRADA daquela empresa;
//  - nenhum participante cadastrado → não mexe (null).
// ============================================================================

const norm = (c) => String(c || '').replace(/\D/g, '');

/**
 * @param {object} p
 * @param {string|null} p.cnpjEmit        CNPJ do emitente do documento
 * @param {string|null} p.cnpjDest        CNPJ do destinatário do documento
 * @param {string|null} p.empresaAtualCnpj CNPJ da empresa sob a qual o doc foi capturado
 * @param {Map<string,{empresaId:string}>} p.empresasPorCnpj cadastro (cnpj 14 díg → empresa)
 * @returns {{empresaId:string, empresaCnpj:string, direcao:'saida'|'entrada', motivo:string}|null}
 */
export function decidirDonoPorParticipantes({ cnpjEmit, cnpjDest, empresaAtualCnpj, empresasPorCnpj }) {
    const emit = norm(cnpjEmit);
    const dest = norm(cnpjDest);
    const atual = norm(empresaAtualCnpj);
    if (!empresasPorCnpj || typeof empresasPorCnpj.get !== 'function') return null;

    // Empresa atual é participante — a atribuição normal (decidirDirecao) já
    // resolve; nada a corrigir aqui.
    if (atual && (atual === emit || atual === dest)) return null;

    const empEmit = emit.length === 14 ? empresasPorCnpj.get(emit) : null;
    if (empEmit?.empresaId) {
        return { empresaId: empEmit.empresaId, empresaCnpj: emit, direcao: 'saida', motivo: 'emitente-cadastrado' };
    }
    const empDest = dest.length === 14 ? empresasPorCnpj.get(dest) : null;
    if (empDest?.empresaId) {
        return { empresaId: empDest.empresaId, empresaCnpj: dest, direcao: 'entrada', motivo: 'destinatario-cadastrado' };
    }
    return null;
}
