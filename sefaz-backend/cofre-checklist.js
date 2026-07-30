// ============================================================================
// sefaz-backend/cofre-checklist.js  (PURO — sem firebase/io, testável)
//
// CHECKLIST DE MIGRAÇÃO DA SAÍDA (mod 55): por empresa, cruza o histórico de
// NF-e de SAÍDA com os DOIS trilhos automáticos — cofre de e-mail (origem
// 'email') e autXML (origem 'sefaz'/'autxml', que só existe com o CNPJ do
// escritório autorizado na nota: a SEFAZ não entrega saída ao emissor,
// Rejeição 641). Quem tem saída histórica e nunca recebeu por NENHUM trilho
// automático está, na prática, dependendo da SIEG.
//
// v2 (30/07, print do Paulo): a v1 só olhava o cofre — Eduardo Guerra com 60
// saídas chegando NO DIA via autXML aparecia "🔴 Falta migrar". Farol honesto:
// migrada é migrada, por qualquer trilho.
//
//   ativo         → recebeu saída por trilho automático nos últimos N dias
//                   (campo `trilho` diz qual: cofre | autxml | ambos)
//   parado        → já recebeu por trilho automático, mas nada há >N dias
//   falta-migrar  → tem saída mod 55 histórica e NUNCA por trilho automático
//   sem-saida-55  → nenhum mod 55 de saída no histórico
// ============================================================================

const DIA_MS = 24 * 3600 * 1000;

/** Modelo do documento a partir da chave de 44 dígitos (posições 20-21). */
export function modeloDaChave(chave) {
    const c = String(chave || '').replace(/\D/g, '');
    return c.length === 44 ? c.substring(20, 22) : null;
}

function tsMs(v) {
    if (!v) return null;
    const ms = typeof v === 'number' ? v : Date.parse(v);
    return Number.isFinite(ms) ? ms : null;
}

// Trilho AUTOMÁTICO do documento (mesma régua da Cobertura de Saída):
//  'cofre'  → origem 'email';
//  'autxml' → origem 'sefaz'/'autxml' SEM fonte manual (conferência, consulta
//             por chave, importação, agente) — captura que chegou sozinha;
//  null     → manual/desconhecido: não confirma migração nenhuma.
export function trilhoAutomatico(origem, fonte = null) {
    const o = String(origem || '').toLowerCase();
    const f = String(fonte || '').toLowerCase();
    if (o === 'email') return 'cofre';
    if (o === 'sharepoint_auto' || o === 'manual') return null;
    if (/conferencia|consulta-chave|manual|agent|importac/.test(f)) return null;
    if (o === 'sefaz' || o === 'autxml') return 'autxml';
    return null;
}

/**
 * @param {{empresas: Array<{empresaId,cnpj,nome,regime}>,
 *          docsSaida: Array<{empresaCnpj,chave,origem,dhEmi,capturadoPor}>,
 *          agoraMs: number, inatividadeDias?: number}} args
 */
export function analisarChecklistCofre({ empresas, docsSaida, agoraMs, inatividadeDias = 30 }) {
    const porCnpj = new Map();
    for (const e of empresas) {
        porCnpj.set(e.cnpj, {
            empresaId: e.empresaId,
            cnpj: e.cnpj,
            nome: e.nome,
            regime: e.regime,
            totalSaidas55: 0,
            viaCofre: 0,
            viaAutXml: 0,
            ultimaSaidaMs: null,
            ultimaSaidaCofreMs: null,
            ultimaSaidaAutXmlMs: null,
        });
    }

    let docsSemEmpresa = 0;
    for (const d of docsSaida) {
        if (modeloDaChave(d?.chave) !== '55') continue; // só NF-e mod 55
        const cnpj = String(d?.empresaCnpj || '').replace(/\D/g, '');
        const linha = porCnpj.get(cnpj);
        if (!linha) { docsSemEmpresa++; continue; }
        linha.totalSaidas55++;
        const ms = tsMs(d?.dhEmi);
        if (ms && (!linha.ultimaSaidaMs || ms > linha.ultimaSaidaMs)) linha.ultimaSaidaMs = ms;
        const trilho = trilhoAutomatico(d?.origem, d?.capturadoPor?.fonte);
        if (trilho === 'cofre') {
            linha.viaCofre++;
            if (ms && (!linha.ultimaSaidaCofreMs || ms > linha.ultimaSaidaCofreMs)) linha.ultimaSaidaCofreMs = ms;
        } else if (trilho === 'autxml') {
            linha.viaAutXml++;
            if (ms && (!linha.ultimaSaidaAutXmlMs || ms > linha.ultimaSaidaAutXmlMs)) linha.ultimaSaidaAutXmlMs = ms;
        }
    }

    const limiteMs = agoraMs - inatividadeDias * DIA_MS;
    const linhas = [...porCnpj.values()].map((l) => {
        const viaAuto = l.viaCofre + l.viaAutXml;
        const ultimaAutoMs = Math.max(l.ultimaSaidaCofreMs ?? 0, l.ultimaSaidaAutXmlMs ?? 0) || null;
        const cofreRecente = (l.ultimaSaidaCofreMs ?? 0) >= limiteMs;
        const autXmlRecente = (l.ultimaSaidaAutXmlMs ?? 0) >= limiteMs;

        let status = 'sem-saida-55';
        let trilho = null;
        if (l.totalSaidas55 > 0) {
            if (viaAuto === 0) status = 'falta-migrar';
            else if (cofreRecente || autXmlRecente) {
                status = 'ativo';
                trilho = cofreRecente && autXmlRecente ? 'ambos' : (autXmlRecente ? 'autxml' : 'cofre');
            } else {
                status = 'parado';
                trilho = l.viaAutXml > 0 && l.viaCofre > 0 ? 'ambos' : (l.viaAutXml > 0 ? 'autxml' : 'cofre');
            }
        }
        return { ...l, viaAuto, ultimaAutoMs, status, trilho };
    });

    // Pior primeiro: falta-migrar > parado > sem-saida-55 > ativo
    const peso = { 'falta-migrar': 3, 'parado': 2, 'sem-saida-55': 1, 'ativo': 0 };
    linhas.sort((a, b) => (peso[b.status] - peso[a.status]) || (b.totalSaidas55 - a.totalSaidas55));

    const resumo = {
        totalEmpresas: linhas.length,
        comSaida55: linhas.filter((l) => l.totalSaidas55 > 0).length,
        ativos: linhas.filter((l) => l.status === 'ativo').length,
        ativosCofre: linhas.filter((l) => l.status === 'ativo' && (l.trilho === 'cofre' || l.trilho === 'ambos')).length,
        ativosAutXml: linhas.filter((l) => l.status === 'ativo' && (l.trilho === 'autxml' || l.trilho === 'ambos')).length,
        parados: linhas.filter((l) => l.status === 'parado').length,
        faltaMigrar: linhas.filter((l) => l.status === 'falta-migrar').length,
        semSaida55: linhas.filter((l) => l.status === 'sem-saida-55').length,
        docsSemEmpresa,
        inatividadeDias,
    };
    return { resumo, linhas };
}
