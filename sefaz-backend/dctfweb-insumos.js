// ============================================================================
// sefaz-backend/dctfweb-insumos.js  (ESM, núcleo PURO)
// ----------------------------------------------------------------------------
// SEMÁFORO DE INSUMOS DA DCTFWEB POR DEPARTAMENTO (Paulo, 10/08): a DCTFWeb
// consolida TRÊS fontes — eSocial (👥 DP/Folha, transmitido pelo Folhamatic),
// EFD-Reinf (📊 Contábil) e MIT (🧾 Fiscal) — e quem transmitia não via se as
// outras duas já entraram. Transmitir cedo = retificação e retrabalho com o
// input de outro departamento.
//
// REGRA DA CASA que manda aqui: NENHUMA etapa se marca à mão — toda prova vem
// de dado real. As provas: eSocial = CONSULTARFECHAMENTO do SERPRO; MIT =
// SITUACAOENC315; Reinf = auditoria do NOSSO gateway (reinf_gateway_lotes) +
// as retenções que o próprio CFI apura nas NFS-e tomadas.
//
// FAROL HONESTO — o caso traiçoeiro é o Reinf: empresa sem retenção no mês
// não gera débito, e AUSÊNCIA ≠ PENDÊNCIA. Por isso os estados são QUATRO:
//   recebido            → a fonte confirmou a entrega
//   pendente            → há dado esperado e a entrega NÃO apareceu (grita)
//   sem-movimento       → nada entregue E nada esperado do nosso lado (⚪)
//   indeterminado       → a consulta falhou — diz o motivo, NÃO afirma nada
// ============================================================================

export const DEPARTAMENTO_INSUMO = {
    esocial: { departamento: 'dp-folha', rotulo: '👥 DP/Folha — eSocial' },
    reinf: { departamento: 'contabil', rotulo: '📊 Contábil — EFD-Reinf' },
    mit: { departamento: 'fiscal', rotulo: '🧾 Fiscal — MIT' },
};

/** Selo do eSocial a partir da consulta SERPRO de fechamento. */
export function seloEsocial(consulta) {
    const base = { ...DEPARTAMENTO_INSUMO.esocial, fonte: 'SERPRO (fechamento eSocial)' };
    if (!consulta || consulta.ok === false) {
        return {
            ...base,
            estado: 'indeterminado',
            detalhe: `Consulta ao eSocial indisponível${consulta?.erro ? ` (${consulta.erro})` : ''} — não dá pra afirmar nem que entregou, nem que falta.`,
        };
    }
    if (consulta.entregue) {
        return {
            ...base,
            estado: 'recebido',
            detalhe: `Fechamento (S-1299) transmitido${consulta.dataEntrega ? ` em ${consulta.dataEntrega}` : ''} — folha dentro da DCTFWeb.`,
            quando: consulta.dataEntrega || null,
        };
    }
    return {
        ...base,
        estado: 'pendente',
        detalhe: `eSocial da competência SEM fechamento (situação: ${consulta.situacao || 'não iniciado'}). `
            + 'A folha é transmitida pelo Folhamatic — cobrar o DP antes de fechar a DCTFWeb. '
            + 'Empresa comprovadamente sem folha: confirmar com o DP antes de seguir.',
    };
}

/** Selo do MIT a partir da situação de encerramento (SITUACAOENC315). */
export function seloMit(situacao) {
    const base = { ...DEPARTAMENTO_INSUMO.mit, fonte: 'SERPRO (situação do MIT)' };
    if (!situacao || situacao.ok === false) {
        return {
            ...base,
            estado: 'indeterminado',
            detalhe: `Situação do MIT indisponível${situacao?.erro ? ` (${situacao.erro})` : ''} — não dá pra afirmar.`,
        };
    }
    // Situação 3 = encerrada (a MESMA régua da retificação #292).
    const encerrada = Number(situacao.situacao) === 3 || /encerrad/i.test(String(situacao.descricao || ''));
    if (encerrada) {
        return { ...base, estado: 'recebido', detalhe: 'Apuração MIT ENCERRADA — tributos do mês dentro da DCTFWeb.' };
    }
    return {
        ...base,
        estado: 'pendente',
        detalhe: `MIT da competência não encerrado (situação: ${situacao.descricao || situacao.situacao || 'não iniciada'}) — encerrar no card DCTFWeb → MIT antes de fechar a declaração.`,
    };
}

/**
 * Selo do Reinf: prova dupla — transmissão pelo NOSSO gateway e/ou as
 * retenções que o CFI apura nas NFS-e tomadas da competência.
 */
