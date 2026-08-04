// ============================================================================
// sefaz-backend/sped-ajustes-apuracao.js  (PURO — testável)
//
// Ajustes da apuração do ICMS (Registro E111 do EFD ICMS/IPI) — a maior
// lacuna técnica da migração E-Fiscal → CFI (levantamento 02/08): crédito
// outorgado, estornos, deduções e débitos especiais não tinham onde ser
// lançados, e cliente com ajuste recorrente não fechava a apuração pelo CFI.
//
// O CÓDIGO do ajuste (COD_AJ_APUR, tabela 5.1.1 de cada UF) carrega a
// semântica na própria estrutura (Guia Prático EFD ICMS/IPI):
//   posição 1-2: UF (tem de bater com a UF da empresa)
//   posição 3:   imposto/apuração — '0' = ICMS próprio (E111),
//                '1' = ICMS-ST (E220, gerado desde 04/08). Outros valores
//                (DIFAL/FCP em E310) o CFI ainda não gera.
//   posição 4:   TIPO do ajuste — é ela que decide o campo do E110:
//                  0 = Outros débitos          → VL_TOT_AJ_DEBITOS
//                  1 = Estorno de créditos     → VL_ESTORNOS_CRED
//                  2 = Outros créditos         → VL_TOT_AJ_CREDITOS
//                  3 = Estorno de débitos      → VL_ESTORNOS_DEB
//                  4 = Deduções do imposto     → VL_TOT_DED (só abate saldo DEVEDOR)
//                  5 = Débitos especiais       → DEB_ESP (extra-apuração)
//   posição 5-8: código da UF
//
// Farol honesto: ajuste com código inválido NÃO entra calado no arquivo —
// vira erro que bloqueia a linha e aparece nos warnings da geração.
// ============================================================================

export const TIPOS_AJUSTE = {
    0: { campo: 'outrosDebitos', rotulo: 'Outros débitos' },
    1: { campo: 'estornosCredito', rotulo: 'Estorno de créditos' },
    2: { campo: 'outrosCreditos', rotulo: 'Outros créditos' },
    3: { campo: 'estornosDebito', rotulo: 'Estorno de débitos' },
    4: { campo: 'deducoes', rotulo: 'Deduções do imposto apurado' },
    5: { campo: 'debitosEspeciais', rotulo: 'Débitos especiais' },
};

/**
 * Valida um COD_AJ_APUR pra E111. Devolve { ok, tipo?, erro? }.
 * @param {string} codigo   ex.: 'SP020799'
 * @param {string} ufEmpresa ex.: 'SP'
 */
export function validarCodigoAjuste(codigo, ufEmpresa) {
    const cod = String(codigo || '').trim().toUpperCase();
    if (!/^[A-Z]{2}\d{6}$/.test(cod)) {
        return { ok: false, erro: `Código "${codigo}" inválido — formato é UF + 6 dígitos (ex.: SP020799).` };
    }
    const uf = cod.slice(0, 2);
    if (ufEmpresa && uf !== String(ufEmpresa).toUpperCase()) {
        return { ok: false, erro: `Código ${cod} é da UF ${uf}, mas a empresa é ${String(ufEmpresa).toUpperCase()} — a tabela 5.1.1 é estadual.` };
    }
    // 3º caractere decide QUAL apuração recebe o ajuste: próprio (E111) ou
    // ST (E220). Os dois usam a mesma tabela 5.1.1 e o mesmo tipo no 4º.
    const apuracao = cod[2] === '0' ? 'proprio' : (cod[2] === '1' ? 'st' : null);
    if (!apuracao) {
        return { ok: false, erro: `Código ${cod} não é de apuração do ICMS próprio nem de ST (3º caractere '${cod[2]}'). DIFAL/FCP vão em E310, que o CFI ainda não gera — lance no PVA por enquanto.` };
    }
    const tipo = parseInt(cod[3], 10);
    if (!TIPOS_AJUSTE[tipo]) {
        return { ok: false, erro: `Código ${cod} tem tipo de ajuste desconhecido ('${cod[3]}') — 4º caractere deve ser 0 a 5.` };
    }
    return { ok: true, tipo, apuracao };
}

/**
 * Classifica a lista de ajustes {codigo, descricao, valor} nos baldes do
 * E110. Valor não-positivo e código inválido viram erro (linha NÃO entra).
 */
