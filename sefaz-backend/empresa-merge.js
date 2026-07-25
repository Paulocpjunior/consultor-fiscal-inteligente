// ============================================================================
// sefaz-backend/empresa-merge.js  (PURO — sem firebase/io, testável)
// ----------------------------------------------------------------------------
// Mesclagem de EMPRESAS DUPLICADAS quando AS DUAS têm dados (o caso que o
// badge "qual excluir" não resolve — 25/07). Regras acordadas:
//
//   - O VENCEDOR mantém TUDO que já tem — mesclagem NUNCA sobrescreve dado
//     do vencedor (competência presente nos dois → fica a do vencedor, e o
//     conflito é REPORTADO pro admin conferir).
//   - Do PERDEDOR entram só os dados que o vencedor NÃO tem:
//       Lucro:   fichaFinanceira (por mesReferencia)
//       Simples: faturamentoManual/faturamentoMensalDetalhado/folhaMensal
//                (por mês) + historicoCalculos (por id)
//     Campos cadastrais vazios do vencedor são preenchidos com os do perdedor
//     (dadosFiscais campo a campo, sharePointConfig se ausente).
//   - O perdedor vira lápide `_merged_into` (mesmo padrão dos ~35 pontos do
//     backend que já pulam merged/deleted) — nada é apagado fisicamente.
// ============================================================================

/** Meses 'AAAA-MM' presentes num mapa (obj) — ignora chaves não-mês. */
const ehMes = (k) => /^\d{4}-\d{2}$/.test(String(k || ''));

/**
 * Mescla os DADOS de duas empresas duplicadas (mesma coleção). Função pura:
 * devolve o patch a aplicar no vencedor + resumo/conflitos, sem tocar em nada.
 *
 * @param {'lucro'|'simples'} regime
 * @param {object} vencedor  dados atuais do doc vencedor
 * @param {object} perdedor  dados atuais do doc perdedor
 * @returns {{ ok: boolean, erro?: string, patch: object, resumo: object, conflitos: string[] }}
 */
export function mesclarDadosEmpresas(regime, vencedor, perdedor) {
    const conflitos = [];
    const patch = {};
    const resumo = {
        fichasCopiadas: 0, mesesFaturamentoCopiados: 0, mesesDetalhadoCopiados: 0,
        mesesFolhaCopiados: 0, calculosCopiados: 0, camposCadastroPreenchidos: 0,
    };

    if (!vencedor || !perdedor) {
        return { ok: false, erro: 'Vencedor e perdedor são obrigatórios.', patch, resumo, conflitos };
    }
    const cnpjV = String(vencedor.cnpj || '').replace(/\D/g, '');
    const cnpjP = String(perdedor.cnpj || '').replace(/\D/g, '');
    // Mesclagem é pra DUPLICATA: exige o MESMO CNPJ (14 dígitos). Empresas
    // diferentes mescladas por engano = desastre fiscal.
    if (!cnpjV || cnpjV.length !== 14 || cnpjV !== cnpjP) {
        return {
            ok: false,
            erro: `Mesclagem exige o MESMO CNPJ nos dois cadastros (vencedor ${cnpjV || '—'} × perdedor ${cnpjP || '—'}).`,
            patch, resumo, conflitos,
        };
    }
    if (perdedor._merged_into || perdedor._deleted || vencedor._merged_into || vencedor._deleted) {
        return { ok: false, erro: 'Um dos cadastros já está mesclado/excluído.', patch, resumo, conflitos };
    }

    if (regime === 'lucro') {
        // fichaFinanceira: array de registros por mesReferencia ('AAAA-MM').
        const fichasV = Array.isArray(vencedor.fichaFinanceira) ? vencedor.fichaFinanceira : [];
        const fichasP = Array.isArray(perdedor.fichaFinanceira) ? perdedor.fichaFinanceira : [];
        const mesesV = new Set(fichasV.map((f) => f?.mesReferencia).filter(Boolean));
        const novas = [];
        for (const f of fichasP) {
            if (!f?.mesReferencia) continue;
            if (mesesV.has(f.mesReferencia)) {
                conflitos.push(`Ficha ${f.mesReferencia}: existe nos DOIS cadastros — mantida a do vencedor; confira os valores.`);
                continue;
            }
            novas.push(f);
        }
        if (novas.length > 0) {
            patch.fichaFinanceira = [...fichasV, ...novas]
                .sort((a, b) => String(a.mesReferencia || '').localeCompare(String(b.mesReferencia || '')));
            resumo.fichasCopiadas = novas.length;
        }
    } else if (regime === 'simples') {
        // Mapas mês→valor: entra só mês que o vencedor não tem.
        for (const [campo, chaveResumo] of [
            ['faturamentoManual', 'mesesFaturamentoCopiados'],
            ['faturamentoMensalDetalhado', 'mesesDetalhadoCopiados'],
            ['folhaMensal', 'mesesFolhaCopiados'],
        ]) {
            const mapV = (vencedor[campo] && typeof vencedor[campo] === 'object') ? vencedor[campo] : {};
            const mapP = (perdedor[campo] && typeof perdedor[campo] === 'object') ? perdedor[campo] : {};
            const merged = { ...mapV };
            let copiados = 0;
            for (const [mes, val] of Object.entries(mapP)) {
                if (!ehMes(mes)) continue;
                if (mes in mapV) {
                    if (JSON.stringify(mapV[mes]) !== JSON.stringify(val)) {
                        conflitos.push(`${campo} ${mes}: valores diferentes nos dois cadastros — mantido o do vencedor.`);
                    }
                    continue;
                }
                merged[mes] = val;
                copiados++;
            }
            if (copiados > 0) {
                patch[campo] = merged;
                resumo[chaveResumo] = copiados;
            }
        }
        // historicoCalculos: concat por id (sem duplicar).
        const histV = Array.isArray(vencedor.historicoCalculos) ? vencedor.historicoCalculos : [];
        const histP = Array.isArray(perdedor.historicoCalculos) ? perdedor.historicoCalculos : [];
        const idsV = new Set(histV.map((h) => h?.id).filter(Boolean));
        const novosHist = histP.filter((h) => h?.id && !idsV.has(h.id));
        if (novosHist.length > 0) {
            patch.historicoCalculos = [...histV, ...novosHist];
            resumo.calculosCopiados = novosHist.length;
        }
    } else {
        return { ok: false, erro: `Regime desconhecido: ${regime}`, patch, resumo, conflitos };
    }

    // Cadastro: preenche campo VAZIO do vencedor com o do perdedor (nunca troca).
    const dfV = (vencedor.dadosFiscais && typeof vencedor.dadosFiscais === 'object') ? vencedor.dadosFiscais : {};
    const dfP = (perdedor.dadosFiscais && typeof perdedor.dadosFiscais === 'object') ? perdedor.dadosFiscais : {};
    const dfMerged = { ...dfV };
    let dfPreenchidos = 0;
    for (const [k, v] of Object.entries(dfP)) {
        const atual = dfMerged[k];
        if ((atual == null || String(atual).trim() === '') && v != null && String(v).trim() !== '') {
            dfMerged[k] = v;
            dfPreenchidos++;
        }
    }
    if (dfPreenchidos > 0) {
        patch.dadosFiscais = dfMerged;
        resumo.camposCadastroPreenchidos = dfPreenchidos;
    }
    if (!vencedor.sharePointConfig && perdedor.sharePointConfig) {
        patch.sharePointConfig = perdedor.sharePointConfig;
        resumo.camposCadastroPreenchidos++;
    }

    return { ok: true, patch, resumo, conflitos };
}