export function seloReinf({ lotesGateway = [], retencoesApuradas = null } = {}) {
    const base = { ...DEPARTAMENTO_INSUMO.reinf, fonte: 'gateway do CFI + NFS-e tomadas' };
    const transmitido = (lotesGateway || []).find((l) => l && l.protocolo);
    if (transmitido) {
        return {
            ...base,
            estado: 'recebido',
            detalhe: `Lote Reinf transmitido pelo gateway (protocolo ${transmitido.protocolo})${transmitido.por ? ` por ${transmitido.por}` : ''}.`,
            quando: transmitido.em || null,
            quem: transmitido.por || null,
        };
    }
    if (retencoesApuradas == null) {
        return {
            ...base,
            estado: 'indeterminado',
            detalhe: 'Sem transmissão pelo gateway e sem leitura das retenções — não dá pra afirmar.',
        };
    }
    if (retencoesApuradas.totalNotasComRetencao > 0) {
        return {
            ...base,
            estado: 'pendente',
            detalhe: `O CFI apura ${retencoesApuradas.totalNotasComRetencao} NFS-e tomada(s) COM retenção na competência `
                + 'e nenhum lote Reinf saiu pelo gateway — declarar a DCTFWeb agora é fechá-la sem essas retenções (retificação na certa). '
                + 'Falar com o Contábil.',
        };
    }
    return {
        ...base,
        estado: 'sem-movimento',
        detalhe: 'Nenhuma retenção apurada nas NFS-e tomadas da competência e nenhum lote pelo gateway — sem movimento aparente de Reinf. '
            + (retencoesApuradas.semCamposGravados > 0
                ? `⚠ ${retencoesApuradas.semCamposGravados} nota(s) antigas sem os campos de retenção gravados — ausência ≠ zero; reimportar o XML confirma.`
                : ''),
    };
}

/**
 * O veredito do conjunto: pode fechar a DCTFWeb sem retrabalho?
 * - 'pronto'      → os três recebidos (ou sem movimento comprovado)
 * - 'incompleto'  → algum PENDENTE de verdade — transmitir = retificar depois
 * - 'incerto'     → nenhum pendente, mas algum indeterminado — decidir é humano
 */
export function vereditoInsumos(selos) {
    const lista = (selos || []).filter(Boolean);
    if (lista.some((s) => s.estado === 'pendente')) {
        const quem = lista.filter((s) => s.estado === 'pendente').map((s) => s.rotulo).join(' e ');
        return {
            veredito: 'incompleto',
            frase: `Falta insumo de: ${quem}. Transmitir a DCTFWeb agora é fechá-la incompleta — retificação e retrabalho na certa.`,
        };
    }
    if (lista.some((s) => s.estado === 'indeterminado')) {
        const quem = lista.filter((s) => s.estado === 'indeterminado').map((s) => s.rotulo).join(' e ');
        return {
            veredito: 'incerto',
            frase: `Sem confirmação de: ${quem} (consulta indisponível). O app não afirma o que não leu — confirme com o departamento antes de fechar.`,
        };
    }
    return { veredito: 'pronto', frase: 'Os três insumos confirmados — a DCTFWeb pode ser fechada sem retrabalho.' };
}

/**
 * Conta as NFS-e tomadas COM retenção na competência — a régua é a MESMA do
 * R-4020 (valores.ir/inss/csll/pis/cofins/valorIssRetido > 0). Recebe os docs
 * já lidos; não consulta nada (núcleo puro).
 */
export function contarRetencoesTomadas(docs, competencia) {
    let totalNotasComRetencao = 0;
    let semCamposGravados = 0;
    for (const d of docs || []) {
        if (!d || d.tipo !== 'NFSe' || d.direcao !== 'entrada') continue;
        if (competencia && d.competencia !== competencia) continue;
        if (['cancelado', 'cancelada', 'denegado', 'inutilizado'].includes(d.status)) continue;
        const v = d.valores || {};
        const federaisGravados = v.ir !== undefined || v.inss !== undefined || v.csll !== undefined;
        if (!federaisGravados) semCamposGravados += 1;
        const retido = (v.valorIssRetido || 0) + (v.ir || 0) + (v.inss || 0) + (v.csll || 0)
            + (v.issRetido === true ? 0.01 : 0);
        if (retido > 0) totalNotasComRetencao += 1;
    }
    return { totalNotasComRetencao, semCamposGravados };
}
