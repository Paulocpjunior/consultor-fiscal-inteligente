// ============================================================================
// emissao-guard.js
//
// Freio de emergencia / gate de go-live para operacoes que ESCREVEM no Fisco
// (transmitir declaracao, emitir DAS/DARF, emitir NFS-e, encerrar apuracao).
//
// CONSULTAS (leitura) NUNCA passam por aqui — captura, dashboards e conferencia
// seguem funcionando mesmo com emissao bloqueada.
//
// Default: emissao LIBERADA (nao muda comportamento atual). Pra bloquear:
//   EMISSAO_BLOQUEADA=true               -> bloqueia TODAS as emissoes
//   EMISSAO_BLOQUEADA_DAS=true           -> bloqueia so DAS
//   EMISSAO_BLOQUEADA_DARF=true          -> bloqueia so DARF
//   EMISSAO_BLOQUEADA_DCTFWEB=true       -> bloqueia so DCTFWeb (transmitir/darf/encerrar)
//   EMISSAO_BLOQUEADA_NFSE_NAC=true      -> bloqueia so NFS-e Nacional
//
// Uso pro go-live faseado: sobe com tudo bloqueado, valida 1 tipo por vez
// (smoke / homologacao), libera aquele tipo, repete. Sem redeploy de codigo —
// so muda env var no Cloud Run.
// ============================================================================

export class EmissaoBloqueadaError extends Error {
    constructor(tipo, envVar = `EMISSAO_BLOQUEADA_${tipo}`) {
        super(
            `Emissão ${tipo} está BLOQUEADA (kill-switch ${envVar}=true). ` +
            `Operação de leitura/consulta segue normal. Libere a emissão deste tipo no Cloud Run quando validada.`
        );
        this.name = 'EmissaoBloqueadaError';
        this.tipo = tipo;
        this.envVar = envVar;
        this.code = 'EMISSAO_BLOQUEADA';
        this.httpStatus = 423; // Locked
    }
}

const TIPOS_VALIDOS = ['DAS', 'DARF', 'DCTFWEB', 'NFSE_NAC'];

/**
 * Lança EmissaoBloqueadaError se a emissao do `tipo` estiver bloqueada por env.
 * NO-OP (libera) por default.
 *
 * @param {'DAS'|'DARF'|'DCTFWEB'|'NFSE_NAC'} tipo
 */
export function assertEmissaoLiberada(tipo) {
    const t = String(tipo || '').toUpperCase();
    if (!TIPOS_VALIDOS.includes(t)) {
        // Tipo desconhecido — nao bloqueia (fail-open p/ nao quebrar caminho novo),
        // mas loga pra revisao.
        console.warn(`[emissao-guard] tipo desconhecido "${tipo}" — liberado por padrao`);
        return;
    }
    const tudoBloqueado = process.env.EMISSAO_BLOQUEADA === 'true';
    const tipoBloqueado = process.env[`EMISSAO_BLOQUEADA_${t}`] === 'true';
    if (tudoBloqueado || tipoBloqueado) {
        const envVar = tudoBloqueado ? 'EMISSAO_BLOQUEADA' : `EMISSAO_BLOQUEADA_${t}`;
        console.warn(`[emissao-guard] BLOQUEADO ${t} por ${envVar} (tudo=${tudoBloqueado} tipo=${tipoBloqueado})`);
        throw new EmissaoBloqueadaError(t, envVar);
    }
}

/** Retorna o estado atual do kill-switch (pra UI/diagnostico admin). */
export function statusEmissaoGuard() {
    const tudo = process.env.EMISSAO_BLOQUEADA === 'true';
    const porTipo = {};
    for (const t of TIPOS_VALIDOS) {
        porTipo[t] = tudo || process.env[`EMISSAO_BLOQUEADA_${t}`] === 'true';
    }
    return { tudoBloqueado: tudo, porTipo };
}