export function classificarAjustes(ajustes, ufEmpresa, apuracaoAlvo = 'proprio') {
    const out = {
        outrosDebitos: 0, estornosCredito: 0, outrosCreditos: 0,
        estornosDebito: 0, deducoes: 0, debitosEspeciais: 0,
        validos: [], erros: [],
    };
    for (const a of ajustes || []) {
        const valor = Math.round((parseFloat(a?.valor) || 0) * 100) / 100;
        const v = validarCodigoAjuste(a?.codigo, ufEmpresa);
        if (!v.ok) { out.erros.push(v.erro); continue; }
        // Ajuste da OUTRA apuração não é erro — é de outro registro (E111 x
        // E220). Sai desta lista em silêncio e entra na do dono dele.
        if (v.apuracao !== apuracaoAlvo) continue;
        if (valor <= 0) {
            out.erros.push(`Ajuste ${String(a.codigo).toUpperCase()}: valor deve ser POSITIVO (o tipo do código já diz se soma ou abate).`);
            continue;
        }
        out[TIPOS_AJUSTE[v.tipo].campo] += valor;
        out.validos.push({ codigo: String(a.codigo).trim().toUpperCase(), descricao: String(a?.descricao || '').trim(), valor, tipo: v.tipo });
    }
    for (const k of ['outrosDebitos', 'estornosCredito', 'outrosCreditos', 'estornosDebito', 'deducoes', 'debitosEspeciais']) {
        out[k] = Math.round(out[k] * 100) / 100;
    }
    return out;
}

/**
 * Aplica os ajustes na apuração do E110 (fórmula do Guia Prático):
 *   saldo = (débitos + aj.débitos + estornos de crédito)
 *         − (créditos + aj.créditos + estornos de débito) − saldo credor anterior
 *   devedor: VL_SLD_APURADO = saldo; RECOLHER = saldo − deduções (nunca < 0)
 *   credor:  VL_SLD_APURADO = 0; transporta o credor (deduções NÃO viram crédito)
 *
 * Correção embutida (02/08): o gerador antigo punha o saldo CREDOR em
 * VL_SLD_APURADO — o campo é "saldo DEVEDOR apurado" e deve ficar 0,00
 * quando credor (o credor vai só em VL_SLD_CREDOR_TRANSPORTAR).
 */
export function aplicarAjustesApuracao({ vlTotDebitos = 0, vlTotCreditos = 0, vlSldCredorAnt = 0 }, cls) {
    const r2 = (n) => Math.round(n * 100) / 100;
    const c = cls || classificarAjustes([]);
    const saldo = r2(
        (vlTotDebitos + c.outrosDebitos + c.estornosCredito)
        - (vlTotCreditos + c.outrosCreditos + c.estornosDebito)
        - vlSldCredorAnt,
    );
    const devedor = saldo >= 0;
    const vlSldApurado = devedor ? saldo : 0;
    const deducoesAplicadas = devedor ? Math.min(c.deducoes, vlSldApurado) : 0;
    return {
        vlTotDebitos: r2(vlTotDebitos),
        vlTotAjDebitos: c.outrosDebitos,
        vlEstornosCred: c.estornosCredito,
        vlTotCreditos: r2(vlTotCreditos),
        vlTotAjCreditos: c.outrosCreditos,
        vlEstornosDeb: c.estornosDebito,
        vlSldCredorAnt: r2(vlSldCredorAnt),
        vlSldApurado,
        vlTotDed: deducoesAplicadas,
        vlIcmsRecolher: devedor ? r2(vlSldApurado - deducoesAplicadas) : 0,
        vlSldCredorTransportar: devedor ? 0 : r2(-saldo),
        vlDebEsp: c.debitosEspeciais,
        // Dedução maior que o saldo devedor não vira crédito — o excedente é
        // perdido no período e o gerador AVISA (farol honesto).
        deducaoExcedente: devedor ? r2(Math.max(0, c.deducoes - deducoesAplicadas)) : c.deducoes,
    };
}

/** Linhas E111 (campos, sem o pipe — quem formata é o buildLine do bloco). */
export function montarLinhasE111(validos) {
    return (validos || []).map(a => ['E111', a.codigo, a.descricao || '', a.valor]);
}
