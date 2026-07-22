// ============================================================================
// sefaz-backend/backlog-entrada.js  (PURO — sem firebase/io, testável)
//
// BACKLOG DE ENTRADA: por empresa, mede o quanto da captura NFe de ENTRADA
// está completa vs presa — o termômetro do "substituir a SIEG":
//
//   completas             → procNFe com itens/valor (estado final desejado)
//   resumosManifestados   → resNFe já com Ciência → completa vem no próximo
//                           ciclo DistDFe (só aguardar)
//   resumosPendentes      → resNFe SEM manifestação → AÇÃO: rodar ciência
//   resumosForaPrazo      → resNFe sem manifestação e emitido há >180d —
//                           ciência não é mais aceita (Ajuste SINIEF 9/07)
//   travada               → sefaz_state.nsuTravado (poison NSU) ou
//                           pendenciaNSU>0 (SEFAZ tem docs além do cursor)
//
// Classificação da empresa (pior condição vence):
//   'travada' > 'pendente-ciencia' > 'aguardando-completa' > 'sem-captura' > 'ok'
// ============================================================================

const DIA_MS = 24 * 3600 * 1000;
const PRAZO_CIENCIA_DIAS = 180;

const isResumoSchema = (sch) => /^res(NFe|NFCe|CTe|MDFe)/.test(String(sch || ''));

// Mesmos tipos do manifesto-orchestrator: qualquer manifestação registrada
// bloqueia nova e (no caso da ciência) destrava a completa.
const TIPOS_MANIFESTACAO = new Set([
    'manifestacao_confirmacao', 'manifestacao_ciencia',
    'manifestacao_desconhecimento', 'manifestacao_nao_realizada',
]);

export function docEhResumo(doc) {
    return isResumoSchema(doc?.schema) || doc?.tipoDoc === 'resNFe';
}

export function docTemManifestacao(doc) {
    return (doc?.eventos || []).some((e) => TIPOS_MANIFESTACAO.has(e?.tipo));
}

/** Classifica 1 documento de entrada: 'completa' | 'resumo_manifestado' |
 *  'resumo_pendente' | 'resumo_fora_prazo'. */
export function classificarDocEntrada(doc, agoraMs) {
    if (!docEhResumo(doc)) return 'completa';
    if (docTemManifestacao(doc)) return 'resumo_manifestado';
    if (doc?.dhEmi) {
        const idadeDias = (agoraMs - new Date(doc.dhEmi).getTime()) / DIA_MS;
        if (idadeDias > PRAZO_CIENCIA_DIAS) return 'resumo_fora_prazo';
    }
    return 'resumo_pendente';
}

/**
 * Agrega o backlog de entrada por empresa.
 * @param {{empresas: Array<{empresaId,cnpj,nome,regime}>,
 *          docs: Array<{empresaCnpj,empresaId,schema,tipoDoc,eventos,dhEmi}>,
 *          states: Record<string, {ultimaSyncMs?:number|null, cStatUltimaSync?:string|null,
 *                                  pendenciaNSU?:number, nsuTravado?:string|null}>,
 *          agoraMs: number}} args
 */
export function analisarBacklogEntrada({ empresas, docs, states, agoraMs }) {
    const porCnpj = new Map();
    for (const e of empresas) {
        porCnpj.set(e.cnpj, {
            empresaId: e.empresaId,
            cnpj: e.cnpj,
            nome: e.nome,
            regime: e.regime,
            totalEntradas: 0,
            completas: 0,
            resumosManifestados: 0,
            resumosPendentes: 0,
            resumosForaPrazo: 0,
            ultimaSyncMs: null,
            cStatUltimaSync: null,
            pendenciaNSU: 0,
            nsuTravado: null,
        });
    }

    let docsSemEmpresa = 0;
    for (const d of docs) {
        const cnpj = String(d?.empresaCnpj || '').replace(/\D/g, '');
        const linha = porCnpj.get(cnpj);
        if (!linha) { docsSemEmpresa++; continue; }
        linha.totalEntradas++;
        switch (classificarDocEntrada(d, agoraMs)) {
            case 'completa': linha.completas++; break;
            case 'resumo_manifestado': linha.resumosManifestados++; break;
            case 'resumo_fora_prazo': linha.resumosForaPrazo++; break;
            default: linha.resumosPendentes++; break;
        }
    }

    for (const [cnpj, st] of Object.entries(states || {})) {
        const linha = porCnpj.get(String(cnpj).replace(/\D/g, ''));
        if (!linha) continue;
        linha.ultimaSyncMs = st.ultimaSyncMs ?? null;
        linha.cStatUltimaSync = st.cStatUltimaSync ?? null;
        linha.pendenciaNSU = Number(st.pendenciaNSU) || 0;
        linha.nsuTravado = st.nsuTravado || null;
    }

    const linhas = [...porCnpj.values()].map((l) => {
        const travada = !!l.nsuTravado || l.pendenciaNSU > 0;
        let status = 'ok';
        if (l.totalEntradas === 0) status = 'sem-captura';
        if (l.resumosManifestados > 0) status = 'aguardando-completa';
        if (l.resumosPendentes > 0) status = 'pendente-ciencia';
        if (travada) status = 'travada';
        const pctCompleta = l.totalEntradas > 0
            ? Math.round((l.completas / l.totalEntradas) * 1000) / 10
            : null;
        return { ...l, travada, status, pctCompleta };
    });

    // Pior primeiro: travada > pendente-ciencia > aguardando > sem-captura > ok
    const peso = { travada: 4, 'pendente-ciencia': 3, 'aguardando-completa': 2, 'sem-captura': 1, ok: 0 };
    linhas.sort((a, b) => (peso[b.status] - peso[a.status])
        || (b.resumosPendentes - a.resumosPendentes)
        || (b.totalEntradas - a.totalEntradas));

    const resumo = {
        totalEmpresas: linhas.length,
        comEntradas: linhas.filter((l) => l.totalEntradas > 0).length,
        travadas: linhas.filter((l) => l.status === 'travada').length,
        pendentesCiencia: linhas.filter((l) => l.status === 'pendente-ciencia').length,
        aguardandoCompleta: linhas.filter((l) => l.status === 'aguardando-completa').length,
        semCaptura: linhas.filter((l) => l.status === 'sem-captura').length,
        ok: linhas.filter((l) => l.status === 'ok').length,
        totalDocs: linhas.reduce((s, l) => s + l.totalEntradas, 0),
        totalCompletas: linhas.reduce((s, l) => s + l.completas, 0),
        totalResumosPendentes: linhas.reduce((s, l) => s + l.resumosPendentes, 0),
        totalResumosManifestados: linhas.reduce((s, l) => s + l.resumosManifestados, 0),
        totalResumosForaPrazo: linhas.reduce((s, l) => s + l.resumosForaPrazo, 0),
        docsSemEmpresa,
    };

    return { resumo, linhas };
}
