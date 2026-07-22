// ============================================================================
// sefaz-backend/cofre-checklist.js  (PURO — sem firebase/io, testável)
//
// CHECKLIST DE MIGRAÇÃO DO COFRE DE SAÍDA: por empresa, cruza o histórico de
// NF-e mod 55 de SAÍDA com a origem 'email' (cofre CFI) e diz quem falta
// migrar da SIEG. A SEFAZ não entrega saída ao próprio emissor (Rejeição 641),
// então saída SÓ entra por cofre de e-mail ou autXML — quem tem saída
// histórica e nunca recebeu via cofre está, na prática, dependendo da SIEG.
//
//   cofre-ativo   → recebeu saída via cofre nos últimos N dias (migrada ✔)
//   cofre-parado  → já recebeu via cofre, mas nada há >N dias (config caiu?)
//   falta-migrar  → tem saída mod 55 histórica e NUNCA via cofre → configurar
//                   xml@spassessoriacontabil.com.br no emissor do cliente
//   sem-saida-55  → nenhum mod 55 de saída no histórico (não emite ou nunca
//                   capturamos — vide relatório de cobertura de saída)
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

/**
 * @param {{empresas: Array<{empresaId,cnpj,nome,regime}>,
 *          docsSaida: Array<{empresaCnpj,chave,origem,dhEmi}>,
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
            ultimaSaidaMs: null,
            ultimaSaidaCofreMs: null,
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
        if (d?.origem === 'email') {
            linha.viaCofre++;
            if (ms && (!linha.ultimaSaidaCofreMs || ms > linha.ultimaSaidaCofreMs)) linha.ultimaSaidaCofreMs = ms;
        }
    }

    const limiteMs = agoraMs - inatividadeDias * DIA_MS;
    const linhas = [...porCnpj.values()].map((l) => {
        let status = 'sem-saida-55';
        if (l.totalSaidas55 > 0) {
            if (l.viaCofre === 0) status = 'falta-migrar';
            else if ((l.ultimaSaidaCofreMs ?? 0) >= limiteMs) status = 'cofre-ativo';
            else status = 'cofre-parado';
        }
        return { ...l, status };
    });

    // Pior primeiro: falta-migrar > cofre-parado > sem-saida-55 > cofre-ativo
    const peso = { 'falta-migrar': 3, 'cofre-parado': 2, 'sem-saida-55': 1, 'cofre-ativo': 0 };
    linhas.sort((a, b) => (peso[b.status] - peso[a.status]) || (b.totalSaidas55 - a.totalSaidas55));

    const resumo = {
        totalEmpresas: linhas.length,
        comSaida55: linhas.filter((l) => l.totalSaidas55 > 0).length,
        cofreAtivo: linhas.filter((l) => l.status === 'cofre-ativo').length,
        cofreParado: linhas.filter((l) => l.status === 'cofre-parado').length,
        faltaMigrar: linhas.filter((l) => l.status === 'falta-migrar').length,
        semSaida55: linhas.filter((l) => l.status === 'sem-saida-55').length,
        docsSemEmpresa,
        inatividadeDias,
    };
    return { resumo, linhas };
}
